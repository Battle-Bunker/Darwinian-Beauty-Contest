// Every within-game clover change (round >= 2, distance > 0): fed rate by rival bees and rival-orchid imitation
// (>=50% answer match on the round's asked first questions) before and after.
import { loadAll, evalFlower, label, clean, mean, pct, f2, K } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const rows = []; let total = 0;
for (const g of games) {
  const stat = [];
  for (const r of g.rounds) {
    const w = new Map(); for (const v of r.visits) if (v.steps.length) { const k = K(v.steps[0].c); w.set(k, (w.get(k) || 0) + 1); }
    const qs = [...w.keys()].map((k) => JSON.parse(k)), wt = [...w.values()], tot = wt.reduce((a, b) => a + b, 0);
    const ans = {}; for (const t of g.ids) for (const kind of ["clover", "orchid"]) ans[t + kind] = await evalFlower(g.config, r.programs[t][kind].code, kind, qs, g.ids.length);
    const m = (a, b) => a.reduce((s, x, i) => s + (x !== null && x === b[i] ? wt[i] : 0), 0) / tot;
    const s = {};
    for (const x of g.ids) {
      const vs = r.visits.filter((v) => v.patch === x && v.kind === "clover" && v.bee !== x);
      s[x] = { fed: vs.length ? vs.filter((v) => v.action === "feed").length / vs.length : NaN, n: vs.length, imit: Math.max(...g.ids.filter((y) => y !== x).map((y) => m(ans[y + "orchid"], ans[x + "clover"]))), selfImit: m(ans[x + "orchid"], ans[x + "clover"]) };
    }
    stat.push(s);
  }
  for (const r of g.rounds.slice(1)) for (const x of g.ids) {
    total++;
    const p = r.programs[x].clover;
    if ((p.distance ?? 0) > 0) rows.push({ g: label(g), url: g.url, team: g.names[x], round: r.no, dist: p.distance, budget: g.config.budgets.clover.changes, before: stat[r.no - 2][x], after: stat[r.no - 1][x], later: stat.slice(r.no).map((s) => s[x]) });
  }
}
console.log("team-rounds (r>=2):", total, "clover changed:", rows.length, pct(rows.length / total));
for (const x of rows) console.log(`${x.g.padEnd(13)} ${x.url.padEnd(17)} r${x.round} ${x.team.slice(0, 26).padEnd(26)} dist ${x.dist}/${x.budget}  fed ${f2(x.before.fed)} -> ${f2(x.after.fed)} | rival-imit ${f2(x.before.imit)} -> ${f2(x.after.imit)} | self-imit ${f2(x.before.selfImit)} -> ${f2(x.after.selfImit)} | later fed ${x.later.map((s) => f2(s.fed)).join(",")} imit ${x.later.map((s) => f2(s.imit)).join(",")}`);
