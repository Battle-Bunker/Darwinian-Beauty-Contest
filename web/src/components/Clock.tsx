// The game clock: game time interpolated locally between server updates while the game runs, shown in
// whole rounds (game time is rounds × the round length, 200 ms by default: the flowers' window to answer
// plus the bees' window to decide). A game with a random end shows the time played and the range its end is
// drawn from, never the end or the time left: the end is hidden until the game is over (the owner's view,
// without a team in the game, has it as drawnEndMs).
import { endOrMax, prevalenceOn, roundMsOf as roundMsOfConfig, windowMsOf, type GameView } from "../types";
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

/** "5:00–10:00": the range a game's end is drawn from (one time for a fixed end). */
export const rangeText = (minMs: number, maxMs: number) => (maxMs > minMs ? `${fmtClock(minMs)}–${fmtClock(maxMs)}` : fmtClock(minMs));

export function GameClock({ store, view }: { store: LiveStore; view: GameView }) {
  const g = view.game;
  const end = endOrMax(g), hidden = g.endMs === null;
  useLiveTick(store, showTenths(end) ? 100 : 250, g.status === "running");
  const roundMs = roundMsOf(view);
  // Whole rounds: the round in progress counts in full, as on the server (clockMs = round × roundMs).
  const raw = g.status === "lobby" ? 0 : Math.min(end, Math.max(g.clockMs, store.now()));
  const round = g.status === "lobby" ? 0 : Math.max(g.round ?? 0, store.round, Math.floor(raw / roundMs));
  const now = Math.min(end, round * roundMs);
  const tenths = showTenths(end);
  const left = Math.max(0, end - now);
  const early = g.status === "finished" && now < end - 1000;
  const rounds = (ms: number) => Math.round(ms / roundMs).toLocaleString();
  const range = rangeText(g.minMs, g.maxMs);
  // Only the owner's view (with no team in the game) has the drawn end while it's hidden.
  const secret = hidden && g.drawnEndMs != null ? <span className="muted"> (drawn: ends at <b>{fmtClock(g.drawnEndMs)}</b>; hidden from the teams)</span> : null;
  const hiddenNote = now < g.minMs
    ? <>Ends at a hidden time between <b>{fmtClock(g.minMs)}</b> and <b>{fmtClock(g.maxMs)}</b>.</>
    : <>Past the shortest length: any round may be the last (it ends by <b>{fmtClock(g.maxMs)}</b>).</>;
  return (
    <div className={`clock clock-${g.status}`} aria-live="off">
      <div className="clock-main">
        <span className="clock-now">{fmtClock(now, tenths)}</span>
        <span className="clock-of">/ {hidden ? range : fmtClock(end)}</span>
        {g.status !== "lobby" && (
          <span className="clock-round" title={roundLine(view)}>
            round <b>{round.toLocaleString()}</b>{!hidden && <span className="muted"> / {rounds(end)}</span>}
          </span>
        )}
      </div>
      {hidden
        ? <Progress value={now / g.maxMs} className="clock-bar" label="Game time played, out of the longest the game can last" />
        : <Progress value={now / end} className="clock-bar" label="Game time played" />}
      <div className="clock-note small">
        {g.status === "lobby" && <span className="muted">The clock starts when the owner starts the game. {hidden ? <>It ends at a random time between {fmtClock(g.minMs)} and {fmtClock(g.maxMs)}, drawn at the start and hidden until the end: {rounds(g.minMs)}–{rounds(g.maxMs)}</> : rounds(end)} rounds of {roundMs} ms.</span>}
        {g.status === "running" && (hidden ? <span>{hiddenNote}{secret}</span> : <span><b>{fmtClock(left, tenths)}</b> <span className="muted">left</span></span>)}
        {g.status === "paused" && <span className="warn-text"><b>Paused</b>: the clock and change budgets stand still. {hidden ? <>{hiddenNote}{secret}</> : `${fmtClock(left, tenths)} left.`}</span>}
        {g.status === "finished" && <span className="muted">{early ? `Finished early, at ${fmtClock(now, tenths)}${g.maxMs > g.minMs ? ` (its end was drawn at ${fmtClock(end)}, from ${range})` : ""}.` : g.maxMs > g.minMs ? `Time's up at ${fmtClock(end)}, drawn from ${range}.` : "Time's up."}</span>}
      </div>
    </div>
  );
}
