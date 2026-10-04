// Programs must have no anchor to real-world state. The Python runner refuses the interpreter routes that
// would reach os, sys, the real clock or files (server/runners/py_rules.py checks the source at submit time
// and before running; the runner also guards getattr and gives module views). Ordinary programs still run.
// Best effort, not a security sandbox. TypeScript: the vm context exposes no host function to rebuild.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgramProcess } from "../server/runners/proc.js";
import { ruleBreaches } from "../server/lib/pyRules.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { play } from "./fixtures/garden.js";
import { starters } from "./fixtures/programs.js";

// Run a flower once: { refused: true } if the runner wouldn't load or run it, { v } if a value came back.
async function once(language, code) {
  const p = new ProgramProcess(language, "flower", { code, ms: 200, maxResponseBytes: 1 << 16, game: { team: 0 } });
  try {
    const r = await p.ready;
    if (!r.ok) return { refused: true, why: r.e };
    const a = await p.call({ op: "call", c: 1 });
    return a.v ? { v: a.v[0] } : { refused: true, why: a.e };
  } finally {
    p.kill();
  }
}

// Build the dunder/internal names at run time, so this file's own source stays ordinary and the static
// check can't "recognise" it. c is a captured value; cls walks to the base-object type.
const dunder = (w) => '"__" + "' + w + '" + "__"';
const cls = `getattr(c, ${dunder("class")})`;

// Reaching into the interpreter: refused by the static rules, so the program won't even load.
const STATIC = {
  "a value's class, written plainly": `def flower(c):\n    return str(c.__class__), 1\n`,
  "a function's globals": `def flower(c):\n    return str(flower.__globals__), 1\n`,
  "object subclasses": `def flower(c):\n    return len(object.__subclasses__()), 1\n`,
  "a class dict": `def flower(c):\n    return str(type(c).__dict__), 1\n`,
  "an exception's frame": `def flower(c):\n    try:\n        raise ValueError\n    except ValueError as e:\n        return str(e.__traceback__.tb_frame), 1\n`,
  "a generator frame": `def flower(c):\n    g = (x for x in [1])\n    return str(g.gi_frame), 1\n`,
  "the builtins name": `def flower(c):\n    return str(__builtins__), 1\n`,
  "a format field attribute": `def flower(c):\n    return "{0.__class__}".format(c), 1\n`,
  "format on a variable": `def flower(c):\n    s = "{}"\n    return s.format(c), 1\n`,
  eval: `def flower(c):\n    return eval("1"), 1\n`,
  exec: `def flower(c):\n    exec("x = 1")\n    return 1, 1\n`,
  globals: `def flower(c):\n    return str(globals()), 1\n`,
  open: `def flower(c):\n    return open("/etc/hostname").read(), 1\n`,
  "reassigning builtins": `__builtins__ = {}\ndef flower(c):\n    return 1, 1\n`,
};

// Reaching with names built at run time (past the static check): refused by the runner's guards, or the
// borrowed module/attribute simply isn't there. None reaches os, sys, a file or the real clock.
const RUNTIME = {
  "getattr to the class": `def flower(c):\n    return str(getattr(c, ${dunder("class")})), 1\n`,
  "getattr to globals": `def flower(c):\n    return str(getattr(flower, ${dunder("globals")})), 1\n`,
  "getattr to a frame": `def flower(c):\n    g = (x for x in [1])\n    return str(getattr(g, "gi_" + "frame")), 1\n`,
  hasattr: `def flower(c):\n    return hasattr(flower, ${dunder("code")}), 1\n`,
  "operator.attrgetter": `import operator\ndef flower(c):\n    return str(operator.attrgetter(${dunder("globals")})(flower)), 1\n`,
  "operator.methodcaller": `import operator\ndef flower(c):\n    return str(operator.methodcaller("__reduce" + "_ex__", 2)(flower)), 1\n`,
  "format by name": `def flower(c):\n    return getattr("{0." + "__class__}", "format")(c), 1\n`,
  "random's borrowed os": `import random\ndef flower(c):\n    return random.os.getpid(), 1\n`,
  "statistics' borrowed sys": `import statistics\ndef flower(c):\n    return str(statistics.sys.modules), 1\n`,
  "dataclasses' borrowed builtins": `import dataclasses\ndef flower(c):\n    return dataclasses.builtins.open("/etc/hostname").read(), 1\n`,
  "import os": `def flower(c):\n    return __import__("os").getpid(), 1\n`,
  "import sys": `def flower(c):\n    return len(__import__("sys").argv), 1\n`,
  "import datetime for the real clock": `def flower(c):\n    return __import__("datetime").datetime.now().year, 1\n`,
  "a private submodule": `def flower(c):\n    return str(__import__("re._parser")), 1\n`,
};

test("python: interpreter-introspection routes are refused when a program is checked, and won't load", async () => {
  for (const [what, code] of Object.entries(STATIC)) {
    const breaches = await ruleBreaches("python", code);
    assert.ok(breaches.length, `${what}: the static check should refuse it`);
    const r = await once("python", code);
    assert.ok(r.refused, `${what}: the runner should refuse it (got ${JSON.stringify(r.v)})`);
    assert.match(r.why, /breaks the rules/, what);
  }
});

test("python: routes built at run time are stopped by the runner's guards; none reaches os, sys, a file or the real clock", async () => {
  for (const [what, code] of Object.entries(RUNTIME)) {
    assert.deepEqual(await ruleBreaches("python", code), [], `${what}: nothing static to see`);
    const r = await once("python", code);
    assert.ok(r.refused, `${what}: should fail at run time (reached ${JSON.stringify(r.v)})`);
  }
});

test("python: ordinary programs still work (classes, dunder methods, super, dataclasses, operator, imports)", async () => {
  const ok = `import functools, dataclasses, operator, collections, enum, math
@dataclasses.dataclass
class P:
    x: int
    def __lt__(self, o):
        return self.x < o.x
    def __repr__(self):
        return type(self).__name__
class Counter(collections.Counter):
    pass
class Color(enum.Enum):
    RED = 1
def flower(c):
    ps = sorted([P(3), P(1), P(2)])
    total = functools.reduce(operator.add, [p.x for p in ps])
    cnt = Counter("aab")
    return [ps[0].x, getattr(ps[0], "x"), operator.attrgetter("x")(ps[2]), total, cnt["a"],
            Color.RED.value, "{} {:>3}".format(total, 7), repr(ps[0]), math.gcd(12, 8)], 50
`;
  assert.deepEqual(await ruleBreaches("python", ok), []);
  const r = await once("python", ok);
  assert.deepEqual(r.v, [1, 1, 3, 6, 2, 1, "6   7", "P", 4], JSON.stringify(r));
  // dir() of a function lists none of its internals (so there's nothing to then reach for).
  const listed = await once("python", `def flower(c):\n    return [x for x in dir(flower) if x in (${dunder("globals")}, ${dunder("code")}, ${dunder("closure")}, ${dunder("dict")})], 50\n`);
  assert.deepEqual(listed.v, [], "dir() lists none of a function's internals");
  // The starters play a whole game with no trouble.
  const out = await play(normalizeConfig({}), [0, 1].map((i) => starters(normalizeConfig({}), i)), 30);
  assert.deepEqual(out.problems, []);
});

// TypeScript: the context exposes no host object, so the classic "rebuild Function from a constructor" and
// stack-trace routes have nothing to climb to.
const TS = {
  "this.constructor.constructor": `function flower(c: number): [any, number] { const f: any = (function (this: any) { return this; }); return [f.constructor.constructor("return typeof process + \",\" + typeof require")(), 1]; }`,
  "a function's constructor builds code": `function flower(c: number): [any, number] { const F: any = (() => {}).constructor; return [F("return typeof globalThis.process")(), 1]; }`,
  "a generator's constructor builds code": `function flower(c: number): [any, number] { const G: any = (function* () {}).constructor; return [G("return typeof process")().next().value, 1]; }`,
  "Error.prepareStackTrace": `function flower(c: number): [any, number] { (Error as any).prepareStackTrace = (_e: any, s: any) => s; const e: any = new Error(); e.stack; return [typeof (globalThis as any).process, 1]; }`,
};

test("typescript: the vm context reaches no host globals (process, require), through Function or stack traces", async () => {
  for (const [what, code] of Object.entries(TS)) {
    const r = await once("typescript", code);
    // Either it throws, or the rebuilt Function runs inside the same context and still sees no process.
    if (!r.refused) assert.ok(!/object|,function/.test("," + String(r.v)), `${what}: reached a host global (${JSON.stringify(r.v)})`);
  }
  // Plain checks: no process, require, or host clock leak in.
  const probe = `function flower(c: number): [any, number] { return [[typeof (globalThis as any).process, typeof (globalThis as any).require, typeof (globalThis as any).__hr, performance.timeOrigin]], 1]; }`
    .replace("]], 1]", "], 1]");
  const r = await once("typescript", probe);
  assert.deepEqual(r.v, ["undefined", "undefined", "undefined", 0], JSON.stringify(r));
});
