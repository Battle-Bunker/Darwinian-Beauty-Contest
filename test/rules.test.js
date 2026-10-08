// The Python source rules (server/runners/py_rules.py, RULES.md "What programs can use"): ordinary programs
// pass; a dunder attribute, a frame internal, dynamic str.format or a removed builtin is reported with its
// line and the construct, both at check time (server/lib/pyRules.js) and by the runner before it loads a
// program. The end-to-end red team (that none of these reaches os, sys, the clock or files) is in
// escapes.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ruleBreaches } from "../server/lib/pyRules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = path.join(HERE, "..", "server", "runners", "py_rules.py");
// Call the checker in-process via its own script, so the message wording is tested directly too.
const check = (code) => JSON.parse(execFileSync("python3", ["-s", RULES], { input: JSON.stringify({ code }) }).toString()).errors;

const ORDINARY = `import collections, dataclasses, enum, functools, heapq, json, math, operator, random, re, statistics, time

@dataclasses.dataclass(order=True)
class Point:
    x: int
    y: int = 0
    def __post_init__(self):
        self.y = self.y or self.x
    def __eq__(self, o):
        return (self.x, self.y) == (o.x, o.y)
    def __hash__(self):
        return hash((self.x, self.y))
    def __repr__(self):
        return f"{type(self).__name__}({self.x})"

class Kind(enum.IntEnum):
    A = 1
    B = 2

def flower(c):
    pts = sorted([Point(3), Point(1, 2)])
    h = []
    heapq.heappush(h, pts[0].x)
    total = functools.reduce(operator.add, [p.x for p in pts], 0)
    tag = "{}-{:>2}".format(Kind.A.name, total)
    digest = re.sub(r"\\s+", "", str(c))
    return [pts[0].x, getattr(pts[1], "y"), total, tag, len(digest), repr(pts[0])], 50
`;

test("an ordinary program with classes, dunder methods, super, dataclasses and literal str.format passes", () => {
  assert.deepEqual(check(ORDINARY), [], "no breaches");
});

// Each breach: the construct, and a regex its message must match. The line is 1 (each is a one-line body).
const BREACHES = [
  ["a value's class", "def f(c):\n    return c.__class__\n", /line 2: .*dunder attributes like \.__class__/],
  ["a function's globals", "def f(c):\n    return f.__globals__\n", /\.__globals__/],
  ["object subclasses", "def f(c):\n    return object.__subclasses__()\n", /\.__subclasses__/],
  ["a dict of a type", "def f(c):\n    return type(c).__dict__\n", /\.__dict__/],
  ["a code object", "def f(c):\n    return f.__code__\n", /\.__code__/],
  ["a frame back-pointer", "def f(c):\n    return c.f_back\n", /f_back is the interpreter's internals/],
  ["a generator frame", "def f(c):\n    return c.gi_frame\n", /gi_frame is the interpreter's internals/],
  ["a closure cell", "def f(c):\n    return c.cell_contents\n", /cell_contents is the interpreter's internals/],
  ["the builtins name", "def f(c):\n    return __builtins__\n", /may not use the name __builtins__/],
  ["build-class", "def f(c):\n    return __build_class__\n", /may not use the name __build_class__/],
  ["assigning a dunder name at module level", "__x__ = 1\ndef f(c):\n    return 1\n", /may not assign to dunder names \(__x__\)/],
  ["a format field attribute", 'def f(c):\n    return "{0.__class__}".format(c)\n', /format field with an attribute lookup/],
  ["format on a variable", 'def f(c):\n    s = "{}"\n    return s.format(c)\n', /str\.format only on a literal string/],
  ["format_map on a variable", 'def f(c):\n    s = "{x}"\n    return s.format_map(c)\n', /str\.format_map only on a literal string/],
  ["eval", 'def f(c):\n    return eval("1")\n', /eval\(\) is not available/],
  ["exec", 'def f(c):\n    exec("x = 1")\n', /exec\(\) is not available/],
  ["compile", 'def f(c):\n    return compile("1", "", "eval")\n', /compile\(\) is not available/],
  ["globals", "def f(c):\n    return globals()\n", /globals\(\) is not available/],
  ["locals", "def f(c):\n    return locals()\n", /locals\(\) is not available/],
  ["vars", "def f(c):\n    return vars(c)\n", /vars\(\) is not available/],
  ["open", 'def f(c):\n    return open("/x")\n', /open\(\) is not available/],
  ["importing a dunder name", "from math import __loader__\ndef f(c):\n    return 1\n", /may not import dunder names \(__loader__\)/],
];

test("each interpreter route is reported with its line and the construct", () => {
  for (const [what, code, re] of BREACHES) {
    const errs = check(code);
    assert.ok(errs.length, `${what}: not reported`);
    assert.match(errs[0], /^line \d+: /, `${what}: no line number`);
    assert.match(errs.join(" "), re, what);
  }
});

test("the engine's checker (server/lib/pyRules.js) agrees, and only for Python", async () => {
  assert.deepEqual(await ruleBreaches("python", ORDINARY), []);
  assert.match((await ruleBreaches("python", "def f(c):\n    return c.__class__\n"))[0], /__class__/);
  assert.deepEqual(await ruleBreaches("typescript", "const x: any = (1).constructor;"), [], "TS source isn't checked this way");
});

test("defining dunder methods and reading __name__ is allowed (ordinary Python)", () => {
  const ok = [
    "class A:\n    def __init__(self):\n        super().__init__()\n    def __iter__(self):\n        return iter([])\n    def __lt__(self, o):\n        return True\ndef f(c):\n    return 1\n",
    "def f(c):\n    return f.__name__\n",
    "def f(c):\n    return type(c).__name__\n",
    'def f(c):\n    return "{} {:>3}".format(1, 2)\n',
    "class B(dict):\n    def __missing__(self, k):\n        return 0\ndef f(c):\n    return B()[1]\n",
  ];
  for (const code of ok) assert.deepEqual(check(code), [], code.split("\n")[0]);
});
