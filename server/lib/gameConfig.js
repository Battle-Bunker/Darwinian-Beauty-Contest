// Per-game parameters, chosen by the room owner before round 1 and locked afterwards.
import { parseType, typeToString } from "./types.js";

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  rounds: 5,                   // number of rounds in the game
  turns: 100,                  // turns each bee gets per round
  feedCost: 5,                 // turns a feed costs (an ask always costs 1)
  challengeType: "int",        // type of the value a bee asks with
  responseType: "int",         // type of the value a flower answers with
  maxLen: 64,                  // max length of strings and lists in challenges/responses
  flowerLogs: true,            // after each round, flower owners see who asked their flowers what
  revealOnFinish: true,        // when the game ends, everyone can see all code and all logs
  budgets: {
    //        complexity (AST nodes)  change (AST edits per round)  compute (ms per call)
    clover: { nodes: 150, changes: 30, ms: 50 },
    orchid: { nodes: 150, changes: 30, ms: 50 },
    bee: { nodes: 400, changes: 60, ms: 50 },
  },
});

const int = (v, lo, hi, dflt) => {
  const x = Number.parseInt(v, 10);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};
const bool = (v, dflt) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : dflt);

/** Merge a partial config onto `base`, clamping everything to sane ranges. Throws on bad types. */
export function normalizeConfig(input = {}, base = DEFAULT_CONFIG) {
  const c = input || {};
  const out = {
    language: c.language === "typescript" ? "typescript" : c.language === "python" ? "python" : base.language,
    rounds: int(c.rounds, 1, 100, base.rounds),
    turns: int(c.turns, 1, 10000, base.turns),
    feedCost: int(c.feedCost, 0, 1000, base.feedCost),
    challengeType: typeToString(parseType(c.challengeType ?? base.challengeType)),
    responseType: typeToString(parseType(c.responseType ?? base.responseType)),
    maxLen: int(c.maxLen, 1, 1024, base.maxLen),
    flowerLogs: bool(c.flowerLogs, base.flowerLogs),
    revealOnFinish: bool(c.revealOnFinish, base.revealOnFinish),
    budgets: {},
  };
  for (const kind of ["clover", "orchid", "bee"]) {
    const b = (c.budgets && c.budgets[kind]) || {}, d = base.budgets[kind];
    out.budgets[kind] = {
      nodes: int(b.nodes, 1, 100000, d.nodes),
      changes: int(b.changes, 0, 100000, d.changes),
      ms: int(b.ms, 1, 10000, d.ms),
    };
  }
  return out;
}
