// Prevalence on both sides, beside the scoreboard: each round ceil(slots × N) bees are drawn by c + B (bee
// success), each visiting a species drawn by c + F (flower success); fitness is the time-average of F × B.
// Every team's F, B, draw chances and fitness now, and one of them over the game so far (GET .../prevalence,
// then each new sample as the live numbers bring it). Public; programs never see it.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { GameView, PrevalenceSample, PrevalenceSpecies, Team } from "../types";
import { fmt2, fmtClock, fmtE, pct } from "../lib/format";
import { useElementWidth } from "../hooks";
import { InfoTip, TeamChip } from "./ui";

/** Every sample so far: loaded once, then whatever is newer than the last one we have, as the latest moves on. */
function useSamples(base: string, latest: number | null, on: boolean): PrevalenceSample[] {
  const [samples, setSamples] = useState<PrevalenceSample[]>([]);
  useEffect(() => { setSamples([]); }, [base]);
  useEffect(() => {
    if (!on) return;
    const have = samples.length ? samples[samples.length - 1].round : 0;
    if (latest !== null && latest <= have) return;
    let stale = false;
    api<{ samples: PrevalenceSample[] }>("GET", `${base}/prevalence?after=${have}`)
      .then((r) => { if (!stale && r.samples.length) setSamples((s) => [...s.filter((x) => x.round <= have), ...r.samples]); })
      .catch(() => { /* the next sample will try again */ });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, latest, on]);
  return samples;
}

type SeriesKey = "fitness" | "flowerP" | "beeP" | "flowerSuccess" | "beeSuccess";
const SERIES: { key: SeriesKey; label: string; percent: boolean }[] = [
  { key: "fitness", label: "fitness so far (the time-average of F × B)", percent: false },
  { key: "flowerP", label: "p^F, the chance a visit is to each species", percent: true },
  { key: "beeP", label: "p^B, each bee's share of the bee draw", percent: true },
  { key: "flowerSuccess", label: "F, flower success", percent: false },
  { key: "beeSuccess", label: "B, bee success", percent: false },
];

export function PrevalencePanel({ view, base }: { view: GameView; base: string }) {
  const pv = view.prevalence ?? null;
  const sample = pv?.sample ?? null;
  const samples = useSamples(base, sample?.round ?? null, !!pv && view.game.status !== "lobby");
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const [series, setSeries] = useState<SeriesKey>("fitness");
  if (!pv) return null;
  const n = view.participants?.length ?? 0;
  const myTeamId = view.me?.teamId ?? null;
  const now = sample ? [...sample.species].sort((a, b) => b.fitness - a.fitness) : [];
  const maxP = Math.max(2 / Math.max(1, n), ...now.flatMap((s) => [s.flowerP, s.beeP]));
  const how = `Each round ceil(${pv.slots} × N) bees visit, drawn without replacement with weights c + B; each visits a species drawn with weights c + F. ` +
    `F is the species' recent flower success: N × its share of the pollen it gave (each bee team's, to the power β); B is the bee's: N × its share of the net nectar it got ` +
    `(nectar − the feed price of ${fmtE(pv.feedPrice)} a feed, losses counting against it). Recent: ${pv.halfLifeS ? `halving every ${pv.halfLifeS} s of game time` : "the whole game"}` +
    `${pv.cap != null ? `; each capped at ${pv.cap}` : ""}; par is 1. c gives everyone a share whatever their success, falling from ${pv.cStart} to ${pv.cEnd} over the game. ` +
    "Fitness is the time-average of F × B. Programs never see any of it.";
  const bar = (v: number, color: string | undefined) => (
    <span className="prev-track" aria-hidden>
      <span className="prev-fill" style={{ width: `${Math.min(100, (v / maxP) * 100)}%`, background: color }} />
      <span className="prev-par" style={{ left: `${Math.min(100, (1 / Math.max(1, n) / maxP) * 100)}%` }} />
    </span>
  );
  return (
    <div className="prevalence">
      <p className="small muted">
        <b>Prevalence</b> <InfoTip>{how}</InfoTip>{" "}
        {!sample ? "starts with the first round." : <>as of {fmtClock(sample.atMs)}: {sample.slots} of {n} bees visit each round; c = {fmt2(sample.c)}. Par is {pct(1 / Math.max(1, n))} for a draw chance, 1 for F, B and fitness.</>}
      </p>
      {now.length > 0 && (
        <div className="table-scroll">
          <table className="data-table prev-table">
            <thead>
              <tr>
                <th className="left">Team</th>
                <th title="The time-average of F × B so far: the team's score">Fitness</th>
                <th title="F: its species' recent flower success, par 1">F</th>
                <th className="left" title="p^F: the chance a visit is to its species">flower drawn</th>
                <th title="B: its bee's recent success, net of the feed price, par 1">B</th>
                <th className="left" title="p^B: its bee's share of the bee draw (the chance it fills a given slot first)">bee drawn</th>
              </tr>
            </thead>
            <tbody>
              {now.map((s: PrevalenceSpecies) => (
                <tr key={s.team} className={s.team === myTeamId ? "mine" : ""}>
                  <th scope="row" className="left"><TeamChip team={teams[s.team]} you={s.team === myTeamId} short /></th>
                  <td><b>{fmt2(s.fitness)}</b></td>
                  <td>{fmt2(s.flowerSuccess)}</td>
                  <td className="left"><span className="prev-cell">{bar(s.flowerP, teams[s.team]?.color)}<span className="prev-num">{pct(s.flowerP)}</span></span></td>
                  <td>{fmt2(s.beeSuccess)}</td>
                  <td className="left"><span className="prev-cell">{bar(s.beeP, teams[s.team]?.color)}<span className="prev-num">{pct(s.beeP)}</span></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {samples.length > 1 && (
        <>
          <label className="small muted prev-pick">Over the game:{" "}
            <select value={series} onChange={(e) => setSeries(e.target.value as SeriesKey)}>
              {SERIES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <PrevalenceChart samples={samples} teams={teams} order={view.participants ?? []} n={n} endMs={view.game.endMs} myTeamId={myTeamId} series={SERIES.find((x) => x.key === series)!} />
        </>
      )}
    </div>
  );
}

const H = 150, M = { left: 44, right: 10, top: 8, bottom: 22 };

/** One quantity over the game: a line per team, in its colour, with par dashed (1/N for a chance, else 1). */
function PrevalenceChart({ samples, teams, order, n, endMs, myTeamId, series }: {
  samples: PrevalenceSample[]; teams: Record<string, Team>; order: string[]; n: number; endMs: number; myTeamId: string | null;
  series: { key: SeriesKey; label: string; percent: boolean };
}) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(260, width);
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
  const span = Math.max(endMs, samples[samples.length - 1].atMs, 1);
  const par = series.percent ? 1 / Math.max(1, n) : 1;
  const values = samples.flatMap((x) => x.species.map((s) => s[series.key] ?? 0));
  const top = Math.max(2 * par, ...values) * 1.1;
  const x = (t: number) => M.left + (t / span) * pw;
  const y = (v: number) => M.top + ph - (v / top) * ph;
  const fmt = (v: number) => (series.percent ? pct(v) : fmt2(v));
  const lines = order.map((team, i) => ({
    team, d: samples.map((x0, k) => `${k ? "L" : "M"}${x(x0.atMs).toFixed(1)} ${y(x0.species[i]?.[series.key] ?? 0).toFixed(1)}`).join(""),
  }));
  return (
    <div className="chart" ref={boxRef}>
      <div className="chart-plot">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${series.label} over the game, one line per team`}>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={M.left - 6} y={y(t) + 4} className="chart-tick" textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          <line x1={M.left} x2={W - M.right} y1={y(par)} y2={y(par)} className="prev-parline" />
          <text x={M.left} y={H - 6} className="chart-tick">0:00</text>
          <text x={W - M.right} y={H - 6} className="chart-tick" textAnchor="end">{fmtClock(span)}</text>
          {lines.map((l) => (
            <path key={l.team} d={l.d} fill="none" stroke={teams[l.team]?.color ?? "currentColor"} strokeWidth={l.team === myTeamId ? 2.6 : 1.6} strokeLinejoin="round">
              <title>{teams[l.team]?.name}</title>
            </path>
          ))}
        </svg>
      </div>
    </div>
  );
}
