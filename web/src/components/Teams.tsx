import { useState, type FormEvent } from "react";
import { api, errorText } from "../api";
import { KINDS, type GameView, type Team } from "../types";
import { Alert, CopyButton } from "./ui";
import { CheckIcon } from "./Icons";
import { KindIcon } from "./ProgramEditors";
import { isReady } from "./OwnerPanel";

export function TeamsPanel({ view, base }: { view: GameView; base: string }) {
  const g = view.game;
  const lobby = g.status === "lobby";
  const mine = view.myTeam;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api("POST", `${base}/teams`, { name: name.trim() || undefined }); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try { await api("POST", `${base}/teams/join`, { joinCode: code.trim() }); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="teams">
      {mine ? (
        <div className="my-team-box">
          <div>
            <b>You're on {mine.name}.</b>
            <span className="muted"> Teammates can join with this code:</span>
          </div>
          <div className="share-row"><code className="join-code">{mine.joinCode}</code><CopyButton text={mine.joinCode} /></div>
        </div>
      ) : g.status !== "finished" && (
        <div className="team-forms">
          {lobby && (
            <form onSubmit={create} className="inline-form">
              <label className="field">
                <span>Start a team</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${view.me?.name ?? "My"}'s team`} maxLength={40} />
              </label>
              <button className="btn" disabled={busy}>Create team</button>
            </form>
          )}
          <form onSubmit={join} className="inline-form">
            <label className="field">
              <span>Join a team with its code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 3fa9c2d1" className="mono" maxLength={16} />
            </label>
            <button className="btn btn-ghost" disabled={busy || !code.trim()}>Join</button>
          </form>
          {!lobby && <p className="small muted">This game has started, so new teams can't enter, but you can still join an existing team with its code.</p>}
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}

      {view.teams.length === 0 ? <p className="muted">No teams yet.</p> : (
        <ul className="team-grid">
          {view.teams.map((t) => <TeamCard key={t.id} view={view} t={t} mine={t.id === mine?.id} />)}
        </ul>
      )}
      {!lobby && g.status !== "finished" && <p className="small muted">During the game each team sees only its own code changes and change budget. Everyone's are revealed when the game ends.</p>}
    </div>
  );
}

function TeamCard({ view, t, mine }: { view: GameView; t: Team; mine: boolean }) {
  const g = view.game;
  const lobby = g.status === "lobby";
  const ready = isReady(t);
  return (
    <li className={`team-card ${mine ? "mine" : ""} ${t.participant === false ? "benched" : ""}`} style={{ ["--team" as string]: t.color }}>
      <div className="team-card-head">
        <span className="swatch big" style={{ background: t.color }} />
        <b className="team-card-name">{t.name}</b>
        {mine && <span className="you-tag">you</span>}
      </div>
      <div className="small muted">{t.members.join(", ") || "no members"}</div>
      {lobby && t.ready && (
        <div className="submit-ticks" aria-label={`${t.name}: programs written`}>
          {KINDS.map((k) => (
            <span key={k} className={`tick ${t.ready![k] ? "on" : ""}`} title={`${k}: ${t.ready![k] ? "written" : "not written yet"}`}>
              <KindIcon kind={k} size={14} />
              <span>{k}</span>
              {t.ready![k] && <CheckIcon size={12} />}
            </span>
          ))}
        </div>
      )}
      {lobby && <div className={`small ${ready ? "ok-text" : "muted"}`}>{ready ? "Ready to play" : "Needs all three programs to play"}</div>}
      {!lobby && t.participant === false && <div className="small muted">Sitting this game out (it wasn't ready at the start)</div>}
      {!lobby && t.participant && t.programs && (
        <div className="submit-ticks">
          {KINDS.map((k) => {
            const vs = t.programs![k] ?? [];
            const last = vs.at(-1);
            return (
              <span key={k} className={`tick on ${last?.problem ? "tick-bad" : ""}`} title={`${k}: ${vs.length} ${vs.length === 1 ? "version" : "versions"}${last?.problem ? ` · problem: ${last.problem}` : ""}`}>
                <KindIcon kind={k} size={14} /><span>{k} v{last?.version ?? 0}</span>
              </span>
            );
          })}
        </div>
      )}
      {!lobby && t.participant && !t.programs && <div className="small muted">Playing. Its changes stay secret until the end.</div>}
    </li>
  );
}
