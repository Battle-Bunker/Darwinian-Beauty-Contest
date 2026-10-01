// Recompute every stored program's size and change distance under the current measures
// (server/lib/measure.js). Run after a rule change:  npm run remeasure
import { pool } from "../server/db/pool.js";
import { changes, size } from "../server/lib/measure.js";

const { rows: games } = await pool.query("SELECT id, config->>'language' AS language FROM games");
let updated = 0;
for (const g of games) {
  const { rows } = await pool.query(
    "SELECT round_no, team_id, kind, code, chars, distance FROM round_programs WHERE game_id = $1 ORDER BY round_no", [g.id]);
  const last = new Map(); // team|kind → code that played most recently
  for (const p of rows) {
    const key = `${p.team_id}|${p.kind}`;
    const chars = (await size(g.language, p.code)).chars;
    const distance = last.has(key) ? await changes(g.language, last.get(key), p.code) : null;
    if (chars !== p.chars || distance !== p.distance) {
      await pool.query("UPDATE round_programs SET chars = $5, distance = $6 WHERE game_id = $1 AND round_no = $2 AND team_id = $3 AND kind = $4",
        [g.id, p.round_no, p.team_id, p.kind, chars, distance]);
      updated++;
    }
    last.set(key, p.code);
  }
  const { rows: subs } = await pool.query("SELECT team_id, kind, code, chars, distance FROM submissions WHERE game_id = $1", [g.id]);
  for (const s of subs) {
    const prev = last.get(`${s.team_id}|${s.kind}`);
    const chars = (await size(g.language, s.code)).chars;
    const distance = prev === undefined ? null : await changes(g.language, prev, s.code);
    if (chars !== s.chars || distance !== s.distance) {
      await pool.query("UPDATE submissions SET chars = $4, distance = $5 WHERE game_id = $1 AND team_id = $2 AND kind = $3",
        [g.id, s.team_id, s.kind, chars, distance]);
      updated++;
    }
  }
}
console.log(`checked ${games.length} games; updated ${updated} program rows`);
await pool.end();
