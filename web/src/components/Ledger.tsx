// My team's ledger, from GET .../ledger: every finished turn as my team may see it, teams as indices (the
// `turns` entity of docs/QUERY.md; programs get no history, but teams and their scripts do).
// During play it holds every turn's public fields, every feed's details (public), and my own flower's
// and bee's private ones; once the game is over, everything. With it: where my flower's energy went
// (including what it lost on visits where the bee didn't feed, which only my team sees until the end)
// and my team over time.
import { useMemo, useState } from "react";
import type { GameView, LedgerEntry, Team } from "../types";
import { gameBase } from "../api";
import type { LedgerStore } from "../lib/history";
import { useLiveTick } from "../lib/live";
import { binTurns, binWidth, recFromEntry, sizeLookup, totalsOf, type MetricKey } from "../lib/stats";
import { fmtClock, fmtE, fmtEExact, fmtMs, plural } from "../lib/format";
import { EnergySplit, MetricPicker, TeamSeriesChart } from "./Charts";
import { Value } from "./Value";
import { ResponseView, responseUrl } from "./ResponseView";
import { showGrain } from "./Pollen";
import { Alert, Spinner } from "./ui";

const PAGE = 100;

export function LedgerPanel({ view, ledger }: { view: GameView; ledger: LedgerStore }) {
  const base = gameBase(view.room.shortId, view.game.shortId);
  const rev = useLiveTick(ledger, 1000);
  const g = view.game;
  const cfg = g.config;
  const roundMs = cfg.budgets.flower.ms + cfg.budgets.bee.ms;
  const order = ledger.participants ?? view.participants ?? [];
  const teams: Team[] = useMemo(() => {
    const byId = new Map(view.teams.map((t) => [t.id, t]));
    return order.map((id) => byId.get(id)!).filter(Boolean);
  }, [order, view.teams]);
  const me = ledger.team;
  const over = g.status === "finished";
  const [bee, setBee] = useState("");
  const [flower, setFlower] = useState("");
  const [fedOnly, setFedOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const out: LedgerEntry[] = [];
    let total = 0;
    const es = ledger.entries;
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      if (bee !== "" && e.bee !== Number(bee)) continue;
      if (flower !== "" && e.flower !== Number(flower)) continue;
      if (fedOnly && !e.fed) continue;
      if (mineOnly && me !== null && e.bee !== me && e.flower !== me) continue;
      total++;
      if (out.length < limit) out.push(e);
    }
    return { out, total };
  }, [ledger, rev, bee, flower, fedOnly, mineOnly, me, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const endMs = Math.max(roundMs, g.status === "finished" ? g.clockMs : g.endMs);
  const model = useMemo(() => ({ cap: cfg.budgets.flower.size, window: cfg.budgets.flower.ms, sizeOf: sizeLookup(teams) }), [cfg.budgets.flower.size, cfg.budgets.flower.ms, teams]);
  const data = useMemo(() => binTurns(ledger.entries.map((e) => recFromEntry(e, roundMs)), order.length, endMs, binWidth(endMs, roundMs), model),
    [ledger, rev, order.length, endMs, roundMs, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const upto = Math.min(data.bins, Math.ceil(((ledger.entries.at(-1)?.round ?? 0) * roundMs) / data.binMs));
  const [metric, setMetric] = useState<MetricKey>("fitness");
  // Feeds are public, so the score components, pollen and nectar can be charted for every team; a flower's
  // unfed visits and compute only for your own until the game is over.
  const privateMetric = !over && ["lost", "percent", "energy", "ms"].includes(metric);
  const chartRows = privateMetric ? (me !== null ? [me] : []) : teams.map((_, i) => i);

  const download = () => {
    const body = JSON.stringify(ledger.entries.map(({ seq: _seq, ...rest }) => rest), null, 1);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${g.shortId}${me !== null ? `-team${me}` : ""}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sel = (value: string, onChange: (v: string) => void, all: string, label: string) => (
    <select value={value} onChange={(e) => { onChange(e.target.value); setLimit(PAGE); }} aria-label={label}>
      <option value="">{all}</option>
      {teams.map((t, i) => <option key={t.id} value={i}>{i}: {t.name}{i === me ? " (you)" : ""}</option>)}
    </select>
  );

  return (
    <div className="stack ledger-panel">
      <p className="small muted">
        {me !== null
          ? <>Every finished turn as your team may see it, oldest first, teams as numbers (your programs don't see this: it's for your team and its scripts). Your team is <b>{me}</b> (<code>GAME["team"]</code> in your programs).
            {!over && " Feeds show their nectar, pollen, percent and energy to everyone; your own flower's unfed visits and compute times, and your own bee's timings, only to you."}</>
          : over ? "Every turn of the game, every field filled in (the game is over)." : "Every finished turn, with what spectators may see: who visited whom, the challenge, the response, and on feeds the nectar, pollen, percent and energy."}
      </p>
      <ul className="index-legend" aria-label="Team numbers">
        {teams.map((t, i) => <li key={t.id}><span className="mono">{i}</span><span className="swatch" style={{ background: t.color }} />{t.name}{i === me && <span className="you-tag">you</span>}</li>)}
      </ul>

      {me !== null && teams[me] && (
        <div className="stack">
          <h3>Where your flower's energy went{over ? "" : " (so far)"}</h3>
          <EnergySplit rows={[{ team: teams[me], t: totalsOf(data.teams[me]), you: true }]} />
          <p className="small muted">Your bee has got <b title={fmtEExact(data.teams[me].nectar.reduce((s, x) => s + x, 0))}>{fmtE(data.teams[me].nectar.reduce((s, x) => s + x, 0))}</b> nectar in {plural(data.teams[me].beeFeeds.reduce((s, x) => s + x, 0), "feed")}.</p>
        </div>
      )}
      {teams.length > 0 && (
        <div className="stack">
          <h3>Over time</h3>
          <div className="row"><MetricPicker value={metric} onChange={setMetric} />{privateMetric && <span className="small muted">{me !== null ? "Only your own flower: other flowers' unfed visits and compute are private until the end." : "Private until the game is over."}</span>}</div>
          {chartRows.length > 0 && <TeamSeriesChart teams={teams} rows={chartRows} data={data} metric={metric} focus={me} upto={upto} endMs={endMs} />}
        </div>
      )}

      <div className="feed-filters">
        <label className="feed-filter"><span>Bee</span>{sel(bee, setBee, "every bee", "Bee team")}</label>
        <label className="feed-filter"><span>at</span>{sel(flower, setFlower, "every flower", "Flower team")}</label>
        <label className="check small"><input type="checkbox" checked={fedOnly} onChange={(e) => { setFedOnly(e.target.checked); setLimit(PAGE); }} /> fed only</label>
        {me !== null && <label className="check small"><input type="checkbox" checked={mineOnly} onChange={(e) => { setMineOnly(e.target.checked); setLimit(PAGE); }} /> my bee or my flower</label>}
        <button className="btn btn-small btn-ghost feed-freeze" onClick={download} disabled={!ledger.entries.length}>Download JSON</button>
      </div>
      <p className="small muted feed-count">
        {rows.total.toLocaleString()} of {plural(ledger.entries.length, "entry", "entries")}
        {ledger.loading && !ledger.caughtUp ? <> · <Spinner label="loading…" /></> : g.status === "running" ? " · updated every 2 s" : ""}
      </p>
      {ledger.error && <Alert kind="error">{ledger.error}</Alert>}
      {rows.out.length > 0 && (
        <div className="table-scroll tall">
          <table className="data-table ledger-table">
            <thead>
              <tr>
                <th>round</th><th className="left">bee</th><th className="left">flower</th><th className="left">challenge</th><th className="left">response</th><th className="left">fed</th>
                <th>percent</th><th>energy</th><th>nectar</th><th>pollen</th><th title="the flower's CPU time">ms</th><th title="the bee's decision time">beeMs</th><th className="left" title="the pollen grain your bee got on a feed">grain</th>
              </tr>
            </thead>
            <tbody>
              {rows.out.map((e) => (
                <tr key={e.seq} className={me !== null && (e.bee === me || e.flower === me) ? "mine" : ""} title={`at ${fmtClock((e.round - 1) * roundMs, true)} of game time`}>
                  <td>{e.round.toLocaleString()}</td>
                  <td className="left nowrap"><IndexChip i={e.bee} teams={teams} /></td>
                  <td className="left nowrap"><IndexChip i={e.flower} teams={teams} /></td>
                  <td className="left"><Value v={e.challenge} role="challenge" max={18} /></td>
                  <td className="left"><ResponseView p={{ r: e.response, bytes: e.responseBytes ?? null, hash: e.responseHash ?? null, preview: e.responseHash ? "" : null }} url={responseUrl(base, e.seq)} max={18} /></td>
                  <td className="left">{e.fed ? <span className="ok-text">True</span> : <span className="muted">False</span>}</td>
                  <td className={e.percent === null ? "null" : ""}>{e.percent ?? "None"}</td>
                  <Num v={e.energy} />
                  <Num v={e.nectar} />
                  <Num v={e.pollen} />
                  <td className={e.ms === null ? "null" : ""} title={e.flowerError ?? undefined}>{e.ms === null ? "None" : fmtMs(e.ms)}{e.flowerError ? " !" : ""}</td>
                  <td className={e.beeMs == null ? "null" : ""} title={e.beeError ?? undefined}>{e.beeMs == null ? "None" : fmtMs(e.beeMs)}{e.beeError ? " !" : ""}</td>
                  <td className={`left ${e.grain == null ? "null" : ""}`} title={e.grain != null ? `flower v${e.grainVersion} (${e.grainCodeLength} characters):\n${e.grain}` : undefined}>{e.grain == null ? "None" : <code className="grain-text">{showGrain(e.grain, 16)}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.total > rows.out.length && <button className="btn btn-small btn-ghost" onClick={() => setLimit((l) => l + PAGE * 3)}>Show more</button>}
    </div>
  );
}

const Num = ({ v }: { v: number | null }) => <td className={v === null ? "null" : ""} title={v === null ? "None: not yours to see" : fmtEExact(v)}>{v === null ? "None" : fmtE(v)}</td>;

function IndexChip({ i, teams }: { i: number; teams: Team[] }) {
  const t = teams[i];
  return <span className="team-chip feed-chip" title={t?.name}><span className="mono idx">{i}</span><span className="swatch" style={{ background: t?.color }} /><span className="team-name">{t?.name ?? "?"}</span></span>;
}
