"use strict";
// The game's complexity rule: a program's size is the length of its automatically minified form.
// Not vendored code: it lives in /vendor because that folder is served to the browser, so the editor
// (web/src/lib/codetools.ts) and the server (server/lib/ast.js) load this same file and always agree.
//
// Minifying makes the count independent of how readable the code is:
//   - comments, blank lines and spacing are dropped (Python keeps one newline per statement and one
//     space per indentation level; TypeScript gets one ";" per statement)
//   - every name the program binds (variables, functions, classes, parameters, imports) is renamed to
//     the shortest free name, most-used first, so descriptive names cost nothing extra. A name's first
//     20 characters are free; longer names pay for the rest, because a program can read its own names
//     back (globals(), __name__, …) and could otherwise hide data in them
//   - TypeScript types are removed, as they are before the program runs
// Everything else counts as written: strings and numbers character by character, keywords, operators,
// attribute and keyword-argument names, and names the program uses but doesn't bind (len, Math, GAME).
//
// minify(rootNode, source, language) works on a web-tree-sitter syntax tree and returns
// { text, chars, renamed }: the minified program, its size (characters of text plus long-name
// surcharges), and the number of names it renamed.
var DbcComplexity = (() => {
  const FREE_NAME_CHARS = 20;
  const KEEP = new Set(["flower", "forage", "tasted", "GAME", "MEMORY"]); // looked up by name
  const RESERVED = {
    python: new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
      "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
      "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case", "type", "_"]),
    typescript: new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
      "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new",
      "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "as",
      "implements", "interface", "let", "package", "private", "protected", "public", "static", "yield", "any", "of", "is",
      "NaN", "undefined", "Infinity"]),
  };

  const named = (n) => (typeof n.isNamed === "function" ? n.isNamed() : !!n.isNamed);
  const kids = (n) => {
    const out = [];
    for (let i = 0; i < n.childCount; i++) out.push([n.child(i), n.fieldNameForChild ? n.fieldNameForChild(i) : null]);
    return out;
  };
  const codePoints = (s) => { let k = 0; for (const _ of s) k++; return k; };
  const isComment = (n) => n.type === "comment" || n.type === "line_continuation" || n.type === "hash_bang_line";

  // ---------------------------------------------------------------- which names the program binds
  function pythonBindings(root, src) {
    const bound = new Set();
    const text = (n) => src.slice(n.startIndex, n.endIndex);
    const targets = (n) => {
      if (!n) return;
      if (n.type === "identifier") bound.add(text(n));
      else if (["pattern_list", "tuple_pattern", "list_pattern", "tuple", "list", "parenthesized_expression", "expression_list",
        "list_splat_pattern", "list_splat", "dictionary_splat_pattern", "as_pattern_target"].includes(n.type)) {
        for (const [c] of kids(n)) if (named(c)) targets(c);
      }
    };
    const walk = (n) => {
      const t = n.type;
      const f = (name) => n.childForFieldName(name);
      if (t === "function_definition" || t === "class_definition") targets(f("name"));
      else if (t === "parameters" || t === "lambda_parameters") {
        for (const [c] of kids(n)) {
          if (c.type === "identifier") targets(c);
          else if (c.type === "default_parameter" || c.type === "typed_default_parameter") targets(c.childForFieldName("name"));
          else if (c.type === "typed_parameter") { for (const [d] of kids(c)) if (d.type === "identifier" || d.type.endsWith("splat_pattern")) { targets(d); break; } }
          else if (c.type.endsWith("splat_pattern")) targets(c);
        }
      } else if (t === "assignment" || t === "augmented_assignment" || t === "for_statement" || t === "for_in_clause") targets(f("left"));
      else if (t === "as_pattern") targets(f("alias"));
      else if (t === "named_expression") targets(f("name"));
      else if (t === "global_statement" || t === "nonlocal_statement") { for (const [c] of kids(n)) if (c.type === "identifier") bound.add(text(c)); }
      else if (t === "import_statement" || t === "import_from_statement") {
        for (const [c, field] of kids(n)) {
          if (field !== "name") continue;
          if (c.type === "aliased_import") targets(c.childForFieldName("alias"));
          else if (c.type === "dotted_name") {
            const ids = kids(c).map(([d]) => d).filter((d) => d.type === "identifier");
            if (ids.length) bound.add(text(t === "import_statement" ? ids[0] : ids[ids.length - 1]));
          }
        }
      }
      for (const [c] of kids(n)) walk(c);
    };
    walk(root);
    return bound;
  }

  function typescriptBindings(root, src) {
    const bound = new Set();
    const text = (n) => src.slice(n.startIndex, n.endIndex);
    const pattern = (n) => {
      if (!n) return;
      if (n.type === "identifier" || n.type === "shorthand_property_identifier_pattern") bound.add(text(n));
      else if (n.type === "pair_pattern") pattern(n.childForFieldName("value"));
      else if (n.type === "assignment_pattern" || n.type === "object_assignment_pattern") pattern(n.childForFieldName("left"));
      else if (["object_pattern", "array_pattern", "rest_pattern"].includes(n.type)) { for (const [c] of kids(n)) if (named(c)) pattern(c); }
    };
    const walk = (n) => {
      const t = n.type, f = (name) => n.childForFieldName(name);
      if (t === "variable_declarator") pattern(f("name"));
      else if (["function_declaration", "function_expression", "function", "generator_function_declaration", "generator_function",
        "class_declaration", "class"].includes(t)) pattern(f("name"));
      else if (t === "required_parameter" || t === "optional_parameter") pattern(f("pattern"));
      else if (t === "arrow_function") pattern(f("parameter"));
      else if (t === "catch_clause") pattern(f("parameter"));
      else if (t === "for_in_statement") pattern(f("left"));
      for (const [c] of kids(n)) walk(c);
    };
    walk(root);
    return bound;
  }

  // ---------------------------------------------------------------- short names, most-used first
  function* shortNames(reserved) {
    const first = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const rest = first + "0123456789_";
    for (const a of first) if (!reserved.has(a)) yield a;
    for (let len = 2; ; len++) {
      const gen = function* (prefix, k) {
        if (k === 0) { yield prefix; return; }
        for (const c of rest) yield* gen(prefix + c, k - 1);
      };
      for (const a of first) for (const s of gen(a, len - 1)) if (!reserved.has(s)) yield s;
    }
  }

  // ---------------------------------------------------------------- emitting the minified text
  const PY_STATEMENT_HOLDERS = new Set(["module", "block"]);
  const TS_SKIP = new Set(["type_annotation", "type_alias_declaration", "interface_declaration", "type_parameters", "type_arguments",
    "accessibility_modifier", "override_modifier", "ambient_declaration", "implements_clause", "asserts_annotation",
    "type_predicate_annotation", "omitting_type_annotation", "opting_type_annotation", "function_signature", "method_signature",
    "abstract_method_signature", "index_signature", "empty_statement"]);
  const TS_TYPE_WORDS = new Set(["readonly", "declare", "abstract", "override"]);
  const TS_HOLDERS = new Set(["program", "statement_block", "class_body", "switch_case", "switch_default"]);
  const TS_TERMINATED = new Set(["expression_statement", "lexical_declaration", "variable_declaration", "return_statement",
    "throw_statement", "break_statement", "continue_statement", "do_statement", "debugger_statement", "public_field_definition",
    "import_statement", "export_statement"]);

  function minify(root, source, language) {
    const ts = language === "typescript";
    const word = ts ? /[A-Za-z0-9_$\u0080-\uffff]/ : /[A-Za-z0-9_\u0080-\uffff]/;
    const text = (n) => source.slice(n.startIndex, n.endIndex);

    // Count how often each bound name is used, then hand out short names, most-used first.
    const bound = ts ? typescriptBindings(root, source) : pythonBindings(root, source);
    for (const k of KEEP) bound.delete(k);
    for (const b of [...bound]) if (/^__.*__$/.test(b)) bound.delete(b);
    const isRenamable = (n, parent, field) => {
      if (n.type !== "identifier" || !bound.has(text(n))) return false;
      if (ts || !parent) return true;
      if (parent.type === "attribute" && field === "attribute") return false;   // obj.name
      if (parent.type === "keyword_argument" && field === "name") return false; // f(name=…)
      return parent.type !== "dotted_name";                                     // module paths
    };
    const uses = new Map(), verbatim = new Set();
    (function count(n, parent, field) {
      if (n.type === "identifier") {
        const s = text(n);
        if (isRenamable(n, parent, field)) uses.set(s, (uses.get(s) || 0) + 1);
        else verbatim.add(s);
      }
      for (const [c, f] of kids(n)) count(c, n, f);
    })(root, null, null);
    const reserved = new Set([...RESERVED[ts ? "typescript" : "python"], ...verbatim, ...KEEP]);
    const order = [...uses.keys()];
    const rank = order.slice().sort((a, b) => uses.get(b) - uses.get(a) || order.indexOf(a) - order.indexOf(b));
    const short = new Map(), gen = shortNames(reserved);
    for (const name of rank) short.set(name, gen.next().value);
    let surcharge = 0;
    for (const name of short.keys()) surcharge += Math.max(0, codePoints(name) - FREE_NAME_CHARS);

    // Output: lines of tokens with their indentation depth (TypeScript stays on one line).
    const lines = [];
    let line = null, pendingDepth = null;
    const newLine = (depth) => { line = { depth, s: "" }; lines.push(line); };
    const put = (tok) => {
      if (!tok) return;
      if (pendingDepth !== null) { newLine(pendingDepth); pendingDepth = null; }
      if (!line) newLine(0);
      const prev = line.s[line.s.length - 1];
      const glue = prev && ((word.test(prev) && word.test(tok[0])) || (prev === "+" && tok[0] === "+") || (prev === "-" && tok[0] === "-"));
      line.s += (glue ? " " : "") + tok;
    };

    // An expression inside a string, minified on its own.
    function inline(n, parent, field) {
      const saved = { line, pendingDepth, count: lines.length };
      line = { depth: 0, s: "" }; pendingDepth = null;
      const tmp = line;
      emit(n, 0, parent, field);
      lines.length = saved.count; line = saved.line; pendingDepth = saved.pendingDepth;
      return tmp.s;
    }
    // A string literal: its text exactly as written, except that embedded expressions
    // (f-string {…} and format-spec {…}, template ${…}) are minified like any other code.
    function stringText(n) {
      let out = "", at = n.startIndex;
      const replace = (expr, parent, field) => {
        out += source.slice(at, expr.startIndex) + inline(expr, parent, field);
        at = expr.endIndex;
      };
      const visit = (m) => {
        for (const [c, f] of kids(m)) {
          if (c.type === "interpolation" || c.type === "format_expression") {
            const expr = c.childForFieldName("expression");
            for (const [d, g] of kids(c)) {
              if (expr && d.startIndex === expr.startIndex && d.endIndex === expr.endIndex) replace(d, c, g);
              else if (named(d)) visit(d); // format specs
            }
          } else if (c.type === "template_substitution") {
            const expr = kids(c).map(([d]) => d).find(named);
            if (expr) replace(expr, c, null);
          } else if (named(c)) visit(c);
        }
      };
      visit(n);
      return out + source.slice(at, n.endIndex);
    }

    function emit(n, depth, parent, field) {
      if (isComment(n)) return;
      const t = n.type;
      if (ts) {
        if (TS_SKIP.has(t)) return;
        if (t === "as_expression" || t === "satisfies_expression" || t === "non_null_expression" || t === "type_assertion") {
          const inner = kids(n).map(([c]) => c).filter(named);
          const keep = t === "type_assertion" ? inner[inner.length - 1] : inner[0];
          if (keep) emit(keep, depth, n, null);
          return;
        }
      }
      if (t === "string" || t === "template_string") { put(stringText(n)); return; }
      if (n.childCount === 0) {
        if (ts && ((TS_TYPE_WORDS.has(t) && !named(n)) || (t === "?" && parent && parent.type === "optional_parameter"))) return;
        // Statement terminators are added per statement below, whatever the author's semicolon style.
        if (ts && t === ";" && parent && TS_HOLDERS.has(parent.type)) return;
        // {name} in an object or a destructuring pattern is both a key and a variable: {name: short}.
        if (ts && (t === "shorthand_property_identifier" || t === "shorthand_property_identifier_pattern") && short.has(text(n))) {
          put(text(n) + ":" + short.get(text(n)));
          return;
        }
        put(isRenamable(n, parent, field) ? short.get(text(n)) : text(n));
        return;
      }
      if (!ts && (t === "module" || t === "block")) {
        // One statement per line; ";" separators and comments go.
        const inner = t === "block" ? depth + 1 : 0;
        for (const [c, f] of kids(n)) {
          if (isComment(c) || c.type === ";") continue;
          if (!named(c)) { emit(c, depth, n, f); continue; }
          pendingDepth = null;
          newLine(inner);
          emit(c, inner, n, f);
        }
        if (t === "block") pendingDepth = depth; // a following elif/else/except/finally starts a new line
        return;
      }
      if (!ts && (t === "import_statement" || t === "import_from_statement")) {
        // Imported names are renamed too, which means an implied "as x" after each one.
        for (const [c, f] of kids(n)) {
          if (f !== "name" || c.type !== "dotted_name") { emit(c, depth, n, f); continue; }
          put(text(c).replace(/\s+/g, ""));
          const ids = kids(c).map(([d]) => d).filter((d) => d.type === "identifier");
          const binds = text(t === "import_statement" ? ids[0] : ids[ids.length - 1]);
          if (short.has(binds)) { put("as"); put(short.get(binds)); }
        }
        return;
      }
      for (const [c, f] of kids(n)) {
        emit(c, depth, n, f);
        if (!ts && c.type === "decorator") pendingDepth = depth;
      }
      if (ts && TS_TERMINATED.has(t) && !(line && line.s.endsWith(";"))) put(";");
    }

    emit(root, -1, null, null);
    const out = lines.filter((l) => l.s.length).map((l) => (ts ? "" : " ".repeat(Math.max(0, l.depth))) + l.s).join(ts ? "" : "\n");
    return { text: out, chars: codePoints(out) + surcharge, renamed: short.size };
  }

  return { minify, FREE_NAME_CHARS };
})();

if (typeof module !== "undefined") module.exports = DbcComplexity;
