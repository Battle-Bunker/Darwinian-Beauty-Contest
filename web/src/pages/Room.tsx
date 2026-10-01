import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api";
import { Link, navigate } from "../router";
import { useDocumentTitle, useEventStream } from "../hooks";
import type { RoomView } from "../types";
import { Alert, CopyButton, StatusBadge } from "../components/ui";
import { PlusIcon } from "../components/Icons";
import { timeAgo } from "../lib/format";

export function RoomPage({ room }: { room: string }) {
  useDocumentTitle(`Room ${room} · Darwinian Beauty Contest`);
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api<RoomView>("GET", `/rooms/${encodeURIComponent(room)}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [room]);

  useEffect(() => { load(); }, [load]);
  useEventStream(view ? `/api/rooms/${encodeURIComponent(room)}/events` : null, () => { load(); });

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
              <li key={g.id}>
                <Link to={g.url} className="list-row">
                  <span className="list-main"><b>Game {g.shortId}</b><StatusBadge status={g.status} roundsPlayed={g.roundsPlayed} rounds={g.rounds} /></span>
                  <span className="muted">{g.teamCount} {g.teamCount === 1 ? "team" : "teams"} · {g.roundsPlayed}/{g.rounds} rounds · {timeAgo(g.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
