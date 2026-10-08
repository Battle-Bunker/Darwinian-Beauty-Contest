// Honest wealth signalling, from each flower call's hidden time budget R (uniform in a range, its hard limit; E = (cap −
// size) × max(0, R − CPU ms), times (byte cap − response bytes) / byte cap in games with the byte factor, lib/energy.js;
// private to the flower's team during play, revealed after the game). Pure computation over a
// finished game's turns, each with `R` (ms), `ms` (CPU), the response's size in bytes, its visible work (see workOf) and
// whether the bee fed:
//   per species  does its effort (CPU ms) and its visible work (response size, graph size, labels) follow R? Spearman
//                correlations; honest when visible work rises with R (rho ≥ 0.3 over 30+ answered turns), and then
//                costly when its effort rises with R too (rho ≥ 0.3: a poor instance couldn't afford it), else cheap
//                (R shown without spending it, e.g. written into a label: a poor flower could claim the same)
//   per bee      does it feed more at rich instances (the top third of R) than at poor ones (the bottom third)? And
//                overall: feed rate by R tercile, and the correlation of R with feeding
// R is uniform per call, so a species whose visible work tracks R is signalling its wealth honestly: richer instances
// show more, and a bee that feeds more where more is shown feeds more at the rich.

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** Ranks (average ranks for ties). */
function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
function pearson(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}
/** A species' wealth signal from its correlations (works on stored metrics too): "costly" (visible work and effort
 * both follow R), "cheap" (visible work follows R, effort doesn't) or null. */
export function honestyOf(s) {
  if (!s || !(s.turns >= 30)) return null;
  const work = Math.max(s.bytes ?? -1, s.nodes ?? -1);
  if (work < 0.3) return null;
  return (s.effort ?? 0) >= 0.3 ? "costly" : "cheap";
}

/** Spearman's rank correlation of pairs [x, y] (null with fewer than 3, or when either doesn't vary). */
export function spearman(pairs) {
  const ps = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return ps.length < 3 ? null : pearson(ranks(ps.map((p) => p[0])), ranks(ps.map((p) => p[1])));
}

/** The visible work of a response: its size in bytes; for a graph, also its nodes and edges (and labels' total length). */
export function workOf(t) {
  const r = t.r;
  const out = { bytes: Number.isFinite(t.rBytes) ? t.rBytes : r != null ? Buffer.byteLength(JSON.stringify(r)) : null, nodes: null, edges: null };
  if (r && typeof r === "object" && !Array.isArray(r) && Number.isFinite(r.nodes) && Array.isArray(r.edges)) { out.nodes = r.nodes; out.edges = r.edges.length; }
  else if (r && typeof r === "object" && typeof r.shape === "string") { const m = r.shape.match(/^graph:(\d+):(\d+):/); if (m) { out.nodes = Number(m[1]); out.edges = Number(m[2]); } }
  return out;
}

const terciles = (xs) => { const s = [...xs].sort((a, b) => a - b); return [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]]; };

/**
 * turns: [{ flower, bee (team ids), action, R, ms, r, rBytes }]; ids; name: id -> name; range: [lo, hi] ms (the config's).
 * Returns null when no turn has an R (the game didn't have budgets).
 */
export function wealthMetrics({ turns, ids, name = {}, range = null }) {
  const withR = turns.filter((t) => Number.isFinite(t.R));
  if (!withR.length) return null;
  const answered = withR.filter((t) => t.r != null);
  const nm = (id) => name[id] ?? id;
  const species = ids.map((id) => {
    const ts = answered.filter((t) => t.flower === id);
    const w = ts.map((t) => ({ R: t.R, ms: t.ms, ...workOf(t), fed: t.action === "feed" ? 1 : 0 }));
    const rho = (k) => r3(spearman(w.map((x) => [x.R, x[k]])));
    const rhoWork = rho("bytes") ?? rho("nodes");
    const row = { team: nm(id), teamId: id, turns: ts.length, effort: rho("ms"), bytes: rho("bytes"), nodes: rho("nodes"), edges: rho("edges"), fed: rho("fed"),
      honest: ts.length >= 30 && Math.max(rhoWork ?? -1, rho("nodes") ?? -1) >= 0.3 };
    row.signal = honestyOf(row);
    return row;
  });
  const [lo, hi] = terciles(withR.map((t) => t.R));
  const rate = (ts) => (ts.length ? ts.filter((t) => t.action === "feed").length / ts.length : null);
  const bees = ids.map((id) => {
    const ts = withR.filter((t) => t.bee === id && t.flower !== id);
    const poor = ts.filter((t) => t.R <= lo), rich = ts.filter((t) => t.R > hi);
    return { team: nm(id), teamId: id, turns: ts.length, poor: r3(rate(poor)), rich: r3(rate(rich)), lift: rate(poor) != null && rate(rich) != null ? r3(rate(rich) - rate(poor)) : null,
      rho: r3(spearman(ts.map((t) => [t.R, t.action === "feed" ? 1 : 0]))) };
  });
  const rival = withR.filter((t) => t.bee !== t.flower);
  return {
    range, turns: withR.length, cuts: [r3(lo), r3(hi)],
    feedRate: { poor: r3(rate(rival.filter((t) => t.R <= lo))), middle: r3(rate(rival.filter((t) => t.R > lo && t.R <= hi))), rich: r3(rate(rival.filter((t) => t.R > hi))) },
    feedRho: r3(spearman(rival.map((t) => [t.R, t.action === "feed" ? 1 : 0]))),
    honestSpecies: species.filter((s) => s.honest).length, costlySpecies: species.filter((s) => s.signal === "costly").length,
    cheapSpecies: species.filter((s) => s.signal === "cheap").length, species, bees,
  };
}
