// Species prevalence (RULES.md "Species prevalence"): which species a turn's flower is drawn from. A game whose
// config has prevalence on draws species s with probability
//   p_s = w_s / Σ_k w_k,   w_s = c(t) + P_s
// where
//   D_{b,s}  a ledger cell per (bee team b, species s), by `basis`: the pollen s gave b's bee ("pollination" and
//            "fitness"), or the times b's bee fed at s ("feeds"); with "fitness" also the nectar s paid b's bee.
//            Every cell starts at `prior`; as each round begins every cell is multiplied by d = 2^(−round_s /
//            halfLifeS) (halfLifeS null: d = 1, cumulative), then the round's feeds are added. Rounds are game
//            time, so a paused game doesn't decay.
//   Q_s      Σ_b D_{b,s}^β (β the game's scoring.beta); "fitness": pollination share × forage share of the decayed
//            ledgers (forage_s = Σ_f nectar_{s,f}^α), as the scoreboard's fitness but recent.
//   P_s      N × Q_s / Σ_k Q_k (1 for every species when Σ Q = 0), capped at `cap`: par 1, s's recent success.
//   c(t)     runs linearly from cStart at the start of the game to cEnd at its end (t / (minutes × 60 s)).
// Without a cap, Σ w = N (c + 1) and p_s = (c + P_s) / (N (c + 1)). A species nobody feeds at keeps c / Σ w.
// The garden samples every species' p_s and P_s about once a second of game time (public); programs never see
// them.
import { prevalenceOf, roundMs } from "./gameConfig.js";
import { scoringOf } from "./scoring.js";

const matrix = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));
const powsum = (xs, e) => xs.reduce((s, x) => s + (x > 0 ? Math.pow(x, e) : 0), 0);

export class Prevalence {
  /** The model for a game of n species, or throws if the config has prevalence off (use Prevalence.of). */
  constructor(config, n) {
    const s = prevalenceOf(config);
    if (!s) throw new Error("prevalence is off");
    this.settings = s;
    this.n = n;
    this.alpha = scoringOf(config).alpha;
    this.beta = scoringOf(config).beta;
    this.durationMs = config.minutes * 60000;
    this.roundMs = roundMs(config);
    this.d = s.halfLifeS ? Math.pow(2, -this.roundMs / 1000 / s.halfLifeS) : 1;
    this.D = matrix(n, s.prior);                                         // [bee][species]: pollen, or feeds
    this.N = s.basis === "fitness" ? matrix(n, s.prior) : null;          // [bee][species]: nectar (fitness only)
  }

  /** The model for a game, or null when its species are drawn uniformly. */
  static of(config, n) {
    return prevalenceOf(config) ? new Prevalence(config, n) : null;
  }

  /**
   * The model as it stands after `rounds` rounds, rebuilt from the game's feeds so far (each { round, bee,
   * flower, pollen, nectar }, team indices): exactly what playing them would have left.
   */
  static rebuild(config, n, rounds, feeds = []) {
    const m = Prevalence.of(config, n);
    if (!m) return null;
    const k = Math.pow(m.d, rounds);
    for (const row of m.D) row.fill(m.settings.prior * k);
    if (m.N) for (const row of m.N) row.fill(m.settings.prior * k);
    for (const f of feeds) {
      if (!(f.bee >= 0 && f.bee < n && f.flower >= 0 && f.flower < n) || f.round > rounds) continue;
      const w = Math.pow(m.d, rounds - f.round);
      m.D[f.bee][f.flower] += (m.settings.basis === "feeds" ? 1 : Math.max(0, f.pollen ?? 0)) * w;
      if (m.N) m.N[f.bee][f.flower] += Math.max(0, f.nectar ?? 0) * w;
    }
    return m;
  }

  /** A round begins: every cell decays by d. */
  decay() {
    if (this.d === 1) return;
    for (const M of [this.D, this.N]) if (M) for (const row of M) for (let s = 0; s < row.length; s++) row[s] *= this.d;
  }

  /** A feed in this round: bee team b at species s. */
  feed(b, s, pollen, nectar) {
    this.D[b][s] += this.settings.basis === "feeds" ? 1 : Math.max(0, pollen || 0);
    if (this.N) this.N[b][s] += Math.max(0, nectar || 0);
  }

  /** c at game time tMs. */
  c(tMs) {
    const { cStart, cEnd } = this.settings;
    const x = this.durationMs > 0 ? Math.min(1, Math.max(0, tMs / this.durationMs)) : 0;
    return cStart + (cEnd - cStart) * x;
  }

  /** Each species' Q_s. */
  q() {
    const n = this.n, col = (M, s) => M.map((row) => row[s]);
    const poll = Array.from({ length: n }, (_, s) => powsum(col(this.D, s), this.beta));
    if (this.settings.basis !== "fitness") return poll;
    const forage = this.N.map((row) => powsum(row, this.alpha));
    const share = (v) => { const t = v.reduce((a, b) => a + b, 0); return v.map((x) => (t > 0 ? x / t : 1 / n)); };
    const [pS, fS] = [share(poll), share(forage)];
    return pS.map((x, s) => x * fS[s]);
  }

  /** At game time tMs: { c, P: [P_s], w: [w_s], p: [p_s] }, by team index. */
  weights(tMs) {
    const n = this.n, q = this.q(), total = q.reduce((a, b) => a + b, 0), cap = this.settings.cap;
    const c = this.c(tMs);
    const P = q.map((x) => {
      const v = total > 0 ? (n * x) / total : 1;
      return cap == null ? v : Math.min(cap, v);
    });
    const w = P.map((x) => c + x);
    const sw = w.reduce((a, b) => a + b, 0);
    return { c, P, w, p: w.map((x) => (sw > 0 ? x / sw : 1 / n)) };
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
