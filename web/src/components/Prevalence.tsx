// Species prevalence, beside the scoreboard: each turn's flower is of species s with probability
// p_s = (c + P_s) / Σ (c + P_k), P_s its recent success (par 1, capped), c falling over the game. Every
// species' p_s and P_s now, and p_s over the game so far (GET .../prevalence, then each new sample as the live
// numbers bring it). Public; programs never see it.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { GameView, PrevalenceSample, Team } from "../types";
import { fmt2, fmtClock, pct } from "../lib/format";
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

export function PrevalencePanel({ view, base }: { view: GameView; base: string }) {
  const pv = view.prevalence ?? null;
  const samples = useSamples(base, pv?.round ?? null, !!pv && view.game.status !== "lobby");
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  if (!pv) return null;
  const n = view.participants?.length ?? 0;
  const myTeamId = view.me?.teamId ?? null;
  const now = [...pv.species].sort((a, b) => b.p - a.p);
  const maxP = Math.max(2 / Math.max(1, n), ...now.map((s) => s.p));
  const basis = pv.basis === "feeds" ? "feeds (each feed counts 1)" : pv.basis === "fitness" ? "fitness (pollination share × forage share)" : "pollination";
  const how = `Each turn's flower is of species s with probability p = (c + P) / Σ (c + P). P is the species' recent success: N × its share of ` +
    `${basis}${pv.halfLifeS ? `, fading with a half-life of ${pv.halfLifeS} s of game time` : " over the whole game"}` +
    `${pv.cap != null ? `, capped at ${pv.cap}` : ""}; par is 1. c gives every species a share whatever its success, falling from ${pv.cStart} to ${pv.cEnd} over the game. ` +
    "Programs never see it.";
  return (
    <div className="prevalence">
      <p className="small muted">
        <b>Species prevalence</b> <InfoTip>{how}</InfoTip>{" "}
        {pv.round === null ? "starts with the first round." : <>the chance a turn draws each species, as of {fmtClock(pv.atMs ?? 0)} (c = {fmt2(pv.c ?? 0)}); par is {pct(1 / Math.max(1, n))}.</>}
      </p>
      {now.length > 0 && (
        <ul className="prev-list">
          {now.map((s) => (
            <li key={s.team} className={s.team === myTeamId ? "mine" : ""}>
              <TeamChip team={teams[s.team]} you={s.team === myTeamId} short />
              <span className="prev-track" aria-hidden>
                <span className="prev-fill" style={{ width: `${Math.min(100, (s.p / maxP) * 100)}%`, background: teams[s.team]?.color }} />
                <span className="prev-par" style={{ left: `${Math.min(100, (1 / Math.max(1, n) / maxP) * 100)}%` }} />
              </span>
              <span className="prev-num" title="p: the chance a turn draws this species">{pct(s.p)}</span>
              <span className="prev-num muted" title="P: its recent success, par 1">P {fmt2(s.P)}</span>
            </li>
          ))}
        </ul>
      )}
      {samples.length > 1 && <PrevalenceChart samples={samples} teams={teams} order={view.participants ?? []} n={n} endMs={view.game.endMs} myTeamId={myTeamId} />}
    </div>
  );
}

const H = 150, M = { left: 40, right: 10, top: 8, bottom: 22 };

/** p_s over the game: one line per species, in its team's colour, with par (1/N) dashed. */
function PrevalenceChart({ samples, teams, order, n, endMs, myTeamId }: {
  samples: PrevalenceSample[]; teams: Record<string, Team>; order: string[]; n: number; endMs: number; myTeamId: string | null;
}) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(260, width);
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
  const span = Math.max(endMs, samples[samples.length - 1].atMs, 1);
  const top = Math.min(1, Math.max(2 / Math.max(1, n), ...samples.flatMap((x) => x.species.map((s) => s.p))) * 1.1);
  const x = (t: number) => M.left + (t / span) * pw;
  const y = (v: number) => M.top + ph - (v / top) * ph;
  const ticks = [0, top / 2, top];
  const lines = order.map((team, i) => ({
    team, d: samples.map((x0, k) => `${k ? "L" : "M"}${x(x0.atMs).toFixed(1)} ${y(x0.species[i]?.p ?? 0).toFixed(1)}`).join(""),
  }));
  return (
    <div className="chart" ref={boxRef}>
      <div className="chart-head small muted">p, the chance a turn draws each species, over the game</div>
      <div className="chart-plot">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each species' chance of being drawn over the game, one line per team">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={M.left - 6} y={y(t) + 4} className="chart-tick" textAnchor="end">{pct(t)}</text>
            </g>
          ))}
          <line x1={M.left} x2={W - M.right} y1={y(1 / Math.max(1, n))} y2={y(1 / Math.max(1, n))} className="prev-parline" />
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
