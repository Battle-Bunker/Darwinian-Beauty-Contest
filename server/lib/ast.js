// Complexity (AST node count) and change (tree edit distance) measurements, shared with the
// browser via vendor/astdiff.js (same code as quine-court). Comments are free: they never count.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const AstDiff = require("../../vendor/astdiff.js");
const GRAMMARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../vendor/grammars");

const differs = {};
let ready = null;

export function initAst() {
  ready ||= (async () => {
    await Parser.init();
    for (const lang of ["python", "typescript"]) {
      const p = new Parser();
      p.setLanguage(await Parser.Language.load(path.join(GRAMMARS, `tree-sitter-${lang}.wasm`)));
      differs[lang] = AstDiff.createTreeSitterDiff(p);
    }
  })();
  return ready;
}

/** { nodes, syntaxError } */
export async function measure(language, code) {
  await initAst();
  const parsed = differs[language].parse(code);
  return { nodes: parsed.size, syntaxError: parsed.hasError };
}

/** Tree edit distance between two versions of a program. */
export async function changeDistance(language, before, after) {
  await initAst();
  return differs[language].diff(before, after).distance;
}
