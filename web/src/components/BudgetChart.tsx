// Each flower call's hidden time budget R (uniform in a range, 50–150 ms by default) against the work the
// flower did (its CPU ms): one small scatter per species. A dot under the diagonal finished in time, and
// what was left, R − CPU ms, became energy; on or over it the call ran out of budget and made nothing.
import { useMemo, useState } from "react";
import type { Team } from "../types";
import { fmtMs, plural } from "../lib/format";

export interface BudgetPoint { flower: number; r: number; ms: number | null; failed: boolean }

const S = 168, PAD = { l: 34, r: 8, t: 8, b: 26 };

export function BudgetChart({ teams, points, min, max }: { teams: Team[]; points: BudgetPoint[]; min: number; max: number }) {
  const [pick, setPick] = useState<number | null>(null);
  const bySpecies = useMemo(() => {
    const m = teams.map(() => [] as BudgetPoint[]);
    for (const p of points) m[p.flower]?.push(p);
    return m;
  }, [teams, points]);
  const top = Math.max(max, ...points.map((p) => Math.min(max * 1.2, p.ms ?? 0)));
  const x = (v: number) => PAD.l + ((v - 0) / max) * (S - PAD.l - PAD.r);
  const y = (v: number) => S - PAD.b - (Math.min(v, top) / top) * (S - PAD.t - PAD.b);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div className="budget-charts">
      <p className="small muted">
        Every visit, the flower had a hidden time budget R, drawn from {min}–{max} ms (x), and used some CPU time (y). Under the diagonal it finished in time, and (cap − size) × (R − CPU ms) became its energy; on or over it, it ran out and made nothing (×).
      </p>
      <div className="budget-grid">
        {teams.map((t, i) => {
          const pts = bySpecies[i] ?? [];
          const failed = pts.filter((p) => p.failed).length;
          const avgR = pts.length ? pts.reduce((s, p) => s + p.r, 0) / pts.length : NaN;
          const used = pts.filter((p) => !p.failed && p.ms !== null);
          const avgUse = used.length ? used.reduce((s, p) => s + (p.ms ?? 0) / p.r, 0) / used.length : NaN;
          const show = pts.length > 1500 ? pts.filter((_, k) => k % Math.ceil(pts.length / 1500) === 0) : pts;
          return (
            <figure key={t.id} className={`budget-cell ${pick !== null && pick !== i ? "dim" : ""}`} onMouseEnter={() => setPick(i)} onMouseLeave={() => setPick(null)}>
              <figcaption className="small"><span className="swatch" style={{ background: t.color }} /> <b>{t.name}</b></figcaption>
              <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${t.name}: ${plural(pts.length, "visit")}, budget against CPU time`}>
                <rect x={PAD.l} y={PAD.t} width={S - PAD.l - PAD.r} height={S - PAD.t - PAD.b} className="budget-plot" />
                <rect x={PAD.l} y={PAD.t} width={x(min) - PAD.l} height={S - PAD.t - PAD.b} className="budget-never" />
                <line x1={x(0)} y1={y(0)} x2={x(Math.min(max, top))} y2={y(Math.min(max, top))} className="budget-diag" />
                {ticks.map((v) => <text key={`x${v}`} x={x(v)} y={S - 12} className="chart-tick" textAnchor="middle">{v}</text>)}
                {ticks.map((v) => <text key={`y${v}`} x={PAD.l - 4} y={y(v) + 4} className="chart-tick" textAnchor="end">{v}</text>)}
                <text x={(PAD.l + S - PAD.r) / 2} y={S - 1} className="chart-tick" textAnchor="middle">R (ms)</text>
                {show.map((p, k) => p.failed
                  ? <path key={k} d={`M${x(p.r) - 2.5} ${y(p.ms ?? p.r) - 2.5}l5 5m0 -5l-5 5`} className="budget-x" />
                  : <circle key={k} cx={x(p.r)} cy={y(p.ms ?? 0)} r={2.2} fill={t.color} className="budget-dot" />)}
              </svg>
              <div className="small muted budget-stats">
                {pts.length ? <>{plural(pts.length, "visit")} · R {fmtMs(avgR)} ms on average · used {Number.isFinite(avgUse) ? `${Math.round(avgUse * 100)}%` : "–"} of it{failed ? <> · <span className="bad-text">{failed} out of time</span></> : null}</> : "no visits"}
              </div>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
