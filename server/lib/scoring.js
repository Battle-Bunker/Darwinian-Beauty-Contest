// Scoring: Darwinian fitness = N² × pollination share × forage share.
//
// Ledgers (N×N, rows = bee team, columns = flower team), over the whole game so far:
//   feeds[b][f]   — times team b's bee fed at team f's flower
//   nectar[b][f]  — nectar (node·ms) team b's bee got from team f's flower: percent/100 × E per feed
//   pollen[b][f]  — energy team f's flower kept from team b's bee's feeds: (1 − percent/100) × E per feed
//
// rootsum(v) = Σ √v_i rewards spreading earnings across sources: 4 from one source = 2,
// 1 from each of four sources = 4. Own-team entries count like any other.
//
//   pollination_f = rootsum of column f of `pollen`  (how widely, and how profitably, the flower is pollinated)
//   forage_b      = rootsum of row b of `nectar`      (how widely the bee finds nectar)
//   each share    = value / Σ value over teams (1/N when that sum is 0)
//   fitness       = N² × pollination share × forage share  (par 1)

export const rootsum = (v) => v.reduce((s, x) => s + Math.sqrt(Math.max(0, x)), 0);

export const zeroLedger = (n) => Array.from({ length: n }, () => new Array(n).fill(0));

const column = (m, j) => m.map((row) => row[j]);
const sum = (v) => v.reduce((a, b) => a + b, 0);

/** teamIds[i] labels row/column i. Returns each team's score, in teamIds order. */
export function score(teamIds, feeds, nectar, pollen) {
  const n = teamIds.length;
  const pollination = teamIds.map((_, f) => rootsum(column(pollen, f)));
  const forage = teamIds.map((_, b) => rootsum(nectar[b]));
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
