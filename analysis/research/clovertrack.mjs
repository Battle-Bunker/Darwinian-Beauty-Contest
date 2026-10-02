// node clovertrack.mjs <arena> [gen]: per team, per round: rival bees' fed rate at its clover, best rival-orchid answer match
// (on the round's asked first questions, visit-weighted), own-orchid match, and clover edit distance.
import { loadAll, evalFlower, label, clean, f2, K } from "./lib.mjs";
const [arena, gen] = process.argv.slice(2);
for (const g of (await loadAll()).filter((g) => clean(g) && g.arena === arena && (!gen || g.gen === +gen))) {
  console.log(`== ${label(g)} ${g.url}`);
  const lines = Object.fromEntries(g.ids.map((t) => [t, []]));
  for (const r of g.rounds) {
    const w = new Map(); for (const v of r.visits) if (v.steps.length) { const k = K(v.steps[0].c); w.set(k, (w.get(k) || 0) + 1); }
    const qs = [...w.keys()].map((k) => JSON.parse(k)), wt = [...w.values()], tot = wt.reduce((a, b) => a + b, 0);
    const ans = {}; for (const t of g.ids) for (const kind of ["clover", "orchid"]) ans[t + kind] = await evalFlower(g.config, r.programs[t][kind].code, kind, qs, g.ids.length);
    const m = (a, b) => a.reduce((s, x, i) => s + (x !== null && x === b[i] ? wt[i] : 0), 0) / tot;
    for (const x of g.ids) {
      const vs = r.visits.filter((v) => v.patch === x && v.kind === "clover" && v.bee !== x);
      const best = g.ids.filter((y) => y !== x).map((y) => [m(ans[y + "orchid"], ans[x + "clover"]), g.names[y]]).sort((a, b) => b[0] - a[0])[0];
      lines[x].push(`r${r.no} fed ${f2(vs.filter((v) => v.action === "feed").length / vs.length)} imit ${f2(best[0])}${best[0] >= 0.5 ? "(" + best[1].slice(0, 8) + ")" : ""} self ${f2(m(ans[x + "orchid"], ans[x + "clover"]))} d${r.programs[x].clover.distance ?? "-"}`);
    }
  }
  for (const x of g.ids) console.log(`  ${g.names[x].slice(0, 24).padEnd(24)} ` + lines[x].join(" | "));
}
