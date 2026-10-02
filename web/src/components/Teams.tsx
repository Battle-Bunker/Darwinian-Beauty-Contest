import { useState, type FormEvent } from "react";
import { api, errorText } from "../api";
import { KINDS, type GameView } from "../types";
import { Alert, CopyButton } from "./ui";
import { BeeGlyph, CheckIcon, FlowerHead } from "./Icons";

export function TeamsPanel({ view, base }: { view: GameView; base: string }) {
  const g = view.game;
  const lobby = g.roundsPlayed === 0 && !g.runningRound;
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
      ) : (
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
          {view.teams.map((t) => {
            const ready = KINDS.every((k) => t.submitted[k]);
            return (
              <li key={t.id} className={`team-card ${t.id === mine?.id ? "mine" : ""} ${t.participant === false ? "benched" : ""}`} style={{ ["--team" as string]: t.color }}>
                <div className="team-card-head">
                  <span className="swatch big" style={{ background: t.color }} />
                  <b className="team-card-name">{t.name}</b>
                  {t.id === mine?.id && <span className="you-tag">you</span>}
                </div>
                <div className="small muted">{t.members.join(", ") || "no members"}</div>
                {g.status !== "finished" && (
                  <div className="submit-ticks" aria-label={`${t.name} submissions for the next round`}>
                    {KINDS.map((k) => (
                      <span key={k} className={`tick ${t.submitted[k] ? "on" : ""}`} title={`${k}: ${t.submitted[k] ? "submitted" : "not submitted"} for round ${g.roundsPlayed + 1}`}>
                        {k === "bee" ? <BeeGlyph color={t.submitted[k] ? "#f2a541" : "#b9b2a3"} size={16} /> : <FlowerHead color={t.submitted[k] ? (k === "clover" ? "#6aa84f" : "#9b5de5") : "#b9b2a3"} size={14} />}
                        <span>{k}</span>
                        {t.submitted[k] && <CheckIcon size={12} />}
                      </span>
                    ))}
                  </div>
                )}
                {t.participant === false && <div className="small muted">Not playing (missed round 1)</div>}
                {lobby && <div className={`small ${ready ? "ok-text" : "muted"}`}>{ready ? "Ready for round 1" : "Needs all three programs to play"}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
