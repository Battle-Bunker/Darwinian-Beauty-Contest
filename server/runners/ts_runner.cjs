// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower | bee
// Both run statelessly: every call runs the program in a brand-new context (with its own unseeded
// Math.random and Date.now()), then calls flower(challenge), first() or decide(challenge, response).
// Nothing survives from one call to the next, except a bee's MEMORY, which the engine keeps and sends
// with every call.
// The code is the program's minified form (vendor/measure.js), so names can't carry data.
//
// Globals: GAME, HISTORY (the team's history: vendor/query/history.js, queried with its builder) and, for
// a bee, MEMORY (a JSON value).
//
// Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
// {code, ms, limitMs, game, maxChars, ledger}: `ledger` is the team's turn records so far.
// Requests (as in py_runner.py):
//   {op: "ledger", entries}              append turn records to HISTORY (between calls, never timed)
//   flower: {op: "call", c}              -> {v: [response, percent], cpu} | {e, cpu}
//   bee:    {op: "first", memory}        -> {a, out, memory} | {e, out}
//           {op: "decide", c, r, memory} -> {a, out, memory} | {e, out}
// HISTORY lives in a context of its own (the history realm), parsed, frozen and indexed as it arrives;
// every call gets the same read-only HISTORY object. Every built-in reachable from it is frozen and the
// realm's function constructors throw, so nothing a program does to it survives the call. The reply (and a
// bee's MEMORY) is encoded to JSON text inside the context, on the clock and under the time limit, so hooks
// (toJSON, getters, proxies) are the program's own compute; only a string leaves the context. A flower's
// `cpu` is this process's CPU time for running the program, calling flower() and encoding its reply (not
// for creating the context). Time limits are wall-clock: a flower is stopped at `ms`; a bee's `ms` is a
// deadline the engine keeps, so the runner only stops a bee at `limitMs`.
// Values cross context boundaries only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const readline = require("node:readline");
const { stripTypeScriptTypes } = require("node:module");

const HISTORY_JS = fs.readFileSync(path.join(__dirname, "..", "..", "vendor", "query", "history.js"), "utf8");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);
const timedOut = (e) => /timed out/i.test(short(e));
const role = process.argv[2];
const ENTRY = role === "bee" ? ["first", "decide"] : ["flower"];
const SIGNATURE = role === "bee" ? "function first() and function decide(challenge, response)" : "function flower(challenge)";

// Runs inside each program context before the program: captured console, GAME, and MEMORY for a bee.
const PRELUDE = (game) => `
(() => {
  const buf = [];
  let size = 0;
  Object.defineProperty(globalThis, "__takeOut", { value: () => { const o = buf.join("").slice(0, 2000); buf.length = 0; size = 0; return o; } });
  const log = (...a) => { if (size < 2000) { const s = a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\\n"; size += s.length; buf.push(s); } };
  globalThis.console = { log, error: log, warn: log, info: log };
  globalThis.GAME = Object.freeze(${JSON.stringify(game)});
})();`;

const EXPORTS = `;globalThis.__fns = { ${ENTRY.map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(", ")} };`;

const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });
const jsonArg = (v) => `JSON.parse(${JSON.stringify(JSON.stringify(v === undefined ? null : v))})`;
const cpuMs = (since) => { const u = process.cpuUsage(since); return (u.user + u.system) / 1000; };

// The history realm: the generated client, a Local history for the team, and a lockdown. append() parses
// and indexes new records; `history` is the read-only HISTORY every call gets.
const HISTORY_REALM = (team) => `(() => {
  "use strict";
  const DbcHistory = (() => { ${HISTORY_JS}; return DbcHistory; })();
  const local = DbcHistory.local([], ${JSON.stringify(team)});
  const api = { append(json) { local.append(JSON.parse(json)); }, history: local.history };
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
  for (const o of [function* () {}, async function () {}, async function* () {}, [][Symbol.iterator](), new Map()[Symbol.iterator](),
    new Set()[Symbol.iterator](), ""[Symbol.iterator](), /a/[Symbol.matchAll]("a"), Object.getPrototypeOf(Int8Array),
    Promise.resolve(), DbcHistory, api, globalThis]) harden(o);
  return api;
})()`;

let setup = null, script = null, loadError = null, realm = null;
const maxChars = () => setup.maxChars || 20000;

/** One run of the program in a fresh context: { c (context), fns? , error? }. */
function fresh(timeout) {
  const c = newContext();
  vm.runInContext(PRELUDE(setup.game), c);
  Object.defineProperty(c, "HISTORY", { value: realm.history, enumerable: true, writable: false, configurable: false });
  return c;
}

const takeOut = (c) => {
  try {
    const o = vm.runInContext("__takeOut()", c, { timeout: 100 });
    return typeof o === "string" ? o : "";
  } catch { return ""; }
};

function load(req) {
  setup = req;
  realm = vm.runInContext(HISTORY_REALM(setup.game.team ?? null), newContext());
  if (setup.ledger && setup.ledger.length) realm.append(JSON.stringify(setup.ledger));
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
      if (ENTRY.some((n) => vm.runInContext(`typeof __fns.${n}`, c) !== "function")) throw new Error(`program must define ${SIGNATURE}`);
    } catch (e) {
      loadError = timedOut(e) ? "Timeout: took too long to load" : short(e);
    }
    o = takeOut(c);
  }
  out(loadError ? { ok: false, e: loadError, out: o } : { ok: true, out: o });
}

function callFlower(req) {
  if (loadError) return out({ e: "the program failed to load: " + loadError, cpu: 0 });
  const c = fresh();
  vm.runInContext(`globalThis.__c = ${jsonArg(req.c)};`, c);
  const t0 = performance.now(), cpu0 = process.cpuUsage();
  const left = () => Math.max(1, Math.round(setup.ms - (performance.now() - t0)));
  try {
    // The flower's compute: its program, flower(challenge), and encoding the reply: all on the clock.
    script.runInContext(c, { timeout: setup.ms });
    if (vm.runInContext("typeof __fns.flower", c) !== "function") throw new Error(`program must define ${SIGNATURE}`);
    vm.runInContext("globalThis.__r = __fns.flower(__c);", c, { timeout: left() });
    const s = encode(c, "__r", "flower", left());
    const cpu = cpuMs(cpu0);
    if (s.length > maxChars()) return out({ e: `flower returned something too large (over ${maxChars()} characters)`, cpu });
    return out({ v: JSON.parse(s), cpu });
  } catch (e) {
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), cpu: cpuMs(cpu0) });
  }
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

function callBee(req) {
  if (loadError) return out({ e: "the program failed to load: " + loadError, out: "" });
  const c = fresh();
  const limit = setup.limitMs || setup.ms;
  const t0 = performance.now();
  try {
    vm.runInContext(`globalThis.MEMORY = ${req.memory === undefined || req.memory === null ? "{}" : jsonArg(JSON.parse(req.memory))};`, c);
    script.runInContext(c, { timeout: limit });
    if (ENTRY.some((n) => vm.runInContext(`typeof __fns.${n}`, c) !== "function")) throw new Error(`program must define ${SIGNATURE}`);
    const left = Math.max(1, Math.round(limit - (performance.now() - t0)));
    const call = req.op === "first" ? "__fns.first()" : `__fns.decide(${jsonArg(req.c)}, ${jsonArg(req.r)})`;
    vm.runInContext(`globalThis.__r = ${call};`, c, { timeout: left });
    const rest = () => Math.max(1, Math.round(limit - (performance.now() - t0)));
    const s = encode(c, "__r", req.op, rest());
    if (s.length > maxChars()) throw new Error(`${req.op} returned something too large`);
    const reply = { a: JSON.parse(s) };
    try {
      const m = encode(c, "MEMORY", "MEMORY", rest());
      if (m.length > 1 << 20) reply.memoryError = "MEMORY is too large";
      else reply.memory = m;
    } catch (e) {
      if (timedOut(e)) throw e;
      reply.memoryError = short(e).replace("MEMORY returned something", "MEMORY is something");
    }
    reply.out = takeOut(c);
    return out(reply);
  } catch (e) {
    return out({ e: timedOut(e) ? "Timeout: took too long" : short(e), out: takeOut(c) });
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const req = JSON.parse(line);
  if (!setup) return load(req);
  if (req.op === "ledger") {
    try { if (req.entries && req.entries.length) realm.append(JSON.stringify(req.entries)); } catch (e) { return out({ e: short(e) }); }
    return out({ ok: true });
  }
  return role === "flower" ? callFlower(req) : callBee(req);
});
