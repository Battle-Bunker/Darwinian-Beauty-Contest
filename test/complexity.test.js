// Complexity = syntax-tree nodes + one per character of string-literal text (comments stay free).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { measure } from "../server/lib/ast.js";

// Taken at load time, like server/lib/ast.js does: web-tree-sitter swaps its exports once initialised.
const Parser = createRequire(import.meta.url)("web-tree-sitter");

const py = (code) => measure("python", code);
const ts = (code) => measure("typescript", code);

/** The tree part (nodes without string text) must be unaffected by what's inside the strings. */
async function parts(m) {
  const r = await m;
  assert.equal(r.syntaxError, false);
  return { ...r, tree: r.nodes - r.strings };
}

test("python: a long string costs exactly its extra characters (the old loophole)", async () => {
  const flower = (s) => `T = "${s}"\ndef flower(c):\n    return T[c % len(T)]\n`;
  const short = await parts(py(flower("ab")));
  const long = await parts(py(flower("ab".repeat(25_000))));
  assert.equal(short.strings, 2);
  assert.equal(long.strings, 50_000);
  assert.equal(long.tree, short.tree);
  assert.equal(long.nodes - short.nodes, 50_000 - 2);
});

test("python: every kind of string literal counts its text as written", async () => {
  assert.equal((await py(`x = "ab\\n"`)).strings, 4, `"\\n" is 2 characters`);
  assert.equal((await py(`x = r"\\d+"`)).strings, 3, "raw");
  assert.equal((await py(`x = b"bytes"`)).strings, 5, "bytes");
  assert.equal((await py(`x = """two\nlines"""`)).strings, 9, "triple-quoted, newline included");
  assert.equal((await py(`x = "a" "bc"`)).strings, 3, "implicit concatenation");
  assert.equal((await py(`x = ""`)).strings, 0, "empty");
  assert.equal((await py(`x = "é😀"`)).strings, 2, "characters, not bytes or UTF-16 units");
  assert.equal((await py(`d = {"nodes": 1, "edges": []}`)).strings, 10, "dict keys are strings too");
});

test("python: docstrings count", async () => {
  const bare = await parts(py(`def f(c):\n    return c\n`));
  const doc = await parts(py(`def f(c):\n    """Answer with the challenge."""\n    return c\n`));
  assert.equal(doc.strings, "Answer with the challenge.".length);
  assert.ok(doc.nodes > bare.nodes + doc.strings, "plus the docstring's own syntax nodes");
  const moduleDoc = await py(`"""A flower."""\ndef flower(c):\n    return c\n`);
  assert.equal(moduleDoc.strings, "A flower.".length);
});

test("python: f-strings count their literal text, not their expressions", async () => {
  const a = await parts(py(`s = f"ab{x + 1}cd"`));
  assert.equal(a.strings, 4);
  // A longer expression adds syntax nodes, never string characters.
  const b = await parts(py(`s = f"ab{xxxxxxxxxx + 1}cd"`));
  assert.equal(b.strings, 4);
  assert.equal(b.nodes, a.nodes);
  // Longer literal text adds exactly its characters.
  const c = await parts(py(`s = f"abXYZ{x + 1}cd"`));
  assert.equal(c.nodes - a.nodes, 3);
  assert.equal(c.tree, a.tree);
  // A string inside an interpolation counts once, as its own literal.
  assert.equal((await py(`s = f"<{'abc'}>"`)).strings, 2 + 3);
  // {{ and }} escapes are literal text; a format spec's literal text counts, nested {w} doesn't.
  assert.equal((await py(`s = f"{{x}}"`)).strings, 5);
  assert.equal((await py(`s = f"{x:>{w}}"`)).strings, 1);
  assert.equal((await py(`s = f"{x:any text}"`)).strings, 8);
});

test("python: comments stay free", async () => {
  const plain = await py(`def flower(c):\n    return c * 2\n`);
  const commented = await py(`# A flower. "Quotes" in comments cost nothing.\ndef flower(c):\n    return c * 2  # ${"x".repeat(5000)}\n`);
  assert.equal(commented.nodes, plain.nodes);
  assert.equal(commented.strings, 0);
});

test("typescript: a long string costs exactly its extra characters", async () => {
  const flower = (s) => `const T = "${s}";\nfunction flower(c: number): number { return T.charCodeAt(c % T.length); }\n`;
  const short = await parts(ts(flower("ab")));
  const long = await parts(ts(flower("ab".repeat(25_000))));
  assert.equal(short.strings, 2);
  assert.equal(long.tree, short.tree);
  assert.equal(long.nodes - short.nodes, 50_000 - 2);
  assert.equal((await ts(`const s = 'it\\'s';`)).strings, 5, "single quotes, escapes as written");
  assert.equal((await ts(`const s = "";`)).strings, 0);
});

test("typescript: template literals count their text, not their substitutions", async () => {
  const a = await parts(ts("const s = `ab${x + 1}cd`;"));
  assert.equal(a.strings, 4);
  const b = await parts(ts("const s = `ab${xxxxxxxxxx + 1}cd`;"));
  assert.equal(b.strings, 4);
  assert.equal(b.nodes, a.nodes);
  const c = await parts(ts("const s = `abXYZ${x + 1}cd`;"));
  assert.equal(c.nodes - a.nodes, 3);
  assert.equal(c.tree, a.tree);
  // Nested template: each literal's text counts once.
  assert.equal((await ts("const s = `a${`in${1}ner`}b`;")).strings, 2 + 5);
  assert.equal((await ts("const s = `plain`;")).strings, 5);
});

test("typescript: regex patterns count, flags don't; comments stay free", async () => {
  assert.equal((await ts("const r = /ab+c/gi;")).strings, 4);
  const plain = await ts("function flower(c: number): number { return c * 2; }");
  const commented = await ts(`// "free" ${"y".repeat(5000)}\n/** Doc comments are comments. */\nfunction flower(c: number): number { return c * 2; /* 'still free' */ }`);
  assert.equal(commented.nodes, plain.nodes);
  assert.equal(commented.strings, 0);
  // Unquoted object keys are identifiers, not strings.
  assert.equal((await ts(`const g = { nodes: 2, edges: [[0, 1]] };`)).strings, 0);
  assert.equal((await ts(`const g = { "nodes": 2, "edges": [[0, 1]] };`)).strings, 10);
});

test("the browser loads the same rule as a plain script", async () => {
  // web/src/lib/codetools.ts loads /vendor/astdiff.js and /vendor/complexity.js with <script> tags.
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL("../vendor/astdiff.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(new URL("../vendor/complexity.js", import.meta.url), "utf8"), ctx);
  assert.equal(typeof ctx.DbcComplexity.complexity, "function");
  // Same answer as the server for the same parse.
  await Parser.init();
  const p = new Parser();
  p.setLanguage(await Parser.Language.load(new URL("../vendor/grammars/tree-sitter-python.wasm", import.meta.url).pathname));
  const code = `def flower(c):\n    """Doc."""\n    return f"n={c}" + "x" * 3  # free\n`;
  const browser = ctx.DbcComplexity.complexity(ctx.AstDiffTS.createTreeSitterDiff(p).parse(code));
  const server = await py(code);
  assert.equal(browser.nodes, server.nodes);
  assert.equal(browser.strings, server.strings);
  assert.equal(server.strings, 4 + 2 + 1);
});
