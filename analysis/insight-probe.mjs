// How much does a small dose of insight beat pure AI delegation? Take the final-round programs of real
// arena games (written entirely by LLM teams) and swap ONE team for a short scripted strategy that a
// junior coder who understands the game could write. Then replay rounds offline on the real engine.
//   node analysis/insight-probe.mjs
// The scripted team ("insight"):
//   clover: a salted hash of the challenge, shaped into the response type (unpredictable, so
//           it can't be extrapolated from a log)
//   orchid: the same with a different salt (honest: it doesn't pretend to be anyone)
//   bee:    asks one random question per round, recognises its own two flowers, tastes each new
//           answer once, then keeps feeding only at answers that paid at least half the time
import pg from "pg";
import { simulateRound } from "../server/engine.js";
import { score } from "../server/lib/scoring.js";
import { measure } from "../server/lib/ast.js";

const RESP = {
  int: `int(x[:8], 16) % 1000`,
  str: `x[:12]`,
  graph: `{"nodes": n, "edges": [[i, j] for i in range(n) for j in range(i + 1, n) if int(x[(7 * i + j) % 64], 16) % 3 == 0]}`,
  "tree[int]": `{"value": int(x[:2], 16), "children": [{"value": int(x[2 + 2 * k:4 + 2 * k], 16), "children": []} for k in range(1 + int(x[1], 16) % 4)]}`,
};
const QUESTION = { int: `random.randint(0, 10**6)`, str: `"q" + str(random.randint(0, 10**6))`, "list[int]": `[random.randint(0, 999) for _ in range(3)]` };

const flower = (salt, rt) => `import hashlib, json
def flower(c):
    x = hashlib.sha256(("${salt}" + json.dumps(c)).encode()).hexdigest()
    n = 3 + int(x[0], 16) % 6
    return ${RESP[rt]}
`;
const bee = (cs, os, ct, rt) => `import hashlib, json, random
Q = ${QUESTION[ct]}
def answer(salt, c):
    x = hashlib.sha256((salt + json.dumps(c)).encode()).hexdigest()
    n = 3 + int(x[0], 16) % 6
    return ${RESP[rt]}
def key(r):
    return json.dumps(r, sort_keys=True)
MINE = key(answer("${cs}", Q))
MY_ORCHID = key(answer("${os}", Q))
tally = {}
def forage(seen, turns_left):
    if not seen:
        return ["ask", Q]
    k = key(seen[0][1])
    if k == MINE:
        return "feed"
    if k == MY_ORCHID:
        return "leave"
    fed, got = tally.get(k, [0, 0])
    if fed == 0 or (got > 0 and 2 * got >= fed):
        return "feed"
    return "leave"
def tasted(seen, nectar):
    k = key(seen[0][1])
    fed, got = tally.get(k, [0, 0])
    tally[k] = [fed + 1, got + (1 if nectar else 0)]
`;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://dbc:dbc@localhost:5432/dbc" });
await db.connect();
const games = (await db.query(`
  SELECT ag.arena_id, ag.generation, ag.game_url, g.id, g.config, g.participants, g.rounds_played
    FROM arena.games ag JOIN games g ON g.id = (
      SELECT gg.id FROM games gg JOIN rooms r ON r.id = gg.room_id
       WHERE '/room/' || substr(r.code, 1, r.prefix_len) || '/game/' || substr(gg.code, 1, gg.prefix_len) = ag.game_url)
   WHERE g.status = 'finished' AND g.config->>'language' = 'python'
     AND (ag.arena_id, ag.generation) IN (SELECT arena_id, max(generation) FROM arena.games WHERE stage = 'done' GROUP BY arena_id)
   ORDER BY ag.arena_id`)).rows;

const ROUNDS = 3, SEEDS = [11, 22];
console.log("insight team swapped into each slot of a finished LLM game (final-round programs), 3 rounds × 2 seeds\n");
for (const g of games) {
  const ct = g.config.challengeType, rt = g.config.responseType;
  if (!RESP[rt] || !QUESTION[ct]) { console.log(`${g.arena_id}: skipped (${ct} -> ${rt})`); continue; }
  const names = Object.fromEntries((await db.query("SELECT id, name FROM teams WHERE game_id = $1", [g.id])).rows.map((r) => [r.id, r.name]));
  const progs = (await db.query("SELECT team_id, kind, code FROM round_programs WHERE game_id = $1 AND round_no = $2", [g.id, g.rounds_played])).rows;
  const llm = g.participants.map((id) => ({ id, programs: Object.fromEntries(progs.filter((p) => p.team_id === id).map((p) => [p.kind, p.code])) }));
  const ins = { clover: flower("c-9f3a", rt), orchid: flower("o-71be", rt), bee: bee("c-9f3a", "o-71be", ct, rt) };
  const sizes = await Promise.all(["clover", "orchid", "bee"].map(async (k) => `${k} ${(await measure("python", ins[k])).chars}/${g.config.budgets[k].chars}`));
  const play = async (teams) => {
    const fits = teams.map(() => 0), all = teams.map(() => 0), forg = teams.map(() => 0);
    for (const seed of SEEDS) {
      let F = null, N = null;
      for (let r = 0; r < ROUNDS; r++) {
        const res = await simulateRound({ config: g.config, teams, seed: seed * 100 + r });
        F = F ? F.map((row, i) => row.map((x, j) => x + res.feeds[i][j])) : res.feeds;
        N = N ? N.map((row, i) => row.map((x, j) => x + res.nectar[i][j])) : res.nectar;
      }
      score(teams.map((t) => t.id), F, N).forEach((s, i) => {
        fits[i] += s.fitness / SEEDS.length;
        all[i] += (s.allureShare * teams.length) / SEEDS.length;
        forg[i] += (s.forageShare * teams.length) / SEEDS.length;
      });
    }
    return Object.assign(fits, { all, forg });
  };
  const base = await play(llm);
  const rows = [];
  for (let slot = 0; slot < llm.length; slot++) {
    const teams = llm.map((t, i) => (i === slot ? { id: "insight", programs: ins } : t));
    const fits = await play(teams);
    const rank = 1 + fits.filter((f) => f > fits[slot]).length;
    rows.push({ replaced: names[llm[slot].id], was: base[slot], insight: fits[slot], rank, bestLLM: Math.max(...fits.filter((_, i) => i !== slot)),
      allure: fits.all[slot], forage: fits.forg[slot], forageRank: 1 + fits.forg.filter((f) => f > fits.forg[slot]).length, bestLLMForage: Math.max(...fits.forg.filter((_, i) => i !== slot)) });
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${g.arena_id} gen ${g.generation} ${g.game_url} (${ct} -> ${rt}); insight sizes: ${sizes.join(", ")}`);
  console.log(`  LLM teams on their own: best ${Math.max(...base).toFixed(2)}, worst ${Math.min(...base).toFixed(2)}`);
  console.log(`  insight team: mean fitness ${mean(rows.map((r) => r.insight)).toFixed(2)}, ranks ${rows.map((r) => r.rank).join(",")} of ${llm.length}; best LLM team alongside it ${mean(rows.map((r) => r.bestLLM)).toFixed(2)}`);
  console.log(`    allure share×N ${mean(rows.map((r) => r.allure)).toFixed(2)} | forage share×N ${mean(rows.map((r) => r.forage)).toFixed(2)} (forage ranks ${rows.map((r) => r.forageRank).join(",")}; best LLM bee ${mean(rows.map((r) => r.bestLLMForage)).toFixed(2)})`);
}
await db.end();
