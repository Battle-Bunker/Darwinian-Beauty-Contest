// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower — stateless: every call runs the program in a brand-new context
//   node ts_runner.cjs bee    — stateful for one round: one context reused between calls, and
//                               earlier rounds' top-level variables arrive read-only as MEMORY
// Protocol: JSON lines on stdin/stdout. First line is the setup {code, ms, seed, game, maxChars, memory}.
// Values cross the context boundary only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const vm = require("node:vm");
const readline = require("node:readline");
const { stripTypeScriptTypes } = require("node:module");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);

// Runs inside each context before the program: deterministic Math.random, no clock, captured console,
// and (for bees) MEMORY rebuilt from earlier rounds' snapshots as deeply read-only values.
const PRELUDE = (seed, game, memory) => `
(() => {
  let s = ${seed >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const buf = [];
  globalThis.__out = buf;
  const log = (...a) => { if (buf.join("").length < 2000) buf.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\\n"); };
  globalThis.console = { log, error: log, warn: log, info: log };
  globalThis.GAME = Object.freeze(${JSON.stringify(game)});
  delete globalThis.Date;
  const readOnly = () => { throw new TypeError("MEMORY is read-only: copy it first, e.g. new Map(m), [...a] or {...o}"); };
  class FrozenMap extends Map {}
  FrozenMap.prototype.set = FrozenMap.prototype.delete = FrozenMap.prototype.clear = readOnly;
  class FrozenSet extends Set {}
  FrozenSet.prototype.add = FrozenSet.prototype.delete = FrozenSet.prototype.clear = readOnly;
  const thaw = (v) => {
    if (Array.isArray(v)) return Object.freeze(v.map(thaw));
    if (v && typeof v === "object") {
      if ("__dbc_map__" in v) { const m = new Map(v.__dbc_map__.map(([k, x]) => [thaw(k), thaw(x)])); Object.setPrototypeOf(m, FrozenMap.prototype); return Object.freeze(m); }
      if ("__dbc_set__" in v) { const m = new Set(v.__dbc_set__.map(thaw)); Object.setPrototypeOf(m, FrozenSet.prototype); return Object.freeze(m); }
      const o = {};
      for (const k of Object.keys(v)) o[k] = thaw(v[k]);
      return Object.freeze(o);
    }
    return v;
  };
  globalThis.MEMORY = Object.freeze(${JSON.stringify(memory || [])}.map((s) => (s === null ? null : thaw(JSON.parse(s)))));
  globalThis.__replacer = (k, v) => {
    if (v instanceof Map) return { __dbc_map__: [...v.entries()] };
    if (v instanceof Set) return { __dbc_set__: [...v] };
    if (typeof v === "function" || typeof v === "symbol") return undefined;
    if (typeof v === "bigint") return undefined;
    return v;
  };
})();`;

const EXPORTS = `;globalThis.__fns = { flower: typeof flower === "function" ? flower : undefined,
  forage: typeof forage === "function" ? forage : undefined, tasted: typeof tasted === "function" ? tasted : undefined };`;

// Top-level variables (declared at the start of a line) are what a bee keeps for later rounds.
const topLevelNames = (js) => [...new Set([...js.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))]
  .filter((n) => !["GAME", "MEMORY"].includes(n));

const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });

function encodeCall(name, argsExpr) {
  return `(() => { const r = __fns.${name}(...${argsExpr});
    if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error("${name} must not be async");
    let s; try { s = JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error("response is not plain data"); }
    const o = __out.join(""); __out.length = 0; return JSON.stringify({ s, o }); })()`;
}
const jsonArgs = (args) => `JSON.parse(${JSON.stringify(JSON.stringify(args))})`;

const lines = readline.createInterface({ input: process.stdin });
let setup = null, script = null, ctx = null, loadError = null, names = [];
const maxChars = () => setup.maxChars || 20000;

lines.on("line", (line) => {
  const req = JSON.parse(line);
  if (!setup) {
    setup = req;
    try {
      const js = stripTypeScriptTypes(setup.code);
      names = topLevelNames(js);
      script = new vm.Script(js + EXPORTS, { filename: "program.ts" });
    } catch (e) {
      loadError = short(e);
    }
    if (process.argv[2] === "bee" && !loadError) {
      try {
        ctx = newContext();
        vm.runInContext(PRELUDE(setup.seed || 0, setup.game, setup.memory), ctx);
        vm.runInContext("globalThis.__seen = [];", ctx);
        script.runInContext(ctx, { timeout: setup.ms * 10 });
        if (vm.runInContext("typeof __fns.forage", ctx) !== "function") throw new Error("program must define function forage(seen, turnsLeft)");
      } catch (e) {
        loadError = short(e);
      }
    }
    out(loadError ? { ok: false, e: loadError } : { ok: true });
    return;
  }
  if (loadError) return out({ e: "program failed to load: " + loadError });
  try {
    if (process.argv[2] === "flower") {
      const c = newContext();
      vm.runInContext(PRELUDE(0, setup.game, []), c);
      script.runInContext(c, { timeout: setup.ms });
      if (vm.runInContext("typeof __fns.flower", c) !== "function") throw new Error("program must define function flower(challenge)");
      // The remaining budget isn't tracked separately: module setup + call each get the full budget.
      const r = JSON.parse(vm.runInContext(encodeCall("flower", jsonArgs([req.c])), c, { timeout: setup.ms }));
      if (r.s && r.s.length > maxChars()) throw new Error(`response too large (over ${maxChars()} characters)`);
      return out({ v: JSON.parse(r.s) });
    }
    if (req.op === "forage") {
      // `seen` lives inside the context and grows one step at a time; forage gets a copy.
      vm.runInContext(`(() => { if (${!!req.new}) __seen = []; const st = ${req.step == null ? "null" : jsonArgs(req.step)}; if (st) __seen.push(st); })()`, ctx);
      const args = `[__seen.slice(), ${JSON.stringify(req.turns)}, ...(__fns.forage.length >= 3 ? [${jsonArgs(req.visit)}] : [])]`;
      const r = JSON.parse(vm.runInContext(encodeCall("forage", args), ctx, { timeout: setup.ms }));
      if (r.s && r.s.length > maxChars()) throw new Error("forage returned something too large");
      return out({ a: JSON.parse(r.s), out: r.o });
    }
    if (req.op === "tasted") {
      if (vm.runInContext("typeof __fns.tasted", ctx) !== "function") return out({ ok: true, out: "" });
      const r = JSON.parse(vm.runInContext(encodeCall("tasted", `[__seen.slice(), ${JSON.stringify(!!req.nectar)}]`), ctx, { timeout: setup.ms }));
      return out({ ok: true, out: r.o });
    }
    if (req.op === "snapshot") {
      const body = names.map((n) => `try { if (typeof ${n} !== "function") o[${JSON.stringify(n)}] = ${n}; } catch (e) {}`).join("\n");
      const snap = vm.runInContext(`(() => { const o = {};\n${body}\nreturn JSON.stringify(o, __replacer); })()`, ctx, { timeout: 5000 });
      if (snap.length > req.maxBytes) return out({ snap: null, note: `memory is over ${Math.floor(req.maxBytes / 1024)} KB, so nothing was kept this round` });
      return out({ snap, note: null });
    }
  } catch (e) {
    const msg = /timed out/i.test(short(e)) ? "Timeout: took too long" : short(e);
    let o = "";
    try { if (ctx) o = vm.runInContext("(() => { const o = __out.join(''); __out.length = 0; return o; })()", ctx); } catch {}
    out({ e: msg, out: o });
  }
});
