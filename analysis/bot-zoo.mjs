// Scripted-strategy probes of the game's incentives, run on the real engine (no database, no LLMs).
//   node analysis/bot-zoo.mjs
//
// Patches:  honest = clover and orchid are different salted hashes (a bee can fingerprint each flower)
//           twin   = orchid is an exact copy of the clover (indistinguishable, even to its owner)
// Bees ask one random question per round, recognise their own clover, and keep a tally of
// nectar per answer ("fingerprint"):
//           lax    = keep feeding at fingerprints that paid off at least half the time
//           strict = keep feeding only at fingerprints that always paid off
//           blind  = feed everywhere
import { simulateRound } from "../server/engine.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { score } from "../server/lib/scoring.js";

const hashFn = (salt) => `import hashlib
def flower(c):
    return int(hashlib.sha256(("${salt}" + str(c)).encode()).hexdigest()[:8], 16)
`;
const bee = (salt, mode) => `import random, hashlib
Q = random.randint(0, 10**9)
tally = {}
def mine(c):
    return int(hashlib.sha256(("${salt}" + str(c)).encode()).hexdigest()[:8], 16)
def forage(seen, turns_left):
    if not seen:
        return ["ask", Q]
    r = seen[0][1]
    if r == mine(Q) or "${mode}" == "blind":
        return "feed"
    fed, got = tally.get(r, [0, 0])
    if fed == 0:
        return "feed"
    ok = got / fed >= 0.5 if "${mode}" == "lax" else got == fed
    return "feed" if ok else "leave"
def tasted(seen, nectar):
    r = seen[0][1]
    fed, got = tally.get(r, [0, 0])
    tally[r] = [fed + 1, got + (1 if nectar else 0)]
`;

async function play({ n, honest, beeModes, feedCost, turns = 100, rounds = 3, seed = 1 }) {
  // `turns` per round, as in the v1 rules this probe was written for.
  const config = normalizeConfig({ feedCost, turnsPerFlower: Math.max(1, Math.round(turns / (2 * n))) });
  const teams = [...Array(n).keys()].map((i) => {
    const salt = `team${i}-`;
    return { id: i, honest: i < honest, mode: beeModes[i % beeModes.length], programs: {
      clover: hashFn(salt), orchid: i < honest ? hashFn(`orchid${i}-`) : hashFn(salt), bee: bee(salt, beeModes[i % beeModes.length]) } };
  });
  const tot = { feeds: null, nectar: null };
  for (let r = 0; r < rounds; r++) {
    const res = await simulateRound({ config, teams, seed: seed * 1000 + r });
    tot.feeds = tot.feeds ? tot.feeds.map((row, i) => row.map((x, j) => x + res.feeds[i][j])) : res.feeds;
    tot.nectar = tot.nectar ? tot.nectar.map((row, i) => row.map((x, j) => x + res.nectar[i][j])) : res.nectar;
  }
  return { teams, scores: score(teams.map((t) => t.id), tot.feeds, tot.nectar), ...tot };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f2 = (x) => (Number.isNaN(x) ? "  -  " : x.toFixed(2));

console.log("1) Patch payoff: mean fitness of honest vs twin patches, all bees using one mode (N=8, 3 rounds, 2 seeds)");
console.log("   feedCost  bees    | honest patches: 2/8       4/8        6/8   (cells: honest | twin)");
for (const feedCost of [3, 5, 10]) {
  for (const mode of ["blind", "lax", "strict"]) {
    const cells = [];
    for (const honest of [2, 4, 6]) {
      const h = [], t = [];
      for (const seed of [1, 2]) {
        const g = await play({ n: 8, honest, beeModes: [mode], feedCost, seed });
        g.scores.forEach((s, i) => (g.teams[i].honest ? h : t).push(s.fitness));
      }
      cells.push(`${f2(mean(h))} | ${f2(mean(t))}`);
    }
    console.log(`   ${String(feedCost).padStart(5)}    ${mode.padEnd(7)} |  ${cells.join("    ")}`);
  }
}

console.log("\n2) Bee payoff: lax vs strict bees sharing a garden (N=8, half each), by honest patch count");
console.log("   feedCost | honest: 0/8            4/8            8/8    (cells: forage share×N lax | strict)");
for (const feedCost of [3, 5, 10]) {
  const cells = [];
  for (const honest of [0, 4, 8]) {
    const lax = [], strict = [];
    for (const seed of [1, 2]) {
      const g = await play({ n: 8, honest, beeModes: ["lax", "strict"], feedCost, seed });
      g.scores.forEach((s, i) => (g.teams[i].mode === "lax" ? lax : strict).push(s.forageShare * 8));
    }
    cells.push(`${f2(mean(lax))} | ${f2(mean(strict))}`);
  }
  console.log(`   ${String(feedCost).padStart(5)}    |  ${cells.join("    ")}`);
}
