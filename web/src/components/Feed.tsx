// The live action feed: every bee action as it happens, newest first, filterable by bee team, patch
// team, flower and action. Reads the page's ring of recent actions a few times a second (or holds
// still while frozen, so a row can be read while the game races on).
import { memo, useMemo, useState } from "react";
import type { Action, GameView, Team } from "../types";
import { loadEarlier, useLiveTick, type LiveStore } from "../lib/live";
import { errorText } from "../api";
import { fmtClock } from "../lib/format";
import { Value } from "./Value";
import { DropIcon, FooledIcon, PauseIcon, PlayIcon } from "./Icons";
import { Alert } from "./ui";

type ActionFilter = "" | "ask" | "feed" | "nectar" | "fooled" | "leave" | "error" | "after";
const ACTION_FILTERS: [ActionFilter, string][] = [
  ["", "every action"], ["ask", "questions"], ["after", "questions after feeding"], ["feed", "feeds"],
  ["nectar", "feeds: nectar"], ["fooled", "feeds: fooled"], ["leave", "leaves"], ["error", "mistakes and failures"],
];

interface Filters { bee: string; patch: string; kind: "" | "clover" | "orchid"; action: ActionFilter; prints: boolean }
const NONE: Filters = { bee: "", patch: "", kind: "", action: "", prints: false };

function matches(a: Action, f: Filters): boolean {
  if (f.bee && a.bee !== f.bee) return false;
  if (f.patch && a.patch !== f.patch) return false;
  if (f.kind && a.kind !== f.kind) return false;
  if (f.prints && !a.log) return false;
  switch (f.action) {
    case "": return true;
    case "ask": return a.action === "ask";
    case "after": return a.action === "ask" && !!a.after;
    case "feed": return a.action === "feed";
    case "nectar": return a.action === "feed" && !!a.nectar;
    case "fooled": return a.action === "feed" && !a.nectar;
    case "leave": return a.action === "leave";
    case "error": return a.action === "error" || !!a.error;
  }
}

const PAGE = 80;

export function Feed({ view, store, base, initial }: { view: GameView; store: LiveStore; base: string; initial?: Partial<Filters> }) {
  const g = view.game;
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const order = view.participants ?? [];
  const myTeamId = view.me?.teamId ?? null;
  const printsVisible = g.revealed || !!(myTeamId && order.includes(myTeamId));

  const [f, setF] = useState<Filters>({ ...NONE, ...initial });
  const [frozen, setFrozen] = useState<Action[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rev = useLiveTick(store, 300);
  const set = (patch: Partial<Filters>) => { setF((x) => ({ ...x, ...patch })); setLimit(PAGE); };

  const source = frozen ?? store.actions;
  const rows = useMemo(() => {
    const out: Action[] = [];
    let total = 0;
    for (let i = source.length - 1; i >= 0; i--) {
      if (!matches(source[i], f)) continue;
      total++;
      if (out.length < limit) out.push(source[i]);
    }
    return { out, total };
  }, [source, f, limit, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = f.bee || f.patch || f.kind || f.action || f.prints;
  const canLoadEarlier = g.status !== "running" && !store.complete && store.actions.length > 0;
  const earlier = async () => {
    setLoading(true); setError(null);
    try { await loadEarlier(store, base); setFrozen(null); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
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
        <label className="feed-filter"><span>at</span>{teamSelect(f.patch, (v) => set({ patch: v }), "every patch", "Patch team")}</label>
        <label className="feed-filter"><span>flower</span>
          <select value={f.kind} onChange={(e) => set({ kind: e.target.value as Filters["kind"] })} aria-label="Flower">
            <option value="">both</option><option value="clover">clover</option><option value="orchid">orchid</option>
          </select>
        </label>
        <label className="feed-filter"><span>doing</span>
          <select value={f.action} onChange={(e) => set({ action: e.target.value as ActionFilter })} aria-label="Action">
            {ACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {printsVisible && <label className="check small"><input type="checkbox" checked={f.prints} onChange={(e) => set({ prints: e.target.checked })} /> only with prints</label>}
        {filtered && <button className="link-btn small" onClick={() => set(NONE)}>clear filters</button>}
        {g.status === "running" && (
          <button className={`btn btn-small ${frozen ? "btn-honey" : "btn-ghost"} feed-freeze`} onClick={() => setFrozen(frozen ? null : store.actions.slice())} aria-pressed={!!frozen}>
            {frozen ? <><PlayIcon size={14} /> Follow live</> : <><PauseIcon size={14} /> Hold still</>}
          </button>
        )}
      </div>
      <p className="small muted feed-count">
        {rows.total.toLocaleString()} {filtered ? "matching" : ""} of the {source.length.toLocaleString()} most recent actions{store.complete ? " (the whole game)" : ""}
        {frozen && <b className="warn-text"> · held still: {(store.lastSeq - (frozen[frozen.length - 1]?.seq ?? 0)).toLocaleString()} newer actions waiting</b>}
      </p>
      {rows.out.length === 0 ? (
        <p className="muted feed-empty">{g.status === "lobby" ? "Nothing yet: the bees fly once the game starts." : source.length ? "No actions match these filters." : "No actions yet."}</p>
      ) : (
        <ol className="feed-list" aria-label="Bee actions, newest first">
          {rows.out.map((a) => <FeedRow key={a.seq} a={a} teams={teams} myTeamId={myTeamId} />)}
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

export const FeedRow = memo(function FeedRow({ a, teams, myTeamId, tenths = true, own = false }: {
  a: Action; teams: Record<string, Team>; myTeamId: string | null; tenths?: boolean; own?: boolean;
}) {
  const failed = a.action === "error" || (a.action === "ask" && a.error);
  return (
    <li className={`feed-row feed-${a.action} ${failed ? "feed-failed" : ""}`}>
      <span className="feed-time mono" title={`Action ${a.seq.toLocaleString()}: round ${a.round?.toLocaleString() ?? "?"}, at ${fmtClock(a.atMs, true)} of game time`}>
        {fmtClock(a.atMs, tenths)}{a.round != null && <span className="feed-round">r{a.round.toLocaleString()}</span>}
      </span>
      <span className="feed-who">
        {own ? <span className="muted small">your bee</span> : <Chip team={teams[a.bee]} you={a.bee === myTeamId} />}
        <span className="feed-arrow" aria-label="at">→</span>
        {own ? <span className={`kind-pill ${a.kind}`}>your {a.kind}</span> : <><Chip team={teams[a.patch]} you={a.patch === myTeamId} /><span className={`kind-pill ${a.kind}`}>{a.kind}</span></>}
      </span>
      <span className="feed-what">
        {a.action === "ask" && (
          <span className="step">
            {a.after && <span className="step-fed" title="Asked after feeding here: studying a flower whose truth the bee now knows">after feeding</span>}
            <Value v={a.c} role="challenge" max={28} /><span className="arrow">→</span>
            {a.error ? <span className="bad-text mono" title={a.error}>None</span> : <Value v={a.r} role="response" max={28} />}
            {typeof a.ms === "number" && <span className="feed-ms" title="How long the flower took to answer">{a.ms < 10 ? a.ms.toFixed(1) : Math.round(a.ms)} ms</span>}
          </span>
        )}
        {a.action === "feed" && (a.nectar
          ? <span className="ok-text nowrap"><DropIcon size={15} /> fed: <b>nectar</b></span>
          : <span className="bad-text nowrap"><FooledIcon size={15} /> fed: no nectar</span>)}
        {a.action === "leave" && <span className="muted">left{a.error ? `: ${a.error}` : ""}</span>}
        {a.action === "error" && <span className="bad-text">mistake</span>}
        {a.error && a.action !== "leave" && <span className="err-detail mono">{a.by && a.by !== "bee" ? `${a.by}: ` : ""}{a.error}</span>}
        {(a.beeVersion != null || a.flowerVersion != null) && (
          <span className="feed-versions muted" title="Which versions of the programs played">
            {a.beeVersion != null ? `bee v${a.beeVersion}` : ""}{a.beeVersion != null && a.flowerVersion != null ? " · " : ""}{a.flowerVersion != null ? `${a.kind} v${a.flowerVersion}` : ""}
          </span>
        )}
      </span>
      {a.log && <pre className="bee-log feed-log" aria-label="What the bee printed">{a.log}</pre>}
    </li>
  );
});
