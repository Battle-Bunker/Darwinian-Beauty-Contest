// Recompute every stored program's size (submissions and round_programs) under the current complexity
// rule. Run after the rule changes:  npm run remeasure
import { pool } from "../server/db/pool.js";
import { measure } from "../server/lib/ast.js";

const { rows } = await pool.query(`
  SELECT DISTINCT g.config->>'language' AS language, p.code FROM (
    SELECT game_id, code FROM submissions UNION ALL SELECT game_id, code FROM round_programs) p
  JOIN games g ON g.id = p.game_id`);
let changed = 0;
for (const { language, code } of rows) {
  const { chars } = await measure(language, code);
  for (const table of ["submissions", "round_programs"]) {
    const r = await pool.query(
      `UPDATE ${table} t SET chars = $3 FROM games g
        WHERE g.id = t.game_id AND g.config->>'language' = $1 AND t.code = $2 AND t.chars IS DISTINCT FROM $3`,
      [language, code, chars]);
    changed += r.rowCount;
  }
}
console.log(`measured ${rows.length} distinct programs; updated ${changed} rows`);
await pool.end();
