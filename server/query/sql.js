// The SQL executor: a query AST (docs/QUERY.md) compiled to parameterised SQL, for one game or for a room's
// finished games, as one viewer may see it. Visibility is enforced in SQL: each entity is read through a
// subquery (`src`) that masks, per row, every field the viewer may not see (the schema's rules, as in
// mask.js) and leaves out rows they may not see, before any filter, sort or aggregate runs. Values only
// ever travel as parameters.
import { createRequire } from "node:module";
import { tx } from "../db/pool.js";
import { SCHEMA } from "./schema.js";
import { scoreboard } from "../lib/prevalence.js";
import { snapshotsOf } from "../lib/gameConfig.js";
import { BEE_SIDE, FLOWER_SIDE } from "./mask.js";

const require = createRequire(import.meta.url);
const History = require("../../vendor/query/history.js");

export const LIMIT = 1000;      // rows when the query doesn't say
export const MAX_LIMIT = 5000;  // rows at most
export const TIMEOUT_MS = 2000; // per query

const q = (name) => `"${name.replace(/"/g, '""')}"`;
const CAST = { int: "::bigint", float: "::float8", bool: "::boolean", str: "::text", json: "::jsonb" };

// How each entity is read: its FROM clause, each field's SQL, and the SQL of the team fields its visibility
// rules refer to (bee, flower, fed, owner).
const SOURCES = {
  turns: {
    from: `actions a JOIN gs ON gs.id = a.game_id
      JOIN pt pb ON pb.game_id = a.game_id AND pb.team_id = a.bee_team
      JOIN pt pf ON pf.game_id = a.game_id AND pf.team_id = a.flower_team
      WHERE a.action IN ('feed', 'leave')`,
    roles: { bee: "pb.idx", flower: "pf.idx", fed: "(a.action = 'feed')" },
    cols: {
      game: "gs.short", seq: "a.seq::int", round: "a.round::int", atMs: "(a.at_ms - gs.window_ms)::int", turn: "a.turn", bee: "pb.idx", flower: "pf.idx",
      challenge: "a.c", response: "a.r", responseBytes: "a.r_bytes", responseHash: "a.r_hash",
      fed: "(a.action = 'feed')", percent: "a.percent", energy: "a.energy", nectar: "a.nectar",
      price: "CASE WHEN a.action = 'feed' THEN coalesce(a.price, 0) END", net: "CASE WHEN a.action = 'feed' THEN a.nectar - coalesce(a.price, 0) END",
      balance: "CASE WHEN a.action = 'feed' THEN a.balance END",
      pollen: "coalesce(a.pollen, 0)", ms: "a.cpu_ms", budgetMs: "a.budget_ms", flowerVersion: "a.flower_version", flowerError: "a.flower_error",
      beeMs: "a.bee_ms", beeVersion: "a.bee_version", beeError: "a.bee_error",
      grain: "a.grain", grainVersion: "a.grain_version", grainCodeLength: "a.grain_code_length",
    },
  },
  versions: {
    from: `programs p JOIN gs ON gs.id = p.game_id JOIN pt ON pt.game_id = p.game_id AND pt.team_id = p.team_id`,
    roles: { owner: "pt.idx" },
    cols: {
      game: "gs.short", team: "pt.idx", kind: "p.kind", version: "p.version", atMs: "p.at_ms::int", round: "(p.at_ms / gs.round_ms + 1)::int",
      size: "p.size", distance: "p.distance", cost: "p.cost", problem: "p.problem", code: "p.code",
    },
  },
  teams: {
    from: `teams t JOIN gs ON gs.id = t.game_id JOIN pt ON pt.game_id = t.game_id AND pt.team_id = t.id
      LEFT JOIN bee_memories bm ON bm.game_id = t.game_id AND bm.team_id = t.id`,
    roles: { owner: "pt.idx" },
    cols: {
      game: "gs.short", index: "pt.idx", id: "t.id::text", name: "t.name", color: "t.color",
      members: "(SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id)",
      memory: "coalesce(bm.memory, '{}')::jsonb", memoryBytes: "coalesce(bm.bytes, 0)", memoryVersion: "bm.bee_version", memoryError: "bm.error",
    },
  },
  pairs: {
    from: `gs JOIN games g ON g.id = gs.id,
      jsonb_array_elements(g.feeds) WITH ORDINALITY AS lb(row, bo),
      jsonb_array_elements(lb.row) WITH ORDINALITY AS lf(v, fo)`,
    roles: {},
    cols: {
      game: "gs.short", bee: "(lb.bo - 1)::int", flower: "(lf.fo - 1)::int", feeds: "(lf.v)::int",
      nectar: "coalesce((g.nectar -> (lb.bo - 1)::int -> (lf.fo - 1)::int)::float8, 0)",
      pollen: "coalesce((g.pollen -> (lb.bo - 1)::int -> (lf.fo - 1)::int)::float8, 0)",
    },
  },
  prevalence: {
    from: `prevalence x JOIN gs ON gs.id = x.game_id, jsonb_array_elements(x.flower_p) WITH ORDINALITY AS e(v, o)
      WHERE x.bee_p IS NOT NULL`,
    roles: { owner: "(e.o - 1)::int" },
    cols: {
      game: "gs.short", round: "x.round::int", atMs: "x.at_ms::int", team: "(e.o - 1)::int",
      flowerSuccess: "(x.flower_success -> (e.o - 1)::int)::float8", beeSuccess: "(x.bee_success -> (e.o - 1)::int)::float8",
      flowerP: "(e.v)::float8", beeP: "(x.bee_p -> (e.o - 1)::int)::float8", fitness: "(x.fitness -> (e.o - 1)::int)::float8",
      balance: "(x.bee_balance -> (e.o - 1)::int)::float8", c: "x.c", slots: "x.slots",
    },
  },
  scores: {
    // Computed by server/lib/prevalence.js scoreboard (the one definition of the score) and passed in as a parameter.
    from: (param) => `jsonb_to_recordset(${param}::jsonb) AS s(${SCHEMA.entities.scores.fields.map((f) => `${q(f.name)} ${f.type === "str" ? "text" : f.type === "int" ? "int" : "float8"}`).join(", ")})
      JOIN gs ON gs.short = s.game`,
    roles: { owner: "s.team" },
    cols: Object.fromEntries(SCHEMA.entities.scores.fields.map((f) => [f.name, `s.${q(f.name)}`])),
  },
};

/** The SQL condition under which the viewer may see a field with this visibility (null: always). */
function visibleSql(vis, roles) {
  switch (vis) {
    case "public": return null;
    case "flower": return `gs.over OR ${roles.flower} = gs.viewer`;
    case "bee": return `gs.over OR ${roles.bee} = gs.viewer`;
    case "publicOnFeed": return `gs.over OR ${roles.fed} OR ${roles.flower} = gs.viewer`;
    case "team": return `gs.over OR ${roles.owner} = gs.viewer`;
    case "code": return `gs.revealed OR ${roles.owner} = gs.viewer`;
    case "grain": return `gs.over OR gs.grains_public OR ${roles.bee} = gs.viewer`;
    default: throw new Error(`unknown visibility "${vis}"`);
  }
}

/** SQL: whether a prevalence sample at `col` (game ms) is a snapshot of a game with `config` (games.js snapshotSql). */
function snapshotCond(col, config) {
  const { everyMs, sampleMs } = snapshotsOf(config);
  const P = Math.max(1, Math.round(everyMs)), S = Math.max(1, Math.round(sampleMs));
  return `(${col} = 0 OR floor(${col}::float8 / ${P}) > floor((${col} - ${S})::float8 / ${P}))`;
}

// Private play (`restricted`: one game, games.js restrictedFor): turns are the viewer's team's own programs' sides
// (one row per side: its flower's, its bee's; a spectator none, mask.js FLOWER_SIDE / BEE_SIDE), pairs are empty,
// prevalence is its snapshots rounded to 2 decimals without balances, and scores the latest snapshot's (scoreRows).
const SNAPSHOT_ROUNDED = new Set(["flowerSuccess", "beeSuccess", "flowerP", "beeP", "fitness", "c"]);

/**
 * Compile a validated AST. `where` picks the games: { gameId } (one game, as it stands) or { roomId } (its
 * finished games). `userId` is the viewer (null: a spectator); `restricted`: the viewer sees that one game
 * privately (its `config` gives the snapshots). Returns { text, params, limit }.
 */
export function compile(ast, { gameId = null, roomId = null, userId = null, scores = null, restricted = false, config = null }) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const e = SCHEMA.entities[ast.from];
  const source = SOURCES[ast.from];
  const games = gameId ? `g.id = ${p(gameId)}::uuid` : `g.room_id = ${p(roomId)}::uuid AND g.status = 'finished'`;
  const viewer = p(userId);
  const cte = `WITH gs AS (
    SELECT g.id, substr(g.code, 1, g.prefix_len) AS short, g.participants, g.status = 'finished' AS over,
      (g.status = 'finished' AND coalesce((g.config->>'revealOnFinish')::boolean, true)) AS revealed,
      coalesce(g.config->>'grains', 'feeder') = 'public' AS grains_public,
      -- the flower window: flowerWindowMs (at least the flower's ms), or the flower's ms in games from before it
      greatest(coalesce((g.config->>'flowerWindowMs')::int, 0), (g.config->'budgets'->'flower'->>'ms')::int) AS window_ms,
      (greatest(coalesce((g.config->>'flowerWindowMs')::int, 0), (g.config->'budgets'->'flower'->>'ms')::int) + (g.config->'budgets'->'bee'->>'ms')::int) AS round_ms,
      (SELECT (array_position(g.participants, m.team_id) - 1)::int FROM team_members m
        WHERE m.game_id = g.id AND m.user_id = ${viewer}::uuid) AS viewer
    FROM games g WHERE ${games} AND g.participants IS NOT NULL
  ), pt AS (
    SELECT gs.id AS game_id, t.id AS team_id, (t.ord - 1)::int AS idx FROM gs, unnest(gs.participants) WITH ORDINALITY AS t(id, ord)
  )`;
  const priv = restricted && !!gameId;
  const cols = e.fields.map((f) => {
    const expr = source.cols[f.name];
    if (priv && ast.from === "turns") {
      // One row per side the viewer's team played: only that side's fields.
      const side = (set) => (set.has(f.name) ? expr : `NULL${CAST[f.type]}`);
      return `CASE WHEN sd.side = 'flower' THEN ${side(FLOWER_SIDE)} ELSE ${side(BEE_SIDE)} END AS ${q(f.name)}`;
    }
    if (priv && ast.from === "prevalence") {
      if (f.name === "balance") return `NULL::float8 AS ${q(f.name)}`;
      if (SNAPSHOT_ROUNDED.has(f.name)) return `round((${expr})::numeric, 2)::float8 AS ${q(f.name)}`;
    }
    const cond = visibleSql(f.visibility, source.roles);
    return `${cond ? `CASE WHEN ${cond} THEN ${expr} END` : expr} AS ${q(f.name)}`;
  });
  let from = typeof source.from === "function" ? source.from(p(JSON.stringify(scores ?? []))) : source.from;
  if (priv && ast.from === "turns") {
    from = from.replace(/\bWHERE\b/, `CROSS JOIN (VALUES ('flower'), ('bee')) AS sd(side) WHERE`) +
      ` AND ((sd.side = 'flower' AND pf.idx = gs.viewer) OR (sd.side = 'bee' AND pb.idx = gs.viewer))`;
  }
  if (priv && ast.from === "pairs") from += " WHERE false";
  if (priv && ast.from === "prevalence") from += ` AND ${snapshotCond("x.at_ms", config)}`;
  if (e.rows === "team") from += `${/\bWHERE\b/.test(from) ? " AND" : " WHERE"} (gs.over OR ${source.roles.owner} = gs.viewer)`;
  const src = `src AS (SELECT ${cols.join(", ")}, gs.viewer AS "_viewer" FROM ${from})`;

  const type = (name) => e.fields.find((f) => f.name === name).type;
  const conds = (ast.where ?? []).map((c) => {
    const col = q(c.field), t = type(c.field), cast = CAST[t];
    const val = (v) => p(t === "json" ? JSON.stringify(v) : v) + cast;
    switch (c.op) {
      case "eq": return `${col} = ${val(c.value)}`;
      case "ne": return `${col} <> ${val(c.value)}`;
      case "lt": return `${col} < ${val(c.value)}`;
      case "le": return `${col} <= ${val(c.value)}`;
      case "gt": return `${col} > ${val(c.value)}`;
      case "ge": return `${col} >= ${val(c.value)}`;
      case "between": return `${col} BETWEEN ${val(c.value[0])} AND ${val(c.value[1])}`;
      case "in": return `${col} = ANY(${p(t === "json" ? c.value.map((v) => JSON.stringify(v)) : c.value)}${cast}[])`;
      case "isNull": return `${col} IS ${c.value ? "" : "NOT "}NULL`;
    }
  });
  if (ast.scope) conds.push(`(${e.scopes[ast.scope].map((f) => `${q(f)} = "_viewer"`).join(" OR ")})`);
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";

  const sortKey = (name, dir, isField) => `${q(name)}${isField && type(name) === "str" ? ' COLLATE "C"' : ""} ${dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
  const grouped = !!(ast.groupBy || ast.aggregates);
  let select, groupBy = "", order;
  if (grouped) {
    const group = ast.groupBy ?? [];
    const aggs = (ast.aggregates ?? []).map((a) => {
      const f = a.field ? q(a.field) : "*";
      const sql = a.fn === "count" ? `count(${f})` : a.fn === "sum" || a.fn === "avg" ? `${a.fn}(${f})::float8` : `${a.fn}(${f})`;
      return `${sql} AS ${q(a.as)}`;
    });
    select = [...group.map(q), ...aggs].join(", ");
    if (group.length) groupBy = ` GROUP BY ${group.map(q).join(", ")}`;
    const fields = new Set(group);
    order = [...(ast.orderBy ?? []).map((o) => sortKey(o.field, o.dir, fields.has(o.field))), ...group.map((g) => sortKey(g, "asc", true))];
  } else {
    select = (ast.select ?? e.fields.map((f) => f.name)).map(q).join(", ");
    order = [...(ast.orderBy ?? []).map((o) => sortKey(o.field, o.dir, true)), ...e.key.map((k) => sortKey(k, "asc", true))];
  }
  const limit = Math.min(ast.limit ?? LIMIT, MAX_LIMIT);
  const text = `${cte}, ${src} SELECT ${select} FROM src${where}${groupBy}${order.length ? ` ORDER BY ${order.join(", ")}` : ""}` +
    ` LIMIT ${p(limit + 1)} OFFSET ${p(ast.offset ?? 0)}`;
  return { text, params, limit };
}

/**
 * Run a query for a viewer: { rows, truncated }. Throws a QueryError (status 400) for a query the schema
 * doesn't allow.
 */
export async function runQuery(input, where) {
  let ast;
  try {
    ast = History.validate(input);
  } catch (e) {
    throw Object.assign(new Error(e.message), { status: 400 });
  }
  return tx(async (c) => {
    await c.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    let scores = null;
    if (ast.from === "scores") scores = await scoreRows(c, where);
    if (where.restricted && !where.config) throw new Error("a restricted query needs the game's config");
    const { text, params, limit } = compile(ast, { ...where, scores });
    const { rows } = await c.query(text, params);
    const truncated = rows.length > limit;
    return { rows: truncated ? rows.slice(0, limit) : rows, truncated };
  });
}

/** Every team's score in the games queried (public), as rows of the scores entity (in private play: the latest snapshot's). */
async function scoreRows(c, { gameId = null, roomId = null, restricted = false }) {
  const { rows } = await c.query(
    `SELECT id, substr(code, 1, prefix_len) AS short, config, participants, feeds, nectar, pollen, fitness, prevalence FROM games
      WHERE ${gameId ? "id = $1" : "room_id = $1 AND status = 'finished'"} AND participants IS NOT NULL`, [gameId ?? roomId]);
  const out = [];
  if (restricted && gameId) {
    const { latestSnapshot, snapshotScores } = await import("../games.js");
    for (const g of rows) {
      snapshotScores(g.participants, await latestSnapshot(g, c)).forEach((s, team) => {
        const { teamId, ...rest } = s;
        out.push({ game: g.short, team, ...rest });
      });
    }
    return out;
  }
  for (const g of rows) {
    const n = g.participants.length;
    const zero = () => Array.from({ length: n }, () => new Array(n).fill(0));
    scoreboard(g.config, g.participants, g.feeds ?? zero(), g.nectar ?? zero(), g.pollen ?? zero(), g.fitness, g.prevalence).forEach((s, team) => {
      const { teamId, ...rest } = s;
      out.push({ game: g.short, team, ...rest });
    });
  }
  return out;
}
