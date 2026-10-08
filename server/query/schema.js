// The history schema: the single source of truth for querying a game's history. Everything else is
// derived from it:
//   - the SQL each entity is read from, with per-viewer visibility (server/query/sql.js)
//   - each record as a team may see it (server/query/mask.js: the ledger endpoint, and the in-memory
//     executors' records)
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
//   grain         the team whose bee took the turn (turns.bee); everyone, if the game's grains are "public"
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
export const VISIBILITY = ["public", "flower", "bee", "publicOnFeed", "team", "code", "grain"];

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
      program: true, // what local(records, team) holds (vendor/query/): the entity built up incrementally
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("seq", "int", "public", "the number of the turn's feed or leave action (GET .../responses/:seq has its whole response)"),
        f("round", "int", "public", "the round the turn was taken in (1, 2, ...)"),
        f("atMs", "int", "public", "game time the round began: (round - 1) × round_ms"),
        f("turn", "int", "public", "the bee's turn number (1, 2, ...)"),
        f("bee", "int", "public", "the bee's team index"),
        f("flower", "int", "public", "the flower's team index"),
        f("challenge", "json", "public", "the bee's challenge"),
        f("response", "json", "public", "the flower's response (null if it failed, or if its JSON is over 4 KB: see responseBytes)", true),
        f("responseBytes", "int", "public", "the response's size: UTF-8 bytes of its JSON text (null if it failed)", true),
        f("responseHash", "str", "public", "an identifier of the full response; null unless the response is over 4 KB", true),
        f("fed", "bool", "public", "whether the bee fed"),
        f("percent", "float", "publicOnFeed", "the share of E the flower offered, 0-100 (null if it failed)", true),
        f("energy", "float", "publicOnFeed", "E, the flower's excess energy (node·ms·bytes with the game's byte factor, else node·ms; 0 if it failed)", true),
        f("nectar", "float", "public", "the nectar the flower gave the bee: percent/100 × E on a feed, else null", true),
        f("price", "float", "public", "on a feed, the feed price the bee paid out of its nectar (0 in games without one), else null", true),
        f("net", "float", "public", "on a feed, the bee's net nectar: nectar - price (it can be negative), else null", true),
        f("balance", "float", "public", "on a feed in a pools game, the bee's nectar balance after it; else null", true),
        f("pollen", "float", "public", "the pollen the flower gave the bee: (1 − percent/100) × E on a feed, else 0"),
        f("ms", "float", "flower", "the flower's CPU time for the call (ms)", true),
        f("budgetMs", "float", "flower", "R: the call's hidden time budget (ms of CPU time, uniform in minMs..ms): its hard limit, and E's ceiling", true),
        f("flowerVersion", "int", "flower", "the flower version that answered", true),
        f("flowerError", "str", "flower", "why the response is null (a timeout, an error, a malformed return); \"server fault: ...\" on a void turn", true),
        f("beeMs", "float", "bee", "the bee's CPU time to decide (ms; null if it was late)", true),
        f("beeVersion", "int", "bee", "the bee version that decided", true),
        f("beeError", "str", "bee", "what went wrong with the bee's reply (late, a crash, a bad next challenge); \"server fault: ...\" on a void turn", true),
        f("grain", "str", "grain", "on a feed, the pollen grain: ⌊scale × pollen^exponent⌋ characters (⌊0.1 × pollen^(1/3)⌋ by default) of the answering flower version's minified code, from a random start, wrapping", true),
        f("grainVersion", "int", "grain", "the flower version the grain came from", true),
        f("grainCodeLength", "int", "grain", "that version's minified code's length in characters", true),
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
        f("memoryBytes", "int", "team", "its size: Σ over entries of the key's UTF-8 bytes + the value's JSON bytes", true),
        f("memoryVersion", "int", "team", "the bee version it belongs to", true),
        f("memoryError", "str", "team", "why its last save failed (over the cap, the wrong shape, fed() failed), if it did", true),
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
    prevalence: {
      record: "Prevalence",
      doc: "Prevalence on both sides (games that have it): every team's flower and bee success and draw chances, and its fitness so far, sampled about once a second of game time.",
      key: ["game", "round", "team"],
      sortedBy: "round",
      index: [["team"]],
      cells: [],
      scopes: { mine: ["team"] },
      owner: "team",
      program: false,
      fields: [
        f("game", "str", "public", "the game's short id"),
        f("round", "int", "public", "the round whose draws it gave (sampled as the round began)"),
        f("atMs", "int", "public", "game time that round began: (round - 1) × round_ms"),
        f("team", "int", "public", "the team's index (its species and its bee)"),
        f("flowerSuccess", "float", "public", "F_s: N × its species' share of recent pollination (Σ over bee teams of decayed pollen^beta), capped; par 1"),
        f("beeSuccess", "float", "public", "B_b: N × its bee's share of recent net nectar, capped; par 1 (pools: of its nectar balance; else of max(0, Σ over species of signed decayed (nectar - price)^alpha))"),
        f("flowerP", "float", "public", "p^F_s: the chance a visit is to its species, (c + F_s) / Σ (c + F_k)"),
        f("beeP", "float", "public", "p^B_b: its bee's share of the bee weights, (c + B_b) / Σ (c + B_k): the chance it fills a given slot first"),
        f("fitness", "float", "public", "its fitness at the sample, by the game's scoring.mode: \"final\", N² × p^F_s × p^B_s of that round; \"timeAverage\" (v2, v3), the time-average of F × B over the rounds played", true),
        f("balance", "float", "public", "its bee's nectar balance at the sample (pools games), else null", true),
        f("c", "float", "public", "c(t): the weight every species and bee has whatever its success, cEnd + (cStart - cEnd) × 2^(-t / cHalfLifeS) (v2, v3: linear from cStart to cEnd over the game)"),
        f("slots", "int", "public", "bees visiting each round: ceil(slots × N)", true),
      ],
    },
    scores: {
      record: "Score",
      doc: "The scoreboard: each team's fitness (the game's rule), pollination, forage and shares over the whole game, and its latest prevalence.",
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
        f("pollination", "float", "public", "Σ over bee teams of (pollen this species gave their bee)^beta (the game's scoring.beta; √ in games without one)"),
        f("forage", "float", "public", "Σ over flower teams of (nectar this bee got there)^alpha (the game's scoring.alpha; √ in games without one)"),
        f("pollinationShare", "float", "public", "pollination ÷ everyone's (1/N if that is 0)"),
        f("forageShare", "float", "public", "forage ÷ everyone's (1/N if that is 0)"),
        f("fitness", "float", "public", "with prevalence, by the game's scoring.mode: \"final\", N² × p^F_s × p^B_s at the latest round played (the final round once the game is over); \"timeAverage\" (v2, v3), the time-average of F × B over the rounds played. Else N² × pollination share × forage share. Par 1"),
        f("flowerSuccess", "float", "public", "with prevalence, F_s at the latest sample, else null", true),
        f("beeSuccess", "float", "public", "with prevalence, B_b at the latest sample, else null", true),
        f("flowerP", "float", "public", "with prevalence, p^F_s at the latest sample, else null", true),
        f("beeP", "float", "public", "with prevalence, p^B_b at the latest sample, else null", true),
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
