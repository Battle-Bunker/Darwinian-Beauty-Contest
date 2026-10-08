// coop-eq: the starter arrangement flower and bee on the game's real runner (server/engine.js tryFlower and tryBee,
// in-process; nothing is modelled). Run it on an idle machine, once the engine's CPU-time commit has landed:
//   CPU_SLOTS=2 node analysis/fingerprints/coop_eq_check.mjs [--calls 30] > analysis/fingerprints/results/coop_eq_check.txt
// 1. Flower: for BURN 0.2, 0.4, 0.6 and four profiles T, --calls fresh challenges at each fixed R in [1, 50] ms: CPU
//    ms, bytes, energy (and that it equals (1100 - size) × (R - CPU ms) × (1024 - bytes)), failures.
// 2. The bee's own read() (integrated_bee.py, run by python) on every response: q (its wealth reading) and the
//    profile it reads. Per (BURN, R): mean CPU, q mean ± spread, and how often the profile reads within NEAR of the
//    true T and nearest to it among the four. Per BURN: the (CPU ms, q) curve, the input for the bee's CURVE.
// 3. The bee in a garden of the starter flower (tryBee, 300 unpaced rounds): decide time, failures, final MEMORY.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const ROOT = new URL("../../", import.meta.url);
const { tryFlower, tryBee } = await import(new URL("server/engine.js", ROOT));
const { normalizeConfig, feedPriceOf } = await import(new URL("server/lib/gameConfig.js", ROOT));
const P = new URL("arena/priming/fingerprints/", ROOT);
const flower = fs.readFileSync(new URL("integrated.py", P), "utf8"), bee = fs.readFileSync(new URL("integrated_bee.py", P), "utf8");
const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const CALLS = Math.min(50, arg("--calls", 30));
// coop-eq's rules (arena/lib/presets.js COOP_RULES), as far as a flower call and a bee's decision see them.
const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]", feedCost: 0, flowerWindowMs: 150,
  feedPrice: null, maxResponseBytes: 1024, maxLen: 64, maxNodes: 512, energy: { bytes: true }, scoring: { alpha: 0.85, beta: 0.85 },
  prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null },
  budgets: { flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: 1 }, bee: { size: 11000, perMinute: 600, cap: 3000, ms: 50, memory: 50 } } });
const BURNS = [0.2, 0.4, 0.6], PROFILES = [[8, 32], [0, 47], [40, 4], [14, 20]], RS = [1, 2, 3, 5, 8, 12, 20, 30, 40, 50];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
console.log(`CPU_SLOTS=${process.env.CPU_SLOTS}, feed price ${feedPriceOf(config)}, flower ms ${config.budgets.flower.ms} (min ${config.budgets.flower.minMs}), maxResponseBytes ${config.maxResponseBytes}, calls ${CALLS}`);

// 1. The flower on the real runner.
const rows = [];
let size = null;
for (const burn of BURNS) for (const T of PROFILES) {
  const code = flower.replace(/^BURN = .*$/m, `BURN = ${burn}`).replace(/^T = .*$/m, `T = ${T.join(", ")}`);
  for (const R of RS) {
    const challenges = Array.from({ length: CALLS }, (_, i) => 1 + 104729 * i + 7919 * R + 131 * PROFILES.indexOf(T) + Math.round(1000 * burn));
    const res = await tryFlower({ config, code, challenges, budgetMs: R });
    if (res.error) { console.log(JSON.stringify({ burn, T, R, loadError: res.error })); continue; }
    size = res.size;
    for (const r of res.results) rows.push({ burn, T, R, c: r.c, cpu: r.ms, bytes: r.rBytes, energy: r.energy, error: r.error ?? null,
      label: r.r?.labels?.[0] ?? null, match: !r.error && Math.abs(r.energy - (1100 - res.size) * Math.max(0, r.budgetMs - r.ms) * (1024 - r.rBytes)) <= 1e-6 * Math.max(1, r.energy) });
  }
}

// 2. The bee's read() on every response, in python (the bee's own code).
const py = `
import json, sys
ns = {"GAME": {}, "MEMORY": {}}
exec(open(sys.argv[1]).read(), ns)
for line in sys.stdin:
    x = json.loads(line)
    got = ns["read"](x["c"], {"labels": [x["label"]]}) if x["label"] else None
    print(json.dumps(None if got is None else [[ord(ch) - 40 for ch in got[0]], got[1]]))
`;
const ok = rows.filter((r) => !r.error && r.label);
const out = spawnSync("python3", ["-B", "-c", py, new URL("integrated_bee.py", P).pathname], { input: ok.map((r) => JSON.stringify(r)).join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 26 });
if (out.status !== 0) throw new Error(out.stderr);
out.stdout.trim().split("\n").forEach((l, i) => { const v = JSON.parse(l); ok[i].read = v ? v[0] : null; ok[i].q = v ? v[1] : null; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
console.log(`## Flower: ${size} nodes`);
for (const burn of BURNS) {
  const curve = [];
  for (const R of RS) {
    const all = rows.filter((r) => r.burn === burn && r.R === R), good = ok.filter((r) => r.burn === burn && r.R === R && r.read);
    const near = good.filter((r) => dist(r.read, r.T) <= 4).length, nearest = good.filter((r) => PROFILES.every((T) => dist(r.read, r.T) <= dist(r.read, T))).length;
    const cpu = mean(good.map((r) => r.cpu)), qs = good.map((r) => r.q);
    curve.push([+cpu.toFixed(2), +mean(qs).toFixed(3)]);
    console.log(JSON.stringify({ burn, R, calls: all.length, failures: all.filter((r) => r.error).length, errors: [...new Set(all.map((r) => r.error).filter(Boolean))].slice(0, 2),
      cpu_ms_mean: +cpu.toFixed(2), cpu_ms_max: Math.max(...good.map((r) => r.cpu)), bytes: [...new Set(good.map((r) => r.bytes))], energy_formula_matches: all.every((r) => r.error || r.match),
      q_mean: +mean(qs).toFixed(3), q_sd: +sd(qs).toFixed(3), q_p10: +q(qs, 0.1).toFixed(3), q_p90: +q(qs, 0.9).toFixed(3),
      profile_within_4: +(near / Math.max(1, good.length)).toFixed(2), profile_nearest_of_4: +(nearest / Math.max(1, good.length)).toFixed(2),
      by_profile_within_4: Object.fromEntries(PROFILES.map((T) => { const g = good.filter((r) => r.T === T); return [T.join(","), +(g.filter((r) => dist(r.read, T) <= 4).length / Math.max(1, g.length)).toFixed(2)]; })) }));
  }
  console.log(JSON.stringify({ burn, curve_cpu_ms_q: curve }));
}

// 3. The bee on the real runner.
const t = await tryBee({ config, programs: { flower, bee }, rounds: 300 });
const ends = t.actions.filter((a) => a.action === "feed" || a.action === "leave");
const beeMs = ends.map((a) => a.beeMs).filter((x) => typeof x === "number");
console.log(JSON.stringify({ bee: true, rounds: t.rounds, turns: ends.length, feeds: ends.filter((a) => a.action === "feed").length,
  bee_ms_p50: q(beeMs, 0.5), bee_ms_p99: q(beeMs, 0.99), bee_ms_max: Math.max(...beeMs), bee_errors: [...new Set(ends.map((a) => a.beeError).filter(Boolean))].slice(0, 3),
  problems: t.problems.slice(0, 3), memory: t.memory }));
