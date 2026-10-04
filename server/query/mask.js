// Per-viewer visibility, from the schema's rules (server/query/schema.js): what a team (or a spectator) may
// see of a record. The ledger endpoint (server/games.js) uses it on turn records; server/query/sql.js enforces the same
// rules in SQL.
import { SCHEMA } from "./schema.js";

/**
 * May `viewer` (a team index, or null for a spectator) see field `f` of record `r`? `over`: the game is
 * finished (everything is visible); `revealed`: it is finished and revealed (code is visible).
 */
export function visible(entityName, f, r, viewer, { over = false, revealed = over } = {}) {
  const e = SCHEMA.entities[entityName];
  const own = (team) => viewer !== null && viewer !== undefined && team === viewer;
  switch (f.visibility) {
    case "public": return true;
    case "flower": return over || own(r.flower);
    case "bee": return over || own(r.bee);
    case "publicOnFeed": return over || r.fed === true || own(r.flower);
    case "team": return over || own(r[e.owner]);
    case "code": return revealed || own(r[e.owner]);
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
