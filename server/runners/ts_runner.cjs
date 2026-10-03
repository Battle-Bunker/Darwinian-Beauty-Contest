// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower - stateless: every call runs the program in a brand-new context, with the
//                               context's own (unseeded) Math.random and Date.now(), then calls
//                               flower(challenge, ledger).
//   node ts_runner.cjs bee    - stateful: one context reused between calls for as long as this version
//                               of the bee plays (until its team submits a new bee, or it crashes).
// The code is the program's minified form (vendor/measure.js), so names can't carry data.
//
// Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
// {code, ms, limitMs, game, maxChars, ledger}: `ledger` is the team ledger so far.
// Requests:
//   {op: "ledger", entries: [...]}   append to the team ledger (between calls, never timed)
//   flower: {op: "call", c}          -> {v: the return value, cpu: ms} | {e: error, cpu: ms}
//   bee:    {op: "first"}            -> {a: first(ledger), out}
//           {op: "decide", c, r}     -> {a: decide(c, r, ledger), out}
// A flower's `cpu` is this process's CPU time while the program runs and flower() is called (creating
// the fresh context isn't counted). The ledger is kept, already parsed, in a context of its own whose
// built-ins are all frozen and in which no code can be compiled; each call gets a frozen snapshot of it,
// so receiving the ledger costs a flower nothing and it can't keep state in it. Reading it is its own
// compute. A bee's ledger lives in the bee's own context.
// Time limits are wall-clock: a flower is stopped at `ms` (setup and call together). A bee's `ms` is a
// deadline the engine keeps, so the runner only stops a bee call at the hard limit `limitMs`.
// Values cross the context boundary only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const vm = require("node:vm");
const readline = require("node:readline");
const { stripTypeScriptTypes } = require("node:module");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);
const timedOut = (e) => /timed out/i.test(short(e));

// Runs inside each program context before the program: captured console and GAME.
const PRELUDE = (game) => `
(() => {
  const buf = [];
  globalThis.__out = buf;
  const log = (...a) => { if (buf.join("").length < 2000) buf.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\\n"); };
  globalThis.console = { log, error: log, warn: log, info: log };
  globalThis.GAME = Object.freeze(${JSON.stringify(game)});
})();`;

const EXPORTS = `;globalThis.__fns = { flower: typeof flower === "function" ? flower : undefined,
  first: typeof first === "function" ? first : undefined, decide: typeof decide === "function" ? decide : undefined };`;

const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });

function encodeCall(name, argsExpr) {
  return `(() => { const r = __fns.${name}(...${argsExpr});
    if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error("${name} must not be async");
    let s; try { s = JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error("${name} returned something that is not plain data"); }
    const o = __out.join(""); __out.length = 0; return JSON.stringify({ s, o }); })()`;
}
const jsonArg = (v) => `JSON.parse(${JSON.stringify(JSON.stringify(v === undefined ? null : v))})`;

// The flowers' ledger realm: entries are parsed and deep-frozen here, and every built-in reachable from
// them is frozen too, with the function constructors replaced by ones that throw, so nothing a flower
// does to the ledger (or to anything it can reach from it) survives the call.
const LEDGER_REALM = `(() => {
  "use strict";
  const tame = (fn) => {
    const proto = Object.getPrototypeOf(fn);
    const C = function () { throw new TypeError("not allowed"); };
    Object.defineProperty(C, "prototype", { value: proto });
    Object.defineProperty(proto, "constructor", { value: C });
  };
  for (const f of [function () {}, function* () {}, async function () {}, async function* () {}]) tame(f);
  const seen = new WeakSet();
  const harden = (o) => {
    if ((typeof o !== "object" && typeof o !== "function") || o === null || seen.has(o)) return;
    seen.add(o);
    try { Object.freeze(o); } catch {}
    harden(Object.getPrototypeOf(o));
    for (const k of Reflect.ownKeys(o)) {
      const d = Reflect.getOwnPropertyDescriptor(o, k);
      if (d) { if ("value" in d) harden(d.value); else { harden(d.get); harden(d.set); } }
    }
  };
  const ledger = [];
  let snap = null;
  const api = {
    append(json) { const es = JSON.parse(json); for (const e of es) { harden(e); ledger.push(e); } snap = null; },
    snapshot() { return snap || (snap = Object.freeze(ledger.slice())); },
  };
  for (const o of [function* () {}, async function () {}, async function* () {}, [][Symbol.iterator](), new Map()[Symbol.iterator](),
    new Set()[Symbol.iterator](), ""[Symbol.iterator](), /a/[Symbol.matchAll]("a"), Object.getPrototypeOf(Int8Array), api, globalThis]) harden(o);
  return api;
})()`;

const role = process.argv[2];
const lines = readline.createInterface({ input: process.stdin });
let setup = null, script = null, ctx = null, loadError = null, flowerLedger = null;
const maxChars = () => setup.maxChars || 20000;
const limit = () => setup.limitMs || setup.ms; // a bee call's hard stop
const cpuMs = (since) => { const u = process.cpuUsage(since); return (u.user + u.system) / 1000; };

function appendLedger(entries) {
  if (!entries || !entries.length) return;
  if (role === "flower") flowerLedger.append(JSON.stringify(entries));
  else vm.runInContext(`(() => { const es = ${jsonArg(entries)}; for (const e of es) __ledger.push(e); })()`, ctx);
}

function load(req) {
  setup = req;
  try {
    const js = stripTypeScriptTypes(setup.code);
    script = new vm.Script(js + EXPORTS, { filename: "program.ts" });
  } catch (e) {
    loadError = short(e);
  }
  if (role === "flower") {
    flowerLedger = vm.runInContext(LEDGER_REALM, newContext());
  } else if (!loadError) {
    try {
      ctx = newContext();
      vm.runInContext(PRELUDE(setup.game), ctx);
      vm.runInContext("globalThis.__ledger = [];", ctx);
      script.runInContext(ctx, { timeout: setup.ms * 10 });
      if (vm.runInContext("typeof __fns.first === 'function' && typeof __fns.decide === 'function'", ctx) !== true) {
        throw new Error("program must define function first(ledger) and function decide(challenge, response, ledger)");
      }
    } catch (e) {
      loadError = timedOut(e) ? "Timeout: took too long to load" : short(e);
    }
  }
  if (!loadError || role === "flower") appendLedger(setup.ledger);
  const o = ctx ? vm.runInContext("(() => { const o = __out.join(''); __out.length = 0; return o; })()", ctx) : "";
  out(loadError ? { ok: false, e: loadError, out: o } : { ok: true, out: o });
}

function callFlower(req) {
  if (loadError) return out({ e: "flower failed to load: " + loadError, cpu: 0 });
  const c = newContext();
  vm.runInContext(PRELUDE(setup.game), c);
  c.__ledger = flowerLedger.snapshot();
  vm.runInContext(`globalThis.__c = ${jsonArg(req.c)};`, c);
  const t0 = performance.now(), cpu0 = process.cpuUsage();
  let cpu = null;
  try {
    // The flower's compute: its program, then flower(challenge, ledger). Encoding the reply isn't counted
    // (as in the Python runner).
    script.runInContext(c, { timeout: setup.ms });
    if (vm.runInContext("typeof __fns.flower", c) !== "function") throw new Error("program must define function flower(challenge, ledger)");
    const left = Math.max(1, Math.round(setup.ms - (performance.now() - t0)));
    vm.runInContext(`globalThis.__r = __fns.flower(__c, __ledger);`, c, { timeout: left });
    cpu = cpuMs(cpu0);
    const s = vm.runInContext(`(() => { const r = globalThis.__r;
      if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error("flower must not be async");
      try { return JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error("flower returned something that is not plain data"); } })()`, c, { timeout: setup.ms });
    if (s.length > maxChars()) return out({ e: `flower returned something too large (over ${maxChars()} characters)`, cpu });
    return out({ v: JSON.parse(s), cpu });
  } catch (e) {
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), cpu: cpu ?? cpuMs(cpu0) });
  }
}

function callBee(req) {
  if (loadError) return out({ e: "program failed to load: " + loadError, out: "" });
  try {
    let args;
    if (req.op === "first") args = "[__ledger]";
    else if (req.op === "decide") args = `[${jsonArg(req.c)}, ${jsonArg(req.r)}, __ledger]`;
    else throw new Error("unknown request");
    const r = JSON.parse(vm.runInContext(encodeCall(req.op, args), ctx, { timeout: limit() }));
    if (r.s && r.s.length > maxChars()) throw new Error(`${req.op} returned something too large`);
    return out({ a: JSON.parse(r.s), out: r.o });
  } catch (e) {
    let o = "";
    try { o = vm.runInContext("(() => { const o = __out.join(''); __out.length = 0; return o; })()", ctx); } catch {}
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), out: o });
  }
}

lines.on("line", (line) => {
  const req = JSON.parse(line);
  if (!setup) return load(req);
  if (req.op === "ledger") {
    try { appendLedger(req.entries); } catch (e) { return out({ e: short(e) }); }
    return out({ ok: true });
  }
  return role === "flower" ? callFlower(req) : callBee(req);
});
