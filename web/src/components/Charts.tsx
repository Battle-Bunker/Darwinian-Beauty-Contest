// Two charts: a team-per-line time series (with a crosshair that reads every team at once, a cursor for
// the replay's time, and click to seek), and where each flower's energy went (kept / paid / lost) as
// stacked bars. Lines and bars wear the team colours; text stays in ink; both have a table view.
import { useMemo, useRef, useState } from "react";
import type { Team } from "../types";
import { useElementWidth } from "../hooks";
import { fmtClock, fmtE, fmtEExact, fmtMs } from "../lib/format";
import { METRICS, seriesOf, type Binned, type EnergyTotals, type Metric, type MetricKey } from "../lib/stats";

const H = 230;
const M = { top: 12, right: 14, bottom: 24, left: 56 };

export function formatValue(m: Metric, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "–";
  switch (m.format) {
    case "energy": return fmtE(v);
    case "percent": return `${v.toFixed(v < 10 ? 1 : 0)}%`;
    case "ms": return `${fmtMs(v)} ms`;
    case "score": return v < 10 ? v.toFixed(2) : v < 1000 ? v.toFixed(1) : Math.round(v).toLocaleString();
    default: return Math.round(v).toLocaleString();
  }
}

function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max * 1.0001 + step * 0.999; v += step) { out.push(v); if (v >= max) break; }
  return out;
}

function timeTicks(span: number): number[] {
  const step = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000].find((s) => span / s <= 6) ?? 3600000;
  const out: number[] = [];
  for (let t = 0; t <= span + 1; t += step) out.push(t);
  return out;
}

/** Pick which metric a chart shows. `only` limits the choice (e.g. what one team can see during play). */
export function MetricPicker({ value, onChange, only }: { value: MetricKey; onChange: (k: MetricKey) => void; only?: MetricKey[] }) {
  const list = only ? METRICS.filter((m) => only.includes(m.key)) : METRICS;
  return (
    <label className="feed-filter"><span>Show</span>
      <select value={value} onChange={(e) => onChange(e.target.value as MetricKey)} aria-label="What to chart">
        {list.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
    </label>
  );
}

export function TeamSeriesChart({ teams, rows, data, metric, focus, onFocus, cursor, onSeek, upto, endMs }: {
  teams: Team[];               // by participant index
  rows: number[];              // which teams to draw (participant indices)
  data: Binned;
  metric: MetricKey;
  focus: number | null;
  onFocus?: (i: number | null) => void;
  cursor?: number | null;      // game time to mark (the replay's)
  onSeek?: (t: number) => void;
  upto?: number;               // bins with data (later bins are blank, e.g. still loading)
  endMs: number;
}) {
  const m = METRICS.find((x) => x.key === metric)!;
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(260, width);
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
  const series = useMemo(() => rows.map((i) => ({ i, v: seriesOf(m, data.teams[i], data.bins, upto ?? data.bins) })), [rows, m, data, upto]);
  // Score levels swing wildly over the first few feeds: scale to the game after its opening tenth (the
  // opening is clipped at the top of the plot).
  const skip = m.mode === "level" ? Math.floor(data.bins / 10) : 0;
  const values = series.flatMap((s) => s.v.slice(skip).filter((x): x is number => x !== null));
  const max = Math.max(m.format === "percent" ? 10 : 0, m.par !== undefined ? m.par * 1.2 : 0, ...(values.length ? values : series.flatMap((s) => s.v.filter((x): x is number => x !== null))));
  const clipped = skip > 0 && series.some((s) => s.v.slice(0, skip).some((x) => x !== null && x > max));
  const clipId = `clip-${metric}-${rows.join("-")}`;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const span = Math.max(data.binMs, endMs);
  const x = (k: number) => M.left + ((k + 0.5) * data.binMs / span) * pw;
  const y = (v: number) => M.top + ph - (v / top) * ph;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const binAt = (e: { clientX: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = ((px - M.left) / pw) * span;
    return Math.max(0, Math.min(data.bins - 1, Math.floor(t / data.binMs)));
  };

  const paths = series.map(({ i, v }) => {
    let d = "", pen = false;
    v.forEach((val, k) => {
      if (val === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(k).toFixed(1)} ${y(val).toFixed(1)}`;
      pen = true;
    });
    return { i, d, last: [...v].reverse().find((z) => z !== null) ?? null };
  });
  const tipRows = hover === null ? [] : series
    .map(({ i, v }) => ({ i, val: v[hover] }))
    .sort((a, b) => (b.val ?? -Infinity) - (a.val ?? -Infinity));
  const tipLeft = hover === null ? 0 : x(hover);

  return (
    <div className="chart" ref={boxRef}>
      <div className="chart-head small muted">{m.label}: {m.unit}</div>
      <div className="chart-plot">
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.label} over the game, one line per team`}
          onPointerMove={(e) => setHover(binAt(e))} onPointerLeave={() => setHover(null)}
          onClick={(e) => { const k = binAt(e); if (k !== null && onSeek) onSeek(k * data.binMs); }}
          className={onSeek ? "seekable" : undefined}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={M.left - 6} y={y(t) + 4} className="chart-tick" textAnchor="end">{formatValue(m, t)}</text>
            </g>
          ))}
          {timeTicks(span).map((t) => (
            <text key={t} x={M.left + (t / span) * pw} y={H - 6} className="chart-tick" textAnchor={t === 0 ? "start" : t / span > 0.97 ? "end" : "middle"}>{fmtClock(t)}</text>
          ))}
          <defs><clipPath id={clipId}><rect x={M.left - 4} y={M.top - 2} width={pw + 8} height={ph + 4} /></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            {paths.map(({ i, d }) => (
              <path key={i} d={d} fill="none" stroke={teams[i]?.color} strokeWidth={focus === i ? 3 : 2} strokeLinejoin="round" strokeLinecap="round"
                opacity={focus === null || focus === i ? 1 : 0.28} />
            ))}
          </g>
          {clipped && <text x={M.left + 4} y={M.top + 10} className="chart-tick">↑ off the scale while there were few feeds</text>}
          {m.par !== undefined && m.par <= top && <line x1={M.left} x2={W - M.right} y1={y(m.par)} y2={y(m.par)} className="chart-par" />}
          {typeof cursor === "number" && cursor >= 0 && <line x1={M.left + (cursor / span) * pw} x2={M.left + (cursor / span) * pw} y1={M.top} y2={M.top + ph} className="chart-cursor" />}
          {hover !== null && <line x1={tipLeft} x2={tipLeft} y1={M.top} y2={M.top + ph} className="chart-crosshair" />}
          {hover !== null && series.map(({ i, v }) => v[hover] !== null && (
            <circle key={i} cx={tipLeft} cy={y(v[hover]!)} r={4} fill={teams[i]?.color} className="chart-dot" />
          ))}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: Math.min(W - 190, Math.max(0, tipLeft + 12)) }} role="status">
            <div className="chart-tip-time">{fmtClock(hover * data.binMs)}–{fmtClock((hover + 1) * data.binMs)}</div>
            {tipRows.slice(0, 10).map(({ i, val }) => (
              <div key={i} className="chart-tip-row">
                <span className="line-key" style={{ background: teams[i]?.color }} />
                <b>{formatValue(m, val)}</b>
                <span className="muted">{teams[i]?.name}</span>
              </div>
            ))}
            {tipRows.length > 10 && <div className="muted small">and {tipRows.length - 10} more</div>}
          </div>
        )}
      </div>
      {rows.length > 1 && (
        <ul className="chart-legend" aria-label="Teams">
          {rows.map((i) => (
            <li key={i}>
              <button className={`legend-btn ${focus === i ? "on" : ""}`} onClick={() => onFocus?.(focus === i ? null : i)} aria-pressed={focus === i}>
                <span className="line-key" style={{ background: teams[i]?.color }} />{teams[i]?.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="chart-table">
        <summary className="small">As a table</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th className="left">Team</th><th>{m.mode === "average" ? "Average of bins" : "At the end"}</th><th>Highest</th></tr></thead>
            <tbody>
              {series.map(({ i, v }) => {
                const vals = v.filter((z): z is number => z !== null);
                const whole = m.mode !== "average" ? vals.at(-1) ?? null : vals.length ? vals.reduce((s, z) => s + z, 0) / vals.length : null;
                return (
                  <tr key={i}>
                    <th scope="row" className="left"><span className="team-chip"><span className="swatch" style={{ background: teams[i]?.color }} />{teams[i]?.name}</span></th>
                    <td>{formatValue(m, whole)}</td>
                    <td>{formatValue(m, vals.length ? Math.max(...vals) : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const PARTS = [
  { key: "size", cls: "e-size", label: "size", long: "size: a bigger flower shrinks the whole budget" },
  { key: "compute", cls: "e-compute", label: "compute", long: "compute: CPU time spent answering (and failed answers)" },
  { key: "pollen", cls: "e-pollen", label: "pollen given", long: "pollen given to bees that fed, to carry to other flowers" },
  { key: "nectar", cls: "e-nectar", label: "nectar given", long: "nectar given to bees that fed" },
  { key: "lost", cls: "e-lost", label: "lost", long: "lost: the bee didn't feed" },
] as const;

/**
 * Where each flower's energy went. Every visit has the same budget, size cap × flower window; the flower's
 * size takes a slice, its compute another, and the rest (E) goes to the bee as pollen and nectar on a feed,
 * or is lost when the bee doesn't feed. Rows with `t.known` false (another team's flower during play) show
 * only what's public: the pollen and nectar of its feeds.
 */
export function EnergySplit({ rows }: { rows: { team: Team; t: EnergyTotals; you?: boolean }[] }) {
  const seg = (v: number, cls: string, label: string, team: Team, total: number) => v > 0 && (
    <span className={`split-seg ${cls}`} style={{ flexGrow: v }} title={`${team.name}: ${label} ${fmtEExact(v)} (${Math.round((v / total) * 100)}%)`} tabIndex={0} aria-label={`${label} ${fmtE(v)}`} />
  );
  return (
    <div className="split">
      <ul className="split-legend" aria-label="Legend">
        {PARTS.map((p) => <li key={p.key}><span className={`rect-key ${p.cls}`} /> {p.long}</li>)}
      </ul>
      {rows.map(({ team, t, you }) => {
        const total = t.known ? t.budget : t.pollen + t.nectar;
        const given = t.pollen + t.nectar;
        return (
          <div key={team.id} className="split-row">
            <span className="team-chip split-name" title={team.name}><span className="swatch" style={{ background: team.color }} /><span className="team-name">{team.name}</span>{you && <span className="you-tag">you</span>}</span>
            <span className="split-track">
              <span className="split-bar" style={{ width: "100%" }}>
                {total > 0 && PARTS.map((p) => (t.known || p.key === "pollen" || p.key === "nectar") && seg(t[p.key], p.cls, p.label, team, total))}
              </span>
              <span className="split-total small">
                {t.known && total > 0
                  ? <>{Math.round((t.pollen / total) * 100)}% pollen · {Math.round((t.nectar / total) * 100)}% nectar · {Math.round((t.lost / total) * 100)}% lost</>
                  : given > 0 ? <>gave {fmtE(given)}: {Math.round((t.pollen / given) * 100)}% pollen <span className="muted">(the rest is private)</span></> : <span className="muted">nothing given yet</span>}
              </span>
            </span>
          </div>
        );
      })}
      <details className="chart-table">
        <summary className="small">As a table</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th className="left">Flower</th><th>Visits</th><th>Fed</th><th>Budget</th><th>Size</th><th>Compute</th><th>Pollen given</th><th>Nectar given</th><th>Lost</th></tr></thead>
            <tbody>
              {rows.map(({ team, t }) => (
                <tr key={team.id}>
                  <th scope="row" className="left">{team.name}</th>
                  <td>{t.visits.toLocaleString()}</td>
                  <td>{t.feeds.toLocaleString()}</td>
                  {(["budget", "size", "compute"] as const).map((k) => <td key={k} title={t.known ? fmtEExact(t[k]) : "private"}>{t.known ? fmtE(t[k]) : "–"}</td>)}
                  <td title={fmtEExact(t.pollen)}>{fmtE(t.pollen)}</td>
                  <td title={fmtEExact(t.nectar)}>{fmtE(t.nectar)}</td>
                  <td title={t.known ? fmtEExact(t.lost) : "private"}>{t.known ? fmtE(t.lost) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
