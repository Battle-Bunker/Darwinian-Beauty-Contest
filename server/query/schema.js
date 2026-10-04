// The history schema: the single source of truth for querying a game's history. Everything else is
// derived from it:
//   - the SQL each entity is read from, with per-viewer visibility (server/query/sql.js)
//   - the records programs get as HISTORY, masked for their team (server/query/mask.js)
//   - the typed client libraries, one per language (scripts/gen-query/, written to vendor/query/)
//   - vendor/query/schema.json, for anything else that wants it
// docs/QUERY.md describes the query AST, the executor algorithm and how to add a language.
//
// Field names are canonical camelCase; each language's emitter maps them to its own convention (Python:
// snake_case). Types:
//   int, float, bool, str: scalars. json: a value of the game's challenge or response type (any JSON).
// Visibility (who sees a field during play; once the game is over everyone sees everything, except code
// when the game isn't revealed):
//   public        everyone, spectators included
//   flower        the team whose flower took the turn (turns.flower)
//   bee           the team whose bee took the turn (turns.bee)
//   publicOnFeed  everyone on a turn where the bee fed, else the flower's team
//   team          the team the record belongs to (the entity's `owner` field)
//   code          the record's team; after the game everyone, if the game is revealed (revealOnFinish)
// An entity with `rows: "team"` shows each team only its own records during play.
// Hidden fields read as null: filters, sorts and aggregates see null too, so they never leak.

export const TYPES = {
  // ops: the conditions a field of this type takes; order: it can be sorted on; group: it can be grouped
  // by; aggregates: what can be computed over it (count works on every field, and on rows).
  int: { ops: ["eq", "ne", "lt", "le", "gt", "ge", "in", "between", "isNull"], order: true, group: true, aggregates: ["count", "sum", "avg", "min", "max"] },
  float: { ops: ["eq", "ne", "lt", "le", "gt", "ge", "in", "between", "isNull"], order: true, group: true, aggregates: ["count", "sum", "avg", "min", "max"] },
  bool: { ops: ["eq", "ne", "in", "isNull"], order: true, group: true, aggregates: ["count"] },
  str: { ops: ["eq", "ne", "in", "isNull"], order: true, group: true, aggregates: ["count"] },
  json: { ops: ["eq", "ne", "in", "isNull"], order: false, group: false, aggregates: ["count"] },
};

export const OPS = ["eq", "ne", "lt", "le", "gt", "ge", "in", "between", "isNull"];
export const AGGREGATES = ["count", "sum", "avg", "min", "max"];
export const VISIBILITY = ["public", "flower", "bee", "publicOnFeed", "team", "code"];

const f = (name, type, visibility, doc, nullable = false) => ({ name, type, nullable, visibility, doc });

export const SCHEMA = {
  version: 1,
  entities: {
    turns: {
      record: "Turn",
      doc: "One finished turn: a bee's challenge, a flower's response and the bee's decision.",
      // Natural order, also the unique key. Records are kept in this order; `sortedBy` is the field the
      // order starts with, so ranges on it are found by binary search.
      key: ["game", "round", "bee"],
      sortedBy: "round",
      // In-memory indexes (and Postgres indexes on the same columns): eq lookups on these fields.
      index: [["bee"], ["flower"], ["fed"], ["bee", "flower"]],
      // Running per-cell statistics (count, and sum / non-null count / min / max of every numeric field)
      // for every combination of these fields: aggregates over them are O(cells), not O(rows).
      cells: ["bee", "flower", "fed"],
      // Convenience scopes, resolved against the querying team.
      scopes: { myBee: ["bee"], myFlower: ["flower"], mine: ["bee", "flower"] },
      owner: null,
      program: true, // available to programs as HISTORY.turns
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("round", "int", "public", "the round the turn was taken in (1, 2, ...)"),
        f("atMs", "int", "public", "game time the round began: (round - 1) × round_ms"),
        f("turn", "int", "public", "the bee's turn number (1, 2, ...)"),
        f("bee", "int", "public", "the bee's team index"),
        f("flower", "int", "public", "the flower's team index"),
        f("challenge", "json", "public", "the bee's challenge"),
        f("response", "json", "public", "the flower's response (null if it failed)", true),
        f("fed", "bool", "public", "whether the bee fed"),
        f("percent", "float", "publicOnFeed", "the share of E the flower offered, 0-100 (null if it failed)", true),
        f("energy", "float", "publicOnFeed", "E, the flower's excess energy (node·ms; 0 if it failed)", true),
        f("nectar", "float", "public", "the nectar the flower gave the bee: percent/100 × E on a feed, else null", true),
        f("pollen", "float", "public", "the pollen the flower gave the bee: (1 − percent/100) × E on a feed, else 0"),
        f("ms", "float", "flower", "the flower's CPU time for the call (ms)", true),
        f("flowerVersion", "int", "flower", "the flower version that answered", true),
        f("flowerError", "str", "flower", "why the response is null (a timeout, an error, a malformed return)", true),
        f("beeMs", "float", "bee", "how long the bee took to decide (ms; null if it was late)", true),
        f("beeVersion", "int", "bee", "the bee version that decided", true),
        f("beeError", "str", "bee", "what went wrong with the bee's reply (late, a crash, a bad next challenge)", true),
      ],
    },
    versions: {
      record: "Version",
      doc: "Every version of every program: when it went live, its size and what the change cost.",
      key: ["game", "team", "kind", "version"],
      sortedBy: null,
      index: [["team"], ["kind"]],
      cells: [],
      scopes: { mine: ["team"] },
      owner: "team",
      rows: "team", // during play, only your own team's versions
      program: false,
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("team", "int", "public", "the team's index"),
        f("kind", "str", "public", "flower or bee"),
        f("version", "int", "public", "1, 2, ... per team and kind"),
        f("atMs", "int", "public", "game time it went live (0: written in the lobby)"),
        f("round", "int", "public", "the first round it could play in: atMs ÷ round_ms + 1"),
        f("size", "int", "public", "its size in nodes"),
        f("distance", "int", "public", "node edits from the version before (null when written in the lobby)", true),
        f("cost", "int", "public", "the change budget it cost (0 in the lobby)"),
        f("problem", "str", "public", "the first error it hit while playing", true),
        f("code", "str", "code", "its source", true),
      ],
    },
    teams: {
      record: "Team",
      doc: "The teams playing, by index.",
      key: ["game", "index"],
      sortedBy: null,
      index: [],
      cells: [],
      scopes: { mine: ["index"] },
      owner: "index",
      program: false,
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("index", "int", "public", "the team's index (GAME.team in its programs)"),
        f("id", "str", "public", "the team's id (as in actions and views)"),
        f("name", "str", "public", "the team's name"),
        f("color", "str", "public", "the team's colour"),
        f("members", "int", "public", "how many people are on the team"),
        f("memory", "json", "team", "the team's bee's MEMORY, as last saved", true),
        f("memoryBytes", "int", "team", "its size in bytes of canonical JSON", true),
        f("memoryVersion", "int", "team", "the bee version it belongs to", true),
      ],
    },
    pairs: {
      record: "Pair",
      doc: "The score ledgers, one row per (bee team, flower team): feeds, nectar and pollen over the whole game.",
      key: ["game", "bee", "flower"],
      sortedBy: null,
      index: [["bee"], ["flower"]],
      cells: [],
      scopes: { myBee: ["bee"], myFlower: ["flower"], mine: ["bee", "flower"] },
      owner: null,
      program: false,
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("bee", "int", "public", "the bee's team index"),
        f("flower", "int", "public", "the flower's team index"),
        f("feeds", "int", "public", "times this bee fed at this flower"),
        f("nectar", "float", "public", "nectar this bee got at this flower"),
        f("pollen", "float", "public", "the pollen this species gave this bee"),
      ],
    },
    scores: {
      record: "Score",
      doc: "The scoreboard: each team's pollination, forage, shares and fitness over the whole game.",
      key: ["game", "team"],
      sortedBy: null,
      index: [],
      cells: [],
      scopes: { mine: ["team"] },
      owner: "team",
      program: false,
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("team", "int", "public", "the team's index"),
        f("pollination", "float", "public", "Σ over bee teams of √(pollen this species gave their bee)"),
        f("forage", "float", "public", "Σ over flower teams of √(nectar this bee got there)"),
        f("pollinationShare", "float", "public", "pollination ÷ everyone's (1/N if that is 0)"),
        f("forageShare", "float", "public", "forage ÷ everyone's (1/N if that is 0)"),
        f("fitness", "float", "public", "N² × pollination share × forage share (par 1)"),
        f("pollen", "float", "public", "all the pollen this species gave"),
        f("feedsReceived", "int", "public", "feeds at this flower"),
        f("feedsGiven", "int", "public", "feeds by this bee"),
        f("pollinators", "int", "public", "bee teams that fed at this flower"),
        f("nectarCollected", "float", "public", "nectar this bee got"),
        f("nectarGiven", "float", "public", "nectar this flower paid"),
        f("nectarSources", "int", "public", "flower teams that paid this bee"),
      ],
    },
  },
};

/** An entity's schema, or throws. */
export function entity(name) {
  const e = SCHEMA.entities[name];
  if (!e) throw new QueryError(`unknown entity "${name}" (use ${Object.keys(SCHEMA.entities).join(", ")})`);
  return e;
}

/** A field of an entity, or undefined. */
export const field = (ent, name) => ent.fields.find((x) => x.name === name);

export const isNumeric = (fld) => fld.type === "int" || fld.type === "float";

export class QueryError extends Error {
  constructor(message) { super(message); this.status = 400; }
}
