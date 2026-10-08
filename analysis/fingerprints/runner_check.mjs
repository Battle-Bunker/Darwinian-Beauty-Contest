// The integrated flower and bee on the game's real runner (server/engine.js tryFlower and tryBee, in-process).
//   CPU_SLOTS=2 node analysis/fingerprints/runner_check.mjs
// Flower: 10 calls at each fixed R (3, 20, 76, 150 ms): CPU ms, the share f of 0.6 R it recorded, bytes, energy
// (and whether it equals (1100 - size) × (R - CPU ms) × (1024 - bytes)), and failures. Bee: 300 unpaced rounds
// in a garden of its own flower: decide time, feeds, fed() runs and failures, the final MEMORY.
import fs from "node:fs";
const ROOT = new URL("../../", import.meta.url);
const { tryFlower, tryBee } = await import(new URL("server/engine.js", ROOT));
const { normalizeConfig } = await import(new URL("server/lib/gameConfig.js", ROOT));
const P = new URL("arena/priming/fingerprints/", ROOT);
const flower = fs.readFileSync(new URL("integrated.py", P), "utf8"), bee = fs.readFileSync(new URL("integrated_bee.py", P), "utf8");
const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]" });
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(`CPU_SLOTS=${process.env.CPU_SLOTS}, maxResponseBytes ${config.maxResponseBytes}, feedCost ${config.feedCost}`);
for (const R of [3, 20, 76, 150]) {
  const res = await tryFlower({ config, code: flower, challenges: Array.from({ length: 10 }, (_, i) => 1000 + 7919 * i + R), budgetMs: R });
  const ok = res.results.filter((r) => !r.error);
  const f = ok.map((r) => (r.r.labels[0].charCodeAt(48) - 35) / 50);
  const match = ok.every((r) => Math.abs(r.energy - (1100 - res.size) * Math.max(0, r.budgetMs - r.ms) * (1024 - r.rBytes)) <= 1e-6 * Math.max(1, r.energy));
  console.log(JSON.stringify({ R, size: res.size, calls: res.results.length, failures: res.results.length - ok.length, cpu_ms_p50: q(ok.map((r) => r.ms), 0.5),
    cpu_ms_max: Math.max(...ok.map((r) => r.ms)), f_p50: q(f, 0.5), f_min: Math.min(...f), f_max: Math.max(...f), bytes: [...new Set(ok.map((r) => r.rBytes))],
    E_p50: q(ok.map((r) => r.energy), 0.5), E_formula_matches: match, error: res.results.find((r) => r.error)?.error }));
}
const t = await tryBee({ config, programs: { flower, bee }, rounds: 300 });
const ends = t.actions.filter((a) => a.action === "feed" || a.action === "leave");
const beeMs = ends.map((a) => a.beeMs).filter((x) => typeof x === "number");
console.log(JSON.stringify({ rounds: t.rounds, turns: ends.length, feeds: ends.filter((a) => a.action === "feed").length, bee_ms_p50: q(beeMs, 0.5), bee_ms_p99: q(beeMs, 0.99),
  bee_ms_max: Math.max(...beeMs), too_slow: ends.filter((a) => /too slow/.test(a.beeError || "")).length, bee_errors: [...new Set(ends.map((a) => a.beeError).filter(Boolean))].slice(0, 3),
  problems: t.problems.slice(0, 3), memory: t.memory }));
