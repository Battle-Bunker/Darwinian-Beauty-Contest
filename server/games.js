// Rooms, games, teams and programs: everything the API does, backed by Postgres. The gardens themselves
// run in live.js; this module writes what they should run and reads what they did.
import crypto from "node:crypto";
import { query, tx } from "./db/pool.js";
import { allocatePrefixLen, normalizeCode, shortId, uuidToCode } from "./lib/shortid.js";
import { DEFAULT_CONFIG, KINDS, available, drawEndMs, endFactorOf, energyBytes, feedPriceOf, lengthOf, normalizeConfig, prevalenceConfig, prevalenceOf, snapshotsOf, visibilityOf, windowMsOf } from "./lib/gameConfig.js";
import { fitnessBasisOf, scoreboard } from "./lib/prevalence.js";
import { changes, size } from "./lib/measure.js";
import { scoringOf, zeroLedger } from "./lib/scoring.js";
import { programInterface } from "./lib/interface.js";
import { ruleBreaches } from "./lib/pyRules.js";
import { canonicalJson, memoryShapeError, memorySize, tryBee, tryFlower } from "./engine.js";
import { exampleValue, parseType } from "./lib/types.js";
import { mask, privateTurns } from "./query/mask.js";
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

// ---------- the game's length: its end is drawn at the start and hidden until the game is over ----------

/**
 * A game's timing as a viewer may see it, in ms of game time. minMs, maxMs: the range its end is drawn from
 * (public). endMs: its end, null while that is hidden (a game whose range is wider than a point, until it is
 * finished); a game with a fixed end (maxMs = minMs, as every game from before random ends) shows it all
 * along. With `owner` (the room owner, with no team in the game) also drawnEndMs: the drawn end (null before
 * the start). Nothing else a team can read depends on the drawn end.
 */
export function timingOf(g, owner = false) {
  const { minMs, maxMs } = lengthOf(g.config);
  const drawn = g.end_ms != null ? Number(g.end_ms) : null;
  const hidden = maxMs > minMs && g.status !== "finished";
  return { minMs, maxMs, endMs: hidden ? null : drawn ?? minMs, ...(owner ? { drawnEndMs: drawn } : {}) };
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
      clockMs: g.clock_ms, ...timingOf(g), teamCount: g.team_count, createdAt: g.created_at,
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

/**
 * The owner starts the garden: teams with both programs play; the clock and change budgets start, and the
 * game's end is drawn (drawEndMs: uniform in [minutes, endFactor × minutes], hidden until it is over).
 */
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
              started_at = now(), last_error = NULL, end_ms = $4
        WHERE id = $1`, [g.id, participants, zero, drawEndMs(g.config)]);
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

// ---------- private play: what a viewer sees of a private game until it is over ----------
//
// A game whose config.visibility is "private" shows each team, while it runs or is paused, only its own programs'
// side of their turns (privateActionViews; mask.js privateTurns), its own versions, budgets and MEMORY, and
// everyone's prevalence in snapshots: a sample every prevalenceEveryS seconds of game time (gameConfig.js
// isSnapshot), its F, B, p^F, p^B, fitness and c rounded to 2 decimals, its balances left out. Spectators see the
// snapshots only. The scoreboard is the latest snapshot's; there are no ledgers, arrivals, other teams' turns or
// samples in between. The room's owner, with no team in the game, sees it as a public game. Once it is over,
// everything is revealed as in any game.

/** Whether this viewer sees game row `g` privately (the room's owner `ownerId`; the viewer `userId`, on team `mine` or none). */
export const restrictedFor = (g, ownerId, userId, mine) =>
  visibilityOf(g.config) === "private" && g.status !== "finished" && !(!!userId && userId === ownerId && !mine);

const r2 = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) / 100 : x ?? null);

/** SQL: whether the prevalence sample at `col` (game ms) is one of the snapshots of a game with this config. */
export function snapshotSql(col, config) {
  const { everyMs, sampleMs } = snapshotsOf(config);
  const P = Math.max(1, Math.round(everyMs)), S = Math.max(1, Math.round(sampleMs)); // integers, written inline
  return `(${col} = 0 OR floor(${col}::float8 / ${P}) > floor((${col} - ${S})::float8 / ${P}))`;
}

/** A private game's latest prevalence snapshot (a stored sample row), or null before the first. */
export async function latestSnapshot(g, client = { query }) {
  const { rows } = await client.query(`SELECT round, at_ms, c, slots, flower_success, bee_success, flower_p, bee_p, fitness FROM prevalence
    WHERE game_id = $1 AND ${snapshotSql("at_ms", g.config)} ORDER BY round DESC LIMIT 1`, [g.id]);
  return rows[0] ?? null;
}

/** A snapshot as published: a sample (sampleView) with F, B, p^F, p^B, fitness and c rounded to 2 decimals and no balances. */
export const snapshotView = (x, participants) => {
  const v = sampleView(x, participants);
  return {
    ...v, c: r2(v.c), snapshot: true,
    species: v.species.map((sp) => ({ ...sp, flowerSuccess: r2(sp.flowerSuccess), beeSuccess: r2(sp.beeSuccess), flowerP: r2(sp.flowerP), beeP: r2(sp.beeP), fitness: r2(sp.fitness), balance: null })),
  };
};

/** The scoreboard of a private game during play: each team's latest snapshot values; everything else null. */
export function snapshotScores(participants, snap) {
  const v = snap ? snapshotView(snap, participants) : null;
  return participants.map((teamId, i) => {
    const sp = v?.species[i];
    return {
      teamId, fitness: sp?.fitness ?? null, flowerSuccess: sp?.flowerSuccess ?? null, beeSuccess: sp?.beeSuccess ?? null, flowerP: sp?.flowerP ?? null, beeP: sp?.beeP ?? null,
      pollination: null, forage: null, pollinationShare: null, forageShare: null, pollen: null, feedsReceived: null, feedsGiven: null,
      pollinators: null, nectarCollected: null, nectarGiven: null, nectarSources: null,
    };
  });
}

/**
 * A turn's end action as team `me` sees it in private play: its flower's side and/or its bee's side (a turn of
 * its own bee at its own flower gives both, flower first, with the same seq). Arrivals give nothing.
 *   flower side: { seq, atMs, round, side: "flower", flower: me, action: "answer", c, r, rBytes, rHash?, rPreview?,
 *                  percent, ms, budgetMs, flowerError, flowerVersion }: not the bee, not whether it fed
 *   bee side:    { seq, atMs, round, side: "bee", bee: me, turn, action: "feed" | "leave", c, r, rBytes, rHash?,
 *                  rPreview?, beeMs, beeError, beeVersion, log?, and on a feed nectar, price, net, balance, grain? }:
 *                  not the flower, its version, percent or energy
 */
export function privateActionViews(a, me) {
  if (!me || a.action === "arrive") return [];
  const base = { seq: a.seq, atMs: a.at_ms, round: a.round };
  const resp = { c: a.c, r: a.r, rBytes: a.r_bytes ?? null, ...(a.r_hash ? { rHash: a.r_hash, rPreview: a.r_preview } : {}) };
  const out = [];
  if (a.flower_team === me) {
    out.push({ ...base, side: "flower", flower: me, action: "answer", ...resp, percent: a.percent, ms: a.cpu_ms, budgetMs: a.budget_ms ?? null,
      flowerError: a.flower_error, flowerVersion: a.flower_version });
  }
  if (a.bee_team === me) {
    const v = { ...base, side: "bee", bee: me, turn: a.turn, action: a.action, ...resp, beeMs: a.bee_ms, beeError: a.bee_error, beeVersion: a.bee_version };
    if (a.log) v.log = a.log;
    if (a.action === "feed") {
      Object.assign(v, { nectar: a.nectar, price: a.price ?? 0, net: a.nectar - (a.price ?? 0), balance: a.balance ?? null });
      if (a.grain !== null && a.grain !== undefined) v.grain = a.grain; // bare: no version, no code length
    }
    out.push(v);
  }
  return out;
}

/** The room's owner of game row `g` (for restrictedFor). */
const ownerOf = async (g) => (await query("SELECT owner_id FROM rooms WHERE id = $1", [g.room_id])).rows[0]?.owner_id ?? null;

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

/**
 * A prevalence sample as published (view, scores, the action stream, GET .../prevalence): { round, atMs, c, slots,
 * species: [{ team (id), index, flowerSuccess, beeSuccess, flowerP, beeP, fitness, balance }] } in participants
 * order (balance: the bee's nectar balance with pools, else null). Stored samples hold arrays (F, B, pF, pB,
 * fitness, balance on the game row; columns in the prevalence table).
 */
export const sampleView = (x, participants) => {
  const col = (k, alt) => x[k] ?? x[alt] ?? [];
  const F = col("F", "flower_success"), B = col("B", "bee_success"), pF = col("pF", "flower_p"), pB = col("pB", "bee_p"), fit = col("fitness", "fitness");
  const bal = x.balance ?? x.bee_balance ?? null;
  return {
    round: Number(x.round), atMs: Number(x.atMs ?? x.at_ms), c: x.c, slots: x.slots ?? null,
    species: participants.map((team, index) => ({
      team, index, flowerSuccess: F[index] ?? null, beeSuccess: B[index] ?? null, flowerP: pF[index] ?? null, beeP: pB[index] ?? null,
      fitness: fit[index] ?? null, balance: bal ? bal[index] ?? null : null,
    })),
  };
};

/**
 * A game's prevalence (public): its settings and latest sample, { on, halfLifeS, cDecay, cStart, cHalfS (sech) or cEnd (linear), cap,
 * slots, prior, pools, endowment, feedPrice, sample } (sample null before the first); null when the game has none.
 */
function prevalenceView(g, snap = undefined) {
  const settings = prevalenceOf(g.config);
  if (!settings) return null;
  if (snap !== undefined) return { ...settings, feedPrice: feedPriceOf(g.config), sample: snap && g.participants ? snapshotView(snap, g.participants) : null };
  return { ...settings, feedPrice: feedPriceOf(g.config), sample: g.prevalence && g.participants ? sampleView(g.prevalence, g.participants) : null };
}

// Scored with the game's own rule and exponents: with prevalence, by its scoring.mode (N² × p^F × p^B of the
// latest round, or the time-average of F × B); else N² × pollination share × forage share (√ in games stored
// without exponents).
const scoresOf = (g) => (g.participants ? scoreboard(g.config, g.participants, g.feeds, g.nectar, g.pollen, g.fitness, g.prevalence) : null);

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
  // Private play: this viewer's numbers are the latest snapshot's; no ledgers.
  const restricted = restrictedFor(g, room.owner_id, user?.id, mine);
  const snap = restricted && participants && prevalenceOf(cfg) ? await latestSnapshot(g) : null;
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
      // The config as stored, with the scoring rule it is scored with (exponents √, 0.5, and mode "timeAverage",
      // if it has none), its end factor (1 if it has none) and its energy formula (no byte factor if it has none).
      id: g.id, shortId: shortId(g), url: `/room/${shortId(room)}/game/${shortId(g)}`, status: g.status,
      config: { ...cfg, endFactor: endFactorOf(cfg), scoring: scoringOf(cfg), energy: { bytes: energyBytes(cfg) }, prevalence: prevalenceConfig(cfg),
        visibility: visibilityOf(cfg), prevalenceEveryS: snapshotsOf(cfg).everyMs / 1000,
        flowerWindowMs: cfg.flowerWindowMs ?? null, feedPrice: cfg.feedPrice === undefined ? 0 : cfg.feedPrice },
      // what they come to: the flower window (ms) and the feed price (E's unit) the game plays with
      windowMs: windowMsOf(cfg), feedPrice: feedPriceOf(cfg),
      // how the scoreboard's fitness is reckoned: "final" (N² × p^F × p^B now), "timeAverage" or "shares"
      fitnessBasis: fitnessBasisOf(cfg),
      // minMs, maxMs, endMs (null while hidden) and, for the owner with no team here, drawnEndMs
      clockMs: g.clock_ms, ...timingOf(g, isOwner && !mine), round: g.round, lastSeq: g.last_seq, version: g.version, lastError: g.last_error,
      createdAt: g.created_at, startedAt: g.started_at, finishedAt: g.finished_at, revealed, isOwner,
      // this viewer sees the game privately (a private game, until it's over; not its owner with no team in it)
      restricted,
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
    // private play: the latest snapshot's numbers only
    scores: restricted ? (participants ? snapshotScores(participants, snap) : null) : scoresOf(g),
    // feeds[bee team][flower team], nectar[..][..] and pollen[..][..] over the whole game, in participants order (not in private play)
    ledgers: restricted ? null : ledgersView(g),
    // species prevalence: its settings and latest sample, or in private play its latest snapshot (null: species are drawn uniformly)
    prevalence: restricted ? prevalenceView(g, snap) : prevalenceView(g),
  };
}

/**
 * Just the live numbers (cheap enough to poll every second): clock, the length range (and the end, once it may
 * be seen: timingOf), round, the scoreboard and the ledgers (in private play, for anyone but the room's owner
 * with no team in it: the latest snapshot's numbers, no ledgers). Nobody gets the hidden end here.
 */
export async function viewScores(game, user = null) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const restricted = restrictedFor(g, await ownerOf(g), user?.id, await myTeam(g.id, user?.id));
  const snap = restricted && g.participants && prevalenceOf(g.config) ? await latestSnapshot(g) : null;
  return {
    status: g.status, clockMs: g.clock_ms, ...timingOf(g), round: g.round, lastSeq: g.last_seq, fitnessBasis: fitnessBasisOf(g.config), restricted,
    participants: g.participants || null,
    scores: restricted ? (g.participants ? snapshotScores(g.participants, snap) : null) : scoresOf(g),
    ledgers: restricted ? null : ledgersView(g), prevalence: restricted ? prevalenceView(g, snap) : prevalenceView(g),
  };
}

/**
 * A game's prevalence samples (public), oldest first: those of rounds after `after`, at most `limit` (default
 * and most 5000). { prevalence (its settings, null for a game without), samples: [sample] }. In private play
 * (restrictedFor), its snapshots only (snapshotView).
 */
export async function viewPrevalence(game, { after = 0, limit = 5000 } = {}, user = null) {
  const g = (await query("SELECT id, room_id, status, config, participants FROM games WHERE id = $1", [game.id])).rows[0];
  const settings = prevalenceOf(g.config);
  if (!settings || !g.participants) return { prevalence: settings, samples: [] };
  const restricted = restrictedFor(g, await ownerOf(g), user?.id, await myTeam(g.id, user?.id));
  const n = Math.max(1, Math.min(5000, Number(limit) || 5000));
  const { rows } = await query(`SELECT round, at_ms, c, slots, flower_success, bee_success, flower_p, bee_p, fitness, bee_balance FROM prevalence
    WHERE game_id = $1 AND round > $2${restricted ? ` AND ${snapshotSql("at_ms", g.config)}` : ""} ORDER BY round LIMIT $3`,
    [game.id, Math.max(0, Number(after) || 0), n]);
  return { prevalence: settings, samples: rows.map((r) => (restricted ? snapshotView(r, g.participants) : sampleView(r, g.participants))) };
}

/**
 * Actions after `after` (a seq), oldest first, at most `limit`; or with `before`, the last `limit` actions
 * before that seq, still oldest first (before = lastSeq + 1 gives the latest). `mine`: only turns of the
 * viewer's team's bee or at its flower. Every way of reading actions (pages, ?before=, ?mine=1, the SSE and
 * WebSocket streams) goes through actionView.
 */
export async function viewActions(game, user, { after = 0, before = null, limit = 1000, mine: onlyMine = false } = {}) {
  const g = (await query("SELECT g.id, g.room_id, g.status, g.config, g.last_seq, g.clock_ms, g.round, g.participants, g.prevalence, r.owner_id FROM games g JOIN rooms r ON r.id = g.room_id WHERE g.id = $1", [game.id])).rows[0];
  const mine = await myTeam(game.id, user?.id);
  const over = g.status === "finished", revealed = over && g.config.revealOnFinish;
  const n = Math.max(1, Math.min(5000, Number(limit) || 1000));
  const only = onlyMine && onlyMine !== "0" && onlyMine !== "false" ? (mine?.id ?? null) : undefined;
  if (only === null) fail(403, "Join a team first");
  if (restrictedFor(g, g.owner_id, user?.id, mine)) return privateActions(g, mine, { after, before, n });
  const where = only ? "game_id = $1 AND (bee_team = $4 OR flower_team = $4)" : "game_id = $1";
  const params = (x) => (only ? [game.id, x, n, only] : [game.id, x, n]);
  const { rows } = before !== null && before !== undefined && before !== ""
    ? await query(`SELECT * FROM (SELECT * FROM actions WHERE ${where} AND seq < $2 ORDER BY seq DESC LIMIT $3) t ORDER BY seq`, params(Number(before) || 0))
    : await query(`SELECT * FROM actions WHERE ${where} AND seq > $2 ORDER BY seq LIMIT $3`, params(Math.max(0, Number(after) || 0)));
  const grainsPublic = g.config.grains === "public";
  return {
    actions: rows.map((a) => actionView(a, mine?.id, over, revealed, grainsPublic)), lastSeq: g.last_seq, clockMs: g.clock_ms, round: g.round, status: g.status,
    // the latest species prevalence sample (games with prevalence, once sampled)
    ...(g.prevalence && g.participants && prevalenceOf(g.config) ? { prevalence: sampleView(g.prevalence, g.participants) } : {}),
  };
}

/**
 * viewActions in private play: only the team's own programs' sides of its turns (privateActionViews; a spectator
 * none), paged by the actions' seq like any page, and the latest prevalence snapshot.
 */
async function privateActions(g, mine, { after, before, n }) {
  const snap = g.participants && prevalenceOf(g.config) ? await latestSnapshot(g) : null;
  const out = { actions: [], lastSeq: g.last_seq, clockMs: g.clock_ms, round: g.round, status: g.status, ...(snap ? { prevalence: snapshotView(snap, g.participants) } : {}) };
  if (!mine) return out;
  const where = "game_id = $1 AND action IN ('feed', 'leave') AND (bee_team = $4 OR flower_team = $4)";
  const { rows } = before !== null && before !== undefined && before !== ""
    ? await query(`SELECT * FROM (SELECT * FROM actions WHERE ${where} AND seq < $2 ORDER BY seq DESC LIMIT $3) t ORDER BY seq`, [g.id, Number(before) || 0, n, mine.id])
    : await query(`SELECT * FROM actions WHERE ${where} AND seq > $2 ORDER BY seq LIMIT $3`, [g.id, Math.max(0, Number(after) || 0), n, mine.id]);
  out.actions = rows.flatMap((a) => privateActionViews(a, mine.id));
  return out;
}

/**
 * One action as a viewer (a member of team `me`, or nobody) may see it. Fields the viewer may not see are
 * absent. Public: the arrival (whose bee, whose flower); on the turn's end the challenge, the response,
 * whether the bee fed (the action itself) and the pollen (0 on a leave); on a feed also the percent,
 * energy, nectar, the feed price the bee paid and its net (nectar − price).
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
    if (fed) Object.assign(out, { nectar: a.nectar, price: a.price ?? 0, net: a.nectar - (a.price ?? 0), balance: a.balance ?? null });
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
 * game is over, everyone gets every field. In private play (restrictedFor) only the team's own turns, as its
 * programs' sides (mask.js privateTurns: two entries, same seq, for its bee at its own flower); a spectator none.
 */
export async function viewLedger(game, user, { after = 0, limit = 1000 } = {}) {
  const g = (await query("SELECT * FROM games WHERE id = $1", [game.id])).rows[0];
  const participants = g.participants || null;
  const mine = await myTeam(game.id, user?.id);
  const team = mine && participants && participants.includes(mine.id) ? participants.indexOf(mine.id) : null;
  if (!participants) return { participants, team, entries: [], lastSeq: g.last_seq, round: g.round, status: g.status };
  const restricted = restrictedFor(g, await ownerOf(g), user?.id, mine);
  const n = Math.max(1, Math.min(5000, Number(limit) || 1000));
  // Private play: the team's own turns only (a spectator none), each as its own programs' sides (mask.js privateTurns).
  if (restricted && team === null) return { participants, team, restricted, lastSeq: g.last_seq, round: g.round, status: g.status, entries: [] };
  const { rows } = restricted
    ? await query("SELECT * FROM actions WHERE game_id = $1 AND seq > $2 AND action IN ('feed', 'leave') AND (bee_team = $4 OR flower_team = $4) ORDER BY seq LIMIT $3",
      [game.id, Math.max(0, Number(after) || 0), n, mine.id])
    : await query("SELECT * FROM actions WHERE game_id = $1 AND seq > $2 AND action IN ('feed', 'leave') ORDER BY seq LIMIT $3",
      [game.id, Math.max(0, Number(after) || 0), n]);
  const idx = new Map(participants.map((id, i) => [id, i]));
  const over = g.status === "finished";
  const opts = { game: shortId(g), flowerMs: windowMsOf(g.config) };
  return {
    participants, team, restricted, lastSeq: g.last_seq, round: g.round, status: g.status,
    entries: restricted
      ? rows.flatMap((a) => privateTurns(turnOf(a, idx, opts), team))
      : rows.map((a) => mask("turns", turnOf(a, idx, opts), team, { over, grainsPublic: g.config.grains === "public" })),
  };
}

/** A stored turn end as a `turns` record of the query schema (team indices), unmasked. */
export const turnOf = (a, idx, { game, flowerMs }) => ({
  game, seq: Number(a.seq), round: Number(a.round), atMs: Number(a.at_ms) - flowerMs, turn: a.turn, bee: idx.get(a.bee_team), flower: idx.get(a.flower_team),
  challenge: a.c, response: a.r, responseBytes: a.r_bytes ?? null, responseHash: a.r_hash ?? null,
  fed: a.action === "feed", percent: a.percent, energy: a.energy, nectar: a.nectar,
  price: a.action === "feed" ? a.price ?? 0 : null, net: a.action === "feed" ? a.nectar - (a.price ?? 0) : null,
  balance: a.action === "feed" ? a.balance ?? null : null, pollen: a.pollen ?? 0,
  ms: a.cpu_ms, budgetMs: a.budget_ms ?? null, flowerVersion: a.flower_version, flowerError: a.flower_error, beeMs: a.bee_ms, beeVersion: a.bee_version, beeError: a.bee_error,
  grain: a.grain ?? null, grainVersion: a.grain_version ?? null, grainCodeLength: a.grain_code_length ?? null,
});

/**
 * The whole response of the turn whose end is action `seq`, as its JSON text (responses are public). A big
 * one comes from `responses`; a small one from the action itself. Null if that turn has no response.
 */
export async function viewResponse(game, seq, user = null) {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) fail(400, "seq must be a positive integer");
  // Private play: only a turn of the viewer's own bee or at its own flower.
  const g = (await query("SELECT id, room_id, status, config FROM games WHERE id = $1", [game.id])).rows[0];
  const mine = await myTeam(game.id, user?.id);
  if (restrictedFor(g, await ownerOf(g), user?.id, mine)) {
    const own = mine && (await query("SELECT 1 FROM actions WHERE game_id = $1 AND seq = $2 AND (bee_team = $3 OR flower_team = $3) AND action IN ('feed', 'leave')", [game.id, n, mine.id])).rowCount;
    if (!own) return null;
  }
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

/** A query over one game, as the viewer may see it (in private play: restrictedFor, sql.js). */
export async function queryGame(game, user, ast) {
  const g = (await query("SELECT id, room_id, status, config FROM games WHERE id = $1", [game.id])).rows[0];
  const restricted = restrictedFor(g, await ownerOf(g), user?.id, await myTeam(game.id, user?.id));
  return asViewer(ast, { gameId: game.id, userId: user?.id ?? null, restricted, config: g.config });
}

/** A query across a room's finished games (fully revealed; scopes mean the viewer's team in each). */
export async function queryRoom(room, user, ast) {
  return asViewer(ast, { roomId: room.id, userId: user?.id ?? null });
}

export const querySchema = () => SCHEMA;

export { DEFAULT_CONFIG };
