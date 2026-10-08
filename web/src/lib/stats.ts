// Per-team numbers over time, from finished turns. A flower allocates each visit's energy budget, size cap ×
// the flower window (1,100 × 150 node·ms by default), between its size (which shrinks the whole budget),
// its compute (the CPU time it spends), and, what is left, the excess energy E: on a feed split into the
// bee's nectar and the flower's pollen, on an unfed visit lost. Built from a finished game's turns
// (everything revealed) or from the team ledger during play (every feed is public; a flower's unfed
// visits and compute time only to its own team), plus the score components over time: pollination,
// forage and fitness, from the pollen and nectar per (bee, flower) pair.
import type { GameConfig, LedgerEntry } from "../types";
import type { Turn } from "./turns";

/** One finished turn, as far as the viewer can see it. bee and flower are participant indices. */
export interface TurnRec {
  t: number; bee: number; flower: number; fed: boolean; failed: boolean;
  percent: number | null; energy: number | null; ms: number | null; pollen: number | null; nectar: number | null;
  flowerVersion: number | null;
  /** The call's hidden time budget R (ms), where the viewer may see it. */
  budgetMs: number | null;
  /** The response's size in bytes of JSON (null if it failed). */
  rBytes: number | null;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function recFromTurn(t: Turn): TurnRec | null {
  const e = t.end;
  if (!e) return null;
  return {
    t: t.t0, bee: t.bee, flower: t.flower, fed: e.action === "feed", failed: (e.r === null && !e.rHash) || !!e.flowerError,
    percent: num(e.percent), energy: num(e.energy), ms: num(e.ms), pollen: num(e.pollen), nectar: num(e.nectar),
    flowerVersion: num(e.flowerVersion), budgetMs: num(e.budgetMs), rBytes: num(e.rBytes),
  };
}

export function recFromEntry(e: LedgerEntry, roundMs: number): TurnRec {
  return {
    t: e.atMs ?? (e.round - 1) * roundMs, bee: e.bee, flower: e.flower, fed: !!e.fed, failed: (e.response === null && !e.responseHash) || !!e.flowerError,
    percent: num(e.percent), energy: num(e.energy), ms: num(e.ms), pollen: num(e.pollen), nectar: num(e.nectar),
    flowerVersion: num(e.flowerVersion), budgetMs: num(e.budgetMs), rBytes: num(e.responseBytes),
  };
}

/**
 * The energy model's constants: E = (cap − size) × max(0, R − CPU ms) [× (byteCap − bytes)], where R is the
 * call's hidden time budget (at most `window`, the flower window; without R, the window itself), and the byte
 * factor is there when the game has it (config.energy.bytes): then every figure is in node·ms·bytes, the
 * budget of a visit being cap × window × byteCap.
 */
export interface EnergyModel {
  cap: number;          // the flower size budget, also the energy cap
  window: number;       // the flower window, ms
  byteCap?: number;     // the response byte cap, when E has the byte factor
  /** The game's scoring exponents (scoringOf(config)): forage = Σ nectar^alpha, pollination = Σ pollen^beta. Left out, √. */
  alpha?: number; beta?: number;
  /** A flower version's size (participant index, version), where the viewer may know it. */
  sizeOf?: (flower: number, version: number) => number | undefined;
}

/** One team's numbers per time bin. Flower figures are about turns at its flower; bee figures about its bee's turns. */
export interface TeamBins {
  visits: Float64Array; feedsAt: Float64Array;
  percentSum: Float64Array; percentN: Float64Array;
  energySum: Float64Array; energyN: Float64Array;
  msSum: Float64Array; msN: Float64Array;
  /** The energy budget of each visit whose energy the viewer can see, and where it went. */
  budget: Float64Array; reserve: Float64Array; size: Float64Array; compute: Float64Array; bytes: Float64Array;
  pollen: Float64Array; paid: Float64Array; lost: Float64Array; lostN: Float64Array;
  beeFeeds: Float64Array; nectar: Float64Array;
  /** Score components at the end of each bin (whole game up to then). */
  pollination: Float64Array; forage: Float64Array; pollinationShare: Float64Array; forageShare: Float64Array; fitness: Float64Array;
}

export interface Binned { binMs: number; bins: number; teams: TeamBins[] }

/** A bin width that gives about `target` bins over the game, in whole rounds. */
export function binWidth(endMs: number, roundMs: number, target = 120): number {
  const rounds = Math.max(1, Math.ceil(endMs / roundMs / target));
  return rounds * roundMs;
}

export function binTurns(recs: Iterable<TurnRec>, n: number, endMs: number, binMs: number, model: EnergyModel): Binned {
  const bins = Math.max(1, Math.ceil(endMs / binMs));
  const mk = () => new Float64Array(bins);
  const teams: TeamBins[] = Array.from({ length: n }, () => ({
    visits: mk(), feedsAt: mk(), percentSum: mk(), percentN: mk(), energySum: mk(), energyN: mk(), msSum: mk(), msN: mk(),
    budget: mk(), reserve: mk(), size: mk(), compute: mk(), bytes: mk(), pollen: mk(), paid: mk(), lost: mk(), lostN: mk(), beeFeeds: mk(), nectar: mk(),
    pollination: mk(), forage: mk(), pollinationShare: mk(), forageShare: mk(), fitness: mk(),
  }));
  const { cap, window: W } = model;
  const U = model.byteCap ?? 1; // the byte factor's most: the whole cap (1 without it)
  const B = cap * W * U;
  const lastSize: (number | undefined)[] = new Array(n);
  // Pollen and nectar per (bee, flower) pair, per bin: the score components follow from their running totals.
  const pairPollen: Float64Array[] = [], pairNectar: Float64Array[] = [];
  const pairBin = (arr: Float64Array[], k: number) => (arr[k] ??= new Float64Array(n * n));

  for (const r of recs) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(r.t / binMs)));
    const f = teams[r.flower], b = teams[r.bee];
    if (f) {
      f.visits[k]++;
      if (r.fed) f.feedsAt[k]++;
      if (r.percent !== null && !r.failed) { f.percentSum[k] += r.percent; f.percentN[k]++; }
      if (r.energy !== null) {
        f.energySum[k] += r.energy; f.energyN[k]++;
        // The flower's size: its version's, else worked out from E and its compute time, else as last seen.
        let size = r.flowerVersion !== null ? model.sizeOf?.(r.flower, r.flowerVersion) : undefined;
        // The call's budget: R where known (the rest of the window, up to the most it could have been, is the
        // reserve it was never given), else the whole window.
        const R = Math.min(W, r.budgetMs ?? W);
        // The byte factor: what the response's bytes left of the cap (U without it).
        const used = model.byteCap && !r.failed && r.rBytes !== null ? Math.min(model.byteCap, r.rBytes) : 0;
        const bf = U - used;
        if (size === undefined && !r.failed && r.ms !== null && r.ms < R && r.energy > 0 && bf > 0) size = Math.round(cap - r.energy / ((R - r.ms) * bf));
        if (size === undefined) size = lastSize[r.flower];
        if (size !== undefined) lastSize[r.flower] = size;
        const BR = cap * R * U;
        const sizeCost = Math.min(BR, (size ?? 0) * R * U);
        const bytesCost = used > 0 && r.ms !== null ? Math.min(BR - sizeCost, Math.max(0, cap - (size ?? 0)) * Math.max(0, R - r.ms) * used) : 0;
        f.budget[k] += B;
        f.reserve[k] += B - BR;
        f.size[k] += sizeCost;
        f.bytes[k] += bytesCost;
        f.compute[k] += Math.max(0, BR - sizeCost - bytesCost - r.energy);
        if (r.fed) {
          f.pollen[k] += r.pollen ?? Math.max(0, r.energy - (r.nectar ?? 0));
          f.paid[k] += r.nectar ?? 0;
        } else { f.lost[k] += r.energy; f.lostN[k]++; }
      } else if (r.fed) {
        f.pollen[k] += r.pollen ?? 0;
        f.paid[k] += r.nectar ?? 0;
      }
      if (r.ms !== null) { f.msSum[k] += r.ms; f.msN[k]++; }
    }
    if (b && r.fed) {
      b.beeFeeds[k]++;
      if (r.nectar !== null) b.nectar[k] += r.nectar;
    }
    if (r.fed && f && b) {
      pairBin(pairPollen, k)[r.bee * n + r.flower] += r.pollen ?? 0;
      pairBin(pairNectar, k)[r.bee * n + r.flower] += r.nectar ?? 0;
    }
  }

  // Score components at the end of every bin: sums of powers over the running pair totals (as the server's
  // scoring.js: exactly √ at 0.5).
  const powOf = (p: number) => (p === 0.5 ? Math.sqrt : (x: number) => Math.pow(x, p));
  const powP = powOf(model.beta ?? 0.5), powN = powOf(model.alpha ?? 0.5);
  const P = new Float64Array(n * n), N = new Float64Array(n * n);
  const poll = new Float64Array(n), forage = new Float64Array(n);
  for (let k = 0; k < bins; k++) {
    const dp = pairPollen[k], dn = pairNectar[k];
    if (dp) for (let i = 0; i < n * n; i++) { P[i] += dp[i]; N[i] += dn[i]; }
    poll.fill(0); forage.fill(0);
    for (let bb = 0; bb < n; bb++) for (let ff = 0; ff < n; ff++) {
      poll[ff] += powP(Math.max(0, P[bb * n + ff]));
      forage[bb] += powN(Math.max(0, N[bb * n + ff]));
    }
    const tp = poll.reduce((s, x) => s + x, 0), tf = forage.reduce((s, x) => s + x, 0);
    for (let i = 0; i < n; i++) {
      const ps = tp > 0 ? poll[i] / tp : 1 / n, fs = tf > 0 ? forage[i] / tf : 1 / n;
      const t = teams[i];
      t.pollination[k] = poll[i]; t.forage[k] = forage[i];
      t.pollinationShare[k] = ps; t.forageShare[k] = fs; t.fitness[k] = n * n * ps * fs;
    }
  }
  return { binMs, bins, teams };
}

export type MetricKey = "fitness" | "pollination" | "forage" | "pollen" | "nectar" | "paid" | "lost" | "percent" | "energy" | "ms" | "feeds";

export interface Metric {
  key: MetricKey;
  label: string;
  /** What the y axis shows. */
  unit: string;
  /** cumulative: a running total of per-bin amounts; average: per bin, an average; level: the value at the bin's end. */
  mode: "cumulative" | "average" | "level";
  /** Per bin: [numerator, count] (count 0 means no data for an average). */
  value: (t: TeamBins, k: number) => [number, number];
  format: "energy" | "percent" | "ms" | "count" | "score";
  /** A line at par (fitness 1). */
  par?: number;
}

export const METRICS: Metric[] = [
  { key: "fitness", label: "Fitness", unit: "N² × pollination share × forage share, so far (par 1)", mode: "level", value: (t, k) => [t.fitness[k], 1], format: "score", par: 1 },
  { key: "pollination", label: "Pollination", unit: "Σ (pollen kept from each bee team)^β, so far", mode: "level", value: (t, k) => [t.pollination[k], 1], format: "score" },
  { key: "forage", label: "Forage", unit: "Σ (nectar got at each flower)^α, so far", mode: "level", value: (t, k) => [t.forage[k], 1], format: "score" },
  { key: "pollen", label: "Pollen kept by the flower", unit: "node·ms, so far", mode: "cumulative", value: (t, k) => [t.pollen[k], 1], format: "energy" },
  { key: "nectar", label: "Nectar collected by the bee", unit: "node·ms, so far", mode: "cumulative", value: (t, k) => [t.nectar[k], 1], format: "energy" },
  { key: "paid", label: "Nectar paid by the flower", unit: "node·ms, so far", mode: "cumulative", value: (t, k) => [t.paid[k], 1], format: "energy" },
  { key: "lost", label: "Energy lost on unfed visits", unit: "node·ms, so far", mode: "cumulative", value: (t, k) => [t.lost[k], 1], format: "energy" },
  { key: "feeds", label: "Feeds at the flower", unit: "feeds, so far", mode: "cumulative", value: (t, k) => [t.feedsAt[k], 1], format: "count" },
  { key: "percent", label: "Percent offered", unit: "% of E, average per visit", mode: "average", value: (t, k) => [t.percentSum[k], t.percentN[k]], format: "percent" },
  { key: "energy", label: "Excess energy per visit", unit: "E, node·ms, average per visit", mode: "average", value: (t, k) => [t.energySum[k], t.energyN[k]], format: "energy" },
  { key: "ms", label: "Flower compute time", unit: "CPU ms, average per visit", mode: "average", value: (t, k) => [t.msSum[k], t.msN[k]], format: "ms" },
];

/** A metric's line for one team: one value per bin (null: no data in that bin, for averages). */
export function seriesOf(m: Metric, t: TeamBins, bins: number, upto = bins): (number | null)[] {
  const out: (number | null)[] = [];
  let acc = 0;
  for (let k = 0; k < bins; k++) {
    if (k >= upto) { out.push(null); continue; }
    const [v, c] = m.value(t, k);
    if (m.mode === "cumulative") { acc += v; out.push(acc); }
    else out.push(c > 0 ? v / c : null);
  }
  return out;
}

/**
 * Whole-game totals per flower: its visits' energy budget and where it went. `known`: every visit's
 * energy was visible (its own team during play, everyone after the game), so the lost part is complete.
 */
export interface EnergyTotals { budget: number; reserve: number; size: number; compute: number; bytes: number; pollen: number; nectar: number; lost: number; visits: number; feeds: number; known: boolean }

export function totalsOf(t: TeamBins): EnergyTotals {
  const sum = (a: Float64Array) => a.reduce((s, x) => s + x, 0);
  const visits = sum(t.visits), feeds = sum(t.feedsAt);
  return {
    budget: sum(t.budget), reserve: sum(t.reserve), size: sum(t.size), compute: sum(t.compute), bytes: sum(t.bytes), pollen: sum(t.pollen), nectar: sum(t.paid), lost: sum(t.lost),
    visits, feeds, known: visits > 0 && sum(t.energyN) >= visits,
  };
}

/** The range a flower call's hidden time budget R is drawn from (the config's, else 50 to the flower window). */
export function flowerBudgetRange(cfg: GameConfig): { min: number; max: number } {
  const f = cfg.budgets.flower as { ms: number; minMs?: number; maxMs?: number };
  return { min: f.minMs ?? 50, max: f.maxMs ?? f.ms };
}

/** A size lookup from teams' version histories (participant index → flower version → size). */
export function sizeLookup(teams: { programs: { flower: { version: number; size: number }[] } | null }[]): EnergyModel["sizeOf"] {
  const maps = teams.map((t) => new Map((t.programs?.flower ?? []).map((v) => [v.version, v.size])));
  return (f, v) => maps[f]?.get(v);
}
