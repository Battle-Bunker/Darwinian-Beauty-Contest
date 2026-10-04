// Per-game parameters, chosen by the room owner in the lobby and locked once the game starts.
import { parseType, typeToString } from "./types.js";

// Budgets per program kind, in weighted syntax-tree nodes of the minified program (vendor/measure.js).
//   flower: small (1,100 nodes) and slow to change (220 a minute), with the whole 150 ms flower window.
//           Its size cap is also the "size cap" of the energy formula: E = (cap − size) × max(0, ms − CPU ms).
//   bee:    room for detector repertoires (11,000 nodes, 2,200 a minute), 50 ms to decide, and a MEMORY of
//           at most `memory` bytes (a key-value store: Σ key bytes + value JSON bytes): the only thing
//           that carries over from one of its turns to the next.
// Time: a round is one turn for every bee, flower.ms (the flower window: every response is delivered then)
// + bee.ms (the bees' decision window) = 200 ms of game time.
// Change budget accrues continuously while the game runs, `perMinute` nodes a minute, and banks up to
// `cap` (one minute's worth): spend it whenever you like, on any change you can afford, and the new
// program goes live at once. Before the game starts, writing programs is free.
const BUDGETS = {
  flower: { size: 1100, perMinute: 220, cap: 220, ms: 150 },
  bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 },
};

export const KINDS = ["flower", "bee"];

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  minutes: 2,                  // how long the game runs (game time: it stops while paused)
  feedCost: 10,                // rounds a bee sits out after the round it feeds in
  challengeType: "int",        // type of the value a bee asks with
  responseType: "int",         // type of the value a flower answers with
  maxLen: 64,                  // max length of strings and lists in challenges
  maxNodes: 512,               // max nodes in a challenge's tree or graph (graphs: at most 4× as many edges)
  maxResponseBytes: 1048576,   // max UTF-8 bytes of a response's JSON text (responses have no maxLen/maxNodes)
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
    maxResponseBytes: int(c.maxResponseBytes, 16, 16777216, base.maxResponseBytes ?? DEFAULT_CONFIG.maxResponseBytes),
    revealOnFinish: bool(c.revealOnFinish, base.revealOnFinish),
    budgets: {},
  };
  for (const kind of KINDS) {
    const b = (c.budgets && c.budgets[kind]) || {}, d = base.budgets[kind] || BUDGETS[kind];
    out.budgets[kind] = {
      size: int(b.size, 1, 1000000, d.size),
      perMinute: num(b.perMinute, 0, 1000000, d.perMinute),
      cap: int(b.cap, 0, 10000000, d.cap),
      ms: int(b.ms, 1, 10000, d.ms),
    };
    if (kind === "bee") out.budgets.bee.memory = int(b.memory, 0, 1000000, d.memory ?? BUDGETS.bee.memory);
  }
  return out;
}

/** One round of game time: the flower window plus the bees' decision window. */
export const roundMs = (config) => config.budgets.flower.ms + config.budgets.bee.ms;

/** Size limits applied to challenges. */
export const limitsOf = (config) => ({ maxLen: config.maxLen, maxNodes: config.maxNodes });

/** Limits applied to responses: their size is capped in bytes (maxResponseBytes, by the runner), and their nesting. */
export const RESPONSE_DEPTH = 256;
export const responseLimits = () => ({ maxLen: Infinity, maxNodes: Infinity, maxDepth: RESPONSE_DEPTH });

/** A team's change budget for one program at game time `clockMs`: what's banked plus what has accrued since. */
export function available(budget, bank, clockMs) {
  return Math.min(budget.cap, bank.bank + (budget.perMinute * Math.max(0, clockMs - bank.atMs)) / 60000);
}

/** Excess energy of a turn, in node·ms: (flower size cap − the flower's size) × max(0, flower ms − CPU ms). */
export function excessEnergy(config, size, cpuMs) {
  const { size: cap, ms } = config.budgets.flower;
  return Math.max(0, cap - size) * Math.max(0, ms - cpuMs);
}
