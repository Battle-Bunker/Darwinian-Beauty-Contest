// One page for a game, live or years later: it always loads the current view (every round so far)
// and refetches whenever the game's version moves (SSE). Rounds can have thousands of visits, so the
// page loads the latest round's visits with the view and fetches other rounds when they're selected.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, gameBase } from "../api";
import { Link } from "../router";
import { useDocumentTitle, useEventStream } from "../hooks";
import type { GameView, Round } from "../types";
import { Alert, CopyButton, Section, StatusBadge } from "../components/ui";
import { Garden, type GardenStart } from "../components/Garden";
import { RunRound, SettingsForm, SettingsSummary } from "../components/OwnerPanel";
import { TeamsPanel } from "../components/Teams";
import { ProgramEditors } from "../components/ProgramEditors";
import { Podium, Scores } from "../components/Scores";
import { CodeBrowser, Logs, visibleTeams } from "../components/Logs";
import { ValueTypes } from "../components/Value";

export function GamePage({ room, game }: { room: string; game: string }) {
  useDocumentTitle(`Game ${game} · Room ${room} · Darwinian Beauty Contest`);
  const base = gameBase(room, game);
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Which round the garden, scores and logs show. A new round arriving live auto-plays.
  const [selected, setSelected] = useState<number | null>(null);
  const [gardenStart, setGardenStart] = useState<GardenStart>("start");
  const [nonce, setNonce] = useState(0);
  const [toast, setToast] = useState<number | null>(null);
  const latestSeen = useRef<number | null>(null);

  // Rounds with their visits, by number. What a viewer may see changes when they join a team or the
  // game is revealed, so the cache is scoped to that.
  const roundCache = useRef(new Map<number, Round>());
  const cacheScope = useRef("");
  const fetching = useRef(new Set<number>());
  const [, setCacheVer] = useState(0);
  const [roundError, setRoundError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const accept = useCallback((v: GameView) => {
    const scope = `${v.game.revealed}:${v.me?.teamId ?? ""}`;
    if (scope !== cacheScope.current) { roundCache.current.clear(); cacheScope.current = scope; }
    for (const r of v.rounds) if (r.visits) roundCache.current.set(r.no, r);
    const latest = v.rounds.length ? v.rounds[v.rounds.length - 1].no : 0;
    if (latestSeen.current === null) {
      latestSeen.current = latest;
      setSelected(latest || null);
      setGardenStart(v.game.status === "finished" ? "end" : "start");
    } else if (latest > latestSeen.current) {
      latestSeen.current = latest;
      setSelected(latest);
      setGardenStart("play");
      setNonce((n) => n + 1);
      const r = document.getElementById("garden")?.getBoundingClientRect();
      if (r && (r.bottom < 80 || r.top > window.innerHeight - 120)) setToast(latest);
    }
    setView(v);
  }, []);

  // Coalesced loading: at most one request in flight, plus one queued.
  const inflight = useRef(false);
  const queued = useRef(false);
  const load = useCallback(async () => {
    if (inflight.current) { queued.current = true; return; }
    inflight.current = true;
    try {
      do {
        queued.current = false;
        const visits = firstLoad.current ? "last" : "none";
        firstLoad.current = false;
        accept(await api<GameView>("GET", `${base}?visits=${visits}`));
        setError(null);
      } while (queued.current);
    } catch (e) {
      setError(errorText(e));
    } finally {
      inflight.current = false;
    }
  }, [base, accept]);
  useEffect(() => { load(); }, [load]);

  const ensureRound = useCallback(async (no: number) => {
    if (roundCache.current.has(no) || fetching.current.has(no)) return;
    fetching.current.add(no);
    try {
      const scope = cacheScope.current;
      const r = await api<Round>("GET", `${base}/rounds/${no}`);
      if (scope === cacheScope.current) roundCache.current.set(no, r);
      setRoundError(null);
      setCacheVer((x) => x + 1);
    } catch (e) {
      setRoundError(errorText(e));
    } finally {
      fetching.current.delete(no);
    }
  }, [base]);
  const wanted = selected ?? (view?.rounds.length ? view.rounds[view.rounds.length - 1].no : null);
  useEffect(() => { if (view && wanted !== null && !roundCache.current.has(wanted)) ensureRound(wanted); }, [view, wanted, ensureRound]);

  const version = view?.game.version;
  const versionRef = useRef<number | undefined>(undefined);
  versionRef.current = version;
  useEventStream(view ? `/api${base}/events` : null, (msg: { version?: number }) => {
    if (typeof msg.version === "number" && msg.version !== versionRef.current) load();
  });

  const selectRound = (no: number) => { setSelected(no); setGardenStart("play"); setNonce((n) => n + 1); };
  const watchToast = () => {
    setToast(null);
    setGardenStart("play");
    setNonce((n) => n + 1);
    document.getElementById("garden")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 15000);
    return () => clearTimeout(t);
  }, [toast]);

  if (error && !view) return <div className="card narrow"><h1>Game {game}</h1><Alert kind="error">{error}</Alert><Link className="btn" to={`/room/${room}`}>Back to the room</Link></div>;
  if (!view) return <p className="muted">Loading the garden…</p>;

  const g = view.game;
  const cfg = g.config;
  const lobby = g.status === "lobby";
  const round = view.rounds.find((r) => r.no === selected) ?? view.rounds[view.rounds.length - 1] ?? null;
  const full = round ? roundCache.current.get(round.no) ?? null : null; // the same round, with its visits
  const roundNos = view.rounds.map((r) => r.no);
  const link = `${location.origin}${g.url}`;
  const canEdit = !!view.myTeam && g.status !== "finished";
  const hasLogs = visibleTeams(view).length > 0;

  const garden = (
    <Section id="garden" title={round ? `The garden: round ${round.no}` : "The garden"} className="garden-card">
      <Garden key={`${round?.no ?? 0}:${nonce}:${full ? 1 : 0}`} view={view} round={full} start={gardenStart} rounds={roundNos}
        onSelectRound={selectRound} loading={round && !full ? round.no : false} />
      {roundError && <Alert kind="error">Couldn't load that round: {roundError}</Alert>}
    </Section>
  );
  const teams = (
    <Section id="teams" title={`Teams (${view.teams.length})`}>
      <TeamsPanel view={view} base={base} />
    </Section>
  );
  const programs = canEdit ? (
    <Section id="programs" title={`Your programs for round ${g.roundsPlayed + 1}`}>
      <ProgramEditors key={`${g.roundsPlayed}:${cfg.language}:${cfg.challengeType}:${cfg.responseType}:${view.myTeam!.id}`} view={view} base={base} />
    </Section>
  ) : null;
  const scores = round ? (
    <Section id="scores" title={`Scores after round ${round.no}`}>
      <Scores view={view} round={round} />
    </Section>
  ) : null;
  const logs = round && hasLogs ? (
    <Section id="logs" title={`${g.revealed ? "Logs" : "Your team's private logs"}: round ${round.no}`}>
      <Logs key={round.no} view={view} round={full ?? round} base={base} />
    </Section>
  ) : null;
  const code = round && hasLogs ? (
    <Section id="code" title={`${g.revealed ? "Everyone's code" : "Your team's code"}: round ${round.no}`}>
      <CodeBrowser view={view} round={round} />
    </Section>
  ) : null;

  return (
    <ValueTypes.Provider value={{ challenge: cfg.challengeType, response: cfg.responseType }}>
    <div className="stack game-page">
      <section className="card game-head">
        <div className="game-title">
          <h1>Game {g.shortId}</h1>
          <StatusBadge status={g.status} roundsPlayed={g.roundsPlayed} rounds={cfg.rounds} running={g.runningRound} />
          {g.revealed && <span className="badge badge-done">all code revealed</span>}
        </div>
        <p className="muted small">
          In <Link to={`/room/${view.room.shortId}`}>room {view.room.shortId}</Link>. Round {Math.min(g.roundsPlayed + (g.status === "finished" ? 0 : 1), cfg.rounds)} of {cfg.rounds}.
          {view.myTeam ? ` You're on ${view.myTeam.name}.` : lobby ? " Start or join a team below to play." : ""}
        </p>
        <div className="share-row"><code className="share-link">{link}</code><CopyButton text={link} label="Copy link" /></div>
        {!(g.isOwner && lobby) && (
          <details className="settings-details">
            <summary>Game settings</summary>
            <SettingsSummary cfg={cfg} turnsNow={g.turns} />
          </details>
        )}
        <nav className="jump" aria-label="Jump to">
          {lobby ? <><a href="#teams">Teams</a>{programs && <a href="#programs">Programs</a>}<a href="#garden">Garden</a></>
            : <><a href="#garden">Garden</a>{scores && <a href="#scores">Scores</a>}{programs && <a href="#programs">Programs</a>}{logs && <a href="#logs">Logs</a>}<a href="#teams">Teams</a>{code && <a href="#code">Code</a>}</>}
        </nav>
        {!g.isOwner && g.lastError && <Alert kind="error"><b>The last round didn't run:</b> {g.lastError}</Alert>}
      </section>

      {g.status === "finished" && view.final && (
        <Section title="Final standings">
          <Podium view={view} final={view.final} />
        </Section>
      )}

      {g.isOwner && (
        <Section id="owner" title="Room owner controls" className="owner-card">
          <RunRound view={view} base={base} />
          {lobby && !g.runningRound && (
            <details className="settings-details" open>
              <summary>Game settings</summary>
              <SettingsForm view={view} base={base} />
            </details>
          )}
        </Section>
      )}

      {lobby ? <>{teams}{programs}{garden}</> : <>{garden}{scores}{programs}{logs}{teams}{code}</>}

      {toast !== null && (
        <div className="toast" role="status">
          <span>Round {toast} is in!</span>
          <button className="btn btn-honey btn-small" onClick={watchToast}>Watch the bees</button>
          <button className="icon-btn small" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
    </ValueTypes.Provider>
  );
}
