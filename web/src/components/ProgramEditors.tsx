// My team's three programs: edit, check, submit and try them.
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { storage } from "../hooks";
import { KINDS, type CheckResult, type GameView, type Kind, type TryBeeResult, type TryFlowerResult } from "../types";
import { CodeEditor, type EditorStats } from "./CodeEditor";
import { Alert, Meter, Spinner } from "./ui";
import { BeeGlyph, CheckIcon, DropIcon, FlowerHead, FooledIcon } from "./Icons";
import { showValue, timeAgo } from "../lib/format";

const BLURB: Record<Kind, string> = {
  clover: "Your honest flower. Bees that feed here get nectar. flower(challenge) must always give the same response to the same challenge.",
  orchid: "Your trickster. Bees that feed here get nothing, but your patch still earns the visit. It can try to pass for any clover that bees trust: yours or another team's.",
  bee: "Your bee visits one flower at a time: ask questions, then feed or leave. Top-level variables last the whole round.",
};

function exampleChallenges(type: string): string {
  if (type === "int") return "1, 2, 3, 42, 100, 500";
  if (type === "float") return "0.5, 1.25, 3.14";
  if (type === "bool") return "true, false";
  if (type === "str") return '"hello", "bee", ""';
  if (type.startsWith("list[")) {
    const inner = type.slice(5, -1);
    const e = inner === "int" ? "[1, 2, 3], [42], []" : inner === "float" ? "[0.5, 1.5], []" : inner === "bool" ? "[true, false], []" : inner === "str" ? '["a", "b"], []' : "[]";
    return e;
  }
  return "";
}

function parseChallenges(text: string): unknown[] {
  const src = text.trim().replace(/\n+/g, ",").replace(/,\s*$/, "");
  if (!src) return [];
  try {
    return JSON.parse(`[${src}]`);
  } catch {
    // Accept Python spellings too.
    const py = src.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null").replace(/'/g, '"');
    return JSON.parse(`[${py}]`);
  }
}

export function ProgramEditors({ view, base }: { view: GameView; base: string }) {
  const team = view.myTeam!;
  const cfg = view.game.config;
  const g = view.game;
  const keyBase = `dbc:code:${g.id}:${team.id}:${g.roundsPlayed}:${cfg.language}:${cfg.challengeType}:${cfg.responseType}`;
  const baseFor = (k: Kind) => team.drafts[k]?.code ?? team.previous[k] ?? view.starters[k];

  const [kind, setKind] = useState<Kind>(() => (storage.get("dbc:tab") as Kind) || "clover");
  const [code, setCode] = useState<Record<Kind, string>>(() => Object.fromEntries(KINDS.map((k) => [k, initialCode(k)])) as Record<Kind, string>);

  function initialCode(k: Kind): string {
    const saved = storage.get(`${keyBase}:${k}`);
    if (saved !== null) return saved;
    // Unsubmitted edits from before the last round ran carry over to this one.
    const oldKey = `dbc:code:${g.id}:${team.id}:${g.roundsPlayed - 1}:${cfg.language}:${cfg.challengeType}:${cfg.responseType}:${k}`;
    const old = g.roundsPlayed > 0 ? storage.get(oldKey) : null;
    if (old !== null) {
      storage.set(oldKey, null);
      if (old !== baseFor(k)) { storage.set(`${keyBase}:${k}`, old); return old; }
    }
    return baseFor(k);
  }
  const [stats, setStats] = useState<Partial<Record<Kind, EditorStats | null>>>({});
  const [result, setResult] = useState<Partial<Record<Kind, { check?: CheckResult; error?: string; action: "check" | "submit" }>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showPrev, setShowPrev] = useState(false);

  // When a teammate submits (or the server's version changes) and we have no local edits, follow it.
  const lastBase = useRef<Record<Kind, string>>(Object.fromEntries(KINDS.map((k) => [k, baseFor(k)])) as Record<Kind, string>);
  const [incoming, setIncoming] = useState<Partial<Record<Kind, boolean>>>({});
  useEffect(() => {
    for (const k of KINDS) {
      const b = baseFor(k);
      if (b === lastBase.current[k]) continue;
      const untouched = code[k] === lastBase.current[k];
      lastBase.current[k] = b;
      if (untouched) setCode((c) => ({ ...c, [k]: b }));
      else if (b !== code[k]) setIncoming((s) => ({ ...s, [k]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.drafts, team.previous, view.starters]);

  const edit = (k: Kind, v: string) => {
    setCode((c) => ({ ...c, [k]: v }));
    storage.set(`${keyBase}:${k}`, v === baseFor(k) ? null : v);
    setResult((r) => ({ ...r, [k]: undefined }));
  };

  const previous = team.previous[kind] ?? null;
  const budget = cfg.budgets[kind];
  const s = stats[kind];
  const draft = team.drafts[kind];
  const current = code[kind];
  const participant = g.roundsPlayed === 0 || !!view.participants?.includes(team.id);
  const locked = !!g.runningRound || g.status === "finished" || !participant;
  const overNodes = !!s && s.nodes > budget.nodes;
  const overChanges = !!s && s.distance !== null && s.distance > budget.changes;
  const blocked = !!s && (s.syntaxError || overNodes || overChanges);

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
        setIncoming((i) => ({ ...i, [kind]: false }));
      }
    } catch (e) {
      setResult((x) => ({ ...x, [kind]: { error: errorText(e), action: "submit" } }));
    } finally { setBusy(null); }
  };
  const revertTo = (which: "draft" | "previous" | "starter") => {
    const v = which === "draft" ? draft?.code : which === "previous" ? previous : view.starters[kind];
    if (v == null) return;
    if (current !== v && !confirm("Replace what's in the editor?")) return;
    edit(kind, v);
    setIncoming((i) => ({ ...i, [kind]: false }));
  };

  let status: React.ReactNode;
  if (draft && draft.code === current) status = <span className="ok-text"><CheckIcon size={15} /> Submitted by {draft.submittedBy} {timeAgo(draft.submittedAt)}. This plays in round {g.roundsPlayed + 1}.</span>;
  else if (draft) status = <span className="warn-text">You have changes that aren't submitted yet. The version {draft.submittedBy} submitted will play unless you submit again.</span>;
  else if (previous !== null && previous === current) status = <span className="muted">Not changed. Last round's program plays again unless you submit a new one.</span>;
  else if (previous !== null) status = <span className="warn-text">Unsubmitted changes. Last round's program plays again unless you submit.</span>;
  else status = <span className="warn-text">Not submitted yet. Your team needs all three programs submitted before round 1 to play.</span>;

  const r = result[kind];
  return (
    <div className="editors">
      <div className="tabs" role="tablist" aria-label="Your programs">
        {KINDS.map((k) => {
          const submitted = !!team.drafts[k];
          const dirty = code[k] !== baseFor(k);
          return (
            <button key={k} role="tab" aria-selected={kind === k} className={`tab ${kind === k ? "active" : ""}`}
              onClick={() => { setKind(k); storage.set("dbc:tab", k); }}>
              {k === "bee" ? <BeeGlyph color="#f2a541" size={20} /> : <FlowerHead color={k === "clover" ? "#6aa84f" : "#9b5de5"} size={18} />}
              <span className="tab-name">{k}</span>
              {submitted && !dirty && <span className="tab-mark ok" title="Submitted"><CheckIcon size={13} /></span>}
              {dirty && <span className="tab-mark dirty" title="Unsubmitted changes">•</span>}
            </button>
          );
        })}
      </div>

      <div className="editor-panel" role="tabpanel">
        <p className="muted small">{BLURB[kind]}</p>
        <div className="meters">
          <Meter label="Size (nodes)" value={s?.nodes ?? null} max={budget.nodes} />
          {previous !== null
            ? <Meter label="Changes since last round" value={s?.distance ?? null} max={budget.changes} />
            : <div className="meter-note muted">Round 1: write anything that fits the size budget. After that, each round you may change up to {budget.changes} nodes.</div>}
          <div className="meter-note muted">Time limit: {budget.ms} ms per {kind === "bee" ? "call" : "question"}</div>
        </div>
        {s?.syntaxError && <Alert kind="warn">Syntax error: this code doesn't parse yet, so it can't be submitted.</Alert>}
        {overNodes && <Alert kind="error">Too big: {s!.nodes} nodes, but the budget is {budget.nodes}. Make it {s!.nodes - budget.nodes} nodes smaller to submit (comments are free).</Alert>}
        {overChanges && <Alert kind="error">Too many changes: {s!.distance} edits since last round, but the budget is {budget.changes}. Undo {s!.distance! - budget.changes} to submit.</Alert>}
        {incoming[kind] && (
          <Alert kind="info">
            A teammate submitted a new {kind}. <button className="link-btn" onClick={() => revertTo(team.drafts[kind] ? "draft" : "previous")}>Load their version</button>
          </Alert>
        )}

        <CodeEditor key={`code:${kind}`} value={current} onChange={(v) => edit(kind, v)} language={cfg.language} previous={previous}
          onStats={(st) => setStats((x) => ({ ...x, [kind]: st }))} label={`${kind} program`} showPrevious={showPrev} />

        <div className="editor-bar">
          <div className="editor-buttons">
            <button className="btn" onClick={submit} disabled={locked || busy !== null || blocked} title={blocked ? "Fix the problems shown above first" : undefined}>
              {busy === "submit" ? "Submitting…" : `Submit ${kind}`}
            </button>
            <button className="btn btn-ghost" onClick={check} disabled={busy !== null}>{busy === "check" ? "Checking…" : "Check"}</button>
            {previous !== null && (
              <label className="check"><input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} /> compare with last round</label>
            )}
          </div>
          <label className="revert">
            <span className="sr-only">Start over from</span>
            <select value="" onChange={(e) => { revertTo(e.target.value as "draft" | "previous" | "starter"); e.target.value = ""; }}>
              <option value="" disabled>Start over from…</option>
              {draft && <option value="draft">the submitted version</option>}
              {previous !== null && <option value="previous">last round's version</option>}
              <option value="starter">the starter program</option>
            </select>
          </label>
        </div>
        <p className="small">{status}</p>
        {locked && (
          <p className="small muted">
            {g.status === "finished" ? "The game is over." : g.runningRound ? `Round ${g.runningRound} is running. You can submit again when it finishes.` : "Your team isn't playing in this game (it didn't submit all three programs before round 1)."}
          </p>
        )}
        {r?.error && <Alert kind="error">{r.error}</Alert>}
        {r?.check && (
          r.check.ok
            ? <Alert kind="ok">{r.action === "submit" ? "Submitted! " : "Looks good. "}{r.check.nodes} nodes{r.check.distance !== null ? `, ${r.check.distance} changes` : ""}.</Alert>
            : <Alert kind="error">{r.action === "submit" && <b>Not submitted: </b>}{r.check.errors.join(" · ")}</Alert>
        )}

        <TryPanel key={`try:${kind}`} kind={kind} code={current} base={base} challengeType={cfg.challengeType} />
      </div>
    </div>
  );
}

function TryPanel({ kind, code, base, challengeType }: { kind: Kind; code: string; base: string; challengeType: string }) {
  const [text, setText] = useState(() => storage.get(`dbc:try:${challengeType}`) ?? exampleChallenges(challengeType));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flower, setFlower] = useState<TryFlowerResult | null>(null);
  const [bee, setBee] = useState<TryBeeResult | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "bee") {
        setBee(await api<TryBeeResult>("POST", `${base}/try`, { kind, code }));
      } else {
        let challenges: unknown[];
        try { challenges = parseChallenges(text); } catch { throw new Error("Couldn't read the challenges. Write values separated by commas, like 1, 2, 3 or \"a\", \"b\"."); }
        storage.set(`dbc:try:${challengeType}`, text);
        setFlower(await api<TryFlowerResult>("POST", `${base}/try`, { kind, code, challenges }));
      }
    } catch (e) {
      setError(errorText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="try">
      <h3>Try it</h3>
      {kind === "bee" ? (
        <p className="small muted">Your bee forages a tiny garden of just your own two flowers (the ones you've submitted, else last round's, else the starters) for a whole round.</p>
      ) : (
        <label className="field">
          <span className="small">Challenges to ask your {kind} ({challengeType}), separated by commas:</span>
          <input value={text} onChange={(e) => setText(e.target.value)} className="mono" spellCheck={false} />
        </label>
      )}
      <button className="btn btn-ghost" onClick={run} disabled={busy}>{busy ? <Spinner label="Running…" /> : kind === "bee" ? "Try my bee" : `Ask my ${kind}`}</button>
      {error && <Alert kind="error">{error}</Alert>}

      {kind !== "bee" && flower && (
        flower.error ? <Alert kind="error">{flower.error}</Alert> : (
          <div className="table-scroll">
            <table className="data-table try-table">
              <thead><tr><th className="left">Challenge</th><th className="left">Response</th></tr></thead>
              <tbody>
                {flower.results.map((x, i) => (
                  <tr key={i}><td className="left mono">{showValue(x.c, 60)}</td><td className={`left mono ${x.error ? "bad" : ""}`}>{x.error ? `None (${x.error})` : showValue(x.r, 60)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {kind === "bee" && bee && (
        <div className="try-bee">
          <p>
            <b>{bee.visits.length}</b> visits · fed <b>{bee.feeds}</b> times · <DropIcon size={14} /> nectar <b>{bee.nectar}</b> · <FooledIcon size={14} /> fooled <b>{bee.feeds - bee.nectar}</b>
          </p>
          {(["bee", "clover", "orchid"] as Kind[]).map((k) => bee.problems?.[k] ? <Alert key={k} kind="error"><b>{k}:</b> {bee.problems[k]}</Alert> : null)}
          <div className="table-scroll tall">
            <table className="data-table log-table">
              <thead><tr><th>#</th><th>Turns</th><th className="left">Flower</th><th className="left">Questions → answers</th><th className="left">Result</th></tr></thead>
              <tbody>
                {bee.visits.map((v, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="nowrap">{v.start}–{v.end}</td>
                    <td className="left"><span className={`kind-pill ${v.kind}`}>your {v.kind}</span></td>
                    <td className="left"><Steps steps={v.steps} /></td>
                    <td className="left"><ActionText action={v.action} nectar={v.nectar} error={v.beeError} note={v.note} />{v.beeLog && <pre className="bee-log">{v.beeLog}</pre>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function Steps({ steps }: { steps?: { c: unknown; r: unknown; challengeError?: string; flowerError?: string }[] }) {
  if (!steps) return <span className="muted">hidden</span>;
  if (!steps.length) return <span className="muted">no questions</span>;
  return (
    <span className="steps">
      {steps.map((st, i) => (
        <span key={i} className={`step ${st.challengeError || st.flowerError ? "step-err" : ""}`} title={st.challengeError || st.flowerError || undefined}>
          <span className="mono">{showValue(st.c, 24)}</span><span className="arrow">→</span><span className="mono">{showValue(st.r, 24)}</span>
          {(st.challengeError || st.flowerError) && <span className="step-why">{st.challengeError ? "bad challenge" : "flower crashed"}</span>}
        </span>
      ))}
    </span>
  );
}

export function ActionText({ action, nectar, error, note }: { action: string; nectar: boolean | null; error?: string; note?: string }) {
  return (
    <span className="action">
      {action === "feed" && nectar && <span className="ok-text nowrap"><DropIcon size={14} /> fed: nectar</span>}
      {action === "feed" && !nectar && <span className="bad-text nowrap"><FooledIcon size={14} /> fed: no nectar</span>}
      {action === "leave" && <span className="muted">left</span>}
      {action === "error" && <span className="bad-text">mistake</span>}
      {error && <span className="err-detail mono">{error}</span>}
      {note && <span className="muted small"> ({note})</span>}
    </span>
  );
}
