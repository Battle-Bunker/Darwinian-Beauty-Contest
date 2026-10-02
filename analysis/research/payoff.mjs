// What does discrimination buy? Per team-round: bee precision vs forage share x N, allure share x N, fitness (round scores).
import { loadAll, label, clean, mean, pct, f2 } from "./lib.mjs";
const games = (await loadAll()).filter((g) => clean(g) && (g.config.feedCost ?? 5) === 5 && g.ids.length === 6);
const rows = [];
for (const g of games) for (const r of g.rounds) for (const t of g.ids) {
  const s = r.scores.find((x) => x.teamId === t); if (!s) continue;
  const f = r.visits.filter((v) => v.bee === t && v.action === "feed");
  const N = g.ids.length;
  rows.push({ prec: f.length ? f.filter((v) => v.nectar).length / f.length : NaN, nectar: f.filter((v) => v.nectar).length, forage: s.forageShare * N, allure: s.allureShare * N, fit: s.fitness, of: r.visits.filter((v) => v.patch === t && v.kind === "orchid" && v.action === "feed").length, cf: r.visits.filter((v) => v.patch === t && v.kind === "clover" && v.action === "feed").length });
}
const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const R = rows.filter((x) => Number.isFinite(x.prec) && x.fit != null);
console.log("team-rounds", R.length, "corr(precision, forage×N)", f2(corr(R.map((x) => x.prec), R.map((x) => x.forage))), "corr(precision, fitness)", f2(corr(R.map((x) => x.prec), R.map((x) => x.fit))), "corr(allure×N, fitness)", f2(corr(R.map((x) => x.allure), R.map((x) => x.fit))), "corr(forage×N, fitness)", f2(corr(R.map((x) => x.forage), R.map((x) => x.fit))));
console.log("corr(orchid feeds received, allure×N)", f2(corr(R.map((x) => x.of), R.map((x) => x.allure))), "corr(clover feeds received, allure×N)", f2(corr(R.map((x) => x.cf), R.map((x) => x.allure))));
for (const [lo, hi] of [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]]) { const xs = R.filter((x) => x.prec >= lo && x.prec < hi); console.log(`precision ${lo}-${hi}: n=${xs.length} nectar ${f2(mean(xs.map((x) => x.nectar)))} forage×N ${f2(mean(xs.map((x) => x.forage)))} fitness ${f2(mean(xs.map((x) => x.fit)))}`); }
