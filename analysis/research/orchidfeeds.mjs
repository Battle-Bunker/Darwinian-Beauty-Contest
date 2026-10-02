// Why did orchids get fed? Classify every feed at a rival orchid by what the bee could have known about the exact
// (first question, answer) pair it saw: from its own feeds earlier this round, or from its own log of earlier rounds.
//   paid-before  : that exact pair had paid nectar before (twin / copy of a clover answer): deception by imitation
//   failed-before: that pair had only ever failed (this round or in the bee's own log): evidence ignored/forgotten
//   new-face     : never fed at that pair before (first-taste exploration)  [split: seen in log only as a non-feed?]
import { loadAll, label, clean, mean, pct, f2, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const out = {};
for (const g of games) {
  const A = (out[g.arena] ||= { feeds: 0, ofeeds: 0, paidBefore: 0, paidRound: 0, failedRound: 0, failedLog: 0, newFace: 0, newFaceRepeatFlower: 0, cfeeds: 0, cNew: 0, cKnown: 0 });
  const log = {}; // bee -> Map(pair -> [nectar, empty]) from previous rounds
  for (const r of g.rounds) {
    for (const b of g.ids) {
      const L = log[b] || new Map(); const W = new Map(); const fedFlower = new Set();
      for (const v of r.visits.filter((v) => v.bee === b)) {
        if (v.action !== "feed" || !v.steps.length) continue;
        A.feeds++;
        const pair = v.steps.map((s) => K(s.c) + "→" + K(s.r)).join("|");
        const w = W.get(pair), l = L.get(pair);
        if (v.patch !== b) {
          if (v.kind === "orchid") {
            A.ofeeds++;
            if ((w && w[0] > 0) || (l && l[0] > 0)) { A.paidBefore++; if (w && w[0] > 0) A.paidRound++; }
            else if (w && w[1] > 0) A.failedRound++;
            else if (l && l[1] > 0) A.failedLog++;
            else { A.newFace++; if (fedFlower.has(v.patch + v.kind)) A.newFaceRepeatFlower++; }
          } else {
            A.cfeeds++;
            if ((w && w[0] > 0) || (l && l[0] > 0)) A.cKnown++; else A.cNew++;
          }
        }
        fedFlower.add(v.patch + v.kind);
        const x = W.get(pair) || [0, 0]; x[v.nectar ? 0 : 1]++; W.set(pair, x);
      }
      for (const [p, x] of W) { const y = L.get(p) || [0, 0]; L.set(p, [y[0] + x[0], y[1] + x[1]]); }
      log[b] = L;
    }
  }
}
console.log("| arena | feeds at rival orchids (share of all feeds) | answer had paid before (imitation/twin) | answer had failed earlier this round | failed only in an earlier round's log (forgotten) | never-tasted answer (exploration) | clover feeds that were first tastes |");
console.log("|---|---|---|---|---|---|---|");
for (const [a, A] of Object.entries(out)) console.log(`| ${a} | ${A.ofeeds} (${pct(A.ofeeds / A.feeds)}) | ${pct(A.paidBefore / A.ofeeds)} | ${pct(A.failedRound / A.ofeeds)} | ${pct(A.failedLog / A.ofeeds)} | ${pct(A.newFace / A.ofeeds)} | ${pct(A.cNew / A.cfeeds)} |`);
const groups = { primed: (a) => PRIMED.has(a), unprimed: (a) => a === "unprimed", structured: (a) => a === "trees" || a === "graphs" };
for (const [k, f] of Object.entries(groups)) { const S = Object.entries(out).filter(([a]) => f(a)).map(([, A]) => A); const s = (key) => S.reduce((x, A) => x + A[key], 0); console.log(k, "orchid feeds", s("ofeeds"), "paid-before", pct(s("paidBefore") / s("ofeeds")), "failed-round", pct(s("failedRound") / s("ofeeds")), "failed-log", pct(s("failedLog") / s("ofeeds")), "new", pct(s("newFace") / s("ofeeds"))); }
