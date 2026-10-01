// Shared read-only loaders for the fingerprint / replay analyses (analysis/fingerprint-census.mjs,
// analysis/stolen-faces.mjs, analysis/literal-census.mjs). Reads the arena schema and the game tables.
import crypto from "node:crypto";
import { all, pool } from "../arena/lib/db.js";

export { all, pool };

/** Short stable key for a (possibly huge) JSON value. */
export const key = (v) => {
  const s = JSON.stringify(v ?? null);
  return s.length <= 40 ? s : "#" + crypto.createHash("sha1").update(s).digest("base64").slice(0, 16);
};

/** Arena family used for grouping: v1 arenas by type, v2 arenas, the cohort games. */
export function family(arena) {
  if (arena.startsWith("gx-")) return "v2-cohort";
  if (arena.startsWith("v2-")) return "v2-arena";
  if (arena === "strdark") return "v1-str";
  if (arena === "lists") return "v1-list";
  if (arena === "trees" || arena === "graphs") return "v1-struct";
  if (arena === "unprimed") return "v1-int-unprimed";
  return "v1-int-primed"; // pilot, baseline, norecap, cheapfeed, tight
}

/** Every arena game that played at least one round, oldest first. */
export async function arenaGames(arenas = null) {
  const rows = await all(`
    SELECT ag.id AS agid, ag.arena_id AS arena, ag.generation AS gen, ag.game_url AS url, ag.condition, ag.python,
           ag.contaminated, ag.started_at, g.id AS uuid, g.rounds_played AS rounds, g.config, g.participants
      FROM arena.games ag JOIN games g ON g.id = (
        SELECT gg.id FROM games gg JOIN rooms rr ON rr.id = gg.room_id
         WHERE '/room/' || substr(rr.code, 1, rr.prefix_len) || '/game/' || substr(gg.code, 1, gg.prefix_len) = ag.game_url)
     WHERE g.rounds_played > 0 ORDER BY ag.started_at, ag.id`);
  return rows.filter((r) => !arenas || arenas.includes(r.arena)).map((r) => ({ ...r, family: family(r.arena) }));
}

/** team uuid -> { slug, name, team, model, card, fitness, rank, allure, forage } */
export async function entriesOf(agid) {
  const rows = await all(`
    SELECT e.team_id, e.team_name, e.fitness, e.fitness_rank, e.allure, e.forage, p.slug, p.name, p.model, p.idea_card, p.source
      FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1`, [agid]);
  return new Map(rows.map((r) => [r.team_id, { slug: r.slug, name: r.name, team: r.team_name, model: r.model, card: r.idea_card,
    fitness: r.fitness, rank: r.fitness_rank, allure: r.allure, forage: r.forage, source: r.source }]));
}

export async function teamNames(uuid) {
  return new Map((await all("SELECT id, name FROM teams WHERE game_id = $1", [uuid])).map((r) => [r.id, r.name]));
}

export async function visitsOf(uuid, round = null) {
  return all(`SELECT round_no, bee_team AS bee, patch_team AS patch, seq, kind, action, nectar, steps, turn_start, turn_end
                FROM visits WHERE game_id = $1 ${round ? "AND round_no = $2" : ""} ORDER BY round_no, bee_team, seq`,
  round ? [uuid, round] : [uuid]);
}

/** Map "round|team|kind" -> { code, nodes, distance, carried } */
export async function programsOf(uuid) {
  const rows = await all("SELECT round_no, team_id, kind, code, nodes, distance, carried_over FROM round_programs WHERE game_id = $1", [uuid]);
  return new Map(rows.map((r) => [`${r.round_no}|${r.team_id}|${r.kind}`, { code: r.code, nodes: r.nodes, distance: r.distance, carried: r.carried_over }]));
}

/** [{ round_no, scores: [{teamId, fitness, allure, ...}], turns }] */
export async function roundsOf(uuid) {
  return all("SELECT round_no, scores, totals, turns, feeds, nectar FROM rounds WHERE game_id = $1 ORDER BY round_no", [uuid]);
}

/** Pre-feed asks of a visit that got an answer. */
export const preSteps = (v) => (v.steps || []).filter((s) => !s.after);

export const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : x.toFixed(2));
export const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
