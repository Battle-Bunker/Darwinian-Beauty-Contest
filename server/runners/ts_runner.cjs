// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower — stateless: every call runs the program in a brand-new context
//   node ts_runner.cjs bee    — stateful for one round: one context reused between calls
// Protocol: JSON lines on stdin/stdout. First line is the setup {code, ms, seed, game}.
// Values cross the context boundary only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const vm = require("node:vm");
const readline = require("node:readline");
const { stripTypeScriptTypes } = require("node:module");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);

// Runs inside each context before the program: deterministic Math.random, no clock, captured console.
const PRELUDE = (seed, game) => `
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
})();`;

const EXPORTS = `;globalThis.__fns = { flower: typeof flower === "function" ? flower : undefined,
  forage: typeof forage === "function" ? forage : undefined, tasted: typeof tasted === "function" ? tasted : undefined };`;

const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });

function encodeCall(name, args) {
  return `(() => { const r = __fns.${name}(...JSON.parse(${JSON.stringify(JSON.stringify(args))}));
    if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error("${name} must not be async");
    let s; try { s = JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error("response is not plain data"); }
    const o = __out.join(""); __out.length = 0; return JSON.stringify({ s, o }); })()`;
}

const lines = readline.createInterface({ input: process.stdin });
let setup = null, script = null, ctx = null, loadError = null;

lines.on("line", (line) => {
  const req = JSON.parse(line);
  if (!setup) {
    setup = req;
    try {
      script = new vm.Script(stripTypeScriptTypes(setup.code) + EXPORTS, { filename: "program.ts" });
    } catch (e) {
      loadError = short(e);
    }
    if (process.argv[2] === "bee" && !loadError) {
      try {
        ctx = newContext();
        vm.runInContext(PRELUDE(setup.seed || 0, setup.game), ctx);
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
      vm.runInContext(PRELUDE(0, setup.game), c);
      script.runInContext(c, { timeout: setup.ms });
      if (vm.runInContext("typeof __fns.flower", c) !== "function") throw new Error("program must define function flower(challenge)");
      // The remaining budget isn't tracked separately: module setup + call each get the full budget.
      const r = JSON.parse(vm.runInContext(encodeCall("flower", [req.c]), c, { timeout: setup.ms }));
      if (r.s && r.s.length > 20000) throw new Error("response too large");
      return out({ v: JSON.parse(r.s) });
    }
    if (req.op === "forage") {
      const r = JSON.parse(vm.runInContext(encodeCall("forage", [req.seen, req.turns]), ctx, { timeout: setup.ms }));
      return out({ a: JSON.parse(r.s), out: r.o });
    }
    if (req.op === "tasted") {
      if (vm.runInContext("typeof __fns.tasted", ctx) !== "function") return out({ ok: true, out: "" });
      const r = JSON.parse(vm.runInContext(encodeCall("tasted", [req.seen, req.nectar]), ctx, { timeout: setup.ms }));
      return out({ ok: true, out: r.o });
    }
  } catch (e) {
    const msg = /timed out/i.test(short(e)) ? "Timeout: took too long" : short(e);
    let o = "";
    try { if (ctx) o = vm.runInContext("(() => { const o = __out.join(''); __out.length = 0; return o; })()", ctx); } catch {}
    out({ e: msg, out: o });
  }
});
