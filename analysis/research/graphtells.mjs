// graphs: share of orchid visits whose answer is an "obvious tell" (not a tree: star/cycle/edgeless/disconnected) by generation and round
import { loadAll, evalFlower, clean, pct, K } from "./lib.mjs";
const games = (await loadAll()).filter((g) => clean(g) && g.arena === "graphs");
for (const g of games) {
  const row = [];
  for (const r of g.rounds) {
    let n = 0, tell = 0, nc = 0, ctell = 0;
    for (const v of r.visits) {
      if (!v.steps.length || v.bee === v.patch) continue;
      const a = (await evalFlower(g.config, r.programs[v.patch][v.kind].code, v.kind, [v.steps[0].c], g.ids.length))[0];
      if (a === null) continue;
      const x = JSON.parse(a); const deg = new Array(x.nodes).fill(0); x.edges.forEach(([p, q]) => { deg[p]++; deg[q]++; });
      const star = x.nodes > 2 && Math.max(...deg) === x.nodes - 1;
      const notTree = x.edges.length !== x.nodes - 1 || deg.some((d) => d === 0);
      const t = star || notTree;
      if (v.kind === "orchid") { n++; if (t) tell++; } else { nc++; if (t) ctell++; }
    }
    row.push(`r${r.no} orchid ${pct(tell / n)} clover ${pct(ctell / nc)}`);
  }
  console.log(`graphs g${g.gen}: ` + row.join(" | "));
}
