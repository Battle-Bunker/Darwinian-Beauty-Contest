// My team's three programs: write, check, submit and try them. In the lobby writing is free. Once the
// game runs, a submission pays its change cost (node edits from the version playing now) from a change
// budget that fills with game time, and goes live at once.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, errorText } from "../api";
import { storage } from "../hooks";
import { KINDS, type Bank, type Budget, type CheckResult, type GameStatus, type GameView, type Kind, type ProgramInterface, type ProgramVersion, type Team, type TryBeeResult, type TryFlowerResult } from "../types";
import { CodeEditor, type EditorStats } from "./CodeEditor";
import { Alert, Meter, Spinner } from "./ui";
import { BeeGlyph, CheckIcon, DropIcon, FlowerHead, FooledIcon } from "./Icons";
import { fmtClock, fmtNodes, fmtWait, plural, timeAgo } from "../lib/format";
import { availableAt, waitFor } from "../lib/budget";
import { useLiveTick, type LiveStore } from "../lib/live";
import { Value } from "./Value";
import { FeedRow } from "./Feed";
import { beeTiming, flowerTiming, TimingPanel } from "./Timing";

const BLURB: Record<Kind, string> = {
  cosmos: "Your honest flower. Bees that feed here get nectar. flower(challenge) runs fresh for every question: it keeps nothing between questions, but it can use randomness and the clock to search for a good answer within its time limit.",
  orchid: "Your trickster. Bees that feed here get nothing, but your patch still earns the visit. It can try to pass for any cosmos that bees trust: yours or another team's.",
  bee: "Your bee visits one flower at a time: ask questions, then feed or leave. Its variables last for as long as this version plays; submitting a new bee (or a crash) starts it afresh. What it prints shows up for your team below and in the action feed.",
};

const SCALARS = ["int", "float", "bool", "str"];
const normType = (t: string) => t.toLowerCase().replace(/\s+/g, "");

/** How to type challenges for the Try box: a format hint, not a suggestion of what to ask. */
function challengeFormat(type: string): { label: string; placeholder: string } {
  const t = normType(type);
  if (SCALARS.includes(t)) {
    const ph = { int: "1, 2, 3", float: "0.5, 2.25", bool: "true, false", str: '"a", "bee"' }[t]!;
    return { label: `separated by commas`, placeholder: ph };
  }
  const one = t.startsWith("list[") ? "[1, 2]" : t.startsWith("tree[") ? '{"value": 1, "children": []}' : '{"nodes": 2, "edges": [[0, 1]]}';
  return { label: "as a JSON list of challenges (or one per line)", placeholder: `[${one}, ${one}]` };
}

const pyToJson = (src: string) => src.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null").replace(/'/g, '"');
const json = (src: string): unknown => { try { return JSON.parse(src); } catch { return JSON.parse(pyToJson(src)); } };

function parseChallenges(text: string, type: string): unknown[] {
  const src = text.trim();
  if (!src) return [];
  const t = normType(type);
  if (SCALARS.includes(t)) {
    const list = src.startsWith("[") ? src : `[${src.replace(/\n+/g, ",").replace(/,\s*$/, "")}]`;
    const v = json(list);
    return Array.isArray(v) ? v : [v];
  }
  try {
    const v = json(src);
    if (!Array.isArray(v)) return [v];                        // a single tree or graph
    if (t.startsWith("list[") && !v.some(Array.isArray)) return [v]; // a single list
    return v;
  } catch {
    return src.split("\n").filter((l) => l.trim()).map((l) => json(l.trim().replace(/,$/, "")));
  }
}

export const KindIcon = ({ kind, size = 18 }: { kind: Kind; size?: number }) =>
  kind === "bee" ? <BeeGlyph color="#f2a541" size={size + 2} />
  : kind === "cosmos" ? <FlowerHead color="#e0559a" petals={8} size={size} /> : <FlowerHead color="#9b5de5" size={size} />;

export function ProgramEditors({ view, base, store }: { view: GameView; base: string; store: LiveStore }) {
  const team = view.myTeam!;
  const g = view.game;
  const cfg = g.config;
  const mine: Team | undefined = view.teams.find((t) => t.id === team.id);
  const versionsOf = (k: Kind): ProgramVersion[] => mine?.programs?.[k] ?? [];
  const playingOf = (k: Kind) => versionsOf(k).at(-1) ?? null;
  const baseFor = (k: Kind) => playingOf(k)?.code ?? "";
  const keyBase = `dbc:draft:${g.id}:${team.id}:${cfg.language}:${cfg.challengeType}:${cfg.responseType}`;
  const live = g.status === "running" || g.status === "paused";
  const participant = !!view.participants?.includes(team.id);

  const [kind, setKind] = useState<Kind>(() => { const t = storage.get("dbc:tab") as Kind; return KINDS.includes(t) ? t : "cosmos"; });
  const [code, setCode] = useState<Record<Kind, string>>(() => Object.fromEntries(KINDS.map((k) => [k, storage.get(`${keyBase}:${k}`) ?? baseFor(k)])) as Record<Kind, string>);
  const [stats, setStats] = useState<Partial<Record<Kind, EditorStats | null>>>({});
  const [result, setResult] = useState<Partial<Record<Kind, { check?: CheckResult; error?: string; action: "check" | "submit" }>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showPrev, setShowPrev] = useState(false);

  // When a teammate submits and we have no local edits, follow them; otherwise offer their version.
  const lastBase = useRef<Record<Kind, string>>(Object.fromEntries(KINDS.map((k) => [k, baseFor(k)])) as Record<Kind, string>);
  const [incoming, setIncoming] = useState<Partial<Record<Kind, number>>>({});
  const playingKey = KINDS.map((k) => `${k}:${playingOf(k)?.version ?? 0}`).join(",");
  useEffect(() => {
    for (const k of KINDS) {
      const b = baseFor(k);
      if (b === lastBase.current[k]) continue;
      const untouched = code[k] === lastBase.current[k];
      lastBase.current[k] = b;
      if (untouched || code[k] === b) { setCode((c) => ({ ...c, [k]: b })); storage.set(`${keyBase}:${k}`, null); setIncoming((s) => ({ ...s, [k]: undefined })); }
      else setIncoming((s) => ({ ...s, [k]: playingOf(k)?.version }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingKey]);

  const edit = (k: Kind, v: string) => {
    setCode((c) => ({ ...c, [k]: v }));
    storage.set(`${keyBase}:${k}`, v === baseFor(k) ? null : v);
    setResult((r) => ({ ...r, [k]: undefined }));
  };

  const playing = playingOf(kind);
  const budget = cfg.budgets[kind];
  const s = stats[kind];
  const current = code[kind];
  const empty = !current.trim();
  const overSize = !!s && s.size > budget.size;
  const unchanged = !!playing && current === playing.code;
  const cost = live && playing ? (s?.distance ?? null) : 0;
  const canWrite = g.status === "lobby" || (live && participant);
  const blocked = empty || unchanged || (!!s && (s.syntaxError || overSize));

  const check = async () => {
    setBusy("check");
    try {
      const r = await api<CheckResult>("POST", `${base}/check`, { kind, code: current });
      setResult((x) => ({ ...x, [kind]: { check: r, action: "check" } }));
    } catch (e) {
      setResult((x) => ({ ...x, [kind]: { error: errorText(e), action: "check" } }));
    } finally { setBusy(null); }
  };
  const submit = async () => {
    setBusy("submit");
    try {
      const r = await api<CheckResult>("POST", `${base}/programs`, { kind, code: current }, [422]);
      setResult((x) => ({ ...x, [kind]: { check: r, action: "submit" } }));
      if (r.submitted) {
        storage.set(`${keyBase}:${kind}`, null);
        lastBase.current[kind] = current;
        setIncoming((i) => ({ ...i, [kind]: undefined }));
      }
    } catch (e) {
      setResult((x) => ({ ...x, [kind]: { error: errorText(e), action: "submit" } }));
    } finally { setBusy(null); }
  };
  const revertTo = (which: "playing" | "empty") => {
    const v = which === "playing" ? baseFor(kind) : "";
    if (current !== v && !confirm("Replace what's in the editor?")) return;
    edit(kind, v);
    setIncoming((i) => ({ ...i, [kind]: undefined }));
  };

  let status: React.ReactNode;
  if (!playing) status = <span className="warn-text">Not written yet. {g.status === "lobby" ? "Your team needs all three programs, saved, to play when the game starts." : ""}</span>;
  else if (unchanged) status = <span className="ok-text"><CheckIcon size={15} /> {g.status === "lobby" ? `Saved as v${playing.version} by ${playing.submittedBy} ${timeAgo(playing.submittedAt)}. This is what plays when the game starts.` : `This is v${playing.version}, playing now.`}</span>;
  else status = <span className="warn-text">Unsubmitted changes. {g.status === "lobby" ? `v${playing.version} is what's saved.` : `v${playing.version} keeps playing until you submit.`}</span>;

  const r = result[kind];
  const iface = useMemo(() => <InterfaceBox iface={view.interface} kind={kind} language={cfg.language} />, [view.interface, kind, cfg.language]);

  return (
    <div className="editors">
      <div className="tabs" role="tablist" aria-label="Your programs">
        {KINDS.map((k) => {
          const p = playingOf(k);
          const dirty = code[k] !== baseFor(k);
          return (
            <button key={k} role="tab" aria-selected={kind === k} className={`tab ${kind === k ? "active" : ""}`}
              onClick={() => { setKind(k); storage.set("dbc:tab", k); }}>
              <KindIcon kind={k} />
              <span className="tab-name">{k}</span>
              {p && <span className="tab-version">v{p.version}</span>}
              {p && !dirty && <span className="tab-mark ok" title={g.status === "lobby" ? "Saved" : "Playing now"}><CheckIcon size={13} /></span>}
              {dirty && <span className="tab-mark dirty" title="Unsubmitted changes">•</span>}
              {p?.problem && <span className="tab-mark bad" title={`Problem: ${p.problem}`}>!</span>}
            </button>
          );
        })}
      </div>

      <div className="editor-panel" role="tabpanel">
        <div className="editor-layout">
          <div className="editor-main">
            <p className="muted small">{BLURB[kind]}</p>
            {playing && live && (
              <p className="small playing-line">
                <b>Playing now: v{playing.version}</b> · {playing.size.toLocaleString()} nodes · {playing.atMs > 0 ? `live since ${fmtClock(playing.atMs)}` : "since the start"} · by {playing.submittedBy}
              </p>
            )}
            {playing?.problem && <Alert kind="error"><b>v{playing.version} hit a problem while playing:</b> <span className="mono">{playing.problem}</span></Alert>}
            <div className="meters">
              <Meter label="Size (nodes)" value={empty ? 0 : s?.size ?? null} max={budget.size} />
              {live && participant && mine?.banks?.[kind]
                ? <BudgetMeter store={store} budget={budget} bank={mine.banks[kind]!} cost={unchanged ? 0 : cost} status={g.status} kind={kind} />
                : <div className="meter-note muted">{g.status === "lobby" ? <>Writing programs before the game starts is <b>free</b>. Once it starts, every change costs change budget, which fills by {budget.perMinute.toLocaleString()} nodes a minute (up to {budget.cap.toLocaleString()}).</> : null}</div>}
            </div>
            <div className="meter-note muted small">Time limit: {budget.ms} ms per {kind === "bee" ? "call" : "question"}.</div>
            {s?.syntaxError && !empty && <Alert kind="warn">Syntax error: this code doesn't parse yet, so it can't be submitted.</Alert>}
            {overSize && <Alert kind="error">Too big: {s!.size.toLocaleString()} nodes, but the budget is {budget.size.toLocaleString()}. Make it {(s!.size - budget.size).toLocaleString()} nodes smaller to submit. Comments, spacing and name lengths are free; every byte of a string or number counts.</Alert>}
            {incoming[kind] !== undefined && (
              <Alert kind="info">
                A teammate submitted v{incoming[kind]} of your {kind}, and it's playing now. <button className="link-btn" onClick={() => revertTo("playing")}>Load it</button> (your edits will be replaced)
              </Alert>
            )}

            <CodeEditor key={`code:${kind}`} value={current} onChange={(v) => edit(kind, v)} language={cfg.language} previous={live && playing ? playing.code ?? null : null}
              onStats={(st) => setStats((x) => ({ ...x, [kind]: st }))} label={`${kind} program`} showPrevious={showPrev}
              previousLabel={playing ? `v${playing.version}, playing now` : "Before"} currentLabel="Your edit"
              placeholder={`Write your ${kind} here, from scratch.`} />
            {!empty && s?.minified && <details className="minified"><summary className="muted small">What actually runs: your program minified ({s.size.toLocaleString()} nodes)</summary><pre>{s.minified}</pre></details>}

            <SubmitBar store={store} status={g.status} kind={kind} busy={busy} canWrite={canWrite} blocked={blocked} empty={empty} unchanged={unchanged}
              cost={cost} budget={budget} bank={mine?.banks?.[kind] ?? null} live={live} onSubmit={submit} onCheck={check}
              extra={<>
                {live && playing && <label className="check"><input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} /> side by side with v{playing.version}</label>}
                <label className="revert">
                  <span className="sr-only">Start over from</span>
                  <select value="" onChange={(e) => { revertTo(e.target.value as "playing" | "empty"); e.target.value = ""; }}>
                    <option value="" disabled>Start over from…</option>
                    {playing && <option value="playing">{g.status === "lobby" ? `the saved version (v${playing.version})` : `the version playing now (v${playing.version})`}</option>}
                    <option value="empty">an empty editor</option>
                  </select>
                </label>
              </>} />
            <p className="small">{status}</p>
            {!canWrite && (
              <p className="small muted">
                {g.status === "finished" ? "The game is over." : "Your team isn't playing in this game: it hadn't written all three programs when the game started. You can still try programs out."}
              </p>
            )}
            {r?.error && <Alert kind="error">{r.error}</Alert>}
            {r?.check && (
              r.check.ok
                ? <Alert kind="ok">
                    {r.action === "submit"
                      ? (live ? <><b>v{r.check.version} is live.</b> It cost {plural(r.check.cost, "node")} of change budget; {fmtNodes(r.check.available ?? 0)} left.</> : <><b>Saved as v{r.check.version}.</b> {r.check.size.toLocaleString()} nodes.</>)
                      : <>Looks good: {r.check.size.toLocaleString()} nodes{live && r.check.distance !== null ? `; this change costs ${r.check.cost} of your ${r.check.available} available` : ""}.</>}
                  </Alert>
                : <Alert kind="error">{r.action === "submit" && <b>Not submitted: </b>}{r.check.errors.join(" · ")}</Alert>
            )}

            {live && participant && <LiveTiming store={store} teamId={team.id} kind={kind} limit={budget.ms} />}
            {kind === "bee" && live && <BeePrints store={store} teamId={team.id} />}
            <TryPanel key={`try:${kind}`} kind={kind} code={current} base={base} challengeType={cfg.challengeType}
              flowers={{ cosmos: code.cosmos, orchid: code.orchid }} view={view} />
          </div>
          {iface}
        </div>
      </div>
    </div>
  );
}

/**
 * The change budget for one program, filling in real time with the interpolated game clock, with this
 * change's cost marked on it.
 */
function BudgetMeter({ store, budget, bank, cost, status, kind }: { store: LiveStore; budget: Budget; bank: Bank; cost: number | null; status: GameStatus; kind: Kind }) {
  useLiveTick(store, 200, status === "running");
  const exact = availableAt(budget, bank, store.now());
  const whole = Math.floor(exact);
  const ratio = budget.cap > 0 ? exact / budget.cap : 0;
  const costRatio = cost && budget.cap > 0 ? Math.min(1, cost / budget.cap) : 0;
  const wait = cost !== null ? waitFor(budget, exact, cost) : 0;
  const affordable = cost !== null && cost <= whole;
  const full = exact >= budget.cap - 1e-9;
  return (
    <div className={`meter budget-meter ${cost && !affordable ? "short" : ""}`}>
      <div className="meter-label">
        <span>Change budget</span><b>{fmtNodes(exact)}</b><span className="muted">/ {budget.cap.toLocaleString()}</span>
        <span className="muted small budget-rate">{full ? "full" : `+${budget.perMinute.toLocaleString()} a minute`}</span>
      </div>
      <div className="meter-track budget-track">
        <div className="meter-fill budget-fill" style={{ transform: `scaleX(${Math.min(1, ratio).toFixed(4)})` }} />
        {cost !== null && cost > 0 && <div className="budget-cost" style={{ left: `${costRatio * 100}%` }} title={`This change costs ${cost}`} />}
      </div>
      <div className="budget-note small">
        {cost === null ? <span className="muted">Measuring the change…</span>
          : cost === 0 ? <span className="muted">No change from the version playing now (comments, spacing and renames are free).</span>
          : affordable ? <span className="ok-text">This change costs <b>{cost.toLocaleString()}</b>: affordable now.</span>
          : wait === null ? <span className="bad-text">This change costs <b>{cost.toLocaleString()}</b>, more than your {kind} can ever bank ({budget.cap.toLocaleString()}). Make it smaller.</span>
          : <span className="warn-text">This change costs <b>{cost.toLocaleString()}</b>: affordable in <b>{fmtWait(wait)}</b> of game time{status === "paused" ? " (once the game resumes)" : ""}.</span>}
      </div>
    </div>
  );
}

/** Submit and check, with the submit button counting down to when the change is affordable. */
function SubmitBar({ store, status, kind, busy, canWrite, blocked, empty, unchanged, cost, budget, bank, live, onSubmit, onCheck, extra }: {
  store: LiveStore; status: GameStatus; kind: Kind; busy: string | null; canWrite: boolean; blocked: boolean; empty: boolean; unchanged: boolean;
  cost: number | null; budget: Budget; bank: Bank | null; live: boolean; onSubmit: () => void; onCheck: () => void; extra: React.ReactNode;
}) {
  useLiveTick(store, 250, live && status === "running");
  const exact = live && bank ? availableAt(budget, bank, store.now()) : Infinity;
  const wait = live && bank && cost !== null ? waitFor(budget, exact, cost) : 0;
  const tooDear = live && (cost === null || wait !== 0);
  const label = busy === "submit" ? "Submitting…"
    : !live ? `Save ${kind}`
    : unchanged ? "Nothing to submit"
    : cost === null ? "Measuring…"
    : wait === null ? "Too big a change"
    : wait > 0 ? `Affordable in ${fmtWait(wait)}`
    : `Submit: goes live now (−${cost})`;
  return (
    <div className="editor-bar">
      <div className="editor-buttons">
        <button className={`btn ${live && !tooDear && !blocked ? "btn-honey" : ""}`} onClick={onSubmit} disabled={!canWrite || busy !== null || blocked || tooDear}
          title={empty ? "Write your program first" : blocked && !unchanged ? "Fix the problems shown above first" : undefined}>
          {label}
        </button>
        <button className="btn btn-ghost" onClick={onCheck} disabled={busy !== null || empty}>{busy === "check" ? "Checking…" : "Check"}</button>
        {extra}
      </div>
    </div>
  );
}

/** How long my program has been taking in this game, from the actions held (only my team sees these). */
function LiveTiming({ store, teamId, kind, limit }: { store: LiveStore; teamId: string; kind: Kind; limit: number }) {
  const rev = useLiveTick(store, 1000);
  const data = useMemo(() => (kind === "bee" ? beeTiming(store.actions, teamId) : flowerTiming(store.actions, teamId, kind)),
    [store, teamId, kind, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TimingPanel data={data} limit={limit}
      title={kind === "bee" ? "Your bee's decision times" : `Your ${kind}'s answer times`}
      unit={kind === "bee" ? "recent decisions" : "recent questions"}
      missLabel={kind === "bee" ? "too slow (lost a round)" : "no answer in time"} />
  );
}

/** What my bee printed lately (its own team sees this during the game). */
function BeePrints({ store, teamId }: { store: LiveStore; teamId: string }) {
  const rev = useLiveTick(store, 500);
  const prints = useMemo(() => {
    const out = [];
    for (let i = store.actions.length - 1; i >= 0 && out.length < 40; i--) {
      const a = store.actions[i];
      if (a.bee === teamId && a.log) out.push(a);
    }
    return out;
  }, [store, teamId, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <details className="prints" open>
      <summary><b>What your bee printed lately</b> <span className="muted small">({prints.length ? `the last ${prints.length}` : "nothing yet"}; only your team sees this until the game ends)</span></summary>
      {prints.length > 0 && (
        <ol className="prints-list">
          {prints.map((a) => (
            <li key={a.seq}><span className="mono muted small">{fmtClock(a.atMs, true)} · {a.action}{a.action === "feed" ? (a.nectar ? " (nectar)" : " (fooled)") : ""}</span><pre className="bee-log">{a.log}</pre></li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** What every team knows: the functions to define and the game's types. Deliberately no example code. */
function InterfaceBox({ iface, kind, language }: { iface: ProgramInterface; kind: Kind; language: "python" | "typescript" }) {
  const t = iface.types;
  const none = language === "python" ? "None" : "null";
  // Open beside the editor on wide screens; folded above it on phones (tap to read).
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1000px)").matches);
  return (
    <details className="iface" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><h3>The interface</h3>{!open && <span className="small muted"> what to define, and the types</span>}</summary>
      <p className="small muted">This is all anyone starts with. There's no example code: what your programs do is up to your team.</p>
      <div className="iface-label">{kind === "bee" ? "Your bee defines" : `Your ${kind} defines`}</div>
      <pre className="iface-sig">{kind === "bee" ? iface.bee : iface.flower}</pre>
      <dl className="iface-types">
        <dt>Challenge</dt><dd><code>{t.challenge}</code> {t.challengeMeans}</dd>
        <dt>Response</dt><dd><code>{t.response}</code> {t.responseMeans}</dd>
      </dl>
      {t.rules.length > 0 && <ul className="iface-rules">{t.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      <p className="small muted">
        Programs can also read <code>GAME</code> ({language === "python" ? 'GAME["feed_cost"]' : "GAME.feed_cost"}, challenge_type, response_type, max_len, max_nodes, round_ms, and ms: this program's time limit per call).
        {" "}A response of the wrong type, a crash or a timeout reaches the bee as <code>{none}</code>.
      </p>
    </details>
  );
}

function TryPanel({ kind, code, base, challengeType, flowers, view }: {
  kind: Kind; code: string; base: string; challengeType: string; flowers: { cosmos: string; orchid: string }; view: GameView;
}) {
  const [text, setText] = useState(() => storage.get(`dbc:try:${challengeType}`) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; soft?: boolean } | null>(null);
  const [flower, setFlower] = useState<TryFlowerResult | null>(null);
  const [bee, setBee] = useState<TryBeeResult | null>(null);
  const fmt = challengeFormat(challengeType);
  const bothFlowers = !!flowers.cosmos.trim() && !!flowers.orchid.trim();
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "bee") {
        if (!code.trim()) throw new Error("Write your bee first.");
        setBee(await api<TryBeeResult>("POST", `${base}/try`, { kind, code, ...(bothFlowers ? { flowers } : {}) }));
      } else {
        if (!code.trim()) throw new Error(`Write your ${kind} first.`);
        let challenges: unknown[];
        try { challenges = parseChallenges(text, challengeType); } catch {
          throw new Error(`Couldn't read the challenges. Write them ${fmt.label}, like ${fmt.placeholder}`);
        }
        storage.set(`dbc:try:${challengeType}`, text || null);
        setFlower(await api<TryFlowerResult>("POST", `${base}/try`, { kind, code, challenges }));
      }
    } catch (e) {
      // 409: the bee has no flowers to visit yet. That's advice, not a failure.
      if (e instanceof ApiError && e.status === 409) {
        setError({ soft: true, text: "Your bee needs flowers to visit. Write both your cosmos and your orchid (Try uses what's in their editors), or submit them, then try your bee again." });
      } else setError({ text: errorText(e) });
    } finally { setBusy(false); }
  };

  const visits = bee ? new Set(bee.actions.map((a) => a.visit)).size : 0;
  return (
    <div className="try">
      <h3>Try it</h3>
      {kind === "bee" ? (
        <p className="small muted">
          {bothFlowers
            ? "Your bee forages a tiny garden of just your own two flowers, as they are in your cosmos and orchid editors right now, for 300 rounds, run back to back (not in real time), with the real time limits."
            : "Your bee forages a tiny garden of just your own two flowers for 300 rounds, run back to back with the real time limits. Your cosmos and orchid editors aren't both filled in, so it visits the versions your team saved."}
        </p>
      ) : (
        <label className="field">
          <span className="small">Challenges to ask your {kind} (<code>{challengeType}</code>), {fmt.label}:</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} className="mono try-input" spellCheck={false}
            rows={SCALARS.includes(normType(challengeType)) ? 1 : 3} placeholder={fmt.placeholder} />
        </label>
      )}
      <button className="btn btn-ghost" onClick={run} disabled={busy}>{busy ? <Spinner label="Running…" /> : kind === "bee" ? "Try my bee" : `Ask my ${kind}`}</button>
      {error && <Alert kind={error.soft ? "info" : "error"}>{error.text}</Alert>}

      {kind !== "bee" && flower && !flower.error && flower.results.length > 0 && (
        <TimingPanel data={{ values: flower.results.filter((x) => !x.error && typeof x.ms === "number").map((x) => x.ms!), misses: flower.results.filter((x) => x.error).length }}
          limit={view.game.config.budgets[kind].ms} title={`How long your ${kind} took`} unit="questions" missLabel="no answer" />
      )}
      {kind !== "bee" && flower && (
        flower.error ? <Alert kind="error">{flower.error}</Alert> : (
          <div className="table-scroll">
            <table className="data-table try-table">
              <thead><tr><th className="left">Challenge</th><th className="left">Response</th><th>Time</th></tr></thead>
              <tbody>
                {flower.results.map((x, i) => (
                  <tr key={i}>
                    <td className="left"><Value v={x.c} role="challenge" max={60} /></td>
                    <td className={`left ${x.error ? "bad" : ""}`}>{x.error ? <span className="mono">{`None (${x.error})`}</span> : <Value v={x.r} role="response" max={60} />}</td>
                    <td className="nowrap">{typeof x.ms === "number" ? `${x.ms} ms` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {kind === "bee" && bee && (
        <div className="try-bee">
          <p>
            <b>{plural(visits, "visit")}</b> in <b>{bee.rounds.toLocaleString()}</b> rounds · fed <b>{bee.feeds}</b> times · <DropIcon size={14} /> nectar <b>{bee.nectar}</b> · <FooledIcon size={14} /> fooled <b>{bee.feeds - bee.nectar}</b>
          </p>
          {bee.problems.map((p, i) => <Alert key={i} kind="error"><b>{p.kind}:</b> {p.error}</Alert>)}
          <TimingPanel data={beeTiming(bee.actions, null)} limit={view.game.config.budgets.bee.ms} title="Your bee's decision times" unit="decisions" missLabel="too slow" />
          <ol className="feed-list try-list">
            {bee.actions.slice(0, 300).map((a) => <FeedRow key={a.seq} a={a} teams={teams} myTeamId={null} own budgets={view.game.config.budgets} />)}
          </ol>
          {bee.actions.length > 300 && <p className="small muted">…and {(bee.actions.length - 300).toLocaleString()} more actions.</p>}
        </div>
      )}
    </div>
  );
}
