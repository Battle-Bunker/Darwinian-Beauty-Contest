// Prevalence on both sides (RULES.md "Prevalence"), for a game whose config has it. Each round:
//   - K = ceil(slots × N) bee slots are filled with K distinct bee teams, drawn without replacement with
//     weights c(t) + B_b (among the bees ready to take a turn); a bee not drawn doesn't visit this round.
//   - Each drawn bee visits a flower species drawn with weights c(t) + F_s, with replacement, its own included.
// where, from ledgers every cell of which starts at `prior` and, as each round begins, is multiplied by
// d = 2^(−round_s / halfLifeS) (halfLifeS null: d = 1, cumulative) before that round's feeds are added (rounds
// are game time, so a paused game doesn't decay):
//   F_s  flower success: N × Q^F_s / Σ_k Q^F_k, Q^F_s = Σ_b (D^F_{s,b})^β, D^F the pollen species s gave bee
//        team b (β the game's scoring.beta). Generosity costs the flower: pollen is what it keeps.
//   B_b  bee success: N × Q^B_b / Σ_k Q^B_k, Q^B_b = max(0, Σ_s sign(D) |D^B_{b,s}|^α), D^B the net nectar
//        bee b got at species s, nectar − feedPrice per feed: it can go negative (α the game's scoring.alpha).
// Each is 1 for every team when its Σ Q is 0, and capped at `cap`: par 1. c(t) runs linearly from cStart at the
// start of the game to cEnd at its end. The draw probabilities published are p^F_s = (c + F_s) / Σ_k (c + F_k)
// and p^B_b = (c + B_b) / Σ_k (c + B_k) (the chance of filling a given slot first).
// A team's fitness is the time-average, over the rounds played, of F_s × B_s (its species' and its bee's), par 1.
// The garden samples them about once a second of game time (public); programs never see them.
import { prevalenceOf, roundMs } from "./gameConfig.js";
import { score, scoringOf } from "./scoring.js";

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
    this.durationMs = config.minutes * 60000;
    this.d = s.halfLifeS ? Math.pow(2, -roundMs(config) / 1000 / s.halfLifeS) : 1;
    this.slots = Math.min(n, Math.max(1, Math.ceil(s.slots * n - 1e-9)));
    this.pollen = matrix(n, s.prior);  // [species][bee team]: D^F, the pollen s gave b's bee
    this.net = matrix(n, s.prior);     // [bee team][species]: D^B, the net nectar b's bee got at s
    this.sum = new Array(n).fill(0);   // Σ over rounds of F_s × B_s
    this.rounds = 0;
  }

  /** The model for a game, or null when it has no prevalence. */
  static of(config, n) {
    return prevalenceOf(config) ? new Prevalence(config, n) : null;
  }

  /**
   * The model as it stands after `rounds` rounds, rebuilt: its ledgers from the game's feeds so far (each
   * { round, bee, flower, pollen, net }, team indices), exactly what playing them would have left; its fitness
   * sums as stored ({ sum, rounds }).
   */
  static rebuild(config, n, rounds, feeds = [], fitness = null) {
    const m = Prevalence.of(config, n);
    if (!m) return null;
    const k = Math.pow(m.d, rounds);
    for (const M of [m.pollen, m.net]) for (const row of M) row.fill(m.settings.prior * k);
    for (const f of feeds) {
      if (!(f.bee >= 0 && f.bee < n && f.flower >= 0 && f.flower < n) || f.round > rounds) continue;
      const w = Math.pow(m.d, rounds - f.round);
      m.pollen[f.flower][f.bee] += Math.max(0, f.pollen ?? 0) * w;
      m.net[f.bee][f.flower] += (f.net ?? 0) * w;
    }
    if (fitness && Array.isArray(fitness.sum) && fitness.sum.length === n) {
      m.sum = fitness.sum.map(Number);
      m.rounds = Number(fitness.rounds) || 0;
    }
    return m;
  }

  /** A round begins: every cell decays by d. */
  decay() {
    if (this.d === 1) return;
    for (const M of [this.pollen, this.net]) for (const row of M) for (let i = 0; i < row.length; i++) row[i] *= this.d;
  }

  /** A feed in this round: bee team b at species s, the pollen s kept and the bee's net nectar (nectar − price). */
  feed(b, s, pollen, net) {
    this.pollen[s][b] += Math.max(0, pollen || 0);
    this.net[b][s] += net || 0;
  }

  /** c at game time tMs. */
  c(tMs) {
    const { cStart, cEnd } = this.settings;
    const x = this.durationMs > 0 ? Math.min(1, Math.max(0, tMs / this.durationMs)) : 0;
    return cStart + (cEnd - cStart) * x;
  }

  /** { F, B }: each team's flower and bee success, by team index. */
  success() {
    const qF = this.pollen.map((row) => row.reduce((a, x) => a + (x > 0 ? Math.pow(x, this.beta) : 0), 0));
    const qB = this.net.map((row) => Math.max(0, row.reduce((a, x) => a + signedPow(x, this.alpha), 0)));
    return { F: shares(qF, this.settings.cap), B: shares(qB, this.settings.cap) };
  }

  /** At game time tMs: { c, F, B, wF, wB, pF, pB, slots }, by team index. */
  weights(tMs) {
    const c = this.c(tMs), { F, B } = this.success();
    const wF = F.map((x) => c + x), wB = B.map((x) => c + x);
    const norm = (w) => { const t = w.reduce((a, b) => a + b, 0); return w.map((x) => (t > 0 ? x / t : 1 / w.length)); };
    return { c, F, B, wF, wB, pF: norm(wF), pB: norm(wB), slots: this.slots };
  }

  /** A round's F × B goes into each team's fitness. */
  tally(F, B) {
    for (let i = 0; i < this.n; i++) this.sum[i] += F[i] * B[i];
    this.rounds++;
  }

  /** Each team's fitness so far: the time-average of F × B (1, par, before any round). */
  fitness() {
    return this.sum.map((x) => (this.rounds > 0 ? x / this.rounds : 1));
  }
}

/** Draw an index with probability proportional to weights[i] among `allowed` indices (uniform if they weigh 0). */
export function drawWeighted(weights, allowed, rand = Math.random) {
  if (!allowed.length) return null;
  const total = allowed.reduce((s, i) => s + Math.max(0, weights[i]), 0);
  if (!(total > 0)) return allowed[Math.floor(rand() * allowed.length)];
  let u = rand() * total;
  for (const i of allowed) {
    u -= Math.max(0, weights[i]);
    if (u < 0) return i;
  }
  return allowed[allowed.length - 1];
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

/**
 * A game's scoreboard rows (participants order): the ledgers' totals (scoring.js), and its fitness. A game with
 * prevalence: fitness is the time-average of F × B (`fitness`, its stored { sum, rounds }; 1 before any round),
 * with each team's latest F, B, p^F and p^B (`sample`, as stored; null before the first). A game without it:
 * N² × pollination share × forage share, those four null.
 */
export function scoreboard(config, participants, feeds, nectar, pollen, fitness = null, sample = null) {
  const rows = score(participants, feeds, nectar, pollen, scoringOf(config));
  const on = !!prevalenceOf(config);
  return rows.map((r, i) => {
    const at = (k) => (on && sample && Array.isArray(sample[k]) ? sample[k][i] ?? null : null);
    const avg = fitness && fitness.rounds > 0 ? fitness.sum[i] / fitness.rounds : 1;
    return { ...r, fitness: on ? avg : r.fitness, flowerSuccess: at("F"), beeSuccess: at("B"), flowerP: at("pF"), beeP: at("pB") };
  });
}
