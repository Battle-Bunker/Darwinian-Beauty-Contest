// Whose clover does each orchid imitate? For every round of every arena game, run each orchid and each
// clover on the challenges bees actually asked that round, and measure answer overlap.
//   node analysis/orchid-targets.mjs
import pg from "pg";
import { tryFlower } from "../server/engine.js";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://dbc:dbc@localhost:5432/dbc" });
await db.connect();
const games = (await db.query(`
  SELECT ag.arena_id, ag.game_url, g.id, g.config, g.participants, g.rounds_played
    FROM arena.games ag JOIN games g ON g.id = (
      SELECT gg.id FROM games gg JOIN rooms r ON r.id = gg.room_id
       WHERE '/room/' || substr(r.code, 1, r.prefix_len) || '/game/' || substr(gg.code, 1, gg.prefix_len) = ag.game_url)
   WHERE g.rounds_played > 0 ORDER BY ag.id`)).rows;

const tally = { self: 0, rival: 0, both: 0, neither: 0 };
const examples = [];
for (const g of games) {
  const names = Object.fromEntries((await db.query("SELECT id, name FROM teams WHERE game_id = $1", [g.id])).rows.map((r) => [r.id, r.name]));
  for (let round = 1; round <= g.rounds_played; round++) {
    const progs = (await db.query("SELECT team_id, kind, code FROM round_programs WHERE game_id = $1 AND round_no = $2 AND kind <> 'bee'", [g.id, round])).rows;
    const asked = (await db.query(
      `SELECT DISTINCT s->'c' AS c FROM visits v, jsonb_array_elements(v.steps) s WHERE v.game_id = $1 AND v.round_no = $2 LIMIT 400`, [g.id, round])).rows.map((r) => r.c);
    // a deterministic spread of the challenges bees really used
    const challenges = asked.filter((_, i) => i % Math.max(1, Math.floor(asked.length / 40)) === 0).slice(0, 40);
    if (!challenges.length) continue;
    const answers = {};
    await Promise.all(progs.map(async (p) => {
      const out = await tryFlower({ config: g.config, code: p.code, kind: p.kind, challenges, nTeams: g.participants.length });
      answers[`${p.team_id}:${p.kind}`] = out.results.map((x) => JSON.stringify(x.r));
    }));
    const match = (a, b) => a && b ? a.filter((x, i) => x !== "null" && x === b[i]).length / a.length : 0;
    for (const team of g.participants) {
      const orch = answers[`${team}:orchid`];
      const own = match(orch, answers[`${team}:clover`]);
      let best = 0, bestTeam = null;
      for (const other of g.participants) {
        if (other === team) continue;
        const m = match(orch, answers[`${other}:clover`]);
        if (m > best) { best = m; bestTeam = other; }
      }
      const kind = own >= 0.5 && best >= 0.5 ? "both" : own >= 0.5 ? "self" : best >= 0.5 ? "rival" : "neither";
      tally[kind]++;
      if (kind === "rival" || kind === "both" || (best >= 0.2 && best > own)) {
        examples.push(`${g.arena_id.padEnd(9)} ${g.game_url.padEnd(16)} r${round}  ${names[team].slice(0, 22).padEnd(22)} matches own clover ${(own * 100).toFixed(0).padStart(3)}%, ${names[bestTeam].slice(0, 22)}'s ${(best * 100).toFixed(0)}%`);
      }
    }
  }
}
const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`orchid-rounds measured: ${total} (≥50% answer match on challenges bees actually asked)`);
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(8)} ${v}  (${((v / total) * 100).toFixed(0)}%)`);
console.log("\norchids that look more like a rival's clover than their own (≥20%):");
for (const e of examples) console.log("  " + e);
await db.end();
