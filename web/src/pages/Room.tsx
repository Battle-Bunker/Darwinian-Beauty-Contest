import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { Link, navigate } from "../router";
import { useDocumentTitle, useEventStream } from "../hooks";
import { endOrMax, type RoomGame, type RoomView } from "../types";
import { rangeText } from "../components/Clock";
import { Alert, CopyButton, Progress, StatusBadge } from "../components/ui";
import { PlusIcon } from "../components/Icons";
import { fmtClock, timeAgo } from "../lib/format";
import { QueryConsole } from "../components/QueryConsole";

export function RoomPage({ room }: { room: string }) {
  useDocumentTitle(`Room ${room} · Darwinian Beauty Contest`);
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchedAt = useRef(0);
  const load = useCallback(async () => {
    try {
      const v = await api<RoomView>("GET", `/rooms/${encodeURIComponent(room)}`);
      fetchedAt.current = performance.now();
      setView(v);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [room]);

  useEffect(() => { load(); }, [load]);
  // The stream opens with {room}; every later message names the game that changed.
  useEventStream(view ? `/api/rooms/${encodeURIComponent(room)}/events` : null, (msg: { game?: string }) => { if (msg.game) load(); });
  // Running games' clocks tick here between updates (and the list refreshes now and then to stay honest).
  const running = !!view?.games.some((g) => g.status === "running");
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    const r = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [running, load]);

  const newGame = async () => {
    setBusy(true);
    try {
      const g = await api<{ shortId: string }>("POST", `/rooms/${encodeURIComponent(room)}/games`, {});
      navigate(`/room/${view?.shortId ?? room}/game/${g.shortId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (error && !view) return <div className="card narrow"><h1>Room {room}</h1><Alert kind="error">{error}</Alert><Link className="btn" to="/">Go home</Link></div>;
  if (!view) return <p className="muted">Loading room…</p>;

  const link = `${location.origin}/room/${view.shortId}`;
  const games = [...view.games].reverse();
  return (
    <div className="stack">
      <section className="card">
        <header className="card-head">
          <div>
            <h1>Room {view.shortId}</h1>
            <p className="muted">{view.isOwner ? "You own this room." : `${view.ownerName}'s room.`} Share the link so others can join.</p>
          </div>
          {view.isOwner && <button className="btn btn-big" onClick={newGame} disabled={busy}><PlusIcon /> {busy ? "Creating…" : "New game"}</button>}
        </header>
        <div className="share-row"><code className="share-link">{link}</code><CopyButton text={link} label="Copy link" /></div>
        {error && <Alert kind="error">{error}</Alert>}
      </section>

      <section className="card">
        <header className="card-head"><h2>Games</h2></header>
        {games.length === 0 ? (
          <p className="muted">{view.isOwner ? "No games yet. Press New game to start one." : "No games yet. The room owner will start one soon."}</p>
        ) : (
          <ul className="list">
            {games.map((g) => (
              <li key={g.shortId}><GameRow g={g} since={fetchedAt.current} /></li>
            ))}
          </ul>
        )}
      </section>

      {games.some((g) => g.status === "finished") && (
        <section className="card" id="query">
          <header className="card-head"><h2>Query the finished games</h2></header>
          <QueryConsole target={{ kind: "room", room: view.shortId }} />
        </section>
      )}
    </div>
  );
}

function GameRow({ g, since }: { g: RoomGame; since: number }) {
  const end = endOrMax(g), hidden = g.endMs === null;
  const clock = g.status === "running" ? Math.min(end, g.clockMs + (performance.now() - since)) : g.clockMs;
  return (
    <Link to={g.url} className="list-row game-row">
      <span className="list-main"><b>Game {g.shortId}</b><StatusBadge status={g.status} /></span>
      <span className="game-row-clock">
        <span className="mono">{g.status === "lobby" ? `${rangeText(g.minMs, g.maxMs)} game` : `${fmtClock(clock)} / ${hidden ? rangeText(g.minMs, g.maxMs) : fmtClock(end)}`}</span>
        {g.status !== "lobby" && <Progress value={clock / end} className={`row-bar bar-${g.status}`} label={hidden ? "Game time played, out of the longest the game can last" : "Game time played"} />}
      </span>
      <span className="muted">{g.teamCount} {g.teamCount === 1 ? "team" : "teams"} · created {timeAgo(g.createdAt)}</span>
    </Link>
  );
}
