// Private play (game.restricted): what your team sees of the garden while a private game runs. Only your own
// programs' sides of your turns, never who was on the other side: your flower's (the challenge, its hidden budget
// R, its answer and percent, its CPU time and errors; not which bee came, nor whether it fed) and your bee's (the
// challenge, the answer, its decision, the nectar fed() got, the price, the balance after it, the pollen grain,
// bare; not which species answered). Your bee at your own flower shows up once on each side. Spectators see
// nothing here until the game is over; everyone sees the prevalence snapshots (Scores).
import { useMemo } from "react";
import type { Action, GameView } from "../types";
import { useLiveTick, type LiveStore } from "../lib/live";
import { fmtClock, fmtE, fmtMs } from "../lib/format";
import { Value } from "./Value";

const SHOW = 60;

export function PrivateTurns({ view, store }: { view: GameView; store: LiveStore }) {
  const rev = useLiveTick(store, 400);
  const myTeamId = view.myTeam?.id ?? null;
  const playing = !!myTeamId && !!view.participants?.includes(myTeamId);
  const every = view.game.config.prevalenceEveryS ?? 30;
  const rows = useMemo(() => {
    const out: Action[] = [];
    for (let i = store.actions.length - 1; i >= 0 && out.length < SHOW; i--) {
      const a = store.actions[i];
      if (a.side === "flower" || a.side === "bee") out.push(a);
    }
    return out;
  }, [store, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    let flower = 0, bee = 0, feeds = 0;
    for (const a of store.actions) {
      if (a.side === "flower") flower++;
      else if (a.side === "bee") { bee++; if (a.action === "feed") feeds++; }
    }
    return { flower, bee, feeds };
  }, [store, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const note = (
    <p className="small muted">
      <b>Private play.</b> Until the game ends, each team sees only what its own programs see: its flower's visits
      (never which bee came, nor whether it fed) and its bee's turns (never which species answered), its own pollen
      grains, and everyone's prevalence every {every} s of game time, rounded (the scores). Arrivals, other teams' turns
      and the ledgers are revealed when the game is over.
    </p>
  );
  if (!playing) return <div className="stack">{note}<p className="muted">You're watching: there's nothing more to see until the game ends.</p></div>;
  return (
    <div className="stack">
      {note}
      <p className="small">
        Your flower answered <b>{counts.flower.toLocaleString()}</b> visits; your bee took <b>{counts.bee.toLocaleString()}</b> turns and fed <b>{counts.feeds.toLocaleString()}</b> times
        <span className="muted"> (of those held on this page; the newest {SHOW} below).</span>
      </p>
      {rows.length === 0 ? <p className="muted">No turns yet.</p> : (
        <div className="table-scroll">
          <table className="data-table private-turns">
            <thead>
              <tr>
                <th className="left">When</th><th className="left">Whose</th><th className="left">Challenge</th><th className="left">Response</th>
                <th title="Your flower: the share it offered. Your bee: what it decided.">Percent / decision</th>
                <th title="Your bee's feeds: the nectar fed() got, the price, and the balance after">Nectar · price · balance</th>
                <th title="Your flower: its CPU time of its hidden budget R. Your bee: its decision time.">Time</th>
                <th className="left">Grain / error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={`${a.seq}:${a.side}`}>
                  <td className="mono small">{fmtClock(a.atMs, true)} <span className="muted">r{a.round}</span></td>
                  <td>{a.side === "flower" ? "your flower" : "your bee"}</td>
                  <td className="left"><Value v={a.c} role="challenge" /></td>
                  <td className="left">{a.rHash ? <span className="muted small">{(a.rBytes ?? 0).toLocaleString()} bytes</span> : <Value v={a.r} role="response" />}</td>
                  <td>{a.side === "flower" ? (typeof a.percent === "number" ? `${a.percent}%` : "–") : <b>{a.action}</b>}</td>
                  <td className="small">{a.side === "bee" && a.action === "feed" ? `${fmtE(a.nectar)} · ${fmtE(a.price)}${typeof a.balance === "number" ? ` · ${fmtE(a.balance)}` : ""}` : ""}</td>
                  <td className="small">{a.side === "flower" ? (typeof a.ms === "number" ? `${fmtMs(a.ms)} of ${typeof a.budgetMs === "number" ? fmtMs(a.budgetMs) : "?"}` : "–") : (typeof a.beeMs === "number" ? fmtMs(a.beeMs) : "–")}</td>
                  <td className="left small">
                    {a.side === "bee" && a.grain ? <code className="grain">{a.grain}</code> : null}
                    {(a.side === "flower" ? a.flowerError : a.beeError) ? <span className="warn-text">{a.side === "flower" ? a.flowerError : a.beeError}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
