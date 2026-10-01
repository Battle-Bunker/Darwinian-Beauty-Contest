// How much of a patch's allure (rootsum over bee teams of feeds) comes from its orchid? allure(all feeds) / allure(clover feeds only)
import { loadAll, clean, mean, f2, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const by = {};
for (const g of games) {
  const cond = PRIMED.has(g.arena) ? "primed" : /trees|graphs/.test(g.arena) ? "structured" : "unprimed-int";
  for (const p of g.ids) {
    // whole-game ledgers, as scored
    const all = {}, clo = {};
    for (const r of g.rounds) for (const v of r.visits) if (v.patch === p && v.action === "feed") { all[v.bee] = (all[v.bee] || 0) + 1; if (v.kind === "clover") clo[v.bee] = (clo[v.bee] || 0) + 1; }
    const rs = (o) => Object.values(o).reduce((s, x) => s + Math.sqrt(x), 0);
    (by[cond] ||= []).push(rs(all) / rs(clo));
  }
}
for (const [k, xs] of Object.entries(by)) console.log(k, "patches", xs.length, "allure with orchid feeds / allure from clover feeds only:", f2(mean(xs.filter(Number.isFinite))));
