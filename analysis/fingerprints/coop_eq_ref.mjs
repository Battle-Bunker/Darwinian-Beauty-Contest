// coop-eq: the starter flower's expected nectar given the bee's reading q, on the game's real runner.
//   CPU_SLOTS=2 node analysis/fingerprints/coop_eq_ref.mjs [batches=20] [T=8,32] [BURN=0.6] [PERCENT=50]
// Calls with R drawn as in a game (uniform on [1, 50] ms), 50 per batch; q from the bee's own read(); nectar is
// PERCENT/100 of the energy the engine recorded. Prints mean nectar, mean R and count per q bin, and the share of
// calls that failed.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const ROOT = new URL("../../", import.meta.url);
const { tryFlower } = await import(new URL("server/engine.js", ROOT));
const { normalizeConfig } = await import(new URL("server/lib/gameConfig.js", ROOT));
const P = new URL("arena/priming/fingerprints/", ROOT);
const [batches = "20", T = "8,32", burn = "0.6", pct = "50"] = process.argv.slice(2);
const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]", feedCost: 0, flowerWindowMs: 150,
  feedPrice: null, maxResponseBytes: 1024, maxLen: 64, maxNodes: 512, energy: { bytes: true },
  budgets: { flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: 1 } } });
const code = fs.readFileSync(new URL("integrated.py", P), "utf8").replace(/^BURN = .*$/m, `BURN = ${burn}`)
  .replace(/^PERCENT = .*$/m, `PERCENT = ${pct}`).replace(/^T = .*$/m, `T = ${T.split(",").join(", ")}`);
const rows = [];
for (let b = 0; b < Number(batches); b++) {
  const res = await tryFlower({ config, code, challenges: Array.from({ length: 50 }, (_, i) => 7 + 50 * b + i + 1e6 * Number(burn)) });
  for (const r of res.results) rows.push({ c: r.c, R: r.budgetMs, cpu: r.ms, nectar: r.error ? 0 : (r.percent / 100) * r.energy, error: r.error ?? null, label: r.r?.labels?.[0] ?? null });
}
const py = `
import json, sys
ns = {"GAME": {}, "MEMORY": {}}
exec(open(sys.argv[1]).read(), ns)
for line in sys.stdin:
    x = json.loads(line)
    got = ns["read"](x["c"], {"labels": [x["label"]]}) if x["label"] else None
    print(json.dumps(None if got is None else got[1]))
`;
const ok = rows.filter((r) => r.label);
const out = spawnSync("python3", ["-B", "-c", py, new URL("integrated_bee.py", P).pathname], { input: ok.map((r) => JSON.stringify(r)).join("\n") + "\n", encoding: "utf8" });
if (out.status !== 0) throw new Error(out.stderr);
out.stdout.trim().split("\n").forEach((l, i) => { ok[i].q = JSON.parse(l); });
const edges = [0, 0.15, 0.25, 0.3, 0.33, 0.35, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.52, 1];
console.log(JSON.stringify({ T, burn, pct, calls: rows.length, failed: rows.filter((r) => r.error).length }));
for (let i = 0; i + 1 < edges.length; i++) {
  const g = ok.filter((r) => r.q != null && r.q >= edges[i] && r.q < edges[i + 1]);
  if (!g.length) continue;
  const m = (f) => g.reduce((s, r) => s + f(r), 0) / g.length;
  console.log(JSON.stringify({ q: [edges[i], edges[i + 1]], n: g.length, q_mean: +m((r) => r.q).toFixed(3), R_mean: +m((r) => r.R).toFixed(1), nectar_mean: Math.round(m((r) => r.nectar)) }));
}
