// Program versions. During play a team sees only its own (when it changed what, at what cost, and its
// change budget over time); once the game is over everyone sees every team's, and the code too if
// the game reveals it.
import { useMemo, useState } from "react";
import { KINDS, type GameView, type Kind, type ProgramVersion, type Team } from "../types";
import { budgetCurve } from "../lib/budget";
import { fmtClock, plural, poss } from "../lib/format";
import { CodeView } from "./CodeEditor";
import { KindIcon } from "./ProgramEditors";
import { TeamChip } from "./ui";

/** Teams whose version history this viewer may see. */
export const historyTeams = (view: GameView) =>
  view.teams.filter((t) => !!t.programs && ((view.participants ?? []).includes(t.id) || t.id === view.me?.teamId));

/**
 * A timeline of program changes: one lane per team and program, with its change budget over the game
 * (filling, capped, spent) and a dot at every change, sized by its cost. Click a dot to see that version.
 */
export function ChangeTimeline({ view, teams, endMs, onPick, picked }: {
  view: GameView; teams: Team[]; endMs: number; onPick?: (team: string, kind: Kind, version: number) => void;
  picked?: { team: string; kind: Kind; version: number } | null;
}) {
  const cfg = view.game.config;
  const span = Math.max(1000, endMs);
  const ticks = useMemo(() => {
    const step = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000].find((s) => span / s <= 6) ?? 3600000;
    const out: number[] = [];
    for (let t = 0; t <= span + 1; t += step) out.push(t);
    return out;
  }, [span]);
  return (
    <div className="timeline">
      <div className="tl-axis" aria-hidden>
        <span className="tl-label" />
        <span className="tl-scale">{ticks.map((t) => <span key={t} className="tl-tick" style={{ left: `${(t / span) * 100}%` }}>{fmtClock(t)}</span>)}</span>
      </div>
      {teams.map((t) => {
        const changes = KINDS.flatMap((k) => (t.programs?.[k] ?? []).filter((v) => v.atMs > 0));
        const spent = changes.reduce((a, v) => a + v.cost, 0);
        return (
          <div key={t.id} className="tl-team">
            <div className="tl-team-head">
              <TeamChip team={t} you={t.id === view.me?.teamId} />
              <span className="small muted">{changes.length ? `${plural(changes.length, "change")} during the game · ${plural(spent, "node")} of change budget spent` : "no changes during the game"}</span>
            </div>
            {KINDS.map((k) => {
              const versions = t.programs?.[k] ?? [];
              const b = cfg.budgets[k];
              const pts = budgetCurve(b, versions, endMs);
              const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${((x / span) * 1000).toFixed(1)} ${(30 - (y / Math.max(1, b.cap)) * 26).toFixed(1)}`).join(" ");
              const lobby = versions.filter((v) => v.atMs <= 0).length;
              return (
                <div key={k} className="tl-lane">
                  <span className="tl-label"><KindIcon kind={k} size={14} /> {k}</span>
                  <span className="tl-track">
                    <svg viewBox="0 0 1000 30" preserveAspectRatio="none" className="tl-svg" aria-hidden>
                      <path d={`${d} L${((pts[pts.length - 1][0] / span) * 1000).toFixed(1)} 30 L0 30 Z`} className={`tl-area tl-${k}`} />
                      <path d={d} className={`tl-line tl-${k}`} vectorEffect="non-scaling-stroke" />
                    </svg>
                    {versions.filter((v) => v.atMs > 0).map((v) => {
                      const size = 11 + Math.min(13, Math.sqrt(v.cost / Math.max(1, b.cap)) * 13);
                      const on = picked && picked.team === t.id && picked.kind === k && picked.version === v.version;
                      return (
                        <button key={v.version} className={`tl-dot ${v.problem ? "tl-problem" : ""} ${on ? "on" : ""}`}
                          style={{ left: `${(v.atMs / span) * 100}%`, width: size, height: size }}
                          title={`${poss(t.name)} ${k} v${v.version} at ${fmtClock(v.atMs)}: cost ${v.cost} (${v.distance ?? 0} node edits), ${v.size} nodes, by ${v.submittedBy}${v.problem ? ` · problem: ${v.problem}` : ""}`}
                          aria-label={`${k} v${v.version} at ${fmtClock(v.atMs)}, cost ${v.cost}`}
                          onClick={() => onPick?.(t.id, k, v.version)} />
                      );
                    })}
                  </span>
                  <span className="tl-count small muted" title={lobby ? `${plural(lobby, "version")} written before the start` : undefined}>v{versions.at(-1)?.version ?? 0}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="small muted tl-legend">The shaded line is each program's change budget over the game: it starts empty, fills by {KINDS.map((k) => `${cfg.budgets[k].perMinute.toLocaleString()}`).join(" / ")} nodes a minute (clover / orchid / bee) up to its cap, and drops by each change's cost. Each dot is a change, bigger when it cost more{teams.some((t) => KINDS.some((k) => t.programs?.[k]?.some((v) => v.problem && v.atMs > 0))) ? "; red ones hit a problem while playing" : ""}.</p>
    </div>
  );
}

/** Pick a team and program, list its versions, and show a version's code (and what changed from the one before). */
export function VersionBrowser({ view, teams, picked, onPick }: {
  view: GameView; teams: Team[]; picked: { team: string; kind: Kind; version: number } | null; onPick: (p: { team: string; kind: Kind; version: number } | null) => void;
}) {
  const fallbackTeam = teams.find((t) => t.id === view.me?.teamId) ?? teams[0];
  const [teamPick, setTeam] = useState<string>(fallbackTeam?.id ?? "");
  const [kindPick, setKind] = useState<Kind>("clover");
  const [compare, setCompare] = useState(true);
  const teamId = picked?.team ?? (teams.some((t) => t.id === teamPick) ? teamPick : fallbackTeam?.id);
  const kind = picked?.kind ?? kindPick;
  const team = teams.find((t) => t.id === teamId);
  const versions = team?.programs?.[kind] ?? [];
  const sel: ProgramVersion | undefined = versions.find((v) => v.version === picked?.version) ?? versions.at(-1);
  const prev = sel ? versions.find((v) => v.version === sel.version - 1) : undefined;
  if (!team) return <p className="muted">No versions to show.</p>;
  const lang = view.game.config.language;
  return (
    <div className="versions">
      <div className="row">
        {teams.length > 1 && (
          <label className="picker"><span>Team</span>
            <select value={teamId} onChange={(e) => { setTeam(e.target.value); onPick(null); }}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === view.me?.teamId ? " (you)" : ""}</option>)}
            </select>
          </label>
        )}
        <div className="seg" role="group" aria-label="Program">
          {KINDS.map((k) => <button key={k} className={kind === k ? "active" : ""} aria-pressed={kind === k} onClick={() => { setKind(k); onPick(null); }}>{k}</button>)}
        </div>
      </div>
      {versions.length === 0 ? <p className="muted">No {kind} yet.</p> : (
        <div className="versions-body">
          <ol className="version-list" aria-label={`${poss(team.name)} ${kind} versions, newest first`}>
            {[...versions].reverse().map((v) => (
              <li key={v.version}>
                <button className={`version-row ${sel?.version === v.version ? "on" : ""}`} onClick={() => onPick({ team: team.id, kind, version: v.version })} aria-pressed={sel?.version === v.version}>
                  <b>v{v.version}</b>
                  <span className="small">{v.atMs > 0 ? `at ${fmtClock(v.atMs)}` : "before the start"}{v.version === versions.length && view.game.status !== "finished" ? " · playing now" : ""}</span>
                  <span className="small muted">{v.size.toLocaleString()} nodes{v.atMs > 0 ? ` · cost ${v.cost.toLocaleString()}` : ""} · {v.submittedBy}</span>
                  {v.problem && <span className="small bad-text">problem: {v.problem}</span>}
                </button>
              </li>
            ))}
          </ol>
          <div className="version-code">
            {sel && sel.code !== undefined ? (
              <>
                <div className="row small">
                  <span className="muted">{poss(team.name)} {kind} v{sel.version}{sel.distance !== null && prev ? ` · ${sel.distance} node edits from v${prev.version}` : ""}</span>
                  {prev?.code !== undefined && <label className="check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> show v{prev.version} beside it</label>}
                </div>
                <CodeView key={`${team.id}:${kind}:${sel.version}:${compare}`} code={sel.code} language={lang} previous={prev?.code ?? null} showPrevious={compare && prev?.code !== undefined}
                  label={`${kind} v${sel.version}`} previousLabel={prev ? `v${prev.version}` : "Before"} currentLabel={`v${sel.version}`} />
              </>
            ) : (
              <p className="muted small">
                {view.game.status === "finished" ? "This game doesn't reveal code (the owner turned that off), but every change's timing, size and cost are public now." : "Code stays with its team."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
