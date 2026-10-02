// Scores: Darwinian fitness over the whole game and over the last five minutes of game time, side by
// side, with the breakdown for whichever period is picked.
import { useMemo, useState } from "react";
import type { GameView, Team, TeamScore } from "../types";
import { fmt2, fmt3, fmtClock, pct } from "../lib/format";
import { InfoTip, TeamChip } from "./ui";
import { TrophyIcon } from "./Icons";

const RECENT_MS = 5 * 60000;

const TERMS: Record<string, string> = {
  fitness: "N² × allure share × forage share. Par is 1.0 however many teams play. Above 1 means you're out-evolving the average team.",
  allure: "Rootsum of the feeds your patch received, counted per bee team. How widely your flowers get pollinated: feeds from many different bees beat lots of feeds from one.",
  forage: "Rootsum of the nectar your bee collected, counted per patch team. How widely your bee finds real food.",
  allureShare: "Your allure ÷ everyone's allure added up. Par is 1/N.",
  forageShare: "Your forage ÷ everyone's forage added up. Par is 1/N.",
  pollinators: "How many different teams' bees fed at your patch.",
  nectarSources: "How many different teams' patches gave your bee nectar.",
  rootsum: "Add up the square root of each entry: rootsum(4, 0, 0, 0) = 2 but rootsum(1, 1, 1, 1) = 4. Earning from many different teams beats earning the same amount from one.",
};

export function Scores({ view }: { view: GameView }) {
  const g = view.game;
  // In a game of five minutes or less, "the last five minutes" is always the whole game.
  const short = g.endMs <= RECENT_MS;
  const [mode, setMode] = useState<"game" | "recent">("game");
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const myTeamId = view.me?.teamId ?? null;
  const n = view.participants?.length ?? 0;
  const game = view.scores ?? [];
  const recent = view.recent?.scores ?? [];
  const recentById = Object.fromEntries(recent.map((s) => [s.teamId, s]));
  const gameById = Object.fromEntries(game.map((s) => [s.teamId, s]));
  const pick = short ? "game" : mode;
  const shown = pick === "game" ? game : recent;
  const sorted = [...shown].sort((a, b) => b.fitness - a.fitness);
  const maxFit = Math.max(1.5, ...game.map((s) => s.fitness), ...recent.map((s) => s.fitness));
  const whole = view.recent && view.recent.fromMs === 0;
  const window = view.recent ? `${fmtClock(view.recent.fromMs)}–${fmtClock(view.recent.toMs)}` : "";
  if (!game.length) return <p className="muted">Scores appear once the game starts.</p>;

  return (
    <div className="scores">
      {!short && (
        <div className="seg" role="group" aria-label="Which scores to break down">
          <button className={pick === "game" ? "active" : ""} aria-pressed={pick === "game"} onClick={() => setMode("game")}>Whole game</button>
          <button className={pick === "recent" ? "active" : ""} aria-pressed={pick === "recent"} onClick={() => setMode("recent")}>
            Last 5 minutes{whole ? " (so far, the whole game)" : ""}
          </button>
        </div>
      )}
      <p className="small muted scores-note">
        {short
          ? `This game is ${fmtClock(g.endMs)} long, so its scores are over the whole game.`
          : pick === "game" ? "Sorted by whole-game fitness. The breakdown is over the whole game." : `Sorted by fitness over the last five minutes of game time (${window}). The breakdown is over those five minutes.`}
        {" "}Scores as of {fmtClock(g.clockMs)} of game time{g.status === "running" ? ", updated every few seconds" : ""}.
      </p>

      <div className="table-scroll">
        <table className="data-table score-table">
          <caption className="sr-only">Scores, best fitness first</caption>
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Team</th>
              <th className="left"><span className="th-tip">Fitness{short ? "" : ": game"} <InfoTip>{TERMS.fitness}</InfoTip></span></th>
              {!short && <th className="left"><span className="th-tip">Last 5 min</span></th>}
              <th><span className="th-tip">Allure share <InfoTip>{TERMS.allureShare}</InfoTip></span></th>
              <th><span className="th-tip">Forage share <InfoTip>{TERMS.forageShare}</InfoTip></span></th>
              <th><span className="th-tip">Allure <InfoTip>{TERMS.allure}</InfoTip></span></th>
              <th><span className="th-tip">Forage <InfoTip>{TERMS.forage}</InfoTip></span></th>
              <th><span className="th-tip">Pollinators <InfoTip>{TERMS.pollinators}</InfoTip></span></th>
              <th><span className="th-tip">Nectar sources <InfoTip>{TERMS.nectarSources}</InfoTip></span></th>
              <th title="Feeds your patch received">Fed at patch</th>
              <th title="Nectar your bee collected">Nectar</th>
              <th title="Feeds your bee made at orchids">Fooled</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.teamId} className={s.teamId === myTeamId ? "mine" : ""}>
                <td>{i + 1}</td>
                <th scope="row" className="left"><TeamChip team={teams[s.teamId]} you={s.teamId === myTeamId} short /></th>
                <td className="left"><FitnessBar value={gameById[s.teamId]?.fitness ?? 0} max={maxFit} strong={pick === "game"} /></td>
                {!short && <td className="left"><FitnessBar value={recentById[s.teamId]?.fitness ?? 0} max={maxFit} strong={pick === "recent"} recent /></td>}
                <td title={`par ${pct(1 / n)}`}>{pct(s.allureShare)}</td>
                <td title={`par ${pct(1 / n)}`}>{pct(s.forageShare)}</td>
                <td>{fmt2(s.allure)}</td>
                <td>{fmt2(s.forage)}</td>
                <td>{s.pollinators} / {n}</td>
                <td>{s.nectarSources} / {n}</td>
                <td>{s.feedsReceived.toLocaleString()}</td>
                <td>{s.nectarCollected.toLocaleString()}</td>
                <td>{(s.feedsGiven - s.nectarCollected).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="legend-box">
        <summary>How scoring works</summary>
        <dl>
          <dt>Rootsum</dt><dd>{TERMS.rootsum}</dd>
          <dt>Allure</dt><dd>{TERMS.allure}</dd>
          <dt>Forage</dt><dd>{TERMS.forage}</dd>
          <dt>Allure share and forage share</dt><dd>Your allure (or forage) as a fraction of everyone's. Par is 1/N with N teams.</dd>
          <dt>Fitness</dt><dd>{TERMS.fitness}</dd>
        </dl>
        <p className="small muted">So you want lots of different bees to feed at your patch (even at your orchid), and your bee to find nectar at lots of different patches. Your own patch and bee count like any other team. The game is won on whole-game fitness; the last five minutes show who's doing well right now.</p>
      </details>
    </div>
  );
}

function FitnessBar({ value, max, strong, recent = false }: { value: number; max: number; strong: boolean; recent?: boolean }) {
  return (
    <span className={`fit ${strong ? "" : "fit-weak"} ${recent ? "fit-recent" : ""}`}>
      <span className="fit-track" aria-hidden>
        <span className="fit-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
        <span className="fit-par" style={{ left: `${(1 / max) * 100}%` }} title="par = 1.0" />
      </span>
      <b>{fmt3(value)}</b>
    </span>
  );
}

export function Podium({ view, final }: { view: GameView; final: TeamScore[] }) {
  const teams: Record<string, Team> = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  const top = [...final].sort((a, b) => b.fitness - a.fitness).slice(0, 3);
  const places = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return (
    <div className="podium" aria-label="Final standings">
      {places.map((s) => {
        const rank = top.indexOf(s) + 1;
        const t = teams[s.teamId];
        return (
          <div key={s.teamId} className={`podium-step p${rank}`}>
            <div className="podium-team">
              {rank === 1 && <TrophyIcon size={28} className="trophy" />}
              <span className="swatch big" style={{ background: t?.color }} />
              <b>{t?.name}</b>
              <span className="podium-fit">fitness {fmt3(s.fitness)}</span>
            </div>
            <div className="podium-block"><span>{rank}</span></div>
          </div>
        );
      })}
    </div>
  );
}
