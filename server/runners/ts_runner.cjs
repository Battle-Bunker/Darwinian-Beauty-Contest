// TypeScript runner for Darwinian Beauty Contest programs (types are stripped, then run in a vm).
//   node ts_runner.cjs flower — stateless: every call runs the program in a brand-new context, with
//                               the context's own (unseeded) Math.random and Date.now(), so a flower
//                               can run an anytime search until its budget (GAME.ms) is nearly spent.
//   node ts_runner.cjs bee    — stateful: one context reused between calls for as long as this
//                               version of the bee plays (until its team submits a new bee, or it
//                               crashes), with the context's own unseeded Math.random.
// The code is the program's minified form (vendor/measure.js), so names can't carry data.
// Protocol: JSON lines on stdin/stdout. First line is the setup {code, ms, limitMs, game, maxChars}.
// A flower is stopped at its budget, `ms`. A bee's budget is a deadline the engine keeps (a late reply
// still counts, for the next turn), so the runner only stops a bee call at the hard limit `limitMs`.
// Bee requests: {op: "forage", new: reset seen, step: [c, r] to append, tasted: nectar after a feed
// (then tasted(seen, nectar) runs first, in the same call), visit: {...}}.
// Values cross the context boundary only as JSON strings, so no host objects leak in.
// NOT a security sandbox: fresh contexts + timeouts + heap cap only.
"use strict";
const vm = require("node:vm");
const readline = require("node:readline");
const { stripTypeScriptTypes } = require("node:module");

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const short = (e) => String((e && e.message) || e).slice(0, 300);

// Runs inside each context before the program: captured console and GAME.
const PRELUDE = (game) => `
(() => {
  const buf = [];
  globalThis.__out = buf;
  const log = (...a) => { if (buf.join("").length < 2000) buf.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\\n"); };
  globalThis.console = { log, error: log, warn: log, info: log };
  globalThis.GAME = Object.freeze(${JSON.stringify(game)});
})();`;

const EXPORTS = `;globalThis.__fns = { flower: typeof flower === "function" ? flower : undefined,
  forage: typeof forage === "function" ? forage : undefined, tasted: typeof tasted === "function" ? tasted : undefined };`;


const newContext = () => vm.createContext(Object.create(null), { microtaskMode: "afterEvaluate", codeGeneration: { strings: true, wasm: false } });

function encodeCall(name, argsExpr) {
  return `(() => { const r = __fns.${name}(...${argsExpr});
    if (r !== undefined && r !== null && typeof r === "object" && typeof r.then === "function") throw new Error("${name} must not be async");
    let s; try { s = JSON.stringify(r === undefined ? null : r); } catch (e) { throw new Error("response is not plain data"); }
    const o = __out.join(""); __out.length = 0; return JSON.stringify({ s, o }); })()`;
}
const jsonArgs = (args) => `JSON.parse(${JSON.stringify(JSON.stringify(args))})`;

const lines = readline.createInterface({ input: process.stdin });
let setup = null, script = null, ctx = null, loadError = null;
const maxChars = () => setup.maxChars || 20000;
const limit = () => setup.limitMs || setup.ms; // a bee call's hard stop

lines.on("line", (line) => {
  const req = JSON.parse(line);
  if (!setup) {
    setup = req;
    try {
      const js = stripTypeScriptTypes(setup.code);
      script = new vm.Script(js + EXPORTS, { filename: "program.ts" });
    } catch (e) {
      loadError = short(e);
    }
    if (process.argv[2] === "bee" && !loadError) {
      try {
        ctx = newContext();
        vm.runInContext(PRELUDE(setup.game), ctx);
        vm.runInContext("globalThis.__seen = [];", ctx);
        script.runInContext(ctx, { timeout: setup.ms * 10 });
        if (vm.runInContext("typeof __fns.forage", ctx) !== "function") throw new Error("program must define function forage(seen, visit)");
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
      vm.runInContext(PRELUDE(setup.game), c);
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
      const args = `[__seen.slice(), ${jsonArgs(req.visit)}]`;
      // After a feed: tasted(seen, nectar) first, in the same call with the same time limit.
      const tasted = req.tasted === undefined || req.tasted === null ? "" :
        `if (typeof __fns.tasted === "function") { try { __fns.tasted(__seen.slice(), ${!!req.tasted}); } catch (e) { throw new Error("tasted: " + ((e && e.message) || e)); } }`;
      const r = JSON.parse(vm.runInContext(`(() => { ${tasted} return ${encodeCall("forage", args)}; })()`, ctx, { timeout: limit() }));
      if (r.s && r.s.length > maxChars()) throw new Error("forage returned something too large");
      return out({ a: JSON.parse(r.s), out: r.o });
    }
    if (req.op === "tasted") { // the older protocol: tasted in a call of its own
      if (vm.runInContext("typeof __fns.tasted", ctx) !== "function") return out({ ok: true, out: "" });
      const r = JSON.parse(vm.runInContext(encodeCall("tasted", `[__seen.slice(), ${JSON.stringify(!!req.nectar)}]`), ctx, { timeout: limit() }));
      return out({ ok: true, out: r.o });
    }
  } catch (e) {
    const msg = /timed out/i.test(short(e)) ? "Timeout: took too long" : short(e);
    let o = "";
    try { if (ctx) o = vm.runInContext("(() => { const o = __out.join(''); __out.length = 0; return o; })()", ctx); } catch {}
    out({ e: msg, out: o });
  }
});
