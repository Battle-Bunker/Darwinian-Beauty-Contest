// Per-viewer visibility, from the schema's rules (server/query/schema.js): what a team (or a spectator) may
// see of a record. The ledger endpoint (server/games.js) uses it on turn records; server/query/sql.js enforces the same
// rules in SQL.
import { SCHEMA } from "./schema.js";

/**
 * May `viewer` (a team index, or null for a spectator) see field `f` of record `r`? `over`: the game is
 * finished (everything is visible); `revealed`: it is finished and revealed (code is visible);
 * `grainsPublic`: the game's grains are public as they happen.
 */
export function visible(entityName, f, r, viewer, { over = false, revealed = over, grainsPublic = false } = {}) {
  const e = SCHEMA.entities[entityName];
  const own = (team) => viewer !== null && viewer !== undefined && team === viewer;
  switch (f.visibility) {
    case "public": return true;
    case "flower": return over || own(r.flower);
    case "bee": return over || own(r.bee);
    case "publicOnFeed": return over || r.fed === true || own(r.flower);
    case "team": return over || own(r[e.owner]);
    case "code": return revealed || own(r[e.owner]);
    case "grain": return over || grainsPublic || own(r.bee);
    default: throw new Error(`unknown visibility "${f.visibility}"`);
  }
}

/** Whether the viewer may see the record at all (entities with rows: "team" show only your own during play). */
export function rowVisible(entityName, r, viewer, { over = false } = {}) {
  const e = SCHEMA.entities[entityName];
  return e.rows !== "team" || over || (viewer !== null && viewer !== undefined && r[e.owner] === viewer);
}

/** The record as the viewer sees it: every schema field, in order, hidden ones null. */
export function mask(entityName, r, viewer, opts = {}) {
  const out = {};
  for (const f of SCHEMA.entities[entityName].fields) {
    const v = r[f.name];
    out[f.name] = v === undefined || !visible(entityName, f, r, viewer, opts) ? null : v;
  }
  return out;
}

// Private play (config.visibility "private", until the game is over): a team sees only its own programs' side
// of a turn, never the other side's team. Its flower's side: what the flower was asked and answered, R, its CPU
// time and errors, not which bee came nor whether it fed. Its bee's side: what the bee asked, the response, its
// decision and what the feed brought (nectar, price, net, balance, the grain bare), not which species answered.
// A turn of its bee at its own flower gives both sides, as two records.
export const FLOWER_SIDE = new Set(["game", "seq", "round", "atMs", "flower", "challenge", "response", "responseBytes", "responseHash",
  "percent", "ms", "budgetMs", "flowerVersion", "flowerError"]);
export const BEE_SIDE = new Set(["game", "seq", "round", "atMs", "turn", "bee", "challenge", "response", "responseBytes", "responseHash",
  "fed", "nectar", "price", "net", "balance", "beeMs", "beeVersion", "beeError", "grain"]);

/** A `turns` record as team `viewer` sees it in private play: its flower's side and/or its bee's side (none for anyone else). */
export function privateTurns(r, viewer) {
  if (viewer === null || viewer === undefined) return [];
  const side = (keep) => Object.fromEntries(SCHEMA.entities.turns.fields.map((f) => [f.name, keep.has(f.name) && r[f.name] !== undefined ? r[f.name] : null]));
  const out = [];
  if (r.flower === viewer) out.push(side(FLOWER_SIDE));
  if (r.bee === viewer) out.push(side(BEE_SIDE));
  return out;
}
