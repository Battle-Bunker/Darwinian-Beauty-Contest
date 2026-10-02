// One page for a game, from the lobby to long after it's over. The view (teams, programs, scores) is
// refetched whenever the game's version moves, its status changes or my team's programs change; while it
// runs, the live numbers (scores, ledgers, clock, round) come from the light /scores endpoint every
// second or so. The actions stream in over SSE into a bounded ring (lib/live.ts) that the garden, the
// feed and the clock read at their own pace.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, gameBase } from "../api";
import { Link } from "../router";
import { useDocumentTitle } from "../hooks";
import type { GameView, Kind, ScoresView } from "../types";
import { LiveStore, useGameStream, useLiveTick } from "../lib/live";
import { Alert, CopyButton, Section, StatusBadge } from "../components/ui";
import { Garden } from "../components/Garden";
import { OwnerControls, SettingsForm, SettingsSummary } from "../components/OwnerPanel";
import { TeamsPanel } from "../components/Teams";
import { ProgramEditors } from "../components/ProgramEditors";
import { Podium, Scores } from "../components/Scores";
import { Feed } from "../components/Feed";
import { GameClock } from "../components/Clock";
import { ChangeTimeline, historyTeams, VersionBrowser } from "../components/History";
import { ValueTypes } from "../components/Value";

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
      scores: live.scores, recent: live.recent, ledgers: live.ledgers,
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

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];
  const garden = { id: "garden", label: "Garden", node: <Section id="garden" title="The garden" className="garden-card"><Garden view={view} store={store} /></Section> };
  const teams = { id: "teams", label: "Teams", node: <Section id="teams" title={`Teams (${view.teams.length})`}><TeamsPanel view={view} base={base} /></Section> };
  const programs = showEditors ? {
    id: "programs", label: "Your programs",
    node: (
      <Section id="programs" title={lobby ? "Your programs" : "Your programs: change them while the game runs"}>
        <ProgramEditors key={`${cfg.language}:${cfg.challengeType}:${cfg.responseType}:${myTeamId}`} view={view} base={base} store={store} />
      </Section>
    ),
  } : null;
  const scores = !lobby && view.scores ? { id: "scores", label: "Scores", node: <Section id="scores" title={over ? "Final scores" : "Scores"}><Scores view={view} /></Section> } : null;
  const feed = !lobby ? {
    id: "feed", label: over ? "Actions" : "Live actions",
    node: <Section id="feed" title={over ? "Every action" : "Live actions"}><Feed view={view} store={store} base={base} /></Section>,
  } : null;
  const changes = live && playing ? { id: "changes", label: "Your changes", node: <Section id="changes" title="Your team's changes"><MyChanges view={view} store={store} /></Section> } : null;
  const replay = over && historyTeams(view).length ? { id: "replay", label: "Changes", node: <Section id="replay" title="Who changed what, when"><Replay view={view} /></Section> } : null;

  if (lobby) sections.push(teams, ...(programs ? [programs] : []), garden);
  else if (live) sections.push(garden, ...[programs, scores, feed, changes, teams].filter((x): x is NonNullable<typeof x> => !!x));
  else sections.push(...[scores, replay, feed, teams].filter((x): x is NonNullable<typeof x> => !!x));

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

/** After the game: every team's changes over the game, and their code if revealed. */
function Replay({ view }: { view: GameView }) {
  const teams = historyTeams(view);
  const [picked, setPicked] = useState<{ team: string; kind: Kind; version: number } | null>(null);
  return (
    <div className="stack">
      <ChangeTimeline view={view} teams={teams} endMs={view.game.clockMs} picked={picked} onPick={(team, kind, version) => { setPicked({ team, kind, version }); document.getElementById("versions")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} />
      <h3 id="versions">{view.game.revealed ? "Code, version by version" : "Versions"}</h3>
      <VersionBrowser view={view} teams={teams} picked={picked} onPick={setPicked} />
    </div>
  );
}
