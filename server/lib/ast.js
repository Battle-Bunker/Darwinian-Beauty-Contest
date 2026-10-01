// Complexity and change (tree edit distance) measurements, shared with the browser via
// vendor/astdiff.js (same code as quine-court) and vendor/complexity.js (the game's rule).
// Complexity = syntax-tree nodes + one per character of string-literal text. Comments are free.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const AstDiff = require("../../vendor/astdiff.js");
const Complexity = require("../../vendor/complexity.js");
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

/** { nodes, strings, syntaxError }: nodes is the complexity, of which `strings` are string-text characters. */
export async function measure(language, code) {
  await initAst();
  const parsed = differs[language].parse(code);
  const { nodes, strings } = Complexity.complexity(parsed);
  return { nodes, strings, syntaxError: parsed.hasError };
}

/**
 * Tree edit distance between two versions of a program. A plain string's text is a single leaf, so
 * rewriting it is one edit however many characters change: complexity, not change, charges for length.
 */
export async function changeDistance(language, before, after) {
  await initAst();
  return differs[language].diff(before, after).distance;
}
