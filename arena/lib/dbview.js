// A fully revealed game view built straight from the game's tables (read-only), in the same shape as the API's
// revealed view. The cohort experiment runs games with revealOnFinish: false (so agents can't pull rival code
// through the API), but the arena's metrics, judges and diffusion channel need everything.
import { all, one } from "./db.js";

export async function fullView(gameId) {
  const g = await one("SELECT * FROM games WHERE id = $1", [gameId]);
  if (!g) throw new Error(`no game ${gameId}`);
  const teams = await all("SELECT id, name, color FROM teams WHERE game_id = $1 ORDER BY created_at, id", [gameId]);
  const rounds = await all("SELECT * FROM rounds WHERE game_id = $1 ORDER BY round_no", [gameId]);
  const progs = await all("SELECT * FROM round_programs WHERE game_id = $1", [gameId]);
  const mems = await all("SELECT round_no, team_id, bytes, note FROM bee_memories WHERE game_id = $1", [gameId]);
  const visits = await all("SELECT * FROM visits WHERE game_id = $1 ORDER BY round_no, bee_team, seq", [gameId]);
  const participants = g.participants || [];
  const KINDS = ["clover", "orchid", "bee"];
  return {
    game: { id: g.id, config: g.config, status: g.status, roundsPlayed: g.rounds_played, revealed: true, fromDb: true },
    participants,
    teams,
    rounds: rounds.map((r) => ({
      no: r.round_no, turns: r.turns, feeds: r.feeds, nectar: r.nectar, scores: r.scores, totals: r.totals,
      programs: Object.fromEntries(participants.map((t) => [t, Object.fromEntries(KINDS.map((k) => {
        const p = progs.find((x) => x.round_no === r.round_no && x.team_id === t && x.kind === k);
        return [k, p ? { code: p.code, chars: p.chars, distance: p.distance, carriedOver: p.carried_over, problem: p.problem, compute: p.compute } : null];
      }))])),
      memory: Object.fromEntries(mems.filter((m) => m.round_no === r.round_no).map((m) => [m.team_id, { bytes: m.bytes, note: m.note }])),
      visits: visits.filter((v) => v.round_no === r.round_no).map((v) => ({
        bee: v.bee_team, patch: v.patch_team, seq: v.seq, start: v.turn_start, end: v.turn_end, asks: v.steps.length,
        asksBeforeFeed: v.action === "feed" ? v.steps.filter((s) => !s.after).length : v.steps.length,
        action: v.action, nectar: v.nectar, kind: v.kind, steps: v.steps, beeError: v.bee_error, note: v.note,
      })),
    })),
    final: g.status === "finished" && rounds.length ? rounds[rounds.length - 1].totals : null,
  };
}
