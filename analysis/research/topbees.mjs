// Rank bee-rounds by precision (nectar/feeds), with a Wilson 95% lower bound; rival-patch feeds only and all feeds.
import { loadAll, label, clean, mean, pct, f2 } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const wilson = (k, n, z = 1.96) => { if (!n) return NaN; const p = k / n; return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n); };
const rows = [];
for (const g of games) for (const r of g.rounds) for (const b of g.ids) {
  const vs = r.visits.filter((v) => v.bee === b);
  const feeds = vs.filter((v) => v.action === "feed"), nect = feeds.filter((v) => v.nectar);
  const rf = feeds.filter((v) => v.patch !== b), rn = rf.filter((v) => v.nectar);
  const cv = vs.filter((v) => v.kind === "clover" && v.patch !== b), ov = vs.filter((v) => v.kind === "orchid" && v.patch !== b);
  rows.push({ g: label(g), url: g.url, round: r.no, team: g.names[b], model: g.persona[b]?.model, feeds: feeds.length, prec: feeds.length ? nect.length / feeds.length : NaN, lb: wilson(nect.length, feeds.length),
    rprec: rf.length ? rn.length / rf.length : NaN, rlb: wilson(rn.length, rf.length), rfeeds: rf.length,
    cfed: cv.length ? cv.filter((v) => v.action === "feed").length / cv.length : NaN, ofed: ov.length ? ov.filter((v) => v.action === "feed").length / ov.length : NaN, nectar: nect.length });
}
const ok = rows.filter((x) => x.feeds >= 8);
const ps = ok.map((x) => x.prec).sort((a, b) => a - b);
console.log("bee-rounds with >=8 feeds:", ok.length, "median prec", f2(ps[Math.floor(ps.length / 2)]), "p90", f2(ps[Math.floor(ps.length * 0.9)]), "share with Wilson LB>0.5:", pct(ok.filter((x) => x.lb > 0.5).length / ok.length), "rival-only LB>0.5:", pct(ok.filter((x) => x.rlb > 0.5).length / ok.length));
console.log("by arena: share of bee-rounds with Wilson LB > 0.5 (all feeds) | rival-feeds only");
const ar = {}; for (const x of ok) { const a = x.g.split(" ")[0]; (ar[a] ||= []).push(x); }
for (const [a, xs] of Object.entries(ar)) console.log(a.padEnd(10), pct(xs.filter((x) => x.lb > 0.5).length / xs.length), pct(xs.filter((x) => x.rlb > 0.5).length / xs.length), "mean prec", f2(mean(xs.map((x) => x.prec))), "mean rival prec", f2(mean(xs.filter((x) => x.rfeeds).map((x) => x.rprec))));
console.log("\ntop 45 by rival-feed Wilson LB:");
for (const x of rows.filter((x) => x.rfeeds >= 8).sort((a, b) => b.rlb - a.rlb).slice(0, 45))
  console.log(`${x.g.padEnd(13)} ${x.url.padEnd(17)} r${x.round} ${x.team.slice(0, 26).padEnd(26)} ${String(x.model).padEnd(6)} feeds ${String(x.feeds).padStart(3)} prec ${f2(x.prec)} | rival feeds ${String(x.rfeeds).padStart(3)} prec ${f2(x.rprec)} LB ${f2(x.rlb)} | fed at rival clovers ${pct(x.cfed)} orchids ${pct(x.ofed)}`);
