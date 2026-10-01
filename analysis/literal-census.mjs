// Literal-storage census: how did programs actually use literals? Every distinct program in round_programs
// (deduplicated by code), parsed with the game's own tree-sitter grammars (vendor/grammars):
//   - string literals: content length; integer literals: digit count; float literals
//   - constant containers: list/tuple/set/dict (array/object in TypeScript) displays whose elements are all literals
//     (recursively): element count and source characters, i.e. data tables written out in the code
//   - per program: the largest of each, the share of the code's characters inside literals, and whether long
//     literals are decoded at run time (base64 / zlib / bytes.fromhex / int(…, 16) / json.loads)
// When these games were played the complexity budget counted syntax-tree nodes, so a literal's length was free; this
// measures how much that was used. (round_programs now stores complexity as minified characters, `chars`.)
//
//   node analysis/literal-census.mjs
// Writes arena/runs/literal-census.json.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { all, pool, ARENA_DIR } from "../arena/lib/db.js";

const require = createRequire(import.meta.url);
const Parser = require("web-tree-sitter");
const GRAMMARS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../vendor/grammars");
await Parser.init();
const parsers = {};
for (const lang of ["python", "typescript"]) {
  const p = new Parser();
  p.setLanguage(await Parser.Language.load(path.join(GRAMMARS, `tree-sitter-${lang}.wasm`)));
  parsers[lang] = p;
}

const rows = await all(`
  SELECT rp.code, rp.kind, rp.round_no, rp.chars AS complexity, g.config->>'language' AS lang, t.name AS team,
         ag.arena_id AS arena, ag.generation AS gen, ag.game_url AS url
    FROM round_programs rp JOIN games g ON g.id = rp.game_id JOIN teams t ON t.id = rp.team_id
    LEFT JOIN arena.games ag ON ag.game_url = (SELECT '/room/' || substr(rr.code, 1, rr.prefix_len) || '/game/' || substr(g.code, 1, g.prefix_len) FROM rooms rr WHERE rr.id = g.room_id)
   ORDER BY ag.id NULLS LAST, rp.round_no`);

const STR = new Set(["string", "template_string"]);
const INT = new Set(["integer"]);
const NUM = new Set(["number"]);
const CONTAINER = { python: new Set(["list", "tuple", "set", "dictionary"]), typescript: new Set(["array", "object"]) };
const LEAF_OK = new Set(["string", "integer", "float", "number", "true", "false", "none", "null", "unary_operator", "unary_expression", "pair", "string_content", "string_start", "string_end", "escape_sequence", "template_string", ",", "[", "]", "(", ")", "{", "}", ":", "-", "\"", "'", "`", "comment", "property_identifier"]);

function strContent(n) {
  // python: string -> string_start string_content* string_end ; ts: string -> " string_fragment "
  const t = n.text;
  const m = t.match(/^([rRbBuUfF]{0,2})("""|'''|"|'|`)([\s\S]*)\2$/);
  return m ? m[3] : t;
}
function isConstData(n, lang) {
  // a container whose descendants are all literals / punctuation
  let ok = true;
  const walk = (x) => {
    if (!ok) return;
    if (CONTAINER[lang].has(x.type) || LEAF_OK.has(x.type)) { for (const c of x.children) walk(c); return; }
    if (x.type === "string_fragment" || x.type === "interpolation" && false) return;
    if (x.type === "identifier" && lang === "typescript" && x.parent?.type === "pair") return;
    ok = false;
  };
  for (const c of n.children) walk(c);
  return ok;
}
// size of a constant container: the number of literal leaves (strings and numbers) anywhere inside it
const countElems = (n) => { let k = 0; const w = (x) => { if (STR.has(x.type) || INT.has(x.type) || NUM.has(x.type) || x.type === "float") { k++; return; } for (const c of x.children) w(c); }; for (const c of n.children) w(c); return k; };

function analyse(code, lang) {
  const tree = parsers[lang].parse(code);
  const out = { strs: [], ints: [], floats: 0, tables: [], litChars: 0 };
  const seenTable = new Set();
  const visit = (n, insideTable) => {
    if (STR.has(n.type) && !(n.parent && STR.has(n.parent.type))) {
      const s = strContent(n);
      if (!/^("""|''')/.test(n.text.replace(/^[rRbBuUfF]{0,2}/, "")) || n.parent?.type !== "expression_statement") { // skip docstrings
        out.strs.push(s.length);
        if (!insideTable) out.litChars += n.text.length;
      }
      return;
    }
    if (INT.has(n.type) || (NUM.has(n.type) && /^-?(0x[0-9a-f]+|\d+)n?$/i.test(n.text))) {
      const d = n.text.replace(/^0[xob]/i, "").replace(/[_n]/g, "").length;
      out.ints.push(d);
      if (!insideTable) out.litChars += n.text.length;
      return;
    }
    if (n.type === "float" || NUM.has(n.type)) { out.floats++; return; }
    if (CONTAINER[lang].has(n.type) && !insideTable && isConstData(n, lang)) {
      const elems = countElems(n);
      if (elems >= 2) { out.tables.push({ elems, chars: n.text.length, text: n.text.slice(0, 120) }); out.litChars += n.text.length; seenTable.add(n.id); }
      for (const c of n.children) visit(c, true);
      return;
    }
    for (const c of n.children) visit(c, insideTable);
  };
  visit(tree.rootNode, false);
  tree.delete();
  return out;
}

const seen = new Map();
for (const r of rows) {
  if (seen.has(r.code)) { seen.get(r.code).uses++; continue; }
  const a = analyse(r.code, r.lang === "typescript" ? "typescript" : "python");
  const codeNoComments = r.code.replace(/^\s*#.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");
  seen.set(r.code, {
    kind: r.kind, lang: r.lang, arena: r.arena ?? "(non-arena)", gen: r.gen, url: r.url, team: r.team, round: r.round_no, complexity: r.complexity, chars: r.code.length, uses: 1,
    maxStr: Math.max(0, ...a.strs), nStr: a.strs.length, strs: a.strs, maxInt: Math.max(0, ...a.ints), nInt: a.ints.length, ints: a.ints,
    maxTable: a.tables.reduce((m, t) => (t.elems > m.elems ? t : m), { elems: 0, chars: 0, text: "" }),
    tableChars: a.tables.reduce((s, t) => s + t.chars, 0), maxTableChars: Math.max(0, ...a.tables.map((t) => t.chars)), litShare: a.litChars / Math.max(1, codeNoComments.length),
    decodes: /b64decode|base64\.|zlib\.|decompress|bytes\.fromhex|fromhex\(|int\([^)]*,\s*(16|36)\)|json\.loads|atob\(|JSON\.parse\(/.test(r.code),
  });
}
const progs = [...seen.values()];
fs.writeFileSync(path.join(ARENA_DIR, "runs", "literal-census.json"), JSON.stringify(progs.map(({ strs, ints, ...p }) => p)));

const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const arenaProgs = progs.filter((p) => p.arena !== "(non-arena)");
console.log(`# Literal census: ${progs.length} distinct programs (${arenaProgs.length} from arena games, ${progs.length - arenaProgs.length} from other games in the database)\n`);
for (const [label, set] of [["arena games", arenaProgs], ["all games", progs]]) {
  console.log(`## ${label}\n`);
  console.log("kind     programs | string literal length: all literals p50/p90/p99/max | per-program max str p50/p90/max | int digits: all p50/p99/max | per-program max int p90/max | const table elements per-program max p90/max | literal share of code p50/p90/max");
  for (const kind of ["clover", "orchid", "bee"]) {
    const ps = set.filter((p) => p.kind === kind);
    const allS = ps.flatMap((p) => p.strs), allI = ps.flatMap((p) => p.ints);
    console.log(`${kind.padEnd(8)} ${String(ps.length).padStart(8)} | ${q(allS, 0.5)}/${q(allS, 0.9)}/${q(allS, 0.99)}/${q(allS, 1)}`.padEnd(70) +
      ` | ${q(ps.map((p) => p.maxStr), 0.5)}/${q(ps.map((p) => p.maxStr), 0.9)}/${q(ps.map((p) => p.maxStr), 1)}`.padEnd(18) +
      ` | ${q(allI, 0.5)}/${q(allI, 0.99)}/${q(allI, 1)}`.padEnd(14) + ` | ${q(ps.map((p) => p.maxInt), 0.9)}/${q(ps.map((p) => p.maxInt), 1)}`.padEnd(10) +
      ` | ${q(ps.map((p) => p.maxTable.elems), 0.9)}/${q(ps.map((p) => p.maxTable.elems), 1)}`.padEnd(10) +
      ` | ${q(ps.map((p) => p.litShare), 0.5).toFixed(2)}/${q(ps.map((p) => p.litShare), 0.9).toFixed(2)}/${q(ps.map((p) => p.litShare), 1).toFixed(2)}`);
  }
  // histogram buckets of string literal lengths
  const buckets = [[0, 8], [9, 16], [17, 32], [33, 64], [65, 128], [129, 256], [257, 1e9]];
  console.log("\nstring literal lengths, count per bucket (all literals):");
  for (const kind of ["clover", "orchid", "bee"]) {
    const allS = set.filter((p) => p.kind === kind).flatMap((p) => p.strs);
    console.log(`  ${kind.padEnd(7)} ` + buckets.map(([a, b]) => `${a}-${b > 1e8 ? "∞" : b}: ${allS.filter((x) => x >= a && x <= b).length}`).join("  "));
  }
  const ib = [[1, 3], [4, 6], [7, 9], [10, 15], [16, 20], [21, 1e9]];
  console.log("integer literal digits, count per bucket (all literals):");
  for (const kind of ["clover", "orchid", "bee"]) {
    const allI = set.filter((p) => p.kind === kind).flatMap((p) => p.ints);
    console.log(`  ${kind.padEnd(7)} ` + ib.map(([a, b]) => `${a}-${b > 1e8 ? "∞" : b}: ${allI.filter((x) => x >= a && x <= b).length}`).join("  "));
  }
  console.log();
}
const show = (p) => `${p.arena}${p.gen ? ` g${p.gen}` : ""} ${p.url ?? ""} r${p.round} ${p.team} ${p.kind} (${p.chars} source chars)`;
console.log("## Largest cases (distinct programs)\n");
console.log("Longest string literals:");
for (const p of [...progs].sort((a, b) => b.maxStr - a.maxStr).slice(0, 10)) console.log(`  ${String(p.maxStr).padStart(5)} chars  ${show(p)}`);
console.log("Longest integer literals:");
for (const p of [...progs].sort((a, b) => b.maxInt - a.maxInt).slice(0, 10)) console.log(`  ${String(p.maxInt).padStart(5)} digits ${show(p)}`);
console.log("Largest constant tables (all-literal list/tuple/set/dict displays; size = literal leaves inside):");
for (const p of [...progs].sort((a, b) => b.maxTable.elems - a.maxTable.elems).slice(0, 12)) console.log(`  ${String(p.maxTable.elems).padStart(5)} elems ${String(p.maxTable.chars).padStart(5)} chars  ${show(p)}\n      ${p.maxTable.text.replace(/\s+/g, " ").slice(0, 110)}`);
console.log("Largest constant tables by characters:");
for (const p of [...progs].sort((a, b) => b.maxTableChars - a.maxTableChars).slice(0, 8)) console.log(`  ${String(p.maxTableChars).padStart(5)} chars  ${show(p)}`);
console.log("Most literal-heavy code (share of non-comment characters inside literals; programs ≥ 400 chars):");
for (const p of [...progs].filter((x) => x.chars >= 400).sort((a, b) => b.litShare - a.litShare).slice(0, 8)) console.log(`  ${p.litShare.toFixed(2)}  ${show(p)}`);
const dec = progs.filter((p) => p.decodes && (p.maxStr >= 64 || p.maxInt >= 30));
console.log(`\nPrograms that decode a long literal at run time (base64/zlib/fromhex/int(…,16)/json.loads with a ≥ 64-char string or ≥ 30-digit int): ${dec.length}`);
for (const p of dec.slice(0, 10)) console.log(`  ${show(p)} maxStr ${p.maxStr} maxInt ${p.maxInt}`);
const tbl = (k, min) => progs.filter((p) => p.kind === k && p.maxTable.elems >= min).length;
console.log(`\nPrograms with a constant table of ≥ 16 / ≥ 64 literal leaves: clover ${tbl("clover", 16)} / ${tbl("clover", 64)}, orchid ${tbl("orchid", 16)} / ${tbl("orchid", 64)}, bee ${tbl("bee", 16)} / ${tbl("bee", 64)}`);
const lstr = (k, min) => progs.filter((p) => p.kind === k && p.maxStr >= min).length;
console.log(`Programs with a string literal of ≥ 64 / ≥ 256 chars: clover ${lstr("clover", 64)} / ${lstr("clover", 256)}, orchid ${lstr("orchid", 64)} / ${lstr("orchid", 256)}, bee ${lstr("bee", 64)} / ${lstr("bee", 256)}`);
const lint = (k, min) => progs.filter((p) => p.kind === k && p.maxInt >= min).length;
console.log(`Programs with an integer literal of ≥ 20 / ≥ 40 digits: clover ${lint("clover", 20)} / ${lint("clover", 40)}, orchid ${lint("orchid", 20)} / ${lint("orchid", 40)}, bee ${lint("bee", 20)} / ${lint("bee", 40)}`);
await pool.end();
