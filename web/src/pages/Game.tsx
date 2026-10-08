// One page for a game, from the lobby to long after it's over. The view (teams, programs, scores) is
// refetched whenever the game's version moves, its status changes or my team's programs change; while it
// runs, the live numbers (scores, ledgers, clock, round) come from the light /scores endpoint every
// second or so. Actions stream in over a WebSocket (or SSE) into a bounded ring (lib/live.ts) that the
// garden, the feed and the clock read at their own pace; my team's ledger follows GET /ledger. Once the
// game is over the whole history is loaded for the replay.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, gameBase } from "../api";
import { Link } from "../router";
import { useDocumentTitle } from "../hooks";
import { energyUnitOf, type GameView, type Kind, type ScoresView } from "../types";
import { setEnergyUnit } from "../lib/format";
import { LiveStore, useGameStream, useLiveTick } from "../lib/live";
import { useHistory, useLedger, type HistoryStore, type LedgerStore } from "../lib/history";
import { Alert, CopyButton, Section, StatusBadge } from "../components/ui";
import { LiveGarden } from "../components/Garden";
import { Replay } from "../components/Replay";
import { OwnerControls, SettingsForm, SettingsSummary } from "../components/OwnerPanel";
import { TeamsPanel } from "../components/Teams";
import { ProgramEditors } from "../components/ProgramEditors";
import { Podium, Scores } from "../components/Scores";
import { Feed } from "../components/Feed";
import { LedgerPanel } from "../components/Ledger";
import { GameClock, roundLine } from "../components/Clock";
import { TimingTable } from "../components/Timing";
import { ChangeTimeline, historyTeams, VersionBrowser } from "../components/History";
import { ValueTypes } from "../components/Value";
import { QueryConsole } from "../components/QueryConsole";
import { PollenPanel, type GrainRec } from "../components/Pollen";

const SCORES_MS = 1500; // how often to poll the live numbers while the game runs

export function GamePage({ room, game }: { room: string; game: string }) {
  useDocumentTitle(`Game ${game} · Room ${room} · Darwinian Beauty Contest`);
  const base = gameBase(room, game);
  const store = useMemo(() => new LiveStore(), []);
  const [view, setView] = useState<GameView | null>(null);
  const [live, setLive] = useState<ScoresView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback((v: GameView) => {
    store.syncClock(v.game.clockMs, v.game.status, v.game.endMs, v.game.round);
    setEnergyUnit(energyUnitOf(v.game.config)); // before anything of this game is shown
    setView(v);
  }, [store]);

  // Coalesced loading: at most one request in flight, plus one queued.
  const inflight = useRef(false);
  const queued = useRef(false);
  const load = useCallback(async () => {
    if (inflight.current) { queued.current = true; return; }
    inflight.current = true;
    try {
      do {
        queued.current = false;
        accept(await api<GameView>("GET", base));
        setError(null);
      } while (queued.current);
    } catch (e) {
      setError(errorText(e));
    } finally {
      inflight.current = false;
    }
  }, [base, accept]);
  useEffect(() => { load(); }, [load]);

  const versionRef = useRef<number | undefined>(undefined);
  versionRef.current = view?.game.version;
  useGameStream(store, view ? base : null, (v) => { if (v === -1 || v !== versionRef.current) load(); });

  // Scores and ledgers change with every feed but don't move the version: poll them while it runs.
  const status = view?.game.status;
  useEffect(() => {
    if (status !== "running") return;
    let busy = false;
    const poll = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const s = await api<ScoresView>("GET", `${base}/scores`);
        store.syncClock(s.clockMs, s.status, s.endMs, s.round);
        setLive(s);
        if (s.status !== status) load();
      } catch { /* the next poll will do */ } finally { busy = false; }
    };
    const t = setInterval(poll, SCORES_MS);
    return () => clearInterval(t);
  }, [status, load, base, store]);

  // The view with the newest live numbers folded in (they're consistent among themselves: one moment).
  const merged = useMemo<GameView | null>(() => {
    if (!view || !live || live.lastSeq <= view.game.lastSeq || !live.scores) return view;
    return {
      ...view,
      scores: live.scores, ledgers: live.ledgers,
      game: { ...view.game, clockMs: live.clockMs, round: live.round, lastSeq: live.lastSeq },
    };
  }, [view, live]);

  if (error && !view) return <div className="card narrow"><h1>Game {game}</h1><Alert kind="error">{error}</Alert><Link className="btn" to={`/room/${room}`}>Back to the room</Link></div>;
  if (!view || !merged) return <p className="muted">Loading the garden…</p>;
  return <GameBody view={merged} base={base} store={store} />;
}

function GameBody({ view, base, store }: { view: GameView; base: string; store: LiveStore }) {
  const g = view.game;
  const cfg = g.config;
  const lobby = g.status === "lobby";
  const live = g.status === "running" || g.status === "paused";
  const over = g.status === "finished";
  const link = `${location.origin}${g.url}`;
  const myTeamId = view.myTeam?.id ?? null;
  const playing = !!myTeamId && !!view.participants?.includes(myTeamId);
  const showEditors = !!view.myTeam && (lobby || live);

  // My team's ledger: followed from the start of play for team members (the garden shows what their flower
  // has lost); for spectators and after the game, once its panel is opened.
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledger = useLedger(base, (live && playing) || ledgerOpen, g.status, myTeamId ?? "");
  const history = useHistory(base, view.participants, cfg.budgets.flower.ms, over);
  const myIndex = myTeamId ? (view.participants ?? []).indexOf(myTeamId) : -1;
  const wasted = useWasted(ledger, myIndex);

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];
  const garden = { id: "garden", label: "Garden", node: <Section id="garden" title="The garden" className="garden-card"><LiveGarden view={view} store={store} wasted={wasted} /></Section> };
  const teams = { id: "teams", label: "Teams", node: <Section id="teams" title={`Teams (${view.teams.length})`}><TeamsPanel view={view} base={base} /></Section> };
  const programs = showEditors ? {
    id: "programs", label: "Your programs",
    node: (
      <Section id="programs" title={lobby ? "Your programs" : "Your programs: change them while the game runs"}>
        <ProgramEditors key={`${cfg.language}:${cfg.challengeType}:${cfg.responseType}:${myTeamId}`} view={view} base={base} store={store} />
      </Section>
    ),
  } : null;
  const scores = !lobby && view.scores ? { id: "scores", label: "Scores", node: <Section id="scores" title={over ? "Final scores" : "Scores, live"}><Scores view={view} /></Section> } : null;
  const feed = !lobby && (!over || history) ? {
    id: "feed", label: over ? "Every turn" : "Live turns",
    node: <Section id="feed" title={over ? "Every turn" : "Live turns"}><Feed view={view} source={over && history ? history : store} base={base} /></Section>,
  } : null;
  const ledgerSec = !lobby ? {
    id: "ledger", label: myTeamId && playing ? "Your ledger" : "Ledger",
    node: (
      <Section id="ledger" title={myTeamId && playing ? "Your team's ledger" : "The ledger"}>
        {(live && playing) ? (ledger && <LedgerPanel view={view} ledger={ledger} />) : (
          <details className="ledger-details" open={ledgerOpen} onToggle={(e) => setLedgerOpen(e.currentTarget.open)}>
            <summary>{over ? "Show the whole ledger: every turn, every field" : "Show the ledger as a spectator sees it"}</summary>
            {ledger && <LedgerPanel view={view} ledger={ledger} />}
          </details>
        )}
      </Section>
    ),
  } : null;
  const pollen = live && playing && (cfg.grains ?? "feeder") !== "off" && ledger ? {
    id: "pollen", label: "Pollen collected",
    node: <Section id="pollen" title="Pollen collected"><LivePollen view={view} ledger={ledger} myIndex={myIndex} /></Section>,
  } : null;
  const changes = live && playing ? { id: "changes", label: "Your changes", node: <Section id="changes" title="Your team's changes"><MyChanges view={view} store={store} /></Section> } : null;
  const replay = over && history ? { id: "replay", label: "Replay", node: <Section id="replay" title="Replay" className="garden-card"><Replay view={view} history={history} /></Section> } : null;
  const versions = over && history && historyTeams(view).length ? { id: "versions", label: "Changes", node: <Section id="versions" title="Who changed what, when"><Versions view={view} history={history} /></Section> } : null;

  const orderTeams = (view.participants ?? []).map((pid) => view.teams.find((t) => t.id === pid)!).filter(Boolean);
  const query = !lobby ? {
    id: "query", label: "Query",
    node: (
      <Section id="query" title="Query the history">
        <QueryConsole target={{ kind: "game", room: view.room.shortId, game: g.shortId, teams: orderTeams, myIndex: myIndex >= 0 ? myIndex : null }} />
      </Section>
    ),
  } : null;
  const present = <T,>(x: T | null): x is T => !!x;
  if (lobby) sections.push(teams, ...(programs ? [programs] : []), garden);
  else if (live) sections.push(garden, ...[programs, scores, feed, ledgerSec, pollen, changes, query, teams].filter(present));
  else sections.push(...[replay, scores, versions, feed, ledgerSec, query, teams].filter(present));
  return (
    <ValueTypes.Provider value={{ challenge: cfg.challengeType, response: cfg.responseType }}>
      <div className="stack game-page">
        <section className="card game-head">
          <div className="game-head-main">
            <div className="game-title">
              <h1>Game {g.shortId}</h1>
              <StatusBadge status={g.status} />
              {g.revealed && <span className="badge badge-done">all code revealed</span>}
            </div>
            <p className="muted small">
              In <Link to={`/room/${view.room.shortId}`}>room {view.room.shortId}</Link>.
              {view.myTeam ? ` You're on ${view.myTeam.name}${live && !playing ? ", which is sitting this game out" : ""}.` : lobby ? " Start or join a team below to play." : " You're watching."}
            </p>
            <div className="share-row"><code className="share-link">{link}</code><CopyButton text={link} label="Copy link" /></div>
            <p className="small muted round-line">{roundLine(view)}</p>
            {!(g.isOwner && lobby) && (
              <details className="settings-details">
                <summary>Game settings</summary>
                <SettingsSummary cfg={cfg} />
              </details>
            )}
          </div>
          <GameClock store={store} view={view} />
          <nav className="jump" aria-label="Jump to">
            {sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.label}</a>)}
          </nav>
          {!g.isOwner && g.lastError && <Alert kind="error"><b>The garden stopped with an error:</b> {g.lastError}</Alert>}
        </section>

        {over && view.scores && (
          <Section title="Final standings">
            <Podium view={view} final={view.scores} />
          </Section>
        )}

        {g.isOwner && (
          <Section id="owner" title="Room owner controls" className="owner-card">
            <OwnerControls view={view} base={base} />
            {lobby && (
              <details className="settings-details" open>
                <summary>Game settings</summary>
                <SettingsForm view={view} base={base} />
              </details>
            )}
          </Section>
        )}

        {sections.map((s) => <div key={s.id} className="section-slot">{s.node}</div>)}
      </div>
    </ValueTypes.Provider>
  );
}

/** Energy my flower has lost on visits where the bee didn't feed (from my ledger; only my team sees it during play). */
function useWasted(ledger: LedgerStore | null, me: number): number | null {
  const [state] = useState(() => ({ n: 0, sum: 0, store: null as LedgerStore | null }));
  const dummy = useMemo(() => ({ rev: 0, subscribe: () => () => {} }), []);
  useLiveTick(ledger ?? dummy, 1000);
  if (!ledger || me < 0 || ledger.team !== me) return null;
  if (state.store !== ledger) { state.store = ledger; state.n = 0; state.sum = 0; }
  const es = ledger.entries;
  for (; state.n < es.length; state.n++) {
    const e = es[state.n];
    if (e.flower === me && !e.fed && typeof e.energy === "number") state.sum += e.energy;
  }
  return state.sum;
}

/** During play: the grains my team's bee has collected (everyone's, if grains are public), from my ledger. */
function LivePollen({ view, ledger, myIndex }: { view: GameView; ledger: LedgerStore; myIndex: number }) {
  const rev = useLiveTick(ledger, 2000);
  const teams = useMemo(() => (view.participants ?? []).map((id) => view.teams.find((t) => t.id === id)!).filter(Boolean), [view.participants, view.teams]);
  const grains = useMemo(() => {
    const out: GrainRec[] = [];
    for (const e of ledger.entries) {
      if (e.fed && typeof e.grain === "string") out.push({ bee: e.bee, flower: e.flower, version: e.grainVersion ?? 0, grain: e.grain, codeLength: e.grainCodeLength ?? e.grain.length, round: e.round });
    }
    return out;
  }, [ledger, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PollenPanel view={view} teams={teams} grains={grains} mine={myIndex >= 0 ? myIndex : null} during />;
}

/** During play: my team's own change timeline (with its budgets) and versions. */
function MyChanges({ view, store }: { view: GameView; store: LiveStore }) {
  useLiveTick(store, 1000, view.game.status === "running");
  const mine = view.teams.filter((t) => t.id === view.myTeam?.id && t.programs);
  const [picked, setPicked] = useState<{ team: string; kind: Kind; version: number } | null>(null);
  if (!mine.length) return null;
  return (
    <div className="stack">
      <p className="small muted">Only your team sees this until the game ends; then every team's changes are revealed.</p>
      <ChangeTimeline view={view} teams={mine} endMs={Math.max(1000, store.now())} picked={picked} onPick={(team, kind, version) => setPicked({ team, kind, version })} />
      <VersionBrowser view={view} teams={mine} picked={picked} onPick={setPicked} />
    </div>
  );
}

/** After the game: every team's changes and change budgets over the game, their code if revealed, and timings. */
function Versions({ view, history }: { view: GameView; history: HistoryStore }) {
  useLiveTick(history, 1000);
  const teams = historyTeams(view);
  const [picked, setPicked] = useState<{ team: string; kind: Kind; version: number } | null>(null);
  return (
    <div className="stack">
      <ChangeTimeline view={view} teams={teams} endMs={view.game.clockMs} picked={picked} onPick={(team, kind, version) => { setPicked({ team, kind, version }); document.getElementById("version-code")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} />
      <h3 id="version-code">{view.game.revealed ? "Code, version by version" : "Versions"}</h3>
      <VersionBrowser view={view} teams={teams} picked={picked} onPick={setPicked} />
      <h3>How long programs took</h3>
      <p className="small muted">Typical time / the slowest 10%, against each limit, and how often each missed it (⏱), over {history.done ? "the whole game" : `the ${history.actions.length.toLocaleString()} actions loaded so far`}. The flower's is CPU time, which sets its energy. Private during play; everyone's now.</p>
      <TimingTable view={view} actions={history.actions} />
    </div>
  );
}
