// Scoring: Darwinian fitness = N² × allure share × forage share.
//
// Ledgers (N×N, rows = bee team, columns = flower patch team), over the whole game so far (or any
// stretch of it, e.g. the last five minutes):
//   feeds[s][o]  — times team s's bee fed at team o's patch (clover or orchid)
//   nectar[s][o] — nectar team s's bee collected from team o's patch (clover feeds only)
//
// rootsum(v) = Σ √v_i rewards spreading earnings across sources: 4 from one source = 2,
// 1 from each of four sources = 4. Own-team entries count like any other.
//
//   allure_o  = rootsum of column o of `feeds`   (how widely the patch is pollinated)
//   forage_s  = rootsum of row s of `nectar`     (how widely the bee finds real nectar)
//   allure share = allure / Σ allure over teams   (par 1/N)
//   forage share = forage / Σ forage over teams   (par 1/N)
//   fitness      = N² × allure share × forage share  (par 1)

export const rootsum = (v) => v.reduce((s, x) => s + Math.sqrt(Math.max(0, x)), 0);

export const zeroLedger = (n) => Array.from({ length: n }, () => new Array(n).fill(0));

/** teamIds[i] labels row/column i. Returns per-team score breakdown in teamIds order. */
export function score(teamIds, feeds, nectar) {
  const n = teamIds.length;
  const allure = teamIds.map((_, o) => rootsum(feeds.map((row) => row[o])));
  const forage = teamIds.map((_, s) => rootsum(nectar[s]));
  const totA = allure.reduce((a, b) => a + b, 0);
  const totF = forage.reduce((a, b) => a + b, 0);
  return teamIds.map((teamId, i) => {
    // With nothing earned anywhere, everyone is equal: par share.
    const allureShare = totA > 0 ? allure[i] / totA : 1 / n;
    const forageShare = totF > 0 ? forage[i] / totF : 1 / n;
    return {
      teamId,
      feedsReceived: feeds.reduce((s, row) => s + row[i], 0),
      feedsGiven: feeds[i].reduce((a, b) => a + b, 0),
      nectarCollected: nectar[i].reduce((a, b) => a + b, 0),
      pollinators: feeds.filter((row) => row[i] > 0).length,
      nectarSources: nectar[i].filter((x) => x > 0).length,
      allure: allure[i],
      forage: forage[i],
      allureShare,
      forageShare,
      fitness: n * n * allureShare * forageShare,
    };
  });
}
