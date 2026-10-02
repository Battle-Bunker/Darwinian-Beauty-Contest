// How long programs take against their time limits: a row of figures (typical, slow end, slowest, missed)
// and a small histogram of the times, with the limit marked and the misses in their own labelled bin.
// During play you see this for your own programs only (other teams' times are private until the end).
import { useMemo } from "react";
import type { Action, GameView, Kind, Team } from "../types";
import { isTooSlow } from "./Feed";
import { TeamChip } from "./ui";

const BINS = 10;

export interface TimingData { values: number[]; misses: number }

const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] : NaN);
const fmtMs = (x: number) => (!Number.isFinite(x) ? "–" : x < 10 ? x.toFixed(1) : String(Math.round(x)));

/** A bee's decision times (beeMs) and deadline misses among `actions`. */
export function beeTiming(actions: Action[], team: string | null): TimingData {
  const values: number[] = [];
  let misses = 0;
  for (const a of actions) {
    if (team && a.bee !== team) continue;
    if (isTooSlow(a)) misses++;
    else if (typeof a.beeMs === "number") values.push(a.beeMs);
  }
  return { values, misses };
}

/** A flower's answer times (ms) and failed answers (no answer in time, or a crash) at `team`'s patch. */
export function flowerTiming(actions: Action[], team: string | null, kind: "cosmos" | "orchid"): TimingData {
  const values: number[] = [];
  let misses = 0;
  for (const a of actions) {
    if (a.action !== "ask" || a.kind !== kind || (team && a.patch !== team)) continue;
    if (a.error && a.by === "flower") misses++;
    else if (typeof a.ms === "number") values.push(a.ms);
  }
  return { values, misses };
}

export function TimingPanel({ data, limit, title, unit, missLabel }: {
  data: TimingData; limit: number; title: string; unit: string; missLabel: string;
}) {
  const { values, misses } = data;
  const stats = useMemo(() => {
    const sorted = [...values].sort((a, b) => a - b);
    const bins = new Array(BINS).fill(0);
    let over = 0;
    for (const v of values) {
      if (v > limit) over++;
      else bins[Math.min(BINS - 1, Math.floor((v / limit) * BINS))]++;
    }
    return { median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: sorted.length ? sorted[sorted.length - 1] : NaN, bins, over };
  }, [values, limit]);
  const n = values.length + misses;
  const late = stats.over + misses;
  const peak = Math.max(1, ...stats.bins, late);
  const width = limit / BINS;
  if (!n) return <div className="timing"><div className="timing-title"><b>{title}</b></div><p className="small muted">Nothing measured yet.</p></div>;
  return (
    <div className="timing">
      <div className="timing-title"><b>{title}</b> <span className="small muted">({n.toLocaleString()} {unit}; limit {limit} ms)</span></div>
      <div className="timing-stats">
        <span className="timing-stat"><span className="timing-label">Typical</span><b>{fmtMs(stats.median)}</b><span className="muted"> ms</span></span>
        <span className="timing-stat"><span className="timing-label">Slowest 10%</span><b>{fmtMs(stats.p90)}</b><span className="muted"> ms</span></span>
        <span className="timing-stat"><span className="timing-label">Slowest</span><b>{fmtMs(stats.max)}</b><span className="muted"> ms</span></span>
        <span className={`timing-stat ${late ? "timing-bad" : ""}`}>
          <span className="timing-label">{late ? <><span aria-hidden>⏱ </span>{missLabel}</> : missLabel}</span>
          <b>{late.toLocaleString()}</b><span className="muted"> ({n ? Math.round((late / n) * 100) : 0}%)</span>
        </span>
      </div>
      <div className="timing-hist" role="img" aria-label={`Histogram of ${unit}: ${stats.bins.map((c, i) => `${Math.round(i * width)}–${Math.round((i + 1) * width)} ms: ${c}`).join(", ")}; over the limit: ${late}`}>
        <div className="timing-bars">
          {stats.bins.map((c, i) => (
            <span key={i} className="timing-col" title={`${fmtMs(i * width)}–${fmtMs((i + 1) * width)} ms: ${c.toLocaleString()}`}>
              <span className="timing-bar" style={{ height: `${c ? Math.max(3, (c / peak) * 100) : 0}%` }} />
            </span>
          ))}
          <span className="timing-limit" aria-hidden><span>limit</span></span>
          <span className="timing-col timing-col-late" title={`${missLabel}: ${late.toLocaleString()}`}>
            <span className="timing-bar timing-bar-late" style={{ height: `${late ? Math.max(3, (late / peak) * 100) : 0}%` }} />
          </span>
        </div>
        <div className="timing-axis small muted" aria-hidden>
          <span>0</span><span>{fmtMs(limit / 2)}</span><span>{limit} ms</span><span className="timing-axis-late">late</span>
        </div>
      </div>
    </div>
  );
}

/** For a finished game: every team's typical times, from the actions held (all of them if loaded). */
export function TimingTable({ view, actions }: { view: GameView; actions: Action[] }) {
  const cfg = view.game.config;
  const teams: Record<string, Team> = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  const rows = (view.participants ?? []).map((id) => {
    const bee = beeTiming(actions, id);
    const flowers = (["cosmos", "orchid"] as const).map((k) => flowerTiming(actions, id, k));
    return { id, bee, flowers };
  });
  const med = (d: TimingData) => { const s = [...d.values].sort((a, b) => a - b); return quantile(s, 0.5); };
  const p90 = (d: TimingData) => { const s = [...d.values].sort((a, b) => a - b); return quantile(s, 0.9); };
  const cell = (d: TimingData, limit: number) => (
    <td className={d.misses ? "bad" : ""} title={`typical ${fmtMs(med(d))} ms, slowest 10% ${fmtMs(p90(d))} ms, limit ${limit} ms, missed ${d.misses}`}>
      {fmtMs(med(d))} <span className="muted small">/ {fmtMs(p90(d))}</span>{d.misses ? <span className="small"> · ⏱ {d.misses}</span> : null}
    </td>
  );
  const kinds: Kind[] = ["bee", "cosmos", "orchid"];
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption className="sr-only">How long each team's programs took</caption>
        <thead><tr><th className="left">Team</th>{kinds.map((k) => <th key={k}>{k} ({cfg.budgets[k].ms} ms)</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === view.me?.teamId ? "mine" : ""}>
              <th scope="row" className="left"><TeamChip team={teams[r.id]} you={r.id === view.me?.teamId} short /></th>
              {cell(r.bee, cfg.budgets.bee.ms)}
              {cell(r.flowers[0], cfg.budgets.cosmos.ms)}
              {cell(r.flowers[1], cfg.budgets.orchid.ms)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
