// Compute and store all metrics of a finished game: round metrics, game metrics, and collapse events (run.js, after
// each game). Games played before engine v3 also stored "orchid targets", computed by re-running every flower on the
// challenges bees asked; with non-pure flowers that is meaningless, so stolen-face and twin orchids are now measured
// from the answers bees actually saw (lib/v3.js). analyze.js still reads the stored orchid targets of old games.
import { all, q } from "./db.js";
import { gameCollapses, gameMetrics, roundMetrics } from "./metrics.js";

export async function storeMetrics(arena, gameRow, view) {
  const rms = [];
  // Per-flower compute use (round_programs.compute; not in the API view yet), read-only by game uuid.
  const comp = view.game.id ? await all("SELECT round_no, team_id, kind, compute FROM round_programs WHERE game_id = $1 AND compute IS NOT NULL", [view.game.id]).catch(() => []) : [];
  for (const r of view.rounds) {
    r.compute = {};
    for (const c of comp.filter((x) => x.round_no === r.no)) (r.compute[c.team_id] ||= {})[c.kind] = c.compute;
  }
  for (const [i, r] of view.rounds.entries()) {
    rms.push(roundMetrics(view, r, i ? view.rounds[i - 1] : null));
  }
  for (const m of rms) await q("INSERT INTO arena.round_metrics (game_id, round_no, metrics) VALUES ($1,$2,$3) ON CONFLICT (game_id, round_no) DO UPDATE SET metrics = $3", [gameRow.id, m.round, m]);
  const gm = gameMetrics(view, rms);
  const col = gameCollapses(gm, rms);
  gm.collapses = col.game;
  await q("UPDATE arena.games SET metrics = $2 WHERE id = $1", [gameRow.id, gm]);
  await q("DELETE FROM arena.collapse_events WHERE game_id = $1", [gameRow.id]);
  for (const f of col.perRound.flat()) await q("INSERT INTO arena.collapse_events (arena_id, game_id, generation, round_no, mode, severity, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7)", [arena.id, gameRow.id, gameRow.generation, f.round, f.mode, f.severity, f.evidence]);
  for (const f of col.game) await q("INSERT INTO arena.collapse_events (arena_id, game_id, generation, round_no, mode, severity, evidence) VALUES ($1,$2,$3,NULL,$4,$5,$6)", [arena.id, gameRow.id, gameRow.generation, "game:" + f.mode, f.severity, f.evidence]);
  return { rms, gm };
}
