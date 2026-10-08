// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower | bee
// Every call runs the program in a brand-new context (with its own unseeded Math.random and Date.now()),
// then calls flower(challenge), first() or decide(challenge, response). After a bee's decide() returns a
// feed, its context is kept for one more call, fed(nectar), if the program defines it: the same instance,
// with every global it had; then it is dropped. Nothing else survives from one call to the next, except a
// bee's MEMORY, which the engine keeps and sends with every call.
// The code is the program's minified form (vendor/measure.js), so names can't carry data.
//
// Globals: GAME and, for a bee, MEMORY (a key-value store). Date, Intl and performance read the game's
// clock: every call's clock reads 0 as its time starts (PRELUDE).
//
// Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
// {code, ms, limitMs, wallMs, hardWallMs, faultShare, game, maxChars, maxResponseBytes}. Requests (as in py_runner.py):
//   flower: {op: "call", c, ms: R}        -> {v: [response, percent], bytes, cpu} | {e, cpu, backstop?, fault?}
//           R is the call's hidden time budget: its CPU limit, and GAME.ms for the call
//   bee:    {op: "first", memory}         -> {a, cpu, out, memory} | {e, cpu, out, backstop?, fault?}
//           {op: "stage", c, r}           -> {ok}: the next decide's fresh context, its arguments read in
//           {op: "decide", staged: true, memory} (or with c and r) -> as first
//           {op: "fed", nectar}           -> {ok, a?, aError?, cpu, out, memory} | {e, out} | {skipped}
//           (a: what fed returned unless null or undefined, the next challenge for the engine to check;
//           aError instead when that isn't plain data or is too large: MEMORY is still saved)
//   Before its reply, a bee's first or decide may send one notice line: {notice: "late"} (it has used its ms of
//   CPU) or {notice: "fault"} (at wallMs it had spent most of its time waiting for a CPU).
// Any request other than fed drops a kept context. The reply (and a bee's MEMORY) is encoded to JSON text
// inside the context, on the clock and under the time limit, so hooks (toJSON, getters, proxies) are the
// program's own compute; only a string leaves the context. `cpu` is the main thread's CPU time for running
// the program, calling it and encoding its reply (not for creating the context; not V8's other threads); a
// flower's response's UTF-8 size (`bytes`) must be at most maxResponseBytes. Limits are CPU time: a flower is
// stopped at R, fed at ms, a bee's first and decide at limitMs (it is late past ms). wallMs (hardWallMs for
// first and decide) is a wall-clock backstop: a call still going then is stopped, and is the server's fault
// if it spent at least faultShare of that time waiting for a CPU.
// Values cross context boundaries only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { execFileSync } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { stripTypeScriptTypes } = require("node:module");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const send = (line) => process.stdout.write(line + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);
const timedOut = (e) => /timed out/i.test(short(e));
const role = process.argv[2];
const ENTRY = role === "bee" ? ["first", "decide"] : ["flower"];
const OPTIONAL = role === "bee" ? ["fed"] : [];
const SIGNATURE = role === "bee" ? "function first() and function decide(challenge, response)" : "function flower(challenge)";

// Runs inside each program context before the program: captured console, GAME and the game's clock. The
// console keeps its output as one string, read back with intrinsics captured here, so reading it runs no
// program code. FinalizationRegistry is removed: its callbacks would run between calls, off the clock.
// The clock: Date (now, new Date(), Date()), Intl date formatting without a date, and performance all read
// the time since the call started (__startClock, called by the runner as each call's time starts), as if
// it began at the Unix epoch. Its source is the host's high-resolution clock (__hr), kept in this closure
// only: the program can't reach it, nor the real Date constructor (Date.prototype.constructor is the
// game's Date).
const PRELUDE = (game) => `
(() => {
  "use strict";
  const apply = Reflect.apply, construct = Reflect.construct, slice = String.prototype.slice, stringify = JSON.stringify;
  const floor = Math.floor, define = Object.defineProperty, describe = Object.getOwnPropertyDescriptor;
  const hr = globalThis.__hr, cpu = globalThis.__cpu;
  delete globalThis.__hr;
  delete globalThis.__cpu;
  let origin = hr(), cpuOrigin = cpu();
  const now = () => hr() - origin;
  const nowMs = () => floor(hr() - origin);
  define(globalThis, "__startClock", { value: () => { origin = hr(); cpuOrigin = cpu(); } });
  // Nothing to wait for: limits are CPU time, and waiting earns nothing. Atomics.wait returns at once.
  const load = Atomics.load;
  define(Atomics, "wait", { value: function wait(ta, i, v) { return load(ta, i) !== v ? "not-equal" : "timed-out"; }, writable: true, configurable: true });
  const RealDate = globalThis.Date, toString = RealDate.prototype.toString;
  const GameDate = function Date(...args) {
    if (new.target === undefined) return apply(toString, construct(RealDate, [nowMs()]), []);
    return construct(RealDate, args.length ? args : [nowMs()], new.target);
  };
  define(GameDate, "prototype", { value: RealDate.prototype, writable: false, enumerable: false, configurable: false });
  define(GameDate, "length", { value: 7 });
  for (const k of ["parse", "UTC"]) define(GameDate, k, { value: RealDate[k], writable: true, configurable: true });
  define(GameDate, "now", { value: function now() { return nowMs(); }, writable: true, configurable: true });
  define(RealDate.prototype, "constructor", { value: GameDate, writable: true, configurable: true });
  define(globalThis, "Date", { value: GameDate, writable: true, configurable: true });
  const DTF = Intl.DateTimeFormat.prototype, format = describe(DTF, "format").get, toParts = DTF.formatToParts;
  define(DTF, "format", { get() { const f = apply(format, this, []); return (d) => f(d === undefined ? nowMs() : d); }, configurable: true });
  define(DTF, "formatToParts", { value: function formatToParts(d) { return apply(toParts, this, [d === undefined ? nowMs() : d]); }, writable: true, configurable: true });
  define(globalThis, "performance", { value: Object.freeze({ now() { return now(); }, cpuTime() { return cpu() - cpuOrigin; }, timeOrigin: 0, toJSON() { return { timeOrigin: 0 }; } }), writable: true, configurable: true });
  let text = "";
  Object.defineProperty(globalThis, "__takeOut", { value: () => { const o = text; text = ""; return o.length > 2000 ? apply(slice, o, [0, 2000]) : o; } });
  const log = (...a) => { if (text.length < 2000) text += a.map((x) => typeof x === "string" ? x : stringify(x)).join(" ") + "\\n"; };
  globalThis.console = { log, error: log, warn: log, info: log };
  globalThis.GAME = Object.freeze(${JSON.stringify(game)});
  delete globalThis.FinalizationRegistry;
})();`;

const EXPORTS = `;globalThis.__fns = { ${[...ENTRY, ...OPTIONAL].map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(", ")} };`;

const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });

// CPU-time budgets (docs/research/compute-budgets/REPORT.md §4.2). A call's budget is the main thread's CPU
// time (process.threadCpuUsage: V8's background compiler and GC threads aren't the program's). A call is one
// script, run with breakOnSigint, in which everything of the program runs (its top level, nested; its function;
// encoding its reply). The script marks its own start and end (call.k, host functions it takes from a
// property it deletes before any program code runs): only in between is the main thread surely inside a
// breakOnSigint script, so only then may the watchdog thread send SIGINT (elsewhere one could end the process).
// The watchdog reads the main thread's CPU from /proc (stale by up to a tick, never ahead) and sends SIGINT once
// the call's budget is used, or once its wall-clock backstop is up. For a bee it also sends the engine
// notices: "late" at its ms of CPU; at the judging wall time "late" or "fault" (most of the call's time was
// spent waiting for a CPU). It acts only while the state is RUNNING, holding it at BUSY meanwhile; the script's
// end waits for it, so nothing of one call reaches the next.
// The exact thread CPU clock: native/cpuclock.c, built here on first use (Node's own threadCpuUsage() is stale
// by up to a scheduler tick for a running thread, too coarse for budgets of a few ms).
function loadClock() {
  const dir = path.join(__dirname, "native");
  const file = path.join(dir, `cpuclock-${process.platform}-${process.arch}-${process.versions.modules}.node`);
  try { return { file, clock: require(file) }; } catch {}
  const tmp = `${file}.${process.pid}.tmp`;
  for (const cc of ["gcc", "cc", "clang"]) {
    try {
      execFileSync(cc, ["-O2", "-shared", "-fPIC", `-I${path.join(path.dirname(process.execPath), "..", "include", "node")}`, "-o", tmp, path.join(dir, "cpuclock.c")],
        { stdio: "ignore", timeout: 60000 });
      fs.renameSync(tmp, file);
      return { file, clock: require(file) };
    } catch {}
  }
  try { fs.unlinkSync(tmp); } catch {}
  process.stderr.write("ts_runner: no exact thread CPU clock (native/cpuclock.c didn't build); using threadCpuUsage()\n");
  return { file: null, clock: null };
}
const NATIVE = loadClock();
const threadMs = NATIVE.clock ? NATIVE.clock.threadCpuMs : () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };
const MAIN_CLOCK = NATIVE.clock ? NATIVE.clock.clockId() : null;
const SCHEDSTAT = `/proc/self/task/${process.pid}/schedstat`;
/** [CPU ms, ms spent runnable but waiting for a CPU] of the main thread, from /proc (tick-stale). */
const schedstat = () => { try { const [c, w] = fs.readFileSync(SCHEDSTAT, "latin1").split(" "); return [Number(c) / 1e6, Number(w) / 1e6]; } catch { return [0, 0]; } };
const wallMs = () => Number(process.hrtime.bigint()) / 1e6;
const IDLE = 0, RUNNING = 1, BUSY = 2;
const CTL = new SharedArrayBuffer(96);
const I = new Int32Array(CTL, 0, 4);   // [state, SIGINTs sent, (unused), call number]
// [stop at CPU ms, notice at CPU ms (0: none), start wall ms, judge at wall ms (0: none), wait ms at start, fault share, stop at wall ms]
const F = new Float64Array(CTL, 16, 8);
const WATCHDOG = `
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const I = new Int32Array(workerData.ctl, 0, 4), F = new Float64Array(workerData.ctl, 16, 8);
const stat = () => { try { const [c, w] = fs.readFileSync(workerData.path, "latin1").split(" "); return [Number(c) / 1e6, Number(w) / 1e6]; } catch { return [0, 0]; } };
// The main thread's CPU: exact through the native clock, else /proc (stale by up to a tick, never ahead).
const C = workerData.clock ? require(workerData.clock) : null;
const read = C ? () => { const [, w] = stat(); return [C.cpuMsOf(workerData.id) ?? 0, w]; } : stat;
const wallMs = () => Number(process.hrtime.bigint()) / 1e6;
const hold = () => Atomics.compareExchange(I, 0, 1, 2) === 1;          // RUNNING -> BUSY, if still inside the call's script
const release = () => { Atomics.store(I, 0, 1); Atomics.notify(I, 0); };
const interrupt = () => { if (hold()) { try { process.kill(process.pid, "SIGINT"); Atomics.add(I, 1, 1); } finally { release(); } } };
const notice = (kind) => { if (hold()) { try { fs.writeSync(1, '{"notice":"' + kind + '"}\\n'); } finally { release(); } } };
let noticed = -1, stopped = -1, walled = -1;
for (;;) {
  if (Atomics.load(I, 0) === 0) { Atomics.wait(I, 0, 0, 1000); continue; }
  const call = Atomics.load(I, 3);
  const [cpu, wait] = read();
  const wall = wallMs() - F[2];
  if (cpu >= F[0] && stopped !== call) { stopped = call; interrupt(); continue; }   // its CPU budget is used
  if (wall >= F[6] && walled !== call) { walled = call; interrupt(); continue; }    // its wall backstop is up
  // A bee: late at its ms of CPU; else judged at its wall time: the server's fault if it spent most of it
  // waiting for a CPU, else late. One notice a call.
  if (F[1] && cpu >= F[1] && noticed !== call) { noticed = call; notice("late"); }
  if (F[3] && wall >= F[3] && noticed !== call) { noticed = call; notice((wait - F[4]) >= F[5] * wall ? "fault" : "late"); }
  // Wall time can't pass slower than CPU time: wait for the CPU left, or the next wall-clock mark.
  let next = F[6] - wall;
  if (stopped !== call) next = Math.min(next, F[0] - cpu);
  if (noticed !== call && F[1]) next = Math.min(next, F[1] - cpu);
  if (noticed !== call && F[3]) next = Math.min(next, F[3] - wall);
  Atomics.wait(I, 0, 1, Math.max(0.25, Math.min(next, 50)));
}`;
function startWatchdog() {
  const w = new Worker(WATCHDOG, { eval: true, workerData: { ctl: CTL, path: SCHEDSTAT, clock: NATIVE.file, id: MAIN_CLOCK } });
  w.unref();
  w.on("error", (e) => process.stderr.write(`watchdog: ${short(e)}\n`));
}
process.on("SIGINT", () => {}); // a stray SIGINT that lands between scripts is harmless

/**
 * A call's limits: stopped at `budget` ms of CPU, or at `wallStop` ms of wall time; a bee: a notice at `soft`
 * ms of CPU, judged at `judge` ms of wall time. `run` runs the program's top level in context c.
 */
function begin(c, budget, wallStop, soft = 0, judge = 0) {
  const call = { budget, wallStop };
  const share = setup.faultShare || 0.5;
  call.k = Object.freeze({
    __proto__: null,
    enter() {
      const [, wait0] = schedstat(), w0 = wallMs();
      const c0 = threadMs();
      Object.assign(call, { c0, w0, wait0 });
      F[0] = c0 + budget; F[1] = soft ? c0 + soft : 0; F[2] = w0; F[3] = judge; F[4] = wait0; F[5] = share; F[6] = wallStop;
      Atomics.add(I, 3, 1);
      Atomics.store(I, 0, RUNNING);
      Atomics.notify(I, 0);
    },
    leave() {
      call.c1 = threadMs();
      release(call);
    },
    run() { script.runInContext(c); },
    done(...vals) { call.result = vals; },
    sig: SIGNATURE,
    max: setup.maxChars || 20000,
  });
  return call;
}

/** Leave the RUNNING state, once (waiting while the watchdog is mid-signal or mid-notice). */
function release(call) {
  if (call.released) return;
  call.released = true;
  while (Atomics.compareExchange(I, 0, RUNNING, IDLE) !== RUNNING) {
    if (Atomics.load(I, 0) === IDLE) break;
    Atomics.wait(I, 0, BUSY, 5);
  }
}

// The call's script: it takes call.k from a property it deletes first (defined, not assigned, so no setter
// of the program's runs), marks its start and end, and runs `body` (which may use k) in between. The program's
// clock (and its performance.cpuTime()) starts with the call's budget.
const KEY = "__dbcCall";
function inCall(c, call, body) {
  Object.defineProperty(c, KEY, { value: call.k, configurable: true, writable: false, enumerable: false });
  return vm.runInContext(`(() => { const k = globalThis.${KEY}; delete globalThis.${KEY}; k.enter(); __startClock(); try { ${body} } finally { k.leave(); } })()`,
    c, { breakOnSigint: true });
}

/** The call's CPU time in ms: from its script's start to its end (or to now, if it was stopped). */
function cpuOf(call) {
  release(call);
  return (call.c1 ?? threadMs()) - (call.c0 ?? threadMs());
}

// Inside a call's script: JSON text of a value (hooks such as toJSON run here, on the program's clock).
const ENC = `const enc = (r, what) => {
    if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error(what + " must not be async");
    let s; try { s = JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error(what + " returned something that is not plain data"); }
    if (typeof s !== "string" && s !== undefined) throw new Error(what + " returned something that is not plain data");
    return s === undefined ? "null" : s; };`;
// ... and MEMORY's: [text, null] or [null, why it isn't plain data].
const ENC_MEMORY = `const encMemory = () => { try { const m = enc(globalThis.MEMORY, "MEMORY");
    return m.length > 1048576 ? [null, "MEMORY is far too large"] : [m, null]; }
    catch (e) { return [null, String(e && e.message).replace("MEMORY returned something", "MEMORY is something")]; } };`;

const interrupted = (e) => /interrupted/i.test(short(e));
/** What a call that threw ends with: stopped at its CPU budget, at the wall backstop (late, or the server's fault), or an error. */
function failure(e, call) {
  const [, waitNow] = schedstat();
  const cpu = cpuOf(call);
  if (!interrupted(e)) return { e: short(e), cpu };
  if (cpu >= call.budget - 0.05) return { e: "Timeout: took too long", cpu };
  const wall = wallMs() - (call.w0 ?? wallMs()), wait = waitNow - (call.wait0 ?? waitNow);
  if (wall < call.wallStop - 1) return { e: "server fault: interrupted before its time was up", cpu, fault: true }; // (a stray SIGINT)
  const fault = wait >= (setup.faultShare || 0.5) * wall;
  return fault
    ? { e: `server fault: it waited ${Math.round(wait)} ms of ${Math.round(wall)} ms for a CPU, and ran ${cpu.toFixed(1)} ms`, cpu, backstop: true, fault: true }
    : { e: `Timeout: still running after ${Math.round(wall)} ms of wall time (${cpu.toFixed(1)} ms of CPU)`, cpu, backstop: true, fault: false };
}

let setup = null, script = null, loadError = null;
let staged = null; // the next decide's context, its arguments already read in
let kept = null;   // the context of a feed decision, kept for fed()
const maxChars = () => setup.maxChars || 20000;

const hostNow = () => performance.now();

/** A fresh context with the prelude run. */
function fresh(game = setup.game) {
  const c = newContext();
  c.__hr = hostNow; // taken into the prelude's closure, and deleted from the context
  c.__cpu = threadMs; // (this thread's CPU time, ms: the clock budgets and energy count)
  vm.runInContext(PRELUDE(game), c);
  return c;
}

/** The program's clock reads 0 from now (each call's time starts). */
const startClock = (c) => vm.runInContext("__startClock()", c);

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
    const o = vm.runInContext("__takeOut()", c); // (the prelude's own function: not writable, not the program's)
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

function callFlower(req) {
  if (loadError) return out({ e: "the program failed to load: " + loadError, cpu: 0 });
  // R, this call's hidden time budget: its CPU limit, and GAME.ms for the call (at most the flower window).
  const budget = typeof req.ms === "number" && req.ms > 0 ? Math.min(setup.ms, req.ms) : setup.ms;
  const c = fresh({ ...setup.game, ms: budget });
  setGlobals(c, { __c: text(req.c) });
  startClock(c);
  const call = begin(c, budget, setup.wallMs || 400);
  try {
    // The flower's compute: its program, flower(challenge), and encoding the reply: all on the clock.
    const s = inCall(c, call, `${ENC}
      k.run();
      if (typeof __fns.flower !== "function") throw new Error("program must define " + k.sig);
      globalThis.__r = __fns.flower(__c);
      return enc(globalThis.__r, "flower");`);
    const cpu = cpuOf(call);
    if (typeof s !== "string") throw new Error("flower returned something that is not plain data");
    // The response's size: s is "[" + response + "," + percent + "]" when the flower returned a pair (a
    // percent that isn't a number is refused by the engine anyway).
    let bytes = null;
    if (s[0] === "[") {
      const comma = s.lastIndexOf(",");
      if (comma > 0) bytes = Buffer.byteLength(s) - 1 - Buffer.byteLength(s.slice(comma));
    }
    const cap = setup.maxResponseBytes || 1048576;
    if (bytes !== null && bytes > cap) return out({ e: `the response is ${bytes} bytes of JSON, over the cap of ${cap}`, cpu });
    if (bytes === null && Buffer.byteLength(s) > cap + 64) return out({ e: `flower returned something too large (over ${cap} bytes)`, cpu });
    return send(`{"cpu":${cpu},"bytes":${bytes},"v":${s}}`);
  } catch (e) {
    return out(failure(e, call));
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
  startClock(c);
  // first and decide: late at ms of CPU (a notice), judged at wallMs, stopped at the hard limit (CPU) or hardWallMs.
  const call = begin(c, limit, setup.hardWallMs || Math.max(4000, 2 * limit), setup.ms, setup.wallMs || 250);
  try {
    const fn = req.op === "first" ? "__fns.first()" : "__fns.decide(__c, __r)";
    inCall(c, call, `${ENC} ${ENC_MEMORY}
      k.run();
      if (typeof __fns.first !== "function" || typeof __fns.decide !== "function") throw new Error("program must define " + k.sig);
      globalThis.__a = ${fn};
      const s = enc(globalThis.__a, ${JSON.stringify(req.op)});
      if (s.length > k.max) throw new Error(${JSON.stringify(req.op + " returned something too large")});
      const [m, me] = encMemory();
      k.done(s, m, me, ${req.op === "decide"} && typeof __fns.fed === "function");`);
    const cpu = cpuOf(call);
    const [s, m, me, fedFn] = call.result ?? [];
    if (typeof s !== "string") throw new Error(`${req.op} returned something that is not plain data`);
    const a = JSON.parse(s);
    const reply = { a, ...(typeof m === "string" ? { memory: m } : { memoryError: String(me ?? "MEMORY could not be read") }), cpu, out: takeOut(c) };
    // A feed decision keeps its context for fed(nectar), if the program defines it.
    if (req.op === "decide" && fedFn === true && (a === "feed" || (Array.isArray(a) && a.length === 2 && a[0] === "feed"))) kept = c;
    return out(reply);
  } catch (e) {
    return out({ ...failure(e, call), out: takeOut(c) });
  }
}

function callFed(req) {
  const c = kept;
  kept = null;
  if (!c) return out({ skipped: true });
  try { startClock(c); } catch { return out({ e: "the bee's clock could not be started", out: "" }); }
  const call = begin(c, setup.ms, setup.wallMs || 250); // fed: stopped at ms of CPU
  try {
    // The context has run the program's code, so nothing of it is trusted now: the nectar goes in as a literal.
    const nectar = typeof req.nectar === "number" && Number.isFinite(req.nectar) ? req.nectar : 0;
    inCall(c, call, `${ENC} ${ENC_MEMORY}
      globalThis.__a = __fns.fed(${JSON.stringify(nectar)});
      let s = null, ae = null;
      if (globalThis.__a !== undefined && globalThis.__a !== null) {
        try { s = enc(globalThis.__a, "fed"); if (s.length > k.max) { s = null; ae = "fed returned something too large"; } }
        catch (e) { ae = String(e && e.message); }
      }
      const [m, me] = encMemory();
      k.done(s, ae, m, me);`);
    const cpu = cpuOf(call);
    const [s, ae, m, me] = call.result ?? [];
    const reply = { ok: true };
    if (typeof s === "string") reply.a = JSON.parse(s);
    else if (ae !== null && ae !== undefined) reply.aError = String(ae).slice(0, 300);
    Object.assign(reply, typeof m === "string" ? { memory: m } : { memoryError: String(me ?? "MEMORY could not be read") });
    reply.cpu = cpu;
    reply.out = takeOut(c);
    return out(reply);
  } catch (e) {
    return out({ ...failure(e, call), out: takeOut(c) });
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

// One request at a time. Before a call's scripts start, any SIGINT sent for an earlier call is let through
// (to the listener above), so it can't stop this one.
let drained = 0;
const settle = () => new Promise((r) => setTimeout(r, 1));
async function handle(line) {
  if (setup && Atomics.load(I, 1) !== drained) { await settle(); await settle(); drained = Atomics.load(I, 1); }
  if (setup && role === "bee" && line.startsWith('{"op":"stage",')) { // (the engine writes it so)
    kept = null;
    try { return stage(line); } catch (e) { staged = null; return out({ e: short(e) }); }
  }
  let req;
  try { req = JSON.parse(line); } catch { return out({ e: "unreadable request", out: "" }); }
  if (!setup) { startWatchdog(); return load(req); }
  if (role === "flower") return callFlower(req);
  if (req.op === "fed") return callFed(req);
  kept = null;
  return callBee(req);
}
let queue = Promise.resolve();
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => { queue = queue.then(() => handle(line)).catch((e) => out({ e: short(e), out: "" })); });
