// The action feed: every turn as it ends, newest first, filterable by bee team, flower team and feeds only.
// A turn's end (feed or leave) carries the whole turn, so arrivals are hidden unless asked for. Each row
// shows what the viewer may see: public (who, the challenge, the response, fed or not; on a feed, the
// percent, energy, nectar and pollen) and, for your own team, the private rest (energy lost on unfed
// visits at your flower, its compute time, your bee's decision time and errors, versions, prints).
import { memo, useMemo, useState } from "react";
import type { Action, Budget, GameView, Kind, Team } from "../types";
import { loadEarlier, useLiveTick, type ActionSource, type LiveStore } from "../lib/live";
import { errorText } from "../api";
import { fmtClock, fmtE, fmtEExact, fmtMs } from "../lib/format";
import { Value } from "./Value";
import { noResponse, partsOfAction, ResponseView, responseUrl } from "./ResponseView";
import { GrainChip } from "./Pollen";
import { DropIcon, PauseIcon, PlayIcon } from "./Icons";
import { Alert } from "./ui";

/** A bee that didn't decide within its time (its turn is settled as a leave, and it can't have fed). */
export const isTooSlow = (a: Action) => !!a.beeError && /too slow|no reply|late/i.test(a.beeError);

interface Filters { bee: string; flower: string; fed: boolean; mine: boolean; arrivals: boolean; prints: boolean; problems: boolean }
const NONE: Filters = { bee: "", flower: "", fed: false, mine: false, arrivals: false, prints: false, problems: false };

function matches(a: Action, f: Filters, my: string | null): boolean {
  if (a.action === "arrive" && !f.arrivals) return false;
  if (f.bee && a.bee !== f.bee) return false;
  if (f.flower && a.flower !== f.flower) return false;
  if (f.fed && a.action !== "feed") return false;
  if (f.mine && my && a.bee !== my && a.flower !== my) return false;
  if (f.prints && !a.log) return false;
  if (f.problems && !a.beeError && !a.flowerError) return false;
  return true;
}

const PAGE = 80;

export function Feed({ view, source, base }: { view: GameView; source: ActionSource; base: string }) {
  const g = view.game;
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const order = view.participants ?? [];
  const myTeamId = view.me?.teamId ?? null;
  const playing = !!(myTeamId && order.includes(myTeamId));
  const privateVisible = g.revealed || g.status === "finished" || playing;

  const [f, setF] = useState<Filters>(NONE);
  const [frozen, setFrozen] = useState<Action[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rev = useLiveTick(source, 300);
  const set = (patch: Partial<Filters>) => { setF((x) => ({ ...x, ...patch })); setLimit(PAGE); };

  const list = frozen ?? source.actions;
  const rows = useMemo(() => {
    const out: Action[] = [];
    let total = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (!matches(list[i], f, myTeamId)) continue;
      total++;
      if (out.length < limit) out.push(list[i]);
    }
    return { out, total };
  }, [list, f, limit, myTeamId, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = f.bee || f.flower || f.fed || f.mine || f.prints || f.problems;
  const live = "isRunning" in source;
  const canLoadEarlier = live && g.status === "paused" && !source.complete && source.actions.length > 0;
  const earlier = async () => {
    setLoading(true); setError(null);
    try { await loadEarlier(source as LiveStore, base); setFrozen(null); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  };

  const teamSelect = (value: string, onChange: (v: string) => void, all: string, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{all}</option>
      {order.map((id) => <option key={id} value={id}>{teams[id]?.name}{id === myTeamId ? " (you)" : ""}</option>)}
    </select>
  );

  return (
    <div className="feed">
      <div className="feed-filters">
        <label className="feed-filter"><span>Bee</span>{teamSelect(f.bee, (v) => set({ bee: v }), "every bee", "Bee team")}</label>
        <label className="feed-filter"><span>at</span>{teamSelect(f.flower, (v) => set({ flower: v }), "every flower", "Flower team")}</label>
        <label className="check small"><input type="checkbox" checked={f.fed} onChange={(e) => set({ fed: e.target.checked })} /> fed only</label>
        {myTeamId && order.includes(myTeamId) && <label className="check small"><input type="checkbox" checked={f.mine} onChange={(e) => set({ mine: e.target.checked })} /> my bee or my flower</label>}
        {privateVisible && <label className="check small"><input type="checkbox" checked={f.problems} onChange={(e) => set({ problems: e.target.checked })} /> errors</label>}
        {privateVisible && <label className="check small"><input type="checkbox" checked={f.prints} onChange={(e) => set({ prints: e.target.checked })} /> with prints</label>}
        <label className="check small"><input type="checkbox" checked={f.arrivals} onChange={(e) => set({ arrivals: e.target.checked })} /> arrivals</label>
        {filtered && <button className="link-btn small" onClick={() => set({ ...NONE, arrivals: f.arrivals })}>clear filters</button>}
        {g.status === "running" && (
          <button className={`btn btn-small ${frozen ? "btn-honey" : "btn-ghost"} feed-freeze`} onClick={() => setFrozen(frozen ? null : source.actions.slice())} aria-pressed={!!frozen}>
            {frozen ? <><PlayIcon size={14} /> Follow live</> : <><PauseIcon size={14} /> Hold still</>}
          </button>
        )}
      </div>
      <p className="small muted feed-count">
        {rows.total.toLocaleString()} {filtered ? "matching" : ""} {f.arrivals ? "actions" : "turns"} of the {list.length.toLocaleString()} {source.complete ? "actions in the game" : "most recent actions"}
        {frozen && <b className="warn-text"> · held still: {(source.lastSeq - (frozen[frozen.length - 1]?.seq ?? 0)).toLocaleString()} newer actions waiting</b>}
      </p>
      {rows.out.length === 0 ? (
        <p className="muted feed-empty">{g.status === "lobby" ? "Nothing yet: the bees fly once the game starts." : list.length ? "Nothing matches these filters." : "No turns yet."}</p>
      ) : (
        <ol className="feed-list" aria-label="Turns, newest first">
          {rows.out.map((a) => <FeedRow key={a.seq} a={a} teams={teams} myTeamId={myTeamId} budgets={g.config.budgets} base={base} />)}
        </ol>
      )}
      <div className="row">
        {rows.total > rows.out.length && <button className="btn btn-small btn-ghost" onClick={() => setLimit((l) => l + PAGE * 2)}>Show more</button>}
        {canLoadEarlier && <button className="btn btn-small btn-ghost" onClick={earlier} disabled={loading}>{loading ? "Loading…" : "Load earlier actions"}</button>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

const Chip = ({ team, you }: { team: Team | undefined; you?: boolean }) => (
  <span className="team-chip feed-chip" title={team?.name}>
    <span className="swatch" style={{ background: team?.color }} />
    <span className="team-name">{team?.name ?? "?"}</span>
    {you && <span className="you-tag">you</span>}
  </span>
);

/** A measured time against its limit: plain while comfortable, amber when close, red when over. */
export function Took({ ms, limit, what }: { ms: number; limit: number; what: string }) {
  const tone = ms > limit ? "over" : ms > limit * 0.8 ? "near" : "";
  return (
    <span className={`feed-took ${tone}`} title={`${what} took ${ms.toFixed(1)} ms (limit ${limit} ms)`}>
      {what} {fmtMs(ms)}<span className="muted">/{limit} ms</span>
    </span>
  );
}

export const FeedRow = memo(function FeedRow({ a, teams, myTeamId, tenths = true, own = false, budgets, base, fedRuns = false }: {
  a: Action; teams: Record<string, Team>; myTeamId: string | null; tenths?: boolean; own?: boolean; budgets?: Record<Kind, Budget>;
  /** The game's API base, for a big response's "load the full response" (none in the try panel). */
  base?: string;
  /** The bee defines fed(): after a feed it runs, in the same instance (shown on feed rows; try panel). */
  fedRuns?: boolean;
}) {
  const slow = isTooSlow(a);
  const isFed = a.action === "feed";
  const resp = partsOfAction(a);
  const failed = a.action !== "arrive" && (noResponse(resp) || !!a.flowerError);
  const hasE = typeof a.energy === "number";
  return (
    <li className={`feed-row feed-${a.action} ${failed ? "feed-failed" : ""} ${slow ? "feed-slow" : ""}`}>
      <span className="feed-time mono" title={`Action ${a.seq.toLocaleString()}: round ${a.round.toLocaleString()}, turn ${a.turn} of this bee, at ${fmtClock(a.atMs, true)} of game time`}>
        {fmtClock(a.atMs, tenths)}<span className="feed-round">r{a.round.toLocaleString()}</span>
      </span>
      <span className="feed-who">
        {own ? <span className="muted small">your bee → your flower</span> : <>
          <Chip team={teams[a.bee]} you={a.bee === myTeamId} />
          <span className="feed-arrow" aria-label="at">→</span>
          <Chip team={teams[a.flower]} you={a.flower === myTeamId} />
        </>}
      </span>
      <span className="feed-what">
        {a.action === "arrive" ? <span className="arrive-text" title="The engine drew this flower for the bee's turn: it flies there and asks">arrives</span> : (
          <span className="step">
            <Value v={a.c} role="challenge" max={24} /><span className="arrow">→</span>
            <ResponseView p={resp} url={base ? responseUrl(base, a.seq) : null} failedText={a.flowerError ?? undefined} />
          </span>
        )}
        {isFed && <span className="ok-text nowrap"><DropIcon size={15} /> fed{typeof a.nectar === "number" && <>: <b title={fmtEExact(a.nectar)}>{fmtE(a.nectar)}</b> nectar</>}</span>}
        {a.action === "leave" && <span className="muted">left</span>}
        {isFed && typeof a.grain === "string" && <GrainChip grain={a.grain} version={a.grainVersion} length={a.grainCodeLength} />}
        {isFed && fedRuns && <span className="fed-ran" title="The bee defines fed(): it ran after this feed, in the same program instance as the decision, and MEMORY was saved after it. What it printed shows with the next turn.">then fed({typeof a.nectar === "number" ? fmtE(a.nectar) : "nectar"})</span>}
        {a.action !== "arrive" && hasE && (
          <span className="feed-energy" title={`E = ${fmtEExact(a.energy)}: what was left after size and compute. ${a.percent ?? "?"}% offered as nectar; on a feed the rest is given as pollen.`}>
            {a.percent ?? "?"}% of {fmtE(a.energy)}
            {isFed ? typeof a.pollen === "number" && <> · pollen <b>{fmtE(a.pollen)}</b></> : (a.energy ?? 0) > 0 && <> · <span className="lost-text">{fmtE(a.energy)} lost</span></>}
          </span>
        )}
        {typeof a.ms === "number" && budgets && <Took ms={a.ms} limit={budgets.flower.ms} what="flower" />}
        {typeof a.beeMs === "number" && budgets && <Took ms={a.beeMs} limit={budgets.bee.ms} what="bee" />}
        {slow && <span className="slow-badge" title={a.beeError ?? undefined}><span aria-hidden>⏱</span> too slow</span>}
        {a.beeError && !slow && <span className="err-detail mono">bee: {a.beeError}</span>}
        {a.flowerError && <span className="err-detail mono">flower: {a.flowerError}</span>}
        {(a.beeVersion != null || a.flowerVersion != null) && (
          <span className="feed-versions muted" title="Which versions of the programs played this turn">
            {a.beeVersion != null ? `bee v${a.beeVersion}` : ""}{a.beeVersion != null && a.flowerVersion != null ? " · " : ""}{a.flowerVersion != null ? `flower v${a.flowerVersion}` : ""}
          </span>
        )}
      </span>
      {a.log && <pre className="bee-log feed-log" aria-label="What the bee printed" title="What the bee printed in this turn's decide, and in first and fed since its last turn">{a.log}</pre>}
    </li>
  );
});
