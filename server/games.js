// Rooms, games, teams and programs: everything the API does, backed by Postgres. The gardens themselves
// run in live.js; this module writes what they should run and reads what they did.
import crypto from "node:crypto";
import { query, tx } from "./db/pool.js";
import { allocatePrefixLen, normalizeCode, shortId, uuidToCode } from "./lib/shortid.js";
import { DEFAULT_CONFIG, KINDS, available, normalizeConfig } from "./lib/gameConfig.js";
import { changes, size } from "./lib/measure.js";
import { score, scoringOf, zeroLedger } from "./lib/scoring.js";
import { programInterface } from "./lib/interface.js";
import { ruleBreaches } from "./lib/pyRules.js";
import { canonicalJson, memoryShapeError, memorySize, tryBee, tryFlower } from "./engine.js";
import { exampleValue, parseType } from "./lib/types.js";
import { mask } from "./query/mask.js";
import { runQuery } from "./query/sql.js";
import { SCHEMA } from "./query/schema.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// Colour-blind-friendly hues (Okabe–Ito first, then Paul Tol's muted set); names are always shown too.
const TEAM_COLORS = ["#D55E00", "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#882255", "#117733",
  "#332288", "#DDCC77", "#44AA99", "#AA4499", "#999933", "#CC6677", "#88CCEE", "#6B4226"];

// ---------- realtime: every change but an action bumps games.version and notifies listeners ----------

async function touch(client, gameId) {
  const { rows } = await client.query("UPDATE games SET version = version + 1 WHERE id = $1 RETURNING version, room_id", [gameId]);
  await client.query("SELECT pg_notify('dbc', $1)", [JSON.stringify({ game: gameId, room: rows[0].room_id, version: rows[0].version })]);
}

// A team's programs changed. Other teams mustn't learn even that much while the game runs, so this
// doesn't bump the public version: the garden (live.js) and the team's own viewers hear about it.
async function touchPrograms(client, gameId, teamId) {
  await client.query("SELECT pg_notify('dbc', $1)", [JSON.stringify({ game: gameId, team: teamId, programs: true })]);
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
      clockMs: g.clock_ms, endMs: Math.round(g.config.minutes * 60000), teamCount: g.team_count, createdAt: g.created_at,
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
  let cfg;
  try { cfg = normalizeConfig(config || {}); } catch (e) { fail(400, e.message); }
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
    if (g.status !== "lobby") fail(409, "Settings lock once the game starts");
    let cfg;
    try { cfg = normalizeConfig(config, g.config); } catch (e) { fail(400, e.message); }
    // Programs were checked against the old budgets/language; make teams write them again.
    const changed = ["language", "challengeType", "responseType"].some((k) => cfg[k] !== g.config[k])
      || KINDS.some((k) => cfg.budgets[k].size < g.config.budgets[k].size);
    if (changed) await c.query("DELETE FROM programs WHERE game_id = $1", [g.id]);
    await c.query("UPDATE games SET config = $2 WHERE id = $1", [g.id, cfg]);
    await touch(c, g.id);
    return { config: cfg, clearedPrograms: changed };
  });
}

/** The owner starts the garden: teams with both programs play; the clock and change budgets start. */
export async function startGame(room, game, user) {
  if (room.owner_id !== user.id) fail(403, "Only the room owner can start the game");
  return tx(async (c) => {
    const g = (await c.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    if (g.status !== "lobby") fail(409, "The game has already started");
    const teams = (await c.query("SELECT id FROM teams WHERE game_id = $1 ORDER BY created_at, id", [g.id])).rows;
    const have = (await c.query("SELECT DISTINCT team_id, kind FROM programs WHERE game_id = $1", [g.id])).rows;
    const participants = teams.map((t) => t.id).filter((id) => KINDS.every((k) => have.some((p) => p.team_id === id && p.kind === k)));
    if (participants.length < 2) fail(409, "Need at least 2 teams that have written both programs (flower and bee)");
    const zero = JSON.stringify(zeroLedger(participants.length));
    await c.query(
      `UPDATE games SET status = 'running', participants = $2, feeds = $3, nectar = $3, pollen = $3, clock_ms = 0, round = 0,
              started_at = now(), last_error = NULL
        WHERE id = $1`, [g.id, participants, zero]);
    for (const teamId of participants) for (const kind of KINDS) {
      await c.query("INSERT INTO banks (game_id, team_id, kind, bank, at_ms) VALUES ($1, $2, $3, 0, 0)", [g.id, teamId, kind]);
    }
    await touch(c, g.id);
    return { status: "running", participants };
  });
}

/** Pause, resume or finish a game early (the owner). The garden's clock and change budgets stop while paused. */
export async function setStatus(room, game, user, action) {
  if (room.owner_id !== user.id) fail(403, "Only the room owner can do that");
  const to = { pause: "paused", resume: "running", finish: "finished" }[action];
  if (!to) fail(400, "action must be pause, resume or finish");
  return tx(async (c) => {
    const g = (await c.query("SELECT status FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    const from = { pause: ["running"], resume: ["paused"], finish: ["running", "paused"] }[action];
    if (!from.includes(g.status)) fail(409, `Can't ${action} a game that is ${g.status}`);
    await c.query(`UPDATE games SET status = $2, finished_at = CASE WHEN $2 = 'finished' THEN now() ELSE finished_at END WHERE id = $1`, [game.id, to]);
    await touch(c, game.id);
    return { status: to };
  });
}

// ---------- teams ----------

/** The viewer's team id in this game, or null. */
export async function myTeamId(game, user) {
  return (await myTeam(game.id, user?.id))?.id ?? null;
}

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
    if (g.status !== "lobby") fail(409, "This game has started; new teams can't join");
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

async function latestProgram(client, gameId, teamId, kind) {
  const { rows } = await client.query(
    "SELECT * FROM programs WHERE game_id = $1 AND team_id = $2 AND kind = $3 ORDER BY version DESC LIMIT 1", [gameId, teamId, kind]);
  return rows[0] || null;
}


/**
 * Measure a program against its size budget and, once the game is running, its change budget. Size is
 * weighted nodes of the minified program; the cost of a change is the node edits from the program now
 * playing (renaming is free). In the lobby, writing programs is free.
 */
async function measure(client, g, team, kind, code) {
  if (!KINDS.includes(kind)) fail(400, "kind must be flower or bee");
  if (typeof code !== "string") fail(400, "code must be a string");
  if (code.length > 100_000) fail(400, "Program is too long");
  const budget = g.config.budgets[kind];
  const errors = [];
  const { size: measured, minified, syntaxError } = await size(g.config.language, code);
  if (syntaxError) errors.push("Syntax error");
  else {
    const missing = entryPoints(kind).filter((name) => !defines(g.config.language, name, minified));
    if (missing.length) {
      errors.push(kind === "bee" ? "A bee must define first() and decide(challenge, response)" : "A flower must define flower(challenge)");
    }
    errors.push(...(await ruleBreaches(g.config.language, code)));
  }
  if (measured > budget.size) {
    errors.push(`Too big: ${measured} nodes > budget ${budget.size} (comments, spacing, types and name lengths don't count; every byte of a string or number does)`);
  }
  const out = { kind, size: measured, minified, budget, distance: null, cost: 0, available: null };
  if (g.status === "finished") errors.push("Game over");
  else if (g.status !== "lobby") {
    if (!(g.participants || []).includes(team.id)) errors.push("Your team isn't playing in this game (it hadn't written both programs when the game started)");
    else {
      const current = await latestProgram(client, g.id, team.id, kind);
      const bank = (await client.query("SELECT bank, at_ms FROM banks WHERE game_id = $1 AND team_id = $2 AND kind = $3", [g.id, team.id, kind])).rows[0];
      out.exact = available(budget, { bank: bank.bank, atMs: bank.at_ms }, g.clock_ms);
      out.available = Math.floor(out.exact);
      if (measured > budget.size * 4) errors.push("Too long to compare with the program playing now");
      else {
        out.distance = await changes(g.config.language, current?.code ?? "", code);
        out.cost = out.distance;
        if (out.cost > out.available) {
          const wait = budget.perMinute > 0 && out.cost <= budget.cap ? Math.ceil(((out.cost - out.available) * 60) / budget.perMinute) : null;
          errors.push(`Not enough change budget: this change costs ${out.cost} nodes and your ${kind} has ${out.available} ` +
            `(it earns ${budget.perMinute} a minute, banking up to ${budget.cap}). ` +
            (wait !== null ? `Enough in about ${wait} s of game time.` : "It can never afford a change this big: make it smaller."));
        }
      }
    }
  }
  return { ok: errors.length === 0, ...out, errors };
}
const shown = ({ exact, ...check }) => check;

const entryPoints = (kind) => (kind === "bee" ? ["first", "decide"] : ["flower"]);

/** Does the (minified) program define `name` at the top level? The game looks it up by name. */
function defines(language, name, minified) {
  return language === "typescript"
    ? new RegExp(`(^|[;}\\s])(function\\s*\\*?\\s*${name}\\s*\\(|(const|let|var)\\s+${name}\\s*=)`).test(minified)
    : new RegExp(`^(def ${name}\\(|${name}\\s*=)`, "m").test(minified);
}

/** Check a program without submitting it: its size, and what it would cost now. */
export async function checkProgram(game, user, kind, code) {
  const team = await myTeam(game.id, user.id);
  if (!team) fail(403, "Join a team first");
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  return shown(await measure({ query }, g, team, kind, code));
}

/** Submit a program. Once the game runs, it pays for its change and goes live at once. */
export async function submitProgram(game, user, kind, code) {
  const team = await myTeam(game.id, user.id);
  if (!team) fail(403, "Join a team first");
  return tx(async (c) => {
    // Lock the game row so the clock read and the bank update see one consistent moment.
    const g = (await c.query("SELECT * FROM games WHERE id = $1 FOR UPDATE", [game.id])).rows[0];
    const check = await measure(c, g, team, kind, code);
    if (!check.ok) return shown(check);
    const prev = await latestProgram(c, g.id, team.id, kind);
    const version = (prev?.version ?? 0) + 1;
    const live = g.status !== "lobby";
    await c.query(
      `INSERT INTO programs (game_id, team_id, kind, version, code, size, distance, cost, at_ms, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [g.id, team.id, kind, version, code, check.size, check.distance, check.cost, live ? g.clock_ms : 0, user.id]);
    if (live) {
      await c.query("UPDATE banks SET bank = $4, at_ms = $5 WHERE game_id = $1 AND team_id = $2 AND kind = $3",
        [g.id, team.id, kind, check.exact - check.cost, g.clock_ms]);
      await touchPrograms(c, g.id, team.id);
    } else await touch(c, g.id); // the lobby shows who has written what
    return { ...shown(check), submitted: true, version, atMs: live ? g.clock_ms : 0, available: live ? Math.floor(check.exact - check.cost) : null };
  });
}

/** Try a program without submitting it. A flower answers challenges; a bee forages a garden of your own flower. */
export async function tryProgram(game, user, { kind, code, challenges, budgetMs, flower, rounds, memory } = {}) {
  const team = await myTeam(game.id, user.id);
  if (!team) fail(403, "Join a team first");
  if (!KINDS.includes(kind) || typeof code !== "string") fail(400, "kind (flower or bee) and code required");
  const cfg = game.config;
  if (kind === "flower") {
    const list = Array.isArray(challenges) && challenges.length ? challenges : [exampleValue(parseType(cfg.challengeType))];
    // R per challenge: a number, "random" (drawn as in a game; the default) or one per challenge.
    const valid = (b) => b === "random" || (typeof b === "number" && Number.isFinite(b));
    if (budgetMs !== undefined && budgetMs !== null && !(valid(budgetMs) || (Array.isArray(budgetMs) && budgetMs.every(valid)))) {
      fail(400, 'budgetMs must be a number, "random", or a list of them (one per challenge)');
    }
    return tryFlower({ config: cfg, code, challenges: list, budgetMs: budgetMs ?? "random" });
  }
  const own = typeof flower === "string" ? flower : (await latestProgram({ query }, game.id, team.id, "flower"))?.code;
  if (!own) fail(409, "Your bee needs a flower to visit: write your flower first (or pass one as `flower`)");
  const n = Math.max(1, Math.min(1000, Number(rounds) || 300));
  // The test bee's MEMORY to start with: a local simulation only (a game's bee memory has no write path).
  if (memory !== undefined && memory !== null) {
    const bad = memoryShapeError(memory);
    if (bad) fail(400, bad.replace(/^MEMORY/, "memory"));
    const bytes = memorySize(memory);
    if (bytes > cfg.budgets.bee.memory) fail(400, `memory is ${bytes} bytes, over the cap of ${cfg.budgets.bee.memory}`);
  }
  const result = await tryBee({ config: cfg, programs: { flower: own, bee: code }, rounds: n, memory: memory ?? {} });
  return { ...result, actions: result.actions.map((a) => ({ ...a, bee: team.id, flower: team.id })) };
}

// ---------- the views: everything a given viewer may see, live or later ----------
//
// During play, everyone (spectators included) sees every turn's arrival, challenge, response and whether
// the bee fed; on a feed also its percent, energy, nectar and pollen; and the live scoreboard and
// ledgers. Private until the game is over:
//   - the flower's team only: the percent and energy of turns without a feed, the flower's CPU time and
//     errors on every turn, and which flower version answered;
//   - the bee's team only: its decision times, errors and versions; what it prints (everyone's once a
//     finished game is revealed);
//   - each team's own: code (revealed at the end if revealOnFinish), versions, sizes, change budgets.

/** A game's whole-game ledgers (public). */
const ledgersView = (g) => (g.participants ? { feeds: g.feeds, nectar: g.nectar, pollen: g.pollen } : null);

// Scored with the game's own exponents: a game stored without them was scored with √, and still is.
const scoresOf = (g) => (g.participants ? score(g.participants, g.feeds, g.nectar, g.pollen, scoringOf(g.config)) : null);

/**
 * Everything about a game but its turns. During play, each team sees only its own program versions and
 * change budgets (other teams': null); once the game is over, everyone sees everyone's. Code is your own
 * team's, or everyone's once a finished game is revealed. The scoreboard is public.
 */
export async function viewGame(room, game, user) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const cfg = g.config;
  const mine = await myTeam(g.id, user?.id);
  const isOwner = !!user && user.id === room.owner_id;
  const over = g.status === "finished";
  const revealed = over && cfg.revealOnFinish;
  const teams = (await query("SELECT * FROM teams WHERE game_id = $1 ORDER BY created_at, id", [g.id])).rows;
  const members = (await query("SELECT m.team_id, u.name FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.game_id = $1 ORDER BY m.joined_at", [g.id])).rows;
  const progs = (await query(
    `SELECT p.*, u.name AS submitted_by_name FROM programs p JOIN users u ON u.id = p.submitted_by
      WHERE p.game_id = $1 ORDER BY p.team_id, p.kind, p.version`, [g.id])).rows;
  const banks = (await query("SELECT * FROM banks WHERE game_id = $1", [g.id])).rows;
  const memories = (await query("SELECT * FROM bee_memories WHERE game_id = $1", [g.id])).rows;
  const participants = g.participants || null;
  const indexOf = (teamId) => (participants ? participants.indexOf(teamId) : -1);
  const canSeeCode = (teamId) => revealed || mine?.id === teamId;
  const canSeeChanges = (teamId) => over || mine?.id === teamId;

  const versionView = (p) => ({
    version: p.version, size: p.size, distance: p.distance, cost: p.cost, atMs: p.at_ms,
    submittedAt: p.submitted_at, submittedBy: p.submitted_by_name, problem: p.problem,
    ...(canSeeCode(p.team_id) ? { code: p.code } : {}),
  });
  const programsOf = (teamId) => Object.fromEntries(KINDS.map((k) => [k, progs.filter((p) => p.team_id === teamId && p.kind === k).map(versionView)]));
  const banksOf = (teamId) => Object.fromEntries(banks.filter((b) => b.team_id === teamId).map((b) => [b.kind, { bank: b.bank, atMs: b.at_ms }]));
  const memoryOf = (teamId) => {
    const m = memories.find((x) => x.team_id === teamId);
    return { value: m ? JSON.parse(m.memory) : {}, bytes: m ? m.bytes : 0, cap: cfg.budgets.bee.memory, version: m?.bee_version ?? null, error: m?.error ?? null };
  };

  return {
    room: { id: room.id, shortId: shortId(room), url: `/room/${shortId(room)}`, isOwner },
    game: {
      // The config as stored, with the scoring exponents it is scored with (√, 0.5, if it has none).
      id: g.id, shortId: shortId(g), url: `/room/${shortId(room)}/game/${shortId(g)}`, status: g.status, config: { ...cfg, scoring: scoringOf(cfg) },
      clockMs: g.clock_ms, endMs: Math.round(cfg.minutes * 60000), round: g.round, lastSeq: g.last_seq, version: g.version, lastError: g.last_error,
      createdAt: g.created_at, startedAt: g.started_at, finishedAt: g.finished_at, revealed, isOwner,
    },
    me: user ? { id: user.id, name: user.name, teamId: mine?.id ?? null } : null,
    participants,
    teams: teams.map((t) => ({
      id: t.id, name: t.name, color: t.color,
      members: members.filter((m) => m.team_id === t.id).map((m) => m.name),
      participant: participants ? participants.includes(t.id) : null,
      index: indexOf(t.id) >= 0 ? indexOf(t.id) : null,
      // in the lobby: which programs each team has written (it plays if both)
      ...(g.status === "lobby" ? { ready: Object.fromEntries(KINDS.map((k) => [k, progs.some((p) => p.team_id === t.id && p.kind === k)])) } : {}),
      // every version, oldest first, and the change budget (bank as of game time atMs): your own team's
      // during play, everyone's once it's over. Code only where you may see it.
      programs: canSeeChanges(t.id) ? programsOf(t.id) : null,
      banks: canSeeChanges(t.id) ? banksOf(t.id) : null,
      // the bee's MEMORY (read only): your own team's during play, everyone's once it's over
      memory: participants?.includes(t.id) && canSeeChanges(t.id) ? memoryOf(t.id) : null,
    })),
    myTeam: mine ? { id: mine.id, name: mine.name, joinCode: mine.join_code, index: indexOf(mine.id) >= 0 ? indexOf(mine.id) : null } : null,
    interface: programInterface(cfg),
    scores: scoresOf(g),
    // feeds[bee team][flower team], nectar[..][..] and pollen[..][..] over the whole game, in participants order
    ledgers: ledgersView(g),
  };
}

/** Just the live numbers (cheap enough to poll every second): clock, round, the scoreboard and the ledgers. */
export async function viewScores(game) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  return {
    status: g.status, clockMs: g.clock_ms, endMs: Math.round(g.config.minutes * 60000), round: g.round, lastSeq: g.last_seq,
    participants: g.participants || null, scores: scoresOf(g), ledgers: ledgersView(g),
  };
}

/**
 * Actions after `after` (a seq), oldest first, at most `limit`; or with `before`, the last `limit` actions
 * before that seq, still oldest first (before = lastSeq + 1 gives the latest). `mine`: only turns of the
 * viewer's team's bee or at its flower. Every way of reading actions (pages, ?before=, ?mine=1, the SSE and
 * WebSocket streams) goes through actionView.
 */
export async function viewActions(game, user, { after = 0, before = null, limit = 1000, mine: onlyMine = false } = {}) {
  const g = (await query("SELECT status, config, last_seq, clock_ms, round FROM games WHERE id = $1", [game.id])).rows[0];
  const mine = await myTeam(game.id, user?.id);
  const over = g.status === "finished", revealed = over && g.config.revealOnFinish;
  const n = Math.max(1, Math.min(5000, Number(limit) || 1000));
  const only = onlyMine && onlyMine !== "0" && onlyMine !== "false" ? (mine?.id ?? null) : undefined;
  if (only === null) fail(403, "Join a team first");
  const where = only ? "game_id = $1 AND (bee_team = $4 OR flower_team = $4)" : "game_id = $1";
  const params = (x) => (only ? [game.id, x, n, only] : [game.id, x, n]);
  const { rows } = before !== null && before !== undefined && before !== ""
    ? await query(`SELECT * FROM (SELECT * FROM actions WHERE ${where} AND seq < $2 ORDER BY seq DESC LIMIT $3) t ORDER BY seq`, params(Number(before) || 0))
    : await query(`SELECT * FROM actions WHERE ${where} AND seq > $2 ORDER BY seq LIMIT $3`, params(Math.max(0, Number(after) || 0)));
  const grainsPublic = g.config.grains === "public";
  return { actions: rows.map((a) => actionView(a, mine?.id, over, revealed, grainsPublic)), lastSeq: g.last_seq, clockMs: g.clock_ms, round: g.round, status: g.status };
}

/**
 * One action as a viewer (a member of team `me`, or nobody) may see it. Fields the viewer may not see are
 * absent. Public: the arrival (whose bee, whose flower); on the turn's end the challenge, the response,
 * whether the bee fed (the action itself) and the pollen (0 on a leave); on a feed also the percent,
 * energy and nectar.
 */
export function actionView(a, me, over, revealed, grainsPublic = false) {
  const myBee = over || (!!me && a.bee_team === me), myFlower = over || (!!me && a.flower_team === me);
  const out = { seq: a.seq, atMs: a.at_ms, round: a.round, turn: a.turn, bee: a.bee_team, flower: a.flower_team, action: a.action };
  if (myBee) out.beeVersion = a.bee_version;
  if (myFlower) out.flowerVersion = a.flower_version;
  if (a.action !== "arrive") {
    const fed = a.action === "feed";
    Object.assign(out, { c: a.c, r: a.r, rBytes: a.r_bytes ?? null, pollen: a.pollen });
    // A response over INLINE_BYTES: its size, hash and first INLINE_BYTES; the whole of it from GET .../responses/:seq.
    if (a.r_hash) Object.assign(out, { rHash: a.r_hash, rPreview: a.r_preview });
    if (fed) out.nectar = a.nectar;
    if (fed || myFlower) Object.assign(out, { percent: a.percent, energy: a.energy });
    if (myFlower) Object.assign(out, { ms: a.cpu_ms, budgetMs: a.budget_ms ?? null, flowerError: a.flower_error });
    if (myBee) Object.assign(out, { beeMs: a.bee_ms, beeError: a.bee_error });
  }
  if (a.log && (revealed || (!!me && a.bee_team === me))) out.log = a.log;
  // A feed's pollen grain: the feeding bee's team's (everyone's if grains are public, or once it's over).
  if (a.grain !== null && a.grain !== undefined && (over || grainsPublic || (!!me && a.bee_team === me))) {
    Object.assign(out, { grain: a.grain, grainVersion: a.grain_version, grainCodeLength: a.grain_code_length });
  }
  return out;
}

/**
 * The team ledger: one entry per finished turn (its feed or leave), oldest first, as the viewer's team may
 * see it (team indices into participants; `seq` for paging). A spectator gets the public fields; once the
 * game is over, everyone gets every field.
 */
export async function viewLedger(game, user, { after = 0, limit = 1000 } = {}) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const participants = g.participants || null;
  const mine = await myTeam(game.id, user?.id);
  const team = mine && participants && participants.includes(mine.id) ? participants.indexOf(mine.id) : null;
  if (!participants) return { participants, team, entries: [], lastSeq: g.last_seq, round: g.round, status: g.status };
  const n = Math.max(1, Math.min(5000, Number(limit) || 1000));
  const { rows } = await query(
    "SELECT * FROM actions WHERE game_id = $1 AND seq > $2 AND action IN ('feed', 'leave') ORDER BY seq LIMIT $3",
    [game.id, Math.max(0, Number(after) || 0), n]);
  const idx = new Map(participants.map((id, i) => [id, i]));
  const over = g.status === "finished";
  const opts = { game: shortId(g), flowerMs: g.config.budgets.flower.ms };
  return {
    participants, team, lastSeq: g.last_seq, round: g.round, status: g.status,
    entries: rows.map((a) => mask("turns", turnOf(a, idx, opts), team, { over, grainsPublic: g.config.grains === "public" })),
  };
}

/** A stored turn end as a `turns` record of the query schema (team indices), unmasked. */
export const turnOf = (a, idx, { game, flowerMs }) => ({
  game, seq: Number(a.seq), round: Number(a.round), atMs: Number(a.at_ms) - flowerMs, turn: a.turn, bee: idx.get(a.bee_team), flower: idx.get(a.flower_team),
  challenge: a.c, response: a.r, responseBytes: a.r_bytes ?? null, responseHash: a.r_hash ?? null,
  fed: a.action === "feed", percent: a.percent, energy: a.energy, nectar: a.nectar, pollen: a.pollen ?? 0,
  ms: a.cpu_ms, budgetMs: a.budget_ms ?? null, flowerVersion: a.flower_version, flowerError: a.flower_error, beeMs: a.bee_ms, beeVersion: a.bee_version, beeError: a.bee_error,
  grain: a.grain ?? null, grainVersion: a.grain_version ?? null, grainCodeLength: a.grain_code_length ?? null,
});

/**
 * The whole response of the turn whose end is action `seq`, as its JSON text (responses are public). A big
 * one comes from `responses`; a small one from the action itself. Null if that turn has no response.
 */
export async function viewResponse(game, seq) {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) fail(400, "seq must be a positive integer");
  const big = (await query("SELECT body FROM responses WHERE game_id = $1 AND seq = $2", [game.id, n])).rows[0];
  if (big) return big.body;
  const a = (await query("SELECT r, action FROM actions WHERE game_id = $1 AND seq = $2", [game.id, n])).rows[0];
  if (!a || a.action === "arrive" || a.r === null) return null;
  return JSON.stringify(a.r);
}

// ---------- querying history (docs/QUERY.md) ----------

/** Run a query; a query the schema doesn't allow (or one that times out) is the client's error. */
async function asViewer(ast, where) {
  try {
    return await runQuery(ast, where);
  } catch (e) {
    if (e.status === 400) fail(400, e.message);
    if (e.code === "57014") fail(400, "the query took too long: narrow it (a round range, a team) or page it");
    throw e;
  }
}

/** A query over one game, as the viewer may see it. */
export async function queryGame(game, user, ast) {
  return asViewer(ast, { gameId: game.id, userId: user?.id ?? null });
}

/** A query across a room's finished games (fully revealed; scopes mean the viewer's team in each). */
export async function queryRoom(room, user, ast) {
  return asViewer(ast, { roomId: room.id, userId: user?.id ?? null });
}

export const querySchema = () => SCHEMA;

export { DEFAULT_CONFIG };
