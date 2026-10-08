// What a team's programs do (one flower per team): deterministic keyword checks on the code, and a haiku classifier (cached
// on disk by program skeleton) that reads a team's flower and bee versions of one game together. In this variant a costly
// signal costs the flower energy (E = (size cap − size) × max(0, R − CPU ms), R the call's hidden budget, times
// (byte cap − response bytes) / byte cap in games with the byte factor: lib/energy.js), so the labels say both what a
// flower proves and how it pays for it: its signalling mechanism and its percent policy. Never a Fable model.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARENA_DIR } from "./db.js";

/** Flower signalling mechanisms, roughly from cheapest to most elaborate. */
export const MECHANISMS = ["rule", "work-unchecked", "keyed", "hash-pow", "sequential", "certificate", "anytime", "commitment", "other"];
/** Sophistication level: 0 a cheap rule or badge; 1 work a bee can't check; 2 a keyed answer (a secret ties it to the
 * challenge) or hash proof of work; 3 a checkable search puzzle, sequential work, graded anytime optimisation or a
 * commitment checked later; +1 (at most 4) for adaptive difficulty or combined proofs. */
export const BASE_LEVEL = { rule: 0, other: 0, "work-unchecked": 1, keyed: 2, "hash-pow": 2, sequential: 3, certificate: 3, anytime: 3, commitment: 3 };
export function levelOf(label) {
  if (!label) return null;
  const base = BASE_LEVEL[label.mechanism] ?? 0;
  const extra = base >= 2 && ((label.tags || []).some((t) => t === "adaptive" || t === "combined") || (label.families || []).length >= 2) ? 1 : 0;
  return Math.min(4, base + extra);
}
/** Signal families a flower may use (several at once): a recognisable signature, a keyed signal, a puzzle, a commitment. */
export const FAMILIES = ["signature", "keyed", "puzzle", "commitment"];
/** How a flower sets its percent (the share of the turn's excess energy it gives a feeding bee). */
export const PERCENT_POLICIES = ["fixed", "by-challenge", "by-visitor", "random", "other"];
export const BEE_CHECKS = ["none", "shape-stats", "learned-value", "exact-rule", "key-check", "work-count", "certificate-check", "mixed"];
/** A bee's checking level: 0 none; 1 learns from shapes or from what paid; 2 recomputes a rule or a keyed signal; 3 verifies
 * work or a puzzle's solution; mixed counts as 2. */
export const BEE_LEVEL = { none: 0, "shape-stats": 1, "learned-value": 1, "history-value": 1, "exact-rule": 2, "key-check": 2, mixed: 2, "work-count": 3, "certificate-check": 3 };
export const beeLevelOf = (label) => (label && label.checks in BEE_LEVEL ? BEE_LEVEL[label.checks] : null);
/** How a bee uses its MEMORY (a 50-byte key-value store by default: the only state it keeps between turns). */
export const BEE_MEMORY = ["none", "counters", "table", "plan", "mixed"];
export const BEE_FEEDS = ["always", "never", "by-check", "by-learned-value", "handshake-only", "random", "mixed"];

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
// A difficulty test on a hash (proof of work): an indexed or sliced digest compared with something, a prefix test, ...
// (a digest sliced for a fingerprint, e.g. hexdigest()[:6] kept in MEMORY, is not one).
const HASH_TEST = /digest\(\)\s*\[[^\]\n]*\]\s*(?:==|!=|<|>)|digest\(\)\s*[<>]|hexdigest\(\)\s*(?:\.startswith|[<>])|int\.from_bytes\([^)]*digest|int\([^)]*hexdigest\(\)[^)]*16\)|bit_length\(\)|leading|zero.?bits|difficulty|target|\[\s*\d\s*\]\s*(?:==\s*0\b|<\s*\d+)|\[\s*:\s*\d+\s*\]\s*(?:<|==)/i;
const TIME = /\btime\.(?:time|perf_counter|monotonic|process_time)\s*\(/;
const BUDGET = /GAME\s*\[\s*["']ms["']\s*\]|deadline|stop\s*=|budget/i;
const PUZZLE = /cliq|paley|graceful|colou?r|chromatic|factori|is_prime|miller|rabin|hamilton|sudoku|queens|knapsack|subset.?sum|vertex.?cover|independent.?set|matching|tsp|tour|latin|magic.?square|sat\b|pow\([^()]*\(\s*\w+\s*-\s*1\s*\)\s*\/\/\s*2/i;
const SEQ = /for\s+\w+\s+in\s+range\([^)]*\):\s*\n?\s*\w+\s*=\s*(?:hashlib\.\w+|h|H|sha\w*)\([^)]*\w+[^)]*\)\.digest\(\)|(\w+)\s*=\s*pow\(\s*\1\s*,\s*2\s*,/;
const SCORE = /\bbest\b|\bscore\b|improv|anneal|climb|\btemperature\b/i;
const ADAPT = /(?:difficulty|bits|target|zeros?)\s*=\s*[^\n]*(?:\bc\b|challenge|elapsed|remaining|left|time\.)/i;

/** Keyword evidence for a flower: { mechanism, tags, percent } from the code alone. */
export function keywordFlower(code) {
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
  if (/GAME\s*\[\s*["']team["']\s*\]/.test(c)) tags.push("knows-own-team");
  if (/GAME\s*\[\s*["']ms["']\s*\]|GAME\.ms\b/.test(c)) tags.push("reads-budget");
  // Signal families: a puzzle (costly work a bee can check), a keyed signal (a hash of the challenge with a secret
  // constant), a commitment (a hash of something revealed later).
  const families = [];
  if (["hash-pow", "certificate", "sequential", "anytime"].includes(mechanism)) families.push("puzzle");
  if (HASH.test(c) && /(["'][^"'\n]{6,}["']|\b0x[0-9a-f]{6,}\b|\b\d{6,}\b)/i.test(c) && !hash) families.push("keyed?");
  if (/commit|reveal/i.test(c)) families.push("commitment?");
  // The percent: the last item of every pair returned is a constant, or it is computed.
  const rets = [...c.matchAll(/^[ \t]*return[ \t]*\(?(.+),[ \t]*([^,\n()]+?)[ \t]*\)?[ \t]*$/gm)].map((m) => m[2]);
  const percent = rets.length && rets.every((x) => /^\d+(?:\.\d+)?$/.test(x)) ? "fixed" : /random\./.test(c) && /percent|pct/i.test(c) ? "random?" : "computed";
  // The specific signal, as far as keywords tell (a puzzle's name), marked uncertain.
  const pm = c.match(PUZZLE);
  const signal = pm ? `${signalName(pm[0].replace(/^pow.*$/i, "quadratic-residue"))}?` : hash ? "hash-nonce?" : null;
  return { mechanism, tags, percent, families, signal };
}

/** Does a bee's code define fed(nectar), the optional call after a feed? (Python or TypeScript, at the top level.) */
export const definesFed = (code) => /^(?:def\s+fed\s*\(|(?:export\s+)?(?:async\s+)?function\s+fed\s*\(|(?:const|let|var)\s+fed\s*=)/m.test(stripProse(code));

/** The argument texts of every hash call in the code (sha256(...), md5(...), hashlib.new(...)), nested calls included. */
function hashArgs(code) {
  const out = [];
  for (const m of code.matchAll(/(?:\bsha\w*|\bmd5|\bblake2\w*|hashlib\.new)\s*\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    for (; i < code.length && depth; i++) { if (code[i] === "(") depth++; else if (code[i] === ")") depth--; }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

/** Keyword evidence for a bee: does it re-check work (hashes, certificates) or rules, or only learn from what paid (fed and
 * MEMORY)? */
export function keywordBee(code) {
  const c = stripProse(code);
  const checks = [];
  // A hash of the challenge recomputes a keyed signal; a hash of the response only is a fingerprint (to remember it).
  const ofChallenge = hashArgs(c).some((a) => /\b(?:challenge|c)\b/.test(a));
  if (HASH.test(c)) checks.push(HASH_TEST.test(c) ? "work-count" : ofChallenge ? "key-check" : "fingerprints");
  if (PUZZLE.test(c)) checks.push("certificate-check");
  const fed = definesFed(c);
  if (fed && /\bMEMORY\b/.test(c)) checks.push("learns"); // fed(nectar) can save what paid
  if (fed) checks.push("uses-fed");
  if (/\bMEMORY\b/.test(c)) checks.push("uses-memory");
  if (/random\.(?:randint|randrange|getrandbits|random)\(/.test(c)) checks.push("random-challenges");
  return { checks, threshold: /\b(?:T|THRESH\w*|threshold|need|enough|min_\w+)\s*=\s*\d/.test(c) };
}

// ---------------------------------------------------------------- the haiku classifier

// Labels are cached by skeleton (ARENA_MECH_CACHE overrides the file, e.g. for tests).
const cacheFile = () => process.env.ARENA_MECH_CACHE || path.join(ARENA_DIR, "runs", "mechanisms-cache.json");
// Bump a kind's version when its definitions change: its labels are classified again.
const KIND_VERSION = { flower: 6, bee: 4 };
let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8")); } catch { cache = {}; }
  return cache;
}
function saveCache() { fs.mkdirSync(path.dirname(cacheFile()), { recursive: true }); fs.writeFileSync(cacheFile(), JSON.stringify(cache)); }

export const CLASSIFIER_SYSTEM = `You classify programs from a coding game. Reply with JSON only, no prose.
The game: each team writes a FLOWER and a BEE. Every round each bee asks a flower drawn at random (its own team's too) a
challenge. The flower returns [response, percent] within 150 ms; the bee then has 50 ms to feed or leave. The flower's excess
energy for the turn is E = (1100 - its size in nodes) x max(0, 150 - its CPU ms): small, fast flowers have more to give. If
the bee feeds, the flower gives it percent% of E as nectar and the rest as pollen (for the bee to carry to other flowers of
the species); if not, E is lost. A team's flower program is its species: every turn is one independent flower of it. Bees
and flowers are never told whose counterpart they met, and programs see no history: only their arguments and GAME.
Programs run fresh for every call: flower(challenge), first(), decide(challenge, response), and the bee's optional
fed(nectar), which runs after a feed it decided in time, in the same instance as that decide. The bee's only state from one
turn to the next is MEMORY, a flat key-value store of 50 bytes (key bytes + value JSON bytes) that only the bee writes and
that empties when its code changes. A program's clock reads 0 when each call starts: it can time its own work, nothing
more. Each flower call has a hidden time budget R (uniform from the game's floor, 50 or 3 ms, to 150 ms, fresh every call; its hard limit, which it reads as
GAME["ms"]) and E = (1100 - size) x max(0, R - CPU ms): work a flower shows can signal how rich this call is. In newer
games E is also multiplied by (byte cap - response bytes) / byte cap (a cap of 1024 bytes), so a big response costs energy. On every feed the bee's team gets
a pollen grain: a random piece of the answering flower's minified code (programs never get grains).`;

const take = (s, n) => (s.length > n ? s.slice(0, n) + "\n# ... (cut)" : s);

/** The prompt for a batch of programs: versions = [{ kind, version, code }] (distinct skeletons only), numbered in order. */
export function classifierPrompt(versions) {
  const blocks = versions.map((v, i) => `## [${i + 1}] ${v.kind.toUpperCase()} v${v.version}\n\`\`\`python\n${take(v.code, v.kind === "bee" ? 14000 : 9000)}\n\`\`\``).join("\n\n");
  return `Classify each program below.

For each FLOWER: "mechanism" (what its response proves), one of:
- "rule": a cheap rule or recognisable badge (formula, seeded pattern, fixed shape, echo); no costly work and no secret
- "work-unchecked": spends CPU time (e.g. a search until a deadline) but a bee can't check how much work was done
- "keyed": the answer is tied to the challenge through a secret (a hidden constant, a keyed hash), so past answers don't let
  others answer new challenges; a bee that knows the secret can check it
- "hash-pow": hash proof of work (nonces or partial preimages whose hash has a rare property tied to the challenge)
- "sequential": sequential work that can't be split up (chained hashes, repeated squaring) with checkpoints a bee can spot-check
- "certificate": a hard search puzzle built from the challenge, answered with a solution that is quick to check
- "anytime": an optimisation whose answer quality grows with time, graded by a score a bee can compute
- "commitment": the answer commits to something revealed or checked in a later turn (e.g. a hash of a future value), so a
  bee can check it afterwards (keeping what it needs in MEMORY)
- "other"
(for an answer that combines several kinds of proof, the costliest one, with the tag "combined")
"percent_policy", one of: "fixed" (a constant), "by-challenge" (depends on the challenge), "by-visitor" (guesses who is
asking from the challenge, e.g. its own bee, and pays differently), "random", "other"; "percent": its typical percent as a number, or null if it varies;
and "tags" (any that apply): "time-bounded" (spends most of its time limit: energy it gives up), "lean" (written to keep size
and CPU small, for energy), "adaptive" (deliberately sets how much work it proves per challenge; NOT just
running until the time limit), "combined" (two or more kinds of costly proof), "own-bee-handshake" (a private signal between
its own bee and flower), "secret" (relies on hidden constants), "challenge-tied", "big-response" (answers with large responses, kilobytes or
more), "reads-budget" (reads its call's budget R, GAME["ms"], to set how much work it shows or the percent), plus
"puzzle:<name>".
"families": every signal family it uses, any of: "signature" (a recognisable mark of the species in its answers: a fixed
motif, label pattern or structure, the same for every challenge or derived from it by a public rule; anyone can copy it),
"keyed" (a secret ties the answer to the challenge), "puzzle" (a costly problem built from the challenge that is cheap to
check: proof of work, a certificate, sequential work), "commitment" (commits now to something checked later); [] if none.
Add "difficulty": a short phrase (e.g. "10 zero bits, as many nonces as fit in 40 ms") or "".
Add "signal": the specific signal it sends, as a short lowercase hyphenated name of the idea, not of this program (e.g.
"graceful-labeling", "clique", "hamiltonian-path", "graph-coloring", "spanning-tree", "degree-signature", "label-motif",
"hash-nonce", "echo"; "none" for no signal), the same name for the same idea in every program.
Tag "signature-plus-work" when it combines a recognisable species signature with costly work (e.g. a fixed motif on top of a
checkable puzzle).

For each BEE: "checks" (its strongest check), one of: "none", "shape-stats" (learns or counts answer shapes),
"learned-value" (remembers in MEMORY, e.g. from fed(nectar), how much nectar answers like this paid), "exact-rule" (recomputes a known public rule
and compares), "key-check" (recomputes a keyed signal with a secret it shares with its own flower, or one it worked out),
"work-count" (verifies proof-of-work items and counts them), "certificate-check" (verifies a puzzle solution or grades its
quality), "mixed";
"feeds", one of: "always", "never", "by-check", "by-learned-value", "handshake-only", "random", "mixed";
"threshold": "none", "fixed" or "adaptive"; "memory": how it uses MEMORY, one of "none", "counters" (tallies or running
averages), "table" (remembers specific answers or challenges), "plan" (a schedule or a challenge sequence), "mixed";
"tags": any of "learns" (updates MEMORY from what it ate or saw), "uses-fed" (defines fed(nectar)), "memory-tight" (works
to fit MEMORY's 50-byte cap), "random-challenges", "handshake" (recognises its own team's flower), "avoids-own-flower",
"prefers-own-flower", "cracks" (works out other species' rules or keys from their answers to check or forge them),
"rotates-challenges" (varies its challenges so answers can't be replayed).

Every item also gets "summary": one sentence.

Reply with JSON only: {"items": [{"n": <its [number]>, "kind": "flower"|"bee", "version": <number>, ...}]}, one item
per program below, in the same order.

${blocks}`;
}

function parseJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** A signal's short name, normalised: lowercase, hyphens, at most 40 characters (null for none). */
export function signalName(x) {
  const s = String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s && s !== "none" && s !== "null" ? s : null;
}

/** Normalise one classifier item. */
function clean(it) {
  const tags = Array.isArray(it.tags) ? it.tags.map((t) => String(t).toLowerCase().slice(0, 40)) : [];
  if (it.kind === "flower") return { mechanism: MECHANISMS.includes(it.mechanism) ? it.mechanism : "other", percentPolicy: PERCENT_POLICIES.includes(it.percent_policy) ? it.percent_policy : "other",
    percent: Number.isFinite(Number(it.percent)) && it.percent !== null ? Number(it.percent) : null, tags,
    families: Array.isArray(it.families) ? [...new Set(it.families.map((f) => String(f).toLowerCase()).filter((f) => FAMILIES.includes(f)))] : [],
    difficulty: String(it.difficulty || "").slice(0, 120), signal: signalName(it.signal), summary: String(it.summary || "").slice(0, 300) };
  return { checks: BEE_CHECKS.includes(it.checks) ? it.checks : "none", feeds: BEE_FEEDS.includes(it.feeds) ? it.feeds : "mixed",
    threshold: ["none", "fixed", "adaptive"].includes(it.threshold) ? it.threshold : "none", memory: BEE_MEMORY.includes(it.memory) ? it.memory : "none", tags,
    summary: String(it.summary || "").slice(0, 300) };
}

/** A combined flower answer gets the mechanism of its costliest proof (the classifier sometimes says "other"). */
function normalise(label, kind) {
  if (!label || kind !== "flower" || label.mechanism !== "other") return label;
  const tags = label.tags || [];
  const puzzle = tags.find((t) => t.startsWith("puzzle:"));
  if (!puzzle) return label;
  return { ...label, mechanism: /hashcash|hash|nonce|pow/.test(puzzle) ? "hash-pow" : "certificate", tags: [...new Set([...tags, "combined"])] };
}

const keyOf = (v) => `${KIND_VERSION[v.kind] ?? 1}:${v.kind}:${skeletonHash(v.code)}`;

/** Programs still to classify (distinct skeletons without a cached label of their kind's current version). */
export function unlabelled(versions) {
  const store = loadCache();
  const bySkel = new Map();
  for (const v of versions) bySkel.set(keyOf(v), v); // later versions win
  return [...bySkel.entries()].filter(([k]) => !store[k]).map(([, v]) => v);
}

/**
 * Classify programs (any teams, any kinds) in batches of up to 8 programs or ~40k characters. versions:
 * [{ kind, version, code, ... }]. Returns a function label(v) -> label with keyword evidence ({ kw }) attached.
 * callModel: lib/llm.js callModel (null: cached labels and keyword evidence only); ctx: its cost-ledger context.
 */
export async function classifyPrograms(versions, { callModel, ctx = {}, model = "haiku", log = () => {} } = {}) {
  if (/fable/i.test(model)) throw new Error("never a Fable model");
  const store = loadCache();
  const todo = callModel ? unlabelled(versions) : [];
  const batches = [];
  for (const v of todo) {
    const size = Math.min(v.code.length, v.kind === "bee" ? 14000 : 9000);
    const last = batches[batches.length - 1];
    if (last && last.items.length < 8 && last.chars + size <= 40000) { last.items.push(v); last.chars += size; } else batches.push({ items: [v], chars: size });
  }
  await Promise.all(batches.map(async ({ items: batch }) => {
    let items = null;
    for (let attempt = 0; attempt < 2 && !items; attempt++) {
      const r = await callModel({ model, system: CLASSIFIER_SYSTEM, prompt: classifierPrompt(batch) + (attempt ? "\n\nReply with the JSON object only." : ""), ctx: { purpose: "classifier", ...ctx } });
      const j = parseJson(r.text);
      if (j && Array.isArray(j.items) && j.items.length === batch.length) items = j.items;
    }
    if (!items) { log(`  classifier: no usable reply for ${batch.map((b) => `${b.kind} v${b.version}`).join(", ")}`); return; }
    const byN = new Map(items.filter((it) => Number.isInteger(it.n)).map((it) => [it.n, it]));
    batch.forEach((v, k) => { const it = byN.get(k + 1) || items[k]; store[keyOf(v)] = clean({ ...it, kind: v.kind }); });
    saveCache();
  }));
  return (v) => {
    const llm = normalise(store[keyOf(v)] || null, v.kind);
    const kw = v.kind === "bee" ? keywordBee(v.code) : keywordFlower(v.code);
    return { ...(llm || {}), llm: !!llm, kw, skeleton: skeletonHash(v.code) };
  };
}

/** One team's programs of one game: Map("kind:version" -> label). */
export async function classifyTeamGame(versions, opts = {}) {
  const label = await classifyPrograms(versions, opts);
  return new Map(versions.map((v) => [`${v.kind}:${v.version}`, label(v)]));
}
