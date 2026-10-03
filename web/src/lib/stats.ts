// Per-team numbers over time, from finished turns: what each flower offered, the energy it made, what it
// kept, paid and lost, and the nectar each bee collected. Built from a finished game's turns (everything
// revealed) or from the team ledger during play (my own flower's details, plus every feed, which is public).
import type { LedgerEntry } from "../types";
import type { Turn } from "./turns";

/** One finished turn, as far as the viewer can see it. bee and flower are participant indices. */
export interface TurnRec {
  t: number; bee: number; flower: number; fed: boolean; failed: boolean;
  percent: number | null; energy: number | null; ms: number | null; surplus: number | null; nectar: number | null;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function recFromTurn(t: Turn): TurnRec | null {
  const e = t.end;
  if (!e) return null;
  return {
    t: t.t0, bee: t.bee, flower: t.flower, fed: e.action === "feed", failed: e.r === null || !!e.flowerError,
    percent: num(e.percent), energy: num(e.energy), ms: num(e.ms), surplus: num(e.surplus), nectar: num(e.nectar),
  };
}

export function recFromEntry(e: LedgerEntry, roundMs: number): TurnRec {
  return {
    t: (e.round - 1) * roundMs, bee: e.bee, flower: e.flower, fed: !!e.fed, failed: e.response === null,
    percent: num(e.percent), energy: num(e.energy), ms: num(e.ms), surplus: num(e.surplus), nectar: num(e.nectar),
  };
}

/** One team's numbers per time bin. Flower figures are about turns at its flower; bee figures about its bee's turns. */
export interface TeamBins {
  visits: Float64Array; feedsAt: Float64Array;
  percentSum: Float64Array; percentN: Float64Array;
  energySum: Float64Array; energyN: Float64Array;
  msSum: Float64Array; msN: Float64Array;
  kept: Float64Array; paid: Float64Array; lost: Float64Array; lostN: Float64Array;
  beeFeeds: Float64Array; nectar: Float64Array;
}

export interface Binned { binMs: number; bins: number; teams: TeamBins[] }

/** A bin width that gives about `target` bins over the game, in whole rounds. */
export function binWidth(endMs: number, roundMs: number, target = 120): number {
  const rounds = Math.max(1, Math.ceil(endMs / roundMs / target));
  return rounds * roundMs;
}

export function binTurns(recs: Iterable<TurnRec>, n: number, endMs: number, binMs: number): Binned {
  const bins = Math.max(1, Math.ceil(endMs / binMs));
  const mk = () => new Float64Array(bins);
  const teams: TeamBins[] = Array.from({ length: n }, () => ({
    visits: mk(), feedsAt: mk(), percentSum: mk(), percentN: mk(), energySum: mk(), energyN: mk(), msSum: mk(), msN: mk(),
    kept: mk(), paid: mk(), lost: mk(), lostN: mk(), beeFeeds: mk(), nectar: mk(),
  }));
  for (const r of recs) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(r.t / binMs)));
    const f = teams[r.flower], b = teams[r.bee];
    if (f) {
      f.visits[k]++;
      if (r.fed) f.feedsAt[k]++;
      if (r.percent !== null && !r.failed) { f.percentSum[k] += r.percent; f.percentN[k]++; }
      if (r.energy !== null) { f.energySum[k] += r.energy; f.energyN[k]++; }
      if (r.ms !== null) { f.msSum[k] += r.ms; f.msN[k]++; }
      if (r.fed) {
        if (r.surplus !== null) f.kept[k] += r.surplus;
        if (r.nectar !== null) f.paid[k] += r.nectar;
      } else if (r.energy !== null) { f.lost[k] += r.energy; f.lostN[k]++; }
    }
    if (b && r.fed) {
      b.beeFeeds[k]++;
      if (r.nectar !== null) b.nectar[k] += r.nectar;
    }
  }
  return { binMs, bins, teams };
}

export type MetricKey = "surplus" | "nectar" | "paid" | "lost" | "percent" | "energy" | "ms" | "feeds";

export interface Metric {
  key: MetricKey;
  label: string;
  /** What the y axis shows. */
  unit: string;
  cumulative: boolean;
  /** Per bin: [numerator, count] (count 0 means no data for an average). */
  value: (t: TeamBins, k: number) => [number, number];
  format: "energy" | "percent" | "ms" | "count";
  /** Whether a team's own row needs private fields (unfed turns' energy, compute time). */
  privateField?: boolean;
}

export const METRICS: Metric[] = [
  { key: "surplus", label: "Surplus kept", unit: "node·ms, so far", cumulative: true, value: (t, k) => [t.kept[k], 1], format: "energy" },
  { key: "nectar", label: "Nectar collected by the bee", unit: "node·ms, so far", cumulative: true, value: (t, k) => [t.nectar[k], 1], format: "energy" },
  { key: "paid", label: "Nectar paid by the flower", unit: "node·ms, so far", cumulative: true, value: (t, k) => [t.paid[k], 1], format: "energy" },
  { key: "lost", label: "Energy lost on unfed visits", unit: "node·ms, so far", cumulative: true, value: (t, k) => [t.lost[k], 1], format: "energy", privateField: true },
  { key: "feeds", label: "Feeds at the flower", unit: "feeds, so far", cumulative: true, value: (t, k) => [t.feedsAt[k], 1], format: "count" },
  { key: "percent", label: "Percent offered", unit: "% of E, average per visit", cumulative: false, value: (t, k) => [t.percentSum[k], t.percentN[k]], format: "percent" },
  { key: "energy", label: "Energy per visit", unit: "E, node·ms, average per visit", cumulative: false, value: (t, k) => [t.energySum[k], t.energyN[k]], format: "energy" },
  { key: "ms", label: "Flower compute time", unit: "CPU ms, average per visit", cumulative: false, value: (t, k) => [t.msSum[k], t.msN[k]], format: "ms", privateField: true },
];

/** A metric's line for one team: one value per bin (null: no data in that bin, for averages). */
export function seriesOf(m: Metric, t: TeamBins, bins: number, upto = bins): (number | null)[] {
  const out: (number | null)[] = [];
  let acc = 0;
  for (let k = 0; k < bins; k++) {
    if (k >= upto) { out.push(null); continue; }
    const [v, c] = m.value(t, k);
    if (m.cumulative) { acc += v; out.push(acc); }
    else out.push(c > 0 ? v / c : null);
  }
  return out;
}

/** Whole-game totals per team: where each flower's energy went. */
export interface EnergyTotals { energy: number; kept: number; paid: number; lost: number; visits: number; feeds: number; lostKnown: boolean }

export function totalsOf(t: TeamBins): EnergyTotals {
  const sum = (a: Float64Array) => a.reduce((s, x) => s + x, 0);
  const visits = sum(t.visits), feeds = sum(t.feedsAt), lostN = sum(t.lostN);
  return { energy: sum(t.energySum), kept: sum(t.kept), paid: sum(t.paid), lost: sum(t.lost), visits, feeds, lostKnown: lostN >= visits - feeds && visits > 0 };
}
