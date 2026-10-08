// Prevalence on both sides (the engine's metagame v2: server/lib/prevalence.js, server/lib/gameConfig.js). Each round
// K = ceil(slots × N) bees are drawn without replacement among the bees ready to take a turn, bee b with weight c + B_b;
// each drawn bee visits a species drawn with weight c + F_s (with replacement, its own included). F_s (flower success) is
// N × its share of Σ over bee teams of (decayed pollen it gave them)^beta; B_b (bee success) N × its share of
// max(0, Σ over species of signed |decayed net nectar it got there|^alpha), net nectar = nectar − the feed price. Every
// ledger cell starts at `prior` (null: 0.12 × Emax) and halves every halfLifeS of game time (null: cumulative); both are
// capped at `cap` (null: none), par 1; c runs linearly from cStart to cEnd over the game. Fitness, the score, is the
// time-average over the rounds of F_s × B_s. The feed price (config.feedPrice: null = 0.05 × Emax, 0 = free) comes out of
// the bee's nectar; responses reach the bee at flowerWindowMs into the round (150 ms) while R stays within
// budgets.flower.ms. config.prevalence { on, halfLifeS, cStart, cEnd, cap, slots, prior }; a config without it, with on
// false, or in the superseded one-sided form (no `slots`) plays the old way: every bee each round, uniform species, the
// N² × pollination share × forage share score.
// Published, never to programs, about once a second of game time: a sample { round, atMs, c, slots, species: [{ team (id),
// index, flowerSuccess, beeSuccess, flowerP, beeP, fitness }] } (the stream's pages and events; in the game view and
// GET .../scores as prevalence.sample, beside the settings and the resolved feedPrice; GET .../prevalence as samples),
// and the `prevalence` query entity, one row per team and sample ({ round, atMs, team (index), flowerSuccess, beeSuccess,
// flowerP, beeP, fitness, c, slots }). GAME has feed_price (resolved; 0 when off) and flower_window_ms.
import { emaxOf, energyUnit } from "./energy.js";

/** The engine's defaults: the feed price and every ledger cell's prior, as shares of Emax. */
export const FEED_PRICE_SHARE = 0.05;
export const PRIOR_SHARE = 0.12;

/** The game's prevalence settings ({ halfLifeS, cStart, cEnd, cap, slots, prior }, the prior resolved; halfLifeS and cap
 * may be null: cumulative, uncapped), or null when it plays the old way (no prevalence, on false, or no `slots`). */
export function prevalenceOf(config) {
  const p = config?.prevalence;
  if (!p || typeof p !== "object" || !("slots" in p) || p.on !== true) return null;
  const or = (v, d) => (v === undefined ? d : v);
  return { halfLifeS: or(p.halfLifeS, 90), cStart: p.cStart ?? 1, cEnd: p.cEnd ?? 0.1, cap: or(p.cap, 4), slots: p.slots ?? 0.25,
    prior: p.prior ?? PRIOR_SHARE * emaxOf(config) };
}

/** c at game time t (ms) of a game lasting durationMs: linear from cStart to cEnd. */
export function cAt(config, tMs, durationMs) {
  const p = prevalenceOf(config);
  if (!p) return null;
  const x = durationMs > 0 ? Math.min(1, Math.max(0, tMs / durationMs)) : 0;
  return p.cStart + (p.cEnd - p.cStart) * x;
}

/** The least a draw chance can be at time t among N teams (success 0, uncapped): c / (N (c + 1)). */
export function floorAt(config, tMs, durationMs, n) {
  const c = cAt(config, tMs, durationMs);
  return c == null || !n ? null : c / (n * (c + 1));
}

/** Bees visiting each round in a game of n teams: ceil(slots × n), 1 to n (the engine's rounding); null without prevalence. */
export function slotsOf(config, n) {
  const p = prevalenceOf(config);
  return p && n > 0 ? Math.min(n, Math.max(1, Math.ceil(p.slots * n - 1e-9))) : null;
}

/** The feed price in E's unit, as the engine resolves it (GAME["feed_price"], the view's game.feedPrice): null is 0.05 ×
 * Emax (2,816,000 node·ms·bytes at the defaults), a number is itself, and a config from before it (no key) is 0, free. */
export function feedPriceOf(config) {
  const fp = config?.feedPrice;
  return fp === null ? FEED_PRICE_SHARE * emaxOf(config) : Number.isFinite(fp) ? fp : 0;
}

/** The flower window (GAME["flower_window_ms"], the view's game.windowMs): every response reaches the bee this long into
 * the round, whatever R; budgets.flower.ms (R's most) in a config from before it. */
export function windowOf(config) {
  const ms = config?.budgets?.flower?.ms ?? 150;
  return Math.max(config?.flowerWindowMs ?? ms, ms);
}

/** The game's metagame rules, from its config: { on (prevalence on both sides), slots (its share), perRound (bees a round,
 * given n teams), price (the feed price, E's unit; 0 free), priceShare (of Emax), emax, unit, windowMs, roundMs,
 * timeAverage (the score is the time-average of F × B) }. */
export function coopRules(config, n = null) {
  const p = prevalenceOf(config), emax = emaxOf(config), price = feedPriceOf(config), windowMs = windowOf(config);
  return { on: !!p, slots: p?.slots ?? null, perRound: n ? slotsOf(config, n) : null, price, priceShare: emax > 0 ? price / emax : null, emax,
    unit: energyUnit(config), windowMs, roundMs: windowMs + (config?.budgets?.bee?.ms ?? 50), timeAverage: !!p };
}

const num = (v) => { const x = Number(v); return v != null && v !== "" && Number.isFinite(x) ? x : null; };

/** One team at one sample, from a sample's species entry or a query row: { atMs, round, team (id or index), index, F
 * (flower success), B (bee success), pF (its species' draw chance), pB (its bee's), fitness, c }. Also reads the
 * superseded one-sided shape (p, P / success) as the flower side. */
export function sampleOf(row) {
  if (!row || typeof row !== "object") return null;
  const atMs = num(row.atMs ?? row.at_ms ?? row.clockMs);
  const team = row.team ?? row.teamId ?? row.index ?? null;
  const F = num(row.flowerSuccess ?? row.flower_success ?? row.P ?? row.success), B = num(row.beeSuccess ?? row.bee_success);
  const pF = num(row.flowerP ?? row.flower_p ?? row.p), pB = num(row.beeP ?? row.bee_p);
  if (atMs == null || team == null || (pF == null && F == null)) return null;
  return { atMs, round: num(row.round), team, index: num(row.index), F, B, pF, pB, fitness: num(row.fitness), c: num(row.c) };
}

/** Samples from published rows: query rows (one per team), or whole samples ({ round, atMs, c, slots, species: [...] }). */
export function samplesOf(rows) {
  const out = [];
  for (const r of rows || []) {
    if (Array.isArray(r?.species)) {
      for (const x of r.species) { const s = sampleOf({ round: r.round, atMs: r.atMs ?? r.at_ms, c: r.c, ...x }); if (s) out.push(s); }
    } else { const s = sampleOf(r); if (s) out.push(s); }
  }
  return out;
}

/** The latest sample in a game view or the scores (prevalence: { ...settings, feedPrice, sample }), or a stream page's
 * (prevalence: the sample itself): one entry per team, or null when there is none. */
export function currentOf(view) {
  const raw = view?.prevalence ?? view?.game?.prevalence ?? null;
  const sample = raw?.sample ?? (Array.isArray(raw?.species) ? raw : null);
  return sample ? samplesOf([sample]) : null;
}

const n0 = (x) => Math.round(x).toLocaleString("en-US");
const pc = (x) => `${+(x * 100).toFixed(1)}%`;

/** The feed price in words: "2,816,000 node·ms·bytes, 5% of the most a flower can make in a turn"; "" when feeds are free. */
export function priceText(config) {
  const co = coopRules(config);
  return co.price > 0 ? `${n0(co.price)} ${co.unit}${co.priceShare != null ? `, ${pc(co.priceShare)} of the most a flower can make in a turn` : ""}` : "";
}

/** The rule in a paragraph, for the timing brief (empty for a game that plays the old way). n: the number of teams. */
export function prevalenceText(config, n = null) {
  const p = prevalenceOf(config);
  if (!p) return "";
  const co = coopRules(config, n), alpha = config?.scoring?.alpha ?? 0.5, beta = config?.scoring?.beta ?? 0.5;
  const K = co.perRound ? `${co.perRound} bees (⌈${p.slots} × N⌉ of the ${n})` : `⌈${p.slots} × N⌉ bees`;
  const fade = p.halfLifeS == null ? "never fades (cumulative)" : `halves every ${p.halfLifeS} s of game time`;
  return `- Prevalence, on both sides: species and bees that have done well lately are drawn more often. A round's
  ${K} are drawn one after another, without replacement, among the bees with a challenge queued, bee b
  with weight c + B_b; a bee not drawn doesn't visit that round. Each drawn bee visits a flower of a species drawn with
  weight c + F_s, with replacement, its own species included.
  F_s, a species' flower success: N × its share of Σ over bee teams of (the pollen it gave that team's bee lately)^${beta}.
  B_b, a bee's success: N × its share of max(0, Σ over species of sign(D) |D|^${alpha}), D the net nectar it got at that
  species lately; a feed's net nectar is its nectar minus the feed price, so D can be negative. "Lately": every ledger
  cell (one per species and bee team) starts at ${n0(p.prior)} and ${fade}.
  F and B have par 1${p.cap == null ? " (uncapped)" : ` and are capped at ${p.cap}`}; c runs from ${p.cStart} to ${p.cEnd} over the game.
- Your score, your fitness, is the time-average over the rounds played of F × B: your species' flower success times your
  bee's success (par 1). Every F, B, draw chance and fitness is public, about once a second: tools/status.py,
  garden.status(), garden.prevalence(), the scoreboard and the history queries (garden.game.prevalence). Programs never
  see them.`;
}
