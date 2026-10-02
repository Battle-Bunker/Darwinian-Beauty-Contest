// Run every stored clover and orchid of every game on every challenge any bee asked in that game (offline, no rounds).
// Result cached in CACHE_DIR/flower-eval.json via lib.evalFlower.
import { loadAll, evalFlower, saveEvalCache, pool, K } from "./lib.mjs";
const games = await loadAll();
const jobs = [];
for (const g of games) {
  const challenges = [...new Map(g.rounds.flatMap((r) => r.visits.flatMap((v) => v.steps.map((s) => [K(s.c), s.c])))).values()];
  const seen = new Set();
  for (const r of g.rounds) for (const t of g.ids) for (const kind of ["clover", "orchid"]) {
    const code = r.programs[t]?.[kind]?.code; if (!code || seen.has(code)) continue; seen.add(code);
    jobs.push({ g, code, kind, challenges });
  }
}
console.log("jobs", jobs.length);
let done = 0;
await pool(jobs, 12, async (j) => { await evalFlower(j.g.config, j.code, j.kind, j.challenges, j.g.ids.length); if (++done % 100 === 0) { console.log(done); saveEvalCache(); } });
saveEvalCache();
console.log("done");
