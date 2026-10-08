// Per-game parameters, chosen by the room owner in the lobby and locked once the game starts.
import { parseType, typeToString } from "./types.js";
import { SCORING_MODES, scoringOf } from "./scoring.js";

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
/** Who sees what during play: "private" (new games), each team only what its own programs see; "public", everyone everything public. */
export const VISIBILITIES = ["private", "public"];
/** The default feed price, as a share of Emax (prevalence.js): 0.05 × 56,320,000 = 2,816,000 at the defaults. */
export const FEED_PRICE_SHARE = 0.05;
/** The default prior of every prevalence pollen cell, as a share of Emax. */
export const PREVALENCE_PRIOR_SHARE = 0.12;
/** A bee's default nectar endowment (prevalence.pools), in feed prices. */
export const PREVALENCE_ENDOWMENT_FEEDS = 10;

export const DEFAULT_CONFIG = Object.freeze({
  language: "python",          // "python" | "typescript"
  // How long the game runs, in game time (it stops while paused): at least `minutes`, at most endFactor ×
  // minutes. At the start the server draws the real end uniformly from that range and keeps it hidden until the
  // game is over (games.end_ms; lengthOf, drawEndMs). A config stored without endFactor is from before: its game
  // ends at `minutes` exactly, and so does one with endFactor 1.
  minutes: 5,
  endFactor: 2,
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
  // What anyone but the room's owner (with no team in the game) sees during play. "private": each team sees only
  // its own programs' side of their turns (its flower's: the challenge, R, its response and percent, its CPU and
  // errors; its bee's: the challenge, the response, its decision, nectar, price, balance, its grains bare), its
  // own versions, budgets and MEMORY, and everyone's prevalence (F, B, p^F, p^B, fitness, c) in snapshots every
  // prevalenceEveryS seconds of game time, rounded to 2 decimals: no arrivals, nobody else's turns, no ledgers.
  // "public": as before (a config stored without it). Once the game is over, everything is revealed either way.
  visibility: "private",
  prevalenceEveryS: 30,
  // A grain is ⌊scale × pollen^exponent⌋ characters of code. Scale 0.1 ≈ 1024^(−1/3): with E in node·ms·bytes,
  // grains keep about the length they had when E was in node·ms (and scale 1).
  pollenGrain: Object.freeze({ exponent: 1 / 3, scale: 0.1 }),
  // forage = Σ nectar^alpha (over flower teams), pollination = Σ pollen^beta (over bee teams); each in (0, 1].
  // A config stored without `scoring` is from before it existed: those games were scored with √ (scoring.js).
  // mode (games with prevalence): "final", fitness = N² × p^F × p^B at the final round; "timeAverage", the
  // time-average of F × B. A config stored without a mode is a v2 or v3 game: "timeAverage".
  scoring: Object.freeze({ alpha: 0.85, beta: 0.85, mode: "final" }),
  // bytes: E has a third factor, (maxResponseBytes − response bytes), and is in node·ms·bytes. A config stored
  // without `energy` (or with bytes false) has the two-factor formula, in node·ms: E = (cap − size) × max(0, R − CPU ms).
  energy: Object.freeze({ bytes: true }),
  // Prevalence on both sides (server/lib/prevalence.js): flower species and bees that have done well lately
  // are drawn more often. Each round ceil(slots × N) bees are drawn without replacement (weights c(t) + B_b),
  // and each visits a species drawn with weights c(t) + F_s. F_s = N × share of Σ_b (decayed pollen it gave
  // bee b)^beta, capped: diverse dissemination counts for more, so no flower–bee pair can go singleton. B_b
  // (pools, the default): N × share of the bee's single nectar balance, capped. The balance starts at the
  // endowment (null: 10 × the feed price), each feed adds nectar − price, and it relaxes toward the endowment
  // with the half-life (metabolism above it, recovery below); a bee below the price can't feed. Ledgers decay
  // with `halfLifeS` seconds of game time (null: cumulative); the pollen prior is `prior` (null: 0.12 × Emax).
  // c, by cDecay: "sech", c(t) = cStart × sech(k t / cHalfS), k = arccosh 2 (so c(cHalfS) = cStart / 2; flat at
  // the start, an exponential tail, 0 at infinity), t in seconds of game time, cHalfS null: 0.2 × minutes × 60
  // (60 s at 5 minutes); "linear" (v2, v3: a config stored without cDecay), from cStart at the start to cEnd at
  // `minutes`, then cEnd. A sech config has no cEnd, a linear one no cHalfS. Fitness follows scoring.mode. With
  // pools false, B is the v2 per-(species, bee) formula (N × share of max(0, Σ_s signed (decayed net
  // nectar)^alpha)). A config stored without prevalence (or an earlier form, without `slots`) is from before:
  // every bee takes a turn each round, species are drawn uniformly, and it is scored with pollination × forage.
  prevalence: Object.freeze({ on: true, halfLifeS: 90, cDecay: "sech", cStart: 1, cHalfS: null, cap: 4, slots: 0.25, prior: null, pools: true, endowment: null }),
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

/** c's curves: "sech" (new games) and "linear" (v2, v3). */
export const C_DECAYS = ["sech", "linear"];
/** c's end in a linear config that has none. */
const LINEAR_C_END = 0.1;

/** The keys of c's curve: a sech config has cHalfS and no cEnd, a linear one cEnd and no cHalfS. */
function cCurve(p) {
  const { cEnd, cHalfS, ...rest } = p;
  return p.cDecay === "sech" ? { ...rest, cHalfS: cHalfS ?? null } : { ...rest, cEnd: cEnd ?? LINEAR_C_END };
}

/** A config's prevalence settings as stored, with every key (a config without them, or an earlier form: off). */
export function prevalenceConfig(config) {
  const p = config?.prevalence;
  const current = p && typeof p === "object" && "slots" in p;
  // A stored v2 config (has `slots`, no `pools`) keeps the v2 per-cell bee formula, and a v2 or v3 one (no
  // `cDecay`) its linear c, for reproducibility.
  return cCurve({
    ...DEFAULT_CONFIG.prevalence, on: false, ...(current ? p : {}),
    pools: current ? p.pools === true : DEFAULT_CONFIG.prevalence.pools,
    cDecay: current ? (C_DECAYS.includes(p.cDecay) ? p.cDecay : "linear") : DEFAULT_CONFIG.prevalence.cDecay,
  });
}

/** k = arccosh 2 = ln(2 + √3): sech(k) = 1/2, so a sech c halves at cHalfS. */
export const SECH_K = Math.log(2 + Math.sqrt(3));
/** sech x = 2e^(−|x|) / (1 + e^(−2|x|)): no overflow; exactly 0 far out. */
export const sech = (x) => { const e = Math.exp(-Math.abs(x)); return (2 * e) / (1 + e * e); };

/**
 * A config's prevalence settings, resolved (the prior's and endowment's defaults filled in), or null when it
 * has none: every bee takes a turn each round and species are drawn uniformly.
 */
export function prevalenceOf(config) {
  const p = prevalenceConfig(config);
  if (p.on !== true) return null;
  const prior = p.prior ?? PREVALENCE_PRIOR_SHARE * emaxOf(config);
  const endowment = p.endowment ?? PREVALENCE_ENDOWMENT_FEEDS * feedPriceOf(config);
  // c's curve: sech with cHalfS resolved (null: 0.2 × the minimum length), or linear with cEnd.
  const curve = p.cDecay === "sech"
    ? { cDecay: "sech", cStart: p.cStart, cHalfS: p.cHalfS ?? C_HALF_SHARE * config.minutes * 60 }
    : { cDecay: "linear", cStart: p.cStart, cEnd: p.cEnd };
  return { on: true, halfLifeS: p.halfLifeS, ...curve, cap: p.cap, slots: p.slots, prior, pools: p.pools === true, endowment };
}

/** A sech c's default cHalfS, as a share of the game's minimum length (in seconds). */
export const C_HALF_SHARE = 0.2;

/** A config's visibility during play: "private" only if it says so (a config stored without it: "public"). */
export const visibilityOf = (config) => (config?.visibility === "private" ? "private" : "public");

/** The prevalence samples' spacing, in rounds: about once a second of game time. */
export const sampleEveryOf = (config) => Math.max(1, Math.round(1000 / roundMs(config)));

/**
 * The prevalence snapshots of a private game: { everyMs, sampleMs }. A sample (taken every sampleMs of game
 * time, at multiples of it) is a snapshot when it is the first at or after a multiple of everyMs (isSnapshot).
 */
export function snapshotsOf(config) {
  const everyMs = Math.round((Number.isFinite(config?.prevalenceEveryS) ? config.prevalenceEveryS : DEFAULT_CONFIG.prevalenceEveryS) * 1000);
  return { everyMs, sampleMs: sampleEveryOf(config) * roundMs(config) };
}

/**
 * Whether the prevalence sample taken at game time atMs is one of the game's snapshots: a scheduled sample (at a
 * multiple of sampleMs; not the extra one of the last round played) that is the first at or after a multiple of
 * everyMs.
 */
export function isSnapshot(atMs, config) {
  const { everyMs, sampleMs } = snapshotsOf(config);
  return atMs % sampleMs === 0 && (atMs === 0 || Math.floor(atMs / everyMs) > Math.floor((atMs - sampleMs) / everyMs));
}

/** isSnapshot in SQL, of the column `col` (game ms; integers written inline). */
export function snapshotSql(col, config) {
  const { everyMs, sampleMs } = snapshotsOf(config);
  const P = Math.max(1, Math.round(everyMs)), S = Math.max(1, Math.round(sampleMs));
  return `(${col} % ${S} = 0 AND (${col} = 0 OR floor(${col}::float8 / ${P}) > floor((${col} - ${S})::float8 / ${P})))`;
}

/** A config's endFactor: the most its game can last, as a multiple of `minutes` (1 for a config stored without one). */
export const endFactorOf = (config) => (Number.isFinite(config?.endFactor) && config.endFactor >= 1 ? config.endFactor : 1);

/** A game's length range, in ms of game time: { minMs, maxMs } (equal: it ends at minMs). Public. */
export function lengthOf(config) {
  const minMs = Math.round(config.minutes * 60000);
  return { minMs, maxMs: Math.round(minMs * endFactorOf(config)) };
}

/**
 * Draw a game's end, in ms of game time (at its start; kept hidden until it is over): uniform in [minMs, maxMs],
 * rounded up to a whole round, so the game's clock stops exactly there.
 */
export function drawEndMs(config, rand = Math.random) {
  const { minMs, maxMs } = lengthOf(config), r = roundMs(config);
  return Math.ceil((minMs + rand() * (maxMs - minMs)) / r - 1e-9) * r;
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

/** One of `options`, else an error; left out, `dflt`. */
const oneOf = (v, options, name, dflt) => {
  if (v === null || v === undefined || v === "") return dflt;
  if (!options.includes(v)) throw new Error(`${name} must be ${options.map((o) => `"${o}"`).join(" or ")}`);
  return v;
};

/** A scoring mode: "final" or "timeAverage", else an error; left out, `dflt`. */
const scoringMode = (v, dflt) => {
  if (v === null || v === undefined || v === "") return dflt;
  if (!SCORING_MODES.includes(v)) throw new Error(`scoring.mode must be ${SCORING_MODES.map((m) => `"${m}"`).join(" or ")}`);
  return v;
};

/** A number, or null when the input is explicitly null (meaning "none"); left out, `dflt`. */
const numOrNull = (v, lo, hi, dflt) => (v === null ? null : num(v, lo, hi, dflt));

function normalizePrevalence(input, b) {
  const p = input && typeof input === "object" ? input : {};
  if (p.cDecay !== undefined && p.cDecay !== null && p.cDecay !== "" && !C_DECAYS.includes(p.cDecay)) {
    throw new Error(`prevalence.cDecay must be ${C_DECAYS.map((d) => `"${d}"`).join(" or ")}`);
  }
  const cDecay = C_DECAYS.includes(p.cDecay) ? p.cDecay : b.cDecay;
  return {
    on: bool(p.on, b.on),
    halfLifeS: numOrNull(p.halfLifeS, 1, 86400, b.halfLifeS),   // null: cumulative (no decay)
    cDecay,                                                     // c's curve: "sech" or "linear" (v2, v3)
    cStart: num(p.cStart, 0, 100, b.cStart),
    ...(cDecay === "sech"
      ? { cHalfS: numOrNull(p.cHalfS, 0.1, 864000, b.cHalfS ?? null) }   // null: 0.2 × minutes × 60
      : { cEnd: num(p.cEnd, 0, 100, b.cEnd ?? LINEAR_C_END) }),
    cap: numOrNull(p.cap, 1, 1e6, b.cap),                       // null: no cap
    slots: num(p.slots, 0.01, 1, b.slots),                      // ceil(slots × N) bees visit each round
    prior: numOrNull(p.prior, 0, 1e15, b.prior),                // null: 0.12 × Emax
    pools: bool(p.pools, b.pools),                              // the bee's nectar is a single balance (false: v2 per-cell)
    endowment: numOrNull(p.endowment, 0, 1e15, b.endowment),    // a bee's starting balance (null: 10 × the feed price)
  };
}

/** Merge a partial config onto `base`, clamping everything to sane ranges. Throws on bad types. */
export function normalizeConfig(input = {}, base = DEFAULT_CONFIG) {
  const c = input || {};
  const out = {
    language: c.language === "typescript" ? "typescript" : c.language === "python" ? "python" : base.language,
    minutes: num(c.minutes, 0.1, 24 * 60, base.minutes),
    // Left out, the base's: 1 (a fixed end) for a base stored without it.
    endFactor: num(c.endFactor, 1, 100, endFactorOf(base)),
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
    // Left out, the base's: "public" for a base stored without it.
    visibility: oneOf(c.visibility, VISIBILITIES, "visibility", visibilityOf(base)),
    prevalenceEveryS: num(c.prevalenceEveryS, 1, 3600, base.prevalenceEveryS ?? DEFAULT_CONFIG.prevalenceEveryS),
    pollenGrain: {
      exponent: num(c.pollenGrain?.exponent, 0.01, 1, base.pollenGrain?.exponent ?? DEFAULT_CONFIG.pollenGrain.exponent),
      scale: num(c.pollenGrain?.scale, 0, 1000, base.pollenGrain?.scale ?? (energyBytes(base) ? DEFAULT_CONFIG.pollenGrain.scale : 1)),
    },
    // Left out, the base's (a base stored without them is a √ game: it stays one unless they are set; one
    // stored without a mode is scored by time-average).
    scoring: {
      alpha: exponent(c.scoring?.alpha, "alpha", scoringOf(base).alpha), beta: exponent(c.scoring?.beta, "beta", scoringOf(base).beta),
      mode: scoringMode(c.scoring?.mode, scoringOf(base).mode),
    },
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
