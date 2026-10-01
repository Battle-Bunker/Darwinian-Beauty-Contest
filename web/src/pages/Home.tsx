import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { useMe } from "../auth";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../hooks";
import type { MyRoom } from "../types";
import { Alert } from "../components/ui";
import { BeeGlyph, FlowerHead, PlusIcon } from "../components/Icons";
import { timeAgo } from "../lib/format";

export function HomePage() {
  useDocumentTitle("Darwinian Beauty Contest");
  const { user } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);

  useEffect(() => {
    api<{ rooms: MyRoom[] }>("GET", "/my/rooms").then((r) => setRooms(r.rooms)).catch(() => setRooms([]));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api<{ shortId: string }>("POST", "/rooms");
      navigate(`/room/${room.shortId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="hero card">
        <div className="hero-text">
          <h1>Hi {user.name}! Welcome to the garden.</h1>
          <p>
            Real flowers and bees are in an arms race. Some flowers pay bees with nectar; others, like the
            bee orchid, only <em>look</em> like a good deal. Your team writes three little programs and lets evolution sort it out.
          </p>
          <button className="btn btn-big" onClick={create} disabled={busy}><PlusIcon /> {busy ? "Planting…" : "Create room"}</button>
          {error && <Alert kind="error">{error}</Alert>}
        </div>
        <div className="hero-cards">
          <div className="mini-card"><FlowerHead color="#7a9e3f" size={34} /><div><b>Clover</b><span>an honest flower: bees that feed here get nectar</span></div></div>
          <div className="mini-card"><FlowerHead color="#9b5de5" size={34} /><div><b>Orchid</b><span>a trickster: looks tasty, pays nothing</span></div></div>
          <div className="mini-card"><BeeGlyph color="#f2a541" size={36} /><div><b>Bee</b><span>asks flowers questions and decides where to feed</span></div></div>
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h2>Your rooms</h2></header>
        {rooms === null ? <p className="muted">Loading…</p> : rooms.length === 0 ? (
          <p className="muted">No rooms yet. Create one, or open a room link a friend shared with you.</p>
        ) : (
          <ul className="list">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link to={r.url} className="list-row">
                  <span className="list-main"><b>Room {r.shortId}</b>{r.isOwner ? <span className="badge badge-lobby">yours</span> : <span className="muted">by {r.ownerName}</span>}</span>
                  <span className="muted">{r.gameCount} {r.gameCount === 1 ? "game" : "games"} · {timeAgo(r.lastActivity || r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
