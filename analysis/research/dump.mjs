import { loadAll, label } from "./lib.mjs";
const games = await loadAll();
for (const g of games) console.log(label(g).padEnd(14), g.url.padEnd(18), g.condition, g.contaminated ? "CONTAMINATED" : "", g.rounds.length, g.ids.length, g.rounds.reduce((s, r) => s + r.visits.length, 0));
