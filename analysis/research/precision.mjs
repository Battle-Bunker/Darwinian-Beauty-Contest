import { loadAll, label, clean, f2 } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
for (const g of games) {
  const pr = g.rounds.map((r) => { const f = r.visits.filter((v) => v.action === "feed"); return f.filter((v) => v.nectar).length / f.length; });
  const all = g.rounds.flatMap((r) => r.visits.filter((v) => v.action === "feed"));
  const of = all.filter((v) => v.kind === "orchid").length / all.length;
  const fit = Object.values(g.metrics?.finalFitness || {}); const best = Math.max(...fit);
  console.log(`${label(g).padEnd(13)} ${g.url.padEnd(17)} prec ${f2(all.filter((v) => v.nectar).length / all.length)} by round ${pr.map(f2).join(" ")} | orchid feed share ${f2(of)} | best fitness ${f2(best)}`);
}
