// coop-eq: acceptance checks for the starter bee on the game's real engine (tryBee: the engine's own garden, its
// runner, the feed price; nothing is modelled).
//   CPU_SLOTS=2 node analysis/fingerprints/coop_eq_bee_accept.mjs [rounds=400]
// 1. Honest: a garden of the starter flower (BURN 0.6, 50%). Feed rate on turns whose nectar would clear 1.5× the
//    price (R ≥ 26.4 ms) and on the rest; mean nectar per feed; the profile's m in MEMORY (1 = what's paid).
// 2. Copy: phases carried through MEMORY: honest, then the same flower paying 0% on every other challenge (a
//    defector's copy of the profile, mixed in), then honest again. Feed rate, nectar per feed and m per phase.
// 3. Shapes: a non-arrangement flower (a 3-node graph) at 25%, then at 0%: the bee's feed rate and learned mean.
// Every turn's R, action and nectar come from the engine's actions; q from the bee's own read().
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const ROOT = new URL("../../", import.meta.url);
const { tryBee } = await import(new URL("server/engine.js", ROOT));
const { normalizeConfig, feedPriceOf } = await import(new URL("server/lib/gameConfig.js", ROOT));
const P = new URL("arena/priming/fingerprints/", ROOT);
const flower = fs.readFileSync(new URL("integrated.py", P), "utf8"), bee = fs.readFileSync(new URL("integrated_bee.py", P), "utf8");
const ROUNDS = Number(process.argv[2] || 400);
const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]", feedCost: 0, flowerWindowMs: 150,
  feedPrice: null, maxResponseBytes: 1024, maxLen: 64, maxNodes: 512, energy: { bytes: true }, scoring: { alpha: 0.85, beta: 0.85 },
  prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null },
  budgets: { flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: 1 }, bee: { size: 11000, perMinute: 600, cap: 3000, ms: 50, memory: 50 } } });
const price = feedPriceOf(config), RBIG = (1.5 * price) / (0.5 * 850 * 940 * 0.4);
const copy = flower.replace(/return \{"nodes": 1, "edges": \[\], "labels": \[bytes\(p\)\.decode\(\)\]\}, PERCENT/,
  'return {"nodes": 1, "edges": [], "labels": [bytes(p).decode()]}, PERCENT if c % 2 else 0');
if (copy === flower) throw new Error("copy edit failed");
const vet = (pct) => `def flower(c):\n    return {"nodes": 3, "edges": [[0, 1], [1, 2]], "labels": [c % 7, c % 11, c % 13]}, ${pct}`;
const reads = (acts) => {
  const py = `
import json, sys
ns = {"GAME": {}, "MEMORY": {}}
exec(open(sys.argv[1]).read(), ns)
for line in sys.stdin:
    x = json.loads(line)
    got = ns["read"](x["c"], x["r"]) if x["r"] else None
    print(json.dumps(None if got is None else got[1]))
`;
  const out = spawnSync("python3", ["-B", "-c", py, new URL("integrated_bee.py", P).pathname], { input: acts.map((a) => JSON.stringify({ c: a.c, r: a.r })).join("\n") + "\n", encoding: "utf8" });
  if (out.status !== 0) throw new Error(out.stderr);
  return out.stdout.trim().split("\n").map((l) => JSON.parse(l));
};
const run = async (fl, memory, label) => {
  const t = await tryBee({ config, programs: { flower: fl, bee }, rounds: ROUNDS, memory });
  const acts = t.actions.filter((a) => a.action === "feed" || a.action === "leave");
  const fed = acts.filter((a) => a.action === "feed"), big = acts.filter((a) => a.budgetMs >= RBIG), small = acts.filter((a) => a.budgetMs < RBIG);
  const rate = (xs) => +(xs.filter((a) => a.action === "feed").length / Math.max(1, xs.length)).toFixed(2);
  const beeMs = acts.map((a) => a.beeMs).filter((x) => typeof x === "number").sort((a, b) => a - b);
  const half = acts.slice(acts.length / 2);
  console.log(JSON.stringify({ label, turns: acts.length, feeds: fed.length, feed_rate: rate(acts), feed_rate_second_half: rate(half),
    feed_rate_R_ge_26: rate(big), feed_rate_R_lt_26: rate(small), nectar_per_feed: Math.round(fed.reduce((s, a) => s + a.nectar, 0) / Math.max(1, fed.length)),
    net_per_feed: Math.round(fed.reduce((s, a) => s + a.net, 0) / Math.max(1, fed.length)), price,
    dud_share: +(fed.filter((a) => a.net < 0).length / Math.max(1, fed.length)).toFixed(2), net_total: Math.round(fed.reduce((s, a) => s + a.net, 0)),
    bee_ms_p50: beeMs[Math.floor(beeMs.length / 2)], bee_ms_max: beeMs[beeMs.length - 1], errors: [...new Set(acts.map((a) => a.beeError).filter(Boolean))].slice(0, 2),
    memory: t.memory.value, memory_bytes: t.memory.bytes, memory_error: t.memory.error, rounds: t.rounds,
    slow: t.actions.filter((a) => a.beeError).slice(0, 3).map((a) => ({ round: a.round, action: a.action, beeMs: a.beeMs, beeError: a.beeError })),
    problems: t.problems.slice(0, 3) }));
  return { t, acts, memory: t.memory.value };
};
console.log(`price ${price}, R for 1.5× price at the starter ${RBIG.toFixed(1)} ms, ${ROUNDS} rounds per run`);
// 1. Honest garden, with the q of each turn by R band.
const h = await run(flower, {}, "1 honest");
const qs = reads(h.acts.map((a) => ({ c: a.c, r: a.r })));
for (const [lo, hi] of [[1, 10], [10, 20], [20, 26.4], [26.4, 35], [35, 50.1]]) {
  const idx = h.acts.map((a, i) => i).filter((i) => h.acts[i].budgetMs >= lo && h.acts[i].budgetMs < hi);
  const f = idx.filter((i) => h.acts[i].action === "feed");
  console.log(JSON.stringify({ R: [lo, hi], turns: idx.length, feed_rate: +(f.length / Math.max(1, idx.length)).toFixed(2),
    q_mean: +(idx.reduce((s, i) => s + (qs[i] ?? 0), 0) / Math.max(1, idx.length)).toFixed(3) }));
}
// 2. Copy mixed in, then gone.
let mem = (await run(flower, {}, "2a honest")).memory;
mem = (await run(copy, mem, "2b copy at 0% on half the turns")).memory;
mem = (await run(flower, mem, "2c honest again")).memory;
mem = (await run(flower, mem, "2d honest, later")).memory;
// 3. Another shape.
let vm = (await run(vet(25), {}, "3a 3-node graph at 25%")).memory;
vm = (await run(vet(0), vm, "3b the same shape at 0%")).memory;
