#!/usr/bin/env node
// Honest wealth signalling (lib/wealth.js) on hand-made turns: a species whose visible work follows its hidden budget R is
// honest, one with a fixed answer isn't; a bee that feeds at rich instances lifts its feed rate there. No server.
//   node arena/test-wealth.mjs
import { honestyOf, spearman, wealthMetrics, workOf } from "./lib/wealth.js";

let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === undefined ? "" : ": " + JSON.stringify(extra).slice(0, 600)}`); if (!ok) failed++; };

check("spearman: monotone 1, reversed -1, too few or constant null", spearman([[1, 2], [2, 4], [3, 9]]) === 1 && spearman([[1, 3], [2, 2], [3, 1]]) === -1
  && spearman([[1, 1], [2, 2]]) === null && spearman([[1, 5], [2, 5], [3, 5]]) === null);
check("workOf: bytes, and a graph's nodes and edges (also from a big response's shape)", workOf({ r: { nodes: 4, edges: [[0, 1], [1, 2]] }, rBytes: 30 }).nodes === 4
  && workOf({ r: { $big: "h", shape: "graph:300:299:x" }, rBytes: 9000 }).edges === 299 && workOf({ r: 5 }).bytes === 1);

// A (honest): graphs as big as its budget allows; B: the same small answer whatever R. Bee C feeds where graphs are big.
const turns = [];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 200; i++) {
  const R = 50 + 100 * rnd(), flower = i % 2 ? "A" : "B", bee = ["C", "D"][i % 4 < 2 ? 0 : 1];
  const n = flower === "A" ? Math.round(R / 5) : 3;
  const r = { nodes: n, edges: Array.from({ length: n - 1 }, (_, k) => [k, k + 1]) };
  const fed = bee === "C" ? n > 18 : rnd() < 0.5;
  turns.push({ flower, bee, R, ms: flower === "A" ? R * 0.6 : 2, r, rBytes: JSON.stringify(r).length, action: fed ? "feed" : "leave" });
}
const w = wealthMetrics({ turns, ids: ["A", "B", "C", "D"], name: { A: "Alpha", B: "Beta", C: "Gamma", D: "Delta" }, range: [50, 150] });
const A = w.species.find((s) => s.teamId === "A"), B = w.species.find((s) => s.teamId === "B");
check("species: effort and visible work follow R for an honest signaller", A.effort > 0.9 && A.nodes > 0.9 && A.bytes > 0.9 && A.honest, A);
check("species: a fixed answer shows nothing of R", B.nodes === null && !B.honest && w.honestSpecies === 1, B);
check("costly vs cheap: work and effort both follow R is costly; R written into the answer with no effort is cheap", A.signal === "costly" && w.costlySpecies === 1
  && honestyOf({ turns: 50, bytes: 0.8, nodes: null, effort: 0.02 }) === "cheap" && honestyOf({ turns: 50, bytes: 0.1, effort: 0.9 }) === null && honestyOf({ turns: 10, bytes: 0.9, effort: 0.9 }) === null, A);
const C = w.bees.find((b) => b.teamId === "C"), D = w.bees.find((b) => b.teamId === "D");
check("bees: one that feeds at rich instances (through what they show) has a lift; one at random hasn't", C.lift > 0.3 && C.rho > 0.2 && Math.abs(D.lift) < 0.3, [C, D]);
check("overall: feed rate by R tercile", w.feedRate.rich > w.feedRate.poor && w.cuts[0] < w.cuts[1], w.feedRate);
check("no budgets: null", wealthMetrics({ turns: turns.map(({ R, ...t }) => t), ids: ["A"] }) === null);

console.log(failed ? `${failed} check(s) failed` : "all wealth checks passed");
process.exit(failed ? 1 : 0);
