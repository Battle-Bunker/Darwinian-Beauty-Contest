// The garden: one patch per team (two flowers of different varieties: a daisy and a star) and one bee
// per team, replaying a round's visits on a shared turn clock. Which variety is the clover, and which
// side it's on, come from a stable hash of (game, team), so the picture carries no information.
// Public viewers never learn which flower in a patch a bee visited; the patch owner (visit.kind
// present) and everyone after a reveal see the exact flower and the clover/orchid labels.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { poss } from "../lib/format";
import type { GameView, Round, Team } from "../types";
import { useElementWidth, storage } from "../hooks";
import {
  beeFrame, buildModel, layoutGarden, patchLook, slot, tallies, FLOWER_DX, FLOWER_Y, TOP_PAD,
  type BeeFrame, type Layout, type Model, type PatchLook, type Pt,
} from "./gardenModel";
import { DropIcon, FooledIcon, PauseIcon, PlayIcon, ReplayIcon, SkipIcon } from "./Icons";
import { TeamChip } from "./ui";

export type GardenStart = "start" | "end" | "play";

// Playback speeds, as multiples of BASE_TPS turns per second. Engine v2 rounds have ~100 turns per
// flower (1,200 with 6 teams), so the default speed is picked to play a round in about a minute.
const BASE_TPS = 5;
const SPEEDS = [0.5, 1, 2, 5, 10, 20, 50];
const defaultSpeed = (turns: number) => {
  const want = turns / 60 / BASE_TPS;
  return SPEEDS.reduce((best, s) => (Math.abs(Math.log(s / want)) < Math.abs(Math.log(best / want)) ? s : best), 1);
};

export function Garden({ view, round, start, rounds, onSelectRound, loading = false }: {
  view: GameView;
  round: Round | null;       // with visits
  start: GardenStart;
  rounds: number[];
  onSelectRound: (no: number) => void;
  loading?: number | false;  // round number whose visits are still loading
}) {
  const cfg = view.game.config;
  const turns = round?.turns ?? view.game.turns ?? cfg.turns ?? 100;
  const endT = turns + 1.6;
  const teamsById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const order = useMemo(() => {
    if (view.participants?.length) return view.participants;
    return view.teams.map((t) => t.id);
  }, [view.participants, view.teams]);
  const myTeamId = view.me?.teamId ?? null;

  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => layoutGarden(order, width), [order, width]);
  const looks = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, patchLook(view.game.id, t.id)])), [view.teams, view.game.id]);
  const model = useMemo(() => buildModel(round?.visits ?? [], round ? order : [], layout.pos, looks), [round, order, layout, looks]);

  // Playback clock, in turns.
  const [t, setT] = useState(() => (round && start === "end" ? endT : 0));
  const [playing, setPlaying] = useState(() => !!round && start === "play");
  const [speed, setSpeed] = useState(() => {
    const s = Number(storage.get("dbc:speed2"));
    return SPEEDS.includes(s) ? s : defaultSpeed(turns);
  });
  const [namesPick, setNames] = useState<boolean | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const rate = BASE_TPS;

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = tRef.current + dt * rate * speed;
      if (next >= endT) {
        tRef.current = endT;
        setT(endT);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, speed, endT]);

  const play = () => {
    if (!round) return;
    if (tRef.current >= endT - 0.01) { tRef.current = 0; setT(0); }
    setPlaying(true);
  };
  const replay = () => { tRef.current = 0; setT(0); setPlaying(true); };
  const skipToEnd = () => { setPlaying(false); tRef.current = endT; setT(endT); };
  const changeSpeed = (s: number) => { setSpeed(s); storage.set("dbc:speed2", String(s)); };
  // Feed results stay on screen at least ~0.7 s of real time, however fast the clock runs.
  const fxMin = 0.7 * rate * speed;

  const n = model.n || order.length;
  const homes = useMemo(() => Object.fromEntries(order.map((id, i) => [id, layout.pos[id] ? slot(layout.pos[id], i, order.length) : { x: 0, y: 0 }])), [order, layout]);
  const frames: (BeeFrame & { teamId: string; index: number })[] = round
    ? model.tracks.map((tr) => ({ ...beeFrame(tr, t, layout.pos, n, homes[tr.teamId], looks), teamId: tr.teamId, index: tr.index }))
    : order.map((id, i) => ({ ...homes[id], flip: false, mode: "home" as const, pulse: 0, tilt: 0, teamId: id, index: i }));
  // Busy bees on top.
  frames.sort((a, b) => Number(a.mode !== "done" && a.mode !== "home") - Number(b.mode !== "done" && b.mode !== "home"));
  const tally = useMemo(() => tallies(model, t), [model, t]);
  // Fill the width, but keep the whole garden on screen; the backdrop extends past the viewBox to letterbox.
  // Never more than 1.3x the drawing's own size, so a 2-team garden doesn't turn into giant flowers.
  const svgHeight = width ? Math.round(Math.min((width * layout.height) / layout.width, Math.max(340, window.innerHeight * 0.68), layout.height * 1.3)) : undefined;
  // When the garden is drawn small (phones), make its text relatively bigger and hide bee names unless asked.
  const scale = width && svgHeight ? Math.min(width / layout.width, svgHeight / layout.height) : 1;
  const fontScale = Math.max(1, Math.min(1.5, 0.8 / scale));
  const names = namesPick ?? scale >= 0.72;
  const shownTurn = Math.min(turns, Math.floor(t));
  const atEnd = t >= endT - 0.01;
  const ready = (team: Team) => team.submitted.clover && team.submitted.orchid && team.submitted.bee;

  return (
    <div className="garden">
      {rounds.length > 0 && (
        <div className="garden-rounds" role="group" aria-label="Choose a round">
          {rounds.map((no) => (
            <button key={no} className={`pill ${round?.no === no ? "active" : ""}`} aria-pressed={round?.no === no} onClick={() => onSelectRound(no)}>
              Round {no}
            </button>
          ))}
        </div>
      )}

      <div className="garden-stage" ref={boxRef}>
        <svg className="garden-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ height: svgHeight, ["--fs" as string]: fontScale.toFixed(2) }}
          role="img" aria-label={round ? `Garden, round ${round.no}, turn ${shownTurn} of ${turns}` : "Garden: each team's patch and bee, waiting for round 1"}>
          <GardenBackdrop layout={layout} />
          {order.map((id) => {
            const team = teamsById[id];
            if (!team || !layout.pos[id]) return null;
            const showKinds = view.game.revealed || id === myTeamId;
            return <Patch key={id} team={team} look={looks[id]} p={layout.pos[id]} mine={id === myTeamId} showKinds={showKinds} dim={!round && !view.participants && !ready(team)} maxChars={Math.round(18 / fontScale)} />;
          })}
          {order.map((id) => {
            const p = layout.pos[id], pt = tally.patches[id];
            if (!p) return null;
            const team = teamsById[id];
            const label = round ? `${pt?.fedAt ?? 0} fed here · ${pt?.nectarGiven ?? 0} nectar` : view.participants || !team ? "" : ready(team) ? "ready to play" : "getting ready…";
            return <text key={id} x={p.x} y={p.y + 68 + 18 * fontScale} className="patch-tally">{label}</text>;
          })}
          {model.effects.map((e, i) => {
            const span = Math.max(e.span, fxMin);
            return t >= e.t0 && t < e.t0 + span ? <FeedFx key={i} at={e.at} u={(t - e.t0) / span} nectar={e.nectar} /> : null;
          })}
          {frames.map((f) => (
            <Bee key={f.teamId} f={f} team={teamsById[f.teamId]} mine={f.teamId === myTeamId} showName={names} />
          ))}
        </svg>
        {view.game.runningRound && <div className="garden-banner"><span className="pulse-dot" /> Round {view.game.runningRound} is being played…</div>}
        {loading !== false && !view.game.runningRound && <div className="garden-banner"><span className="pulse-dot" /> Loading round {loading}'s flights…</div>}
        {round && !playing && (t === 0 || atEnd) && (
          <button className="garden-play" onClick={atEnd ? replay : play}>
            {atEnd ? <ReplayIcon /> : <PlayIcon />} {atEnd ? `Replay round ${round.no}` : `Play round ${round.no}`}
          </button>
        )}
      </div>
      {!round && loading === false && <p className="garden-note muted">{view.game.status === "lobby" ? "The bees are waiting at home. They'll fly as soon as round 1 is played." : "No rounds yet."}</p>}

      {round && (
        <div className="garden-controls">
          <button className="btn btn-round" onClick={playing ? () => setPlaying(false) : play} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="btn btn-round btn-ghost" onClick={replay} aria-label="Replay from the start" title="Replay"><ReplayIcon /></button>
          <button className="btn btn-round btn-ghost" onClick={skipToEnd} aria-label="Skip to the end of the round" title="Skip to the end"><SkipIcon /></button>
          <label className="scrub">
            <span className="sr-only">Turn</span>
            <input type="range" min={0} max={turns} step={Math.max(0.05, turns / 4000)} value={Math.min(t, turns)}
              onChange={(e) => { const v = Number(e.target.value); tRef.current = v; setT(v); }} />
          </label>
          <span className="turn-counter" aria-live="off">Turn <b>{shownTurn}</b> / {turns}</span>
          <label className="speed">
            <span className="sr-only">Speed</span>
            <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{`${s}× (${s * BASE_TPS} turns/s)`}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> names</label>
        </div>
      )}

      <GardenLegend />

      {round && <TallyTable order={order} teams={teamsById} tally={tally} myTeamId={myTeamId} />}
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
        <clipPath id="dbc-bee-body"><ellipse rx="11" ry="7.5" /></clipPath>
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

type Variety = "daisy" | "star";

const STAR_PETAL = "M0 -3 C 7 -8, 7 -17, 0 -22 C -7 -17, -7 -8, 0 -3 Z";

/** One flower. The two varieties differ in petal shape, petal count and centre, both in the team's colour. */
function FlowerShape({ x, color, variety }: { x: number; color: string; variety: Variety }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className="flower">
        <path d={`M0 20 C -3 6, 3 -12, 0 ${FLOWER_Y}`} className="stem" />
        <ellipse cx="-7" cy="2" rx="8" ry="3.5" transform="rotate(-30 -7 2)" className="leaf" />
        <ellipse cx="7" cy="-8" rx="8" ry="3.5" transform="rotate(30 7 -8)" className="leaf" />
        <g transform={`translate(0 ${FLOWER_Y})`}>
          {variety === "daisy" ? (
            <>
              {Array.from({ length: 12 }, (_, i) => i * 30).map((a) => (
                <ellipse key={a} cx="0" cy="-11" rx="3.8" ry="10.5" transform={`rotate(${a})`} fill={color} className="petal" />
              ))}
              <circle r="7" className="flower-eye" />
              <circle r="1.5" cx="-2.2" cy="-2" className="flower-eye-dot" />
              <circle r="1.3" cx="2.4" cy="-1" className="flower-eye-dot" />
              <circle r="1.3" cx="-0.5" cy="2.6" className="flower-eye-dot" />
            </>
          ) : (
            <>
              {[0, 72, 144, 216, 288].map((a) => (
                <g key={a} transform={`rotate(${a + 36})`}>
                  <path d={STAR_PETAL} fill={color} className="petal" />
                  <path d="M0 -5 L0 -17" className="petal-vein" />
                </g>
              ))}
              <circle r="5" className="star-eye" />
              {[0, 72, 144, 216, 288].map((a) => (
                <circle key={a} r="1.4" cx={6.6 * Math.sin((a * Math.PI) / 180)} cy={-6.6 * Math.cos((a * Math.PI) / 180)} className="star-stamen" />
              ))}
            </>
          )}
        </g>
      </g>
    </g>
  );
}

const Patch = memo(function Patch({ team, look, p, mine, showKinds, dim, maxChars }: {
  team: Team; look: PatchLook; p: Pt; mine: boolean; showKinds: boolean; dim: boolean; maxChars: number;
}) {
  const name = team.name.length > maxChars ? team.name.slice(0, maxChars - 1) + "…" : team.name;
  const left: Variety = look.daisyLeft ? "daisy" : "star";
  const right: Variety = look.daisyLeft ? "star" : "daisy";
  const cloverX = look.cloverLeft ? -FLOWER_DX : FLOWER_DX;
  const cloverVariety = look.cloverLeft ? left : right;
  return (
    <g transform={`translate(${p.x} ${p.y})`} className={`patch ${dim ? "dim" : ""}`}>
      <title>{`${poss(team.name)} patch: one clover and one orchid.${showKinds ? ` The ${cloverVariety} is the clover.` : ""}`}</title>
      {mine && <ellipse cy={-12} rx={112} ry={84} className="patch-mine" />}
      <ellipse cy={24} rx={70} ry={15} className="soil" />
      <FlowerShape x={-FLOWER_DX} color={team.color} variety={left} />
      <FlowerShape x={FLOWER_DX} color={team.color} variety={right} />
      {showKinds && (
        <>
          <text x={cloverX} y={30} className="kind-tag">clover</text>
          <text x={-cloverX} y={30} className="kind-tag">orchid</text>
        </>
      )}
      <text y={68} className="patch-label"><tspan fill={team.color} className="patch-label-dot">●</tspan> {name}</text>
    </g>
  );
});

function Bee({ f, team, mine, showName }: { f: BeeFrame & { teamId: string }; team: Team | undefined; mine: boolean; showName: boolean }) {
  if (!team) return null;
  const color = team.color;
  const resting = f.mode === "done" || f.mode === "home";
  const label = team.name.length > 12 ? team.name.slice(0, 11) + "…" : team.name;
  return (
    <g transform={`translate(${f.x.toFixed(1)} ${f.y.toFixed(1)})`} className={`bee ${resting ? "resting" : ""} ${f.mode === "done" ? "done" : ""}`}>
      <title>{`${poss(team.name)} bee`}</title>
      {mine && <circle r={19} className="bee-halo" />}
      <g transform={`rotate(${f.tilt.toFixed(1)}) scale(${f.flip ? -1 : 1} 1)`}>
        <ellipse cx="-3" cy="-9" rx="7" ry="5" className="bee-wing" />
        <ellipse cx="4" cy="-9" rx="6" ry="4.5" className="bee-wing bee-wing-2" />
        <path d="M-11 0 l-5 0 l5 -2.5z" className="bee-sting" />
        <ellipse rx="11" ry="7.5" fill={color} className="bee-body" />
        <g clipPath="url(#dbc-bee-body)">
          <rect x="-6" y="-8" width="3.4" height="16" className="bee-stripe" />
          <rect x="0.5" y="-8" width="3.4" height="16" className="bee-stripe" />
        </g>
        <ellipse rx="11" ry="7.5" fill="none" className="bee-outline" />
        <circle cx="11.5" cy="-1" r="4.6" className="bee-head" />
        <circle cx="13" cy="-2.3" r="1.3" className="bee-eye" />
      </g>
      {showName && <text y={22} className="bee-name">{label}</text>}
      {f.mode === "ask" && (
        <g transform={`translate(13 -19) scale(${(0.55 + 0.6 * f.pulse).toFixed(2)})`} opacity={0.35 + 0.65 * f.pulse}>
          <circle r="9" className="bubble" />
          <text y="4.5" className="bubble-text">?</text>
        </g>
      )}
      {f.mode === "study" && (
        <g transform={`translate(13 -19) scale(${(0.6 + 0.5 * f.pulse).toFixed(2)})`} opacity={0.45 + 0.55 * f.pulse}>
          <circle r="9.5" className="bubble bubble-study" />
          <circle cx="-1.5" cy="-1.5" r="4" className="lens" />
          <path d="M1.4 1.4 L5.2 5.2" className="lens-handle" />
        </g>
      )}
      {f.mode === "error" && (
        <g transform="translate(13 -19)">
          <circle r="9" className="bubble bubble-err" />
          <text y="4.5" className="bubble-text bubble-err-text">!</text>
        </g>
      )}
      {f.mode === "done" && <text x={12} y={-12} className="bee-zzz">z z</text>}
    </g>
  );
}

function FeedFx({ at, u, nectar }: { at: Pt; u: number; nectar: boolean }) {
  const fade = u < 0.15 ? u / 0.15 : 1 - Math.max(0, (u - 0.6) / 0.4);
  if (nectar) {
    const rise = 14 + u * 30;
    return (
      <g transform={`translate(${at.x.toFixed(1)} ${(at.y - rise).toFixed(1)})`} opacity={fade.toFixed(2)} className="fx">
        <circle r={20 + u * 10} className="fx-glow" />
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2 + u * 3;
          const r = 14 + u * 14;
          return <path key={i} d="M0 -4 L1.2 -1.2 4 0 1.2 1.2 0 4 -1.2 1.2 -4 0 -1.2 -1.2Z" className="fx-sparkle" transform={`translate(${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)})`} />;
        })}
        <path d="M0 -12 C -4 -6 -7 -2 -7 2 a7 7 0 0 0 14 0 c0 -4 -3 -8 -7 -14z" className="fx-drop" />
        <ellipse cx="-2.6" cy="1" rx="1.6" ry="2.6" fill="#fff" opacity=".75" />
        <text x={12} y={-4} className="fx-text fx-text-good">+1</text>
      </g>
    );
  }
  const shake = Math.sin(u * 40) * 3 * (1 - u);
  return (
    <g transform={`translate(${(at.x + shake).toFixed(1)} ${(at.y - 26).toFixed(1)})`} opacity={fade.toFixed(2)} className="fx">
      <circle r="10" className="fx-fooled" />
      <path d="M-4.5 -4.5 L4.5 4.5 M4.5 -4.5 L-4.5 4.5" className="fx-fooled-x" />
      <text y={-15} className="fx-text fx-text-bad">fooled!</text>
    </g>
  );
}

function GardenLegend() {
  return (
    <ul className="garden-legend" aria-label="What the garden shows">
      <li><span className="lg lg-ask">?</span> the bee asks a question</li>
      <li><DropIcon size={16} /> fed and got nectar (it was a clover)</li>
      <li><FooledIcon size={16} /> fed but no nectar: fooled by an orchid</li>
      <li><span className="lg lg-study"><svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden><circle cx="-1" cy="-1" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M1.4 1.4 L4.4 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span> studies a flower after feeding</li>
      <li><span className="lg lg-err">!</span> the bee made a mistake</li>
    </ul>
  );
}

function TallyTable({ order, teams, tally, myTeamId }: {
  order: string[]; teams: Record<string, Team>; tally: ReturnType<typeof tallies>; myTeamId: string | null;
}) {
  return (
    <div className="table-scroll">
      <table className="tally-table">
        <caption className="sr-only">Running tally for this round</caption>
        <thead>
          <tr>
            <th scope="col" className="left">Team</th>
            <th scope="col" title="How many flowers this team's bee fed at">Bee fed</th>
            <th scope="col" title="Feeds that paid off with nectar">Nectar</th>
            <th scope="col" title="Feeds with no nectar (orchids)">Fooled</th>
            <th scope="col" title="Questions asked so far">Asks</th>
            <th scope="col" title="Questions asked after feeding, studying a flower whose truth the bee now knows">Studied</th>
            <th scope="col" title="Times bees fed at this team's patch">Fed at patch</th>
            <th scope="col" title="Different bee teams that fed at this patch">Pollinators</th>
          </tr>
        </thead>
        <tbody>
          {order.map((id) => {
            const b = tally.bees[id], p = tally.patches[id];
            return (
              <tr key={id} className={id === myTeamId ? "mine" : ""}>
                <th scope="row" className="left"><TeamChip team={teams[id]} you={id === myTeamId} short /></th>
                <td>{b?.feeds ?? 0}</td>
                <td className="good">{b?.nectar ?? 0}</td>
                <td className="bad">{(b?.feeds ?? 0) - (b?.nectar ?? 0)}</td>
                <td>{b?.asks ?? 0}</td>
                <td>{b?.studied ?? 0}</td>
                <td>{p?.fedAt ?? 0}</td>
                <td>{p?.pollinators.size ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type { Model };
