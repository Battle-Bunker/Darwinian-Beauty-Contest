// Per-game parameters, chosen by the room owner before round 1 and locked afterwards.
import { parseType, typeToString } from "./types.js";

// Size and change budgets in each complexity mode (vendor/measure.js). The orchid is the reference:
//   clover: half the orchid's size, 3× its compute: honest flowers can prove they spent effort
//   orchid: room to build elaborate imitations and to change tack in its turn (70% change budget)
//   bee:    5× the orchid's size for detector repertoires, half its compute: checks must be cheap
// Clovers and bees may change 20% of a full-size program in their turn.
//   chars: characters of the minified program; change in characters of edit between minified versions
//   nodes: syntax-tree nodes, literals one per byte; change in node edits (literals byte by byte)
export const SIZE_BUDGETS = Object.freeze({
  chars: { clover: { size: 350, changes: 70 }, orchid: { size: 700, changes: 490 }, bee: { size: 3500, changes: 700 } },
  nodes: { clover: { size: 150, changes: 30 }, orchid: { size: 300, changes: 210 }, bee: { size: 1500, changes: 300 } },
});
const COMPUTE_MS = { clover: 150, orchid: 50, bee: 25 }; // ms per call, one core each

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
  complexity: "chars",         // how program size and change are measured: "chars" or "nodes"
  budgets: Object.fromEntries(["clover", "orchid", "bee"].map((k) => [k, { ...SIZE_BUDGETS.chars[k], ms: COMPUTE_MS[k] }])),
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
    complexity: c.complexity === "nodes" || c.complexity === "chars" ? c.complexity : base.complexity,
    budgets: {},
  };
  // Switching mode switches size and change budgets to that mode's defaults (unless given).
  const switched = out.complexity !== base.complexity;
  for (const kind of ["clover", "orchid", "bee"]) {
    const b = (c.budgets && c.budgets[kind]) || {}, d = switched ? { ...base.budgets[kind], ...SIZE_BUDGETS[out.complexity][kind] } : base.budgets[kind];
    out.budgets[kind] = {
      size: int(b.size, 1, 1000000, d.size),
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
