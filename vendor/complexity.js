"use strict";
// The game's complexity rule. Not vendored code: it lives here, next to astdiff.js, because /vendor
// is served to the browser, so the editor (web/src/lib/codetools.ts) and the server
// (server/lib/ast.js) load this same file and always agree.
//
//   complexity = syntax-tree nodes (astdiff's parse(...).size; comments are free)
//              + one per character of string-literal text
//
// A literal is one node however long it is, so without the second term a program could hide a large
// lookup table in a single string. String text is the source between the delimiters, exactly as
// written (so "\n" is 2 characters, and a non-ASCII character is 1). Interpolated expressions are
// syntax, already counted as nodes, so they're left out. Comments stay free.
//
// It works on the tree that astdiff's parse() builds ({ kind, start, end, own, children }, where
// `own` holds the node's anonymous tokens), so there's no second parse. Each CONTAINERS entry is a
// node type whose text counts, with the child types that are syntax rather than text. A container's
// text is its span minus its own tokens (quotes, backticks, slashes, ":") and minus those children.
// Containers nested in excluded children (a string inside an f-string's {…}) count on their own.
var DbcComplexity = (() => {
  const CONTAINERS = {
    // Python (tree-sitter-python): plain, raw, bytes, triple-quoted strings, docstrings and
    // f-strings. Their text is in `string_content` children; prefixes and quotes are in
    // string_start/string_end, and f-string {…} parts are `interpolation`s.
    string: ["string_start", "string_end", "interpolation"],
    // Python f-string format specs, f"{x:spec}": the spec is literal text (a class's __format__
    // receives it as a string). Nested {…} in a spec are `format_expression`s.
    format_specifier: ["format_expression"],
    // TypeScript (tree-sitter-typescript): '…' and "…" are `string` too (quotes are anonymous
    // tokens, text is string_fragment/escape_sequence). Template literals `…${…}…`:
    template_string: ["template_substitution"],
    // Template literal types, `prefix${T}`.
    template_literal_type: ["template_type"],
    // Regex literals /pattern/flags: the pattern is text (`/…/.source` gives it back as a string).
    // The flags are a fixed alphabet, not text: they stay one node.
    regex: ["regex_flags"],
  };

  /** Characters (code points) in source[a, b). */
  function chars(source, a, b) {
    let n = 0;
    for (let i = a; i < b; i++) {
      const c = source.charCodeAt(i);
      if (c >= 0xdc00 && c <= 0xdfff && i > a) {
        const p = source.charCodeAt(i - 1);
        if (p >= 0xd800 && p <= 0xdbff) continue; // second half of a surrogate pair
      }
      n++;
    }
    return n;
  }

  /** Characters of string text in a parsed program (astdiff parse() result). */
  function stringChars(parsed) {
    const source = parsed.source;
    let total = 0;
    const stack = [parsed.root];
    while (stack.length) {
      const n = stack.pop();
      for (const c of n.children) stack.push(c);
      const syntax = CONTAINERS[n.kind];
      if (!syntax) continue;
      const cut = n.own.slice();
      for (const c of n.children) if (syntax.includes(c.kind)) cut.push([c.start, c.end]);
      cut.sort((x, y) => x[0] - y[0]);
      let at = n.start;
      for (const [s, e] of cut) {
        if (s > at) total += chars(source, at, Math.min(s, n.end));
        if (e > at) at = e;
      }
      if (n.end > at) total += chars(source, at, n.end);
    }
    return total;
  }

  /** { nodes, tree, strings }: the complexity, and its two parts. */
  function complexity(parsed) {
    const strings = stringChars(parsed);
    return { nodes: parsed.size + strings, tree: parsed.size, strings };
  }

  return { CONTAINERS, stringChars, complexity };
})();

if (typeof module !== "undefined") module.exports = DbcComplexity;
