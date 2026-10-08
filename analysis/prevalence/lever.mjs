// How much does prevalence let a flower cut its percent? (the user's predicted tension, in isolation)
//
//   node analysis/prevalence/lever.mjs
//
// A rate-maximising bee accepts a draw iff its value ≥ feedCost × (its best long-run rate). Rejecting costs one
// round; a feed costs 1 + feedCost rounds. For a cheap veteran with prevalence share π (the other 13 species share
// 1 − π in proportion), find the lowest percent the bee still accepts, and the percent that maximises the veteran's
// pollen per minute when 5 of 14 bees are blind and 9 discern like this bee.
// The others: 6 veterans at 30%, 5 cooperators at 50% (burn 0.4), 2 defectors at 0%. Values are x^0.85 (a first feed).
const Evet = 1060 * 75.9 * 974, Ecoop = 690 * 0.6 * 76.5 * 939, Edef = 1040 * 75.9 * 974;
const others = [...Array(6).fill(0.3 * Evet), ...Array(5).fill(0.5 * Ecoop), 0, 0];
const val = (x) => (x > 0 ? Math.pow(x, 0.85) : 0);

function bee(piS, vS, feedCost) {
  const opts = [{ pi: piS, v: vS, me: true }, ...others.map((x) => ({ pi: (1 - piS) / others.length, v: val(x) }))];
  const sorted = opts.filter((o) => o.v > 0).sort((a, b) => b.v - a.v);
  let best = 0, sp = 0, sv = 0;
  for (const o of sorted) { sp += o.pi; sv += o.pi * o.v; best = Math.max(best, sv / (1 + feedCost * sp)); }
  const kappa = feedCost * best;
  const A = opts.filter((o) => o.v > 0 && o.v >= kappa).reduce((s, o) => s + o.pi, 0);
  return { accepts: vS > 0 && vS >= kappa, A };
}

const lines = ["| feed cost | π (share of draws) | lowest percent a discerning bee accepts | percent maximising pollen/min (5 blind, 9 discerning) |", "|---|---|---|---|"];
for (const feedCost of [5, 20, 50]) {
  for (const piS of [1 / 14, 0.15, 0.25, 0.4, 0.6, 0.8, 0.9]) {
    let qmin = null;
    for (let q = 0; q <= 100; q++) if (bee(piS, val((q / 100) * Evet), feedCost).accepts) { qmin = q; break; }
    let bestQ = 0, bestY = -1;
    for (let q = 0; q <= 100; q++) {
      const b = bee(piS, val((q / 100) * Evet), feedCost);
      const blindRate = 300 / (1 + feedCost), discRate = 300 / (1 + feedCost * b.A);
      const y = piS * (1 - q / 100) * Evet * (5 * blindRate + (b.accepts ? 9 * discRate : 0));
      if (y > bestY) { bestY = y; bestQ = q; }
    }
    lines.push(`| ${feedCost} | ${piS.toFixed(2)} | ${qmin ?? "never"} | ${bestQ} |`);
  }
}
console.log(lines.join("\n"));
