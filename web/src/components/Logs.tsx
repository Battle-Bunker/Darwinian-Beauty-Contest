// Private logs for one round: a team's bee visits and the visitors to its flowers, plus its programs'
// problems. Your own team always; every team once the game is finished and revealed.
import { useMemo, useState } from "react";
import { poss } from "../lib/format";
import { KINDS, type GameView, type Round } from "../types";
import { ActionText, Steps } from "./ProgramEditors";
import { Alert, TeamChip } from "./ui";
import { CodeView } from "./CodeEditor";

export function visibleTeams(view: GameView): string[] {
  const parts = view.participants ?? [];
  if (view.game.revealed) return parts;
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

export function Logs({ view, round }: { view: GameView; round: Round }) {
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
  const beeVisits = round.visits.filter((v) => v.bee === teamId);
  const flowerVisits = round.visits.filter((v) => v.patch === teamId);
  const progs = round.programs[teamId];
  const flowerSteps = view.game.config.flowerLogs || view.game.revealed;

  return (
    <div className="logs">
      <TeamPicker view={view} ids={ids} value={teamId} onChange={setPick} label="Show logs for" />
      <h3>{mine ? "Your" : `${poss(team?.name)}`} programs in round {round.no}</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th className="left">Program</th><th>Size</th><th>Changes</th><th className="left">Played</th><th className="left">Problem</th></tr></thead>
          <tbody>
            {KINDS.map((k) => {
              const p = progs?.[k];
              return (
                <tr key={k}>
                  <th scope="row" className="left">{k}</th>
                  <td>{p?.nodes ?? "–"}</td>
                  <td>{p?.distance ?? "–"}</td>
                  <td className="left">{p?.carriedOver ? "same as last round" : round.no === 1 ? "first version" : "new version"}</td>
                  <td className={`left ${p?.problem ? "bad" : "muted"}`}>{p?.problem ? <span className="mono">{p.problem}</span> : "none"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="log-section" open>
        <summary><h3>{mine ? "Your" : `${poss(team?.name)}`} bee: {beeVisits.length} visits</h3></summary>
        {beeVisits.length === 0 ? <p className="muted">The bee didn't visit any flowers this round.</p> : (
          <div className="table-scroll tall">
            <table className="data-table log-table">
              <thead><tr><th>#</th><th>Turns</th><th className="left">Patch</th><th className="left">Questions → answers</th><th className="left">Result</th></tr></thead>
              <tbody>
                {beeVisits.map((v) => (
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
        )}
      </details>

      <details className="log-section" open>
        <summary><h3>Visitors to {mine ? "your" : `${poss(team?.name)}`} flowers: {flowerVisits.length}</h3></summary>
        {!flowerSteps && <Alert kind="info">Flower logs are off in this game: you see who visited and what happened, but not what they asked.</Alert>}
        {flowerVisits.length === 0 ? <p className="muted">No bee visited this patch.</p> : (
          <div className="table-scroll tall">
            <table className="data-table log-table">
              <thead><tr><th>Turns</th><th className="left">Bee</th><th className="left">Flower</th><th className="left">Questions → answers</th><th className="left">Result</th></tr></thead>
              <tbody>
                {flowerVisits.sort((a, b) => a.start - b.start).map((v) => (
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
        )}
      </details>
    </div>
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
            {prog.nodes} nodes{prog.distance !== null ? ` · ${prog.distance} changes from round ${round.no - 1}` : ""}{prog.carriedOver ? " · same as last round" : ""}
            {prog.problem ? <> · <span className="bad-text">problem: {prog.problem}</span></> : null}
          </p>
          <CodeView key={`${teamId}:${kind}:${round.no}`} code={prog.code} language={view.game.config.language} previous={prev} showPrevious={compare} label={`${kind} code`} />
        </>
      ) : <p className="muted">No code for this program.</p>}
    </div>
  );
}
