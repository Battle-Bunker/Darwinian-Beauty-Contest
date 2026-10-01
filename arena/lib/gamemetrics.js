// Compute and store all metrics of a finished (revealed) game: round metrics (incl. orchid targets),
// game metrics, and collapse events. Used by run.js after each game and by backfill.js.
import { q } from "./db.js";
import { gameCollapses, gameMetrics, roundMetrics } from "./metrics.js";
import { orchidTargets } from "./targets.js";

export async function storeMetrics(arena, gameRow, view) {
  const rms = [];
  for (const [i, r] of view.rounds.entries()) {
    const m = roundMetrics(view, r, i ? view.rounds[i - 1] : null);
    try { m.orchidTargets = await orchidTargets(view, r); } catch (e) { m.orchidTargets = { error: e.message }; }
    rms.push(m);
  }
  for (const m of rms) await q("INSERT INTO arena.round_metrics (game_id, round_no, metrics) VALUES ($1,$2,$3) ON CONFLICT (game_id, round_no) DO UPDATE SET metrics = $3", [gameRow.id, m.round, m]);
  const gm = gameMetrics(view, rms);
  const sum = (key) => rms.reduce((acc, m) => { for (const [k, v] of Object.entries(m.orchidTargets?.[key] || {})) acc[k] = (acc[k] || 0) + v; return acc; }, {});
  gm.orchidTargets = sum("counts");
  if (/tree|graph/.test(view.game.config.responseType)) gm.orchidFeatureTargets = sum("featCounts");
  const col = gameCollapses(gm, rms);
  gm.collapses = col.game;
  await q("UPDATE arena.games SET metrics = $2 WHERE id = $1", [gameRow.id, gm]);
  await q("DELETE FROM arena.collapse_events WHERE game_id = $1", [gameRow.id]);
  for (const f of col.perRound.flat()) await q("INSERT INTO arena.collapse_events (arena_id, game_id, generation, round_no, mode, severity, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7)", [arena.id, gameRow.id, gameRow.generation, f.round, f.mode, f.severity, f.evidence]);
  for (const f of col.game) await q("INSERT INTO arena.collapse_events (arena_id, game_id, generation, round_no, mode, severity, evidence) VALUES ($1,$2,$3,NULL,$4,$5,$6)", [arena.id, gameRow.id, gameRow.generation, "game:" + f.mode, f.severity, f.evidence]);
  return { rms, gm };
}
