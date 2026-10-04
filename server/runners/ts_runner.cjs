// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower | bee
// Every call runs the program in a brand-new context (with its own unseeded Math.random and Date.now()),
// then calls flower(challenge), first() or decide(challenge, response). After a bee's decide() returns a
// feed, its context is kept for one more call, fed(nectar), if the program defines it: the same instance,
// with every global it had; then it is dropped. Nothing else survives from one call to the next, except a
// bee's MEMORY, which the engine keeps and sends with every call.
// The code is the program's minified form (vendor/measure.js), so names can't carry data.
//
// Globals: GAME and, for a bee, MEMORY (a key-value store).
//
// Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
// {code, ms, limitMs, game, maxChars, maxResponseBytes}. Requests (as in py_runner.py):
//   flower: {op: "call", c}               -> {v: [response, percent], bytes, cpu} | {e, cpu}
//   bee:    {op: "first", memory}         -> {a, out, memory} | {e, out}
//           {op: "stage", c, r}           -> {ok}: the next decide's fresh context, its arguments read in
//           {op: "decide", staged: true, memory} (or with c and r) -> {a, out, memory} | {e, out}
//           {op: "fed", nectar}           -> {ok, out, memory} | {e, out} | {skipped}
// Any request other than fed drops a kept context. The reply (and a bee's MEMORY) is encoded to JSON text
// inside the context, on the clock and under the time limit, so hooks (toJSON, getters, proxies) are the
// program's own compute; only a string leaves the context. A flower's `cpu` is this process's CPU time for
// running the program, calling flower() and encoding its reply (not for creating the context); its
// response's UTF-8 size (`bytes`) must be at most maxResponseBytes. Time limits are wall-clock: a flower
// is stopped at `ms`, and so is fed(); a bee's `ms` for first and decide is a deadline the engine keeps, so
// the runner only stops those at `limitMs`.
// Values cross context boundaries only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const vm = require("node:vm");
const readline = require("node:readline");
const { stripTypeScriptTypes } = require("node:module");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const send = (line) => process.stdout.write(line + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);
const timedOut = (e) => /timed out/i.test(short(e));
const role = process.argv[2];
const ENTRY = role === "bee" ? ["first", "decide"] : ["flower"];
const OPTIONAL = role === "bee" ? ["fed"] : [];
const SIGNATURE = role === "bee" ? "function first() and function decide(challenge, response)" : "function flower(challenge)";

// Runs inside each program context before the program: captured console and GAME. The console keeps its
// output as one string, read back with intrinsics captured here, so reading it runs no program code.
// FinalizationRegistry is removed: its callbacks would run between calls, off the clock.
const PRELUDE = (game) => `
(() => {
  const apply = Reflect.apply, slice = String.prototype.slice, stringify = JSON.stringify;
  let text = "";
  Object.defineProperty(globalThis, "__takeOut", { value: () => { const o = text; text = ""; return o.length > 2000 ? apply(slice, o, [0, 2000]) : o; } });
  const log = (...a) => { if (text.length < 2000) text += a.map((x) => typeof x === "string" ? x : stringify(x)).join(" ") + "\\n"; };
  globalThis.console = { log, error: log, warn: log, info: log };
  globalThis.GAME = Object.freeze(${JSON.stringify(game)});
  delete globalThis.FinalizationRegistry;
})();`;

const EXPORTS = `;globalThis.__fns = { ${[...ENTRY, ...OPTIONAL].map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(", ")} };`;

const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });
const cpuMs = (since) => { const u = process.cpuUsage(since); return (u.user + u.system) / 1000; };

let setup = null, script = null, loadError = null;
let staged = null; // the next decide's context, its arguments already read in
let kept = null;   // the context of a feed decision, kept for fed()
const maxChars = () => setup.maxChars || 20000;

/** A fresh context with the prelude run. */
function fresh() {
  const c = newContext();
  vm.runInContext(PRELUDE(setup.game), c);
  return c;
}

/**
 * Set globals of context c from JSON texts ({name: text}), parsed inside the context (only strings cross).
 * Runs before the program's code, so no program code is involved.
 */
function setGlobals(c, texts) {
  const names = Object.keys(texts);
  names.forEach((n, i) => { c[`__in${i}`] = texts[n]; });
  vm.runInContext(`(() => { const p = JSON.parse; ${names.map((n, i) => `globalThis.${n} = p(globalThis.__in${i}); delete globalThis.__in${i};`).join(" ")} })()`, c);
}
const text = (v) => JSON.stringify(v === undefined ? null : v);

const takeOut = (c) => {
  try {
    const o = vm.runInContext("__takeOut()", c, { timeout: 100 });
    return typeof o === "string" ? o : "";
  } catch { return ""; }
};

function load(req) {
  setup = req;
  try {
    script = new vm.Script(stripTypeScriptTypes(setup.code) + EXPORTS, { filename: "program.ts" });
  } catch (e) {
    loadError = short(e);
  }
  let o = "";
  if (!loadError) {
    // A trial run checks that the program loads and defines its entry points.
    const c = fresh();
    try {
      if (role === "bee") vm.runInContext("globalThis.MEMORY = {};", c);
      script.runInContext(c, { timeout: setup.ms * 10 });
      if (ENTRY.some((n) => vm.runInContext(`typeof __fns.${n}`, c, { timeout: setup.ms * 10 }) !== "function")) throw new Error(`program must define ${SIGNATURE}`);
    } catch (e) {
      loadError = timedOut(e) ? "Timeout: took too long to load" : short(e);
    }
    o = takeOut(c);
  }
  out(loadError ? { ok: false, e: loadError, out: o } : { ok: true, out: o });
}

/**
 * JSON text of a global of context c, encoded inside the context under `timeout` (hooks such as toJSON run
 * there, on the program's clock). Only a string comes out.
 */
function encode(c, name, what, timeout) {
  const s = vm.runInContext(`(() => { const r = globalThis.${name};
    if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error("${what} must not be async");
    let s; try { s = JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error("${what} returned something that is not plain data"); }
    return s === undefined ? "null" : s; })()`, c, { timeout });
  if (typeof s !== "string") throw new Error(`${what} returned something that is not plain data`);
  return s;
}

function callFlower(req) {
  if (loadError) return out({ e: "the program failed to load: " + loadError, cpu: 0 });
  const c = fresh();
  setGlobals(c, { __c: text(req.c) });
  const t0 = performance.now(), cpu0 = process.cpuUsage();
  const left = () => Math.max(1, Math.round(setup.ms - (performance.now() - t0)));
  try {
    // The flower's compute: its program, flower(challenge), and encoding the reply: all on the clock.
    script.runInContext(c, { timeout: setup.ms });
    if (vm.runInContext("typeof __fns.flower", c, { timeout: left() }) !== "function") throw new Error(`program must define ${SIGNATURE}`);
    vm.runInContext("globalThis.__r = __fns.flower(__c);", c, { timeout: left() });
    const s = encode(c, "__r", "flower", left());
    // The response's size: s is "[" + response + "," + percent + "]" when the flower returned a pair (a
    // percent that isn't a number is refused by the engine anyway).
    let bytes = null;
    if (s[0] === "[") {
      const comma = s.lastIndexOf(",");
      if (comma > 0) bytes = Buffer.byteLength(s) - 1 - Buffer.byteLength(s.slice(comma));
    }
    const cpu = cpuMs(cpu0);
    const cap = setup.maxResponseBytes || 1048576;
    if (bytes !== null && bytes > cap) return out({ e: `the response is ${bytes} bytes of JSON, over the cap of ${cap}`, cpu });
    if (bytes === null && Buffer.byteLength(s) > cap + 64) return out({ e: `flower returned something too large (over ${cap} bytes)`, cpu });
    return send(`{"cpu":${cpu},"bytes":${bytes},"v":${s}}`);
  } catch (e) {
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), cpu: cpuMs(cpu0) });
  }
}

/** MEMORY as JSON text, encoded in the context within `timeout`: { memory } or { memoryError }. */
function encodeMemory(c, timeout) {
  try {
    const m = encode(c, "MEMORY", "MEMORY", timeout);
    return m.length > 1 << 20 ? { memoryError: "MEMORY is far too large" } : { memory: m };
  } catch (e) {
    if (timedOut(e)) throw e;
    return { memoryError: short(e).replace("MEMORY returned something", "MEMORY is something") };
  }
}

function callBee(req) {
  if (loadError) return out({ e: "the program failed to load: " + loadError, out: "" });
  let c;
  if (req.op === "decide" && req.staged) {
    if (!staged) return out({ e: "the turn's arguments never arrived", out: "" });
    c = staged;
  } else {
    c = fresh();
    if (req.op === "decide") setGlobals(c, { __c: text(req.c), __r: text(req.r) });
  }
  staged = null;
  const limit = setup.limitMs || setup.ms;
  try {
    setGlobals(c, { MEMORY: typeof req.memory === "string" ? req.memory : "{}" });
  } catch (e) {
    return out({ e: "the bee's MEMORY could not be read", out: "" });
  }
  const t0 = performance.now();
  const rest = () => Math.max(1, Math.round(limit - (performance.now() - t0)));
  try {
    script.runInContext(c, { timeout: limit });
    if (ENTRY.some((n) => vm.runInContext(`typeof __fns.${n}`, c, { timeout: rest() }) !== "function")) throw new Error(`program must define ${SIGNATURE}`);
    const call = req.op === "first" ? "__fns.first()" : "__fns.decide(__c, __r)";
    vm.runInContext(`globalThis.__a = ${call};`, c, { timeout: rest() });
    const s = encode(c, "__a", req.op, rest());
    if (s.length > maxChars()) throw new Error(`${req.op} returned something too large`);
    const a = JSON.parse(s);
    const reply = { a, ...encodeMemory(c, rest()) };
    reply.out = takeOut(c);
    // A feed decision keeps its context for fed(nectar), if the program defines it.
    if (req.op === "decide" && (a === "feed" || (Array.isArray(a) && a.length === 2 && a[0] === "feed")) &&
        vm.runInContext("typeof __fns.fed", c, { timeout: rest() }) === "function") kept = c;
    return out(reply);
  } catch (e) {
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), out: takeOut(c) });
  }
}

function callFed(req) {
  const c = kept;
  kept = null;
  if (!c) return out({ skipped: true });
  const t0 = performance.now();
  const rest = () => Math.max(1, Math.round(setup.ms - (performance.now() - t0)));
  try {
    // The context has run the program's code, so nothing of it is trusted now: the nectar goes in as a literal.
    const nectar = typeof req.nectar === "number" && Number.isFinite(req.nectar) ? req.nectar : 0;
    vm.runInContext(`__fns.fed(${JSON.stringify(nectar)});`, c, { timeout: rest() });
    const reply = { ok: true, ...encodeMemory(c, rest()) };
    reply.out = takeOut(c);
    return out(reply);
  } catch (e) {
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), out: takeOut(c) });
  }
}

/** The next decide's context, made now: the stage request's own text is parsed in it (once, off the clock). */
function stage(line) {
  if (loadError) return out({ ok: true });
  const c = fresh();
  c.__in = line;
  vm.runInContext("(() => { const o = JSON.parse(globalThis.__in); delete globalThis.__in; globalThis.__c = o.c; globalThis.__r = o.r; })()", c);
  staged = c;
  return out({ ok: true });
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (setup && role === "bee" && line.startsWith('{"op":"stage",')) { // (the engine writes it so)
    kept = null;
    try { return stage(line); } catch (e) { staged = null; return out({ e: short(e) }); }
  }
  let req;
  try { req = JSON.parse(line); } catch { return out({ e: "unreadable request", out: "" }); }
  if (!setup) return load(req);
  if (role === "flower") return callFlower(req);
  if (req.op === "fed") return callFed(req);
  kept = null;
  return callBee(req);
});
