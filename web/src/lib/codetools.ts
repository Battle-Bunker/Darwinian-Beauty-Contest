// In-browser program size (nodes), change cost and diff highlights, computed exactly like the server: the
// same vendor/tree-sitter.js + vendor/measure.js + grammars that server/lib/measure.js uses. Also a light
// syntax highlighter built on the same parse tree.

declare global {
  interface Window { TreeSitter: any; DbcMeasure: any }
}

export type Language = "python" | "typescript";
export type Mark = [number, number, string];

/** size: weighted syntax-tree nodes of `minified`, the program as the game runs it (see vendor/measure.js). */
export interface Parsed { size: number; minified: string; hasError: boolean }
export interface DiffResult { distance: number; old: Mark[]; new: Mark[] }

export interface LangTools {
  parse(code: string): Parsed;
  diff(before: string, after: string): DiffResult;
  syntax(code: string): Mark[];
}

const scripts: Record<string, Promise<void>> = {};
function loadScript(src: string): Promise<void> {
  return (scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  }));
}

let init: Promise<void> | null = null;
const tools: Partial<Record<Language, Promise<LangTools>>> = {};

export function getLangTools(lang: Language): Promise<LangTools> {
  init ||= (async () => {
    await loadScript("/vendor/tree-sitter.js");
    await loadScript("/vendor/measure.js");
    await window.TreeSitter.init({ locateFile: () => "/vendor/grammars/tree-sitter.wasm" });
  })();
  return (tools[lang] ||= init.then(async () => {
    const TS = window.TreeSitter;
    const parser = new TS();
    parser.setLanguage(await TS.Language.load(`/vendor/grammars/tree-sitter-${lang}.wasm`));
    const M = window.DbcMeasure;
    return {
      parse(code) {
        const tree = parser.parse(code);
        try {
          const m = M.size(tree.rootNode, code, lang);
          return { size: m.size, minified: m.text, hasError: !!tree.rootNode.hasError };
        } finally { tree.delete?.(); }
      },
      diff(before, after) {
        const a = parser.parse(before), b = parser.parse(after);
        try {
          const marks = M.marks(a.rootNode, before, b.rootNode, after, lang);
          return { distance: M.changes(a.rootNode, before, b.rootNode, after, lang), old: marks.old, new: marks.new };
        } finally { a.delete?.(); b.delete?.(); }
      },
      syntax(code) {
        const tree = parser.parse(code);
        try { return syntaxMarks(tree.rootNode, lang); } finally { tree.delete?.(); }
      },
    };
  }));
}

const KEYWORDS = new Set([
  // python
  "def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "import", "from", "as",
  "global", "nonlocal", "lambda", "pass", "break", "continue", "try", "except", "finally", "raise", "with", "class",
  "yield", "assert", "del",
  // typescript
  "function", "const", "let", "var", "type", "interface", "new", "typeof", "instanceof", "of", "do", "switch", "case",
  "default", "throw", "catch", "export", "void", "keyof", "readonly", "enum",
]);
const CONSTANTS = new Set(["true", "false", "none", "null", "undefined", "True", "False", "None"]);

/** Foreground classes for strings, numbers, comments, keywords, function names and constants. */
function syntaxMarks(root: any, lang: Language): Mark[] {
  const marks: Mark[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    const t: string = n.type;
    if (t === "comment") { marks.push([n.startIndex, n.endIndex, "tk-com"]); continue; }
    if (t === "string" || t === "template_string" || t === "string_fragment") { marks.push([n.startIndex, n.endIndex, "tk-str"]); continue; }
    if (t === "integer" || t === "float" || t === "number") { marks.push([n.startIndex, n.endIndex, "tk-num"]); continue; }
    if (CONSTANTS.has(t)) { marks.push([n.startIndex, n.endIndex, "tk-con"]); continue; }
    if ((t === "function_definition" || t === "function_declaration") && n.childForFieldName) {
      const name = n.childForFieldName("name");
      if (name) marks.push([name.startIndex, name.endIndex, "tk-fn"]);
    }
    if (t === "type_annotation" || t === "type_identifier" || t === "predefined_type") {
      if (lang === "typescript" && t !== "type_annotation") { marks.push([n.startIndex, n.endIndex, "tk-type"]); continue; }
    }
    if (n.childCount === 0) {
      if (!n.isNamed && KEYWORDS.has(t)) marks.push([n.startIndex, n.endIndex, "tk-kw"]);
      else if (t === "identifier" && n.text === "GAME") marks.push([n.startIndex, n.endIndex, "tk-con"]);
      continue;
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i));
  }
  return marks;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/**
 * HTML for an overlay <pre>: `fg` marks colour the text (syntax), `bg` marks shade it (diff).
 * Later marks win within each layer.
 */
export function paint(src: string, fg: Mark[], bg: Mark[] = []): string {
  const n = src.length;
  const f = new Array<string>(n).fill("");
  const b = new Array<string>(n).fill("");
  for (const [s, e, c] of fg) for (let i = Math.max(0, s); i < e && i < n; i++) f[i] = c;
  for (const [s, e, c] of bg) for (let i = Math.max(0, s); i < e && i < n; i++) b[i] = c;
  let out = "";
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && f[j] === f[i] && b[j] === b[i]) j++;
    const text = esc(src.slice(i, j));
    const cls = f[i] && b[i] ? `${f[i]} ${b[i]}` : f[i] || b[i];
    out += cls ? `<span class="${cls}">${text}</span>` : text;
    i = j;
  }
  return out + "\n\n";
}

export { esc as escapeHtml };
