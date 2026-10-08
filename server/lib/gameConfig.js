// Per-game parameters, chosen by the room owner in the lobby and locked once the game starts.
import { parseType, typeToString } from "./types.js";
import { scoringOf } from "./scoring.js";

// Budgets per program kind, in weighted syntax-tree nodes of the minified program (vendor/measure.js).
//   flower: small (1,100 nodes) and slow to change (220 a minute), with the whole 150 ms flower window.
//           Its size cap is also the "size cap" of the energy formula: E = (cap − size) × max(0, R − CPU ms)
//           × (maxResponseBytes − response bytes), in node·ms·bytes (the last factor when energy.bytes).
//   bee:    room for detector repertoires (11,000 nodes, 2,200 a minute), 50 ms to decide, and a MEMORY of
//           at most `memory` bytes (a key-value store: Σ key bytes + value JSON bytes): the only thing
//           that carries over from one of its turns to the next.
// Time: a round is one turn for every bee, flower.ms (the flower window: every response is delivered then)
// + bee.ms (the bees' decision window) = 200 ms of game time. Each flower call's hidden budget R is drawn from
// [flower.minMs, flower.ms]; minMs defaults to 2% of ms, at least 1 ms (3 ms of 150).
// Change budget accrues continuously while the game runs, `perMinute` nodes a minute, and banks up to
// `cap` (one minute's worth): spend it whenever you like, on any change you can afford, and the new
// program goes live at once. Before the game starts, writing programs is free.
/** The default floor of R: 2% of the flower's ms, rounded, at least 1 ms. */
export const FLOWER_MIN_SHARE = 0.02;
export const defaultMinMs = (ms) => Math.max(1, Math.round(ms * FLOWER_MIN_SHARE));

const BUDGETS = {
  flower: { size: 1100, perMinute: 220, cap: 220, ms: 150, minMs: defaultMinMs(150) },
  bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 },
};

export const KINDS = ["flower", "bee"];
export const GRAINS = ["feeder", "public", "off"];

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  minutes: 2,                  // how long the game runs (game time: it stops while paused)
  feedCost: 20,                // rounds a bee sits out after the round it feeds in
  challengeType: "int",        // type of the value a bee asks with
  responseType: "int",         // type of the value a flower answers with
  maxLen: 64,                  // max length of strings and lists in challenges
  maxNodes: 512,               // max nodes in a challenge's tree or graph (graphs: at most 4× as many edges)
  maxResponseBytes: 1024,      // max UTF-8 bytes of a response's JSON text (responses have no maxLen/maxNodes);
                               // with energy.bytes, also the byte cap of the energy formula
  revealOnFinish: true,        // when the game ends, everyone can see all code and every bee's print output
  grains: "feeder",            // who sees a feed's pollen grain during play: "feeder" (the bee's team) | "public" | "off"
  // A grain is ⌊scale × pollen^exponent⌋ characters of code. Scale 0.1 ≈ 1024^(−1/3): with E in node·ms·bytes,
  // grains keep about the length they had when E was in node·ms (and scale 1).
  pollenGrain: Object.freeze({ exponent: 1 / 3, scale: 0.1 }),
  // forage = Σ nectar^alpha (over flower teams), pollination = Σ pollen^beta (over bee teams); each in (0, 1].
  // A config stored without `scoring` is from before it existed: those games were scored with √ (scoring.js).
  scoring: Object.freeze({ alpha: 0.85, beta: 0.85 }),
  // bytes: E has a third factor, (maxResponseBytes − response bytes), and is in node·ms·bytes. A config stored
  // without `energy` (or with bytes false) has the two-factor formula, in node·ms: E = (cap − size) × max(0, R − CPU ms).
  energy: Object.freeze({ bytes: true }),
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
/** A scoring exponent: in (0, 1], else an error; left out, `dflt`. */
const exponent = (v, name, dflt) => {
  if (v === null || v === undefined || v === "") return dflt;
  const x = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(x) || x <= 0 || x > 1) throw new Error(`scoring.${name} must be a number in (0, 1]`);
  return x;
};

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
    grains: GRAINS.includes(c.grains) ? c.grains : GRAINS.includes(base.grains) ? base.grains : DEFAULT_CONFIG.grains,
    pollenGrain: {
      exponent: num(c.pollenGrain?.exponent, 0.01, 1, base.pollenGrain?.exponent ?? DEFAULT_CONFIG.pollenGrain.exponent),
      scale: num(c.pollenGrain?.scale, 0, 1000, base.pollenGrain?.scale ?? (energyBytes(base) ? DEFAULT_CONFIG.pollenGrain.scale : 1)),
    },
    // Left out, the base's (a base stored without them is a √ game: it stays one unless they are set).
    scoring: { alpha: exponent(c.scoring?.alpha, "alpha", scoringOf(base).alpha), beta: exponent(c.scoring?.beta, "beta", scoringOf(base).beta) },
    // Left out, the base's (a base stored without it has the two-factor formula, and keeps it).
    energy: { bytes: bool(c.energy?.bytes, energyBytes(base)) },
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
    if (kind === "flower") {
      // R, the per-call time budget, is drawn from [minMs, ms]; minMs can't exceed ms. Left out, minMs is 2% of
      // ms (at least 1), following ms, unless the base's was set to something else, which is kept.
      const ms = out.budgets.flower.ms;
      const auto = d.minMs == null || d.minMs === defaultMinMs(d.ms);
      out.budgets.flower.minMs = Math.min(ms, int(b.minMs, 1, 10000, auto ? defaultMinMs(ms) : d.minMs));
    }
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

/** Whether a config's energy has the byte factor (config.energy.bytes; a config without it: no). */
export const energyBytes = (config) => config?.energy?.bytes === true;

/**
 * Excess energy of a turn: (flower size cap − the flower's size) × max(0, R − CPU ms), in node·ms, where R is
 * this call's time budget (default: the flower window, for callers without a per-call R); with energy.bytes,
 * times (maxResponseBytes − bytes), in node·ms·bytes, `bytes` being the response's (UTF-8 bytes of its JSON
 * text, as the cap counts them): the whole cap for no bytes, 0 at the cap.
 */
export function excessEnergy(config, size, cpuMs, r = config.budgets.flower.ms, bytes = 0) {
  const { size: cap } = config.budgets.flower;
  const e = Math.max(0, cap - size) * Math.max(0, r - cpuMs);
  return energyBytes(config) ? e * Math.max(0, config.maxResponseBytes - bytes) : e;
}

/** The unit of a config's E: node·ms·bytes with the byte factor, node·ms without. */
export const energyUnit = (config) => (energyBytes(config) ? "node·ms·bytes" : "node·ms");

/** Draw a flower call's time budget R: uniform in [minMs, ms] ms. */
export function drawBudget(config, rand = Math.random) {
  const { ms, minMs } = config.budgets.flower;
  return minMs + rand() * (ms - minMs);
}
