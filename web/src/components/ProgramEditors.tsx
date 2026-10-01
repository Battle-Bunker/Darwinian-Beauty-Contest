// My team's three programs: edit, check, submit and try them.
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "../api";
import { storage } from "../hooks";
import { KINDS, type CheckResult, type GameView, type Kind, type ProgramInterface, type TryBeeResult, type TryFlowerResult } from "../types";
import { CodeEditor, type EditorStats } from "./CodeEditor";
import { Alert, Meter, Spinner } from "./ui";
import { BeeGlyph, CheckIcon, DropIcon, FlowerHead, FooledIcon } from "./Icons";
import { timeAgo } from "../lib/format";
import { isStructured, Value } from "./Value";

const BLURB: Record<Kind, string> = {
  clover: "Your honest flower. Bees that feed here get nectar. flower(challenge) must always give the same response to the same challenge.",
  orchid: "Your trickster. Bees that feed here get nothing, but your patch still earns the visit. It can try to pass for any clover that bees trust: yours or another team's.",
  bee: "Your bee visits one flower at a time: ask questions, then feed or leave. Top-level variables last the whole round.",
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

export function ProgramEditors({ view, base }: { view: GameView; base: string }) {
  const team = view.myTeam!;
  const cfg = view.game.config;
  const g = view.game;
  const keyBase = `dbc:code:${g.id}:${team.id}:${g.roundsPlayed}:${cfg.language}:${cfg.challengeType}:${cfg.responseType}`;
  // No starter code: a program starts from your team's draft, else last round's, else nothing.
  const baseFor = (k: Kind) => team.drafts[k]?.code ?? team.previous[k] ?? "";

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
  }, [team.drafts, team.previous]);

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
  const empty = !current.trim();
  const blocked = empty || (!!s && (s.syntaxError || overNodes || overChanges));

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
  const revertTo = (which: "draft" | "previous" | "empty") => {
    const v = which === "draft" ? draft?.code : which === "previous" ? previous : "";
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
        <div className="editor-layout">
        <div className="editor-main">
        <p className="muted small">{BLURB[kind]}</p>
        <div className="meters">
          <Meter label="Size (nodes)" value={empty ? 0 : s?.nodes ?? null} max={budget.nodes} />
          {previous !== null
            ? <Meter label="Changes since last round" value={s?.distance ?? null} max={budget.changes} />
            : <div className="meter-note muted">Round 1: write anything that fits the size budget. After that, each round you may change up to {budget.changes} nodes.</div>}
          <div className="meter-note muted">Time limit: {budget.ms} ms per {kind === "bee" ? "call" : "question"}</div>
        </div>
        {s?.syntaxError && !empty && <Alert kind="warn">Syntax error: this code doesn't parse yet, so it can't be submitted.</Alert>}
        {overNodes && <Alert kind="error">Too big: {s!.nodes} nodes, but the budget is {budget.nodes}. Make it {s!.nodes - budget.nodes} nodes smaller to submit (comments are free).</Alert>}
        {overChanges && <Alert kind="error">Too many changes: {s!.distance} edits since last round, but the budget is {budget.changes}. Undo {s!.distance! - budget.changes} to submit.</Alert>}
        {incoming[kind] && (
          <Alert kind="info">
            A teammate submitted a new {kind}. <button className="link-btn" onClick={() => revertTo(team.drafts[kind] ? "draft" : "previous")}>Load their version</button>
          </Alert>
        )}

        <CodeEditor key={`code:${kind}`} value={current} onChange={(v) => edit(kind, v)} language={cfg.language} previous={previous}
          onStats={(st) => setStats((x) => ({ ...x, [kind]: st }))} label={`${kind} program`} showPrevious={showPrev}
          placeholder={`Write your ${kind} here, from scratch.`} />

        <div className="editor-bar">
          <div className="editor-buttons">
            <button className="btn" onClick={submit} disabled={locked || busy !== null || blocked} title={empty ? "Write your program first" : blocked ? "Fix the problems shown above first" : undefined}>
              {busy === "submit" ? "Submitting…" : `Submit ${kind}`}
            </button>
            <button className="btn btn-ghost" onClick={check} disabled={busy !== null}>{busy === "check" ? "Checking…" : "Check"}</button>
            {previous !== null && (
              <label className="check"><input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} /> compare with last round</label>
            )}
          </div>
          <label className="revert">
            <span className="sr-only">Start over from</span>
            <select value="" onChange={(e) => { revertTo(e.target.value as "draft" | "previous" | "empty"); e.target.value = ""; }}>
              <option value="" disabled>Start over from…</option>
              {draft && <option value="draft">the submitted version</option>}
              {previous !== null && <option value="previous">last round's version</option>}
              <option value="empty">an empty editor</option>
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

        <TryPanel key={`try:${kind}`} kind={kind} code={current} base={base} challengeType={cfg.challengeType}
          flowers={{ clover: code.clover, orchid: code.orchid }} />
        </div>
        <InterfaceBox iface={view.interface} kind={kind} language={cfg.language} />
        </div>
      </div>
    </div>
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
        Programs can also read <code>GAME</code> ({language === "python" ? 'GAME["turns"]' : "GAME.turns"}, feed_cost, challenge_type, response_type, max_len, flowers).
        A response of the wrong type, a crash or a timeout reaches the bee as <code>{none}</code>.
      </p>
    </details>
  );
}

function TryPanel({ kind, code, base, challengeType, flowers }: {
  kind: Kind; code: string; base: string; challengeType: string; flowers: { clover: string; orchid: string };
}) {
  const [text, setText] = useState(() => storage.get(`dbc:try:${challengeType}`) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; soft?: boolean } | null>(null);
  const [flower, setFlower] = useState<TryFlowerResult | null>(null);
  const [bee, setBee] = useState<TryBeeResult | null>(null);
  const fmt = challengeFormat(challengeType);
  const bothFlowers = !!flowers.clover.trim() && !!flowers.orchid.trim();

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
        setError({ soft: true, text: "Your bee needs flowers to visit. Write both your clover and your orchid (Try uses what's in their editors), or submit them, then try your bee again." });
      } else setError({ text: errorText(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="try">
      <h3>Try it</h3>
      {kind === "bee" ? (
        <p className="small muted">
          {bothFlowers
            ? "Your bee forages a tiny garden of just your own two flowers, as they are in your clover and orchid editors right now, for a whole round."
            : "Your bee forages a tiny garden of just your own two flowers for a whole round. Your clover and orchid editors aren't both filled in, so it visits the flowers your team submitted (else last round's)."}
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

      {kind !== "bee" && flower && (
        flower.error ? <Alert kind="error">{flower.error}</Alert> : (
          <div className="table-scroll">
            <table className="data-table try-table">
              <thead><tr><th className="left">Challenge</th><th className="left">Response</th></tr></thead>
              <tbody>
                {flower.results.map((x, i) => (
                  <tr key={i}>
                    <td className="left"><Value v={x.c} role="challenge" max={60} /></td>
                    <td className={`left ${x.error ? "bad" : ""}`}>{x.error ? <span className="mono">{`None (${x.error})`}</span> : <Value v={x.r} role="response" max={60} />}</td>
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
  // Structured values (lists, trees, graphs) get one question per line, each expandable.
  const structured = steps.some((st) => isStructured(st.c) || isStructured(st.r));
  return (
    <span className={`steps ${structured ? "steps-col" : ""}`}>
      {steps.map((st, i) => (
        <span key={i} className={`step ${st.challengeError || st.flowerError ? "step-err" : ""}`} title={st.challengeError || st.flowerError || undefined}>
          <Value v={st.c} role="challenge" max={24} /><span className="arrow">→</span><Value v={st.r} role="response" max={24} />
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
