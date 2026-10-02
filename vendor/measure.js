"use strict";
// How the game measures programs. Not vendored code: it lives in /vendor because that folder is served
// to the browser, so the editor (web/src/lib/codetools.ts) and the server (server/lib/measure.js) load
// this same file and always agree. Everything works on web-tree-sitter syntax trees.
//
// size(root, source, language) → { size, text }
//   A program's size is the weighted number of syntax-tree nodes in its automatically minified form,
//   and the minified form is what the game runs. So readable code costs nothing, and names can't carry
//   hidden data:
//   - comments, blank lines and spacing are dropped (Python keeps one newline per statement and one
//     space per indentation level; TypeScript gets one ";" per statement)
//   - every name the program binds (variables, functions, parameters, imports) is renamed to the
//     shortest free name, most-used first. Renaming must never change what the program does, so a few
//     names keep their spelling: names bound in a class body (they're attributes), parameters that are
//     also passed by keyword somewhere, names that shadow a builtin, the first part of a dotted import,
//     and the names the game looks up (flower, forage, tasted, GAME)
//   - TypeScript types are removed, as they are before the program runs
//   Every node counts 1, except:
//   - a literal (string, number, regex, template text) counts one per byte of its text, at least 1,
//     so data can't hide in constants either; expressions embedded in a string count as nodes
//   - a name kept verbatim counts 1, plus one per byte beyond 20
//   - comments, types and parentheses count nothing
//
// changes(oldRoot, oldSource, newRoot, newSource, language) → number
//   How much a program changed: the weighted tree edit distance between the two minified versions.
//   Inserting or deleting a node costs its weight; changing a literal costs the byte-level edit
//   distance between the two texts. The new version's names are first matched to the old version's
//   by where they occur, so renaming a variable costs nothing.
//
// marks(oldRoot, oldSource, newRoot, newSource, language) → { old, new }
//   The tree edit's operations as source ranges [start, end, "del" | "ins" | "rel"], for the editor;
//   a changed literal is marked byte by byte where it differs.
var DbcMeasure = (() => {
  const KEEP = new Set(["flower", "forage", "tasted", "GAME"]); // looked up by name
  const BUILTINS = {
    python: new Set("ArithmeticError AssertionError AttributeError BaseException BaseExceptionGroup BlockingIOError BrokenPipeError BufferError BytesWarning ChildProcessError ConnectionAbortedError ConnectionError ConnectionRefusedError ConnectionResetError DeprecationWarning EOFError Ellipsis EncodingWarning EnvironmentError Exception ExceptionGroup False FileExistsError FileNotFoundError FloatingPointError FutureWarning GeneratorExit IOError ImportError ImportWarning IndentationError IndexError InterruptedError IsADirectoryError KeyError KeyboardInterrupt LookupError MemoryError ModuleNotFoundError NameError None NotADirectoryError NotImplemented NotImplementedError OSError OverflowError PendingDeprecationWarning PermissionError ProcessLookupError RecursionError ReferenceError ResourceWarning RuntimeError RuntimeWarning StopAsyncIteration StopIteration SyntaxError SyntaxWarning SystemError SystemExit TabError TimeoutError True TypeError UnboundLocalError UnicodeDecodeError UnicodeEncodeError UnicodeError UnicodeTranslateError UnicodeWarning UserWarning ValueError Warning ZeroDivisionError abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex copyright credits delattr dict dir divmod enumerate eval exec exit filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len license list locals map max memoryview min next object oct open ord pow print property quit range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip".split(" ")),
    typescript: new Set(("Infinity NaN undefined globalThis Object Function Array Number parseFloat parseInt Boolean String " +
      "Symbol Date Promise RegExp Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError " +
      "JSON Math Intl ArrayBuffer SharedArrayBuffer DataView Uint8Array Int8Array Uint16Array Int16Array Uint32Array " +
      "Int32Array Float32Array Float64Array Uint8ClampedArray BigUint64Array BigInt64Array Map Set WeakMap WeakSet WeakRef " +
      "FinalizationRegistry BigInt Proxy Reflect Atomics decodeURI decodeURIComponent encodeURI encodeURIComponent escape " +
      "unescape isFinite isNaN console structuredClone queueMicrotask arguments").split(" ")),
  };
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
  const isComment = (n) => n.type === "comment" || n.type === "line_continuation" || n.type === "hash_bang_line";

  // ---------------------------------------------------------------- which names the program binds
  /** { bound, keepSpelling }: names the program binds, and those renaming could break. */
  function pythonBindings(root, src) {
    const bound = new Set(), keepSpelling = new Set(), params = new Set(), keywords = new Set();
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
      if (t === "class_definition") classAttributes(f("body"));
      if (t === "keyword_argument") keywords.add(text(f("name")));
      if (t === "parameters" || t === "lambda_parameters") {
        const param = (c) => { targets(c); if (c && c.type === "identifier") params.add(text(c)); };
        for (const [c] of kids(n)) {
          if (c.type === "identifier") param(c);
          else if (c.type === "default_parameter" || c.type === "typed_default_parameter") param(c.childForFieldName("name"));
          else if (c.type === "typed_parameter") { for (const [d] of kids(c)) if (d.type === "identifier" || d.type.endsWith("splat_pattern")) { param(d); break; } }
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
            if (!ids.length) continue;
            if (t === "import_statement") {
              bound.add(text(ids[0]));
              if (ids.length > 1) keepSpelling.add(text(ids[0])); // import a.b binds a, and a.b must still work
            } else bound.add(text(ids[ids.length - 1]));
          }
        }
      }
      for (const [c] of kids(n)) walk(c);
    };
    // Names bound directly in a class body are attributes, read as obj.name.
    function classAttributes(block) {
      if (!block) return;
      const visit = (m) => {
        for (const [c] of kids(m)) {
          if (c.type === "function_definition" || c.type === "class_definition") { const nm = c.childForFieldName("name"); if (nm) keepSpelling.add(text(nm)); continue; }
          if (c.type === "assignment" || c.type === "augmented_assignment") {
            const collect = (x) => { if (!x) return; if (x.type === "identifier") keepSpelling.add(text(x)); else for (const [d] of kids(x)) if (named(d)) collect(d); };
            collect(c.childForFieldName("left"));
          }
          if (named(c) && c.type !== "lambda") visit(c);
        }
      };
      visit(block);
    }
    walk(root);
    for (const p of params) if (keywords.has(p)) keepSpelling.add(p); // f(size=3) needs the parameter named size
    return { bound, keepSpelling };
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
    return { bound, keepSpelling: new Set() };
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
  const TS_SKIP = new Set(["type_annotation", "type_alias_declaration", "interface_declaration", "type_parameters", "type_arguments",
    "accessibility_modifier", "override_modifier", "ambient_declaration", "implements_clause", "asserts_annotation",
    "type_predicate_annotation", "omitting_type_annotation", "opting_type_annotation", "function_signature", "method_signature",
    "abstract_method_signature", "index_signature", "empty_statement"]);
  const TS_TYPE_WORDS = new Set(["readonly", "declare", "abstract", "override"]);
  const TS_HOLDERS = new Set(["program", "statement_block", "class_body", "switch_case", "switch_default"]);
  const TS_TERMINATED = new Set(["expression_statement", "lexical_declaration", "variable_declaration", "return_statement",
    "throw_statement", "break_statement", "continue_statement", "do_statement", "debugger_statement", "public_field_definition",
    "import_statement", "export_statement"]);

  /** Most-used names get the shortest replacements. */
  function byUse(uses, reserved) {
    const order = [...uses.keys()];
    const rank = order.slice().sort((a, b) => uses.get(b) - uses.get(a) || order.indexOf(a) - order.indexOf(b));
    const names = new Map(), gen = shortNames(reserved);
    for (const name of rank) names.set(name, gen.next().value);
    return names;
  }

  /**
   * Which identifiers minifying renames: { isRenamable(node, parent, field), uses: name → count (in
   * order of first use), reserved: names a replacement must avoid }.
   */
  function analyzeNames(root, source, language) {
    const ts = language === "typescript";
    const text = (n) => source.slice(n.startIndex, n.endIndex);
    const { bound, keepSpelling } = ts ? typescriptBindings(root, source) : pythonBindings(root, source);
    const builtins = BUILTINS[ts ? "typescript" : "python"];
    for (const b of [...bound]) if (KEEP.has(b) || keepSpelling.has(b) || builtins.has(b) || /^__.*__$/.test(b)) bound.delete(b);
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
    return { isRenamable, uses, reserved };
  }

  /**
   * The minified program. chooseNames(uses, reserved) maps every renamable name to its replacement
   * (default: most-used first). Returns the text, the replacements, and `occurrences`: the original
   * renamed names in the order they appear.
   */
  function minify(root, source, language, chooseNames = byUse) {
    const ts = language === "typescript";
    const word = ts ? /[A-Za-z0-9_$\u0080-\uffff]/ : /[A-Za-z0-9_\u0080-\uffff]/;
    const text = (n) => source.slice(n.startIndex, n.endIndex);
    const { isRenamable, uses, reserved } = analyzeNames(root, source, language);
    const short = chooseNames(uses, reserved);
    const occurrences = [];
    const renamed = (name) => { occurrences.push(name); return short.get(name); };

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
          put(text(n) + ":" + renamed(text(n)));
          return;
        }
        put(isRenamable(n, parent, field) ? renamed(text(n)) : text(n));
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
          if (short.has(binds)) { put("as"); put(renamed(binds)); }
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
    return { text: out, names: short, occurrences, reserved };
  }

  // ---------------------------------------------------------------- syntax trees for the node measure
  // A program as a tree of weighted nodes, read off the same syntax tree the minifier uses, so it is the
  // minified program's tree: comments, TypeScript types and redundant parentheses aren't nodes. Each node
  // weighs 1, except
  //   - a literal (string, number, regex) weighs one per byte of its text; expressions embedded in a
  //     string (f-string {…}, template ${…}) are nodes of their own
  //   - a name that minifying can't rename (attribute and keyword names, names it must keep) weighs one
  //     plus one per byte beyond 20, because it still exists when the program runs
  // A node's label is what a relabel changes: its type and keywords/operators, a name (renamed names by
  // their replacement, so renaming is free), or a literal's text.
  const LITERALS = { python: new Set(["string", "integer", "float"]), typescript: new Set(["string", "template_string", "number", "regex"]) };
  const NAMES = new Set(["identifier", "property_identifier", "shorthand_property_identifier", "shorthand_property_identifier_pattern", "statement_identifier"]);
  const PUNCTUATION = new Set(["(", ")", "[", "]", "{", "}", ",", ";", ":", "."]);
  const FREE_NAME_BYTES = 20;
  /** UTF-8 bytes of a string. */
  function utf8(s) {
    const out = [];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  const bytes = (s) => utf8(s).length;

  function nodeTree(root, source, language, names) {
    const ts = language === "typescript";
    const { isRenamable } = analyzeNames(root, source, language);
    const literal = LITERALS[ts ? "typescript" : "python"];
    const text = (n) => source.slice(n.startIndex, n.endIndex);

    // A literal's own text as source segments (everything but its quotes and prefix and the
    // expressions embedded in it, so format specs and braces count), and the embedded expressions.
    function literalParts(n) {
      if (n.type === "string" || n.type === "template_string") {
        const segs = [], exprs = [];
        let at = n.startIndex;
        const cut = (a, b) => { if (a > at) segs.push([at, a]); at = Math.max(at, b); };
        const visit = (m) => {
          for (const [c, f] of kids(m)) {
            if (["string_start", "string_end", "\"", "'", "`"].includes(c.type)) cut(c.startIndex, c.endIndex);
            else if (((m.type === "interpolation" || m.type === "format_expression") && f === "expression") ||
                     (m.type === "template_substitution" && named(c))) { cut(c.startIndex, c.endIndex); exprs.push(c); }
            else if (c.childCount) visit(c);
          }
        };
        visit(n);
        cut(n.endIndex, n.endIndex);
        return { segs, exprs };
      }
      if (n.type === "regex") return { segs: [[n.startIndex + 1, n.endIndex]], exprs: [] }; // pattern/flags
      return { segs: [[n.startIndex, n.endIndex]], exprs: [] };
    }

    function build(n, parent, field) {
      const t = n.type;
      if (isComment(n)) return null;
      if (ts && TS_SKIP.has(t)) return null;
      if (t === "parenthesized_expression" || (ts && ["as_expression", "satisfies_expression", "non_null_expression", "type_assertion"].includes(t))) {
        const inner = kids(n).map(([c]) => c).filter((c) => named(c) && !isComment(c) && !TS_SKIP.has(c.type));
        if (inner.length === 1) return build(inner[0], n, null);
      }
      if (literal.has(t)) {
        const { segs, exprs } = literalParts(n);
        const lit = segs.map(([a, b]) => source.slice(a, b)).join("");
        return { label: `lit:${t}:${lit}`, lit, ltype: t, segs, w: Math.max(1, bytes(lit)), span: [n.startIndex, n.endIndex],
          children: exprs.map((e) => build(e, n, null)).filter(Boolean) };
      }
      if (NAMES.has(t) && n.childCount === 0) {
        const own = text(n);
        if (t === "identifier" && isRenamable(n, parent, field)) return { label: "id:" + names.get(own), w: 1, own: [[n.startIndex, n.endIndex]], children: [] };
        return { label: "name:" + own, w: 1 + Math.max(0, bytes(own) - FREE_NAME_BYTES), own: [[n.startIndex, n.endIndex]], children: [] };
      }
      const tokens = [], own = [], children = [];
      for (const [c, f] of kids(n)) {
        if (isComment(c)) continue;
        if (named(c)) { const b = build(c, n, f); if (b) children.push(b); continue; }
        if (ts && TS_TYPE_WORDS.has(c.type)) continue;
        if (c.childCount) { const b = build(c, n, f); if (b) children.push(...(b.label === "" ? b.children : [b])); continue; }
        if (c.endIndex > c.startIndex) own.push([c.startIndex, c.endIndex]);
        if (!PUNCTUATION.has(c.type)) tokens.push(c.type);
      }
      if (n.childCount === 0) own.push([n.startIndex, n.endIndex]);
      const label = t + (tokens.length ? "[" + tokens.join(" ") + "]" : "") + (n.childCount === 0 ? "=" + text(n) : "");
      return { label, w: 1, own, children };
    }
    return build(root, null, null);
  }

  const weight = (t) => t.w + t.children.reduce((a, c) => a + weight(c), 0);

  /** Relabelling cost: literals by their byte-level edit distance, names and syntax by 1. */
  function relabel(a, b) {
    if (a.label === b.label) return 0;
    if (a.lit !== undefined && b.lit !== undefined) return levenshtein(utf8(a.lit), utf8(b.lit)) + (a.ltype === b.ltype ? 0 : 1);
    if (a.lit !== undefined || b.lit !== undefined) return a.w + b.w;
    return Math.max(1, Math.abs(a.w - b.w));
  }

  /** Zhang–Shasha tree edit distance with weighted inserts and deletes; returns { distance, mapping }. */
  function treeDiff(rootA, rootB) {
    const post = (root) => {
      const nodes = [null], lld = [0], stack = [{ node: root, i: 0, first: -1 }];
      let returned = -1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (returned >= 0) { if (top.first < 0) top.first = returned; returned = -1; }
        if (top.i < top.node.children.length) { stack.push({ node: top.node.children[top.i++], i: 0, first: -1 }); continue; }
        stack.pop();
        nodes.push(top.node);
        const idx = nodes.length - 1;
        lld.push(top.first < 0 ? idx : top.first);
        returned = lld[idx];
      }
      const n = nodes.length - 1, seen = new Set(), keyroots = [];
      for (let i = n; i >= 1; i--) if (!seen.has(lld[i])) { seen.add(lld[i]); keyroots.push(i); }
      keyroots.sort((a, b) => a - b);
      return { nodes, lld, keyroots, n };
    };
    const A = post(rootA), B = post(rootB), n = A.n, m = B.n;
    const del = A.nodes.map((x) => x && x.w), ins = B.nodes.map((x) => x && x.w);
    const relCache = new Map();
    const rel = (x, y) => {
      const a = A.nodes[x], b = B.nodes[y];
      if (a.label === b.label) return 0;
      if (a.lit === undefined && b.lit === undefined) return relabel(a, b);
      const k = x * (m + 1) + y;
      let v = relCache.get(k);
      if (v === undefined) { v = relabel(a, b); relCache.set(k, v); }
      return v;
    };
    const W = m + 1, FW = m + 2;
    const TD = new Float64Array((n + 1) * W), FD = new Float64Array((n + 2) * FW);
    function forest(i, j, store) {
      const l1 = A.lld[i], l2 = B.lld[j], r0 = l1 - 1, c0 = l2 - 1;
      FD[0] = 0;
      for (let x = l1; x <= i; x++) FD[(x - r0) * FW] = FD[(x - 1 - r0) * FW] + del[x];
      for (let y = l2; y <= j; y++) FD[y - c0] = FD[y - 1 - c0] + ins[y];
      for (let x = l1; x <= i; x++) {
        const lx = A.lld[x], rx = (x - r0) * FW, rp = (x - 1 - r0) * FW;
        for (let y = l2; y <= j; y++) {
          const ly = B.lld[y], cy = y - c0;
          const d = FD[rp + cy] + del[x], a = FD[rx + cy - 1] + ins[y];
          let v;
          if (lx === l1 && ly === l2) {
            v = Math.min(d, a, FD[rp + cy - 1] + rel(x, y));
            if (store) TD[x * W + y] = v;
          } else v = Math.min(d, a, FD[(lx - 1 - r0) * FW + (ly - 1 - c0)] + TD[x * W + y]);
          FD[rx + cy] = v;
        }
      }
    }
    for (const i of A.keyroots) for (const j of B.keyroots) forest(i, j, true);
    const distance = TD[n * W + m];
    const mapping = [], pairs = [[n, m]];
    while (pairs.length) {
      const [i, j] = pairs.pop();
      forest(i, j, false);
      const l1 = A.lld[i], l2 = B.lld[j], r0 = l1 - 1, c0 = l2 - 1;
      let x = i, y = j;
      while (x >= l1 || y >= l2) {
        const cur = FD[(x - r0) * FW + (y - c0)];
        if (x >= l1 && cur === FD[(x - 1 - r0) * FW + (y - c0)] + del[x]) { mapping.push([A.nodes[x], null]); x--; }
        else if (y >= l2 && cur === FD[(x - r0) * FW + (y - 1 - c0)] + ins[y]) { mapping.push([null, B.nodes[y]]); y--; }
        else if (A.lld[x] === l1 && B.lld[y] === l2) { mapping.push([A.nodes[x], B.nodes[y]]); x--; y--; }
        else { pairs.push([x, y]); x = A.lld[x] - 1; y = B.lld[y] - 1; }
      }
    }
    return { distance, mapping };
  }

  // ---------------------------------------------------------------- the measures
  function size(root, source, language) {
    const m = minify(root, source, language);
    return { size: weight(nodeTree(root, source, language, m.names)), text: m.text };
  }

  const MARK = "\u0001"; // stands for every renamed name when lining two versions up
  const MAX_ALIGN = 1500; // edits beyond which two versions aren't worth lining up name by name

  /** Short names for both versions, with the new version's variables matched to the old version's. */
  function alignNames(oldRoot, oldSource, newRoot, newSource, language) {
    const before = minify(oldRoot, oldSource, language);
    // Line up the two versions with every renamed name blanked out; names that sit in matching
    // stretches vote for being the same variable.
    const blank = (uses) => new Map([...uses.keys()].map((k) => [k, MARK]));
    const a = minify(oldRoot, oldSource, language, blank), b = minify(newRoot, newSource, language, blank);
    const votes = new Map();
    const runs = equalRuns(a.text, b.text, MAX_ALIGN) || [];
    const markIndex = (text) => { const idx = []; for (let i = 0; i < text.length; i++) if (text[i] === MARK) idx.push(i); return idx; };
    const aOcc = new Map(markIndex(a.text).map((pos, i) => [pos, a.occurrences[i]]));
    const bOcc = new Map(markIndex(b.text).map((pos, i) => [pos, b.occurrences[i]]));
    for (const [i, j, len] of runs) {
      for (let k = 0; k < len; k++) {
        if (a.text[i + k] !== MARK) continue;
        const key = bOcc.get(j + k) + "\u0000" + aOcc.get(i + k);
        votes.set(key, (votes.get(key) || 0) + 1);
      }
    }
    const matched = new Map(), taken = new Set();
    for (const [key] of [...votes].sort((x, y) => y[1] - x[1])) {
      const [newName, oldName] = key.split("\u0000");
      if (!matched.has(newName) && !taken.has(oldName)) { matched.set(newName, oldName); taken.add(oldName); }
    }
    // The new version keeps the old version's short names for matched variables.
    const after = minify(newRoot, newSource, language, (uses, reserved) => {
      const fresh = byUse(new Map([...uses].filter(([k]) => !matched.has(k))), new Set([...reserved, ...before.names.values()]));
      return new Map([...uses.keys()].map((k) => [k, matched.has(k) ? before.names.get(matched.get(k)) : fresh.get(k)]));
    });
    return { before, after };
  }

  function changes(oldRoot, oldSource, newRoot, newSource, language) {
    const { before, after } = alignNames(oldRoot, oldSource, newRoot, newSource, language);
    return treeDiff(nodeTree(oldRoot, oldSource, language, before.names), nodeTree(newRoot, newSource, language, after.names)).distance;
  }

  /** What changed: the tree diff's operations as marks on each source (literals byte by byte). */
  function marks(oldRoot, oldSource, newRoot, newSource, language) {
    const { before, after } = alignNames(oldRoot, oldSource, newRoot, newSource, language);
    const { mapping } = treeDiff(nodeTree(oldRoot, oldSource, language, before.names), nodeTree(newRoot, newSource, language, after.names));
    const out = { old: [], new: [] };
    const spans = (t) => t.own || (t.span ? [t.span] : []);
    for (const [x, y] of mapping) {
      if (x && !y) for (const [a, b] of spans(x)) out.old.push([a, b, "del"]);
      else if (!x && y) for (const [a, b] of spans(y)) out.new.push([a, b, "ins"]);
      else if (x.label !== y.label) {
        if (x.lit !== undefined && y.lit !== undefined) {
          // Byte-level: mark the characters of each literal's text that differ.
          const tm = textMarks(x.lit, y.lit), at = (segs, k) => { for (const [a, b] of segs) { if (k < b - a) return a + k; k -= b - a; } return segs.length ? segs[segs.length - 1][1] : 0; };
          for (const [a, b, c] of tm.old) out.old.push([at(x.segs, a), at(x.segs, b - 1) + 1, c]);
          for (const [a, b, c] of tm.new) out.new.push([at(y.segs, a), at(y.segs, b - 1) + 1, c]);
        } else {
          for (const [a, b] of spans(x)) out.old.push([a, b, "rel"]);
          for (const [a, b] of spans(y)) out.new.push([a, b, "rel"]);
        }
      }
    }
    return out;
  }

  /** Character ranges that differ between two texts (inside a changed literal). */
  function textMarks(oldSource, newSource) {
    const runs = equalRuns(oldSource, newSource, MAX_ALIGN);
    const out = { old: [], new: [] };
    if (!runs) {
      // Too different to line up: mark everything between the common start and end.
      let p = 0;
      while (p < oldSource.length && p < newSource.length && oldSource[p] === newSource[p]) p++;
      let q = 0;
      while (q < oldSource.length - p && q < newSource.length - p && oldSource[oldSource.length - 1 - q] === newSource[newSource.length - 1 - q]) q++;
      if (oldSource.length - q > p) out.old.push([p, oldSource.length - q, "del"]);
      if (newSource.length - q > p) out.new.push([p, newSource.length - q, "ins"]);
      return out;
    }
    let i = 0, j = 0;
    for (const [ri, rj, len] of [...runs, [oldSource.length, newSource.length, 0]]) {
      if (ri > i) out.old.push([i, ri, "del"]);
      if (rj > j) out.new.push([j, rj, "ins"]);
      i = ri + len; j = rj + len;
    }
    return out;
  }

  // ---------------------------------------------------------------- text diffs
  /** Myers' diff: the stretches [i, j, length] where a and b agree, or null if they differ in more than maxD edits. */
  function equalRuns(a, b, maxD) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const n = a.length - pre - suf, m = b.length - pre - suf;
    const A = (x) => a[pre + x], B = (y) => b[pre + y];
    const max = n + m, OFF = max + 1, V = new Int32Array(2 * max + 3), hist = [];
    let dEnd = -1;
    search: for (let d = 0; d <= Math.min(max, maxD); d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && V[OFF + k - 1] < V[OFF + k + 1]) ? V[OFF + k + 1] : V[OFF + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && A(x) === B(y)) { x++; y++; }
        V[OFF + k] = x;
        if (x >= n && y >= m) { hist.push(V.slice(OFF - d, OFF + d + 1)); dEnd = d; break search; }
      }
      hist.push(V.slice(OFF - d, OFF + d + 1));
    }
    if (dEnd < 0) return null;
    const runs = [];
    let x = n, y = m;
    for (let d = dEnd; d > 0; d--) {
      const prev = (k) => hist[d - 1][k + d - 1];
      const k = x - y;
      const pk = k === -d || (k !== d && prev(k - 1) < prev(k + 1)) ? k + 1 : k - 1;
      const px = prev(pk), py = px - pk;
      const sx = pk === k + 1 ? px : px + 1; // where this step's snake starts
      if (x > sx) runs.push([pre + sx, pre + sx - k, x - sx]);
      x = px; y = py;
    }
    if (x > 0) runs.push([pre, pre, x]);
    runs.reverse();
    if (pre) runs.unshift([0, 0, pre]);
    if (suf) runs.push([a.length - suf, b.length - suf, suf]);
    return runs;
  }

  /** Characters inserted, deleted or replaced to turn a into b (arrays of characters). */
  function levenshtein(a, b) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    const n = a.length - s - e, m = b.length - s - e;
    if (!n || !m) return n + m;
    let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      const ai = a[s + i - 1];
      for (let j = 1; j <= m; j++) {
        const sub = prev[j - 1] + (ai === b[s + j - 1] ? 0 : 1);
        cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[m];
  }

  return { size, changes, marks };
})();

if (typeof module !== "undefined") module.exports = DbcMeasure;
