// coop-eq extras on the game's real runner (server/engine.js, in-process):
//   CPU_SLOTS=2 node analysis/fingerprints/coop_eq_extra.mjs startup | w4 | bee
// startup: CPU of the starter flower's start-up pieces at R = 50 (30 calls each).
// w4:      the four-property version (four_property_flower.py, 267 nodes): start-up, and CPU at R = 1, 5, 50.
// bee:     the starter bee in a garden of the starter flower (tryBee, 300 unpaced rounds): decide time, feeds, MEMORY.
import fs from "node:fs";
const ROOT = new URL("../../", import.meta.url);
const { tryFlower, tryBee } = await import(new URL("server/engine.js", ROOT));
const { normalizeConfig, feedPriceOf } = await import(new URL("server/lib/gameConfig.js", ROOT));
const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]", feedCost: 0, flowerWindowMs: 150,
  feedPrice: null, maxResponseBytes: 1024, maxLen: 64, maxNodes: 512, energy: { bytes: true }, scoring: { alpha: 0.85, beta: 0.85 },
  prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null },
  budgets: { flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: 1 }, bee: { size: 11000, perMinute: 600, cap: 3000, ms: 50, memory: 50 } } });
const P = new URL("arena/priming/fingerprints/", ROOT);
const flower = fs.readFileSync(new URL("integrated.py", P), "utf8"), bee = fs.readFileSync(new URL("integrated_bee.py", P), "utf8");
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cpuAt = async (code, R) => {
  const res = await tryFlower({ config, code, challenges: Array.from({ length: 30 }, (_, i) => 1000 + 7 * i), budgetMs: R });
  const ms = res.results.filter((r) => !r.error).map((r) => r.ms);
  return { size: res.size, cpu_p50: q(ms, 0.5), cpu_max: ms.length ? Math.max(...ms) : null, failures: res.results.filter((r) => r.error).length };
};
const what = process.argv[2];
if (what === "startup") {
  const ret = 'return {"nodes": 1, "edges": [], "labels": [bytes(p).decode()]}, 50';
  const head = 'from random import *\nfrom time import *\ndef flower(c):\n';
  const pairs = (draw) => head + `    seed(c)\n    r = range(48)\n    p = [x + 35 for x in r]\n    inc = [[] for _ in r]\n    for t in (8, 32) * 96:\n        u, v = ${draw}\n        inc[u] += (v, t),\n        inc[v] += (u, t),\n    ` + ret;
  const V = { bare: 'def flower(c):\n    p = [*range(35, 83)]\n    ' + ret, imports: head + '    p = [*range(35, 83)]\n    ' + ret,
    seed: head + '    seed(c)\n    p = [*range(35, 83)]\n    ' + ret, pairs_sample: pairs("sample(r, 2)"), pairs_randrange: pairs("randrange(48), randrange(48)"),
    pairs_random: pairs("int(random() * 48), int(random() * 48)"), starter_burn0: flower.replace(/^BURN = .*$/m, "BURN = 0.0") };
  for (const [k, code] of Object.entries(V)) console.log(k, JSON.stringify(await cpuAt(code, 50)));
} else if (what === "w4") {
  const w4 = fs.readFileSync(new URL("four_property_flower.py", import.meta.url), "utf8");
  console.log("setup only", JSON.stringify(await cpuAt(w4.replace(/^BURN = .*$/m, "BURN = 0.0"), 50)));
  for (const R of [1, 5, 50]) console.log("BURN 0.6, R", R, JSON.stringify(await cpuAt(w4, R)));
} else if (what === "bee") {
  const t = await tryBee({ config, programs: { flower, bee }, rounds: 300 });
  const ends = t.actions.filter((a) => a.action === "feed" || a.action === "leave"), fedA = ends.filter((a) => a.action === "feed");
  const beeMs = ends.map((a) => a.beeMs).filter((x) => typeof x === "number");
  console.log(JSON.stringify({ price: feedPriceOf(config), rounds: t.rounds, turns: ends.length, feeds: fedA.length,
    nectar_per_feed_mean: Math.round(fedA.reduce((s, a) => s + (a.nectar || 0), 0) / Math.max(1, fedA.length)),
    bee_ms_p50: q(beeMs, 0.5), bee_ms_p99: q(beeMs, 0.99), bee_ms_max: Math.max(...beeMs), problems: t.problems.slice(0, 3), memory: t.memory }));
} else console.log("usage: coop_eq_extra.mjs startup | w4 | bee");
