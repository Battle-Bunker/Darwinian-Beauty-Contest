// The game's program measures (vendor/measure.js, the same file the editor loads), on the server.
// mode is the game's `complexity` setting: "chars" or "nodes".
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const Measure = require("../../vendor/measure.js");
const GRAMMARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../vendor/grammars");

const parsers = {};
let ready = null;

export function initMeasure() {
  ready ||= (async () => {
    await Parser.init();
    for (const lang of ["python", "typescript"]) {
      parsers[lang] = new Parser();
      parsers[lang].setLanguage(await Parser.Language.load(path.join(GRAMMARS, `tree-sitter-${lang}.wasm`)));
    }
  })();
  return ready;
}

async function withTrees(language, codes, fn) {
  await initMeasure();
  const trees = codes.map((code) => parsers[language].parse(code));
  try {
    return fn(...trees);
  } finally {
    for (const t of trees) t.delete?.();
  }
}

/** { size, minified, syntaxError }: the program's size in the mode's unit, and the text the game runs. */
export function size(language, code, mode = "chars") {
  return withTrees(language, [code], (tree) => {
    const s = Measure.size(tree.rootNode, code, language, mode);
    return { size: s.size, minified: s.text, syntaxError: tree.rootNode.hasError };
  });
}

/** How much a program changed between two versions, in the mode's unit (renaming is free). */
export function changes(language, before, after, mode = "chars") {
  return withTrees(language, [before, after], (a, b) => Measure.changes(a.rootNode, before, b.rootNode, after, language, mode));
}

export const UNITS = { chars: "characters", nodes: "nodes" };
