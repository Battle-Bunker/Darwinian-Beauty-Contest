// Prevalence on both sides (RULES.md "Prevalence"), for a game whose config has it. Each round:
//   - K = ceil(slots × N) bee slots are filled with K distinct bee teams, drawn without replacement with
//     weights c(t) + B_b (among the bees ready to take a turn); a bee not drawn doesn't visit this round.
//   - Each drawn bee visits a flower species drawn with weights c(t) + F_s, with replacement, its own included.
// where:
//   F_s  flower success: N × Q^F_s / Σ_k Q^F_k, Q^F_s = Σ_b (D^F_{s,b})^β, D^F the decayed pollen species s
//        gave bee team b (β the game's scoring.beta). Per-(species, bee) cells, so pollen spread across many
//        bee teams counts for more and no flower–bee pair can go singleton. Each cell starts at `prior` and, as
//        each round begins, is multiplied by d = 2^(−round_s / halfLifeS) (halfLifeS null: d = 1), then the
//        round's pollen is added.
//   B_b  bee success. With `pools` (v3, the default): N × balance_b / Σ_k balance_k, balances floored at 0 for
//        the share. The bee's nectar is a single linear balance: it starts at the endowment b0, each feed adds
//        net nectar (nectar − feedPrice), and as each round begins it relaxes toward b0 by d (balance ← b0 +
//        (balance − b0) d: metabolism above b0, recovery below). A bee whose balance is below the price can't
//        feed (its feed becomes a leave). Without `pools` (v2): N × Q^B_b / Σ_k Q^B_k, Q^B_b = max(0, Σ_s
//        sign(D) |D^B_{b,s}|^α), D^B the decayed per-(bee, species) net nectar (α the game's scoring.alpha).
// Each of F and B is 1 for every team when its total is 0, and capped at `cap`: par 1. c(t), by cDecay:
//   "sech"    c = cStart × sech(k t / cHalfS), k = arccosh 2, t in seconds of game time: flat at the start, half
//             at cHalfS (0.2 × the minimum length by default), an exponential tail toward 0, no floor. It doesn't
//             depend on the game's real length, which is hidden.
//   "linear"  (v2, v3) from cStart at the start to cEnd at `minutes`, then cEnd.
// The draw probabilities published are p^F_s = (c + F_s) / Σ_k (c + F_k) and p^B_b = (c + B_b) / Σ_k (c + B_k)
// (the chance of filling a given slot first). As c → 0 a team with F (or B) 0 weighs 0: it is never drawn while
// anyone eligible weighs more; when every eligible candidate weighs 0, the draw is uniform among them.
// A team's fitness, by the game's scoring.mode, par 1:
//   "final"        N² × p^F_s × p^B_s of the latest round played (of the final round, once the game is over):
//                  the instantaneous product of its species' and its bee's draw probabilities, c and cap included
//   "timeAverage"  (v2, v3) the time-average, over the rounds played, of F_s × B_s
// Both are kept every round (fitness sums: { sum, rounds, last }), so a game can be read either way.
// The garden samples them (and the bees' balances) about once a second of game time (public); programs never see them.
import { SECH_K, feedPriceOf, prevalenceOf, roundMs, sech } from "./gameConfig.js";
import { score, scoringOf } from "./scoring.js";

/** N² × p^F × p^B for each team: the "final" fitness of a round's draw probabilities (1 at par). */
export const instantFitness = (pF, pB) => pF.map((p, i) => pF.length * pF.length * p * pB[i]);

const matrix = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));
const signedPow = (x, e) => (x > 0 ? Math.pow(x, e) : x < 0 ? -Math.pow(-x, e) : 0);

/** N × each value's share of the total (1 for all when the total is 0), capped. */
function shares(q, cap) {
  const n = q.length, total = q.reduce((a, b) => a + b, 0);
  return q.map((x) => {
    const v = total > 0 ? (n * x) / total : 1;
    return cap == null ? v : Math.min(cap, v);
  });
}

export class Prevalence {
  /** The model for a game of n teams, or throws if the config has no prevalence (use Prevalence.of). */
  constructor(config, n) {
    const s = prevalenceOf(config);
    if (!s) throw new Error("prevalence is off");
    this.settings = s;
    this.n = n;
    this.alpha = scoringOf(config).alpha;
    this.beta = scoringOf(config).beta;
    this.mode = scoringOf(config).mode;
    this.durationMs = config.minutes * 60000;   // a linear c's span: `minutes`
    this.d = s.halfLifeS ? Math.pow(2, -roundMs(config) / 1000 / s.halfLifeS) : 1;
    this.slots = Math.min(n, Math.max(1, Math.ceil(s.slots * n - 1e-9)));
    this.pools = s.pools;
    this.price = feedPriceOf(config);
    this.b0 = s.endowment;                     // a bee's nectar endowment, the balance's relaxation baseline
    this.pollen = matrix(n, s.prior);          // [species][bee team]: D^F, the pollen s gave b's bee
    this.balance = this.pools ? new Array(n).fill(this.b0) : null; // [bee team]: its single nectar balance (v3)
    this.net = this.pools ? null : matrix(n, s.prior); // [bee team][species]: D^B, the net nectar b got at s (v2)
    this.sum = new Array(n).fill(0);           // Σ over rounds of F_s × B_s
    this.rounds = 0;
    this.last = new Array(n).fill(1);          // N² × p^F_s × p^B_s of the latest round (par before any)
  }

  /** The model for a game, or null when it has no prevalence. */
  static of(config, n) {
    return prevalenceOf(config) ? new Prevalence(config, n) : null;
  }

  /**
   * The model as it stands after `rounds` rounds, rebuilt: its ledgers from the game's feeds so far (each
   * { round, bee, flower, pollen, net }, team indices), exactly what playing them would have left; its fitness
   * sums as stored ({ sum, rounds, last }).
   */
  static rebuild(config, n, rounds, feeds = [], fitness = null) {
    const m = Prevalence.of(config, n);
    if (!m) return null;
    const k = Math.pow(m.d, rounds);
    for (const row of m.pollen) row.fill(m.settings.prior * k);
    if (m.pools) m.balance.fill(m.b0);                 // b0 is the fixed point of the relaxation, so it doesn't decay
    else for (const row of m.net) row.fill(m.settings.prior * k);
    for (const f of feeds) {
      if (!(f.bee >= 0 && f.bee < n && f.flower >= 0 && f.flower < n) || f.round > rounds) continue;
      const w = Math.pow(m.d, rounds - f.round);
      m.pollen[f.flower][f.bee] += Math.max(0, f.pollen ?? 0) * w;
      if (m.pools) m.balance[f.bee] += (f.net ?? 0) * w;
      else m.net[f.bee][f.flower] += (f.net ?? 0) * w;
    }
    if (fitness && Array.isArray(fitness.sum) && fitness.sum.length === n) {
      m.sum = fitness.sum.map(Number);
      m.rounds = Number(fitness.rounds) || 0;
    }
    if (fitness && Array.isArray(fitness.last) && fitness.last.length === n) m.last = fitness.last.map(Number);
    return m;
  }

  /** A round begins: pollen decays toward 0, a bee's balance relaxes toward its endowment b0. */
  decay() {
    if (this.d === 1) return;
    for (const row of this.pollen) for (let i = 0; i < row.length; i++) row[i] *= this.d;
    if (this.pools) for (let b = 0; b < this.n; b++) this.balance[b] = this.b0 + (this.balance[b] - this.b0) * this.d;
    else for (const row of this.net) for (let i = 0; i < row.length; i++) row[i] *= this.d;
  }

  /** Whether bee b can afford a feed this round (always, unless pools and its balance is below the price). */
  canFeed(b) {
    return !this.pools || this.balance[b] >= this.price;
  }

  /** A feed in this round: bee team b at species s, the pollen s kept and the bee's net nectar (nectar − price). */
  feed(b, s, pollen, net) {
    this.pollen[s][b] += Math.max(0, pollen || 0);
    if (this.pools) this.balance[b] += net || 0;
    else this.net[b][s] += net || 0;
  }

  /** c at game time tMs: cStart × sech(k t / cHalfS) (sech), or from cStart to cEnd over `minutes` (linear). */
  c(tMs) {
    const { cDecay, cStart, cEnd, cHalfS } = this.settings;
    if (cDecay === "sech") return cStart * sech((SECH_K * Math.max(0, tMs)) / 1000 / cHalfS);
    const x = this.durationMs > 0 ? Math.min(1, Math.max(0, tMs / this.durationMs)) : 0;
    return cStart + (cEnd - cStart) * x;
  }

  /** { F, B }: each team's flower and bee success, by team index. */
  success() {
    const qF = this.pollen.map((row) => row.reduce((a, x) => a + (x > 0 ? Math.pow(x, this.beta) : 0), 0));
    const qB = this.pools
      ? this.balance.map((x) => Math.max(0, x))
      : this.net.map((row) => Math.max(0, row.reduce((a, x) => a + signedPow(x, this.alpha), 0)));
    return { F: shares(qF, this.settings.cap), B: shares(qB, this.settings.cap) };
  }

  /** At game time tMs: { c, F, B, wF, wB, pF, pB, slots }, by team index. */
  weights(tMs) {
    const c = this.c(tMs), { F, B } = this.success();
    const wF = F.map((x) => c + x), wB = B.map((x) => c + x);
    const norm = (w) => { const t = w.reduce((a, b) => a + b, 0); return w.map((x) => (t > 0 ? x / t : 1 / w.length)); };
    return { c, F, B, wF, wB, pF: norm(wF), pB: norm(wB), slots: this.slots };
  }

  /** Each bee's nectar balance (pools), or null (v2). */
  balances() {
    return this.pools ? [...this.balance] : null;
  }

  /** A round's weights ({ F, B, pF, pB }, from weights()) go into each team's fitness: F × B, and N² × p^F × p^B. */
  tally({ F, B, pF, pB }) {
    for (let i = 0; i < this.n; i++) this.sum[i] += F[i] * B[i];
    this.rounds++;
    this.last = instantFitness(pF, pB);
  }

  /** Each team's fitness so far, by the game's mode (1, par, before any round). */
  fitness() {
    return this.mode === "final" ? [...this.last] : this.sum.map((x) => (this.rounds > 0 ? x / this.rounds : 1));
  }

  /** The fitness sums, as stored (games.fitness): { sum, rounds, last }. */
  sums() {
    return { sum: [...this.sum], rounds: this.rounds, last: [...this.last] };
  }
}

/**
 * Draw an index with probability proportional to weights[i] among `allowed` indices: one weighing 0 is never
 * drawn while another weighs more; when they all weigh 0 (or the weights aren't numbers), uniformly.
 */
export function drawWeighted(weights, allowed, rand = Math.random) {
  if (!allowed.length) return null;
  const w = (i) => (weights[i] > 0 ? weights[i] : 0);
  const total = allowed.reduce((s, i) => s + w(i), 0);
  if (!(total > 0) || !Number.isFinite(total)) return allowed[Math.min(allowed.length - 1, Math.floor(rand() * allowed.length))];
  let u = rand() * total, last = null;
  for (const i of allowed) {
    if (!(w(i) > 0)) continue;
    last = i;
    u -= w(i);
    if (u < 0) return i;
  }
  return last; // rounding left u at 0: the last one that weighs anything
}

/** k distinct indices among `allowed`, drawn one after another without replacement, by weight. */
export function sampleWithout(weights, allowed, k, rand = Math.random) {
  const left = [...allowed], out = [];
  while (out.length < k && left.length) {
    const i = drawWeighted(weights, left, rand);
    out.push(i);
    left.splice(left.indexOf(i), 1);
  }
  return out;
}

/** A game's fitness by its stored sums ({ sum, rounds, last }; null before any round: par) and mode, team i. */
export function fitnessOf(mode, fitness, i) {
  if (mode === "final") return Array.isArray(fitness?.last) ? Number(fitness.last[i] ?? 1) : 1;
  return fitness && fitness.rounds > 0 ? fitness.sum[i] / fitness.rounds : 1;
}

/**
 * A game's scoreboard rows (participants order): the ledgers' totals (scoring.js), and its fitness. A game with
 * prevalence: fitness by its scoring.mode from `fitness`, its stored sums (fitnessOf; 1 before any round), with
 * each team's latest F, B, p^F and p^B (`sample`, as stored; null before the first). A game without it:
 * N² × pollination share × forage share, those four null.
 */
export function scoreboard(config, participants, feeds, nectar, pollen, fitness = null, sample = null) {
  const scoring = scoringOf(config);
  const rows = score(participants, feeds, nectar, pollen, scoring);
  const on = !!prevalenceOf(config);
  return rows.map((r, i) => {
    const at = (k) => (on && sample && Array.isArray(sample[k]) ? sample[k][i] ?? null : null);
    return { ...r, fitness: on ? fitnessOf(scoring.mode, fitness, i) : r.fitness, flowerSuccess: at("F"), beeSuccess: at("B"), flowerP: at("pF"), beeP: at("pB") };
  });
}

/** How a game's scoreboard fitness is reckoned: "final" or "timeAverage" (prevalence), else "shares". */
export const fitnessBasisOf = (config) => (prevalenceOf(config) ? scoringOf(config).mode : "shares");
