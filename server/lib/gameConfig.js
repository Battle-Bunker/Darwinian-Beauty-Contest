// Per-game parameters, chosen by the room owner in the lobby and locked once the game starts.
import { parseType, typeToString } from "./types.js";
import { scoringOf } from "./scoring.js";

// Budgets per program kind, in weighted syntax-tree nodes of the minified program (vendor/measure.js).
//   flower: small (1,100 nodes) and slow to change (60 a minute, banking up to 300), and a hidden CPU budget R
//           of at most 50 ms a call. Its size cap is also the "size cap" of the energy formula: E = (cap − size)
//           × max(0, R − CPU ms) × (maxResponseBytes − response bytes), in node·ms·bytes (the last factor when
//           energy.bytes).
//   bee:    room for detector repertoires (11,000 nodes, 600 a minute, banking up to 3,000), 50 ms of CPU to
//           decide, and a MEMORY of at most `memory` bytes (a key-value store: Σ key bytes + value JSON bytes):
//           the only thing that carries over from one of its turns to the next.
// Change budget is slow on purpose: learning or imitating a strategy should be hard work.
// Time: a round is the flower window (flowerWindowMs, 150 ms: every response is delivered at its end) + bee.ms
// (the bees' decision window) = 200 ms of game time. Each flower call's hidden budget R is drawn from
// [flower.minMs, flower.ms]; minMs defaults to 2% of ms, at least 1 ms (1 ms of 50). A config stored without
// flowerWindowMs is from before it: its window is flower.ms. Every limit (R, bee.ms) is CPU time, on the call's
// own thread clock; the wall clock only backstops (wallLimits below).
// Change budget accrues continuously while the game runs, `perMinute` nodes a minute, and banks up to
// `cap`: spend it whenever you like, on any change you can afford, and the new program goes live at once.
// Before the game starts, writing programs is free.
/** The default floor of R: 2% of the flower's ms, rounded, at least 1 ms. */
export const FLOWER_MIN_SHARE = 0.02;
export const defaultMinMs = (ms) => Math.max(1, Math.round(ms * FLOWER_MIN_SHARE));

const BUDGETS = {
  flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: defaultMinMs(50) },
  bee: { size: 11000, perMinute: 600, cap: 3000, ms: 50, memory: 50 },
};

export const KINDS = ["flower", "bee"];
export const GRAINS = ["feeder", "public", "off"];
/** The default feed price, as a share of Emax (prevalence.js): 0.05 × 56,320,000 = 2,816,000 at the defaults. */
export const FEED_PRICE_SHARE = 0.05;
/** The default prior of every prevalence ledger cell, as a share of Emax. */
export const PREVALENCE_PRIOR_SHARE = 0.12;

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  minutes: 2,                  // how long the game runs (game time: it stops while paused)
  feedCost: 0,                 // rounds a bee sits out after the round it feeds in (none: a feed has a price instead)
  // The flower window: every response is delivered this long into the round, whatever R was. A config stored
  // without it is from before: its window is budgets.flower.ms.
  flowerWindowMs: 150,
  // What a feed costs the bee, in E's unit, taken from its nectar: net = nectar − feedPrice. null: 0.05 × Emax
  // (follows the caps); 0: free. A config stored without it is from before: its feeds are free.
  feedPrice: null,
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
  // Prevalence on both sides (server/lib/prevalence.js): flower species and bees that have done well lately
  // are drawn more often. Each round ceil(slots × N) bees are drawn without replacement (weights c(t) + B_b),
  // and each visits a species drawn with weights c(t) + F_s. F_s and B_b are N × a share of recent success
  // (pollen given; net nectar got), every ledger cell starting at `prior` (null: 0.12 × Emax) and decaying with
  // a half-life of `halfLifeS` seconds of game time (null: cumulative), capped at `cap` (null: none); c(t)
  // runs from cStart to cEnd over the game. Fitness is the time-average of F × B. A config stored without
  // prevalence (or with an earlier form of it, without `slots`) is from before: every bee takes a turn each
  // round, species are drawn uniformly, and it is scored with pollination × forage.
  prevalence: Object.freeze({ on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null }),
  budgets: BUDGETS,
});

/** The flower window: responses are delivered this long into each round (budgets.flower.ms for an old config). */
export const windowMsOf = (config) => Math.max(config.flowerWindowMs ?? config.budgets.flower.ms, config.budgets.flower.ms);

/** The most E a turn can make: size cap × flower.ms (R's most) × maxResponseBytes (with energy.bytes), in E's unit. */
export const emaxOf = (config) =>
  config.budgets.flower.size * config.budgets.flower.ms * (energyBytes(config) ? config.maxResponseBytes : 1);

/** A config's feed price, in E's unit (0: feeds are free, as in games from before it). */
export const feedPriceOf = (config) =>
  config?.feedPrice === null ? FEED_PRICE_SHARE * emaxOf(config) : Number.isFinite(config?.feedPrice) ? config.feedPrice : 0;

/** A config's prevalence settings as stored, with every key (a config without them, or an earlier form: off). */
export function prevalenceConfig(config) {
  const p = config?.prevalence;
  const current = p && typeof p === "object" && "slots" in p;
  return { ...DEFAULT_CONFIG.prevalence, on: false, ...(current ? p : {}) };
}

/**
 * A config's prevalence settings, resolved (the prior's default filled in), or null when it has none: every bee
 * takes a turn each round and species are drawn uniformly.
 */
export function prevalenceOf(config) {
  const p = prevalenceConfig(config);
  if (p.on !== true) return null;
  const prior = p.prior ?? PREVALENCE_PRIOR_SHARE * emaxOf(config);
  return { on: true, halfLifeS: p.halfLifeS, cStart: p.cStart, cEnd: p.cEnd, cap: p.cap, slots: p.slots, prior };
}

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

/** A number, or null when the input is explicitly null (meaning "none"); left out, `dflt`. */
const numOrNull = (v, lo, hi, dflt) => (v === null ? null : num(v, lo, hi, dflt));

function normalizePrevalence(input, b) {
  const p = input && typeof input === "object" ? input : {};
  return {
    on: bool(p.on, b.on),
    halfLifeS: numOrNull(p.halfLifeS, 1, 86400, b.halfLifeS),   // null: cumulative (no decay)
    cStart: num(p.cStart, 0, 100, b.cStart),
    cEnd: num(p.cEnd, 0, 100, b.cEnd),
    cap: numOrNull(p.cap, 1, 1e6, b.cap),                       // null: no cap
    slots: num(p.slots, 0.01, 1, b.slots),                      // ceil(slots × N) bees visit each round
    prior: numOrNull(p.prior, 0, 1e15, b.prior),                // null: 0.12 × Emax
  };
}

/** Merge a partial config onto `base`, clamping everything to sane ranges. Throws on bad types. */
export function normalizeConfig(input = {}, base = DEFAULT_CONFIG) {
  const c = input || {};
  const out = {
    language: c.language === "typescript" ? "typescript" : c.language === "python" ? "python" : base.language,
    minutes: num(c.minutes, 0.1, 24 * 60, base.minutes),
    feedCost: int(c.feedCost, 0, 1000, base.feedCost),
    // Left out, the base's: null (follows the flower's ms) for a base stored without it.
    flowerWindowMs: c.flowerWindowMs === undefined || c.flowerWindowMs === "" ? (base.flowerWindowMs ?? null) : c.flowerWindowMs === null ? null : int(c.flowerWindowMs, 1, 10000, base.flowerWindowMs ?? null),
    // Left out, the base's: 0 (free) for a base stored without it; null: the default share of Emax.
    feedPrice: c.feedPrice === null ? null : numOrNull(c.feedPrice, 0, 1e15, base.feedPrice === undefined ? 0 : base.feedPrice),
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
    // Left out, the base's (a base stored without it draws uniformly, and keeps doing so unless it is turned on).
    prevalence: normalizePrevalence(c.prevalence, prevalenceConfig(base)),
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
export const roundMs = (config) => windowMsOf(config) + config.budgets.bee.ms;

/**
 * Every program limit is CPU time (the runners measure each call on its own thread clock). These are the
 * wall-clock backstops, in ms, for calls that aren't computing or are starved far beyond reason: a flower call
 * still going at `flower` is stopped; a bee's first or decide with no reply at `bee` is judged then (late, or a
 * server fault) and stopped at `beeHard` (or at `beeCpu` of CPU); fed is stopped at `bee`. A call stopped or
 * judged by a backstop is a server fault, not the program's, if it spent at least `faultShare` of its wall
 * time runnable but waiting for a CPU (/proc/<pid>/schedstat): its turn is void.
 */
export function wallLimits(config) {
  const beeCpu = Math.max(2000, 2 * config.budgets.bee.ms);
  return {
    flower: Math.max(400, 2 * config.budgets.flower.ms),
    bee: Math.max(250, 4 * config.budgets.bee.ms),
    beeCpu, beeHard: 2 * beeCpu,
    faultShare: 0.5,
  };
}

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
