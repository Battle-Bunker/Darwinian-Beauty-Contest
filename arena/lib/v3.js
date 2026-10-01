// Engine v3 measures for analyze.js (read-only): per round of a game, from the visits bees actually made and the
// programs that played.
//   - nectar per turn, pooled precision (paid feeds / feeds)
//   - discrimination on RIVAL patches: clover fed rate vs orchid fed rate, and the gap
//   - fingerprinting: share of a bee's pre-feed asks that repeat a challenge it already asked this game; rotation:
//     share of its pre-feed asks that are new compared with its previous round
//   - stolen-face orchid visits (every pre-feed answer equals a rival clover's answer to that challenge this round),
//     twin orchid visits (equals the orchid's own clover's answer), and generator copies (every answer has the same
//     shape, size and edge count as a rival clover's answer to that challenge, without being an exact copy)
//   - non-determinism: flowers seen giving different answers to the same challenge within a round; code using
//     random, the clock or GAME["ms"]
//   - turn dynamics: the kind whose turn it was, how many teams changed it and by how much (in the game's size unit); clover and
//     orchid answer-style turnover (modal answer shape differs from the previous round)
//   - compute use against budget (round_programs.compute: every call counts under v3)
//   - markers of the example ideas in code (Paley clique chain, graceful labelling)
//   - rank churn (Kendall τ of round ranks vs the previous round) and fitness spread, from the stored round metrics
import { all } from "./db.js";
import { graphShape } from "./cohort.js";
import { changeable } from "../../server/lib/schedule.js";

const KINDS = ["clover", "orchid", "bee"];
const strip = (c) => (c || "").replace(/#.*$/gm, "");
const key = (x) => JSON.stringify(x);

/** Static markers in one program's code (comments stripped). */
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

/** Structural signature of an answer: shape, size and edge count (graphs); the value's type and length otherwise. */
function signature(r) {
  if (r && typeof r === "object" && Array.isArray(r.edges)) return `${graphShape(r)}|n${r.nodes}|m${r.edges.length}`;
  return `${typeof r}|${key(r)?.length ?? 0}`;
}
const mode = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };

/** Per-round v3 stats for one game (G from cohort.js gameRef). */
export async function v3RoundStats(G) {
  const rounds = await all("SELECT round_no, turns, feeds, nectar FROM rounds WHERE game_id = $1 ORDER BY round_no", [G.uuid]);
  const visits = await all("SELECT round_no, bee_team, patch_team, kind, action, nectar, steps FROM visits WHERE game_id = $1 ORDER BY round_no, bee_team, seq", [G.uuid]);
  const progs = await all("SELECT round_no, team_id, kind, code, compute, distance, carried_over FROM round_programs WHERE game_id = $1", [G.uuid]);
  const rms = Object.fromEntries((await all("SELECT round_no, metrics FROM arena.round_metrics WHERE game_id = $1", [G.row.id])).map((x) => [x.round_no, x.metrics]));
  const teams = G.ents.map((e) => e.team_id);
  const seenByBee = {}; // challenges each bee asked so far this game
  let lastRoundAsks = {}; // challenges each bee asked last round
  let lastStyle = {}; // modal answer shape per kind|team last round
  const out = [];
  for (const r of rounds) {
    const vs = visits.filter((v) => v.round_no === r.round_no);
    // Every answer (and answer signature) each flower gave to each challenge this round.
    const book = {}, sigs = {}, styles = {};
    for (const v of vs) for (const s of v.steps || []) if (s.r !== undefined) {
      const k = `${v.kind}|${v.patch_team}`;
      ((book[k] ||= {})[key(s.c)] ||= new Set()).add(key(s.r));
      ((sigs[k] ||= {})[key(s.c)] ||= new Set()).add(signature(s.r));
      (styles[k] ||= []).push(graphShape(s.r));
    }
    const cloverHas = (patch, c, ans) => book[`clover|${patch}`]?.[c]?.has(ans);
    const cloverSig = (patch, c, sig) => sigs[`clover|${patch}`]?.[c]?.has(sig);
    let feeds = 0, paid = 0, cv = 0, cf = 0, ov = 0, of = 0, stolen = 0, twin = 0, genCopy = 0, asks = 0, repeats = 0, fresh = 0, prevComparable = 0;
    const thisRoundAsks = {};
    for (const v of vs) {
      const pre = (v.steps || []).filter((s) => !s.after);
      const mine = (seenByBee[v.bee_team] ||= new Set());
      const last = lastRoundAsks[v.bee_team];
      const now = (thisRoundAsks[v.bee_team] ||= new Set());
      for (const s of pre) {
        const k = key(s.c);
        asks++;
        if (mine.has(k)) repeats++; else mine.add(k);
        if (last) { prevComparable++; if (!last.has(k)) fresh++; }
        now.add(k);
      }
      if (v.action === "feed") { feeds++; if (v.nectar) paid++; }
      if (v.bee_team === v.patch_team) continue;
      const fed = v.action === "feed";
      if (v.kind === "clover") { cv++; if (fed) cf++; continue; }
      ov++; if (fed) of++;
      const answered = pre.filter((s) => s.r !== undefined);
      if (!answered.length) continue;
      const others = teams.filter((t) => t !== v.patch_team);
      const exact = answered.every((s) => others.some((t) => cloverHas(t, key(s.c), key(s.r))));
      if (exact) stolen++;
      else if (answered.every((s) => others.some((t) => cloverSig(t, key(s.c), signature(s.r))))) genCopy++;
      if (answered.every((s) => cloverHas(v.patch_team, key(s.c), key(s.r)))) twin++;
    }
    // Non-determinism seen: a flower that gave 2+ different answers to one challenge in this round.
    const nondet = { clover: 0, orchid: 0, cloverAsked: 0, orchidAsked: 0 };
    for (const [k, byC] of Object.entries(book)) {
      const kind = k.split("|")[0];
      nondet[`${kind}Asked`]++;
      if (Object.values(byC).some((set) => set.size > 1)) nondet[kind]++;
    }
    // Answer-style turnover: modal answer shape per flower vs last round.
    const style = Object.fromEntries(Object.entries(styles).map(([k, xs]) => [k, mode(xs)]));
    const turnover = {};
    for (const kind of ["clover", "orchid"]) {
      const ks = Object.keys(style).filter((k) => k.startsWith(kind + "|") && lastStyle[k]);
      turnover[kind] = ks.length ? ks.filter((k) => style[k] !== lastStyle[k]).length / ks.length : null;
    }
    // The turn: which kind could change, how many teams changed it, by how much (in the game's size unit).
    const turnKinds = r.round_no === 1 ? KINDS : changeable(r.round_no);
    const pr = progs.filter((p) => p.round_no === r.round_no);
    const changedProgs = r.round_no > 1 ? pr.filter((p) => turnKinds.includes(p.kind) && !p.carried_over && (p.distance ?? 0) > 0) : [];
    // Code markers and compute use per kind.
    const markers = {}, comp = {};
    for (const k of KINDS) {
      const ps = pr.filter((p) => p.kind === k);
      markers[k] = Object.fromEntries(Object.keys(CODE_MARKERS).map((m) => [m, ps.filter((p) => codeMarkers(p.code)[m]).length]));
      const fr = ps.map((p) => (p.compute?.budgetMs ? p.compute.meanMs / p.compute.budgetMs : null)).filter((x) => x != null);
      const p90 = ps.map((p) => (p.compute?.budgetMs ? p.compute.p90Ms / p.compute.budgetMs : null)).filter((x) => x != null);
      comp[k] = { mean: fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null, p90max: p90.length ? Math.max(...p90) : null, n: ps.length };
    }
    const m = rms[r.round_no] || {};
    out.push({
      round: r.round_no, turns: r.turns, feeds, nectar: paid, nectarPerTurn: r.turns ? paid / (r.turns * teams.length) : null, // per bee turn, as metrics.js
      precision: feeds ? paid / feeds : null,
      rivalCloverFed: cv ? cf / cv : null, rivalOrchidFed: ov ? of / ov : null, gap: cv && ov ? cf / cv - of / ov : null,
      asks, repeatShare: asks ? repeats / asks : null, freshShare: prevComparable ? fresh / prevComparable : null,
      rivalOrchidVisits: ov, stolenShare: ov ? stolen / ov : null, twinShare: ov ? twin / ov : null, genCopyShare: ov ? genCopy / ov : null,
      nondet, turnover, markers, compute: comp, teams: teams.length,
      turn: r.round_no === 1 ? "all" : turnKinds.join("+"), turnChanged: r.round_no > 1 ? changedProgs.length : null,
      turnChars: changedProgs.length ? changedProgs.reduce((a, p) => a + p.distance, 0) / changedProgs.length : null,
      rankTau: m.rankTau ?? null, fitnessStd: m.fitnessStd ?? null,
    });
    lastRoundAsks = thisRoundAsks;
    lastStyle = style;
  }
  return out;
}
