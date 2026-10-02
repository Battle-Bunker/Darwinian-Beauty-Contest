// Change/complexity budget pressure: edits per round as share of the change budget, and program size vs complexity budget.
import { loadAll, label, clean, mean, pct, f2 } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const disc = new Set(["quiet bees", "Technically Legal", "Lab Coat Bees", "Red Team Petals", "Equilibrium Bloom"]);
const agg = {};
for (const g of games) for (const r of g.rounds.slice(1)) for (const t of g.ids) for (const kind of ["clover", "orchid", "bee"]) {
  const p = r.programs[t][kind]; const B = g.config.budgets[kind];
  const key = kind + (kind === "bee" ? (disc.has(g.names[t]) ? " (5 discerning teams)" : " (others)") : "");
  const a = (agg[key] ||= { n: 0, use: [], changed: 0, near: 0, size: [] });
  a.n++; a.use.push((p.distance ?? 0) / B.changes); if ((p.distance ?? 0) > 0) a.changed++; if ((p.distance ?? 0) >= 0.9 * B.changes) a.near++; a.size.push(p.nodes / B.nodes);
}
console.log("| program | team-rounds (r>=2) | changed at all | mean change-budget use | rounds using >=90% of change budget | mean size / complexity budget |");
for (const [k, a] of Object.entries(agg)) console.log(`| ${k} | ${a.n} | ${pct(a.changed / a.n)} | ${pct(mean(a.use))} | ${pct(a.near / a.n)} | ${pct(mean(a.size))} |`);
