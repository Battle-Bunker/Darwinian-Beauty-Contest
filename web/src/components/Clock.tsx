// The game clock: game time interpolated locally between server updates while the game runs, shown in
// whole rounds (game time is rounds × the round length, 200 ms by default: the flowers' window to answer
// plus the bees' window to decide).
import type { GameView } from "../types";
import { useLiveTick, type LiveStore } from "../lib/live";
import { fmtClock } from "../lib/format";
import { Progress } from "./ui";

/** Short games (two minutes or less) show tenths of a second. */
export const showTenths = (endMs: number) => endMs <= 120_000;

/** The round length: the flower window (the cosmos's limit) plus the bees' decision window. */
export const roundMsOf = (view: GameView) => view.game.config.budgets.cosmos.ms + view.game.config.budgets.bee.ms;

/** One line on how a round works, for the clock and the settings. */
export const roundLine = (view: GameView) => {
  const b = view.game.config.budgets;
  return `A round is ${b.cosmos.ms + b.bee.ms} ms of game time: every bee acts at once, flowers have ${b.cosmos.ms} ms to answer (orchids ${b.orchid.ms}), then bees have ${b.bee.ms} ms to decide.`;
};

export function GameClock({ store, view }: { store: LiveStore; view: GameView }) {
  const g = view.game;
  useLiveTick(store, showTenths(g.endMs) ? 100 : 250, g.status === "running");
  const roundMs = roundMsOf(view);
  // Whole rounds: the round in progress counts in full, as on the server (clockMs = round × roundMs).
  const raw = g.status === "lobby" ? 0 : Math.min(g.endMs, Math.max(g.clockMs, store.now()));
  const round = g.status === "lobby" ? 0 : Math.max(g.round ?? 0, store.round, Math.floor(raw / roundMs));
  const now = Math.min(g.endMs, round * roundMs);
  const tenths = showTenths(g.endMs);
  const left = Math.max(0, g.endMs - now);
  const early = g.status === "finished" && now < g.endMs - 1000;
  return (
    <div className={`clock clock-${g.status}`} aria-live="off">
      <div className="clock-main">
        <span className="clock-now">{fmtClock(now, tenths)}</span>
        <span className="clock-of">/ {fmtClock(g.endMs)}</span>
        {g.status !== "lobby" && (
          <span className="clock-round" title={roundLine(view)}>
            round <b>{round.toLocaleString()}</b><span className="muted"> / {Math.round(g.endMs / roundMs).toLocaleString()}</span>
          </span>
        )}
      </div>
      <Progress value={now / g.endMs} className="clock-bar" label="Game time played" />
      <div className="clock-note small">
        {g.status === "lobby" && <span className="muted">The clock starts when the owner starts the game. {Math.round(g.endMs / roundMs).toLocaleString()} rounds of {roundMs} ms.</span>}
        {g.status === "running" && <span><b>{fmtClock(left, tenths)}</b> <span className="muted">left</span></span>}
        {g.status === "paused" && <span className="warn-text"><b>Paused</b>: the clock and change budgets stand still. {fmtClock(left, tenths)} left.</span>}
        {g.status === "finished" && <span className="muted">{early ? `Finished early, at ${fmtClock(now, tenths)}.` : "Time's up."}</span>}
      </div>
    </div>
  );
}
