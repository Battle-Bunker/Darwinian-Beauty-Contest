// Logs for one round: a team's bee visits and the visitors to its flowers, plus its programs' problems.
// Your own team always; every team's visits after each round in games with public logs; everything once
// the game is finished and revealed.
import { useMemo, useState } from "react";
import { api, errorText } from "../api";
import { poss } from "../lib/format";
import { KINDS, type Compute, type GameView, type MemorySnapshot, type Round, type Team, type Visit } from "../types";
import { ActionText, Steps } from "./ProgramEditors";
import { Alert, Spinner, TeamChip } from "./ui";
import { CodeView } from "./CodeEditor";
import { UNITS } from "../lib/codetools";
import { DropIcon, FooledIcon } from "./Icons";
import { Value } from "./Value";

export function visibleTeams(view: GameView): string[] {
  const parts = view.participants ?? [];
  if (view.game.revealed || view.game.config.publicLogs) return parts;
  const mine = view.me?.teamId;
  return mine && parts.includes(mine) ? [mine] : [];
}

function TeamPicker({ view, ids, value, onChange, label }: { view: GameView; ids: string[]; value: string; onChange: (id: string) => void; label: string }) {
  if (ids.length < 2) return null;
  const teams = Object.fromEntries(view.teams.map((t) => [t.id, t]));
  return (
    <label className="picker">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {ids.map((id) => <option key={id} value={id}>{teams[id]?.name}{id === view.me?.teamId ? " (you)" : ""}</option>)}
      </select>
    </label>
  );
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

/** Indent a Python literal or JSON text by its brackets, only for the outer `depth` levels, so big data stays compact. */
export function prettyLiteral(src: string, depth = 2): string {
  let out = "", d = 0, quote: string | null = null, esc = false;
  const nl = (k: number) => "\n" + "  ".repeat(k);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if ("{[(".includes(ch)) {
      d++;
      out += ch;
      if (d <= depth && !"}])".includes(src[i + 1] ?? "")) out += nl(d);
      continue;
    }
    if ("}])".includes(ch)) {
      if (d <= depth && !"{[(".includes(src[i - 1] ?? "")) out += nl(d - 1);
      d--;
      out += ch;
      continue;
    }
    if (ch === ",") { out += ch; if (d <= depth) { out += nl(d); while (src[i + 1] === " ") i++; } continue; }
    out += ch;
  }
  return out;
}

function ComputeUse({ c }: { c: Compute }) {
  const ratio = c.budgetMs ? c.p90Ms / c.budgetMs : 0;
  return (
    <span className="compute" title={`${c.calls.toLocaleString()} calls · mean ${c.meanMs.toFixed(1)} ms · 90% of calls took at most ${c.p90Ms.toFixed(1)} ms · budget ${c.budgetMs} ms`}>
      <span className={`compute-bar ${ratio > 0.9 ? "hot" : ""}`}><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></span>
      <span className="nowrap">used <b>{Math.round(c.p90Ms)}</b> of {c.budgetMs} ms <span className="muted">(p90)</span></span>
      <span className="muted small nowrap">mean {c.meanMs < 10 ? c.meanMs.toFixed(1) : Math.round(c.meanMs)} ms · {c.calls.toLocaleString()} calls</span>
    </span>
  );
}

function MemoryPanel({ view, round, teamId, base, mine }: { view: GameView; round: Round; teamId: string; base: string; mine: boolean }) {
  const info = round.memory?.[teamId];
  const [snap, setSnap] = useState<MemorySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const pretty = useMemo(() => (snap?.snapshot ? prettyLiteral(snap.snapshot) : ""), [snap]);
  if (!info) return null;
  const load = async () => {
    setBusy(true); setError(null);
    try {
      setSnap(await api<MemorySnapshot>("GET", `${base}/memory/${round.no}${mine ? "" : `?team=${encodeURIComponent(teamId)}`}`));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const later = round.no < view.game.config.rounds;
  return (
    <div className="memory-box">
      <div className="memory-head">
        <div>
          <b>{mine ? "What your bee kept" : `What ${poss(view.teams.find((t) => t.id === teamId)?.name)} bee kept`} after round {round.no}:</b>{" "}
          {info.bytes ? fmtBytes(info.bytes) : "nothing"}
          {later && info.bytes > 0 && <span className="muted"> · it reads this as <code>MEMORY[{round.no - 1}]</code> in later rounds</span>}
          {info.note && <div className="small warn-text">{info.note}</div>}
        </div>
        {info.bytes > 0 && (snap
          ? <button className="btn btn-small btn-ghost" onClick={() => setSnap(null)}>Hide</button>
          : <button className="btn btn-small btn-ghost" onClick={load} disabled={busy}>{busy ? "Loading…" : "Show memory"}</button>)}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {snap && (
        <>
          <div className="row small">
            <span className="muted">{snap.language === "python" ? "A Python literal" : "Tagged JSON"} · {fmtBytes(snap.bytes)}</span>
            <label className="check"><input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw</label>
          </div>
          <pre className="memory-pre">{snap.snapshot === null ? "(nothing kept)" : raw ? snap.snapshot : pretty}</pre>
        </>
      )}
    </div>
  );
}

const PAGE = 40;

function Pager({ page, pages, onPage, total }: { page: number; pages: number; onPage: (p: number) => void; total: number }) {
  if (pages <= 1) return <span className="muted small">{total.toLocaleString()} {total === 1 ? "visit" : "visits"}</span>;
  return (
    <span className="pager">
      <button className="btn btn-small btn-ghost" onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">«</button>
      <button className="btn btn-small btn-ghost" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">‹</button>
      <span className="small">page {page + 1} of {pages} · {total.toLocaleString()} visits</span>
      <button className="btn btn-small btn-ghost" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">›</button>
      <button className="btn btn-small btn-ghost" onClick={() => onPage(pages - 1)} disabled={page >= pages - 1} aria-label="Last page">»</button>
    </span>
  );
}

type ResultFilter = "all" | "nectar" | "fooled" | "fed" | "left" | "error" | "studied";
const RESULT_FILTERS: [ResultFilter, string][] = [["all", "all results"], ["fed", "fed"], ["nectar", "fed: nectar"], ["fooled", "fed: no nectar"], ["studied", "studied after feeding"], ["left", "left"], ["error", "mistakes"]];
const matches = (v: Visit, f: ResultFilter) =>
  f === "all" || (f === "fed" && v.action === "feed") || (f === "nectar" && v.action === "feed" && !!v.nectar) ||
  (f === "fooled" && v.action === "feed" && !v.nectar) || (f === "left" && v.action === "leave") || (f === "error" && v.action === "error") ||
  (f === "studied" && v.action === "feed" && v.asks > (v.asksBeforeFeed ?? v.asks));
const studiedOf = (v: Visit) => (v.action === "feed" ? v.asks - Math.min(v.asks, v.asksBeforeFeed ?? v.asks) : 0);

interface Group { id: string; visits: number; asks: number; studied: number; fed: number; nectar: number; errors: number; fedClover: number; fedOrchid: number }
function groupBy(visits: Visit[], key: (v: Visit) => string): Group[] {
  const m = new Map<string, Group>();
  for (const v of visits) {
    const k = key(v);
    const g = m.get(k) ?? { id: k, visits: 0, asks: 0, studied: 0, fed: 0, nectar: 0, errors: 0, fedClover: 0, fedOrchid: 0 };
    g.visits++; g.asks += v.asks; g.studied += studiedOf(v);
    if (v.action === "feed") { g.fed++; if (v.nectar) g.nectar++; if (v.kind === "clover") g.fedClover++; if (v.kind === "orchid") g.fedOrchid++; }
    if (v.action === "error") g.errors++;
    m.set(k, g);
  }
  return [...m.values()];
}

export function Logs({ view, round, base }: { view: GameView; round: Round; base: string }) {
  const ids = visibleTeams(view);
  const [pick, setPick] = useState<string>(() => view.me?.teamId && ids.includes(view.me.teamId) ? view.me.teamId : ids[0] ?? "");
  const teamId = ids.includes(pick) ? pick : ids[0];
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);
  if (!teamId) {
    return (
      <p className="muted">
        {view.me?.teamId ? "Your team isn't playing in this game, so it has no logs." : "Join a team to see its private logs after each round."}
        {view.game.config.revealOnFinish ? " Everyone's logs are revealed when the game ends." : ""}
      </p>
    );
  }
  const team = teams[teamId];
  const mine = teamId === view.me?.teamId;
  const progs = round.programs[teamId];
  const who = mine ? "Your" : poss(team?.name);

  return (
    <div className="logs">
      <TeamPicker view={view} ids={ids} value={teamId} onChange={setPick} label="Show logs for" />
      <h3>{who} programs in round {round.no}</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th className="left">Program</th><th>Size</th><th>Changes</th><th className="left">Played</th><th className="left">Compute</th><th className="left">Problem</th></tr></thead>
          <tbody>
            {KINDS.map((k) => {
              const p = progs?.[k];
              return (
                <tr key={k}>
                  <th scope="row" className="left">{k}</th>
                  <td>{p?.size ?? "–"}<span className="muted small"> / {view.game.config.budgets[k].size}</span></td>
                  <td>{p?.distance ?? "–"}</td>
                  <td className="left">{p?.carriedOver ? "same as last round" : round.no === 1 ? "first version" : "new version"}</td>
                  <td className="left">{p?.compute ? <ComputeUse c={p.compute} /> : <span className="muted small">{k === "bee" ? `${view.game.config.budgets.bee.ms} ms per decision` : "–"}</span>}</td>
                  <td className={`left ${p?.problem ? "bad" : "muted"}`}>{p?.problem ? <span className="mono">{p.problem}</span> : "none"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(mine || view.game.revealed) && <MemoryPanel key={`${teamId}:${round.no}`} view={view} round={round} teamId={teamId} base={base} mine={mine} />}

      {!round.visits ? <p className="muted"><Spinner label="Loading this round's visits…" /></p> : (
        <>
          <BeeLog key={`bee:${teamId}:${round.no}`} view={view} visits={round.visits.filter((v) => v.bee === teamId)} who={who} teams={teams} />
          <FlowerLog key={`fl:${teamId}:${round.no}`} view={view} visits={round.visits.filter((v) => v.patch === teamId)} who={mine ? "your" : poss(team?.name)} teams={teams} />
        </>
      )}
    </div>
  );
}

function BeeLog({ view, visits, who, teams }: { view: GameView; visits: Visit[]; who: string; teams: Record<string, Team> }) {
  const [mode, setMode] = useState<"patch" | "answer" | "all">("patch");
  const [patch, setPatch] = useState<string>("");
  const [result, setResult] = useState<ResultFilter>("all");
  const [page, setPage] = useState(0);
  const order = view.participants ?? [];
  const byPatch = useMemo(() => {
    const g = Object.fromEntries(groupBy(visits, (v) => v.patch).map((x) => [x.id, x]));
    return order.filter((id) => g[id]).map((id) => g[id]);
  }, [visits, order]);
  // Which answers (before feeding) paid off: the bee's own labelled data.
  const byAnswer = useMemo(() => {
    const m = new Map<string, { key: string; responses: unknown[]; fed: number; nectar: number; patches: Set<string> }>();
    for (const v of visits) {
      if (v.action !== "feed" || !v.steps) continue;
      const before = v.steps.filter((s) => !s.after).map((s) => s.r);
      const key = JSON.stringify(before);
      const e = m.get(key) ?? { key, responses: before, fed: 0, nectar: 0, patches: new Set<string>() };
      e.fed++; if (v.nectar) e.nectar++; e.patches.add(v.patch);
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.fed - a.fed).slice(0, 40);
  }, [visits]);
  const filtered = useMemo(() => visits.filter((v) => (!patch || v.patch === patch) && matches(v, result)), [visits, patch, result]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const fed = visits.filter((v) => v.action === "feed").length, nectar = visits.filter((v) => v.nectar).length;
  const studied = visits.reduce((a, v) => a + studiedOf(v), 0);
  const showPatch = (id: string) => { setPatch(id); setResult("all"); setPage(0); setMode("all"); };

  return (
    <section className="log-section">
      <div className="log-head">
        <h3>{who} bee: {visits.length.toLocaleString()} visits</h3>
        <span className="small muted">{visits.reduce((a, v) => a + v.asks, 0).toLocaleString()} questions · fed {fed} · <DropIcon size={13} /> nectar {nectar} · <FooledIcon size={13} /> fooled {fed - nectar}{studied ? ` · ${studied} studied after feeding` : ""}</span>
      </div>
      <div className="seg" role="group" aria-label="How to show the bee's visits">
        <button className={mode === "patch" ? "active" : ""} aria-pressed={mode === "patch"} onClick={() => setMode("patch")}>By patch</button>
        <button className={mode === "answer" ? "active" : ""} aria-pressed={mode === "answer"} onClick={() => setMode("answer")}>By answer</button>
        <button className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")}>All visits</button>
      </div>
      {visits.length === 0 ? <p className="muted">The bee didn't visit any flowers this round.</p> : mode === "patch" ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th className="left">Patch</th><th>Visits</th><th>Questions</th><th title="Questions asked after feeding">Studied</th><th>Fed</th><th>Nectar</th><th>Fooled</th><th>Mistakes</th><th /></tr></thead>
            <tbody>
              {byPatch.map((g) => (
                <tr key={g.id}>
                  <th scope="row" className="left"><TeamChip team={teams[g.id]} you={g.id === view.me?.teamId} short /></th>
                  <td>{g.visits}</td><td>{g.asks}</td><td>{g.studied}</td><td>{g.fed}</td>
                  <td className="good-num">{g.nectar}</td><td className="bad">{g.fed - g.nectar}</td><td>{g.errors}</td>
                  <td><button className="link-btn small" onClick={() => showPatch(g.id)}>visits</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : mode === "answer" ? (
        byAnswer.length === 0 ? <p className="muted">{visits.some((v) => v.steps) ? "The bee didn't feed this round." : "Hidden."}</p> : (
          <>
            <p className="small muted">What the flower had answered before your bee fed, and what feeding gave. The {byAnswer.length} most common answers.</p>
            <div className="table-scroll tall">
              <table className="data-table log-table">
                <thead><tr><th className="left">Answers before feeding</th><th>Fed</th><th>Nectar</th><th>Rate</th><th className="left">Patches</th></tr></thead>
                <tbody>
                  {byAnswer.map((a) => (
                    <tr key={a.key}>
                      <td className="left"><span className="answers">{a.responses.map((r, i) => <Value key={i} v={r} role="response" max={30} />)}</span></td>
                      <td>{a.fed}</td><td className="good-num">{a.nectar}</td><td>{Math.round((a.nectar / a.fed) * 100)}%</td>
                      <td className="left"><span className="chips">{[...a.patches].map((id) => <TeamChip key={id} team={teams[id]} short />)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <>
          <div className="log-filters">
            <select value={patch} onChange={(e) => { setPatch(e.target.value); setPage(0); }} aria-label="Patch">
              <option value="">every patch</option>
              {order.map((id) => <option key={id} value={id}>{teams[id]?.name}</option>)}
            </select>
            <select value={result} onChange={(e) => { setResult(e.target.value as ResultFilter); setPage(0); }} aria-label="Result">
              {RESULT_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Pager page={pg} pages={pages} onPage={setPage} total={filtered.length} />
          </div>
          <div className="table-scroll tall">
            <table className="data-table log-table">
              <thead><tr><th>#</th><th>Turns</th><th className="left">Patch</th><th className="left">Questions → answers</th><th className="left">Result</th></tr></thead>
              <tbody>
                {filtered.slice(pg * PAGE, pg * PAGE + PAGE).map((v) => (
                  <tr key={v.seq}>
                    <td>{v.seq + 1}</td>
                    <td className="nowrap">{v.start}–{v.end}</td>
                    <td className="left"><span className="nowrap"><TeamChip team={teams[v.patch]} you={v.patch === view.me?.teamId} short />{v.kind && <span className={`kind-pill ${v.kind}`}>{v.kind}</span>}</span></td>
                    <td className="left"><Steps steps={v.steps} /></td>
                    <td className="left">
                      <ActionText action={v.action} nectar={v.nectar} error={v.beeError} note={v.note} />
                      {v.beeLog && <pre className="bee-log" aria-label="What the bee printed">{v.beeLog}</pre>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function FlowerLog({ view, visits, who, teams }: { view: GameView; visits: Visit[]; who: string; teams: Record<string, Team> }) {
  const [mode, setMode] = useState<"bee" | "all">("bee");
  const [bee, setBee] = useState("");
  const [kind, setKind] = useState("");
  const [result, setResult] = useState<ResultFilter>("all");
  const [page, setPage] = useState(0);
  const order = view.participants ?? [];
  const flowerSteps = view.game.config.flowerLogs || view.game.config.publicLogs || view.game.revealed;
  const byBee = useMemo(() => {
    const g = Object.fromEntries(groupBy(visits, (v) => v.bee).map((x) => [x.id, x]));
    return order.filter((id) => g[id]).map((id) => g[id]);
  }, [visits, order]);
  const sorted = useMemo(() => [...visits].sort((a, b) => a.start - b.start), [visits]);
  const filtered = useMemo(() => sorted.filter((v) => (!bee || v.bee === bee) && (!kind || v.kind === kind) && matches(v, result)), [sorted, bee, kind, result]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const showBee = (id: string) => { setBee(id); setKind(""); setResult("all"); setPage(0); setMode("all"); };

  return (
    <section className="log-section">
      <div className="log-head">
        <h3>Visitors to {who} flowers: {visits.length.toLocaleString()}</h3>
        <span className="small muted">fed at the clover {visits.filter((v) => v.action === "feed" && v.kind === "clover").length} · at the orchid {visits.filter((v) => v.action === "feed" && v.kind === "orchid").length}</span>
      </div>
      {!flowerSteps && <Alert kind="info">Flower logs are off in this game: you see who visited and what happened, but not what they asked.</Alert>}
      <div className="seg" role="group" aria-label="How to show visitors">
        <button className={mode === "bee" ? "active" : ""} aria-pressed={mode === "bee"} onClick={() => setMode("bee")}>By bee</button>
        <button className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => setMode("all")}>All visits</button>
      </div>
      {visits.length === 0 ? <p className="muted">No bee visited this patch.</p> : mode === "bee" ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th className="left">Bee</th><th>Visits</th><th>Questions</th><th title="Questions asked after feeding">Studied</th><th>Fed at clover</th><th>Fed at orchid</th><th>Mistakes</th><th /></tr></thead>
            <tbody>
              {byBee.map((g) => (
                <tr key={g.id}>
                  <th scope="row" className="left"><TeamChip team={teams[g.id]} you={g.id === view.me?.teamId} short /></th>
                  <td>{g.visits}</td><td>{g.asks}</td><td>{g.studied}</td><td className="good-num">{g.fedClover}</td><td>{g.fedOrchid}</td><td>{g.errors}</td>
                  <td><button className="link-btn small" onClick={() => showBee(g.id)}>visits</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="log-filters">
            <select value={bee} onChange={(e) => { setBee(e.target.value); setPage(0); }} aria-label="Bee">
              <option value="">every bee</option>
              {order.map((id) => <option key={id} value={id}>{teams[id]?.name}</option>)}
            </select>
            <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} aria-label="Flower">
              <option value="">both flowers</option><option value="clover">clover</option><option value="orchid">orchid</option>
            </select>
            <select value={result} onChange={(e) => { setResult(e.target.value as ResultFilter); setPage(0); }} aria-label="Result">
              {RESULT_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Pager page={pg} pages={pages} onPage={setPage} total={filtered.length} />
          </div>
          <div className="table-scroll tall">
            <table className="data-table log-table">
              <thead><tr><th>Turns</th><th className="left">Bee</th><th className="left">Flower</th><th className="left">Questions → answers</th><th className="left">Result</th></tr></thead>
              <tbody>
                {filtered.slice(pg * PAGE, pg * PAGE + PAGE).map((v) => (
                  <tr key={`${v.bee}:${v.seq}`}>
                    <td className="nowrap">{v.start}–{v.end}</td>
                    <td className="left"><TeamChip team={teams[v.bee]} you={v.bee === view.me?.teamId} short /></td>
                    <td className="left">{v.kind ? <span className={`kind-pill ${v.kind}`}>{v.kind}</span> : <span className="muted">?</span>}</td>
                    <td className="left">{flowerSteps ? <Steps steps={v.steps} /> : <span className="muted">{v.asks} {v.asks === 1 ? "question" : "questions"}</span>}</td>
                    <td className="left">
                      <ActionText action={v.action} nectar={v.nectar} />
                      {v.flowerError && <span className="err-detail mono">flower: {v.flowerError}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function CodeBrowser({ view, round }: { view: GameView; round: Round }) {
  const ids = visibleTeams(view).filter((id) => round.programs[id]?.bee?.code !== undefined);
  const [pick, setPick] = useState<string>(() => view.me?.teamId && ids.includes(view.me.teamId) ? view.me.teamId : ids[0] ?? "");
  const [kind, setKind] = useState<"clover" | "orchid" | "bee">("clover");
  const [compare, setCompare] = useState(false);
  const teamId = ids.includes(pick) ? pick : ids[0];
  if (!teamId) return <p className="muted">Code stays secret until the game ends{view.game.config.revealOnFinish ? "" : " (and this game never reveals it)"}. Your own team's code shows here once a round has played.</p>;
  const prog = round.programs[teamId]?.[kind];
  const prevRound = view.rounds.find((r) => r.no === round.no - 1);
  const prev = prevRound?.programs[teamId]?.[kind]?.code ?? null;
  return (
    <div className="code-browser">
      <div className="row">
        <TeamPicker view={view} ids={ids} value={teamId} onChange={setPick} label="Team" />
        <div className="seg" role="group" aria-label="Program">
          {KINDS.map((k) => <button key={k} className={kind === k ? "active" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}
        </div>
        {prev !== null && <label className="check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> compare with round {round.no - 1}</label>}
      </div>
      {prog?.code !== undefined ? (
        <>
          <p className="small muted">
            {prog.size} {UNITS[view.game.config.complexity]}{prog.distance !== null ? ` · ${prog.distance} changes from round ${round.no - 1}` : ""}{prog.carriedOver ? " · same as last round" : ""}
            {prog.problem ? <> · <span className="bad-text">problem: {prog.problem}</span></> : null}
          </p>
          <CodeView key={`${teamId}:${kind}:${round.no}`} code={prog.code} language={view.game.config.language} mode={view.game.config.complexity} previous={prev} showPrevious={compare} label={`${kind} code`} />
        </>
      ) : <p className="muted">No code for this program.</p>}
    </div>
  );
}
