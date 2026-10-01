// The garden: one patch (two identical flowers) per team and one bee per team, replaying a round's
// visits on a shared turn clock. Public viewers never learn which flower in a patch a bee visited;
// the patch owner (visit.kind present) and everyone after a reveal see the exact flower.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { GameView, Round, Team } from "../types";
import { useElementWidth, storage } from "../hooks";
import {
  beeFrame, buildModel, layoutGarden, slot, tallies, FLOWER_DX, FLOWER_Y, TOP_PAD,
  type BeeFrame, type Layout, type Model, type Pt,
} from "./gardenModel";
import { DropIcon, FooledIcon, PauseIcon, PlayIcon, ReplayIcon } from "./Icons";
import { TeamChip } from "./ui";

export type GardenStart = "start" | "end" | "play";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export function Garden({ view, round, start, rounds, onSelectRound }: {
  view: GameView;
  round: Round | null;
  start: GardenStart;
  rounds: number[];
  onSelectRound: (no: number) => void;
}) {
  const cfg = view.game.config;
  const turns = cfg.turns;
  const endT = turns + 1.6;
  const teamsById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const order = useMemo(() => {
    if (view.participants?.length) return view.participants;
    return view.teams.map((t) => t.id);
  }, [view.participants, view.teams]);
  const myTeamId = view.me?.teamId ?? null;

  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => layoutGarden(order, width), [order, width]);
  const model = useMemo(() => buildModel(round?.visits ?? [], round ? order : [], layout.pos), [round, order, layout]);

  // Playback clock, in turns.
  const [t, setT] = useState(() => (round && start === "end" ? endT : 0));
  const [playing, setPlaying] = useState(() => !!round && start === "play");
  const [speed, setSpeed] = useState(() => {
    const s = Number(storage.get("dbc:speed"));
    return SPEEDS.includes(s) ? s : 1;
  });
  const [names, setNames] = useState(true);
  const tRef = useRef(t);
  tRef.current = t;
  const rate = Math.max(2, turns / 40); // turns per second at 1x: a round takes about 40 seconds

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
  const changeSpeed = (s: number) => { setSpeed(s); storage.set("dbc:speed", String(s)); };

  const n = model.n || order.length;
  const homes = useMemo(() => Object.fromEntries(order.map((id, i) => [id, layout.pos[id] ? slot(layout.pos[id], i, order.length) : { x: 0, y: 0 }])), [order, layout]);
  const frames: (BeeFrame & { teamId: string; index: number })[] = round
    ? model.tracks.map((tr) => ({ ...beeFrame(tr, t, layout.pos, n, homes[tr.teamId]), teamId: tr.teamId, index: tr.index }))
    : order.map((id, i) => ({ ...homes[id], flip: false, mode: "home" as const, pulse: 0, tilt: 0, teamId: id, index: i }));
  // Busy bees on top.
  frames.sort((a, b) => Number(a.mode !== "done" && a.mode !== "home") - Number(b.mode !== "done" && b.mode !== "home"));
  const tally = useMemo(() => tallies(model, t), [model, t]);
  // Fill the width, but keep the whole garden on screen; the backdrop extends past the viewBox to letterbox.
  // Never more than 1.3x the drawing's own size, so a 2-team garden doesn't turn into giant flowers.
  const svgHeight = width ? Math.round(Math.min((width * layout.height) / layout.width, Math.max(340, window.innerHeight * 0.68), layout.height * 1.3)) : undefined;
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
        <svg className="garden-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ height: svgHeight }}
          role="img" aria-label={round ? `Garden, round ${round.no}, turn ${shownTurn} of ${turns}` : "Garden: each team's patch and bee, waiting for round 1"}>
          <GardenBackdrop layout={layout} />
          {order.map((id) => {
            const team = teamsById[id];
            if (!team || !layout.pos[id]) return null;
            const showKinds = view.game.revealed || id === myTeamId;
            return <Patch key={id} team={team} p={layout.pos[id]} mine={id === myTeamId} showKinds={showKinds} dim={!round && !view.participants && !ready(team)} />;
          })}
          {order.map((id) => {
            const p = layout.pos[id], pt = tally.patches[id];
            if (!p) return null;
            const team = teamsById[id];
            const label = round ? `${pt?.fedAt ?? 0} fed here · ${pt?.nectarGiven ?? 0} nectar` : view.participants || !team ? "" : ready(team) ? "ready to play" : "getting ready…";
            return <text key={id} x={p.x} y={p.y + 86} className="patch-tally">{label}</text>;
          })}
          {model.effects.map((e, i) => (t >= e.t0 && t < e.t1 ? <FeedFx key={i} at={e.at} u={(t - e.t0) / (e.t1 - e.t0)} nectar={e.nectar} /> : null))}
          {frames.map((f) => (
            <Bee key={f.teamId} f={f} team={teamsById[f.teamId]} mine={f.teamId === myTeamId} showName={names} />
          ))}
        </svg>
        {view.game.runningRound && <div className="garden-banner"><span className="pulse-dot" /> Round {view.game.runningRound} is being played…</div>}
        {round && !playing && (t === 0 || atEnd) && (
          <button className="garden-play" onClick={atEnd ? replay : play}>
            {atEnd ? <ReplayIcon /> : <PlayIcon />} {atEnd ? `Replay round ${round.no}` : `Play round ${round.no}`}
          </button>
        )}
        {!round && <div className="garden-empty">{view.game.status === "lobby" ? "The bees are waiting at home. They'll fly as soon as round 1 is played." : "No rounds yet."}</div>}
      </div>

      {round && (
        <div className="garden-controls">
          <button className="btn btn-round" onClick={playing ? () => setPlaying(false) : play} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="btn btn-round btn-ghost" onClick={replay} aria-label="Replay from the start"><ReplayIcon /></button>
          <label className="scrub">
            <span className="sr-only">Turn</span>
            <input type="range" min={0} max={turns} step={0.05} value={Math.min(t, turns)}
              onChange={(e) => { const v = Number(e.target.value); tRef.current = v; setT(v); }} />
          </label>
          <span className="turn-counter" aria-live="off">Turn <b>{shownTurn}</b> / {turns}</span>
          <label className="speed">
            <span className="sr-only">Speed</span>
            <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s < 1 ? `${s}×` : `${s}×`}</option>)}
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

function FlowerShape({ x, color }: { x: number; color: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className="flower">
      <path d={`M0 20 C -3 6, 3 -12, 0 ${FLOWER_Y}`} className="stem" />
      <ellipse cx="-7" cy="2" rx="8" ry="3.5" transform="rotate(-30 -7 2)" className="leaf" />
      <ellipse cx="7" cy="-8" rx="8" ry="3.5" transform="rotate(30 7 -8)" className="leaf" />
      <g transform={`translate(0 ${FLOWER_Y})`}>
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <ellipse key={a} cx="0" cy="-11" rx="7.5" ry="11.5" transform={`rotate(${a})`} fill={color} className="petal" />
        ))}
        <circle r="7.5" className="flower-eye" />
        <circle r="2" cx="-2" cy="-2" className="flower-eye-dot" />
        <circle r="1.6" cx="2.5" cy="1.5" className="flower-eye-dot" />
      </g>
      </g>
    </g>
  );
}

const Patch = memo(function Patch({ team, p, mine, showKinds, dim }: { team: Team; p: Pt; mine: boolean; showKinds: boolean; dim: boolean }) {
  const name = team.name.length > 18 ? team.name.slice(0, 17) + "…" : team.name;
  return (
    <g transform={`translate(${p.x} ${p.y})`} className={`patch ${dim ? "dim" : ""}`}>
      <title>{`${team.name}'s patch: two flowers, a clover and an orchid. Which is which is secret.`}</title>
      {mine && <ellipse cy={-12} rx={112} ry={84} className="patch-mine" />}
      <ellipse cy={24} rx={70} ry={15} className="soil" />
      <FlowerShape x={-FLOWER_DX} color={team.color} />
      <FlowerShape x={FLOWER_DX} color={team.color} />
      {showKinds && (
        <>
          <text x={-FLOWER_DX} y={30} className="kind-tag">clover</text>
          <text x={FLOWER_DX} y={30} className="kind-tag">orchid</text>
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
      <title>{`${team.name}'s bee`}</title>
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
