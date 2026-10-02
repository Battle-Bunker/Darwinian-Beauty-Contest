// The game clock: game time interpolated locally between server updates while the game runs.
import type { GameView } from "../types";
import { useLiveTick, type LiveStore } from "../lib/live";
import { fmtClock } from "../lib/format";
import { Progress } from "./ui";

/** Short games (a minute or less) show tenths of a second. */
export const showTenths = (endMs: number) => endMs <= 60_000;

export function GameClock({ store, view }: { store: LiveStore; view: GameView }) {
  const g = view.game;
  useLiveTick(store, showTenths(g.endMs) ? 100 : 250, g.status === "running");
  const now = g.status === "lobby" ? 0 : Math.min(g.endMs, Math.max(g.clockMs, store.now()));
  const tenths = showTenths(g.endMs);
  const left = Math.max(0, g.endMs - now);
  const early = g.status === "finished" && now < g.endMs - 1000;
  return (
    <div className={`clock clock-${g.status}`} aria-live="off">
      <div className="clock-main">
        <span className="clock-now">{fmtClock(now, tenths)}</span>
        <span className="clock-of">/ {fmtClock(g.endMs)}</span>
      </div>
      <Progress value={now / g.endMs} className="clock-bar" label="Game time played" />
      <div className="clock-note small">
        {g.status === "lobby" && <span className="muted">The clock starts when the owner starts the game.</span>}
        {g.status === "running" && <span><b>{fmtClock(left, tenths)}</b> <span className="muted">left</span></span>}
        {g.status === "paused" && <span className="warn-text"><b>Paused</b>: the clock and change budgets stand still. {fmtClock(left, tenths)} left.</span>}
        {g.status === "finished" && <span className="muted">{early ? `Finished early, at ${fmtClock(now, tenths)}.` : "Time's up."}</span>}
      </div>
    </div>
  );
}
