// Rooms, games, teams, programs and rounds: everything the API does, backed by Postgres.
import crypto from "node:crypto";
import { query, tx } from "./db/pool.js";
import { env } from "./config.js";
import { allocatePrefixLen, normalizeCode, shortId, uuidToCode } from "./lib/shortid.js";
import { DEFAULT_CONFIG, normalizeConfig, turnsFor } from "./lib/gameConfig.js";
import { changeDistance, measure } from "./lib/ast.js";
import { addLedgers, score, zeroLedger } from "./lib/scoring.js";
import { programInterface } from "./lib/interface.js";
import { KINDS, simulateRound, tryFlower } from "./engine.js";
import { exampleValue, parseType } from "./lib/types.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// Colour-blind-friendly hues (Okabe–Ito first, then Paul Tol's muted set); names are always shown too.
const TEAM_COLORS = ["#D55E00", "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#882255", "#117733",
  "#332288", "#DDCC77", "#44AA99", "#AA4499", "#999933", "#CC6677", "#88CCEE", "#6B4226"];

// ---------- realtime: every change bumps games.version and notifies listeners ----------

async function touch(client, gameId) {
  const { rows } = await client.query("UPDATE games SET version = version + 1 WHERE id = $1 RETURNING version, room_id", [gameId]);
  await client.query("SELECT pg_notify('dbc', $1)", [JSON.stringify({ game: gameId, room: rows[0].room_id, version: rows[0].version })]);
}

// ---------- rooms ----------

export async function createRoom(user) {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('dbc:rooms'))");
    const id = crypto.randomUUID(), code = uuidToCode(id);
    const prefixLen = await allocatePrefixLen(c, "rooms", code);
    const { rows } = await c.query("INSERT INTO rooms (id, code, prefix_len, owner_id) VALUES ($1, $2, $3, $4) RETURNING *", [id, code, prefixLen, user.id]);
    return roomSummary(rows[0], user);
  });
}

export async function findRoom(short) {
  const s = normalizeCode(short);
  if (!s) fail(404, "Room not found");
  const { rows } = await query("SELECT * FROM rooms WHERE code LIKE $1 AND prefix_len <= $2", [s + "%", s.length]);
  return rows[0] || fail(404, "Room not found");
}

function roomSummary(room, user) {
  const sid = shortId(room);
  return { id: room.id, shortId: sid, url: `/room/${sid}`, ownerId: room.owner_id, isOwner: !!user && user.id === room.owner_id, createdAt: room.created_at };
}

export async function viewRoom(room, user) {
  const owner = (await query("SELECT name FROM users WHERE id = $1", [room.owner_id])).rows[0];
  const { rows } = await query(
    `SELECT g.*, (SELECT count(*)::int FROM teams t WHERE t.game_id = g.id) AS team_count
       FROM games g WHERE g.room_id = $1 ORDER BY g.created_at`, [room.id]);
  return {
    ...roomSummary(room, user),
    ownerName: owner?.name,
    games: rows.map((g) => ({
      id: g.id, shortId: shortId(g), url: `/room/${shortId(room)}/game/${shortId(g)}`, status: g.status,
      roundsPlayed: g.rounds_played, rounds: g.config.rounds, teamCount: g.team_count, createdAt: g.created_at,
    })),
  };
}

/** Rooms this user owns or has played in (a team in one of its games), most recently active first. */
export async function myRooms(user) {
  const { rows } = await query(
    `SELECT r.*, u.name AS owner_name, a.game_count, GREATEST(r.created_at, a.last_game_at) AS last_activity
       FROM rooms r
       JOIN users u ON u.id = r.owner_id
       CROSS JOIN LATERAL (SELECT count(*)::int AS game_count, max(g.created_at) AS last_game_at FROM games g WHERE g.room_id = r.id) a
      WHERE r.owner_id = $1
         OR EXISTS (SELECT 1 FROM team_members m JOIN games g ON g.id = m.game_id WHERE g.room_id = r.id AND m.user_id = $1)
      ORDER BY last_activity DESC
      LIMIT 50`, [user.id]);
  return {
    rooms: rows.map((r) => ({ ...roomSummary(r, user), ownerName: r.owner_name, gameCount: r.game_count, lastActivity: r.last_activity })),
  };
}

// ---------- games ----------

export async function createGame(room, user, config) {
  if (room.owner_id !== user.id) fail(403, "Only the room owner can create games");
  const cfg = normalizeConfig(config || {});
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('dbc:games:' || $1))", [room.id]);
    const id = crypto.randomUUID(), code = uuidToCode(id);
    const prefixLen = await allocatePrefixLen(c, "games", code, { column: "room_id", value: room.id });
    const { rows } = await c.query("INSERT INTO games (id, room_id, code, prefix_len, config) VALUES ($1, $2, $3, $4, $5) RETURNING *", [id, room.id, code, prefixLen, cfg]);
    await touch(c, id);
    return { id, shortId: shortId(rows[0]), url: `/room/${shortId(room)}/game/${shortId(rows[0])}` };
  });
}

export async function findGame(room, short) {
  const s = normalizeCode(short);
  if (!s) fail(404, "Game not found");
  const { rows } = await query("SELECT * FROM games WHERE room_id = $1 AND code LIKE $2 AND prefix_len <= $3", [room.id, s + "%", s.length]);
  return rows[0] || fail(404, "Game not found");
}

export async function updateConfig(room, game, user, config) {
  if (room.owner_id !== user.id) fail(403, "Only the room owner can change settings");
  return tx(async (c) => {
    const g = (await c.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    if (g.rounds_played > 0 || g.running_round) fail(409, "Settings lock once round 1 has run");
    let cfg;
    try { cfg = normalizeConfig(config, g.config); } catch (e) { fail(400, e.message); }
    // Pending programs were checked against the old budgets/language; make teams re-submit.
    const changed = ["language", "challengeType", "responseType"].some((k) => cfg[k] !== g.config[k])
      || KINDS.some((k) => cfg.budgets[k].chars < g.config.budgets[k].chars);
    if (changed) await c.query("DELETE FROM submissions WHERE game_id = $1", [g.id]);
    await c.query("UPDATE games SET config = $2 WHERE id = $1", [g.id, cfg]);
    await touch(c, g.id);
    return { config: cfg, clearedSubmissions: changed };
  });
}

// ---------- teams ----------

async function myTeam(gameId, userId, client = { query }) {
  if (!userId) return null;
  const { rows } = await client.query(
    "SELECT t.* FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.game_id = $1 AND m.user_id = $2", [gameId, userId]);
  return rows[0] || null;
}

export async function createTeam(game, user, name) {
  const teamName = String(name || user.name).trim().replace(/\s+/g, " ").slice(0, 40);
  if (!teamName) fail(400, "Team name required");
  return tx(async (c) => {
    const g = (await c.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    if (g.rounds_played > 0 || g.running_round) fail(409, "This game has started; new teams can't join");
    if (await myTeam(g.id, user.id, c)) fail(409, "You are already on a team in this game");
    if ((await c.query("SELECT 1 FROM teams WHERE game_id = $1 AND lower(name) = lower($2)", [g.id, teamName])).rowCount) fail(409, "That team name is taken");
    const count = (await c.query("SELECT count(*)::int AS n FROM teams WHERE game_id = $1", [g.id])).rows[0].n;
    const id = crypto.randomUUID(), joinCode = crypto.randomBytes(4).toString("hex");
    await c.query("INSERT INTO teams (id, game_id, name, join_code, color, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, g.id, teamName, joinCode, TEAM_COLORS[count % TEAM_COLORS.length], user.id]);
    await c.query("INSERT INTO team_members (team_id, game_id, user_id) VALUES ($1, $2, $3)", [id, g.id, user.id]);
    await touch(c, g.id);
    return { id, name: teamName, joinCode };
  });
}

export async function joinTeam(game, user, joinCode) {
  return tx(async (c) => {
    const t = (await c.query("SELECT * FROM teams WHERE game_id = $1 AND join_code = $2", [game.id, String(joinCode || "").trim().toLowerCase()])).rows[0];
    if (!t) fail(404, "No team with that join code in this game");
    const mine = await myTeam(game.id, user.id, c);
    if (mine) { if (mine.id === t.id) return { id: t.id, name: t.name }; fail(409, "You are already on another team in this game"); }
    await c.query("INSERT INTO team_members (team_id, game_id, user_id) VALUES ($1, $2, $3)", [t.id, game.id, user.id]);
    await touch(c, game.id);
    return { id: t.id, name: t.name };
  });
}

// ---------- programs ----------

async function previousPrograms(gameId, teamId, roundNo, client = { query }) {
  const { rows } = await client.query("SELECT kind, code FROM round_programs WHERE game_id = $1 AND team_id = $2 AND round_no = $3", [gameId, teamId, roundNo]);
  return Object.fromEntries(rows.map((r) => [r.kind, r.code]));
}

/**
 * Measure a program against its complexity budget and (after round 1) its change budget.
 * chars is the complexity: the length of the automatically minified program, which is `minified`.
 */
export async function checkProgram(game, team, kind, code) {
  if (!KINDS.includes(kind)) fail(400, "kind must be clover, orchid or bee");
  if (typeof code !== "string") fail(400, "code must be a string");
  if (code.length > 100_000) fail(400, "Program is too long");
  const budget = game.config.budgets[kind];
  const errors = [];
  const { chars, minified, syntaxError } = await measure(game.config.language, code);
  if (syntaxError) errors.push("Syntax error");
  if (chars > budget.chars) {
    errors.push(`Too long: ${chars} characters after minifying > budget ${budget.chars} ` +
      "(comments, spacing and name lengths don't count; strings, numbers and keywords do)");
  }
  let distance = null, previous = null;
  if (game.rounds_played > 0) {
    previous = (await previousPrograms(game.id, team.id, game.rounds_played))[kind] ?? null;
    if (previous === null) errors.push("Your team isn't playing in this game (no programs in round 1)");
    else if (chars <= budget.chars * 4) {
      distance = await changeDistance(game.config.language, previous, code);
      if (distance > budget.changes) errors.push(`Too many changes: ${distance} edits > budget ${budget.changes}`);
    } else errors.push("Too complex to compare with last round");
  }
  return { ok: errors.length === 0, kind, chars, minified, distance, errors, budget };
}

export async function submitProgram(game, user, kind, code) {
  const team = await myTeam(game.id, user.id);
  if (!team) fail(403, "Join a team first");
  if (game.status === "finished") fail(409, "Game over");
  const check = await checkProgram(game, team, kind, code);
  if (!check.ok) return check;
  await tx(async (c) => {
    const g = (await c.query("SELECT rounds_played, running_round, status FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    if (g.running_round) fail(409, `Round ${g.running_round} is running; submit again when it finishes`);
    if (g.rounds_played !== game.rounds_played) fail(409, "A round just ran; check your program again");
    if (g.status === "finished") fail(409, "Game over");
    await c.query(
      `INSERT INTO submissions (game_id, team_id, kind, code, chars, distance, submitted_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (game_id, team_id, kind) DO UPDATE SET code = $4, chars = $5, distance = $6, submitted_by = $7, submitted_at = now()`,
      [game.id, team.id, kind, code, check.chars, check.distance, user.id]);
    await touch(c, game.id);
  });
  return { ...check, submitted: true };
}

/** A team's bee memories for rounds 1..beforeRound-1, in order (null where nothing was kept). */
async function memoriesOf(gameId, teamId, beforeRound, client = { query }) {
  const { rows } = await client.query("SELECT round_no, snapshot FROM bee_memories WHERE game_id = $1 AND team_id = $2 AND round_no < $3", [gameId, teamId, beforeRound]);
  return Array.from({ length: Math.max(0, beforeRound - 1) }, (_, i) => rows.find((r) => r.round_no === i + 1)?.snapshot ?? null);
}

/** Try a program without submitting it. Flowers: answer challenges. Bee: forage your own patch. */
export async function tryProgram(game, user, kind, code, challenges, flowers = {}) {
  const team = await myTeam(game.id, user.id);
  if (!team) fail(403, "Join a team first");
  if (!KINDS.includes(kind) || typeof code !== "string") fail(400, "kind and code required");
  const cfg = game.config;
  if (kind !== "bee") {
    const list = Array.isArray(challenges) && challenges.length ? challenges : [exampleValue(parseType(cfg.challengeType))];
    return tryFlower({ config: cfg, code, kind, challenges: list });
  }
  // The bee forages a garden of just your own two flowers: the ones passed in, else your latest
  // submissions, else last round's.
  const subs = (await query("SELECT kind, code FROM submissions WHERE game_id = $1 AND team_id = $2", [game.id, team.id])).rows;
  const prev = game.rounds_played ? await previousPrograms(game.id, team.id, game.rounds_played) : {};
  const pick = (k) => (typeof flowers?.[k] === "string" ? flowers[k] : null) ?? subs.find((s) => s.kind === k)?.code ?? prev[k];
  const clover = pick("clover"), orchid = pick("orchid");
  if (!clover || !orchid) fail(409, "Your bee needs flowers to visit: submit a clover and an orchid first (or pass them as flowers.clover / flowers.orchid)");
  // With your bee's real MEMORY from the rounds played so far. (A garden of 2 flowers is small, so the
  // try gets as many turns as one patch would get in the real game.)
  const memory = await memoriesOf(game.id, team.id, game.rounds_played + 1);
  const result = await simulateRound({ config: cfg, teams: [{ id: team.id, programs: { clover, orchid, bee: code }, memory }], seed: 1 });
  // Same shape as the game view: team ids, plus which of your flowers it was.
  const visits = result.visits.map((v) => ({ ...v, bee: team.id, patch: team.id, asks: v.steps.length, asksBeforeFeed: v.steps.filter((x) => !x.after).length }));
  return { visits, problems: result.problems[0], feeds: result.feeds[0][0], nectar: result.nectar[0][0], turns: result.turns, memory: result.memories[0] };
}

// ---------- rounds ----------

let running = 0;
const waiting = [];
async function slot() {
  if (running < env.maxConcurrentRounds) { running++; return; }
  await new Promise((r) => waiting.push(r));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

/** Locks in programs for the next round, then simulates it in the background. Returns { round, done }. */
/**
 * opts.seed: the owner may fix the round's seed (deck order, bee randomness), e.g. to replay the same
 * games with two cohorts of teams in a controlled experiment. Otherwise it's random.
 */
export async function startRound(room, game, user, opts = {}) {
  if (room.owner_id !== user.id) fail(403, "Only the room owner can run rounds");
  let fixedSeed = null;
  if (opts.seed !== undefined && opts.seed !== null) {
    fixedSeed = Number(opts.seed);
    if (!Number.isInteger(fixedSeed) || fixedSeed < 0 || fixedSeed >= 2 ** 31) fail(400, "seed must be an integer from 0 to 2^31-1");
  }
  const plan = await tx(async (c) => {
    const g = (await c.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    if (g.status === "finished") fail(409, "Game over");
    if (g.running_round) fail(409, `Round ${g.running_round} is already running`);
    const roundNo = g.rounds_played + 1;
    const subs = (await c.query("SELECT * FROM submissions WHERE game_id = $1", [g.id])).rows;
    let participants = g.participants;
    if (roundNo === 1) {
      const teams = (await c.query("SELECT id FROM teams WHERE game_id = $1 ORDER BY created_at, id", [g.id])).rows;
      participants = teams.map((t) => t.id).filter((id) => KINDS.every((k) => subs.some((s) => s.team_id === id && s.kind === k)));
      if (participants.length < 2) fail(409, "Need at least 2 teams that have submitted all three programs (clover, orchid, bee)");
    }
    const prev = roundNo > 1 ? (await c.query("SELECT * FROM round_programs WHERE game_id = $1 AND round_no = $2", [g.id, roundNo - 1])).rows : [];
    const programs = {};
    for (const teamId of participants) {
      programs[teamId] = {};
      for (const kind of KINDS) {
        const s = subs.find((x) => x.team_id === teamId && x.kind === kind);
        const p = prev.find((x) => x.team_id === teamId && x.kind === kind);
        const prog = s
          ? { code: s.code, distance: s.distance, carriedOver: false }
          : { code: p.code, distance: 0, carriedOver: true };
        // Measured again so stored sizes follow the current complexity rule, even for a program
        // checked or carried over from before a rule change (it still plays: budgets apply when submitting).
        programs[teamId][kind] = { ...prog, chars: (await measure(g.config.language, prog.code)).chars };
      }
    }
    await c.query("UPDATE games SET running_round = $2, participants = $3, status = 'running', last_error = NULL WHERE id = $1", [g.id, roundNo, participants]);
    await touch(c, g.id);
    return { roundNo, participants, programs, config: g.config, seed: fixedSeed ?? crypto.randomInt(0, 2 ** 31) };
  });
  const done = executeRound(game.id, plan).catch(async (e) => {
    console.error("round failed", game.id, e);
    await tx(async (c) => {
      await c.query("UPDATE games SET running_round = NULL, last_error = $2, status = CASE WHEN rounds_played = 0 THEN 'lobby' ELSE status END WHERE id = $1", [game.id, String(e.message || e)]);
      await touch(c, game.id);
    });
    throw e;
  });
  return { round: plan.roundNo, done };
}

async function executeRound(gameId, { roundNo, participants, programs, config, seed }) {
  const startedAt = new Date();
  await slot();
  let sim;
  try {
    const memory = await Promise.all(participants.map((id) => memoriesOf(gameId, id, roundNo)));
    sim = await simulateRound({ config, seed, teams: participants.map((id, i) => ({ id, programs: Object.fromEntries(KINDS.map((k) => [k, programs[id][k].code])), memory: memory[i] })) });
  } finally {
    release();
  }
  const ids = participants;
  await tx(async (c) => {
    // Cumulative ledgers: sum of every round so far.
    const cumulative = (await c.query("SELECT feeds, nectar FROM rounds WHERE game_id = $1", [gameId])).rows
      .reduce((acc, r) => ({ feeds: addLedgers(acc.feeds, r.feeds), nectar: addLedgers(acc.nectar, r.nectar) }), { feeds: zeroLedger(ids.length), nectar: zeroLedger(ids.length) });
    const totFeeds = addLedgers(cumulative.feeds, sim.feeds), totNectar = addLedgers(cumulative.nectar, sim.nectar);
    await c.query(
      "INSERT INTO rounds (game_id, round_no, seed, feeds, nectar, scores, totals, started_at, turns) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [gameId, roundNo, seed, JSON.stringify(sim.feeds), JSON.stringify(sim.nectar), JSON.stringify(score(ids, sim.feeds, sim.nectar)), JSON.stringify(score(ids, totFeeds, totNectar)), startedAt, sim.turns]);
    for (const [ti, teamId] of ids.entries()) {
      const m = sim.memories[ti];
      await c.query("INSERT INTO bee_memories (game_id, round_no, team_id, snapshot, bytes, note) VALUES ($1, $2, $3, $4, $5, $6)",
        [gameId, roundNo, teamId, m.snapshot, m.bytes, m.note]);
    }
    for (const [ti, teamId] of ids.entries()) {
      for (const kind of KINDS) {
        const p = programs[teamId][kind];
        await c.query(
          "INSERT INTO round_programs (game_id, round_no, team_id, kind, code, chars, distance, carried_over, problem, compute) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [gameId, roundNo, teamId, kind, p.code, p.chars, p.distance, p.carriedOver, sim.problems[ti][kind], kind === "bee" ? null : sim.compute[ti][kind]]);
      }
    }
    // Bulk insert visits in chunks.
    const cols = ["game_id", "round_no", "bee_team", "seq", "patch_team", "kind", "turn_start", "turn_end", "action", "nectar", "steps", "bee_error", "bee_log", "note"];
    for (let i = 0; i < sim.visits.length; i += 500) {
      const chunk = sim.visits.slice(i, i + 500);
      const params = [], rows = [];
      chunk.forEach((v, j) => {
        rows.push(`(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(",")})`);
        params.push(gameId, roundNo, ids[v.bee], v.seq, ids[v.patch], v.kind, v.start, v.end, v.action, v.nectar, JSON.stringify(v.steps), v.beeError ?? null, v.beeLog ?? null, v.note ?? null);
      });
      await c.query(`INSERT INTO visits (${cols.join(",")}) VALUES ${rows.join(",")}`, params);
    }
    await c.query("DELETE FROM submissions WHERE game_id = $1", [gameId]);
    await c.query(
      `UPDATE games SET rounds_played = $2, running_round = NULL,
         status = CASE WHEN $2 >= (config->>'rounds')::int THEN 'finished' ELSE 'running' END,
         finished_at = CASE WHEN $2 >= (config->>'rounds')::int THEN now() ELSE NULL END
       WHERE id = $1`, [gameId, roundNo]);
    await touch(c, gameId);
  });
  return { round: roundNo };
}

/** A server restart mid-round leaves running_round set; clear it so the owner can run it again. */
export async function recoverInterruptedRounds() {
  const { rows } = await query(
    `UPDATE games SET running_round = NULL, last_error = 'The server restarted while this round was running; run it again.',
       status = CASE WHEN rounds_played = 0 THEN 'lobby' ELSE status END
     WHERE running_round IS NOT NULL RETURNING id`);
  return rows.length;
}

// ---------- the view: everything a given viewer may see, live or later, identically ----------

/**
 * opts.visits: "all" (default) includes every round's visits; "last" only the latest round's; "none"
 * none (fetch rounds one at a time with roundView). Games now have thousands of visits per round.
 */
export async function viewGame(room, game, user, opts = {}) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const cfg = g.config;
  const mine = await myTeam(g.id, user?.id);
  const isOwner = !!user && user.id === room.owner_id;
  const revealed = g.status === "finished" && cfg.revealOnFinish;
  const teams = (await query("SELECT * FROM teams WHERE game_id = $1 ORDER BY created_at, id", [g.id])).rows;
  const members = (await query("SELECT m.team_id, u.id, u.name FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.game_id = $1 ORDER BY m.joined_at", [g.id])).rows;
  const subs = (await query("SELECT s.*, u.name AS submitted_by_name FROM submissions s JOIN users u ON u.id = s.submitted_by WHERE s.game_id = $1", [g.id])).rows;
  const rounds = (await query("SELECT * FROM rounds WHERE game_id = $1 ORDER BY round_no", [g.id])).rows;
  const progs = (await query("SELECT * FROM round_programs WHERE game_id = $1 ORDER BY round_no", [g.id])).rows;
  const which = opts.visits || "all";
  const visitRounds = which === "none" ? [] : which === "last" ? rounds.slice(-1).map((r) => r.round_no) : rounds.map((r) => r.round_no);
  const visits = visitRounds.length
    ? (await query("SELECT * FROM visits WHERE game_id = $1 AND round_no = ANY($2) ORDER BY round_no, bee_team, seq", [g.id, visitRounds])).rows
    : [];
  const mems = (await query("SELECT round_no, team_id, bytes, note FROM bee_memories WHERE game_id = $1", [g.id])).rows;
  const participants = g.participants || null;
  const ctx = { cfg, mine, revealed, participants, progs, mems };

  const latestProg = {};
  for (const p of progs) (latestProg[p.team_id] ||= {})[p.kind] = p;

  return {
    room: { id: room.id, shortId: shortId(room), url: `/room/${shortId(room)}`, isOwner },
    game: {
      id: g.id, shortId: shortId(g), url: `/room/${shortId(room)}/game/${shortId(g)}`, status: g.status, config: cfg,
      roundsPlayed: g.rounds_played, runningRound: g.running_round, lastError: g.last_error, version: g.version,
      createdAt: g.created_at, finishedAt: g.finished_at, revealed, isOwner,
      // Turns per bee in the next round (depends on how many teams play).
      turns: turnsFor(cfg, participants ? participants.length : teams.length),
    },
    me: user ? { id: user.id, name: user.name, teamId: mine?.id ?? null } : null,
    participants,
    teams: teams.map((t) => ({
      id: t.id, name: t.name, color: t.color,
      members: members.filter((m) => m.team_id === t.id).map((m) => m.name),
      participant: participants ? participants.includes(t.id) : null,
      // Which programs are pending for the next round (no code: just whether they've submitted).
      submitted: Object.fromEntries(KINDS.map((k) => [k, subs.some((s) => s.team_id === t.id && s.kind === k)])),
    })),
    myTeam: mine ? {
      id: mine.id, name: mine.name, joinCode: mine.join_code,
      drafts: Object.fromEntries(subs.filter((s) => s.team_id === mine.id).map((s) => [s.kind, {
        code: s.code, chars: s.chars, distance: s.distance, submittedAt: s.submitted_at, submittedBy: s.submitted_by_name,
      }])),
      previous: Object.fromEntries(KINDS.filter((k) => latestProg[mine.id]?.[k]).map((k) => [k, latestProg[mine.id][k].code])),
    } : null,
    interface: programInterface(cfg),
    rounds: rounds.map((r) => roundViewOf(r, visits.filter((v) => v.round_no === r.round_no), ctx, visitRounds.includes(r.round_no))),
    final: g.status === "finished" && rounds.length ? rounds[rounds.length - 1].totals : null,
  };
}

function roundViewOf(r, visits, { cfg, mine, revealed, participants, progs, mems }, withVisits = true) {
  const canSeeTeam = (teamId) => revealed || (mine && mine.id === teamId);
  return {
    no: r.round_no, startedAt: r.started_at, finishedAt: r.finished_at,
    turns: r.turns ?? cfg.turns ?? 100,
    feeds: r.feeds, nectar: r.nectar, scores: r.scores, totals: r.totals,
    programs: Object.fromEntries((participants || []).map((teamId) => [teamId, Object.fromEntries(KINDS.map((kind) => {
      const p = progs.find((x) => x.round_no === r.round_no && x.team_id === teamId && x.kind === kind);
      if (!p) return [kind, null];
      const own = canSeeTeam(teamId);
      return [kind, { chars: p.chars, distance: p.distance, carriedOver: p.carried_over, ...(own ? { code: p.code, problem: p.problem, compute: p.compute } : {}) }];
    }))])),
    // Size of what each bee kept for later rounds (your own team's, or everyone's once revealed).
    memory: Object.fromEntries(mems.filter((m) => m.round_no === r.round_no && canSeeTeam(m.team_id)).map((m) => [m.team_id, { bytes: m.bytes, note: m.note }])),
    ...(withVisits ? { visits: visits.map((v) => visitView(v, mine?.id, revealed, cfg.flowerLogs)) } : {}),
  };
}

/** One round, with its visits, filtered for this viewer. */
export async function roundView(room, game, user, roundNo) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const r = (await query("SELECT * FROM rounds WHERE game_id = $1 AND round_no = $2", [g.id, roundNo])).rows[0];
  if (!r) fail(404, "No such round");
  const mine = await myTeam(g.id, user?.id);
  const progs = (await query("SELECT * FROM round_programs WHERE game_id = $1 AND round_no = $2", [g.id, roundNo])).rows;
  const visits = (await query("SELECT * FROM visits WHERE game_id = $1 AND round_no = $2 ORDER BY bee_team, seq", [g.id, roundNo])).rows;
  const mems = (await query("SELECT round_no, team_id, bytes, note FROM bee_memories WHERE game_id = $1 AND round_no = $2", [g.id, roundNo])).rows;
  const revealed = g.status === "finished" && g.config.revealOnFinish;
  return roundViewOf(r, visits, { cfg: g.config, mine, revealed, participants: g.participants || [], progs, mems });
}

/** What a team's bee kept at the end of a round (the serialised MEMORY entry). Own team, or revealed games. */
export async function beeMemory(game, user, roundNo, teamId) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const mine = await myTeam(g.id, user?.id);
  const revealed = g.status === "finished" && g.config.revealOnFinish;
  const team = teamId || mine?.id;
  if (!team) fail(403, "Join a team first");
  if (!revealed && team !== mine?.id) fail(403, "You can only see your own bee's memory until the game is revealed");
  const m = (await query("SELECT * FROM bee_memories WHERE game_id = $1 AND round_no = $2 AND team_id = $3", [g.id, roundNo, team])).rows[0];
  if (!m) fail(404, "No memory for that round");
  return { round: roundNo, teamId: team, language: g.config.language, snapshot: m.snapshot, bytes: m.bytes, note: m.note };
}

function visitView(v, myTeamId, revealed, flowerLogs) {
  const asksBeforeFeed = v.action === "feed" ? v.steps.filter((s) => !s.after).length : v.steps.length;
  const out = {
    bee: v.bee_team, patch: v.patch_team, seq: v.seq, start: v.turn_start, end: v.turn_end,
    asks: v.steps.length, asksBeforeFeed, action: v.action, nectar: v.nectar,
  };
  const isBee = revealed || v.bee_team === myTeamId;
  const isPatch = revealed || v.patch_team === myTeamId;
  const keep = (s) => (s.after ? { after: true } : {});
  if (isPatch) out.kind = v.kind;
  if (isBee) {
    // Your bee saw challenges and responses, but not why another team's flower failed.
    out.steps = v.steps.map((s) => (revealed ? s : { c: s.c, r: s.r, ...keep(s), ...(s.challengeError ? { challengeError: s.challengeError } : {}) }));
    if (v.bee_error) out.beeError = v.bee_error;
    if (v.bee_log) out.beeLog = v.bee_log;
    if (v.note) out.note = v.note;
  } else if (isPatch && flowerLogs) {
    out.steps = v.steps.map((s) => ({ c: s.c, r: s.r, ...keep(s), ...(s.flowerError ? { flowerError: s.flowerError } : {}) }));
  }
  if (isPatch && !isBee && v.steps.some((s) => s.flowerError)) out.flowerError = v.steps.find((s) => s.flowerError).flowerError;
  return out;
}

export { DEFAULT_CONFIG };
