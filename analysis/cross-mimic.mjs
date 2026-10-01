// Does an orchid do better copying a RIVAL's clover than copying its own?   node analysis/cross-mimic.mjs
// Garden of 8 (scripted, real engine, 3 rounds per game, 4 seeds):
//   2 cross-mimics: orchid = exact copy of a victim's clover (best case for the mimic: it knows the function)
//   2 victims:      honest patches whose clover is being copied
//   2 twins:        orchid = exact copy of their own clover
//   2 honest:       clover and orchid both unique, nobody copies them
// Bees fingerprint flowers by their answer to one random question per round and keep a nectar tally
// per answer (lax: feed while ≥ 50% paid; strict: only while 100% paid), and recognise their own clover.
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
def forage(seen, turns_left):
    if not seen:
        return ["ask", Q]
    r = seen[0][1]
    if r == int(hashlib.sha256(("${salt}" + str(Q)).encode()).hexdigest()[:8], 16):
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
// role per team index, and for cross-mimics, whose clover they copy
const ROLES = ["cross", "cross", "victim", "victim", "twin", "twin", "honest", "honest"];
const TARGET = { 0: 2, 1: 3 };

async function game(mode, feedCost, seed) {
  const config = normalizeConfig({ feedCost, turns: 100, budgets: { bee: { nodes: 1000 } } });
  const teams = ROLES.map((role, i) => {
    const salt = `t${i}-`;
    const orchid = role === "cross" ? hashFn(`t${TARGET[i]}-`) : role === "twin" ? hashFn(salt) : hashFn(`o${i}-`);
    return { id: i, role, programs: { clover: hashFn(salt), orchid, bee: bee(salt, mode) } };
  });
  let feeds = null, nectar = null;
  for (let r = 0; r < 3; r++) {
    const res = await simulateRound({ config, teams, seed: seed * 100 + r });
    feeds = feeds ? feeds.map((row, i) => row.map((x, j) => x + res.feeds[i][j])) : res.feeds;
    nectar = nectar ? nectar.map((row, i) => row.map((x, j) => x + res.nectar[i][j])) : res.nectar;
  }
  return { teams, scores: score(teams.map((t) => t.id), feeds, nectar), feeds };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("mean fitness (allure share×N, forage share×N) by role, 8 teams, 3 rounds, 4 seeds\n");
console.log("feedCost bees    |  cross-mimic         victim              twin                honest");
for (const feedCost of [3, 5, 10]) {
  for (const mode of ["lax", "strict"]) {
    const acc = {};
    for (const seed of [1, 2, 3, 4]) {
      const g = await game(mode, feedCost, seed);
      g.scores.forEach((s, i) => {
        const a = (acc[g.teams[i].role] ||= { fit: [], all: [], for: [] });
        a.fit.push(s.fitness); a.all.push(s.allureShare * 8); a.for.push(s.forageShare * 8);
      });
    }
    const cell = (r) => `${mean(acc[r].fit).toFixed(2)} (${mean(acc[r].all).toFixed(2)}, ${mean(acc[r].for).toFixed(2)})`;
    console.log(`${String(feedCost).padStart(5)}    ${mode.padEnd(7)} |  ${["cross", "victim", "twin", "honest"].map(cell).join("   ")}`);
  }
}
