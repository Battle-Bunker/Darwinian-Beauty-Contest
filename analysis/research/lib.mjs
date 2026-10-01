// Shared loader for the signal-forensics scripts (read-only DB access).
// Caches a JSON snapshot of every arena game (config, teams, programs, visits) in CACHE_DIR.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ProgramProcess } from "../../server/runners/proc.js";
import { checkValue, parseType } from "../../server/lib/types.js";
import { gameInfo } from "../../server/engine.js";

export const CACHE_DIR = process.env.RESEARCH_CACHE || "/tmp/claude-0/-home-user/ac160c69-15f5-534e-9e3a-7b508ab58e74/scratchpad/research";
fs.mkdirSync(CACHE_DIR, { recursive: true });

export const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
export const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
/** canonical JSON key (sorted object keys: jsonb reorders them) */
export const K = (x) => JSON.stringify(canon(x));
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const pct = (x, d = 0) => (Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "-");
export const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");

const SQL_GAMES = `
  SELECT ag.id AS agid, ag.arena_id, ag.generation, ag.game_url, ag.condition, ag.contaminated, ag.metrics,
         g.id AS gid, g.config, g.participants, g.rounds_played
    FROM arena.games ag JOIN games g ON g.id = (
      SELECT gg.id FROM games gg JOIN rooms r ON r.id = gg.room_id
       WHERE '/room/' || substr(r.code, 1, r.prefix_len) || '/game/' || substr(gg.code, 1, gg.prefix_len) = ag.game_url)
   WHERE g.rounds_played > 0 ORDER BY ag.arena_id, ag.generation`;

export async function loadAll() {
  const file = path.join(CACHE_DIR, "games.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://dbc:dbc@localhost:5432/dbc" });
  await db.connect();
  await db.query("SET default_transaction_read_only = on");
  const games = (await db.query(SQL_GAMES)).rows;
  const out = [];
  for (const g of games) {
    const teams = (await db.query("SELECT id, name FROM teams WHERE game_id = $1", [g.gid])).rows;
    const names = Object.fromEntries(teams.map((t) => [t.id, t.name]));
    const personas = (await db.query("SELECT e.team_id, e.persona_id, p.model FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1", [g.agid])).rows;
    const persona = Object.fromEntries(personas.map((p) => [p.team_id, { id: p.persona_id, model: p.model }]));
    const progs = (await db.query("SELECT round_no, team_id, kind, code, nodes, distance, carried_over, problem FROM round_programs WHERE game_id = $1", [g.gid])).rows;
    const visits = (await db.query("SELECT round_no, bee_team, seq, patch_team, kind, turn_start, turn_end, action, nectar, steps, bee_error FROM visits WHERE game_id = $1 ORDER BY round_no, bee_team, seq", [g.gid])).rows;
    const rounds = (await db.query("SELECT round_no, feeds, nectar, scores, totals FROM rounds WHERE game_id = $1 ORDER BY round_no", [g.gid])).rows;
    const R = [];
    for (let r = 1; r <= g.rounds_played; r++) {
      const programs = {};
      for (const p of progs.filter((p) => p.round_no === r)) (programs[p.team_id] ||= {})[p.kind] = { code: p.code, nodes: p.nodes, distance: p.distance, carried: p.carried_over, problem: p.problem };
      const rr = rounds.find((x) => x.round_no === r);
      R.push({
        no: r, programs, scores: rr?.scores, totals: rr?.totals,
        visits: visits.filter((v) => v.round_no === r).map((v) => ({ bee: v.bee_team, seq: v.seq, patch: v.patch_team, kind: v.kind, t0: v.turn_start, t1: v.turn_end, action: v.action, nectar: v.nectar, steps: v.steps, err: v.bee_error })),
      });
    }
    out.push({
      agid: g.agid, arena: g.arena_id, gen: g.generation, url: g.game_url, condition: g.condition, contaminated: g.contaminated,
      gid: g.gid, config: g.config, ids: g.participants, names, persona, metrics: g.metrics, rounds: R,
    });
  }
  await db.end();
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

export const PRIMED = new Set(["pilot", "baseline", "cheapfeed", "norecap", "tight", "lists", "strdark"]);
export const label = (g) => `${g.arena} g${g.gen}`;
export const clean = (g) => !g.contaminated;

// Evaluate flower programs offline on challenge lists (the same process wrapper the engine uses), cached by code+challenge.
const evalCacheFile = path.join(CACHE_DIR, "flower-eval.json");
let evalCache = fs.existsSync(evalCacheFile) ? JSON.parse(fs.readFileSync(evalCacheFile, "utf8")) : {};
export function saveEvalCache() { fs.writeFileSync(evalCacheFile, JSON.stringify(evalCache)); }

export async function evalFlower(config, code, kind, challenges, nTeams) {
  const key = md5(config.language + "|" + config.challengeType + "|" + config.responseType + "|" + config.maxLen + "|" + nTeams + "|" + code);
  const store = (evalCache[key] ||= {});
  const todo = [...new Map(challenges.map((c) => [K(c), c])).entries()].filter(([k]) => !(k in store));
  if (todo.length) {
    const cType = parseType(config.challengeType), rType = parseType(config.responseType);
    const proc = new ProgramProcess(config.language, "flower", { code, ms: Math.max(200, config.budgets[kind].ms * 4), game: gameInfo(config, nTeams) });
    try {
      const load = await proc.ready;
      for (const [k, c] of todo) {
        if (!load.ok) { store[k] = null; continue; }
        if (checkValue(cType, c, config.maxLen, "challenge")) { store[k] = null; continue; }
        const res = await proc.call({ c });
        if (res.e) store[k] = null;
        else store[k] = checkValue(rType, res.v, config.maxLen, "response") ? null : K(res.v);
      }
    } finally { proc.kill(); }
  }
  return challenges.map((c) => store[K(c)] ?? null);
}

/** run async tasks with a concurrency limit */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
