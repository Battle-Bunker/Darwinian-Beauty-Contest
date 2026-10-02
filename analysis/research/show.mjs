// node show.mjs <arena> <gen> <round> <team substring> [kinds=bee] [--log]
import { loadAll, K } from "./lib.mjs";
const [arena, gen, round, team, kinds = "bee", log] = process.argv.slice(2);
const g = (await loadAll()).find((g) => g.arena === arena && g.gen === +gen);
const r = g.rounds[+round - 1];
const tid = g.ids.find((t) => g.names[t].includes(team));
for (const k of kinds.split(",")) { const p = r.programs[tid][k]; console.log(`=== ${g.names[tid]} ${k} r${round} nodes=${p.nodes} dist=${p.distance} carried=${p.carried}\n${p.code}`); }
if (log) for (const v of r.visits.filter((v) => v.bee === tid)) console.log(`${g.names[v.patch].slice(0, 18).padEnd(18)} ${v.kind.padEnd(6)} ${v.action.padEnd(5)} ${v.nectar === null ? "" : v.nectar ? "NECTAR" : "empty"}  ${v.steps.map((s) => K(s.c).slice(0, 30) + " -> " + K(s.r).slice(0, 70)).join(" | ")}`);
