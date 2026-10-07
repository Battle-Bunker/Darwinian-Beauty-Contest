// The garden: one flower per team, in its team's colour, and one bee per team, drawn turn by turn. The
// stage is shared by the live garden (a moment behind the game clock) and the replay (wherever the
// scrubber is): a driver says which game time to show, the model (gardenModel.ts) works out every bee
// from the turns, and the painter (gardenPainter.ts) moves the SVG without React. The flowers and labels
// underneath are ordinary React, redrawn only when they change.
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Action, GameStatus, GameView, Team, TeamScore } from "../types";
import { useElementWidth } from "../hooks";
import { useLiveTick, type LiveStore } from "../lib/live";
import { TurnIndex } from "../lib/turns";
import { fmtClock, fmtE, plural, poss } from "../lib/format";
import { computeFrame, HEAD_Y, layoutGarden, PATCH_AT, PATCH_SCALE, TOP_PAD, type Layout, type Pt } from "./gardenModel";
import { GardenPainter } from "./gardenPainter";
import { DropIcon } from "./Icons";
import { responseUrl } from "./ResponseView";
import { GrainChip } from "./Pollen";
import { gameBase } from "../api";

/** Says which game time the garden shows, every animation frame. */
export interface GardenDriver {
  index: TurnIndex;
  tick(now: number): { D: number; moving: boolean; resting: boolean };
  subscribe(fn: () => void): () => void;
}

export type BubbleMode = "auto" | "all" | "focus" | "none";

/** How far behind the game clock the live garden plays (ms of game time), so every turn's end has arrived. */
export const LIVE_DELAY = 900;

/** The live garden's driver: follows the store's ring and the interpolated game clock. */
export class LiveDriver implements GardenDriver {
  index: TurnIndex;
  private D = -1;
  private last = 0;
  constructor(private store: LiveStore, order: string[], flowerMs: number, private status: () => GameStatus) {
    this.index = new TurnIndex(order, flowerMs, 64);
  }
  tick(now: number) {
    this.index.ingest(this.store.actions);
    const st = this.status();
    const dt = this.last ? Math.min(250, now - this.last) : 0;
    this.last = now;
    if (st === "lobby" || st === "finished") return { D: this.store.now(), moving: false, resting: true };
    const clock = this.store.now();
    const target = st === "running" ? clock - LIVE_DELAY : clock;
    if (this.D < 0 || target - this.D > 4000) this.D = target; // first frame, or a hidden tab fell far behind
    else {
      const rate = st === "running" ? (target - this.D > 400 ? 1.25 : 1) : 2;
      this.D = Math.max(this.D, Math.min(target, this.D + dt * rate));
    }
    return { D: this.D, moving: st === "running" || this.D < target - 1, resting: false };
  }
  /** The game time shown at the last frame. */
  shown() { return this.D; }
  subscribe(fn: () => void) { return this.store.subscribe(fn); }
}

interface StageProps {
  teams: Team[];               // by participant index (or every team, in the lobby)
  driver: GardenDriver;
  status: GameStatus;
  roundMs: number; flowerMs: number; beeMs: number;
  focus: number | null;        // highlighted team (its bee, its flower, its private overlay)
  mine: number | null;         // the viewer's own team
  bubbles: BubbleMode;
  names: boolean;
  tallies: string[];
  dim?: boolean[];
  banner?: ReactNode;
  /** The game's API base: the readout links a big response to the whole of it. */
  apiBase?: string;
}

export function GardenStage({ teams, driver, status, roundMs, flowerMs, beeMs, focus, mine, bubbles, names, tallies, dim, banner, apiBase }: StageProps) {
  const n = teams.length;
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => layoutGarden(n, width), [n, width]);
  const dyn = useRef<SVGGElement>(null);
  const clipId = `bee-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const teamKey = teams.map((t) => `${t.id}:${t.color}:${t.name}`).join("|");
  // auto: every bee's bubbles in a small garden (or a mid-sized one nobody is followed in), else the followed team's.
  const bubbleMode = bubbles === "auto" ? (n <= 8 || (focus === null && n <= 16) ? "all" : "focus") : bubbles;

  // Everything the animation loop reads, current without restarting it.
  const params = useRef({ roundMs, flowerMs, beeMs, focus, bubbleMode, names, layout });
  params.current = { roundMs, flowerMs, beeMs, focus, bubbleMode, names, layout };

  const painter = useRef<GardenPainter | null>(null);
  useEffect(() => {
    if (!dyn.current) return;
    painter.current = new GardenPainter(dyn.current, layout, teams, clipId, apiBase ? (seq) => responseUrl(apiBase, seq) : undefined);
    return () => { painter.current?.destroy(); painter.current = null; };
  }, [layout, teamKey, clipId, apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // The loop: one frame per animation frame while time moves and the garden is on screen; it stops when
  // nothing moves and wakes on new actions, a status change, a scrub or a setting.
  const visible = useRef(true);
  const [onScreen, setOnScreen] = useState(true);
  const wakeRef = useRef<() => void>(() => {});
  useEffect(() => {
    let raf = 0, idleSince = 0;
    const loop = (now: number) => {
      raf = 0;
      if (!painter.current || !visible.current || document.visibilityState === "hidden") return;
      const st = driver.tick(now);
      const p = params.current;
      const frame = computeFrame(driver.index, p.layout, {
        D: st.D, roundMs: p.roundMs, flowerMs: p.flowerMs, beeMs: p.beeMs, focus: p.focus,
        bubbles: p.bubbleMode, resting: st.resting, moving: st.moving,
      }, now);
      painter.current.paint(frame, p.names);
      if (!st.moving) {
        if (!idleSince) idleSince = now;
        if (now - idleSince > 250) return; // settled: sleep until woken
      } else idleSince = 0;
      raf = requestAnimationFrame(loop);
    };
    const wake = () => { idleSince = 0; if (!raf) raf = requestAnimationFrame(loop); };
    wakeRef.current = wake;
    const off = driver.subscribe(wake);
    const onVis = () => wake();
    document.addEventListener("visibilitychange", onVis);
    wake();
    return () => { off(); document.removeEventListener("visibilitychange", onVis); if (raf) cancelAnimationFrame(raf); };
  }, [driver]);
  useEffect(() => { wakeRef.current(); }, [layout, teamKey, focus, bubbleMode, names, status]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => {
      visible.current = e[0].isIntersecting;
      setOnScreen(e[0].isIntersecting);
      if (e[0].isIntersecting) wakeRef.current();
    }, { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, [boxRef]);

  // Fill the width, but keep the whole garden on screen; never more than 1.3× its own size.
  const svgHeight = width ? Math.round(Math.min((width * layout.height) / layout.width, Math.max(340, window.innerHeight * (width < 600 ? 0.9 : 0.7)), layout.height * 1.3)) : undefined;
  const scale = width && svgHeight ? Math.min(width / layout.width, svgHeight / layout.height) : 1;
  const fontScale = Math.max(1, Math.min(width && width < 600 ? 1.3 : 1.6, 0.8 / scale));
  const style = { height: svgHeight, ["--fs" as string]: fontScale.toFixed(2) };

  return (
    <div className={`garden-stage ${onScreen ? "" : "offscreen"}`} ref={boxRef}>
      <svg className={`garden-svg garden-${status}`} viewBox={`0 0 ${layout.width} ${layout.height}`} style={style}
        role="img" aria-label={`The garden: ${plural(n, "flower")} and their bees${status === "running" ? ", live" : ""}`}>
        <GardenBackdrop layout={layout} />
        {teams.map((t, i) => layout.pos[i] && (
          <FlowerCell key={t.id} team={t} p={layout.pos[i]} mine={i === mine} focus={i === focus} dim={!!dim?.[i]}
            tally={tallies[i] ?? ""} maxChars={Math.round(14 / fontScale)} />
        ))}
      </svg>
      <svg className={`garden-svg garden-overlay garden-${status}`} viewBox={`0 0 ${layout.width} ${layout.height}`} style={style} aria-hidden>
        <g ref={dyn} />
      </svg>
      {banner}
    </div>
  );
}

const GardenBackdrop = memo(function GardenBackdrop({ layout }: { layout: Layout }) {
  const w = layout.width, h = layout.height;
  const tufts = useMemo(() => {
    const out: Pt[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const count = Math.round((w * h) / 9000);
    for (let i = 0; i < count * 2; i++) out.push({ x: -w / 2 + rnd() * 2 * w, y: TOP_PAD + 20 + rnd() * (h - TOP_PAD - 20) });
    return out;
  }, [w, h]);
  return (
    <g aria-hidden>
      <defs>
        <linearGradient id="dbc-sky" x1="0" y1="0" x2="0" y2={TOP_PAD + 30} gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--sky-1)" }} />
          <stop offset="1" style={{ stopColor: "var(--sky-2)" }} />
        </linearGradient>
        <linearGradient id="dbc-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--grass-1)" }} />
          <stop offset="1" style={{ stopColor: "var(--grass-2)" }} />
        </linearGradient>
      </defs>
      <rect x={-w} y={-h} width={3 * w} height={h + TOP_PAD + 30} fill="url(#dbc-sky)" />
      <path d={`M${-w} ${TOP_PAD - 12} Q ${-w / 2} ${TOP_PAD - 40} 0 ${TOP_PAD - 4} Q ${w * 0.18} ${TOP_PAD - 34} ${w * 0.38} ${TOP_PAD - 6} T ${w * 0.75} ${TOP_PAD - 10} T ${w} ${TOP_PAD - 18} T ${2 * w} ${TOP_PAD - 8} V ${2 * h} H ${-w} Z`} className="g-hill" />
      <rect x={-w} y={TOP_PAD} width={3 * w} height={2 * h} fill="url(#dbc-grass)" />
      <g className="g-sun"><circle cx={w - 46} cy={34} r={20} /></g>
      <g className="g-moon"><circle cx={w - 46} cy={34} r={16} /><circle cx={w - 39} cy={29} r={14} className="g-moon-cut" /></g>
      <g className="g-cloud">
        <ellipse cx={w * 0.2} cy={26} rx={30} ry={10} /><ellipse cx={w * 0.2 + 22} cy={20} rx={20} ry={10} />
        <ellipse cx={w * 0.55} cy={34} rx={26} ry={8} /><ellipse cx={w * 0.55 - 16} cy={29} rx={16} ry={8} />
      </g>
      <g className="g-stars">
        {[0.08, 0.31, 0.47, 0.66, 0.83].map((f, i) => <circle key={i} cx={w * f} cy={14 + ((i * 17) % 34)} r={1.6} />)}
      </g>
      <g className="g-tuft">
        {tufts.map((p, i) => <path key={i} d={`M${p.x - 5} ${p.y} q 2 -9 5 -12 M${p.x} ${p.y} q 0 -10 1 -14 M${p.x + 5} ${p.y} q -1 -8 -4 -11`} />)}
      </g>
    </g>
  );
});

// A cosmos ray petal, pointing up from the centre: a broad wedge that ends in a row of small teeth.
const COSMOS_PETAL = "M0 -4.5 C -1.6 -8, -5.2 -14, -5.8 -18.8 L -3.8 -20.9 L -1.9 -19.5 L 0 -21.7 L 1.9 -19.5 L 3.8 -20.9 L 5.8 -18.8 C 5.2 -14, 1.6 -8, 0 -4.5 Z";
const COSMOS_ANGLES = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);

/** A team's flower: an open, eight-petalled cosmos with toothed petal tips and a golden disc, in the team's colour. */
export function CosmosHead({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <g transform={scale !== 1 ? `scale(${scale})` : undefined}>
      {COSMOS_ANGLES.map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <path d={COSMOS_PETAL} fill={color} className="petal" />
          <path d="M0 -7.5 L0 -18" className="cosmos-vein" />
        </g>
      ))}
      <circle r="5.4" className="flower-eye" />
      {COSMOS_ANGLES.map((a) => (
        <circle key={a} r="0.9" cx={3.1 * Math.sin((a * Math.PI) / 180)} cy={-3.1 * Math.cos((a * Math.PI) / 180)} className="flower-eye-dot" />
      ))}
      <circle r="1.1" className="flower-eye-dot" />
    </g>
  );
}

const FlowerCell = memo(function FlowerCell({ team, p, mine, focus, dim, tally, maxChars }: {
  team: Team; p: Pt; mine: boolean; focus: boolean; dim: boolean; tally: string; maxChars: number;
}) {
  const name = team.name.length > maxChars ? team.name.slice(0, maxChars - 1) + "…" : team.name;
  return (
    <g transform={`translate(${p.x} ${p.y})`} className={`flower-cell ${dim ? "dim" : ""}`}>
      <title>{`${poss(team.name)} flower species: every visit is a bee meeting one of its flowers`}</title>
      {focus && <ellipse cy={HEAD_Y + 2} rx={78} ry={64} className="flower-focus" />}
      <ellipse cy={6} rx={66} ry={10} className="soil" />
      {PATCH_AT.map(([dx, hy], i) => (
        <g key={i} className="flower" style={{ animationDelay: `${-i * 1.7}s` }}>
          <path d={`M${dx} 6 C ${dx - 4} ${(hy * 0.25).toFixed(0)}, ${dx + 4} ${(hy * 0.6).toFixed(0)}, ${dx} ${hy}`} className="stem" />
          <ellipse cx={dx + (i === 0 ? 7 : -7)} cy={hy * 0.3} rx="8" ry="3.4" transform={`rotate(${i === 0 ? 30 : -30} ${dx + (i === 0 ? 7 : -7)} ${hy * 0.3})`} className="leaf" />
          <g transform={`translate(${dx} ${hy})`}><CosmosHead color={team.color} scale={PATCH_SCALE} /></g>
        </g>
      ))}
      {mine && <text x={44} y={HEAD_Y - 36} className="you-flag">you</text>}
      <text y={26} className="flower-label"><tspan fill={team.color} className="flower-label-dot">●</tspan> {name}</text>
      <text y={44} className="flower-tally">{tally}</text>
    </g>
  );
});

/** Whole-game counts per team, live: the view's scores plus the feeds that have streamed in since. */
function liveFeeds(view: GameView, actions: Action[], order: string[]): { fedHere: number[]; fedBy: number[] } {
  const pos = new Map(order.map((id, i) => [id, i]));
  const fedHere = order.map(() => 0), fedBy = order.map(() => 0);
  for (const s of view.scores ?? []) {
    const i = pos.get(s.teamId);
    if (i !== undefined) { fedHere[i] = s.feedsReceived; fedBy[i] = s.feedsGiven; }
  }
  const since = view.game.lastSeq;
  for (let k = actions.length - 1; k >= 0 && actions[k].seq > since; k--) {
    const a = actions[k];
    if (a.action !== "feed") continue;
    const f = pos.get(a.flower), b = pos.get(a.bee);
    if (f !== undefined) fedHere[f]++;
    if (b !== undefined) fedBy[b]++;
  }
  return { fedHere, fedBy };
}

/** The latest feed by a team's bee that came with a grain the viewer may see. */
function lastGrainOf(actions: Action[], bee: string): Action | null {
  for (let k = actions.length - 1, n = 0; k >= 0 && n < 4000; k--, n++) {
    const a = actions[k];
    if (a.action === "feed" && a.bee === bee && typeof a.grain === "string") return a;
  }
  return null;
}

/** The garden during the lobby and the game. */
export function LiveGarden({ view, store, wasted }: { view: GameView; store: LiveStore; wasted: number | null }) {
  const g = view.game;
  const cfg = g.config;
  const status = g.status;
  const order = useMemo(() => (view.participants?.length ? view.participants : view.teams.map((t) => t.id)), [view.participants, view.teams]);
  const teams = useMemo(() => {
    const byId = new Map(view.teams.map((t) => [t.id, t]));
    return order.map((id) => byId.get(id)!).filter(Boolean);
  }, [order, view.teams]);
  const mine = view.me?.teamId ? order.indexOf(view.me.teamId) : -1;
  const teamsById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const statusRef = useRef(status);
  statusRef.current = status;
  const driver = useMemo(() => new LiveDriver(store, order, cfg.budgets.flower.ms, () => statusRef.current), [store, order.join(","), cfg.budgets.flower.ms]); // eslint-disable-line react-hooks/exhaustive-deps

  const [focusPick, setFocus] = useState<number | null | undefined>(undefined);
  const focus = focusPick === undefined ? (mine >= 0 ? mine : null) : focusPick;
  const [bubbles, setBubbles] = useState<BubbleMode>("auto");
  const [namesPick, setNames] = useState<boolean | null>(null);
  const names = namesPick ?? teams.length <= 6;

  // Labels and the strip below re-read twice a second.
  const rev = useLiveTick(store, 500);
  const counts = useMemo(() => liveFeeds(view, store.actions, order), [view, store, order, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = (t: Team) => !!t.ready && t.ready.flower && t.ready.bee;
  const tallies = teams.map((t, i) => status === "lobby" ? (ready(t) ? "ready to play" : "getting ready…") : `fed here ${counts.fedHere[i].toLocaleString()}×`);
  const dim = status === "lobby" ? teams.map((t) => !ready(t)) : undefined;
  const rate = status === "running" ? store.actionsPerSecond() : 0;
  const shown = driver.shown();

  const banner = status === "lobby" ? <div className="garden-banner">The bees wait at home until the game starts.</div>
    : status === "paused" ? <div className="garden-banner garden-banner-paused">Paused</div>
    : status === "finished" ? <div className="garden-banner garden-banner-done">The game is over: see the replay.</div> : null;

  return (
    <div className="garden">
      {status !== "lobby" && (
        <GardenControls teams={teams} mine={mine} focus={focus} setFocus={setFocus} bubbles={bubbles} setBubbles={setBubbles} names={names} setNames={setNames} />
      )}
      <GardenStage teams={teams} driver={driver} status={status} roundMs={cfg.budgets.flower.ms + cfg.budgets.bee.ms} flowerMs={cfg.budgets.flower.ms}
        beeMs={cfg.budgets.bee.ms} focus={focus} mine={mine >= 0 ? mine : null} bubbles={bubbles} names={names} tallies={tallies} dim={dim} banner={banner}
        apiBase={gameBase(view.room.shortId, g.shortId)} />
      {status !== "lobby" && (
        <div className="garden-bar">
          {status === "running" && (
            <span className="garden-rate" title="Actions (arrivals, feeds and leaves) per second of real time, over the last few seconds">
              <span className="pulse-dot" /> <b>{Math.round(rate).toLocaleString()}</b> actions/s
            </span>
          )}
          <span className="muted small">{plural(store.lastSeq, "action")} so far{status === "running" && shown >= 0 ? ` · showing ${fmtClock(Math.max(0, shown), true)}, a moment behind live` : ""}</span>
        </div>
      )}
      {status !== "lobby" && focus !== null && teams[focus] && (
        <FocusStrip team={teams[focus]} own={focus === mine} score={view.scores?.find((s) => s.teamId === teams[focus].id) ?? null}
          fedHere={counts.fedHere[focus]} fedBy={counts.fedBy[focus]} wasted={focus === mine ? wasted : null}
          lastGrain={lastGrainOf(store.actions, teams[focus].id)} teams={teamsById} />
      )}
      {status !== "lobby" && <GardenLegend own={mine >= 0} />}
    </div>
  );
}

export function GardenControls({ teams, mine, focus, setFocus, bubbles, setBubbles, names, setNames, extra }: {
  teams: Team[]; mine: number; focus: number | null; setFocus: (f: number | null) => void;
  bubbles: BubbleMode; setBubbles: (b: BubbleMode) => void; names: boolean; setNames: (v: boolean) => void; extra?: ReactNode;
}) {
  return (
    <div className="garden-controls">
      <label className="feed-filter"><span>Follow</span>
        <select value={focus ?? ""} onChange={(e) => setFocus(e.target.value === "" ? null : Number(e.target.value))} aria-label="Team to follow">
          <option value="">nobody</option>
          {teams.map((t, i) => <option key={t.id} value={i}>{t.name}{i === mine ? " (you)" : ""}</option>)}
        </select>
      </label>
      <label className="feed-filter"><span>Bubbles</span>
        <select value={bubbles} onChange={(e) => setBubbles(e.target.value as BubbleMode)} aria-label="Speech bubbles">
          <option value="auto">auto</option>
          <option value="all">every bee</option>
          <option value="focus">followed team only</option>
          <option value="none">none</option>
        </select>
      </label>
      <label className="check small"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> bee names</label>
      {extra}
    </div>
  );
}

const fmtScore = (x: number) => (x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString());

/** The followed team at a glance: its bee and its flower over the game so far. */
export function FocusStrip({ team, own, score, fedHere, fedBy, wasted, lastGrain, teams }: {
  team: Team; own: boolean; score: TeamScore | null; fedHere: number; fedBy: number; wasted: number | null;
  lastGrain?: Action | null; teams?: Record<string, Team>;
}) {
  const who = own ? "Your" : poss(team.name);
  return (
    <div className="focus-strip" style={{ ["--team" as string]: team.color }}>
      <div className="focus-tile">
        <span className="focus-label"><span className="swatch" style={{ background: team.color }} /> {who} flower species</span>
        <span>fed at <b>{fedHere.toLocaleString()}×</b>{score ? <> by <b>{score.pollinators}</b> {score.pollinators === 1 ? "team" : "teams"}</> : null}</span>
        {score && typeof score.pollination === "number" && <span title="Σ over bee teams of √(pollen given to that team's bee)">pollination <b>{fmtScore(score.pollination)}</b></span>}
        {score && (score.pollen !== null || score.nectarGiven !== null) && <span>gave pollen <b>{fmtE(score.pollen)}</b>, nectar <b>{fmtE(score.nectarGiven)}</b></span>}
        {wasted !== null && <span className="muted" title="Energy from visits where the bee didn't feed: nobody gets it. Only your team sees this until the game ends.">lost on unfed visits <b>{fmtE(wasted)}</b></span>}
      </div>
      <div className="focus-tile">
        <span className="focus-label"><span className="swatch" style={{ background: team.color }} /> {who} bee</span>
        <span>fed <b>{fedBy.toLocaleString()}×</b>{score && score.nectarSources !== null ? <> at <b>{score.nectarSources}</b> {score.nectarSources === 1 ? "flower" : "flowers"}</> : null}</span>
        {score && typeof score.forage === "number" && <span title="Σ over flower teams of √(nectar got there)">forage <b>{fmtScore(score.forage)}</b></span>}
        {score && score.nectarCollected !== null && <span><DropIcon size={14} /> nectar <b>{fmtE(score.nectarCollected)}</b></span>}
        {score && typeof score.fitness === "number" && <span title="N² × pollination share × forage share">fitness <b>{score.fitness.toFixed(3)}</b></span>}
        {lastGrain && typeof lastGrain.grain === "string" && (
          <span className="focus-grain">latest from {teams?.[lastGrain.flower]?.name ?? "a flower"}: <GrainChip grain={lastGrain.grain} version={lastGrain.grainVersion} length={lastGrain.grainCodeLength} max={28} /></span>
        )}
        {team.memory && <span title={`The bee's MEMORY, read only: bee v${team.memory.version}'s`}>MEMORY <b>{team.memory.bytes.toLocaleString()}</b> / {team.memory.cap.toLocaleString()} bytes</span>}
      </div>
    </div>
  );
}

export const GardenLegend = memo(function GardenLegend({ own }: { own: boolean }) {
  return (
    <ul className="garden-legend" aria-label="What the garden shows">
      <li><span className="lg lg-ask">?</span> a bee asks a flower (it glows while it answers), then shows the response (→)</li>
      <li><DropIcon size={16} /> it fed: the nectar it got; it sits out its rounds on the flower</li>
      <li><span className="lg lg-left">→</span> a faded bubble: it left</li>
      <li><span className="lg lg-mine" /> the followed team's bee; <span className="lg lg-visitor" /> a bee at its flower</li>
      {own && <li><span className="lg lg-readout">E</span> your flower's latest visit: its hidden time budget R, compute time, excess energy E and the percent offered, then the nectar and pollen it gave, or what was lost (only your team sees unfed visits)</li>}
    </ul>
  );
});
