// Complexity and change measurements, shared with the browser: vendor/complexity.js (the game's
// complexity rule: characters of the automatically minified program) and vendor/astdiff.js (tree edit
// distance between versions, same code as quine-court).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const AstDiff = require("../../vendor/astdiff.js");
const Complexity = require("../../vendor/complexity.js");
const GRAMMARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../vendor/grammars");

const parsers = {};
const differs = {};
let ready = null;

export function initAst() {
  ready ||= (async () => {
    await Parser.init();
    for (const lang of ["python", "typescript"]) {
      const language = await Parser.Language.load(path.join(GRAMMARS, `tree-sitter-${lang}.wasm`));
      parsers[lang] = new Parser();
      parsers[lang].setLanguage(language);
      const forDiff = new Parser();
      forDiff.setLanguage(language);
      differs[lang] = AstDiff.createTreeSitterDiff(forDiff);
    }
  })();
  return ready;
}

/** { chars, minified, syntaxError }: chars is the complexity, the size of `minified` (see vendor/complexity.js). */
export async function measure(language, code) {
  await initAst();
  const tree = parsers[language].parse(code);
  try {
    const m = Complexity.minify(tree.rootNode, code, language);
    return { chars: m.chars, minified: m.text, syntaxError: tree.rootNode.hasError };
  } finally {
    tree.delete?.();
  }
}

/** Tree edit distance between two versions of a program. */
export async function changeDistance(language, before, after) {
  await initAst();
  return differs[language].diff(before, after).distance;
}
