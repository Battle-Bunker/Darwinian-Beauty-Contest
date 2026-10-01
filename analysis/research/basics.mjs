// Per-arena basics: visits per bee-round, how often a bee meets the same flower twice in a round,
// questions per visit, how many distinct questions a bee asks per round, and whether questions persist across rounds.
import { loadAll, label, clean, mean, pct, f2, K } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const byArena = {};
for (const g of games) {
  const A = (byArena[g.arena] ||= { beeRounds: [], fixedQ: 0, perVisitQ: 0, perRoundQ: 0, sameAsPrev: 0, prevN: 0, n: 0 });
  const prevQ = {};
  for (const r of g.rounds) {
    for (const b of g.ids) {
      const vs = r.visits.filter((v) => v.bee === b);
      if (!vs.length) continue;
      const flowers = vs.map((v) => v.patch + v.kind);
      const uniq = new Set(flowers).size;
      const feeds = vs.filter((v) => v.action === "feed"), nect = feeds.filter((v) => v.nectar);
      // repeats: visits to a flower this bee already fed at earlier in the round (the only visits within-round tasting can improve)
      const tastedBefore = new Set(); let afterTaste = 0;
      for (const v of vs) { const f = v.patch + v.kind; if (tastedBefore.has(f)) afterTaste++; if (v.action === "feed") tastedBefore.add(f); }
      const firstQs = vs.filter((v) => v.steps.length).map((v) => K(v.steps[0].c));
      const dq = new Set(firstQs).size;
      A.beeRounds.push({ visits: vs.length, uniq, repeatShare: 1 - uniq / vs.length, afterTaste: afterTaste / vs.length, asks: mean(vs.map((v) => v.steps.length)), feeds: feeds.length, prec: feeds.length ? nect.length / feeds.length : NaN, dq });
      A.n++;
      if (dq === 1) A.perRoundQ++; else if (dq >= vs.length * 0.6) A.perVisitQ++;
      const qset = new Set(firstQs);
      if (prevQ[b]) { A.prevN++; if ([...qset].some((q) => prevQ[b].has(q))) A.sameAsPrev++; }
      prevQ[b] = qset;
    }
  }
}
console.log("| arena | bee-rounds | visits/bee-round | distinct flowers met | share of visits to an already-tasted flower | asks/visit | feeds/bee-round | one first-question per round | new question each visit | reuses a first-question from previous round |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [a, A] of Object.entries(byArena)) {
  const B = A.beeRounds;
  console.log(`| ${a} | ${A.n} | ${f2(mean(B.map((x) => x.visits)))} | ${f2(mean(B.map((x) => x.uniq)))} | ${pct(mean(B.map((x) => x.afterTaste)))} | ${f2(mean(B.map((x) => x.asks)))} | ${f2(mean(B.map((x) => x.feeds)))} | ${pct(A.perRoundQ / A.n)} | ${pct(A.perVisitQ / A.n)} | ${pct(A.sameAsPrev / A.prevN)} |`);
}
