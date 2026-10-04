// Scores: Darwinian fitness = N² × pollination share × forage share, live for everyone, with the numbers
// behind it, the breakdown team by team, and the whole-game ledgers (who fed where, the nectar each bee got
// at each flower, and the pollen each flower gave each bee). A value the server holds back shows "–".
import { useMemo } from "react";
import type { GameView, Team, TeamScore } from "../types";
import { fmt2, fmt3, fmtClock, fmtE, fmtEExact, pct, poss } from "../lib/format";
import { InfoTip, TeamChip } from "./ui";
import { TrophyIcon } from "./Icons";

const TERMS = {
  fitness: "N² × pollination share × forage share. Par is 1.0 however many teams play: above 1, you're out-evolving the average team.",
  pollination: "Σ over bee teams of √(the pollen your flower gave that team's bee). Bees carry pollen to other flowers: how widely, and how much, your flower is pollinated.",
  forage: "Σ over flower teams of √(the nectar your bee got there). How widely your bee eats.",
  pollen: "Everything your flower gave as pollen: (1 − percent/100) × E on every feed at it. A visit without a feed gives nothing.",
  share: "Your value ÷ everyone's added up. Par is 1/N.",
  pollinators: "How many different teams' bees fed at your flower.",
  nectarSources: "How many different teams' flowers gave your bee nectar.",
  rootsum: "Add up the square root of each entry: rootsum(400, 0, 0, 0) = 20 but rootsum(100, 100, 100, 100) = 40. Giving to (or getting from) many teams beats the same amount from one.",
};

/** A rootsum: two decimals while small, whole numbers once it's big (they sum roots of node·ms). */
const fmtRoot = (x: number) => (x < 100 ? fmt2(x) : Math.round(x).toLocaleString());
const num = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const shareText = (x: number | null) => (num(x) ? pct(x) : "–");

export function Scores({ view }: { view: GameView }) {
  const g = view.game;
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  const myTeamId = view.me?.teamId ?? null;
  const n = view.participants?.length ?? 0;
  const scores = view.scores ?? [];
  const sorted = [...scores].sort((a, b) => (b.fitness ?? -1) - (a.fitness ?? -1) || (b.pollination ?? 0) - (a.pollination ?? 0));
  const maxFit = Math.max(1.5, ...scores.map((s) => s.fitness ?? 0));
  const over = g.status === "finished";
  if (!scores.length) return <p className="muted">Scores appear once the game starts.</p>;
  const n2 = n * n;

  return (
    <div className="scores">
      <p className="small muted scores-note">
        {over ? "Final scores, over the whole game." : `Live, over the game so far (as of ${fmtClock(g.clockMs)} of game time, updated every second or so).`}
        {" "}Sorted by fitness. Shares are of the sum over all {n} teams; par is {pct(1 / Math.max(1, n))}.
      </p>
      <div className="table-scroll">
        <table className="data-table score-table">
          <caption className="sr-only">Scores, best fitness first</caption>
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Team</th>
              <th className="left"><span className="th-tip">Fitness <InfoTip>{TERMS.fitness}</InfoTip></span></th>
              <th><span className="th-tip">Pollination <InfoTip>{TERMS.pollination}</InfoTip></span></th>
              <th><span className="th-tip">Forage <InfoTip>{TERMS.forage}</InfoTip></span></th>
              <th><span className="th-tip">Pollen given <InfoTip>{TERMS.pollen}</InfoTip></span></th>
              <th title="Feeds at this team's flower">Fed here</th>
              <th><span className="th-tip">Pollinators <InfoTip>{TERMS.pollinators}</InfoTip></span></th>
              <th title="Feeds this team's bee made">Bee fed</th>
              <th><span className="th-tip">Sources <InfoTip>{TERMS.nectarSources}</InfoTip></span></th>
              <th title="Nectar this team's bee got">Nectar got</th>
              <th title="Nectar this team's flower gave to bees">Nectar given</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.teamId} className={s.teamId === myTeamId ? "mine" : ""}>
                <td>{i + 1}</td>
                <th scope="row" className="left"><TeamChip team={teams[s.teamId]} you={s.teamId === myTeamId} short /></th>
                <td className="left">{num(s.fitness) ? <FitnessBar value={s.fitness} max={maxFit} /> : <span className="muted" title="Revealed when the game ends">–</span>}</td>
                <td><ShareCell value={num(s.pollination) ? fmtRoot(s.pollination) : "–"} share={s.pollinationShare} n={n} /></td>
                <td><ShareCell value={num(s.forage) ? fmtRoot(s.forage) : "–"} share={s.forageShare} n={n} /></td>
                <td title={num(s.pollen) ? fmtEExact(s.pollen) : ""}>{num(s.pollen) ? fmtE(s.pollen) : "–"}</td>
                <td>{s.feedsReceived.toLocaleString()}</td>
                <td>{s.pollinators} / {n}</td>
                <td>{s.feedsGiven.toLocaleString()}</td>
                <td>{num(s.nectarSources) ? `${s.nectarSources} / ${n}` : "–"}</td>
                <td title={num(s.nectarCollected) ? fmtEExact(s.nectarCollected) : "private"}>{num(s.nectarCollected) ? fmtE(s.nectarCollected) : "–"}</td>
                <td title={num(s.nectarGiven) ? fmtEExact(s.nectarGiven) : "private"}>{num(s.nectarGiven) ? fmtE(s.nectarGiven) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.some((s) => num(s.fitness)) && (
        <details className="legend-box breakdown" open={over}>
          <summary>How each team's fitness adds up</summary>
          <ol className="breakdown-list">
            {sorted.map((s) => (
              <li key={s.teamId} className={s.teamId === myTeamId ? "mine" : ""}>
                <TeamChip team={teams[s.teamId]} you={s.teamId === myTeamId} short />
                <span className="mono breakdown-formula">
                  {n}² × {shareText(s.pollinationShare)} × {shareText(s.forageShare)} = <b>{num(s.fitness) ? fmt3(s.fitness) : "–"}</b>
                </span>
                <span className="small muted">{num(s.fitness) && n2 ? weaker(s) : ""}</span>
              </li>
            ))}
          </ol>
          <p className="small muted">pollination share × forage share, times {n}² = {n2.toLocaleString()} so that a team at par on both scores exactly 1.</p>
        </details>
      )}

      {view.ledgers && view.participants && (
        <div className="ledgers" style={{ ["--heat-min" as string]: `${Math.min(1100, 190 + n * 54)}px` }}>
          <Heat title="Who fed where" hint="Feeds each bee (row) made at each flower (column)."
            matrix={view.ledgers.feeds} order={view.participants} teams={teams} myTeamId={myTeamId} tone="feed" fmt={(v) => compact(v)} verb={(v) => `fed ${v.toLocaleString()} time${v === 1 ? "" : "s"}`} />
          <Heat title="Nectar each bee got where" hint="Nectar each bee (row) got at each flower (column). A row's rootsum is that bee's forage."
            matrix={view.ledgers.nectar} order={view.participants} teams={teams} myTeamId={myTeamId} tone="nectar" fmt={fmtE} verb={(v) => `got ${fmtEExact(v)} of nectar`} />
          {Array.isArray(view.ledgers.pollen?.[0]) && (
            <Heat title="Pollen each flower gave each bee" hint="Pollen each flower (column) gave each bee (row) on its feeds. A column's rootsum is that flower's pollination."
              matrix={view.ledgers.pollen} order={view.participants} teams={teams} myTeamId={myTeamId} tone="kept" fmt={fmtE} verb={(v) => `was given ${fmtEExact(v)} of pollen`} />
          )}
        </div>
      )}

      <details className="legend-box">
        <summary>How scoring works</summary>
        <dl>
          <dt>Rootsum</dt><dd>{TERMS.rootsum}</dd>
          <dt>Pollination</dt><dd>{TERMS.pollination}</dd>
          <dt>Forage</dt><dd>{TERMS.forage}</dd>
          <dt>Pollen</dt><dd>{TERMS.pollen}</dd>
          <dt>Shares</dt><dd>{TERMS.share}</dd>
          <dt>Fitness</dt><dd>{TERMS.fitness}</dd>
        </dl>
        <p className="small muted">Each team's flower is a species, and every visit is a bee meeting one of its flowers. On a feed the flower gives the bee nectar (the percent it offered of its excess energy) and pollen (the rest), which the bee carries to other flowers. Flowers want to give pollen to many different bees; bees want nectar from many different flowers. An unfed visit's energy is lost to everyone. Your own bee and flower count like any other team's.</p>
      </details>
    </div>
  );
}

/** Which of a team's two shares holds it back, in words. */
function weaker(s: TeamScore): string {
  if (!num(s.pollinationShare) || !num(s.forageShare)) return "";
  return s.pollinationShare < s.forageShare ? "weaker: pollination" : s.forageShare < s.pollinationShare ? "weaker: forage" : "";
}

function ShareCell({ value, share, n, title }: { value: string; share: number | null; n: number; title?: string }) {
  return (
    <span className="share-cell" title={title}>
      <span>{value}</span>
      {num(share) && (
        <span className="share-sub">
          <span className="share-track" aria-hidden><span className="share-fill" style={{ width: `${Math.min(100, share * 100 * Math.min(4, n / 2))}%` }} /><span className="share-par" style={{ left: `${Math.min(100, (100 / Math.max(1, n)) * Math.min(4, n / 2))}%` }} /></span>
          <span className="small muted">{pct(share)}</span>
        </span>
      )}
    </span>
  );
}

const compact = (v: number) => (v < 10000 ? v.toLocaleString() : v < 1e6 ? `${(v / 1000).toFixed(v < 100000 ? 1 : 0)}k` : `${(v / 1e6).toFixed(1)}M`);
const shortName = (name?: string) => (!name ? "?" : name.length > 9 ? name.slice(0, 8) + "…" : name);

/** A whole-game ledger as a heatmap: rows are bees, columns are flowers. Null cells are ones the viewer may not see. */
function Heat({ title, hint, matrix, order, teams, myTeamId, tone, fmt, verb }: {
  title: string; hint: string; matrix: (number | null)[][]; order: string[]; teams: Record<string, Team>; myTeamId: string | null;
  tone: "feed" | "nectar" | "kept"; fmt: (v: number) => string; verb: (v: number) => string;
}) {
  const max = Math.max(1, ...matrix.flat().filter(num));
  return (
    <figure className="ledger">
      <figcaption><b>{title}</b> <span className="small muted">{hint}</span></figcaption>
      <div className="table-scroll">
        <table className={`heat heat-${tone}`}>
          <thead>
            <tr>
              <th className="corner"><span>bee ↓</span><span>flower →</span></th>
              {order.map((id) => (
                <th key={id} scope="col" className="heat-col" title={`${poss(teams[id]?.name)} flower`}>
                  <span className="swatch" style={{ background: teams[id]?.color }} />
                  <span className="heat-colname">{shortName(teams[id]?.name)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((rowId, i) => (
              <tr key={rowId}>
                <th scope="row" className="heat-row"><TeamChip team={teams[rowId]} you={rowId === myTeamId} short /></th>
                {order.map((colId, j) => {
                  const v = matrix[i]?.[j];
                  if (!num(v)) return <td key={colId} className={`hidden ${i === j ? "self" : ""}`} title="Not yours to see">·</td>;
                  const level = v / max;
                  return (
                    <td key={colId} className={`${i === j ? "self" : ""} ${level > 0.55 ? "hi" : ""} ${v === 0 ? "zero" : ""}`}
                      style={{ ["--lvl" as string]: `${Math.round(8 + level * 92)}%` }}
                      title={`${poss(teams[rowId]?.name)} bee ${verb(v)} at ${poss(teams[colId]?.name)} flower${i === j ? " (its own)" : ""}`}>
                      {fmt(v)}
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

export function Podium({ view, final }: { view: GameView; final: TeamScore[] }) {
  const teams: Record<string, Team> = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  const top = [...final].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0)).slice(0, 3);
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
              <span className="podium-fit">fitness {num(s.fitness) ? fmt3(s.fitness) : "–"}</span>
            </div>
            <div className="podium-block"><span>{rank}</span></div>
          </div>
        );
      })}
    </div>
  );
}
