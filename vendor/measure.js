"use strict";
// How the game measures programs. Not vendored code: it lives in /vendor because that folder is served
// to the browser, so the editor (web/src/lib/codetools.ts) and the server (server/lib/measure.js) load
// this same file and always agree. Everything works on web-tree-sitter syntax trees.
//
// size(root, source, language) → { chars, text }
//   A program's size is the length of its automatically minified form, so readable code costs nothing:
//   - comments, blank lines and spacing are dropped (Python keeps one newline per statement and one
//     space per indentation level; TypeScript gets one ";" per statement)
//   - every name the program binds (variables, functions, classes, parameters, imports) is renamed to
//     the shortest free name, most-used first. A name's first 20 characters are free; longer names pay
//     for the rest, because a program can read its own names back (globals(), __name__, …)
//   - TypeScript types are removed, as they are before the program runs
//   Everything else counts as written: strings and numbers character by character, keywords,
//   operators, attribute and keyword-argument names, and names the program uses but doesn't bind.
//
// changes(oldRoot, oldSource, newRoot, newSource, language) → number
//   How much a program changed between rounds: the edit distance (characters inserted, deleted or
//   replaced) between the two minified forms. The new version's names are first matched to the old
//   version's by where they occur, so renaming a variable costs nothing.
//
// marks(oldSource, newSource) → { old, new }
//   Character ranges [start, end, "del" | "ins"] that differ between two sources, for the editor.
var DbcMeasure = (() => {
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
   * The minified program. chooseNames(uses, reserved) maps every renamable name to its replacement
   * (uses: name → count, in order of first use; reserved: names a replacement must avoid). Returns the
   * text, the replacements, and `occurrences`: the original renamed names in the order they appear.
   */
  function minify(root, source, language, chooseNames = byUse) {
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

  // ---------------------------------------------------------------- the three measures
  function size(root, source, language) {
    const m = minify(root, source, language);
    let surcharge = 0;
    for (const name of m.names.keys()) surcharge += Math.max(0, codePoints(name) - FREE_NAME_CHARS);
    return { chars: codePoints(m.text) + surcharge, text: m.text };
  }

  const MARK = "\u0001"; // stands for every renamed name when lining two versions up
  const MAX_ALIGN = 1500; // edits beyond which two versions aren't worth lining up name by name

  function changes(oldRoot, oldSource, newRoot, newSource, language) {
    const before = minify(oldRoot, oldSource, language);
    // Line up the two versions with every renamed name blanked out; names that sit in matching
    // stretches vote for being the same variable.
    const blank = (uses) => new Map([...uses.keys()].map((k) => [k, MARK]));
    const a = minify(oldRoot, oldSource, language, blank), b = minify(newRoot, newSource, language, blank);
    const votes = new Map();
    const runs = equalRuns(a.text, b.text, MAX_ALIGN) || [];
    const markIndex = (text) => { const idx = []; for (let i = 0; i < text.length; i++) if (text[i] === MARK) idx.push(i); return idx; };
    const aMarks = markIndex(a.text), bMarks = markIndex(b.text);
    const aOcc = new Map(aMarks.map((pos, i) => [pos, a.occurrences[i]])), bOcc = new Map(bMarks.map((pos, i) => [pos, b.occurrences[i]]));
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
    return levenshtein([...before.text], [...after.text]);
  }

  function marks(oldSource, newSource) {
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

  return { size, changes, marks, FREE_NAME_CHARS };
})();

if (typeof module !== "undefined") module.exports = DbcMeasure;
