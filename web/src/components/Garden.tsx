// The garden, live: one patch per team (its clover on the left, its orchid on the right) and one bee per
// team, flying between flowers as the actions stream in. The animation runs a moment behind the game
// clock (see gardenModel.ts) and re-renders at most ~30 times a second, only while something moves and
// the garden is on screen.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { poss, fmtClock } from "../lib/format";
import type { Action, GameView, Team, TeamScore } from "../types";
import { useElementWidth } from "../hooks";
import { useLiveTick, type LiveStore } from "../lib/live";
import { FLOWER_DX, FLOWER_Y, FX_MS, GardenAnimator, layoutGarden, TOP_PAD, type BeeSprite, type Frame, type Fx, type Layout, type Pt } from "./gardenModel";
import { DropIcon, FooledIcon } from "./Icons";

const FRAME_MS = 33;

/** Whole-game counts per team, live: the view's scores plus what has streamed in since. */
function liveCounts(view: GameView, actions: Action[]) {
  const out: Record<string, { fedHere: number; nectar: number; fooled: number }> = {};
  for (const s of view.scores ?? []) out[s.teamId] = { fedHere: s.feedsReceived, nectar: s.nectarCollected, fooled: s.feedsGiven - s.nectarCollected };
  const since = view.game.lastSeq;
  for (let i = actions.length - 1; i >= 0 && actions[i].seq > since; i--) {
    const a = actions[i];
    if (a.action !== "feed") continue;
    if (out[a.patch]) out[a.patch].fedHere++;
    if (out[a.bee]) { if (a.nectar) out[a.bee].nectar++; else out[a.bee].fooled++; }
  }
  return out;
}

export function Garden({ view, store }: { view: GameView; store: LiveStore }) {
  const g = view.game;
  const status = g.status;
  const teamsById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const order = useMemo(() => view.participants?.length ? view.participants : view.teams.map((t) => t.id), [view.participants, view.teams]);
  const myTeamId = view.me?.teamId ?? null;

  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => layoutGarden(order, width), [order, width]);
  const anim = useRef<GardenAnimator | null>(null);
  if (!anim.current) anim.current = new GardenAnimator(layout, order);
  useEffect(() => { anim.current!.setTeams(layout, order); }, [layout, order]);

  const [frame, setFrame] = useState<Frame>(() => anim.current!.frame(performance.now(), status));
  const visible = useRef(true);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => { visible.current = e[0].isIntersecting; setOnScreen(e[0].isIntersecting); }, { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, [boxRef]);

  // The animation loop: steps the animator every frame, draws at most every FRAME_MS. It stops when
  // nothing moves (paused, finished, lobby) and starts again when the store or the status changes.
  const statusRef = useRef(status);
  statusRef.current = status;
  const [wake, setWake] = useState(0);
  useEffect(() => store.subscribe(() => { if (anim.current?.idle) setWake((w) => w + 1); }), [store]);
  useEffect(() => {
    let raf = 0, lastDraw = 0;
    const a = anim.current!;
    a.idle = false;
    const tick = (now: number) => {
      a.step(store, now, store.now(), statusRef.current);
      if (visible.current && now - lastDraw >= FRAME_MS) {
        lastDraw = now;
        setFrame(a.frame(now, statusRef.current));
      }
      if (a.idle) { setFrame(a.frame(now, statusRef.current)); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, status, wake, layout]);

  // Live whole-game tallies for the patch labels (re-read twice a second).
  const rev = useLiveTick(store, 500);
  const counts = useMemo(() => liveCounts(view, store.actions), [view, store, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const rate = status === "running" ? store.actionsPerSecond() : 0;

  // Fill the width, but keep the whole garden on screen; never more than 1.3× its own size.
  const svgHeight = width ? Math.round(Math.min((width * layout.height) / layout.width, Math.max(340, window.innerHeight * 0.68), layout.height * 1.3)) : undefined;
  const scale = width && svgHeight ? Math.min(width / layout.width, svgHeight / layout.height) : 1;
  const fontScale = Math.max(1, Math.min(1.5, 0.8 / scale));
  const [namesPick, setNames] = useState<boolean | null>(null);
  const names = namesPick ?? scale >= 0.72;
  const ready = (t: Team) => !!t.ready && t.ready.clover && t.ready.orchid && t.ready.bee;
  const now = performance.now();

  return (
    <div className="garden">
      <div className={`garden-stage ${onScreen ? "" : "offscreen"}`} ref={boxRef}>
        <svg className={`garden-svg garden-${status}`} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ height: svgHeight, ["--fs" as string]: fontScale.toFixed(2) }}
          role="img" aria-label={`The garden: ${order.length} patches and their bees${status === "running" ? ", live" : ""}`}>
          <GardenBackdrop layout={layout} />
          {order.map((id) => {
            const team = teamsById[id];
            if (!team || !layout.pos[id]) return null;
            return <Patch key={id} team={team} p={layout.pos[id]} mine={id === myTeamId} dim={status === "lobby" && !ready(team)} maxChars={Math.round(18 / fontScale)} />;
          })}
          {order.map((id) => {
            const p = layout.pos[id], c = counts[id];
            if (!p) return null;
            const team = teamsById[id];
            const label = status === "lobby" ? (team && ready(team) ? "ready to play" : "getting ready…") : c ? `${c.fedHere.toLocaleString()} fed here` : "";
            return <text key={id} x={p.x} y={p.y + 68 + 18 * fontScale} className="patch-tally">{label}</text>;
          })}
        </svg>
        <svg className={`garden-svg garden-overlay garden-${status}`} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ height: svgHeight, ["--fs" as string]: fontScale.toFixed(2) }} aria-hidden>
          <defs><clipPath id="dbc-bee-body"><ellipse rx="11" ry="7.5" /></clipPath></defs>
          {Object.entries(frame.glow).map(([key, v]) => {
            const [patch, kind] = key.split(":");
            const p = layout.pos[patch];
            if (!p) return null;
            return <circle key={key} cx={p.x + (kind === "clover" ? -FLOWER_DX : FLOWER_DX)} cy={p.y + FLOWER_Y} r={22 + 4 * (1 - v)} className="ask-glow" opacity={(0.4 * v).toFixed(2)} />;
          })}
          {frame.fx.map((f) => <FeedFx key={f.id} f={f} u={Math.min(1, Math.max(0, (now - f.t0) / FX_MS))} />)}
          {frame.bees.map((b) => <Bee key={b.team} b={b} team={teamsById[b.team]} mine={b.team === myTeamId} showName={names} paused={status === "paused"} />)}
        </svg>
        {status === "lobby" && <div className="garden-banner">The bees wait at home until the game starts.</div>}
        {status === "paused" && <div className="garden-banner garden-banner-paused">Paused</div>}
        {status === "finished" && <div className="garden-banner garden-banner-done">The game is over. The bees are resting.</div>}
      </div>
      <div className="garden-bar">
        {status === "running" && (
          <span className="garden-rate" title="Bee actions per second of real time, over the last few seconds">
            <span className="pulse-dot" /> <b>{Math.round(rate).toLocaleString()}</b> actions/s
          </span>
        )}
        {status !== "lobby" && <span className="muted small">{store.lastSeq.toLocaleString()} actions so far{status === "running" ? ` · showing game time ${fmtClock(Math.max(0, frame.display))}, a second behind live` : ""}</span>}
        <label className="check small"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> bee names</label>
      </div>
      <GardenLegend />
      {status !== "lobby" && view.scores && <BeeTally order={order} teams={teamsById} counts={counts} scores={view.scores} myTeamId={myTeamId} />}
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

const STAR_PETAL = "M0 -3 C 7 -8, 7 -17, 0 -22 C -7 -17, -7 -8, 0 -3 Z";

/** One flower: the clover is round-petalled, the orchid star-shaped; both in the team's colour. */
function FlowerShape({ x, color, kind }: { x: number; color: string; kind: "clover" | "orchid" }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className="flower">
        <path d={`M0 20 C -3 6, 3 -12, 0 ${FLOWER_Y}`} className="stem" />
        <ellipse cx="-7" cy="2" rx="8" ry="3.5" transform="rotate(-30 -7 2)" className="leaf" />
        <ellipse cx="7" cy="-8" rx="8" ry="3.5" transform="rotate(30 7 -8)" className="leaf" />
        <g transform={`translate(0 ${FLOWER_Y})`}>
          {kind === "clover" ? (
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

const Patch = memo(function Patch({ team, p, mine, dim, maxChars }: { team: Team; p: Pt; mine: boolean; dim: boolean; maxChars: number }) {
  const name = team.name.length > maxChars ? team.name.slice(0, maxChars - 1) + "…" : team.name;
  return (
    <g transform={`translate(${p.x} ${p.y})`} className={`patch ${dim ? "dim" : ""}`}>
      <title>{`${poss(team.name)} patch: its clover (left) and its orchid (right).`}</title>
      {mine && <ellipse cy={-12} rx={112} ry={84} className="patch-mine" />}
      <ellipse cy={24} rx={70} ry={15} className="soil" />
      <FlowerShape x={-FLOWER_DX} color={team.color} kind="clover" />
      <FlowerShape x={FLOWER_DX} color={team.color} kind="orchid" />
      <text x={-FLOWER_DX} y={31} className="kind-tag">clover</text>
      <text x={FLOWER_DX} y={31} className="kind-tag">orchid</text>
      <text y={68} className="patch-label"><tspan fill={team.color} className="patch-label-dot">●</tspan> {name}</text>
    </g>
  );
});

function Bee({ b, team, mine, showName, paused }: { b: BeeSprite; team: Team | undefined; mine: boolean; showName: boolean; paused: boolean }) {
  if (!team) return null;
  const resting = b.mode === "rest" || b.mode === "home" || paused;
  const label = team.name.length > 12 ? team.name.slice(0, 11) + "…" : team.name;
  return (
    <g transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`} className={`bee ${resting ? "resting" : ""} ${b.mode === "rest" ? "done" : ""}`}>
      <title>{`${poss(team.name)} bee`}</title>
      {mine && <circle r={19} className="bee-halo" />}
      <g transform={`rotate(${b.tilt.toFixed(1)}) scale(${b.flip ? -1 : 1} 1)`}>
        <g transform={b.flap < 1 ? `translate(0 -5) scale(1 ${b.flap.toFixed(2)}) translate(0 5)` : undefined}>
          <ellipse cx="-3" cy="-9" rx="7" ry="5" className="bee-wing" />
          <ellipse cx="4" cy="-9" rx="6" ry="4.5" className="bee-wing" />
        </g>
        <path d="M-11 0 l-5 0 l5 -2.5z" className="bee-sting" />
        <ellipse rx="11" ry="7.5" fill={team.color} className="bee-body" />
        <g clipPath="url(#dbc-bee-body)">
          <rect x="-6" y="-8" width="3.4" height="16" className="bee-stripe" />
          <rect x="0.5" y="-8" width="3.4" height="16" className="bee-stripe" />
        </g>
        <ellipse rx="11" ry="7.5" fill="none" className="bee-outline" />
        <circle cx="11.5" cy="-1" r="4.6" className="bee-head" />
        <circle cx="13" cy="-2.3" r="1.3" className="bee-eye" />
      </g>
      {showName && <text y={22} className="bee-name">{label}</text>}
      {b.mode === "ask" && (
        <g transform={`translate(13 -19) scale(${(0.55 + 0.6 * b.pulse).toFixed(2)})`} opacity={(0.35 + 0.65 * b.pulse).toFixed(2)}>
          <circle r="9" className="bubble" />
          <text y="4.5" className="bubble-text">?</text>
        </g>
      )}
      {b.mode === "error" && (
        <g transform="translate(13 -19)">
          <circle r="9" className="bubble bubble-err" />
          <text y="4.5" className="bubble-text bubble-err-text">!</text>
        </g>
      )}
      {b.mode === "rest" && <text x={12} y={-12} className="bee-zzz">z z</text>}
    </g>
  );
}

function FeedFx({ f, u }: { f: Fx; u: number }) {
  const fade = u < 0.12 ? u / 0.12 : 1 - Math.max(0, (u - 0.6) / 0.4);
  const n = f.count > 1 ? ` ×${f.count}` : "";
  if (f.nectar) {
    const rise = 12 + u * 30;
    return (
      <g transform={`translate(${f.x.toFixed(1)} ${(f.y - rise).toFixed(1)})`} opacity={fade.toFixed(2)} className="fx">
        <circle r={18 + u * 10} className="fx-glow" />
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2 + u * 3;
          const r = 13 + u * 13;
          return <path key={i} d="M0 -4 L1.2 -1.2 4 0 1.2 1.2 0 4 -1.2 1.2 -4 0 -1.2 -1.2Z" className="fx-sparkle" transform={`translate(${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)})`} />;
        })}
        <path d="M0 -12 C -4 -6 -7 -2 -7 2 a7 7 0 0 0 14 0 c0 -4 -3 -8 -7 -14z" className="fx-drop" />
        <ellipse cx="-2.6" cy="1" rx="1.6" ry="2.6" fill="#fff" opacity=".75" />
        <text x={11} y={-4} className="fx-text fx-text-good">{`+${f.count}`}</text>
      </g>
    );
  }
  const shake = Math.sin(u * 40) * 3 * (1 - u);
  return (
    <g transform={`translate(${(f.x + shake).toFixed(1)} ${(f.y - 24).toFixed(1)})`} opacity={fade.toFixed(2)} className="fx">
      <circle r="10" className="fx-fooled" />
      <path d="M-4.5 -4.5 L4.5 4.5 M4.5 -4.5 L-4.5 4.5" className="fx-fooled-x" />
      <text y={-15} className="fx-text fx-text-bad">{`fooled${n}`}</text>
    </g>
  );
}

const GardenLegend = memo(function GardenLegend() {
  return (
    <ul className="garden-legend" aria-label="What the garden shows">
      <li><span className="lg-flowers" aria-hidden>✿</span> each patch: its clover (left, pays nectar) and its orchid (right, pays nothing)</li>
      <li><span className="lg lg-ask">?</span> a bee asks a flower a question</li>
      <li><DropIcon size={16} /> fed and got nectar</li>
      <li><FooledIcon size={16} /> fed at an orchid: fooled</li>
      <li><span className="lg lg-err">!</span> the bee made a mistake</li>
    </ul>
  );
});

/** Whole-game tallies per team, kept live between score updates. */
const BeeTally = memo(function BeeTally({ order, teams, counts, scores, myTeamId }: {
  order: string[]; teams: Record<string, Team>; counts: ReturnType<typeof liveCounts>; scores: TeamScore[]; myTeamId: string | null;
}) {
  const byId = Object.fromEntries(scores.map((s) => [s.teamId, s]));
  return (
    <div className="table-scroll">
      <table className="tally-table">
        <caption className="sr-only">Whole-game tallies</caption>
        <thead>
          <tr>
            <th scope="col" className="left">Team</th>
            <th scope="col" title="Feeds bees made at this team's patch (clover or orchid)">Fed at patch</th>
            <th scope="col" title="Different bees that fed at this patch">Pollinators</th>
            <th scope="col" title="Nectar this team's bee collected">Bee: nectar</th>
            <th scope="col" title="Feeds at orchids: no nectar">Bee: fooled</th>
            <th scope="col" title="Different patches that gave this bee nectar">Nectar sources</th>
          </tr>
        </thead>
        <tbody>
          {order.map((id) => {
            const c = counts[id], s = byId[id];
            const t = teams[id];
            return (
              <tr key={id} className={id === myTeamId ? "mine" : ""}>
                <th scope="row" className="left">
                  <span className="team-chip" title={t?.name}><span className="swatch" style={{ background: t?.color }} /><span className="team-name">{t?.name}</span>{id === myTeamId && <span className="you-tag">you</span>}</span>
                </th>
                <td>{(c?.fedHere ?? 0).toLocaleString()}</td>
                <td>{s?.pollinators ?? 0}</td>
                <td className="good">{(c?.nectar ?? 0).toLocaleString()}</td>
                <td className="bad">{(c?.fooled ?? 0).toLocaleString()}</td>
                <td>{s?.nectarSources ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
