// What signalling mechanism a team's programs use (for the costly-signalling experiments, §22): deterministic keyword
// checks on the code, and a haiku classifier (cached on disk by program skeleton) that reads a team's cosmos, orchid and
// bee versions of one game together. Never a Fable model.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARENA_DIR } from "./db.js";

/** Cosmos mechanisms, roughly from cheapest to most elaborate. */
export const MECHANISMS = ["rule", "work-unchecked", "hash-pow", "sequential", "certificate", "anytime", "other"];
/** Sophistication level: 0 a cheap rule or badge; 1 work a bee can't check; 2 hash proof of work; 3 a checkable search
 * puzzle, sequential work or graded anytime optimisation; +1 (at most 4) for adaptive difficulty or combined proofs. */
export const BASE_LEVEL = { rule: 0, other: 0, "work-unchecked": 1, "hash-pow": 2, sequential: 3, certificate: 3, anytime: 3 };
export function levelOf(label) {
  if (!label) return null;
  const base = BASE_LEVEL[label.mechanism] ?? 0;
  const extra = base >= 2 && (label.tags || []).some((t) => t === "adaptive" || t === "combined") ? 1 : 0;
  return Math.min(4, base + extra);
}
export const ORCHID_STRATEGIES = ["copy-rule", "corner-cut", "partial-work", "look-alike", "decoy", "other"];
export const BEE_CHECKS = ["none", "shape-stats", "exact-rule", "work-count", "certificate-check", "mixed"];

/** Code without comments and docstrings (prose mentions mechanisms it doesn't use). */
export function stripProse(code) {
  return String(code || "")
    .replace(/("""|''')[\s\S]*?\1/g, "\"\"")
    .replace(/(^|[^"'\\])#.*$/gm, "$1");
}

/** A program's skeleton: no prose, numbers, strings or data tables. Versions that a scaffold only retunes share it. */
export function skeleton(code) {
  return stripProse(code)
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n]){17,}\1/g, "S") // long strings (data); short ones ("feed") are logic
    .replace(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, "N")
    .replace(/\[[^[\]]{40,}\]/g, "[T]") // data tables: innermost lists first, then the dicts and lists holding them
    .replace(/\{[^{}]{60,}\}/g, "{T}")
    .replace(/\[[^[\]]{40,}\]/g, "[T]")
    .replace(/\s+/g, " ")
    .trim();
}
export const skeletonHash = (code) => crypto.createHash("sha1").update(skeleton(code)).digest("hex").slice(0, 16);

const HASH = /\bhashlib\b|\bsha(?:1|224|256|384|512)\b|\bmd5\b|\bblake2[bs]?\b|\bsha3_\d+\b/;
const HASH_TEST = /digest\(\)\s*\[|digest\(\)\s*[<>]|hexdigest\(\)\s*(?:\[|\.startswith|[<>])|int\.from_bytes\([^)]*digest|int\([^)]*hexdigest\(\)[^)]*16\)|bit_length\(\)|leading|zero.?bits|difficulty|target|\[\s*\d\s*\]\s*(?:==\s*0\b|<\s*\d+)|\[\s*:\s*\d+\s*\]\s*(?:<|==)/i;
const TIME = /\btime\.(?:time|perf_counter|monotonic|process_time)\s*\(/;
const BUDGET = /GAME\s*\[\s*["']ms["']\s*\]|deadline|stop\s*=|budget/i;
const PUZZLE = /cliq|paley|graceful|colou?r|chromatic|factori|is_prime|miller|rabin|hamilton|sudoku|queens|knapsack|subset.?sum|vertex.?cover|independent.?set|matching|tsp|tour|latin|magic.?square|sat\b|pow\([^()]*\(\s*\w+\s*-\s*1\s*\)\s*\/\/\s*2/i;
const SEQ = /for\s+\w+\s+in\s+range\([^)]*\):\s*\n?\s*\w+\s*=\s*(?:hashlib\.\w+|h|H|sha\w*)\([^)]*\w+[^)]*\)\.digest\(\)|(\w+)\s*=\s*pow\(\s*\1\s*,\s*2\s*,/;
const SCORE = /\bbest\b|\bscore\b|improv|anneal|climb|\btemperature\b/i;
const ADAPT = /(?:difficulty|bits|target|zeros?)\s*=\s*[^\n]*(?:\bc\b|challenge|elapsed|remaining|left|time\.)/i;

/** Keyword evidence for a cosmos (or any flower): { mechanism, tags } from the code alone. */
export function keywordCosmos(code) {
  const c = stripProse(code);
  const tags = [];
  const timed = TIME.test(c) && BUDGET.test(c);
  if (timed) tags.push("time-bounded");
  const hash = HASH.test(c) && HASH_TEST.test(c) && /\b(?:while|for)\b/.test(c);
  const puzzle = PUZZLE.test(c);
  const seq = SEQ.test(c);
  if (ADAPT.test(c)) tags.push("adaptive?");
  const kinds = [hash && "hash-pow", puzzle && "certificate", seq && "sequential", timed && SCORE.test(c) && !hash && !puzzle && "anytime"].filter(Boolean);
  if (kinds.length > 1) tags.push("combined?");
  let mechanism = kinds[0] || (timed ? "work-unchecked" : "rule");
  if (puzzle && timed && SCORE.test(c) && !hash) mechanism = /cliq|paley|factori|prime/i.test(c) ? "certificate" : "anytime";
  return { mechanism, tags };
}

/** Keyword evidence for a bee: does it re-check work (hashes, certificates) or rules, or only learn from shapes? */
export function keywordBee(code) {
  const c = stripProse(code);
  const checks = [];
  if (HASH.test(c)) checks.push("work-count");
  if (PUZZLE.test(c)) checks.push("certificate-check");
  if (/tasted|nectar/.test(c) && /\{\s*\}|dict\(|defaultdict|Counter/.test(c)) checks.push("learns");
  if (/random\.(?:randint|randrange|getrandbits|random)\(/.test(c)) checks.push("random-challenges");
  return { checks, threshold: /\b(?:T|THRESH\w*|threshold|need|enough|min_\w+)\s*=\s*\d/.test(c) };
}

// ---------------------------------------------------------------- the haiku classifier

// Labels are cached by skeleton (ARENA_MECH_CACHE overrides the file, e.g. for tests).
const cacheFile = () => process.env.ARENA_MECH_CACHE || path.join(ARENA_DIR, "runs", "mechanisms-cache.json");
const PROMPT_VERSION = 1;
let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8")); } catch { cache = {}; }
  return cache;
}
function saveCache() { fs.mkdirSync(path.dirname(cacheFile()), { recursive: true }); fs.writeFileSync(cacheFile(), JSON.stringify(cache)); }

export const CLASSIFIER_SYSTEM = `You classify programs from a coding game. Reply with JSON only, no prose.
The game: each team writes a COSMOS flower (honest: a bee that feeds there gets nectar), an ORCHID flower (a fake: feeding
there gives nothing) and a BEE. Flowers answer an integer challenge with a graph {nodes, edges, labels, ...}. A cosmos has
150 ms per answer, an orchid 100 ms, a bee 50 ms per decision. Bees can't see whose flower they are at, only the answers.`;

const take = (s, n) => (s.length > n ? s.slice(0, n) + "\n# ... (cut)" : s);

/** The prompt for one team's programs in one game: versions = [{ kind, version, code }] (distinct skeletons only). */
export function classifierPrompt(versions) {
  const blocks = versions.map((v) => `## ${v.kind.toUpperCase()} v${v.version}\n\`\`\`python\n${take(v.code, v.kind === "bee" ? 14000 : 9000)}\n\`\`\``).join("\n\n");
  return `Classify each program below.

For each COSMOS: "mechanism", one of:
- "rule": a cheap rule or recognisable badge (formula, seeded pattern, fixed shape, degree labels); no costly work
- "work-unchecked": spends time (e.g. a search until a deadline) but a bee can't check how much work was done
- "hash-pow": hash proof of work (nonces or partial preimages whose hash has a rare property tied to the challenge)
- "sequential": sequential work that can't be split up (chained hashes, repeated squaring) with checkpoints a bee can spot-check
- "certificate": a hard search puzzle built from the challenge, answered with a solution that is quick to check (clique, colouring, labelling, factorisation...)
- "anytime": an optimisation whose answer quality grows with time, graded by a score a bee can compute
- "other"
(for an answer that combines several kinds of proof, the costliest one, with the tag "combined")
and "tags" (any that apply): "time-bounded" (uses the clock to spend most of its time limit), "adaptive" (difficulty or
threshold changes with the challenge or over time), "combined" (two or more kinds of proof in one answer), "secret"
(relies on hidden constants only its own bee knows), "own-bee-handshake" (a private signal for its own bee),
"challenge-tied" (the work depends on the challenge), plus "puzzle:<name>" for a certificate or anytime puzzle
(e.g. "puzzle:paley-clique", "puzzle:graceful", "puzzle:hashcash"). Add "difficulty": a short phrase (e.g. "10 zero bits,
as many nonces as fit in 135 ms") or "".

For each ORCHID: "strategy", one of: "copy-rule" (reproduces a rival cosmos's rule exactly), "corner-cut" (the same kind of
work as a costly cosmos but less of it, or a faster/approximate version), "partial-work" (some real work hoping to clear a
low threshold), "look-alike" (imitates the look of a cosmos without the work), "decoy" (deliberately junk or easy to spot),
"other"; "imitates": what it imitates, briefly; "tags": any of "own-bee-tell" (a mark its own bee uses to avoid it),
"alternating" (switches between imitations).

For each BEE: "checks", one of: "none", "shape-stats" (learns or counts answer shapes/fingerprints, no verification),
"exact-rule" (recomputes a known rule and compares), "work-count" (verifies proof-of-work items and counts them),
"certificate-check" (verifies a puzzle solution or grades its quality), "mixed" (several of these); "threshold": "none",
"fixed" or "adaptive" (moves with what it sees); "tags": any of "learns" (updates from nectar), "random-challenges",
"handshake" (recognises its own team's flowers).

Every item also gets "summary": one sentence.

Reply with JSON only: {"items": [{"kind": "cosmos"|"orchid"|"bee", "version": <number>, ...}]}, one item per program below,
in the same order.

${blocks}`;
}

function parseJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** Normalise one classifier item. */
function clean(it) {
  const tags = Array.isArray(it.tags) ? it.tags.map((t) => String(t).toLowerCase().slice(0, 40)) : [];
  if (it.kind === "cosmos") return { mechanism: MECHANISMS.includes(it.mechanism) ? it.mechanism : "other", tags, difficulty: String(it.difficulty || "").slice(0, 120), summary: String(it.summary || "").slice(0, 300) };
  if (it.kind === "orchid") return { strategy: ORCHID_STRATEGIES.includes(it.strategy) ? it.strategy : "other", imitates: String(it.imitates || "").slice(0, 160), tags, summary: String(it.summary || "").slice(0, 300) };
  return { checks: BEE_CHECKS.includes(it.checks) ? it.checks : "none", threshold: ["none", "fixed", "adaptive"].includes(it.threshold) ? it.threshold : "none", tags, summary: String(it.summary || "").slice(0, 300) };
}

/** A combined cosmos answer gets the mechanism of its costliest proof (the classifier sometimes says "other"). */
function normalise(label, kind) {
  if (!label || kind !== "cosmos" || label.mechanism !== "other") return label;
  const tags = label.tags || [];
  const puzzle = tags.find((t) => t.startsWith("puzzle:"));
  if (!puzzle) return label;
  return { ...label, mechanism: /hashcash|hash|nonce|pow/.test(puzzle) ? "hash-pow" : "certificate", tags: [...new Set([...tags, "combined"])] };
}

/**
 * Classify one team's programs of one game. versions: [{ kind, version, code }]. Versions sharing a skeleton are
 * classified once (the latest of them is shown). Returns Map("kind:version" -> label), each label with keyword evidence
 * attached ({ kw }). callModel: lib/llm.js callModel (null: cached labels and keyword evidence only); ctx: its ledger context.
 */
export async function classifyTeamGame(versions, { callModel, ctx = {}, model = "haiku", log = () => {} } = {}) {
  if (/fable/i.test(model)) throw new Error("never a Fable model");
  const store = loadCache();
  const bySkel = new Map();
  for (const v of versions) bySkel.set(`${v.kind}:${skeletonHash(v.code)}`, v); // later versions win
  const keyOf = (v) => `${PROMPT_VERSION}:${v.kind}:${skeletonHash(v.code)}`;
  const todo = callModel ? [...bySkel.values()].filter((v) => !store[keyOf(v)]) : []; // no model: cached labels and keywords only
  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6);
    let items = null;
    for (let attempt = 0; attempt < 2 && !items; attempt++) {
      const r = await callModel({ model, system: CLASSIFIER_SYSTEM, prompt: classifierPrompt(batch) + (attempt ? "\n\nReply with the JSON object only." : ""), ctx: { purpose: "classifier", ...ctx } });
      const j = parseJson(r.text);
      if (j && Array.isArray(j.items) && j.items.length === batch.length) items = j.items;
    }
    if (!items) { log(`  classifier: no usable reply for ${batch.map((b) => `${b.kind} v${b.version}`).join(", ")}`); continue; }
    batch.forEach((v, k) => { store[keyOf(v)] = clean({ ...items[k], kind: v.kind }); });
    saveCache();
  }
  const out = new Map();
  for (const v of versions) {
    const llm = normalise(store[keyOf(v)] || null, v.kind);
    const kw = v.kind === "bee" ? keywordBee(v.code) : keywordCosmos(v.code);
    out.set(`${v.kind}:${v.version}`, { ...(llm || {}), llm: !!llm, kw, skeleton: skeletonHash(v.code) });
  }
  return out;
}
