// My team's two programs, the flower and the bee: write, check, submit and try them. In the lobby writing is
// free. Once the game runs, a submission pays its change cost (node edits from the live version) from a
// change budget that fills with game time, and is live at once: a turn under way keeps the versions it
// started with (a new flower answers the turns that start after it; a new bee takes over when its current
// turn is over, and is asked `first` straight away).
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import { storage } from "../hooks";
import { KINDS, type Bank, type Budget, type CheckResult, type GameStatus, type GameView, type Kind, type ProgramInterface, type ProgramVersion, type Team, type TryBeeResult, type TryFlowerResult } from "../types";
import { CodeEditor, type EditorStats } from "./CodeEditor";
import { Alert, Meter, Spinner } from "./ui";
import { BeeGlyph, CheckIcon, DropIcon, FlowerHead } from "./Icons";
import { fmtClock, fmtE, fmtEExact, fmtMs, fmtNodes, fmtWait, plural, timeAgo } from "../lib/format";
import { availableAt, waitFor } from "../lib/budget";
import { useLiveTick, type LiveStore } from "../lib/live";
import { Value } from "./Value";
import { FeedRow } from "./Feed";
import { beeTiming, flowerTiming, TimingPanel } from "./Timing";
import { MemoryEntries, memorySize, MemoryView } from "./Memory";
import { partsOfAction, ResponseView } from "./ResponseView";

/** When a submitted change takes effect (versions are pinned per turn). */
export const takesEffect = (kind: Kind) =>
  kind === "bee" ? "once your bee's current turn is over (it's asked first() straight away)" : "for turns that start from now (a turn under way finishes with the old one)";

const BLURB: Record<Kind, (lo: number, hi: number) => string> = {
  flower: (lo, hi) => `Your flower is a species: every visit is a bee meeting one of its flowers. flower(challenge) returns [response, percent]. It allocates its energy between compute, nectar and pollen: its size and its CPU time use up part of each visit's budget, leaving E = (size cap − size) × max(0, R − CPU ms), where R is this turn's time limit: hidden from the bee, varying from ${lo} to ${hi} ms, and told to your flower as GAME's ms; a bee that feeds gets percent% of E as nectar and the rest as pollen, which it carries to other flowers. An unfed visit's E is lost. It runs fresh for every turn and remembers nothing: it sees only its challenge and GAME.`,
  bee: () => "Your bee takes one turn a round at one flower of a random species, never told whose: first() gives a challenge when it has none queued, and decide(challenge, response) returns [\"feed\" or \"leave\", next challenge]. Feeding gets it nectar (and pollen to carry) and sits it out for the feed cost in rounds; if you define fed(nectar), it runs right after a feed decided in time, in the same program instance as that decide, is told the nectar, and may return the next challenge in place of decide's. Each turn runs fresh: only MEMORY, a tiny key–value store only the bee can write, carries over, and a new version starts it empty. What it prints shows up for your team below and in the feed.",
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
  kind === "bee" ? <BeeGlyph color="#f2a541" size={size + 2} /> : <FlowerHead color="#e0559a" petals={8} size={size} />;

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

  const [kind, setKind] = useState<Kind>(() => { const t = storage.get("dbc:tab") as Kind; return KINDS.includes(t) ? t : "flower"; });
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
  if (!playing) status = <span className="warn-text">Not written yet. {g.status === "lobby" ? "Your team needs both programs, saved, to play when the game starts." : ""}</span>;
  else if (unchanged) status = <span className="ok-text"><CheckIcon size={15} /> {g.status === "lobby" ? `Saved as v${playing.version} by ${playing.submittedBy} ${timeAgo(playing.submittedAt)}. This is what plays when the game starts.` : `This is v${playing.version}, the live version.`}</span>;
  else status = <span className="warn-text">Unsubmitted changes. {g.status === "lobby" ? `v${playing.version} is what's saved.` : `v${playing.version} keeps playing until you submit.`}</span>;

  const r = result[kind];
  const iface = useMemo(() => <InterfaceBox iface={view.interface} kind={kind} language={cfg.language} budgets={cfg.budgets} />, [view.interface, kind, cfg.language, cfg.budgets]);

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
              {p && !dirty && <span className="tab-mark ok" title={g.status === "lobby" ? "Saved" : "Live"}><CheckIcon size={13} /></span>}
              {dirty && <span className="tab-mark dirty" title="Unsubmitted changes">•</span>}
              {p?.problem && <span className="tab-mark bad" title={`Problem: ${p.problem}`}>!</span>}
            </button>
          );
        })}
      </div>

      <div className="editor-panel" role="tabpanel">
        <div className="editor-layout">
          <div className="editor-main">
            <p className="muted small">{BLURB[kind](cfg.budgets.flower.minMs ?? 50, cfg.budgets.flower.ms)}</p>
            {playing && live && (
              <p className="small playing-line">
                <b>Live: v{playing.version}</b> · {playing.size.toLocaleString()} nodes · {playing.atMs > 0 ? `since ${fmtClock(playing.atMs)}` : "since the start"} · by {playing.submittedBy}
                <span className="muted"> · a change applies {kind === "bee" ? "once your bee's current turn is over" : "to turns that start after it"}</span>
              </p>
            )}
            {playing?.problem && <Alert kind="error"><b>v{playing.version} hit a problem while playing:</b> <span className="mono">{playing.problem}</span></Alert>}
            <div className="meters">
              <Meter label="Size (nodes)" value={empty ? 0 : s?.size ?? null} max={budget.size} />
              {kind === "flower" && <EnergyMeter size={empty ? null : s?.size ?? null} cap={budget.size} ms={budget.ms} minMs={budget.minMs ?? 50} />}
              {live && participant && mine?.banks?.[kind]
                ? <BudgetMeter store={store} budget={budget} bank={mine.banks[kind]!} cost={unchanged ? 0 : cost} status={g.status} kind={kind} />
                : <div className="meter-note muted">{g.status === "lobby" ? <>Writing programs before the game starts is <b>free</b>. Once it starts, every change costs change budget, which fills by {budget.perMinute.toLocaleString()} nodes a minute (up to {budget.cap.toLocaleString()}).</> : null}</div>}
            </div>
            <div className="meter-note muted small">{kind === "bee" ? `Time limit: ${budget.ms} ms to decide (a late reply never feeds).` : `Your flower's time limit this turn is hidden and varies from ${budget.minMs ?? 50} to ${budget.ms} ms (it's the call's hard limit, E counts from it, and your flower reads it as GAME's ms); every millisecond of CPU costs energy. The response still reaches the bee at ${budget.ms} ms.`}</div>
            {s?.syntaxError && !empty && <Alert kind="warn">Syntax error: this code doesn't parse yet, so it can't be submitted.</Alert>}
            {overSize && <Alert kind="error">Too big: {s!.size.toLocaleString()} nodes, but the budget is {budget.size.toLocaleString()}. Make it {(s!.size - budget.size).toLocaleString()} nodes smaller to submit. Comments, spacing and name lengths are free; every byte of a string or number counts.</Alert>}
            {incoming[kind] !== undefined && (
              <Alert kind="info">
                A teammate submitted v{incoming[kind]} of your {kind}, and it's live now. <button className="link-btn" onClick={() => revertTo("playing")}>Load it</button> (your edits will be replaced)
              </Alert>
            )}

            <CodeEditor key={`code:${kind}`} value={current} onChange={(v) => edit(kind, v)} language={cfg.language} previous={live && playing ? playing.code ?? null : null}
              onStats={(st) => setStats((x) => ({ ...x, [kind]: st }))} label={`${kind} program`} showPrevious={showPrev}
              previousLabel={playing ? `v${playing.version}, live` : "Before"} currentLabel="Your edit"
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
                    {playing && <option value="playing">{g.status === "lobby" ? `the saved version (v${playing.version})` : `the live version (v${playing.version})`}</option>}
                    <option value="empty">an empty editor</option>
                  </select>
                </label>
              </>} />
            <p className="small">{status}</p>
            {!canWrite && (
              <p className="small muted">
                {g.status === "finished" ? "The game is over." : "Your team isn't playing in this game: it hadn't written both programs when the game started. You can still try programs out."}
              </p>
            )}
            {r?.error && <Alert kind="error">{r.error}</Alert>}
            {r?.check && (
              r.check.ok
                ? <Alert kind="ok">
                    {r.action === "submit"
                      ? (live ? <><b>v{r.check.version} is in</b>, {takesEffect(kind)}. It cost {plural(r.check.cost, "node")} of change budget; {fmtNodes(r.check.available ?? 0)} left.</> : <><b>Saved as v{r.check.version}.</b> {r.check.size.toLocaleString()} nodes.</>)
                      : <>Looks good: {r.check.size.toLocaleString()} nodes{live && r.check.distance !== null ? `; this change costs ${r.check.cost} of your ${r.check.available} available` : ""}.</>}
                  </Alert>
                : <Alert kind="error">{r.action === "submit" && <b>Not submitted: </b>}{r.check.errors.join(" · ")}</Alert>
            )}

            {live && participant && <LiveTiming store={store} teamId={team.id} kind={kind} limit={budget.ms} />}
            {kind === "bee" && live && mine?.memory && (
              <details className="prints" open>
                <summary><b>Your bee's MEMORY</b> <span className="muted small">(read only; only your team sees it until the game ends)</span></summary>
                <MemoryView memory={mine.memory} team={mine} view={view} own />
              </details>
            )}
            {kind === "bee" && live && <BeePrints store={store} teamId={team.id} />}
            <TryPanel key={`try:${kind}`} kind={kind} code={current} base={base} challengeType={cfg.challengeType}
              flowerCode={code.flower} view={view} />
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
          : cost === 0 ? <span className="muted">No change from the live version (comments, spacing and renames are free).</span>
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
    : `Submit (−${cost}): ${kind === "bee" ? "from its next visit" : "for new visits"}`;
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
  const data = useMemo(() => (kind === "bee" ? beeTiming(store.actions, teamId) : flowerTiming(store.actions, teamId)),
    [store, teamId, kind, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TimingPanel data={data} limit={limit}
      title={kind === "bee" ? "Your bee's decision times" : "Your flower's compute (CPU) times"}
      unit={kind === "bee" ? "recent turns" : "recent visits"}
      missLabel={kind === "bee" ? "too slow (no feed, lost turns)" : "no answer (E = 0)"} />
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
            <li key={a.seq}><span className="mono muted small">{fmtClock(a.atMs, true)} · {a.action}{a.action === "feed" && typeof a.nectar === "number" ? ` (${fmtE(a.nectar)} nectar)` : ""}</span><pre className="bee-log">{a.log}</pre></li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** What every team knows: the functions to define and the game's types. Deliberately no example code. */
function InterfaceBox({ iface, kind, language, budgets }: { iface: ProgramInterface; kind: Kind; language: "python" | "typescript"; budgets: Record<Kind, Budget> }) {
  const t = iface.types;
  const lo = budgets.flower.minMs ?? 50, hi = budgets.flower.ms;
  const none = language === "python" ? "None" : "null";
  // Open beside the editor on wide screens; folded above it on phones (tap to read).
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1000px)").matches);
  return (
    <details className="iface" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><h3>The interface</h3>{!open && <span className="small muted"> what to define, and the types</span>}</summary>
      <p className="small muted">This is all anyone starts with. There's no example code: what your programs do is up to your team.</p>
      <div className="iface-label">{kind === "bee" ? "Your bee defines" : "Your flower defines"}</div>
      <pre className="iface-sig">{kind === "bee" ? iface.bee : iface.flower}</pre>
      <dl className="iface-types">
        <dt>Challenge</dt><dd><code>{t.challenge}</code> {t.challengeMeans}</dd>
        <dt>Response</dt><dd><code>{t.response}</code> {t.responseMeans}</dd>
      </dl>
      {t.rules.length > 0 && <ul className="iface-rules">{t.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      <p className="small muted">
        Programs see only their arguments and <code>GAME</code>: {language === "python" ? 'GAME["team"]' : "GAME.team"} (your team's number), teams, feed_cost, challenge_type, response_type, max_len and max_nodes (challenge limits), max_response_bytes, round_ms, ms (this call's time limit: a bee's {budgets.bee.ms}; a flower's this call's hidden budget R, from {lo} to {hi}), flower_ms ({hi}, the most R can be) and flower_size_cap; a flower also gets size, its own; a bee also memory, its MEMORY cap. No program sees any history: your team can query it over the API. <code>time.time()</code>, <code>Date.now()</code> and <code>performance.now()</code> measure time since this call started (it reads as 1970-01-01); there is no real-world clock, and no round or game time.
        {kind === "bee" && <>
          {" "}A bee also has <code>MEMORY</code>: a flat key–value store (string keys; string, number, boolean or {none} values) that it changes inside first, decide and fed ({language === "python" ? "MEMORY[\"n\"] = 3" : "MEMORY.n = 3"}). It's saved after each of them if it fits in {language === "python" ? 'GAME["memory"]' : "GAME.memory"} bytes, each entry counting its key's bytes plus its value's JSON bytes ({'{"n": 7, "best": "a7"}'} is 2 + 8 = 10). It's the only thing a bee keeps from one turn to the next.
          {" "}Optional: <code>fed(nectar)</code> runs after a feed decided in time, in the same program instance as that decide (its globals still there), within {language === "python" ? 'GAME["ms"]' : "GAME.ms"}; MEMORY is saved after it, and a challenge it returns replaces the one decide queued ({none} or nothing keeps decide's).
        </>}
        {" "}A late answer, a crash, a malformed return or a response over max_response_bytes reaches the bee as <code>{none}</code> and makes no energy. A response over 4 KB is shown on the page as its size and first 4 KB.
      </p>
    </details>
  );
}

function TryPanel({ kind, code, base, challengeType, flowerCode, view }: {
  kind: Kind; code: string; base: string; challengeType: string; flowerCode: string; view: GameView;
}) {
  const [text, setText] = useState(() => storage.get(`dbc:try:${challengeType}`) ?? "");
  const [rounds, setRounds] = useState(300);
  // The flower's time budget R for a try: drawn at random per call (as in a game), or a fixed number of ms.
  const [budgetMode, setBudgetMode] = useState<"random" | "fixed">("random");
  const [budgetText, setBudgetText] = useState("100");
  const [memoryText, setMemoryText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flower, setFlower] = useState<TryFlowerResult | null>(null);
  const [bee, setBee] = useState<TryBeeResult | null>(null);
  const fmt = challengeFormat(challengeType);
  const cfg = view.game.config;
  const hasFlower = !!flowerCode.trim();
  const memoryCap = cfg.budgets.bee.memory ?? 50;
  // Whether this bee defines fed(nectar), from its code (the try run calls it after every feed, as a game does).
  const definesFed = kind === "bee" && (cfg.language === "python" ? /^def\s+fed\s*\(/m.test(code) : /(^|\n)\s*(export\s+)?(async\s+)?function\s+fed\s*\(|(^|\n)\s*(const|let|var)\s+fed\s*=/.test(code));
  const startSize = (() => { try { return memoryText.trim() ? memorySize(json(memoryText.trim())) : 0; } catch { return null; } })();
  const teams = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "bee") {
        if (!code.trim()) throw new Error("Write your bee first.");
        const n = Math.max(1, Math.min(5000, Math.round(rounds) || 300));
        let memory: unknown;
        if (memoryText.trim()) {
          try { memory = json(memoryText.trim()); } catch { throw new Error("Couldn't read the starting MEMORY: write it as JSON, like {\"n\": 3}."); }
          const size = memorySize(memory);
          if (size === null) throw new Error("A MEMORY is a flat key–value store: string keys, and string, number, boolean or null values (nothing nested).");
          if (size > memoryCap) throw new Error(`That MEMORY is ${size} bytes, over the cap of ${memoryCap}.`);
        }
        setBee(await api<TryBeeResult>("POST", `${base}/try`, { kind, code, rounds: n, ...(hasFlower ? { flower: flowerCode } : {}), ...(memory !== undefined ? { memory } : {}) }));
      } else {
        if (!code.trim()) throw new Error("Write your flower first.");
        let challenges: unknown[];
        try { challenges = parseChallenges(text, challengeType); } catch {
          throw new Error(`Couldn't read the challenges. Write them ${fmt.label}, like ${fmt.placeholder}`);
        }
        storage.set(`dbc:try:${challengeType}`, text || null);
        let budgetMs: number | "random" = "random";
        if (budgetMode === "fixed") {
          const n = Number(budgetText);
          const lo = cfg.budgets.flower.minMs ?? 50, hi = cfg.budgets.flower.ms;
          if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`The time budget R must be a number of ms from ${lo} to ${hi}.`);
          budgetMs = n;
        }
        setFlower(await api<TryFlowerResult>("POST", `${base}/try`, { kind, code, challenges, budgetMs }));
      }
    } catch (e) {
      setError(errorText(e));
    } finally { setBusy(false); }
  };

  const turns = bee ? bee.actions.filter((a) => a.action !== "arrive") : [];
  const fr = flower?.results ?? [];
  const energies = fr.map((x) => x.energy).filter((x): x is number => typeof x === "number");
  return (
    <div className="try">
      <h3>Try it</h3>
      {kind === "bee" ? (
        <>
          <p className="small muted">
            Your bee plays a garden of just your own flower ({hasFlower ? "as it is in your flower editor right now" : "your team's latest saved flower: your flower editor is empty"}), round after round, back to back rather than in real time, with the real time limits.
          </p>
          <details className="try-ledger">
            <summary className="small">Start the test bee with a MEMORY (optional; {"{}"} by default)</summary>
            <textarea value={memoryText} onChange={(e) => setMemoryText(e.target.value)} className="mono try-input" spellCheck={false} rows={2} placeholder='{"n": 3, "best": "a7"}'
              aria-label="Starting MEMORY for the test bee" />
            <span className={`small ${startSize === null || startSize > memoryCap ? "bad-text" : "muted"}`}>
              {startSize === null ? "Not a flat key–value store yet: string keys; string, number, boolean or null values." : `${startSize} of ${memoryCap} bytes.`}
              {" "}For this test run only: your game bee's MEMORY is never changed by anyone but the bee.
            </span>
          </details>
          <label className="field try-rounds"><span className="small">Rounds</span>
            <input type="number" min={1} max={5000} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span className="small">Challenges to ask your flower (<code>{challengeType}</code>), {fmt.label}:</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} className="mono try-input" spellCheck={false}
              rows={SCALARS.includes(normType(challengeType)) ? 1 : 3} placeholder={fmt.placeholder} />
          </label>
          <div className="row try-budget">
            <label className="feed-filter"><span className="small">Time budget R</span>
              <select value={budgetMode} onChange={(e) => setBudgetMode(e.target.value as "random" | "fixed")} aria-label="Time budget R for the try">
                <option value="random">random, {cfg.budgets.flower.minMs ?? 50}–{cfg.budgets.flower.ms} ms (as in a game)</option>
                <option value="fixed">fixed</option>
              </select>
            </label>
            {budgetMode === "fixed" && <label className="feed-filter"><input className="qc-num" inputMode="decimal" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} aria-label="Fixed time budget in ms" /><span className="small muted">ms</span></label>}
          </div>
        </>
      )}
      <button className="btn btn-ghost" onClick={run} disabled={busy}>{busy ? <Spinner label="Running…" /> : kind === "bee" ? "Try my bee" : "Ask my flower"}</button>
      {error && <Alert kind="error">{error}</Alert>}

      {kind === "flower" && flower && (
        flower.error ? <Alert kind="error">{flower.error}</Alert> : (
          <>
            {energies.length > 0 && (
              <p className="small">
                {typeof flower.size === "number" && <>At {flower.size.toLocaleString()} nodes, E = ({cfg.budgets.flower.size.toLocaleString()} − {flower.size.toLocaleString()}) × (R − CPU ms), R being each call's hidden time limit. </>}
                Excess energy per visit: typically <b>{fmtE(median(energies))}</b>, at most <b>{fmtE(Math.max(...energies))}</b> node·ms. A bee that feeds gets the percent you offer as nectar and the rest as pollen; a bee that leaves: nobody gets it.
              </p>
            )}
            <TimingPanel data={{ values: fr.filter((x) => !x.error && typeof x.ms === "number").map((x) => x.ms!), misses: fr.filter((x) => x.error).length }}
              limit={cfg.budgets.flower.ms} title="How long your flower took (CPU)" unit="calls" missLabel="no answer" />
            <div className="table-scroll">
              <table className="data-table try-table">
                <thead><tr><th className="left">Challenge</th><th className="left">Response</th><th>Percent</th><th>E (node·ms)</th><th title="The call's time budget R: its hard limit, and E counts from it">R ms</th><th>CPU ms</th></tr></thead>
                <tbody>
                  {fr.map((x, i) => (
                    <tr key={i}>
                      <td className="left"><Value v={x.c} role="challenge" max={60} /></td>
                      <td className={`left ${x.error ? "bad" : ""}`}>{x.error ? <span className="mono">{`None (${x.error})`}</span> : <ResponseView p={partsOfAction(x)} max={60} />}</td>
                      <td>{x.percent ?? "–"}</td>
                      <td title={fmtEExact(x.energy)}>{fmtE(x.energy)}</td>
                      <td className="nowrap">{fmtMs(x.budgetMs)}</td>
                      <td className="nowrap">{fmtMs(x.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {kind === "bee" && bee && (
        <div className="try-bee">
          <p>
            <b>{plural(turns.length, "turn")}</b> in <b>{bee.rounds.toLocaleString()}</b> rounds · fed <b>{bee.feeds}</b> {bee.feeds === 1 ? "time" : "times"} · <DropIcon size={14} /> nectar <b title={fmtEExact(bee.nectar)}>{fmtE(bee.nectar)}</b> · pollen <b title={fmtEExact(bee.pollen)}>{fmtE(bee.pollen)}</b>
          </p>
          {bee.problems.map((p, i) => <Alert key={i} kind="error"><b>{p.kind ?? "program"}{p.version ? ` v${p.version}` : ""}:</b> {p.error}</Alert>)}
          <p className="small">
            {definesFed
              ? <><span className="fed-ran">fed(nectar)</span> Your bee defines fed: it ran after each of the {plural(bee.feeds, "feed")}, in the same program instance as the decision, and MEMORY was saved after it (a challenge it returned was played next instead of decide's). What it printed shows with the turn after.</>
              : <span className="muted">Your bee doesn't define fed(nectar), so nothing runs after a feed.</span>}
          </p>
          {bee.memory !== undefined && <TryMemory memory={bee.memory} cap={memoryCap} />}
          <TimingPanel data={beeTiming(turns, null)} limit={cfg.budgets.bee.ms} title="Your bee's decision times" unit="turns" missLabel="too slow" />
          <ol className="feed-list try-list">
            {turns.slice(0, 300).map((a) => <FeedRow key={a.seq} a={a} teams={teams} myTeamId={null} own budgets={cfg.budgets} fedRuns={definesFed} />)}
          </ol>
          {turns.length > 300 && <p className="small muted">…and {(turns.length - 300).toLocaleString()} more turns.</p>}
        </div>
      )}
    </div>
  );
}

/** The test bee's MEMORY at the end: the server's { value, bytes, cap, error } (or, from an older server, just the value). */
function TryMemory({ memory, cap }: { memory: unknown; cap: number }) {
  const m = memory && typeof memory === "object" && "value" in memory && "bytes" in memory
    ? memory as { value: unknown; bytes: number; cap?: number; error?: string | null }
    : { value: memory, bytes: memorySize(memory) ?? 0, cap, error: null };
  return (
    <details className="try-ledger" open>
      <summary className="small">The test bee's MEMORY at the end: {m.bytes} of {m.cap ?? cap} bytes</summary>
      {m.error && <p className="small warn-text memory-empty">Its last save failed: <span className="mono">{m.error}</span></p>}
      <MemoryEntries value={m.value} label="The test bee's MEMORY at the end" />
    </details>
  );
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/** The flower's energy at this size: the most it can make a visit, (cap − size) × the whole window. */
function EnergyMeter({ size, cap, ms, minMs }: { size: number | null; cap: number; ms: number; minMs: number }) {
  const room = size === null ? null : Math.max(0, cap - size);
  const best = room === null ? null : room * ms;
  return (
    <div className="meter energy-meter" title="E = (size cap − size) × max(0, R − CPU ms), R the call's hidden time limit (at most the window): a smaller, faster flower makes more">
      <div className="meter-label"><span>Max E a visit</span><b>{best === null ? "–" : fmtE(best)}</b><span className="muted">node·ms</span></div>
      <div className="meter-track"><div className="meter-fill" style={{ width: `${room === null ? 0 : (room / Math.max(1, cap)) * 100}%` }} /></div>
      <div className="small muted">({cap.toLocaleString()} − {size ?? "size"}) × (R − CPU ms), with R at most {ms} ms (hidden from the bee, from {minMs} to {ms} ms each turn): every node and every millisecond you save is more to give as nectar and pollen.</div>
    </div>
  );
}
