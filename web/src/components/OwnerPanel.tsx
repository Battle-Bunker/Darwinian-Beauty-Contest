// Owner controls: game settings (lobby only) and the Run round button. Plus a settings summary for everyone.
import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api";
import { KINDS, type GameConfig, type GameView, type Kind } from "../types";
import { Alert, Spinner } from "./ui";
import { PlayIcon } from "./Icons";

const TYPES = ["int", "float", "bool", "str", "any", "list[int]", "list[float]", "list[bool]", "list[str]", "tree[int]", "graph", "digraph", "graph[any]", "graph[int]", "digraph[any]"];

export function RunRound({ view, base }: { view: GameView; base: string }) {
  const g = view.game;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = g.roundsPlayed + 1;
  const ready = view.teams.filter((t) => t.submitted.clover && t.submitted.orchid && t.submitted.bee).length;
  const needTeams = g.roundsPlayed === 0 && ready < 2;

  const run = async () => {
    setBusy(true); setError(null);
    try { await api("POST", `${base}/rounds`); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  if (g.status === "finished") return <p className="muted">All {g.config.rounds} rounds have been played.</p>;
  return (
    <div className="run-round">
      <button className="btn btn-big btn-honey" onClick={run} disabled={busy || !!g.runningRound || needTeams}>
        {g.runningRound ? <Spinner label={`Round ${g.runningRound} running…`} /> : <><PlayIcon /> Run round {next}</>}
      </button>
      <div className="small">
        {g.runningRound ? <span className="muted">The bees are out. Results appear here as soon as the round finishes.</span>
          : needTeams ? <span className="warn-text">Round 1 needs at least 2 teams with all three programs submitted ({ready} so far).</span>
          : g.roundsPlayed === 0 ? <span className="muted">{ready} teams are ready. Teams without all three programs won't play this game. Settings lock once round 1 runs.</span>
          : <span className="muted">Round {next} of {g.config.rounds}. Teams that haven't submitted play last round's programs again.</span>}
      </div>
      {g.lastError && <Alert kind="error"><b>The last round didn't run:</b> {g.lastError}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

export function SettingsForm({ view, base }: { view: GameView; base: string }) {
  // Older games' configs predate engine v2 fields; show the defaults for them.
  const cfg: GameConfig = { turnsPerFlower: 100, maxNodes: 512, beeMemoryKb: 256, ...view.game.config };
  const nTeams = Math.max(2, view.participants?.length ?? view.teams.length);
  const [draft, setDraft] = useState<GameConfig>(cfg);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const cfgKey = JSON.stringify(cfg);
  useEffect(() => { setDraft(JSON.parse(cfgKey)); }, [cfgKey]);
  const dirty = JSON.stringify(draft) !== cfgKey;

  const set = <K extends keyof GameConfig>(k: K, v: GameConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setBudget = (kind: Kind, k: "chars" | "changes" | "ms", v: number) =>
    setDraft((d) => ({ ...d, budgets: { ...d.budgets, [kind]: { ...d.budgets[kind], [k]: v } } }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ config: GameConfig; clearedSubmissions: boolean }>("PATCH", `${base}/config`, { config: draft });
      setMsg(r.clearedSubmissions
        ? { kind: "warn", text: "Saved. Submitted programs were cleared because the language, types or size budgets changed, so teams need to submit again." }
        : { kind: "ok", text: "Saved." });
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally { setBusy(false); }
  };

  const num = (value: number, onChange: (v: number) => void, min: number, max: number, label: string) => (
    <input type="number" inputMode="numeric" value={Number.isFinite(value) ? value : ""} min={min} max={max} aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
  );
  const typeSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {(TYPES.includes(value) ? TYPES : [value, ...TYPES]).map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );

  return (
    <form className="settings" onSubmit={save}>
      <div className="settings-grid">
        <label className="field"><span>Language</span>
          <select value={draft.language} onChange={(e) => set("language", e.target.value as GameConfig["language"])}>
            <option value="python">Python</option>
            <option value="typescript">TypeScript</option>
          </select>
        </label>
        <label className="field"><span>Rounds</span>{num(draft.rounds, (v) => set("rounds", v), 1, 100, "Rounds")}</label>
        <label className="field"><span>Turns per flower</span>{num(draft.turnsPerFlower ?? 100, (v) => set("turnsPerFlower", v), 1, 1000, "Turns per flower")}</label>
        <label className="field"><span>Fixed turns per round</span>
          <input type="number" inputMode="numeric" min={1} max={100000} value={draft.turns ?? ""} placeholder="auto" aria-label="Fixed turns per round (empty = auto)"
            onChange={(e) => set("turns", e.target.value === "" ? null : Number(e.target.value))} />
        </label>
        <label className="field"><span>Feed cost (turns)</span>{num(draft.feedCost, (v) => set("feedCost", v), 0, 1000, "Feed cost")}</label>
        <label className="field"><span>Challenge type</span>{typeSelect(draft.challengeType, (v) => set("challengeType", v), "Challenge type")}</label>
        <label className="field"><span>Response type</span>{typeSelect(draft.responseType, (v) => set("responseType", v), "Response type")}</label>
        <label className="field"><span>Max string/list length</span>{num(draft.maxLen, (v) => set("maxLen", v), 1, 1024, "Max string or list length")}</label>
        <label className="field"><span>Max tree/graph nodes</span>{num(draft.maxNodes ?? 512, (v) => set("maxNodes", v), 1, 4096, "Max tree or graph nodes")}</label>
        <label className="field"><span>Bee memory (KB, 0 = off)</span>{num(draft.beeMemoryKb ?? 256, (v) => set("beeMemoryKb", v), 0, 4096, "Bee memory in KB")}</label>
      </div>
      <p className="small muted settings-hint">
        {draft.turns
          ? <>Every bee gets exactly <b>{draft.turns}</b> turns each round.</>
          : <>Every bee gets <b>{draft.turnsPerFlower ?? 100}</b> turns per flower: <b>{((draft.turnsPerFlower ?? 100) * 2 * nTeams).toLocaleString()}</b> turns a round with {nTeams} teams ({2 * nTeams} flowers). Leave "fixed turns" empty to keep it that way.</>}
      </p>
      <div className="settings-checks">
        <label className="check"><input type="checkbox" checked={draft.flowerLogs} onChange={(e) => set("flowerLogs", e.target.checked)} /> Flower logs: teams see what bees asked their flowers</label>
        <label className="check"><input type="checkbox" checked={draft.revealOnFinish} onChange={(e) => set("revealOnFinish", e.target.checked)} /> Reveal all code and logs when the game ends</label>
      </div>
      <div className="table-scroll">
        <table className="data-table budgets">
          <caption>Budgets per program
            <span className="budget-note">
              The budgets are lopsided on purpose. <b>Clover</b>: small code but strong compute, so it can prove effort.{" "}
              <b>Orchid</b>: big code and fast change between rounds. <b>Bee</b>: a big kit of detectors, but little time per decision.
              Defaults: clover 150 / 30 / 150, orchid 300 / 210 / 50, bee 1500 / 300 / 25.
            </span>
          </caption>
          <thead><tr><th className="left">Program</th><th>Size (characters after minifying)</th><th>Changes per round</th><th>Time (ms per call)</th></tr></thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k}>
                <th scope="row" className="left">{k}</th>
                <td>{num(draft.budgets[k].chars, (v) => setBudget(k, "chars", v), 1, 1000000, `${k} size budget`)}</td>
                <td>{num(draft.budgets[k].changes, (v) => setBudget(k, "changes", v), 0, 100000, `${k} change budget`)}</td>
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

export function SettingsSummary({ cfg, turnsNow }: { cfg: GameConfig; turnsNow?: number }) {
  return (
    <div className="settings-summary">
      <div className="chips">
        <span className="chip">{cfg.language === "python" ? "Python" : "TypeScript"}</span>
        <span className="chip">{cfg.rounds} rounds</span>
        <span className="chip">{cfg.turns ? `${cfg.turns} turns per round` : `${cfg.turnsPerFlower ?? 100} turns per flower${turnsNow ? ` (${turnsNow.toLocaleString()} a round)` : ""}`}</span>
        <span className="chip">feed costs {cfg.feedCost}</span>
        <span className="chip mono">{cfg.challengeType} → {cfg.responseType}</span>
        {[cfg.challengeType, cfg.responseType].some((t) => /str|list/i.test(t)) && <span className="chip">max length {cfg.maxLen}</span>}
        {[cfg.challengeType, cfg.responseType].some((t) => /tree|graph/i.test(t)) && <span className="chip">max {cfg.maxNodes ?? 512} nodes</span>}
        {cfg.beeMemoryKb !== undefined && <span className="chip">{cfg.beeMemoryKb ? `bee memory ${cfg.beeMemoryKb} KB` : "bee memory off"}</span>}
        <span className="chip">{cfg.flowerLogs ? "flower logs on" : "flower logs off"}</span>
        <span className="chip">{cfg.revealOnFinish ? "code revealed at the end" : "code stays secret"}</span>
      </div>
      <div className="table-scroll">
        <table className="data-table budgets compact">
          <thead><tr><th className="left">Budget</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row" className="left">size (characters)</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].chars}</td>)}</tr>
            <tr><th scope="row" className="left">changes / round</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].changes}</td>)}</tr>
            <tr><th scope="row" className="left">time (ms / call)</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].ms}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
