// The game clock: game time interpolated locally between server updates while the game runs, shown in
// whole rounds (game time is rounds × the round length, 200 ms by default: the flowers' window to answer
// plus the bees' window to decide).
import { prevalenceOn, roundMsOf as roundMsOfConfig, windowMsOf, type GameView } from "../types";
import { useLiveTick, type LiveStore } from "../lib/live";
import { fmtClock } from "../lib/format";
import { Progress } from "./ui";

/** Short games (two minutes or less) show tenths of a second. */
export const showTenths = (endMs: number) => endMs <= 120_000;

/** The round length: the flower window plus the bees' decision window. */
export const roundMsOf = (view: GameView) => roundMsOfConfig(view.game.config);

/** One line on how a round works, for the clock and the settings. */
export const roundLine = (view: GameView) => {
  const cfg = view.game.config, b = cfg.budgets, prev = prevalenceOn(cfg) ? cfg.prevalence! : null;
  return `A round is ${roundMsOfConfig(cfg)} ms of game time: ${prev ? `ceil(${prev.slots} × N) bees, drawn by their recent success, each visit a species drawn by its recent success` : "every bee that isn't feeding visits a random flower"}; the flower has a hidden ${b.flower.minMs ?? 50}–${b.flower.ms} ms of CPU time to answer (delivered at ${windowMsOf(cfg)} ms), then the bee has ${b.bee.ms} ms of CPU time to feed or leave.` +
    (cfg.feedCost > 0 ? ` A feed sits it out ${cfg.feedCost} rounds.` : "");
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
