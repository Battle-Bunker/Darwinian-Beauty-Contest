// Per-game parameters, chosen by the room owner in the lobby and locked once the game starts.
import { parseType, typeToString } from "./types.js";

// Budgets per program kind, in weighted syntax-tree nodes of the minified program (vendor/measure.js).
// The orchid is the reference:
//   clover: half the orchid's size and the whole 150 ms flower window: honest flowers can prove they spent effort
//   orchid: room for elaborate imitations, 7× a clover's change rate to chase what it imitates, and a
//           shorter time limit (100 ms) than a clover's; its answer is still delivered at 150 ms
//   bee:    5× the orchid's size for detector repertoires, and 50 ms to decide: checks must be cheap
// Time: a round is one action slot for every bee, clover.ms (the flower window: every answer is
// delivered then) + bee.ms (the bees' decision window) = 200 ms of game time.
// Change budget accrues continuously while the game runs, `perMinute` nodes a minute, and banks up to
// `cap` (one minute's worth): spend it whenever you like, on any change you can afford, and the new
// program goes live at once. Before the game starts, writing programs is free. Over a default 2-minute
// game a clover or bee can change 40% of a full-size program and an orchid 140%, as much as in the
// round-based design's six rounds (two change turns per kind, of 20% and 70%).
// The clover's size is just enough for the longer of the two example clovers (arena/examples: the
// Paley clique chain is 1,024 nodes, the graceful labelling 427).
const BUDGETS = {
  clover: { size: 1100, perMinute: 220, cap: 220, ms: 150 },
  orchid: { size: 2200, perMinute: 1540, cap: 1540, ms: 100 },
  bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50 },
};

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  minutes: 2,                  // how long the game runs (game time: it stops while paused)
  feedCost: 10,                // rounds a feeding bee sits out after the round it feeds in
  challengeType: "int",        // type of the value a bee asks with
  responseType: "int",         // type of the value a flower answers with
  maxLen: 64,                  // max length of strings and lists in challenges/responses
  maxNodes: 512,               // max nodes in a tree or graph (graphs: at most 4× as many edges)
  revealOnFinish: true,        // when the game ends, everyone can see all code and every bee's print output
  budgets: BUDGETS,
});

const int = (v, lo, hi, dflt) => {
  const x = Number.parseInt(v, 10);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};
const num = (v, lo, hi, dflt) => {
  const x = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};
const bool = (v, dflt) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : dflt);

/** Merge a partial config onto `base`, clamping everything to sane ranges. Throws on bad types. */
export function normalizeConfig(input = {}, base = DEFAULT_CONFIG) {
  const c = input || {};
  const out = {
    language: c.language === "typescript" ? "typescript" : c.language === "python" ? "python" : base.language,
    minutes: num(c.minutes, 0.1, 24 * 60, base.minutes),
    feedCost: int(c.feedCost, 0, 1000, base.feedCost),
    challengeType: typeToString(parseType(c.challengeType ?? base.challengeType)),
    responseType: typeToString(parseType(c.responseType ?? base.responseType)),
    maxLen: int(c.maxLen, 1, 1024, base.maxLen),
    maxNodes: int(c.maxNodes, 1, 4096, base.maxNodes),
    revealOnFinish: bool(c.revealOnFinish, base.revealOnFinish),
    budgets: {},
  };
  for (const kind of ["clover", "orchid", "bee"]) {
    const b = (c.budgets && c.budgets[kind]) || {}, d = base.budgets[kind];
    out.budgets[kind] = {
      size: int(b.size, 1, 1000000, d.size),
      perMinute: num(b.perMinute, 0, 1000000, d.perMinute),
      cap: int(b.cap, 0, 10000000, d.cap),
      ms: int(b.ms, 1, 10000, d.ms),
    };
  }
  // The orchid's time limit is at most a clover's: every answer is delivered at the end of the
  // clover's window anyway, so a longer one could never be used.
  out.budgets.orchid.ms = Math.min(out.budgets.orchid.ms, out.budgets.clover.ms);
  return out;
}

/** One round of game time: the flower window (a clover's time limit) plus the bees' decision window. */
export const roundMs = (config) => config.budgets.clover.ms + config.budgets.bee.ms;

/** Size limits applied to challenges and responses. */
export const limitsOf = (config) => ({ maxLen: config.maxLen, maxNodes: config.maxNodes });

/** A team's change budget for one program at game time `clockMs`: what's banked plus what has accrued since. */
export function available(budget, bank, clockMs) {
  return Math.min(budget.cap, bank.bank + (budget.perMinute * Math.max(0, clockMs - bank.atMs)) / 60000);
}
