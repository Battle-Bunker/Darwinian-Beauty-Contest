// Querying history (docs/QUERY.md): the same ASTs give the same rows from the Python in-memory executor,
// the TypeScript in-memory executor and SQL; SQL enforces each viewer's visibility (filters, sorts and
// aggregates included); builders are immutable and build the same AST in both languages; the arena's hooks
// (local(), connect(post=)) work; the generated clients are up to date; typical queries on a 20,000-turn
// history take well under a millisecond.
// Uses its own database (TEST_DATABASE_URL, default dbc_one_test), never dbc, dbc_live or dbc_one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL || "postgres://dbc:dbc@localhost:5432/dbc_one_test";
assert.ok(!/\/(dbc|dbc_live|dbc_one)$/.test(TEST_DB), "the query tests never run against a real database");
process.env.DATABASE_URL = TEST_DB;
const { pool, tx } = await import("../server/db/pool.js");
const { migrate } = await import("../server/db/migrate.js");
const { runQuery, MAX_LIMIT } = await import("../server/query/sql.js");
const { insertActions, insertSamples } = await import("../server/live.js");
const { mask } = await import("../server/query/mask.js");
const { SCHEMA } = await import("../server/query/schema.js");
const { canonicalJson } = await import("../server/engine.js");
const { normalizeConfig } = await import("../server/lib/gameConfig.js");
const { uuidToCode } = await import("../server/lib/shortid.js");
const { stale } = await import("../scripts/gen-query/index.js");
const { play } = await import("./fixtures/garden.js");

const require = createRequire(import.meta.url);
const H = require("../vendor/query/history.js");
const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "history_harness.py");
const python = (job) => JSON.parse(execFileSync("python3", [HARNESS], { input: JSON.stringify(job), maxBuffer: 1 << 28 }).toString());

const N = 4;
const db = {}; // ids and the garden's output

// Team 3's flower fails now and then; team 2's answers some challenges with a response over 4 KB (stored
// apart: its record has response null, with its size and hash).
const flowerCode = (ti) => ti === 3
  ? `def flower(c):\n    if c % 5 == 0:\n        return 1 // 0, 1\n    return (c * 7) % 13, 15\n`
  : ti === 2
    ? `def flower(c):\n    if c % 4 == 1:\n        return list(range(c, c + 1500)), 30\n    return (c * 5) % 11, 70\n`
    : `def flower(c):\n    return (c * ${3 + ti}) % 11, ${20 + 25 * ti}\n`;
const beeCode = (ti) => `def first():\n    return ${ti}\ndef decide(c, r):\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    if isinstance(r, list):\n        r = len(r)\n    return ("feed" if r is not None and (r + ${ti}) % 3 == 0 else "leave"), (c * 5 + 3) % 17\n`;

before(async () => {
  await migrate();
  const config = normalizeConfig({ feedCost: 2, responseType: "any", maxResponseBytes: 65536 }); // team 2's big responses fit
  const out = await play(config, Array.from({ length: N }, (_, ti) => ({ flower: flowerCode(ti), bee: beeCode(ti) })), 80);
  const uid = () => crypto.randomUUID();
  db.users = Array.from({ length: N + 1 }, uid); // one per team, and a spectator
  db.room = uid();
  db.game = uid();
  db.other = uid(); // a second game in the room, still running: never in room-level queries
  db.teams = Array.from({ length: N }, uid);
  db.short = uuidToCode(db.game); // prefix_len 26: the short id is the whole code
  db.out = out;
  db.config = config;
  await tx(async (c) => {
    for (const [i, id] of db.users.entries()) await c.query("INSERT INTO users (id, name, auth_provider, auth_subject) VALUES ($1::uuid, $2, 'test', $1::text)", [id, `u${i}`]);
    await c.query("INSERT INTO rooms (id, code, prefix_len, owner_id) VALUES ($1, $2, 26, $3)", [db.room, uuidToCode(db.room), db.users[0]]);
    for (const g of [db.game, db.other]) {
      await c.query(`INSERT INTO games (id, room_id, code, prefix_len, config, status, participants, feeds, nectar, pollen, clock_ms, round, last_seq)
        VALUES ($1, $2, $3, 26, $4, 'running', $5, $6, $7, $8, $9, $10, $11)`,
      [g, db.room, uuidToCode(g), config, g === db.game ? db.teams : null, JSON.stringify(out.feeds), JSON.stringify(out.nectar), JSON.stringify(out.pollen),
        out.clockMs, out.round, out.lastSeq]);
    }
    for (const [i, t] of db.teams.entries()) {
      await c.query("INSERT INTO teams (id, game_id, name, join_code, color, created_by) VALUES ($1, $2, $3, $4, '#000', $5)", [t, db.game, `T${i}`, `j${i}`, db.users[i]]);
      await c.query("INSERT INTO team_members (team_id, game_id, user_id) VALUES ($1, $2, $3)", [t, db.game, db.users[i]]);
      for (const [kind, version, atMs, cost] of [["flower", 1, 0, 0], ["bee", 1, 0, 0], ["flower", 2, 4000 + 600 * i, 7 + i], ["bee", 2, 9000, 30]]) {
        await c.query(`INSERT INTO programs (game_id, team_id, kind, version, code, size, distance, cost, at_ms, submitted_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [db.game, t, kind, version, `# ${kind} ${version} of T${i}`, 100 + i * 10 + version, version === 1 ? null : cost, cost, atMs, db.users[i]]);
      }
    }
    for (const m of out.memories) {
      await c.query("INSERT INTO bee_memories (game_id, team_id, bee_version, memory, bytes, error, at_round) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [db.game, db.teams[m.team], m.version, m.memory, m.bytes, m.error, out.round]);
    }
    await insertActions(c, db.game, out.actions, db.teams);
    await insertSamples(c, db.game, out.samples);
  });
  db.records = out.history.map((t) => ({ ...t, game: db.short }));
});

after(async () => {
  await pool.query("DELETE FROM games WHERE room_id = $1", [db.room]);
  await pool.query("DELETE FROM rooms WHERE id = $1", [db.room]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [db.users]);
  await pool.end();
});

const setStatus = (status, reveal = true) => pool.query(
  "UPDATE games SET status = $2, config = jsonb_set(config, '{revealOnFinish}', $3::jsonb) WHERE id = $1", [db.game, status, JSON.stringify(reveal)]);
const viewers = () => [{ name: "spectator", user: db.users[N], team: null }, ...db.teams.map((_, i) => ({ name: `team ${i}`, user: db.users[i], team: i }))];
const sql = async (ast, user, where = {}) => (await runQuery(ast, { gameId: db.game, userId: user, ...where })).rows;

/** Rows equal, floats to 1e-9 (sums and averages add up in different orders). */
function same(a, b, what) {
  const eq = (x, y) => {
    if (typeof x === "number" && typeof y === "number") return x === y || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => eq(v, y[i]));
    if (x && y && typeof x === "object" && typeof y === "object") {
      const kx = Object.keys(x), ky = Object.keys(y);
      return kx.length === ky.length && kx.every((k, i) => k === ky[i] && eq(x[k], y[k]));
    }
    return x === y;
  };
  if (!eq(a, b)) assert.deepEqual(a, b, what); // shows the difference
}

const W = (field, op, value) => ({ field, op, value });
const TURN_QUERIES = [
  { from: "turns" },
  { from: "turns", where: [W("fed", "eq", true)] },
  { from: "turns", scope: "myBee" },
  { from: "turns", scope: "myFlower", orderBy: [{ field: "round", dir: "desc" }], limit: 7 },
  { from: "turns", scope: "mine", limit: 20, offset: 5 },
  { from: "turns", where: [W("round", "between", [10, 30]), W("flower", "eq", 2)] },
  { from: "turns", where: [W("round", "gt", 70)], orderBy: [{ field: "energy", dir: "desc" }], limit: 10 },
  { from: "turns", where: [W("round", "ge", 20), W("round", "lt", 25), W("bee", "eq", 1)] },
  { from: "turns", where: [W("percent", "isNull", true)] },
  { from: "turns", where: [W("percent", "gt", 30), W("fed", "eq", false)] },
  { from: "turns", where: [W("response", "isNull", false), W("challenge", "in", [3, 7, 11])] },
  { from: "turns", where: [W("challenge", "eq", 7)] },
  { from: "turns", where: [W("challenge", "ne", 7), W("bee", "in", [0, 2])], select: ["round", "bee", "challenge"] },
  { from: "turns", where: [W("flowerError", "ne", "x")], select: ["round", "flowerError", "ms"] },
  { from: "turns", aggregates: [{ fn: "count", as: "n" }] },
  { from: "turns", groupBy: ["flower"], aggregates: [{ fn: "count", as: "n" }, { fn: "sum", field: "nectar", as: "nectar" },
    { fn: "avg", field: "percent", as: "p" }, { fn: "min", field: "energy", as: "lo" }, { fn: "max", field: "pollen", as: "hi" }] },
  { from: "turns", scope: "myBee", where: [W("fed", "eq", true)], groupBy: ["flower"], aggregates: [{ fn: "sum", field: "nectar", as: "s" }, { fn: "count", as: "count" }],
    orderBy: [{ field: "s", dir: "desc" }] },
  { from: "turns", where: [W("fed", "eq", false)], aggregates: [{ fn: "sum", field: "percent", as: "s" }, { fn: "count", field: "percent", as: "n" }, { fn: "count", field: "ms", as: "ms" }] },
  { from: "turns", groupBy: ["bee", "fed"], aggregates: [{ fn: "count", field: "beeMs", as: "timed" }, { fn: "avg", field: "beeMs", as: "avgMs" }] },
  { from: "turns", where: [W("round", "le", 40)], groupBy: ["flower"], aggregates: [{ fn: "count", as: "n" }], orderBy: [{ field: "n", dir: "asc" }], limit: 2, offset: 1 },
  { from: "turns", where: [W("round", "le", 40), W("bee", "eq", 2)], groupBy: ["flower"], aggregates: [{ fn: "sum", field: "energy", as: "e" }] },
  { from: "turns", groupBy: ["flowerError"], aggregates: [{ fn: "count", as: "n" }] },
  { from: "turns", groupBy: ["percent"], aggregates: [{ fn: "count", as: "n" }] },
  { from: "turns", where: [W("bee", "eq", 9)], aggregates: [{ fn: "sum", field: "energy", as: "s" }, { fn: "count", as: "n" }] },
  { from: "turns", where: [W("bee", "eq", 9)], groupBy: ["flower"], aggregates: [{ fn: "count", as: "n" }] },
  { from: "turns", orderBy: [{ field: "fed", dir: "desc" }, { field: "beeMs", dir: "asc" }], limit: 15 },
  { from: "turns", where: [W("round", "eq", 5)], orderBy: [{ field: "round", dir: "desc" }] },
  { from: "turns", orderBy: [{ field: "ms", dir: "asc" }], limit: 12 },
  { from: "turns", groupBy: ["bee"], orderBy: [{ field: "bee", dir: "desc" }] },
];
const OTHER_QUERIES = {
  versions: [
    { from: "versions" },
    { from: "versions", scope: "mine", where: [W("kind", "eq", "flower")], orderBy: [{ field: "atMs", dir: "desc" }] },
    { from: "versions", groupBy: ["team", "kind"], aggregates: [{ fn: "max", field: "version", as: "latest" }, { fn: "sum", field: "cost", as: "spent" }] },
    { from: "versions", where: [W("code", "isNull", false)], select: ["team", "kind", "code"] },
  ],
  teams: [
    { from: "teams" },
    { from: "teams", scope: "mine" },
    { from: "teams", orderBy: [{ field: "name", dir: "desc" }], select: ["index", "name", "memoryBytes"] },
    { from: "teams", aggregates: [{ fn: "sum", field: "memoryBytes", as: "b" }, { fn: "count", field: "memory", as: "seen" }] },
  ],
  pairs: [
    { from: "pairs" },
    { from: "pairs", scope: "myBee", orderBy: [{ field: "nectar", dir: "desc" }] },
    { from: "pairs", groupBy: ["flower"], aggregates: [{ fn: "sum", field: "feeds", as: "feeds" }, { fn: "sum", field: "pollen", as: "pollen" }] },
    { from: "pairs", where: [W("feeds", "gt", 0)], aggregates: [{ fn: "count", as: "n" }] },
  ],
  prevalence: [
    { from: "prevalence" },
    { from: "prevalence", scope: "mine", orderBy: [{ field: "round", dir: "desc" }], limit: 5 },
    { from: "prevalence", where: [W("round", "ge", 40)], groupBy: ["team"], aggregates: [{ fn: "avg", field: "p", as: "p" }, { fn: "max", field: "success", as: "top" }] },
    { from: "prevalence", groupBy: ["round"], aggregates: [{ fn: "sum", field: "p", as: "total" }, { fn: "min", field: "c", as: "c" }] },
  ],
  scores: [
    { from: "scores" },
    { from: "scores", orderBy: [{ field: "fitness", dir: "desc" }], limit: 2 },
    { from: "scores", scope: "mine" },
    { from: "scores", aggregates: [{ fn: "sum", field: "pollinationShare", as: "p" }, { fn: "avg", field: "fitness", as: "f" }] },
  ],
};

// TypeScript in memory: turns through local() (records given in two parts, so append() is exercised).
const tsRun = (entity, records, team, ast) => {
  if (entity === "turns") {
    const local = H.local(records.slice(0, 50), team);
    local.append(records.slice(50));
    return [...local.run(ast)];
  }
  return [...new H.Table(entity, records).run(ast, team)];
};

for (const [status, over] of [["running", false], ["finished", true]]) {
  test(`parity (${status}): Python in memory, TypeScript in memory and SQL give the same rows, for every viewer`, async () => {
    await setStatus(status);
    for (const v of viewers()) {
      // The turns as SQL shows them to this viewer are exactly the engine's records, masked by the schema.
      const turns = await sql({ from: "turns", limit: MAX_LIMIT }, v.user);
      assert.ok(turns.length > 150 && turns.length < MAX_LIMIT);
      same(turns, db.records.map((t) => mask("turns", t, v.team, { over })), `${v.name}: SQL turns = masked engine records`);
      const py = python({ mode: "run", entity: "turns", records: turns, team: v.team, queries: TURN_QUERIES, split: 60 });
      for (const [i, ast] of TURN_QUERIES.entries()) {
        const what = `${v.name}, turns query ${i}: ${JSON.stringify(ast)}`;
        const fromSql = await sql(ast, v.user);
        same(tsRun("turns", turns, v.team, ast), fromSql, `${what} (TypeScript)`);
        assert.ok(!py[i].error, `${what}: ${py[i].error}`);
        same(py[i].rows, fromSql, `${what} (Python)`);
      }
      for (const [entity, queries] of Object.entries(OTHER_QUERIES)) {
        const all = await sql({ from: entity, limit: MAX_LIMIT }, v.user);
        const pyo = python({ mode: "run", entity, records: all, team: v.team, queries });
        for (const [i, ast] of queries.entries()) {
          const what = `${v.name}, ${entity} query ${i}: ${JSON.stringify(ast)}`;
          const fromSql = await sql(ast, v.user);
          same(tsRun(entity, all, v.team, ast), fromSql, `${what} (TypeScript)`);
          assert.ok(!pyo[i].error, `${what}: ${pyo[i].error}`);
          same(pyo[i].rows, fromSql, `${what} (Python)`);
        }
      }
    }
  });
}

test("visibility in SQL: non-owners never see private fields, through rows, filters, sorts or aggregates", async () => {
  await setStatus("running");
  const [spectator, t1] = [db.users[N], db.users[1]];
  const unfed = db.records.filter((t) => !t.fed);
  const at1 = unfed.filter((t) => t.flower === 1 && t.percent !== null);
  assert.ok(at1.length > 3 && unfed.some((t) => t.flower !== 1 && t.percent !== null), "the game has hidden percents to protect");
  const agg = (fn, field, where = []) => ({ from: "turns", where, aggregates: [{ fn, field, as: "x" }] });
  const unfedW = [W("fed", "eq", false)];
  // The percent and energy of unfed turns: the flower's team only, in aggregates too.
  assert.equal((await sql(agg("sum", "percent", unfedW), spectator))[0].x, null, "a spectator sums nothing");
  assert.equal((await sql(agg("count", "energy", unfedW), spectator))[0].x, 0);
  same((await sql(agg("sum", "percent", unfedW), t1))[0].x, at1.reduce((s, t) => s + t.percent, 0), "team 1 sums its own flower's only");
  assert.equal((await sql(agg("max", "percent", unfedW), t1))[0].x, Math.max(...at1.map((t) => t.percent)));
  // Filters and sorts on a hidden field see null.
  const hiddenFilter = await sql({ from: "turns", where: [...unfedW, W("percent", "ge", 0)] }, t1);
  assert.ok(hiddenFilter.length === at1.length && hiddenFilter.every((t) => t.flower === 1));
  assert.equal((await sql({ from: "turns", where: [W("ms", "gt", 0)] }, spectator)).length, 0, "nobody else's CPU time");
  assert.ok((await sql({ from: "turns", where: [W("ms", "isNull", false)] }, t1)).every((t) => t.flower === 1));
  assert.ok((await sql({ from: "turns", where: [W("beeMs", "isNull", false)] }, t1)).every((t) => t.bee === 1));
  const sorted = await sql({ from: "turns", orderBy: [{ field: "ms", dir: "desc" }], limit: 50 }, spectator);
  assert.deepEqual(sorted.map((t) => [t.round, t.bee]), db.records.slice(0, 50).map((t) => [t.round, t.bee]), "sorting by a hidden field leaves the natural order");
  const groups = await sql({ from: "turns", where: unfedW, groupBy: ["flower"], aggregates: [{ fn: "avg", field: "percent", as: "p" }] }, t1);
  assert.ok(groups.every((g) => (g.flower === 1) === (g.p !== null)), JSON.stringify(groups));
  // Feeds are public in full.
  assert.equal((await sql(agg("count", "percent", [W("fed", "eq", true), W("response", "isNull", false)]), spectator))[0].x,
    db.records.filter((t) => t.fed && t.response !== null).length);
  // Versions: your own team's rows only; code your own.
  const v1 = await sql({ from: "versions" }, t1);
  assert.ok(v1.length === 4 && v1.every((r) => r.team === 1 && r.code !== null));
  assert.equal((await sql({ from: "versions" }, spectator)).length, 0);
  assert.equal((await sql({ from: "versions", aggregates: [{ fn: "count", as: "n" }] }, spectator))[0].n, 0, "not even their number");
  // Memory: your own team's.
  const teams = await sql({ from: "teams" }, t1);
  assert.ok(teams.every((t) => (t.index === 1) === (t.memory !== null && t.memoryBytes !== null)));
  assert.ok(teams.find((t) => t.index === 1).memory.n > 0);
  // Pollen grains: the feeding bee's team's (filters and aggregates too); everyone's if the game's grains are public.
  const grained = db.records.filter((t) => t.grain !== null);
  assert.ok(grained.length > 5 && grained.some((t) => t.bee !== 1), "the game has grains to protect");
  assert.equal((await sql(agg("count", "grain"), spectator))[0].x, 0, "a spectator sees none");
  assert.equal((await sql(agg("count", "grainVersion"), t1))[0].x, grained.filter((t) => t.bee === 1).length, "team 1 its own bee's");
  assert.ok((await sql({ from: "turns", where: [W("grain", "isNull", false)] }, t1)).every((t) => t.bee === 1 && t.fed));
  await pool.query("UPDATE games SET config = jsonb_set(config, '{grains}', '\"public\"') WHERE id = $1", [db.game]);
  assert.equal((await sql(agg("count", "grain"), spectator))[0].x, grained.length, "public grains: everyone's, as they happen");
  await pool.query("UPDATE games SET config = jsonb_set(config, '{grains}', '\"feeder\"') WHERE id = $1", [db.game]);
  // After the game, everything; code only if revealed.
  await setStatus("finished", false);
  assert.equal((await sql(agg("count", "grain"), spectator))[0].x, grained.length, "every grain, after the game");
  assert.ok((await sql(agg("count", "percent", unfedW), spectator))[0].x > at1.length);
  const all = await sql({ from: "versions" }, spectator);
  assert.equal(all.length, 4 * N);
  assert.ok(all.every((r) => r.code === null), "not revealed: no code");
  assert.ok((await sql({ from: "versions" }, t1)).every((r) => (r.team === 1) === (r.code !== null)), "but your own");
  assert.ok((await sql({ from: "teams" }, spectator)).every((t) => t.memory !== null), "every bee's memory is revealed");
  await setStatus("finished", true);
  assert.ok((await sql({ from: "versions" }, spectator)).every((r) => r.code !== null));
});

test("room queries: across the room's finished games only, fully revealed, scopes meaning the viewer's team in each", async () => {
  await setStatus("running");
  const room = async (ast, user) => (await runQuery(ast, { roomId: db.room, userId: user })).rows;
  assert.deepEqual(await room({ from: "turns" }, db.users[N]), [], "a running game isn't included");
  await setStatus("finished");
  const games = await room({ from: "turns", groupBy: ["game"], aggregates: [{ fn: "count", as: "n" }] }, db.users[N]);
  assert.deepEqual(games, [{ game: db.short, n: db.records.length }]);
  const mine = await room({ from: "turns", scope: "myBee", aggregates: [{ fn: "count", as: "n" }] }, db.users[2]);
  assert.equal(mine[0].n, db.records.filter((t) => t.bee === 2).length);
  assert.equal((await room({ from: "turns", where: [W("ms", "isNull", false)], aggregates: [{ fn: "count", as: "n" }] }, db.users[N]))[0].n,
    db.records.filter((t) => t.ms !== null).length, "fully revealed");
});

test("scores use each game's exponents: its config's (0.85 by default), or √ for a game stored without them, in SQL and the views", async () => {
  const { score, scoringOf } = await import("../server/lib/scoring.js");
  const { viewScores, viewGame } = await import("../server/games.js");
  const pick = (rows) => rows.map((r) => [r.team ?? r.teamId, r.pollination, r.forage, r.pollinationShare, r.forageShare, r.fitness]);
  const expect = (exps) => pick(score(db.teams, db.out.feeds, db.out.nectar, db.out.pollen, exps).map((s, team) => ({ ...s, team })));
  const roomRow = (await pool.query("SELECT * FROM rooms WHERE id = $1", [db.room])).rows[0];
  const check = async (exps, what) => {
    same(pick(await sql({ from: "scores" }, db.users[N])), expect(exps), `${what}: the scores entity`);
    same(pick((await viewScores({ id: db.game })).scores.map((s, team) => ({ ...s, team }))), expect(exps), `${what}: the live scoreboard`);
    const view = await viewGame(roomRow, { id: db.game }, null);
    assert.deepEqual(view.game.config.scoring, exps, `${what}: the view's config says which`);
  };
  try {
    await setStatus("finished");
    assert.deepEqual(scoringOf(db.config), { alpha: 0.85, beta: 0.85 });
    await check({ alpha: 0.85, beta: 0.85 }, "a new game");
    // The same game as stored before the exponents existed: √, exactly the old numbers.
    await pool.query("UPDATE games SET config = config - 'scoring' WHERE id = $1", [db.game]);
    await check({ alpha: 0.5, beta: 0.5 }, "a game from before");
    const root = (v) => v.reduce((s, x) => s + Math.sqrt(Math.max(0, x)), 0);
    const rows = await sql({ from: "scores" }, db.users[N]);
    same(rows.map((r) => [r.pollination, r.forage]), rows.map((r) => [root(db.out.pollen.map((row) => row[r.team])), root(db.out.nectar[r.team])]), "Σ√, as before");
    await pool.query("UPDATE games SET config = jsonb_set(config, '{scoring}', $2::jsonb) WHERE id = $1", [db.game, JSON.stringify({ alpha: 0.6, beta: 1 })]);
    await check({ alpha: 0.6, beta: 1 }, "a game with its own exponents");
  } finally {
    await pool.query("UPDATE games SET config = $2 WHERE id = $1", [db.game, db.config]);
  }
});

test("species prevalence: one row per species per sample, the garden's own; public to everyone; p sums to 1", async () => {
  await setStatus("running");
  const samples = db.out.samples;
  assert.ok(samples.length >= 15, `${samples.length} samples in 80 rounds (one every 5)`);
  for (const v of viewers()) {
    const rows = await sql({ from: "prevalence", limit: MAX_LIMIT }, v.user);
    assert.equal(rows.length, samples.length * N, v.name);
    same(rows, samples.flatMap((x) => x.p.map((p, team) => ({ game: db.short, round: x.round, atMs: x.atMs, team, p, success: x.P[team], c: x.c }))), `${v.name}: the samples`);
  }
  const totals = await sql({ from: "prevalence", groupBy: ["round"], aggregates: [{ fn: "sum", field: "p", as: "t" }] }, db.users[N]);
  assert.ok(totals.every((r) => Math.abs(r.t - 1) < 1e-5), JSON.stringify(totals));
});

test("big responses: the record shows their size and hash; the whole text is stored apart, and served by seq", async () => {
  const { viewResponse } = await import("../server/games.js");
  const big = db.records.filter((t) => t.responseHash !== null);
  assert.ok(big.length >= 3, `${big.length} big responses`);
  for (const t of big.slice(0, 5)) {
    assert.equal(t.response, null);
    assert.ok(t.responseBytes > 4096);
    const text = await viewResponse({ id: db.game }, t.seq);
    assert.equal(Buffer.byteLength(text), t.responseBytes);
    assert.equal(crypto.createHash("sha256").update(text).digest("hex"), t.responseHash);
    assert.deepEqual(JSON.parse(text), Array.from({ length: 1500 }, (_, i) => t.challenge + i));
    // The action (what pages and live feeds carry) has the preview.
    const a = db.out.actions.find((x) => x.seq === t.seq);
    assert.equal(a.r, null);
    assert.equal(a.rPreview, text.slice(0, 4096), "(ASCII: the first 4,096 characters)");
    assert.equal(a.rHash, t.responseHash);
  }
  const small = db.records.find((t) => t.responseHash === null && t.response !== null);
  assert.equal(await viewResponse({ id: db.game }, small.seq), JSON.stringify(small.response));
  const failed = db.records.find((t) => t.response === null && t.responseBytes === null);
  assert.equal(await viewResponse({ id: db.game }, failed.seq), null, "a failed flower's turn has no response");
  // Queries see the same: response null, size and hash public.
  const rows = await sql({ from: "turns", where: [W("responseHash", "isNull", false)], select: ["seq", "response", "responseBytes"] }, null);
  assert.deepEqual(rows.map((r) => r.seq).sort((x, y) => x - y), big.map((t) => t.seq).sort((x, y) => x - y));
  assert.ok(rows.every((r) => r.response === null && r.responseBytes > 4096));
});

test("bad queries are refused with a reason; limits are capped", async () => {
  const bad = [
    [{ from: "nope" }, /unknown entity/],
    [{ from: "turns", where: [W("percent", "gt", "x")] }, /isn't a float/],
    [{ from: "turns", where: [W("challenge", "lt", 3)] }, /takes eq, ne, in, isNull/],
    [{ from: "turns", where: [W("round", "eq", 1.5)] }, /isn't an int/],
    [{ from: "turns", where: [W("bee", "eq", null)] }, /use is_?[nN]ull/],
    [{ from: "turns", groupBy: ["challenge"] }, /can't be grouped/],
    [{ from: "turns", aggregates: [{ fn: "sum", field: "fed" }] }, /doesn't apply/],
    [{ from: "turns", select: ["round"], aggregates: [{ fn: "count" }] }, /select can't be combined/],
    [{ from: "turns", orderBy: [{ field: "challenge" }] }, /can't be sorted/],
    [{ from: "turns", limit: -1 }, /limit/],
    [{ from: "turns", drop: "table" }, /unknown query key/],
    [{ from: "turns", aggregates: [{ fn: "count", as: 'x"; drop' }] }, /valid name/],
    [{ from: "versions", scope: "myBee" }, /no scope "myBee"/],
  ];
  for (const [ast, msg] of bad) {
    await assert.rejects(runQuery(ast, { gameId: db.game, userId: null }), (e) => e.status === 400 && msg.test(e.message), JSON.stringify(ast));
    assert.throws(() => new H.Table(ast.from in SCHEMA.entities ? ast.from : "turns").run(ast), msg);
    const py = python({ mode: "run", entity: ast.from in SCHEMA.entities ? ast.from : "turns", records: [], team: null, queries: [ast] });
    assert.match(py[0].error, msg, JSON.stringify(ast));
  }
  const big = await runQuery({ from: "turns", limit: 100000 }, { gameId: db.game, userId: null });
  assert.equal(big.truncated, false, "fewer rows than the cap");
  const small = await runQuery({ from: "turns", limit: 10 }, { gameId: db.game, userId: null });
  assert.equal(small.rows.length, 10);
  assert.equal(small.truncated, true);
});

test("the builders build the same AST in Python and TypeScript", () => {
  const pairs = [
    [`T['turns'].eq('fed', True).rounds(5, 9).order_by('round', desc=True).limit(3)`, (T) => T.turns.eq("fed", true).rounds(5, 9).orderBy("round", "desc").limit(3)],
    [`T['turns'].my_bee().group_by('flower').sum('nectar').count()`, (T) => T.turns.myBee().groupBy("flower").sum("nectar").count()],
    [`T['turns'].in_('bee', [1, 2]).is_null('percent').not_null('response').select('round', 'bee')`, (T) => T.turns.in("bee", [1, 2]).isNull("percent").notNull("response").select("round", "bee")],
    [`T['turns'].between('energy', 1, 2).avg('pollen', as_='p').min('energy').max('energy', 'top')`, (T) => T.turns.between("energy", 1, 2).avg("pollen", "p").min("energy").max("energy", "top")],
    [`T['versions'].mine().eq('kind', 'bee').order_by('at_ms', desc=True).offset(2)`, (T) => T.versions.mine().eq("kind", "bee").orderBy("atMs", "desc").offset(2)],
    [`T['turns'].count('bee_ms', as_='timed').ne('flower_error', 'x').lt('ms', 3).le('round', 9).gt('pollen', 0).ge('turn', 2)`,
      (T) => T.turns.count("beeMs", "timed").ne("flowerError", "x").lt("ms", 3).le("round", 9).gt("pollen", 0).ge("turn", 2)],
    [`T['scores'].mine().order_by('fitness', desc=True).limit(1)`, (T) => T.scores.mine().orderBy("fitness", "desc").limit(1)],
    [`T['turns'].my_flower().eq('challenge', {'a': [1, 2]})`, (T) => T.turns.myFlower().eq("challenge", { a: [1, 2] })],
  ];
  const T = Object.fromEntries(Object.keys(SCHEMA.entities).map((e) => [e, new H.Table(e).query(0)]));
  const py = python({ mode: "build", team: 0, exprs: pairs.map(([p]) => p) });
  for (const [i, [p, ts]] of pairs.entries()) assert.deepEqual(py[i], JSON.parse(JSON.stringify(ts(T).ast())), p);
  // Default aggregate names follow each language's field names.
  assert.deepEqual(python({ mode: "build", team: 0, exprs: [`T['turns'].count('bee_ms')`] })[0].aggregates, [{ fn: "count", field: "beeMs", as: "count_bee_ms" }]);
  assert.deepEqual(T.turns.count("beeMs").ast().aggregates, [{ fn: "count", field: "beeMs", as: "count_beeMs" }]);
});

test("immutability: queries, results, records and local().history can't be changed, in either language", () => {
  const recs = db.records.slice(0, 30);
  const local = H.local(recs, 1);
  const q = local.turns;
  const q2 = q.eq("fed", true);
  assert.notEqual(q, q2);
  assert.deepEqual(q.ast(), { from: "turns" }, "the original query is unchanged");
  for (const x of [q, q2, q2.ast(), q2.ast().where, q2.ast().where[0], local, local.history]) assert.ok(Object.isFrozen(x));
  const rows = q.rows();
  assert.ok(Object.isFrozen(rows) && rows.every((r) => Object.isFrozen(r)));
  assert.throws(() => { "use strict"; rows[0].round = 9; });
  assert.throws(() => { "use strict"; rows.push(1); });
  const agg = q.groupBy("flower").count().rows();
  assert.ok(Object.isFrozen(agg) && Object.isFrozen(agg[0]));
  assert.equal(typeof local.history.append, "undefined", "history has no append");
  assert.equal(local.history.turns.rows().length, 30);
  local.append(db.records.slice(30, 40));
  assert.equal(local.history.turns.rows().length, 40, "append() reaches the same history");
  const py = python({ mode: "immutable" });
  for (const [check, ok] of Object.entries(py)) assert.ok(ok, `python: ${check}`);
});

test("the arena's hooks: local(records, team) with append(), and connect(..., post) over a caller's transport", async () => {
  await setStatus("running");
  const team = 2, user = db.users[team];
  const exprs = [
    [`h.turns.my_bee().eq('fed', True).group_by('flower').sum('nectar').count()`, (h) => h.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").count()],
    [`h.turns.rounds(10, 12)`, (h) => h.turns.rounds(10, 12)],
    [`h.scores.order_by('fitness', desc=True)`, (h) => h.scores.orderBy("fitness", "desc")],
    [`h.turns.select('round', 'bee_ms').limit(5)`, (h) => h.turns.select("round", "beeMs").limit(5)],
    [`h.teams.mine()`, (h) => h.teams.mine()],
  ];
  // TypeScript: post() runs the query in SQL as this team.
  const posts = [];
  const h = H.connect({ room: "R", game: "G", post: async (p, ast) => { posts.push(p); return runQuery(ast, { gameId: db.game, userId: user }); } });
  const pages = {};
  for (const [, ts] of exprs) {
    const ast = ts(h).ast();
    const expected = await sql(ast, user);
    same([...(await ts(h).rows())], expected, JSON.stringify(ast));
    pages[canonicalJson(H.validate(ast))] = { rows: expected, truncated: false };
  }
  assert.ok(posts.every((p) => p === "/api/rooms/R/games/G/query"));
  assert.equal(await h.turns.myBee().count().value(), db.records.filter((t) => t.bee === team).length, "value() works remotely");
  // Python: the same, through post() returning the pages SQL gave.
  const py = python({ mode: "remote", pages, exprs: exprs.map(([p]) => p) });
  for (const [i, [, ts]] of exprs.entries()) same(py.rows[i], pages[canonicalJson(H.validate(ts(h).ast()))].rows, exprs[i][0]);
  assert.ok(py.posts.every(([p]) => p === "/api/rooms/R/games/G/query"));
  // local(): a scaffold's history over the turn records it holds, appended as they come, as its programs see it.
  const records = await sql({ from: "turns", limit: MAX_LIMIT }, user);
  const local = H.local(records.slice(0, 100), team);
  local.append(records.slice(100));
  for (const ast of TURN_QUERIES) same([...local.run(ast)], await sql(ast, user), JSON.stringify(ast));
  same([...local.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").rows()],
    await sql({ from: "turns", scope: "myBee", where: [W("fed", "eq", true)], groupBy: ["flower"], aggregates: [{ fn: "sum", field: "nectar", as: "sum_nectar" }] }, user));
});

test("the generated clients are up to date with the schema (npm run gen:query)", () => {
  assert.deepEqual(stale(), [], "vendor/query is stale: run npm run gen:query");
});

test("performance: typical queries on a 20,000-turn history take well under a millisecond", () => {
  const history = [];
  const R = 2500;
  for (let round = 1; round <= R; round++) {
    for (let bee = 0; bee < 8; bee++) {
      const fed = (round + bee) % 3 === 0, flower = (round * 7 + bee * 3) % 8, energy = 100000 + ((round * 31 + bee) % 997) * 50;
      const own = flower === 3 || bee === 3;
      history.push({ game: "g", round, atMs: (round - 1) * 200, turn: round, bee, flower, challenge: round % 97, response: (round * 13) % 101, fed,
        percent: fed || flower === 3 ? 40 : null, energy: fed || flower === 3 ? energy : null, nectar: fed ? 0.4 * energy : null, pollen: fed ? 0.6 * energy : 0,
        ms: flower === 3 ? 2 : null, flowerVersion: flower === 3 ? 1 : null, flowerError: null, beeMs: bee === 3 ? 3 : null, beeVersion: bee === 3 ? 1 : null, beeError: null, own });
    }
  }
  for (const r of history) delete r.own;
  const QUERIES = {
    "count all": [`h.turns.count()`, (h) => h.turns.count()],
    "my bee's nectar by flower (cells)": [`h.turns.my_bee().eq('fed', True).group_by('flower').sum('nectar').count()`, (h) => h.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").count()],
    "avg percent by flower on feeds (cells)": [`h.turns.eq('fed', True).group_by('flower').avg('percent')`, (h) => h.turns.eq("fed", true).groupBy("flower").avg("percent")],
    "one pair's feeds (cells)": [`h.turns.eq('bee', 2).eq('flower', 5).eq('fed', True).count()`, (h) => h.turns.eq("bee", 2).eq("flower", 5).eq("fed", true).count()],
    "my flower, last 50 rounds (index + range)": [`h.turns.my_flower().between('round', R - 49, R)`, (h) => h.turns.myFlower().between("round", R - 49, R)],
    "my bee's last 10 turns (index, newest first)": [`h.turns.my_bee().order_by('round', desc=True).limit(10)`, (h) => h.turns.myBee().orderBy("round", "desc").limit(10)],
    "the turns since the last call (slice)": [`h.turns.offset(len(h.turns.rows()) - 8)`, (h) => h.turns.offset(history.length - 8)],
    "flower 5's answers to 7, last 100 rounds (index + range + filter)": [`h.turns.eq('flower', 5).ge('round', R - 100).eq('challenge', 7).select('response', 'fed')`,
      (h) => h.turns.eq("flower", 5).ge("round", R - 100).eq("challenge", 7).select("response", "fed")],
    "every turn with challenge 7 (a full scan)": [`h.turns.eq('challenge', 7)`, (h) => h.turns.eq("challenge", 7)],
  };
  const SCANS = new Set(["every turn with challenge 7 (a full scan)"]);
  const local = H.local(history, 3);
  const ts = {};
  for (const [name, [, build]] of Object.entries(QUERIES)) {
    const q = build(local.history);
    q.rows();
    const n = 300, t0 = performance.now();
    for (let i = 0; i < n; i++) q.rows();
    ts[name] = ((performance.now() - t0) / n) * 1000;
  }
  const py = python({ mode: "bench", records: history, team: 3, rounds: R, repeat: 200,
    queries: Object.fromEntries(Object.entries(QUERIES).map(([name, [expr]]) => [name, expr])) });
  const table = Object.keys(QUERIES).map((name) => `  ${name.padEnd(68)} ${ts[name].toFixed(1).padStart(8)} µs (TS) ${py[name].toFixed(1).padStart(8)} µs (Python)`);
  console.log(`query time on a 20,000-turn history, per run:\n${table.join("\n")}`);
  for (const name of Object.keys(QUERIES)) {
    if (SCANS.has(name)) continue;
    assert.ok(ts[name] < 1000, `TypeScript, ${name}: ${ts[name].toFixed(1)} µs`);
    assert.ok(py[name] < 1000, `Python, ${name}: ${py[name].toFixed(1)} µs`);
  }
});
