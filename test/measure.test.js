// Program size = weighted syntax-tree nodes of the automatically minified program, literals one node per
// byte; change = weighted tree edits between two versions with names lined up, literals diffed byte by
// byte (vendor/measure.js). Comments, spacing, types and name lengths don't count.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { changes, size } from "../server/lib/measure.js";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const { stripTypeScriptTypes } = require("node:module");
const py = (code) => size("python", code);
const ts = (code) => size("typescript", code);

const READABLE_PY = `import random
import time

# Grow a clique greedily from a random start, keep the best one found.
def flower(challenge):
    started_at = time.perf_counter()
    best_clique = []

    while time.perf_counter() - started_at < 0.6 * GAME["ms"] / 1000:
        candidate_clique = [random.randrange(1000)]   # a random seed vertex
        if len(candidate_clique) > len(best_clique):
            best_clique = candidate_clique

    return dict(nodes=len(best_clique), edges=[], labels=best_clique)
`;
const TERSE_PY = `import random
import time
def flower(c):
  t=time.perf_counter();b=[]
  while time.perf_counter()-t<0.6*GAME["ms"]/1000:
    k=[random.randrange(1000)]
    if len(k)>len(b):b=k
  return dict(nodes=len(b),edges=[],labels=b)
`;

test("python: readable and hand-minified versions of a program cost the same", async () => {
  const a = await py(READABLE_PY), b = await py(TERSE_PY);
  assert.equal(a.size, b.size);
  assert.equal(a.minified, b.minified);
  assert.ok(a.size < TERSE_PY.length, `${a.size} < ${TERSE_PY.length}`);
});

test("typescript: types, comments, semicolon style and name lengths are free", async () => {
  const readable = `// Answer with a ring as big as the challenge allows.
type Ring = { nodes: number; edges: [number, number][] };
function flower(challenge: number): Ring {
  const ringSize: number = 3 + (Math.abs(challenge) % 10);
  const ringEdges: [number, number][] = [];
  for (let position = 0; position < ringSize; position++) ringEdges.push([position, (position + 1) % ringSize]);
  return { nodes: ringSize, edges: ringEdges };
}
`;
  const terse = `function flower(c){const n=3+(Math.abs(c)%10);const e=[];for(let i=0;i<n;i++)e.push([i,(i+1)%n]);return{nodes:n,edges:e}}`;
  const a = await ts(readable), b = await ts(terse);
  assert.equal(a.size, b.size);
  assert.equal(a.minified, b.minified);
});

test("strings and numbers count byte by byte", async () => {
  const short = await py(`T = "ab"\ndef flower(c):\n    return T\n`);
  const long = await py(`T = "${"x".repeat(50_000)}"\ndef flower(c):\n    return T\n`);
  assert.equal(long.size - short.size, 50_000 - 2);
  const small = await py(`T = 9\ndef flower(c):\n    return T\n`);
  const big = await py(`T = ${"9".repeat(5000)}\ndef flower(c):\n    return T\n`);
  assert.equal(big.size - small.size, 4999);
  const tsSmall = await ts(`const T = 7n; function flower(c: number) { return 1; }`);
  const tsBig = await ts(`const T = ${"7".repeat(3000)}n; function flower(c: number) { return 1; }`);
  assert.equal(tsBig.size - tsSmall.size, 2999);
  // Docstrings are strings; comments are not.
  const doc = await py(`def flower(c):\n    """Answer."""\n    return c\n`);
  const com = await py(`def flower(c):\n    # Answer.\n    return c\n`);
  assert.equal(doc.size - com.size, "Answer.".length + 1); // + its own statement
  // Embedded expressions are minified like any other code.
  const f1 = await py(`def flower(c):\n    value = c\n    return f"<{value:>{value}}>"\n`);
  assert.match(f1.minified, /f"<\{\w:>\{\w\}\}>"/);
  const t1 = await ts("function flower(c: number) { const value = c; return `<${value + 1}>`; }");
  assert.match(t1.minified, /`<\$\{\w\+1\}>`/);
});

test("attribute and keyword-argument names count as written; GAME and the entry points keep their names", async () => {
  const a = await py(`def flower(c):\n    return dict(nodes=1, edges=[], labels=[c.real])\n`);
  assert.match(a.minified, /dict\(nodes=1,edges=\[\],labels=\[\w\.real\]\)/);
  assert.match(a.minified, /^def flower\(/);
  const b = await ts(`function forage(seen: any[], visit: any) { return GAME.feed_cost > visit.left ? "leave" : ["ask", seen.length]; }`);
  assert.match(b.minified, /^function forage\(\w,\w\)\{return GAME\.feed_cost>\w\.left\?"leave":\["ask",\w\.length\];\}$/);
});

test("the minified programs are valid code", async () => {
  const { starters } = await import("./fixtures/programs.js");
  const { normalizeConfig } = await import("../server/lib/gameConfig.js");
  const samples = { python: [READABLE_PY, TERSE_PY], typescript: [] };
  for (const language of ["python", "typescript"]) {
    const s = starters(normalizeConfig({ language }));
    for (const k of ["cosmos", "orchid", "bee"]) samples[language].push(s[k]);
  }
  samples.python.push(`import random, math as m\nfrom itertools import count\n@staticmethod\ndef g(x, *a, **k):\n    try:\n        return [y for y in a if y] or {z: 1 for z in k}\n    except ValueError as e:\n        raise\n    finally:\n        pass\nclass C:\n    def h(self, q=2):\n        global G\n        if (w := q) > 1: return f"{w!r:>{q}}"\n        elif q: pass\n        else:\n            return not q in (1,)\n`);
  for (const code of samples.python) {
    const { minified } = await py(code);
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: minified });
  }
  samples.typescript.push(`const {p, q: r} = o, [s, ...t] = u; let w = \`a\${p}b\`;\nclass C { private z = 1; m(v) { return this.z + v - -v } }\nconst f = (a: number) => ({ w, a } as any);\n`);
  for (const code of samples.typescript) {
    const { minified } = await ts(code);
    assert.doesNotThrow(() => new vm.Script(stripTypeScriptTypes(minified)), minified);
  }
});

test("change: renames, comments and formatting are free; edits cost the nodes they change", async () => {
  const pc = (a, b) => changes("python", a, b);
  assert.equal(await pc(TERSE_PY, READABLE_PY), 0, "the same program, written readably");
  const base = `def flower(challenge):\n    size = 5\n    return size * challenge\n`;
  assert.equal(await pc(base, base.replace(/size/g, "ring_size")), 0, "a rename");
  assert.equal(await pc(base, base.replace("5", "7")), 1, "a constant, byte by byte");
  assert.equal(await pc(base, base.replace("5", "12345")), 4);
  assert.equal(await pc(base, base.replace("*", "+")), 1, "an operator relabels one node");
  assert.equal(await pc(base, base.replace("    return", "    size += 1\n    return")), 4, "a new statement: its nodes");
  assert.equal(await pc(`def flower(c):\n    return "hello world"\n`, `def flower(c):\n    return "hello wurld!"\n`), 2);
  // A new variable that becomes the most used doesn't reshuffle every other name's cost.
  const more = `def flower(challenge):\n    size = 5\n    k = 3\n    return size * challenge + k + k + k\n`;
  assert.equal(await pc(base, more), await pc(base, more.replace(/\bk\b/g, "q")));
  assert.ok(await pc(base, more) <= 12, `${await pc(base, more)}`);
  const tc = (a, b) => changes("typescript", a, b);
  assert.equal(await tc("function flower(c: number) { return c * 2 }", "// doubled\nfunction flower(challenge: number): number {\n  return challenge * 2;\n}\n"), 0);
  // Writing a program from nothing costs its whole size.
  assert.equal(await pc("", base), (await py(base)).size);
});

test("renaming never changes what a program does", async () => {
  const code = `import collections.abc
import random
class Box:
    width = 3
    def area(self, scale=1):
        return self.width * scale
def helper(size, max=2):
    return size + max
def flower(challenge):
    keep = 1
    return [Box().area(scale=2), helper(size=challenge), len([1]), keep]
`;
  const { minified } = await py(code);
  for (const kept of ["width", "area", "scale", "size", "max", "collections.abc", "len"]) assert.ok(minified.includes(kept), kept);
  const run = (src) => execFileSync("python3", ["-c", src + "\nprint(flower(5))"]).toString();
  assert.equal(run(minified), run(code));
});

test("the browser loads the same rules as a plain script", async () => {
  // web/src/lib/codetools.ts loads /vendor/measure.js with a <script> tag.
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL("../vendor/measure.js", import.meta.url), "utf8"), ctx);
  assert.equal(typeof ctx.DbcMeasure.size, "function");
  await Parser.init();
  const p = new Parser();
  p.setLanguage(await Parser.Language.load(new URL("../vendor/grammars/tree-sitter-python.wasm", import.meta.url).pathname));
  const tree = p.parse(READABLE_PY);
  const browser = ctx.DbcMeasure.size(tree.rootNode, READABLE_PY, "python");
  const server = await py(READABLE_PY);
  assert.equal(browser.size, server.size);
  assert.equal(browser.text, server.minified);
  const other = p.parse(TERSE_PY.replace("1000", "999"));
  assert.equal(ctx.DbcMeasure.changes(tree.rootNode, READABLE_PY, other.rootNode, TERSE_PY.replace("1000", "999"), "python"),
    await changes("python", READABLE_PY, TERSE_PY.replace("1000", "999")));
  const one = p.parse("x = 'abcdef'\n"), two = p.parse("x = 'abXdef'\n");
  const m = ctx.DbcMeasure.marks(one.rootNode, "x = 'abcdef'\n", two.rootNode, "x = 'abXdef'\n", "python");
  assert.deepEqual(JSON.parse(JSON.stringify(m)), { old: [[7, 8, "del"]], new: [[7, 8, "ins"]] }, "a literal is diffed byte by byte");
});

test("nodes: literals one per byte; names, comments and types free; kept names pay beyond 20 bytes", async () => {
  const base = `def flower(challenge):\n    size = 5\n    return size * challenge  # comment\n`;
  const b = (await py(base)).size;
  assert.equal((await py(base.replace(/size/g, "a_very_long_descriptive_name"))).size, b, "names are free");
  assert.equal((await py(`T = "${"x".repeat(50)}"\n` + base)).size - b, 50 + 3, "a string is a node per byte (plus the assignment)");
  assert.equal((await py(`T = ${"9".repeat(500)}\n` + base)).size - b, 500 + 3, "so is a number");
  assert.equal((await py(`T = "${"é".repeat(10)}"\n` + base)).size - b, 20 + 3, "bytes, not characters");
  // A name that minifying must keep (here a keyword-argument name) exists at runtime, so long ones pay.
  const kw = async (n) => (await py(`def flower(c):\n    return dict(${"k".repeat(n)}=1)\n`)).size;
  assert.equal(await kw(120) - await kw(1), 100);
  assert.equal((await ts("function flower(c: number): number { const k: number = 3; return c * k; }")).size,
    (await ts("function flower(c) { const k = 3; return c * k; }")).size, "TypeScript types are free");
});
