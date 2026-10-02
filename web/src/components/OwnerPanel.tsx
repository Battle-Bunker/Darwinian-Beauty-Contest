// Owner controls: game settings (lobby only), start, pause / resume and finish. Plus a settings summary for everyone.
import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api";
import { KINDS, type GameConfig, type GameView, type Kind, type Team } from "../types";
import { Alert, TeamChip } from "./ui";
import { PauseIcon, PlayIcon } from "./Icons";
import { fmtClock } from "../lib/format";

const TYPES = ["int", "float", "bool", "str", "any", "list[int]", "list[float]", "list[bool]", "list[str]", "tree[int]", "graph", "digraph", "graph[any]", "graph[int]", "digraph[any]"];

/** Whether a team has written all three programs (it plays if the game starts now). */
export const isReady = (t: Team) => !!t.ready && KINDS.every((k) => t.ready![k]);

export function OwnerControls({ view, base }: { view: GameView; base: string }) {
  const g = view.game;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = view.teams.filter(isReady);
  const notReady = view.teams.filter((t) => !isReady(t));

  const call = async (what: string, path: string, body?: unknown) => {
    setBusy(what); setError(null);
    try { await api("POST", `${base}${path}`, body); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  };
  const finish = () => { if (confirm("Finish the game now? It can't be resumed afterwards.")) call("finish", "/status", { action: "finish" }); };

  return (
    <div className="owner-controls">
      {g.status === "lobby" && (
        <>
          <div className="row">
            <button className="btn btn-big btn-honey" onClick={() => call("start", "/start")} disabled={busy !== null || ready.length < 2}>
              <PlayIcon /> {busy === "start" ? "Starting…" : "Start the game"}
            </button>
            <span className="small muted">{fmtClock(g.endMs)} of game time. Settings lock once it starts; teams that haven't written all three programs sit it out.</span>
          </div>
          <div className="who-plays">
            <div><b>{ready.length ? `${ready.length} ${ready.length === 1 ? "team" : "teams"} will play:` : "Nobody is ready yet."}</b> {ready.map((t) => <TeamChip key={t.id} team={t} />)}</div>
            {notReady.length > 0 && <div className="small muted">Not ready (missing a program): {notReady.map((t) => <span key={t.id} className="not-ready">{t.name} <span className="mono">({KINDS.filter((k) => !t.ready?.[k]).join(", ")})</span></span>)}</div>}
            {ready.length < 2 && <div className="small warn-text">The game needs at least 2 teams with all three programs written.</div>}
          </div>
        </>
      )}
      {g.status === "running" && (
        <div className="row">
          <button className="btn btn-big" onClick={() => call("pause", "/status", { action: "pause" })} disabled={busy !== null}><PauseIcon /> {busy === "pause" ? "Pausing…" : "Pause"}</button>
          <button className="btn btn-ghost" onClick={finish} disabled={busy !== null}>{busy === "finish" ? "Finishing…" : "Finish early"}</button>
          <span className="small muted">Pausing stops the clock and the change budgets; teams can still submit changes they can afford.</span>
        </div>
      )}
      {g.status === "paused" && (
        <div className="row">
          <button className="btn btn-big btn-honey" onClick={() => call("resume", "/status", { action: "resume" })} disabled={busy !== null}><PlayIcon /> {busy === "resume" ? "Resuming…" : "Resume"}</button>
          <button className="btn btn-ghost" onClick={finish} disabled={busy !== null}>{busy === "finish" ? "Finishing…" : "Finish now"}</button>
        </div>
      )}
      {g.status === "finished" && <p className="muted">The game is over.{g.revealed ? " All code and every bee's prints are now public." : ""}</p>}
      {g.lastError && <Alert kind="error"><b>The garden stopped with an error</b> (resume to carry on): {g.lastError}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

export function SettingsForm({ view, base }: { view: GameView; base: string }) {
  const cfg: GameConfig = view.game.config;
  const [draft, setDraft] = useState<GameConfig>(cfg);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const cfgKey = JSON.stringify(cfg);
  useEffect(() => { setDraft(JSON.parse(cfgKey)); }, [cfgKey]);
  const dirty = JSON.stringify(draft) !== cfgKey;

  const set = <K extends keyof GameConfig>(k: K, v: GameConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setBudget = (kind: Kind, k: "size" | "perMinute" | "cap" | "ms", v: number) =>
    setDraft((d) => ({ ...d, budgets: { ...d.budgets, [kind]: { ...d.budgets[kind], [k]: v } } }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ config: GameConfig; clearedPrograms: boolean }>("PATCH", `${base}/config`, { config: draft });
      setMsg(r.clearedPrograms
        ? { kind: "warn", text: "Saved. Teams' programs were cleared because the language, types or a size budget changed, so they need to write them again." }
        : { kind: "ok", text: "Saved." });
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally { setBusy(false); }
  };

  const num = (value: number, onChange: (v: number) => void, min: number, max: number, label: string, step: number | "any" = 1) => (
    <input type="number" inputMode="decimal" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
  );
  const typeSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {(TYPES.includes(value) ? TYPES : [value, ...TYPES]).map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
  const seconds = Math.round(draft.minutes * 60);

  return (
    <form className="settings" onSubmit={save}>
      <div className="settings-grid">
        <label className="field"><span>Language</span>
          <select value={draft.language} onChange={(e) => set("language", e.target.value as GameConfig["language"])}>
            <option value="python">Python</option>
            <option value="typescript">TypeScript</option>
          </select>
        </label>
        <label className="field"><span>Length (minutes)</span>{num(draft.minutes, (v) => set("minutes", v), 0.1, 1440, "Game length in minutes", "any")}</label>
        <label className="field"><span>Feeding sits out (rounds)</span>{num(draft.feedCost, (v) => set("feedCost", v), 0, 1000, "Rounds a feeding bee sits out")}</label>
        <label className="field"><span>Challenge type</span>{typeSelect(draft.challengeType, (v) => set("challengeType", v), "Challenge type")}</label>
        <label className="field"><span>Response type</span>{typeSelect(draft.responseType, (v) => set("responseType", v), "Response type")}</label>
        <label className="field"><span>Max string/list length</span>{num(draft.maxLen, (v) => set("maxLen", v), 1, 1024, "Max string or list length")}</label>
        <label className="field"><span>Max tree/graph nodes</span>{num(draft.maxNodes, (v) => set("maxNodes", v), 1, 4096, "Max tree or graph nodes")}</label>
      </div>
      <p className="small muted settings-hint">
        {Number.isFinite(seconds) ? <>The game runs for <b>{fmtClock(seconds * 1000)}</b> of game time (the clock stops while paused). </> : null}
        A round is one turn for every bee that isn't feeding; a bee that feeds sits out the next <b>{Number.isFinite(draft.feedCost) ? draft.feedCost : "?"}</b> rounds.
      </p>
      <div className="settings-checks">
        <label className="check"><input type="checkbox" checked={draft.revealOnFinish} onChange={(e) => set("revealOnFinish", e.target.checked)} /> Reveal all code and every bee's prints when the game ends</label>
      </div>
      <div className="table-scroll">
        <table className="data-table budgets">
          <caption>Budgets per program
            <span className="budget-note">
              Size is in weighted syntax-tree nodes of the minified program (comments, spacing and name lengths are free; every byte of a literal counts).
              Change budget fills by <i>per minute</i> nodes a minute of game time, up to <i>cap</i>; a change costs its node edits from the version playing.
              The budgets are lopsided on purpose: the clover is small but has strong compute, the orchid changes fast, the bee carries a big kit with little time per decision.
            </span>
          </caption>
          <thead><tr><th className="left">Program</th><th>Size (nodes)</th><th>Change per minute</th><th>Change cap</th><th>Time (ms per call)</th></tr></thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k}>
                <th scope="row" className="left">{k}</th>
                <td>{num(draft.budgets[k].size, (v) => setBudget(k, "size", v), 1, 1000000, `${k} size budget`)}</td>
                <td>{num(draft.budgets[k].perMinute, (v) => setBudget(k, "perMinute", v), 0, 1000000, `${k} change per minute`, "any")}</td>
                <td>{num(draft.budgets[k].cap, (v) => setBudget(k, "cap", v), 0, 10000000, `${k} change cap`)}</td>
                <td>{num(draft.budgets[k].ms, (v) => setBudget(k, "ms", v), 1, 10000, `${k} time budget`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn" disabled={busy || !dirty}>{busy ? "Saving…" : "Save settings"}</button>
        {dirty && <button type="button" className="btn btn-ghost" onClick={() => setDraft(cfg)}>Undo changes</button>}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </div>
    </form>
  );
}

export function SettingsSummary({ cfg }: { cfg: GameConfig }) {
  return (
    <div className="settings-summary">
      <div className="chips">
        <span className="chip">{cfg.language === "python" ? "Python" : "TypeScript"}</span>
        <span className="chip">{fmtClock(cfg.minutes * 60000)} of game time</span>
        <span className="chip">feeding sits out {cfg.feedCost} rounds</span>
        <span className="chip mono">{cfg.challengeType} → {cfg.responseType}</span>
        {[cfg.challengeType, cfg.responseType].some((t) => /str|list|any/i.test(t)) && <span className="chip">max length {cfg.maxLen}</span>}
        {[cfg.challengeType, cfg.responseType].some((t) => /tree|graph/i.test(t)) && <span className="chip">max {cfg.maxNodes} nodes</span>}
        <span className="chip">{cfg.revealOnFinish ? "code and prints revealed at the end" : "code stays secret"}</span>
      </div>
      <div className="table-scroll">
        <table className="data-table budgets compact">
          <thead><tr><th className="left">Budget</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row" className="left">size (nodes)</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].size.toLocaleString()}</td>)}</tr>
            <tr><th scope="row" className="left">change per minute</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].perMinute.toLocaleString()}</td>)}</tr>
            <tr><th scope="row" className="left">change cap</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].cap.toLocaleString()}</td>)}</tr>
            <tr><th scope="row" className="left">time (ms per call)</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].ms}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
