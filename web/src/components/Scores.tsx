// Scores for a round (or the game so far): Darwinian fitness and the two ledgers it's built from.
import { useMemo, useState } from "react";
import type { GameView, Round, Team, TeamScore } from "../types";
import { fmt2, fmt3, pct, poss } from "../lib/format";
import { InfoTip, TeamChip } from "./ui";
import { TrophyIcon } from "./Icons";

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

function addLedgers(rounds: Round[], key: "feeds" | "nectar"): number[][] {
  const n = rounds[0]?.[key].length ?? 0;
  const out = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const r of rounds) r[key].forEach((row, i) => row.forEach((x, j) => { out[i][j] += x; }));
  return out;
}

export function Scores({ view, round }: { view: GameView; round: Round }) {
  const [mode, setMode] = useState<"total" | "round">("total");
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const order = view.participants ?? [];
  const myTeamId = view.me?.teamId ?? null;
  const upTo = view.rounds.filter((r) => r.no <= round.no);
  const scores = mode === "total" ? round.totals : round.scores;
  const feeds = mode === "total" ? addLedgers(upTo, "feeds") : round.feeds;
  const nectar = mode === "total" ? addLedgers(upTo, "nectar") : round.nectar;
  const sorted = [...scores].sort((a, b) => b.fitness - a.fitness);
  const maxFit = Math.max(1.5, ...scores.map((s) => s.fitness));
  const n = order.length;

  return (
    <div className="scores">
      <div className="seg" role="group" aria-label="Which scores">
        <button className={mode === "total" ? "active" : ""} aria-pressed={mode === "total"} onClick={() => setMode("total")}>
          Game total after round {round.no}
        </button>
        <button className={mode === "round" ? "active" : ""} aria-pressed={mode === "round"} onClick={() => setMode("round")}>
          Round {round.no} only
        </button>
      </div>

      <div className="table-scroll">
        <table className="data-table score-table">
          <caption className="sr-only">Scores, best fitness first</caption>
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Team</th>
              <th className="left"><span className="th-tip">Fitness <InfoTip>{TERMS.fitness}</InfoTip></span></th>
              <th><span className="th-tip">Allure <InfoTip>{TERMS.allure}</InfoTip></span></th>
              <th><span className="th-tip">Forage <InfoTip>{TERMS.forage}</InfoTip></span></th>
              <th><span className="th-tip">Allure share <InfoTip>{TERMS.allureShare}</InfoTip></span></th>
              <th><span className="th-tip">Forage share <InfoTip>{TERMS.forageShare}</InfoTip></span></th>
              <th><span className="th-tip">Pollinators <InfoTip>{TERMS.pollinators}</InfoTip></span></th>
              <th><span className="th-tip">Nectar sources <InfoTip>{TERMS.nectarSources}</InfoTip></span></th>
              <th title="Feeds your patch received">Fed at patch</th>
              <th title="Nectar your bee collected">Nectar</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.teamId} className={s.teamId === myTeamId ? "mine" : ""}>
                <td>{i + 1}</td>
                <th scope="row" className="left"><TeamChip team={teams[s.teamId]} you={s.teamId === myTeamId} /></th>
                <td className="left"><FitnessBar value={s.fitness} max={maxFit} /></td>
                <td>{fmt2(s.allure)}</td>
                <td>{fmt2(s.forage)}</td>
                <td title={`par ${pct(1 / n)}`}>{pct(s.allureShare)}</td>
                <td title={`par ${pct(1 / n)}`}>{pct(s.forageShare)}</td>
                <td>{s.pollinators} / {n}</td>
                <td>{s.nectarSources} / {n}</td>
                <td>{s.feedsReceived}</td>
                <td>{s.nectarCollected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ledgers">
        <Ledger title="Feed ledger" hint="How many times each bee (row) fed at each patch (column), clover or orchid." matrix={feeds} order={order} teams={teams} myTeamId={myTeamId} tone="feed" verb="fed" />
        <Ledger title="Nectar ledger" hint="How much nectar each bee (row) got from each patch (column). Only clovers pay." matrix={nectar} order={order} teams={teams} myTeamId={myTeamId} tone="nectar" verb="got nectar" />
      </div>

      <details className="legend-box">
        <summary>How scoring works</summary>
        <dl>
          <dt>Rootsum</dt><dd>{TERMS.rootsum}</dd>
          <dt>Allure</dt><dd>{TERMS.allure} It's the rootsum of your column in the feed ledger.</dd>
          <dt>Forage</dt><dd>{TERMS.forage} It's the rootsum of your row in the nectar ledger.</dd>
          <dt>Allure share and forage share</dt><dd>Your allure (or forage) as a fraction of everyone's. Par is 1/N with N teams.</dd>
          <dt>Fitness</dt><dd>{TERMS.fitness}</dd>
        </dl>
        <p className="small muted">So you want lots of different bees to feed at your patch (even at your orchid), and your bee to find nectar at lots of different patches. Your own patch and bee count like any other team. The game score uses all rounds' ledgers added together.</p>
      </details>
    </div>
  );
}

function FitnessBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="fit">
      <span className="fit-track" aria-hidden>
        <span className="fit-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
        <span className="fit-par" style={{ left: `${(1 / max) * 100}%` }} title="par = 1.0" />
      </span>
      <b>{fmt3(value)}</b>
    </span>
  );
}

function Ledger({ title, hint, matrix, order, teams, myTeamId, tone, verb }: {
  title: string; hint: string; matrix: number[][]; order: string[]; teams: Record<string, Team>; myTeamId: string | null; tone: "feed" | "nectar"; verb: string;
}) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <figure className="ledger">
      <figcaption><b>{title}</b> <span className="small muted">{hint}</span></figcaption>
      <div className="table-scroll">
        <table className={`heat heat-${tone}`}>
          <thead>
            <tr>
              <th className="corner"><span>bee ↓</span><span>patch →</span></th>
              {order.map((id) => (
                <th key={id} scope="col" className="heat-col" title={`${poss(teams[id]?.name)} patch`}>
                  <span className="swatch" style={{ background: teams[id]?.color }} />
                  <span className="heat-colname">{short(teams[id]?.name)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((rowId, i) => (
              <tr key={rowId}>
                <th scope="row" className="heat-row"><TeamChip team={teams[rowId]} you={rowId === myTeamId} short /></th>
                {order.map((colId, j) => {
                  const v = matrix[i]?.[j] ?? 0;
                  const level = v / max;
                  return (
                    <td key={colId} className={`${i === j ? "self" : ""} ${level > 0.55 ? "hi" : ""} ${v === 0 ? "zero" : ""}`}
                      style={{ ["--lvl" as string]: `${Math.round(8 + level * 92)}%` }}
                      title={`${poss(teams[rowId]?.name)} bee ${verb} ${v} time${v === 1 ? "" : "s"} at ${poss(teams[colId]?.name)} patch${i === j ? " (its own)" : ""}`}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

const short = (name?: string) => (!name ? "?" : name.length > 9 ? name.slice(0, 8) + "…" : name);

export function Podium({ view, final }: { view: GameView; final: TeamScore[] }) {
  const teams = Object.fromEntries(view.teams.map((t) => [t.id, t]));
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
