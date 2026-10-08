// Owner controls: game settings (lobby only), start, pause / resume and finish. Plus a settings summary for everyone.
import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api";
import { KINDS, defaultMinMs, scoringOf, type GameConfig, type GameView, type Kind, type Team } from "../types";
import { Alert, TeamChip } from "./ui";
import { PauseIcon, PlayIcon } from "./Icons";
import { fmtBytes, fmtClock, powText } from "../lib/format";

const TYPES = ["int", "float", "bool", "str", "any", "list[int]", "list[float]", "list[bool]", "list[str]", "tree[int]", "graph", "digraph", "graph[any]", "graph[int]", "digraph[any]"];

/** Whether a team has written both programs (it plays if the game starts now). */
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
            <span className="small muted">{fmtClock(g.endMs)} of game time. Settings lock once it starts; teams that haven't written both programs sit it out.</span>
          </div>
          <div className="who-plays">
            <div><b>{ready.length ? `${ready.length} ${ready.length === 1 ? "team" : "teams"} will play:` : "Nobody is ready yet."}</b> {ready.map((t) => <TeamChip key={t.id} team={t} />)}</div>
            {notReady.length > 0 && <div className="small muted">Not ready (missing a program): {notReady.map((t) => <span key={t.id} className="not-ready">{t.name} <span className="mono">({KINDS.filter((k) => !t.ready?.[k]).join(", ")})</span></span>)}</div>}
            {ready.length < 2 && <div className="small warn-text">The game needs at least 2 teams with both programs written.</div>}
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
  const setBudget = (kind: Kind, k: "size" | "perMinute" | "cap" | "ms" | "memory" | "minMs", v: number) =>
    setDraft((d) => {
      const b = { ...d.budgets[kind], [k]: v };
      // R's floor follows the flower's time limit (2% of it) while it is at that default, as on the server.
      const f = d.budgets.flower, saved = cfg.budgets.flower;
      const auto = f.minMs === undefined || f.minMs === defaultMinMs(f.ms) || (f.minMs === saved.minMs && saved.minMs === defaultMinMs(saved.ms));
      if (kind === "flower" && k === "ms" && Number.isFinite(v) && auto) b.minMs = defaultMinMs(v);
      return { ...d, budgets: { ...d.budgets, [kind]: b } };
    });

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
  const roundMs = draft.budgets.flower.ms + draft.budgets.bee.ms;
  const cap = draft.budgets.flower.size;
  const grain = draft.pollenGrain ?? { exponent: 1 / 3, scale: 1 };
  const grainLen = (p: number) => (Number.isFinite(grain.exponent) && Number.isFinite(grain.scale) ? Math.floor(grain.scale * Math.pow(p, grain.exponent)) : NaN);
  const sc = scoringOf(draft);

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
        <label className="field"><span>Feed cost (rounds sat out)</span>{num(draft.feedCost, (v) => set("feedCost", v), 0, 1000, "Feed cost: rounds a bee sits out after it feeds")}</label>
        <label className="field"><span>Challenge type</span>{typeSelect(draft.challengeType, (v) => set("challengeType", v), "Challenge type")}</label>
        <label className="field"><span>Response type</span>{typeSelect(draft.responseType, (v) => set("responseType", v), "Response type")}</label>
        <label className="field"><span>Max string/list length</span>{num(draft.maxLen, (v) => set("maxLen", v), 1, 1024, "Max string or list length")}</label>
        <label className="field"><span>Max tree/graph nodes</span>{num(draft.maxNodes, (v) => set("maxNodes", v), 1, 4096, "Max tree or graph nodes")}</label>
        <label className="field"><span>Max response (bytes)</span>{num(draft.maxResponseBytes ?? 65536, (v) => set("maxResponseBytes", v), 16, 16777216, "Max response size in bytes")}</label>
        <label className="field"><span>Pollen grains</span>
          <select value={draft.grains ?? "feeder"} onChange={(e) => set("grains", e.target.value as GameConfig["grains"])} aria-label="Who sees pollen grains during play">
            <option value="feeder">the feeding bee's team</option>
            <option value="public">everyone, as they happen</option>
            <option value="off">off</option>
          </select>
        </label>
        <label className="field"><span>Grain exponent</span>{num(grain.exponent, (v) => set("pollenGrain", { ...grain, exponent: v }), 0.01, 1, "Pollen grain exponent", "any")}</label>
        <label className="field"><span>Grain scale</span>{num(grain.scale, (v) => set("pollenGrain", { ...grain, scale: v }), 0, 1000, "Pollen grain scale", "any")}</label>
        <label className="field"><span>Forage exponent α</span>{num(sc.alpha, (v) => set("scoring", { ...sc, alpha: v }), 0.01, 1, "Forage exponent alpha: forage is the sum of nectar to this power, in (0, 1]", "any")}</label>
        <label className="field"><span>Pollination exponent β</span>{num(sc.beta, (v) => set("scoring", { ...sc, beta: v }), 0.01, 1, "Pollination exponent beta: pollination is the sum of pollen to this power, in (0, 1]", "any")}</label>
      </div>
      <p className="small muted settings-hint">
        {Number.isFinite(seconds) && Number.isFinite(roundMs) && roundMs > 0
          ? <>The game runs for <b>{fmtClock(seconds * 1000)}</b> of game time: <b>{Math.round((seconds * 1000) / roundMs).toLocaleString()}</b> rounds of <b>{roundMs} ms</b> (the clock stops while paused). </> : null}
        Each round every bee that isn't feeding visits a random flower: the flower has a hidden time budget R, drawn each call from <b>{draft.budgets.flower.minMs ?? 50}</b> to <b>{draft.budgets.flower.ms} ms</b>, to answer (every answer reaches the bee at {draft.budgets.flower.ms} ms, so timing hides R), then the bee has <b>{draft.budgets.bee.ms} ms</b> to feed or leave.
        A bee that feeds sits out the next <b>{Number.isFinite(draft.feedCost) ? draft.feedCost : "?"}</b> rounds.
        Each team's flower is a species; every visit is a bee meeting one of its flowers, which spends its budget on its size and compute and, if the bee feeds, gives it nectar and pollen from what's left: E = ({Number.isFinite(cap) ? cap.toLocaleString() : "?"} − its size) × max(0, {draft.budgets.flower.ms} − its CPU ms), so a {Number.isFinite(cap) ? Math.round(cap / 2).toLocaleString() : "?"}-node flower answering in 10 ms has up to {Number.isFinite(cap) ? (Math.round(cap / 2) * Math.max(0, draft.budgets.flower.ms - 10)).toLocaleString() : "?"} node·ms to give.
        {" "}Bees run fresh for every turn and keep only their MEMORY, a key–value store of at most <b>{(draft.budgets.bee.memory ?? 50).toLocaleString()}</b> bytes (each entry: its key's bytes plus its value's JSON bytes).
        {" "}On every feed, {(draft.grains ?? "feeder") === "off" ? "no pollen grain is given (grains are off)" : <>the bee's team gets a pollen grain: ⌊{grain.scale} × pollen^{+grain.exponent.toFixed(3)}⌋ characters of the flower's minified code from a random start ({Number.isFinite(grainLen(27000)) ? `27,000 pollen gives ${grainLen(27000)}, 100,000 gives ${grainLen(100000)}` : "?"}), seen {(draft.grains ?? "feeder") === "public" ? "by everyone as it happens" : "by that team only until the game ends"}</>}.
        {" "}Scores: a team's forage is the sum over flower teams of {Number.isFinite(sc.alpha) ? powText("the nectar its bee got there", sc.alpha) : "(the nectar its bee got there)^?"}, its pollination the sum over bee teams of {Number.isFinite(sc.beta) ? powText("the pollen its species gave that team's bee", sc.beta) : "(the pollen its species gave that team's bee)^?"} (exponents in (0, 1]: below 1, spreading beats the same amount from one team); fitness = N² × pollination share × forage share.
        {" "}String and list lengths and tree and graph sizes limit challenges; a response may be up to <b>{fmtBytes(draft.maxResponseBytes ?? 65536)}</b> of JSON (over that it counts as no answer), and one over 4 KB is shown on the page as its first 4 KB.
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
              The flower's size is also the cap in its energy formula and its time is the flower window; the bee's time is its decision window. A round is the two windows together.
            </span>
          </caption>
          <thead><tr><th className="left">Program</th><th>Size (nodes)</th><th>Change per minute</th><th>Change cap</th><th title="Flower: the most a call's hidden time budget R can be, and the flower window (every answer is delivered at its end). Bee: the decision window.">Time limit (ms)</th><th title="Flower: the least a call's hidden time budget R can be (R is drawn uniformly from this to the time limit). By default 2% of the time limit (at least 1 ms), following it.">Min time (ms)</th><th title="The most bytes a bee's MEMORY may hold: a key–value store, each entry its key's bytes plus its value's JSON bytes. The only thing a bee keeps from one turn to the next.">Memory (bytes)</th></tr></thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k}>
                <th scope="row" className="left">{k}</th>
                <td>{num(draft.budgets[k].size, (v) => setBudget(k, "size", v), 1, 1000000, `${k} size budget`)}</td>
                <td>{num(draft.budgets[k].perMinute, (v) => setBudget(k, "perMinute", v), 0, 1000000, `${k} change per minute`, "any")}</td>
                <td>{num(draft.budgets[k].cap, (v) => setBudget(k, "cap", v), 0, 10000000, `${k} change cap`)}</td>
                <td>{num(draft.budgets[k].ms, (v) => setBudget(k, "ms", v), 1, 10000, `${k} time budget`)}</td>
                <td>{k === "flower" ? num(draft.budgets.flower.minMs ?? 50, (v) => setBudget("flower", "minMs", v), 1, 10000, "Flower minimum time budget") : <span className="muted">–</span>}</td>
                <td>{k === "bee" ? num(draft.budgets.bee.memory ?? 50, (v) => setBudget("bee", "memory", v), 0, 1000000, "Bee memory cap in bytes") : <span className="muted">–</span>}</td>
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
        <span className="chip" title={`Each round every bee that isn't feeding visits a random flower: it answers within ${cfg.budgets.flower.ms} ms, then the bee decides within ${cfg.budgets.bee.ms} ms`}>rounds of {cfg.budgets.flower.ms + cfg.budgets.bee.ms} ms</span>
        <span className="chip" title="Each flower call's hidden time budget R is drawn uniformly from this range">flower R {cfg.budgets.flower.minMs ?? 50}–{cfg.budgets.flower.ms} ms · bee {cfg.budgets.bee.ms} ms</span>
        <span className="chip">a feed costs {cfg.feedCost} rounds</span>
        <span className="chip" title="forage = Σ over flower teams of nectar^α; pollination = Σ over bee teams of pollen^β; fitness = N² × pollination share × forage share">
          score: {powText("nectar", scoringOf(cfg).alpha)}, {powText("pollen", scoringOf(cfg).beta)}
        </span>
        <span className="chip" title="E = (flower size cap − flower size) × max(0, R − CPU ms), R each call's hidden time budget">energy cap {cfg.budgets.flower.size.toLocaleString()} nodes</span>
        <span className="chip mono">{cfg.challengeType} → {cfg.responseType}</span>
        {[cfg.challengeType, cfg.responseType].some((t) => /str|list|any/i.test(t)) && <span className="chip">max length {cfg.maxLen}</span>}
        {[cfg.challengeType, cfg.responseType].some((t) => /tree|graph/i.test(t)) && <span className="chip">max {cfg.maxNodes} nodes</span>}
        <span className="chip" title="The most bytes of a response's JSON; over it, no answer">responses up to {fmtBytes(cfg.maxResponseBytes ?? 65536)}</span>
        <span className="chip" title="A bee's MEMORY: a flat key–value store">bee MEMORY {(cfg.budgets.bee.memory ?? 50).toLocaleString()} bytes</span>
        <span className="chip" title={`A feed's pollen grain: ⌊${cfg.pollenGrain?.scale ?? 1} × pollen^${+(cfg.pollenGrain?.exponent ?? 1 / 3).toFixed(3)}⌋ characters of the flower's minified code`}>
          pollen grains: {{ feeder: "the feeding team's", public: "public", off: "off" }[cfg.grains ?? "feeder"]}
        </span>
        <span className="chip">{cfg.revealOnFinish ? "code and prints revealed at the end" : "code stays secret"}</span>
      </div>
      <div className="table-scroll">
        <table className="data-table budgets compact">
          <thead><tr><th className="left">Budget</th>{KINDS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row" className="left">size (nodes)</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].size.toLocaleString()}</td>)}</tr>
            <tr><th scope="row" className="left">change per minute</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].perMinute.toLocaleString()}</td>)}</tr>
            <tr><th scope="row" className="left">change cap</th>{KINDS.map((k) => <td key={k}>{cfg.budgets[k].cap.toLocaleString()}</td>)}</tr>
            <tr><th scope="row" className="left">time limit (ms)</th>{KINDS.map((k) => <td key={k}>{k === "flower" ? `${cfg.budgets.flower.minMs ?? 50}–${cfg.budgets.flower.ms} (hidden R)` : cfg.budgets[k].ms}</td>)}</tr>
            <tr><th scope="row" className="left">memory (bytes)</th>{KINDS.map((k) => <td key={k}>{k === "bee" ? (cfg.budgets.bee.memory ?? 50).toLocaleString() : "–"}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
