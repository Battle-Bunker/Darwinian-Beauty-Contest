// Complexity = characters of the automatically minified program (vendor/complexity.js): comments,
// spacing and name lengths don't count; strings, numbers, keywords and attribute names do.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { measure } from "../server/lib/ast.js";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const { stripTypeScriptTypes } = require("node:module");
const py = (code) => measure("python", code);
const ts = (code) => measure("typescript", code);

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
  assert.equal(a.chars, b.chars);
  assert.equal(a.minified, b.minified);
  assert.ok(a.chars < TERSE_PY.length, `${a.chars} < ${TERSE_PY.length}`);
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
  assert.equal(a.chars, b.chars);
  assert.equal(a.minified, b.minified);
});

test("strings and numbers count character by character", async () => {
  const short = await py(`T = "ab"\ndef flower(c):\n    return T\n`);
  const long = await py(`T = "${"x".repeat(50_000)}"\ndef flower(c):\n    return T\n`);
  assert.equal(long.chars - short.chars, 50_000 - 2);
  const small = await py(`T = 9\ndef flower(c):\n    return T\n`);
  const big = await py(`T = ${"9".repeat(5000)}\ndef flower(c):\n    return T\n`);
  assert.equal(big.chars - small.chars, 4999);
  const tsSmall = await ts(`const T = 7n; function flower(c: number) { return 1; }`);
  const tsBig = await ts(`const T = ${"7".repeat(3000)}n; function flower(c: number) { return 1; }`);
  assert.equal(tsBig.chars - tsSmall.chars, 2999);
  // Docstrings are strings; comments are not.
  const doc = await py(`def flower(c):\n    """Answer."""\n    return c\n`);
  const com = await py(`def flower(c):\n    # Answer.\n    return c\n`);
  assert.equal(doc.chars - com.chars, `"""Answer."""`.length + 2); // + its own line and indent
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
  const b = await ts(`function forage(seen: any[], left: number) { return GAME.turns > left ? "leave" : ["ask", seen.length]; }`);
  assert.match(b.minified, /^function forage\(\w,\w\)\{return GAME\.turns>\w\?"leave":\["ask",\w\.length\];\}$/);
});

test("names are free up to 20 characters; longer ones pay for the rest", async () => {
  const base = await py(`def flower(c):\n    ${"a".repeat(20)} = 1\n    return c\n`);
  const long = await py(`def flower(c):\n    ${"a".repeat(1020)} = 1\n    return c\n`);
  assert.equal(long.chars - base.chars, 1000);
});

test("the minified programs are valid code", async () => {
  const { starters } = await import("./fixtures/programs.js");
  const { normalizeConfig } = await import("../server/lib/gameConfig.js");
  const samples = { python: [READABLE_PY, TERSE_PY], typescript: [] };
  for (const language of ["python", "typescript"]) {
    const s = starters(normalizeConfig({ language }));
    for (const k of ["clover", "orchid", "bee"]) samples[language].push(s[k]);
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

test("the browser loads the same rule as a plain script", async () => {
  // web/src/lib/codetools.ts loads /vendor/complexity.js with a <script> tag.
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL("../vendor/complexity.js", import.meta.url), "utf8"), ctx);
  assert.equal(typeof ctx.DbcComplexity.minify, "function");
  await Parser.init();
  const p = new Parser();
  p.setLanguage(await Parser.Language.load(new URL("../vendor/grammars/tree-sitter-python.wasm", import.meta.url).pathname));
  const tree = p.parse(READABLE_PY);
  const browser = ctx.DbcComplexity.minify(tree.rootNode, READABLE_PY, "python");
  const server = await py(READABLE_PY);
  assert.equal(browser.chars, server.chars);
  assert.equal(browser.text, server.minified);
});
