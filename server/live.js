// Runs the gardens of running games. Each game's garden runs in exactly one server process, whichever
// holds the game's advisory lock; every process adopts running games nobody holds (on boot, on any change
// to the game, and every few seconds), so a game survives its process dying (its bees start afresh, and
// the rounds carry on from the stored round, clock, turn counts, sit-outs and bees' MEMORY). Live gardens
// are paced: a round lasts at least its 200 ms of game time on the wall clock.
// Every FLUSH_MS the garden's new actions, round, clock, ledgers and changed memories are written and
// announced (a response over INLINE_BYTES into `responses`, its action keeping its size, hash and preview);
// arrivals are written at once. Submissions,
// pauses and finishes are written to the database by whichever process got the request; the change
// notification brings them here, and new programs go live at once.
import pg from "pg";
import { env } from "./config.js";
import { query, tx } from "./db/pool.js";
import { Garden, KINDS } from "./engine.js";
import { shortId } from "./lib/shortid.js";
import { zeroLedger } from "./lib/scoring.js";
import { bus } from "./realtime.js";

const FLUSH_MS = 250;
const SWEEP_MS = 5000;
const runs = new Map();   // game id -> { garden, index, versions, timer, ... }
const queues = new Map(); // game id -> promise: syncs of one game run one at a time
let locks = null;         // the connection holding this process's game locks

const lockKey = (gameId) => `dbc:garden:${gameId}`;

export async function startLive() {
  await connectLocks();
  bus.on("change", (c) => { if (c.game && (c.version !== undefined || c.programs)) sync(c.game); });
  setInterval(sweep, SWEEP_MS).unref();
  await sweep();
}

async function connectLocks() {
  locks = new pg.Client({ connectionString: env.databaseUrl });
  locks.on("error", (e) => {
    // Our locks went with the connection: someone else may adopt these games now, so let them go.
    console.error("garden lock connection lost:", e.message);
    locks = null;
    for (const run of runs.values()) abandon(run);
    setTimeout(() => connectLocks().then(sweep).catch(() => {}), 2000);
  });
  await locks.connect();
}

async function sweep() {
  try {
    const { rows } = await query("SELECT id FROM games WHERE status IN ('running', 'paused')");
    for (const r of rows) if (!runs.has(r.id)) sync(r.id);
  } catch (e) {
    console.error("garden sweep failed:", e.message);
  }
}

/** Bring this process's view of one game in line with the database. */
export function sync(gameId) {
  const next = (queues.get(gameId) || Promise.resolve()).then(() => syncNow(gameId)).catch((e) => console.error("garden sync", gameId, e));
  queues.set(gameId, next);
  next.finally(() => { if (queues.get(gameId) === next) queues.delete(gameId); });
  return next;
}

async function syncNow(gameId) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [gameId])).rows[0];
  let run = runs.get(gameId);
  if (!g) { if (run) abandon(run); return; }
  if (!run) {
    if (g.status !== "running" && g.status !== "paused") return;
    if (!locks) return;
    const got = (await locks.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [lockKey(gameId)])).rows[0].ok;
    if (!got) return;
    // Read again under the lock: another process may have flushed or finished it meanwhile.
    const fresh = (await query("SELECT * FROM games WHERE id = $1", [gameId])).rows[0];
    if (fresh.status !== "running" && fresh.status !== "paused") { await unlock(gameId); return; }
    run = await adopt(fresh);
  }
  if (g.status === "finished") { await run.garden.stop(); return; }
  await loadPrograms(run);
  if (g.status === "paused") run.garden.pause(); else run.garden.resume();
}

async function adopt(g) {
  const index = new Map(g.participants.map((id, i) => [id, i]));
  // Each bee's last feed (it may still be sitting it out), its turn count, and its MEMORY.
  const lastFed = new Array(g.participants.length).fill(null);
  for (const r of (await query("SELECT bee_team, max(round) AS round FROM actions WHERE game_id = $1 AND action = 'feed' GROUP BY bee_team", [g.id])).rows) {
    if (index.has(r.bee_team)) lastFed[index.get(r.bee_team)] = Number(r.round);
  }
  const memories = new Array(g.participants.length).fill(null);
  for (const m of (await query("SELECT * FROM bee_memories WHERE game_id = $1", [g.id])).rows) {
    if (index.has(m.team_id)) memories[index.get(m.team_id)] = { version: m.bee_version, memory: m.memory, error: m.error };
  }
  const game = shortId(g);
  const turns = new Array(g.participants.length).fill(0);
  for (const r of (await query("SELECT bee_team, max(turn) AS n FROM actions WHERE game_id = $1 GROUP BY bee_team", [g.id])).rows) {
    if (index.has(r.bee_team)) turns[index.get(r.bee_team)] = Number(r.n);
  }
  const garden = new Garden({
    config: g.config, teams: g.participants.length, clockMs: Number(g.clock_ms), round: Number(g.round), lastSeq: Number(g.last_seq),
    ledgers: { feeds: g.feeds, nectar: g.nectar, pollen: g.pollen ?? zeroLedger(g.participants.length) },
    lastFed, turns, memories, game, paced: true,
  });
  if (g.status === "paused") garden.pause();
  const run = { id: g.id, room: g.room_id, participants: g.participants, index, garden, versions: new Map(), flushing: null, again: false, abandoned: false };
  runs.set(g.id, run);
  // Which flower each bee is at is news: write arrivals at once rather than at the next tick.
  garden.onArrive = () => flushSoon(run);
  run.timer = setInterval(() => flush(run).catch((e) => console.error("garden flush", g.id, e.message)), FLUSH_MS);
  garden.run().then(() => ended(run), (e) => { console.error("garden crashed", g.id, e); return ended(run, e); });
  return run;
}

/** Put the latest version of every program in play. */
async function loadPrograms(run) {
  const { rows } = await query(
    `SELECT DISTINCT ON (team_id, kind) team_id, kind, version, code FROM programs
      WHERE game_id = $1 ORDER BY team_id, kind, version DESC`, [run.id]);
  for (const p of rows) {
    const ti = run.index.get(p.team_id);
    if (ti === undefined || !KINDS.includes(p.kind)) continue;
    const key = `${ti}:${p.kind}`;
    if (run.versions.get(key) === p.version) continue;
    run.versions.set(key, p.version);
    await run.garden.setProgram(ti, p.kind, p.code, p.version);
  }
}

const ACTION_COLUMNS = ["game_id", "seq", "at_ms", "round", "turn", "bee_team", "flower_team", "action", "c", "r", "percent", "energy",
  "cpu_ms", "pollen", "flower_error", "nectar", "bee_ms", "bee_error", "log", "bee_version", "flower_version", "r_bytes", "r_hash", "r_preview",
  "grain", "grain_version", "grain_code_length", "budget_ms"];
const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

/**
 * Write a garden's actions (team indices → ids). A response over INLINE_BYTES (`rFull`, its JSON text) goes
 * to `responses`; its action keeps r = null with the size, hash and preview.
 */
export async function insertActions(c, gameId, actions, ids) {
  const cols = ACTION_COLUMNS;
  for (let i = 0; i < actions.length; i += 300) {
    const chunk = actions.slice(i, i + 300), params = [], rows = [];
    chunk.forEach((a, j) => {
      rows.push(`(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(",")})`);
      const end = a.action !== "arrive";
      params.push(gameId, a.seq, a.atMs, a.round, a.turn, ids[a.bee], ids[a.flower], a.action, end ? json(a.c) : null, end ? json(a.r) : null,
        a.percent, a.energy, a.ms, a.pollen, a.flowerError, a.nectar, a.beeMs, a.beeError, a.log, a.beeVersion, a.flowerVersion,
        end ? a.rBytes ?? null : null, a.rHash ?? null, a.rPreview ?? null, a.grain ?? null, a.grainVersion ?? null, a.grainCodeLength ?? null, end ? a.budgetMs ?? null : null);
    });
    await c.query(`INSERT INTO actions (${cols.join(",")}) VALUES ${rows.join(",")}`, params);
  }
  // Big responses, a few to a statement (each can be a megabyte).
  const big = actions.filter((a) => a.rFull !== undefined);
  for (let i = 0; i < big.length; i += 8) {
    const chunk = big.slice(i, i + 8), params = [];
    const rows = chunk.map((a, j) => {
      params.push(gameId, a.seq, a.rBytes, a.rHash, a.rFull);
      return `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`;
    });
    await c.query(`INSERT INTO responses (game_id, seq, bytes, sha256, body) VALUES ${rows.join(",")}`, params);
  }
}

/** Flush now, or as soon as the flush in progress is done. */
function flushSoon(run) {
  if (run.abandoned) return;
  if (run.flushing) { run.again = true; return; }
  flush(run).catch((e) => console.error("garden flush", run.id, e.message));
}

async function flush(run) {
  if (run.flushing) return run.flushing;
  run.flushing = (async () => {
    const d = run.garden.drain();
    if (!d.actions.length && !d.problems.length && !d.memories.length && d.clockMs === run.lastClock) return;
    const ids = run.participants;
    try {
      await tx(async (c) => {
        await insertActions(c, run.id, d.actions, ids);
        await c.query("UPDATE games SET clock_ms = $2, round = $3, last_seq = $4, feeds = $5, nectar = $6, pollen = $7 WHERE id = $1",
          [run.id, d.clockMs, d.round, d.lastSeq, JSON.stringify(d.feeds), JSON.stringify(d.nectar), JSON.stringify(d.pollen)]);
        for (const m of d.memories) {
          await c.query(
            `INSERT INTO bee_memories (game_id, team_id, bee_version, memory, bytes, error, at_round) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (game_id, team_id) DO UPDATE SET bee_version = $3, memory = $4, bytes = $5, error = $6, at_round = $7`,
            [run.id, ids[m.team], m.version, m.memory, m.bytes, m.error, d.round]);
        }
        for (const p of d.problems) {
          await c.query("UPDATE programs SET problem = COALESCE(problem, $5) WHERE game_id = $1 AND team_id = $2 AND kind = $3 AND version = $4",
            [run.id, ids[p.team], p.kind, p.version, p.error]);
        }
        // A program's problems are its team's business until the game is over.
        for (const team of new Set(d.problems.map((p) => ids[p.team]))) {
          await c.query("SELECT pg_notify('dbc', $1)", [JSON.stringify({ game: run.id, team, programs: true })]);
        }
        await c.query("SELECT pg_notify('dbc', $1)", [JSON.stringify({ game: run.id, seq: d.lastSeq, clockMs: d.clockMs })]);
      });
      run.lastClock = d.clockMs;
    } catch (e) {
      // Put them back for the next flush.
      run.garden.out.unshift(...d.actions);
      run.garden.problems.unshift(...d.problems);
      for (const m of d.memories) run.garden.bees[m.team].memoryChanged = true;
      throw e;
    }
  })().finally(() => {
    run.flushing = null;
    if (run.again) { run.again = false; flushSoon(run); }
  });
  return run.flushing;
}

/** The garden stopped: the clock ran out, the owner finished it, or we let it go. */
async function ended(run, error = null) {
  clearInterval(run.timer);
  if (run.abandoned) return;
  try {
    await run.flushing;
    await flush(run);
    await tx(async (c) => {
      // A crash pauses the game for the owner to resume; otherwise it's over.
      const { rows } = error
        ? await c.query("UPDATE games SET status = 'paused', last_error = $2 WHERE id = $1 RETURNING room_id", [run.id, String(error.message || error)])
        : await c.query("UPDATE games SET status = 'finished', finished_at = COALESCE(finished_at, now()) WHERE id = $1 RETURNING room_id", [run.id]);
      const v = (await c.query("UPDATE games SET version = version + 1 WHERE id = $1 RETURNING version", [run.id])).rows[0].version;
      await c.query("SELECT pg_notify('dbc', $1)", [JSON.stringify({ game: run.id, room: rows[0].room_id, version: v })]);
    });
  } finally {
    runs.delete(run.id);
    await unlock(run.id);
  }
}

function abandon(run) {
  run.abandoned = true;
  clearInterval(run.timer);
  runs.delete(run.id);
  run.garden.stop().catch(() => {});
}

async function unlock(gameId) {
  try { if (locks) await locks.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey(gameId)]); } catch {}
}

/** Stop every garden this process runs, writing what they did (for a clean shutdown). */
export async function stopLive() {
  for (const run of [...runs.values()]) {
    run.abandoned = true;
    clearInterval(run.timer);
    await run.garden.stop();
    await flush(run).catch(() => {});
    runs.delete(run.id);
    await unlock(run.id);
  }
}
