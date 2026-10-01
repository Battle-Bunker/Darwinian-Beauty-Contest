// Per-game parameters, chosen by the room owner before round 1 and locked afterwards.
import { parseType, typeToString } from "./types.js";

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  rounds: 6,                   // number of rounds: one to write, then bee, orchid, clover, bee, orchid turns
  turnsPerFlower: 100,         // each bee gets this many turns per flower in the garden, every round
  feedCost: 5,                 // turns a feed costs (an ask always costs 1)
  challengeType: "int",        // type of the value a bee asks with
  responseType: "int",         // type of the value a flower answers with
  maxLen: 64,                  // max length of strings and lists in challenges/responses
  maxNodes: 512,               // max nodes in a tree or graph (graphs: at most 4× as many edges)
  beeMemoryKb: 256,            // max size of what a bee keeps from one round to the next
  flowerLogs: true,            // after each round, flower owners see who asked their flowers what
  publicLogs: false,           // after each round, everyone sees every visit: challenges, responses, feeds, nectar, which flower
  revealOnFinish: true,        // when the game ends, everyone can see all code and all logs
  // The orchid is the reference point:
  //   clover: half the orchid's complexity, 3× its compute: honest flowers can prove they spent effort
  //   orchid: room to build elaborate imitations and to change tack in its turn (70% change budget)
  //   bee:    5× the orchid's complexity for detector repertoires, half its compute: checks must be cheap
  budgets: {
    //   chars: size, in characters of the minified program
    //   changes: characters of the minified program that may change in a round the program may change
    //            (bees, orchids and clovers take turns, see schedule.js)
    //   ms: compute per call, one core each
    clover: { chars: 350, changes: 70, ms: 150 },
    orchid: { chars: 700, changes: 490, ms: 50 },
    bee: { chars: 3500, changes: 700, ms: 25 },
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
    turnsPerFlower: int(c.turnsPerFlower, 1, 1000, base.turnsPerFlower),
    feedCost: int(c.feedCost, 0, 1000, base.feedCost),
    challengeType: typeToString(parseType(c.challengeType ?? base.challengeType)),
    responseType: typeToString(parseType(c.responseType ?? base.responseType)),
    maxLen: int(c.maxLen, 1, 1024, base.maxLen),
    maxNodes: int(c.maxNodes, 1, 4096, base.maxNodes),
    beeMemoryKb: int(c.beeMemoryKb, 0, 4096, base.beeMemoryKb),
    flowerLogs: bool(c.flowerLogs, base.flowerLogs),
    publicLogs: bool(c.publicLogs, base.publicLogs),
    revealOnFinish: bool(c.revealOnFinish, base.revealOnFinish),
    budgets: {},
  };
  for (const kind of ["clover", "orchid", "bee"]) {
    const b = (c.budgets && c.budgets[kind]) || {}, d = base.budgets[kind];
    out.budgets[kind] = {
      chars: int(b.chars, 1, 1000000, d.chars),
      changes: int(b.changes, 0, 1000000, d.changes),
      ms: int(b.ms, 1, 10000, d.ms),
    };
  }
  return out;
}

/** Turns each bee gets per round in a garden of `nTeams` patches (2 flowers each). */
export function turnsFor(config, nTeams) {
  return config.turnsPerFlower * 2 * nTeams;
}

/** Size limits applied to challenges and responses. */
export const limitsOf = (config) => ({ maxLen: config.maxLen, maxNodes: config.maxNodes });
