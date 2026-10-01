#!/usr/bin/env node
// Recompute and store metrics (incl. orchid targets) for every played arena game. Safe to re-run.
//   node arena/backfill.js [--arena id]
import { Api, gamePath } from "./lib/api.js";
import { all, migrate, pool } from "./lib/db.js";
import { storeMetrics } from "./lib/gamemetrics.js";

const only = process.argv.includes("--arena") ? process.argv[process.argv.indexOf("--arena") + 1] : null;
await migrate();
const games = await all(`SELECT g.*, a.room_short_id FROM arena.games g JOIN arena.arenas a ON a.id = g.arena_id
                          WHERE g.stage IN ('played','interviewed','judged','done') ${only ? "AND g.arena_id = $1" : ""} ORDER BY g.id`, only ? [only] : []);
for (const g of games) {
  const view = await Api.view(null, gamePath(g.room_short_id, g.game_short_id));
  if (!view.game.revealed) { console.log("skip (not revealed)", g.arena_id, g.generation); continue; }
  const { gm } = await storeMetrics({ id: g.arena_id }, g, view);
  console.log(g.arena_id, g.generation, JSON.stringify(gm.orchidTargets), gm.orchidFeatureTargets ? JSON.stringify(gm.orchidFeatureTargets) : "", gm.collapses.map((c) => c.mode).join(","));
}
await pool.end();
