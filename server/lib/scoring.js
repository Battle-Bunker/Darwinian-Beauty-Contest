// Scoring: Darwinian fitness = N² × pollination share × forage share.
//
// Ledgers (N×N, rows = bee team, columns = flower team), over the whole game so far:
//   feeds[b][f]   — times team b's bee fed at team f's flower
//   nectar[b][f]  — nectar (node·ms) team b's bee got from team f's flower: percent/100 × E per feed
//   pollen[b][f]  — energy team f's flower kept from team b's bee's feeds: (1 − percent/100) × E per feed
//
// powsum(v, p) = Σ v_i^p, with 0 < p ≤ 1. Below 1 it rewards spreading earnings across sources: at p = 0.5,
// 4 from one source = 2, 1 from each of four sources = 4. Own-team entries count like any other.
//
//   pollination_f = powsum of column f of `pollen`, p = beta  (how widely, and how profitably, the flower is pollinated)
//   forage_b      = powsum of row b of `nectar`, p = alpha    (how widely the bee finds nectar)
//   each share    = value / Σ value over teams (1/N when that sum is 0)
//   fitness       = N² × pollination share × forage share  (par 1)
//
// The exponents are the game's config.scoring (0.85 and 0.85 by default). Games stored without them are from
// before they existed and were scored with √: scoringOf gives them 0.5, so their scores never change.
//
// That is the score of a game without prevalence. A game with it is scored by config.scoring.mode
// (server/lib/prevalence.js): "final" (new games), N² × p^F_s × p^B_s at the game's final round, the product of
// the team's draw probabilities; "timeAverage" (games stored without a mode: v2 and v3), the time-average over
// the rounds played of F_s × B_s.

/** The scoring modes of a game with prevalence. */
export const SCORING_MODES = ["final", "timeAverage"];

/** The exponents (and mode) of games whose config has none: they were scored with √ (and, with prevalence, by time-average). */
export const LEGACY_SCORING = Object.freeze({ alpha: 0.5, beta: 0.5, mode: "timeAverage" });

/**
 * A game's scoring rule from its stored config: its exponents { alpha (forage), beta (pollination) } and its
 * mode ("final" or "timeAverage": only a config that says "final" is; one stored without a mode is "timeAverage").
 */
export const scoringOf = (config) => ({
  alpha: config?.scoring?.alpha ?? LEGACY_SCORING.alpha,
  beta: config?.scoring?.beta ?? LEGACY_SCORING.beta,
  mode: config?.scoring?.mode === "final" ? "final" : LEGACY_SCORING.mode,
});

/** Σ max(0, v_i)^p. At p = 0.5 it is exactly Σ √v_i, as games were scored before the exponents. */
export function powsum(v, p) {
  const pow = p === 0.5 ? Math.sqrt : (x) => Math.pow(x, p);
  return v.reduce((s, x) => s + pow(Math.max(0, x)), 0);
}
export const rootsum = (v) => powsum(v, 0.5);

export const zeroLedger = (n) => Array.from({ length: n }, () => new Array(n).fill(0));

const column = (m, j) => m.map((row) => row[j]);
const sum = (v) => v.reduce((a, b) => a + b, 0);

/**
 * teamIds[i] labels row/column i; `scoring` is the game's exponents (scoringOf(config); left out, √).
 * Returns each team's score, in teamIds order.
 */
export function score(teamIds, feeds, nectar, pollen, scoring = LEGACY_SCORING) {
  const { alpha, beta } = scoring;
  const n = teamIds.length;
  const pollination = teamIds.map((_, f) => powsum(column(pollen, f), beta));
  const forage = teamIds.map((_, b) => powsum(nectar[b], alpha));
  const share = (v) => { const tot = sum(v); return v.map((x) => (tot > 0 ? x / tot : 1 / n)); };
  const [pS, fS] = [share(pollination), share(forage)];
  return teamIds.map((teamId, i) => ({
    teamId,
    pollination: pollination[i],
    forage: forage[i],
    pollinationShare: pS[i],
    forageShare: fS[i],
    fitness: n * n * pS[i] * fS[i],
    pollen: sum(column(pollen, i)),
    feedsReceived: sum(column(feeds, i)),
    feedsGiven: sum(feeds[i]),
    pollinators: column(feeds, i).filter((x) => x > 0).length,
    nectarCollected: sum(nectar[i]),
    nectarGiven: sum(column(nectar, i)),
    nectarSources: nectar[i].filter((x) => x > 0).length,
  }));
}
