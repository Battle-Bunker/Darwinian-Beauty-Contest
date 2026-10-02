import { loadAll, clean, mean, f2, pct } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const by = {};
for (const g of games) for (const r of g.rounds) for (const t of g.ids) {
  const m = g.persona[t]?.model || "?"; const f = r.visits.filter((v) => v.bee === t && v.action === "feed");
  const s = r.scores.find((x) => x.teamId === t);
  const k = m + (/(trees|graphs|unprimed)/.test(g.arena) ? " no-starter" : " primed");
  (by[k] ||= { p: [], fit: [] }).p.push(f.length ? f.filter((v) => v.nectar).length / f.length : NaN); by[k].fit.push(s?.fitness);
}
for (const [k, x] of Object.entries(by).sort()) console.log(k.padEnd(20), "bee-rounds", x.p.length, "precision", f2(mean(x.p.filter(Number.isFinite))), "share >=0.8", pct(x.p.filter((p) => p >= 0.8).length / x.p.length), "round fitness", f2(mean(x.fit.filter((y) => y != null))));
