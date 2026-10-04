// After the game: the whole thing again. Every action is loaded (everything is revealed once a game is
// over), the garden replays it at any speed and can be scrubbed to any round, the round inspector shows
// every field of every turn in the round on screen, and the charts show each team over the game.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView, Team } from "../types";
import { gameBase } from "../api";
import type { HistoryStore } from "../lib/history";
import { useLiveTick, type Ticking } from "../lib/live";
import { fed, type Turn, type TurnIndex } from "../lib/turns";
import { binTurns, binWidth, recFromTurn, sizeLookup, totalsOf, type MetricKey, type TurnRec } from "../lib/stats";
import { fmtClock, fmtE, fmtEExact, fmtMs, plural } from "../lib/format";
import { GardenControls, GardenLegend, GardenStage, type BubbleMode, type GardenDriver } from "./Garden";
import { EnergySplit, MetricPicker, TeamSeriesChart } from "./Charts";
import { PauseIcon, PlayIcon, ReplayIcon } from "./Icons";
import { Progress } from "./ui";
import { Value } from "./Value";
import { partsOfAction, ResponseView, responseUrl } from "./ResponseView";
import { MemoryTable } from "./Memory";

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

/** Plays a finished game's history: a time that runs at any speed, or stands where it was put. */
class ReplayDriver implements GardenDriver, Ticking {
  t = 0;
  playing = false;
  speed = 1;
  rev = 0;
  private last = 0;
  private lastBump = 0;
  private listeners = new Set<() => void>();
  constructor(private history: HistoryStore, public endMs: number) {}
  get index(): TurnIndex { return this.history.turns; }
  tick(now: number) {
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    if (this.playing) {
      // Don't run ahead of what has loaded.
      const loaded = this.history.done ? this.endMs : Math.max(0, this.history.turns.lastT);
      this.t = Math.min(this.endMs, loaded, this.t + dt * this.speed);
      if (this.t >= this.endMs) { this.playing = false; this.bump(); }
      else if (now - this.lastBump > 120) { this.lastBump = now; this.bump(); }
    }
    return { D: this.t, moving: this.playing, resting: false };
  }
  play() { if (this.t >= this.endMs - 1) this.t = 0; this.playing = true; this.last = 0; this.bump(); }
  pause() { this.playing = false; this.bump(); }
  seek(t: number) { this.t = Math.max(0, Math.min(this.endMs, t)); this.bump(); }
  setSpeed(s: number) { this.speed = s; this.bump(); }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    const off = this.history.subscribe(fn);
    return () => { this.listeners.delete(fn); off(); };
  }
  private bump() { this.rev++; for (const fn of this.listeners) fn(); }
}

export function Replay({ view, history }: { view: GameView; history: HistoryStore }) {
  const g = view.game;
  const base = gameBase(view.room.shortId, g.shortId);
  const cfg = g.config;
  const roundMs = cfg.budgets.flower.ms + cfg.budgets.bee.ms;
  const endMs = Math.max(roundMs, g.clockMs);
  const order = view.participants ?? [];
  const teams = useMemo(() => {
    const byId = new Map(view.teams.map((t) => [t.id, t]));
    return order.map((id) => byId.get(id)!).filter(Boolean);
  }, [order, view.teams]);
  const mine = view.me?.teamId ? order.indexOf(view.me.teamId) : -1;
  const driver = useMemo(() => new ReplayDriver(history, endMs), [history, endMs]);
  useLiveTick(driver, 120, false);
  const hrev = useLiveTick(history, 700);

  const [focus, setFocus] = useState<number | null>(mine >= 0 ? mine : null);
  const [bubbles, setBubbles] = useState<BubbleMode>("auto");
  const [names, setNames] = useState(teams.length <= 6);
  const t = driver.t;
  const round = Math.min(Math.ceil(endMs / roundMs), Math.floor(t / roundMs) + 1);
  const loadedT = history.done ? endMs : Math.max(0, history.turns.lastT);

  // Fed-here counts up to the time shown, per flower.
  const feedTimes = useMemo(() => {
    const out: number[][] = teams.map(() => []);
    for (const list of history.turns.bees) for (const turn of list) if (fed(turn)) out[turn.flower]?.push(turn.t0);
    out.forEach((l) => l.sort((a, b) => a - b));
    return out;
  }, [history, hrev, teams]); // eslint-disable-line react-hooks/exhaustive-deps
  const tallies = feedTimes.map((l) => `fed here ${countUpTo(l, t).toLocaleString()}×`);

  return (
    <div className="stack replay">
      <LoadBar history={history} />
      <GardenControls teams={teams} mine={mine} focus={focus} setFocus={setFocus} bubbles={bubbles} setBubbles={setBubbles} names={names} setNames={setNames} />
      <div className="garden">
        <GardenStage teams={teams} driver={driver} status="running" roundMs={roundMs} flowerMs={cfg.budgets.flower.ms} beeMs={cfg.budgets.bee.ms}
          focus={focus} mine={mine >= 0 ? mine : null} bubbles={bubbles} names={names} tallies={tallies} apiBase={base}
          banner={!driver.playing && t === 0 ? <button className="garden-banner garden-play" onClick={() => driver.play()}><PlayIcon size={16} /> Play the replay</button> : null} />
        <Transport driver={driver} roundMs={roundMs} endMs={endMs} loadedT={loadedT} round={round} />
        <GardenLegend own={false} />
      </div>
      <RoundInspector index={history.turns} round={round} roundMs={roundMs} teams={teams} mine={mine} focus={focus} rev={hrev} base={base} />
      <ReplayCharts view={view} history={history} teams={teams} mine={mine} focus={focus} setFocus={setFocus} cursor={t} onSeek={(x) => driver.seek(x)} hrev={hrev} />
      {teams.some((x) => x.memory) && (
        <section>
          <h3>Every bee's MEMORY, as the game ended</h3>
          <p className="small muted">The one thing a bee keeps from one turn to the next: a small key–value store, written only by the bee (in first, decide and fed) and started afresh by each new bee version. Read only.</p>
          <MemoryTable view={view} teams={teams} />
        </section>
      )}
    </div>
  );
}

function countUpTo(sorted: number[], t: number) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

function LoadBar({ history }: { history: HistoryStore }) {
  useLiveTick(history, 300);
  if (history.error) return <p className="small bad-text">Couldn't load the game's history: {history.error}</p>;
  if (history.done) return history.capped ? <p className="small warn-text">This game is very long: the replay holds its first {plural(history.actions.length, "action")}.</p> : null;
  return (
    <div className="load-bar small muted">
      Loading every action for the replay: {history.actions.length.toLocaleString()} of {history.total ? history.total.toLocaleString() : "…"}
      <Progress value={history.total ? history.lastSeq / history.total : 0} label="History loaded" />
    </div>
  );
}

function Transport({ driver, roundMs, endMs, loadedT, round }: { driver: ReplayDriver; roundMs: number; endMs: number; loadedT: number; round: number }) {
  const rounds = Math.ceil(endMs / roundMs);
  const range = useRef<HTMLInputElement>(null);
  // Space toggles play while the replay controls have focus.
  useEffect(() => {
    const el = range.current?.parentElement;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && (e.target as HTMLElement).tagName !== "SELECT") { e.preventDefault(); if (driver.playing) driver.pause(); else driver.play(); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [driver]);
  return (
    <div className="transport">
      <button className="btn btn-round btn-honey" onClick={() => (driver.playing ? driver.pause() : driver.play())} aria-label={driver.playing ? "Pause" : "Play"}>
        {driver.playing ? <PauseIcon /> : driver.t >= endMs - 1 ? <ReplayIcon /> : <PlayIcon />}
      </button>
      <button className="btn btn-small btn-ghost" onClick={() => { driver.pause(); driver.seek((round - 2) * roundMs); }} aria-label="Back one round" title="Back one round">−1</button>
      <button className="btn btn-small btn-ghost" onClick={() => { driver.pause(); driver.seek(round * roundMs); }} aria-label="Forward one round" title="Forward one round">+1</button>
      <div className="scrub">
        <span className="scrub-loaded" style={{ width: `${Math.min(100, (loadedT / endMs) * 100)}%` }} aria-hidden />
        <input ref={range} type="range" min={0} max={endMs} step={roundMs} value={Math.min(endMs, Math.floor(driver.t / roundMs) * roundMs)}
          onChange={(e) => driver.seek(Number(e.target.value))} aria-label="Game time" aria-valuetext={`${fmtClock(driver.t, true)}, round ${round}`} />
      </div>
      <span className="transport-time mono">{fmtClock(driver.t, true)} · round {round.toLocaleString()}<span className="muted">/{rounds.toLocaleString()}</span></span>
      <label className="feed-filter"><span className="sr-only">Speed</span>
        <select value={driver.speed} onChange={(e) => driver.setSpeed(Number(e.target.value))} aria-label="Replay speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
    </div>
  );
}

/** Every turn of the round on screen, every field (all revealed now). */
function RoundInspector({ index, round, roundMs, teams, mine, focus, rev, base }: {
  index: TurnIndex; round: number; roundMs: number; teams: Team[]; mine: number; focus: number | null; rev: number; base: string;
}) {
  const turns = useMemo(() => index.between((round - 1) * roundMs, round * roundMs), [index, round, roundMs, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [onlyFocus, setOnlyFocus] = useState(false);
  const shown = onlyFocus && focus !== null ? turns.filter((t) => t.bee === focus || t.flower === focus) : turns;
  return (
    <details className="inspector" open>
      <summary><b>Round {round.toLocaleString()}</b> <span className="small muted">{plural(turns.length, "turn")}; bees feeding sit the round out</span></summary>
      {focus !== null && <label className="check small"><input type="checkbox" checked={onlyFocus} onChange={(e) => setOnlyFocus(e.target.checked)} /> only turns of {teams[focus]?.name}</label>}
      {shown.length === 0 ? <p className="small muted">No turns in this round.</p> : (
        <div className="table-scroll">
          <table className="data-table inspector-table">
            <thead>
              <tr>
                <th className="left">Bee → flower</th><th className="left">Challenge → response</th><th className="left">Decision</th>
                <th title="Share of E offered">%</th><th title="Excess energy, node·ms">E</th><th>Nectar</th><th>Pollen</th><th title="Energy lost: the bee didn't feed">Lost</th>
                <th title="The flower's CPU time">Flower ms</th><th title="How long the bee took to decide">Bee ms</th><th className="left">Versions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => <InspectorRow key={`${t.bee}:${t.turn}`} t={t} teams={teams} mine={mine} focus={focus} base={base} />)}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function InspectorRow({ t, teams, mine, focus, base }: { t: Turn; teams: Team[]; mine: number; focus: number | null; base: string }) {
  const e = t.end;
  const isFed = fed(t);
  const chip = (i: number) => (
    <span className="team-chip feed-chip" title={teams[i]?.name}><span className="swatch" style={{ background: teams[i]?.color }} /><span className="team-name">{teams[i]?.name}</span>{i === mine && <span className="you-tag">you</span>}</span>
  );
  const hl = focus !== null && (t.bee === focus || t.flower === focus);
  return (
    <tr className={`${hl ? "mine" : ""}`}>
      <td className="left nowrap">{chip(t.bee)} → {chip(t.flower)}</td>
      <td className="left">{e ? <span className="step"><Value v={e.c} role="challenge" max={20} /><span className="arrow">→</span><ResponseView p={partsOfAction(e)} url={responseUrl(base, e.seq)} max={20} failedText={e.flowerError ?? undefined} /></span> : <span className="muted">…</span>}</td>
      <td className="left">{!e ? "" : isFed ? <span className="ok-text">fed</span> : <span className="muted">left</span>}{e?.beeError && <span className="err-detail mono">{e.beeError}</span>}{e?.flowerError && <span className="err-detail mono">flower: {e.flowerError}</span>}</td>
      <td>{e?.percent ?? "–"}</td>
      <td title={fmtEExact(e?.energy)}>{fmtE(e?.energy)}</td>
      <td title={fmtEExact(e?.nectar)}>{isFed ? fmtE(e?.nectar) : ""}</td>
      <td title={fmtEExact(e?.pollen)}>{isFed ? fmtE(e?.pollen) : ""}</td>
      <td className="muted" title={fmtEExact(isFed ? 0 : e?.energy)}>{!isFed && e && typeof e.energy === "number" ? fmtE(e.energy) : ""}</td>
      <td>{fmtMs(e?.ms)}</td>
      <td>{fmtMs(e?.beeMs)}</td>
      <td className="left small muted nowrap">{e ? `bee v${e.beeVersion ?? "?"} · flower v${e.flowerVersion ?? "?"}` : ""}</td>
    </tr>
  );
}

function ReplayCharts({ view, history, teams, mine, focus, setFocus, cursor, onSeek, hrev }: {
  view: GameView; history: HistoryStore; teams: Team[]; mine: number; focus: number | null; setFocus: (f: number | null) => void;
  cursor: number; onSeek: (t: number) => void; hrev: number;
}) {
  const cfg = view.game.config;
  const roundMs = cfg.budgets.flower.ms + cfg.budgets.bee.ms;
  const endMs = Math.max(roundMs, view.game.clockMs);
  const [metric, setMetric] = useState<MetricKey>("fitness");
  const model = useMemo(() => ({ cap: cfg.budgets.flower.size, window: cfg.budgets.flower.ms, sizeOf: sizeLookup(teams) }), [cfg.budgets.flower.size, cfg.budgets.flower.ms, teams]);
  const data = useMemo(() => {
    const recs: TurnRec[] = [];
    for (const list of history.turns.bees) for (const t of list) { const r = recFromTurn(t); if (r) recs.push(r); }
    return binTurns(recs, teams.length, endMs, binWidth(endMs, roundMs), model);
  }, [history, hrev, teams.length, endMs, roundMs, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const upto = history.done ? data.bins : Math.floor(Math.max(0, history.turns.lastT) / data.binMs);
  const rows = teams.map((_, i) => i);
  return (
    <div className="stack">
      <section>
        <h3>Each team over the game</h3>
        <div className="row"><MetricPicker value={metric} onChange={setMetric} /><span className="small muted">Click the chart to jump the replay there.</span></div>
        <TeamSeriesChart teams={teams} rows={rows} data={data} metric={metric} focus={focus} onFocus={setFocus} cursor={cursor} onSeek={onSeek} upto={upto} endMs={endMs} />
      </section>
      <section>
        <h3>Where each flower's energy went</h3>
        <p className="small muted">A flower allocates every visit's energy budget ({cfg.budgets.flower.size.toLocaleString()} × {cfg.budgets.flower.ms} node·ms) between compute, nectar and pollen. Its size shrinks the budget and its CPU time uses part of it; what's left, E, goes to a bee that feeds, as nectar (the percent offered) and pollen (the rest), or is lost when the bee doesn't feed.</p>
        <EnergySplit rows={rows.map((i) => ({ team: teams[i], t: totalsOf(data.teams[i]), you: i === mine }))} />
      </section>
    </div>
  );
}
