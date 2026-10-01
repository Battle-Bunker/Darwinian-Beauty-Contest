// Engine v3 measures for analyze.js (read-only): per round of a game, from the visits bees actually made.
//   - nectar per turn, pooled precision (paid feeds / feeds)
//   - discrimination on RIVAL patches: clover fed rate vs orchid fed rate, and the gap
//   - fingerprinting: share of a bee's pre-feed asks that repeat a challenge it already asked this game
//   - stolen-face orchid visits (every pre-feed answer equals a rival clover's answer to that challenge this round)
//     and twin orchid visits (equals the orchid's own clover's answer)
//   - non-determinism: flowers seen giving different answers to the same challenge within a round, and flowers whose
//     code imports random or time
//   - compute use against budget (round_programs.compute: every call counts under v3)
//   - markers of the example ideas in code (Paley clique chain, graceful labelling), random/time/GAME["ms"] use
import { all } from "./db.js";

const KINDS = ["clover", "orchid", "bee"];
const strip = (c) => (c || "").replace(/#.*$/gm, "");

/** Static markers in one program's code (comments stripped). Extend EXAMPLE_MARKERS when the examples change. */
export const CODE_MARKERS = {
  random: /\bimport\s+random\b|\bfrom\s+random\s+import\b|\brandom\.\w+\(/,
  clock: /\bimport\s+time\b|\bfrom\s+time\s+import\b|\btime\.(time|perf_counter|monotonic|process_time)\b/,
  gameMs: /GAME\s*\[\s*["']ms["']\s*\]|GAME\.get\(\s*["']ms["']/,
  // Example 1 (paley_clover.py): Euler's criterion / Legendre symbol, the prime chain, its checker.
  paley: /paley|quadratic.?residue|legendre|chain_primes|check_paley|pow\([^()]*,\s*\(\s*\w+\s*-\s*1\s*\)\s*\/\/\s*2\s*,\s*\w+\s*\)/i,
  // Example 2 (graceful_clover.py): the graph n builds, distinct label differences, its checker.
  graceful: /graceful|build_links|check_graceful/i,
  clique: /\bcliques?\b/i,
};
export function codeMarkers(code) {
  const c = strip(code);
  return Object.fromEntries(Object.entries(CODE_MARKERS).map(([k, re]) => [k, re.test(c)]));
}

/** Per-round v3 stats for one game (G from cohort.js gameRef). */
export async function v3RoundStats(G) {
  const rounds = await all("SELECT round_no, turns, feeds, nectar FROM rounds WHERE game_id = $1 ORDER BY round_no", [G.uuid]);
  const visits = await all("SELECT round_no, bee_team, patch_team, kind, action, nectar, steps FROM visits WHERE game_id = $1 ORDER BY round_no, bee_team, seq", [G.uuid]);
  const progs = await all("SELECT round_no, team_id, kind, code, compute FROM round_programs WHERE game_id = $1", [G.uuid]);
  const seenByBee = {}; // challenges each bee asked so far this game
  const out = [];
  for (const r of rounds) {
    const vs = visits.filter((v) => v.round_no === r.round_no);
    // Every answer each flower gave to each challenge this round: book[kind|patch][challenge] = Set(answers)
    const book = {};
    for (const v of vs) for (const s of v.steps || []) if (s.r !== undefined) {
      const k = `${v.kind}|${v.patch_team}`;
      ((book[k] ||= {})[JSON.stringify(s.c)] ||= new Set()).add(JSON.stringify(s.r));
    }
    const cloverAnswer = (patch, c, ans) => book[`clover|${patch}`]?.[c]?.has(ans);
    let feeds = 0, paid = 0, cv = 0, cf = 0, ov = 0, of = 0, stolen = 0, twin = 0, asks = 0, repeats = 0;
    for (const v of vs) {
      const pre = (v.steps || []).filter((s) => !s.after);
      const mine = (seenByBee[v.bee_team] ||= new Set());
      for (const s of pre) { const k = JSON.stringify(s.c); asks++; if (mine.has(k)) repeats++; else mine.add(k); }
      if (v.action === "feed") { feeds++; if (v.nectar) paid++; }
      if (v.bee_team === v.patch_team) continue;
      const fed = v.action === "feed";
      if (v.kind === "clover") { cv++; if (fed) cf++; continue; }
      ov++; if (fed) of++;
      const answered = pre.filter((s) => s.r !== undefined);
      if (!answered.length) continue;
      const others = G.ents.map((e) => e.team_id).filter((t) => t !== v.patch_team);
      if (answered.every((s) => others.some((t) => cloverAnswer(t, JSON.stringify(s.c), JSON.stringify(s.r))))) stolen++;
      if (answered.every((s) => cloverAnswer(v.patch_team, JSON.stringify(s.c), JSON.stringify(s.r)))) twin++;
    }
    // Non-determinism seen: a flower that gave 2+ different answers to one challenge in this round.
    const nondet = { clover: 0, orchid: 0, cloverAsked: 0, orchidAsked: 0 };
    for (const [k, byC] of Object.entries(book)) {
      const kind = k.split("|")[0];
      const repeated = Object.values(byC);
      if (!repeated.length) continue;
      nondet[`${kind}Asked`]++;
      if (repeated.some((set) => set.size > 1)) nondet[kind]++;
    }
    // Code markers and compute use per kind.
    const pr = progs.filter((p) => p.round_no === r.round_no);
    const markers = {}, comp = {};
    for (const k of KINDS) {
      const ps = pr.filter((p) => p.kind === k);
      markers[k] = Object.fromEntries(Object.keys(CODE_MARKERS).map((m) => [m, ps.filter((p) => codeMarkers(p.code)[m]).length]));
      const fr = ps.map((p) => (p.compute?.budgetMs ? p.compute.meanMs / p.compute.budgetMs : null)).filter((x) => x != null);
      const p90 = ps.map((p) => (p.compute?.budgetMs ? p.compute.p90Ms / p.compute.budgetMs : null)).filter((x) => x != null);
      comp[k] = { mean: fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null, p90max: p90.length ? Math.max(...p90) : null, n: ps.length };
    }
    out.push({
      round: r.round_no, turns: r.turns, feeds, nectar: paid, nectarPerTurn: r.turns ? paid / (r.turns * G.ents.length) : null, // per bee turn, as metrics.js
      precision: feeds ? paid / feeds : null,
      rivalCloverFed: cv ? cf / cv : null, rivalOrchidFed: ov ? of / ov : null, gap: cv && ov ? cf / cv - of / ov : null,
      asks, repeatShare: asks ? repeats / asks : null,
      rivalOrchidVisits: ov, stolenShare: ov ? stolen / ov : null, twinShare: ov ? twin / ov : null,
      nondet, markers, compute: comp, teams: G.ents.length,
    });
  }
  return out;
}
