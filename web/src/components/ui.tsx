import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameStatus, Team } from "../types";
import { CheckIcon, CopyIcon, InfoIcon } from "./Icons";

export function Section({ id, title, icon, actions, children, className = "" }: {
  id?: string; title: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section id={id} className={`card ${className}`}>
      <header className="card-head">
        <h2>{icon}{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function TeamChip({ team, you = false, short = false }: { team: Team | undefined; you?: boolean; short?: boolean }) {
  if (!team) return <span className="team-chip muted">unknown team</span>;
  const name = short && team.name.length > 14 ? team.name.slice(0, 13) + "…" : team.name;
  return (
    <span className="team-chip" title={team.name}>
      <span className="swatch" style={{ background: team.color }} />
      <span className="team-name">{name}</span>
      {you && <span className="you-tag">you</span>}
    </span>
  );
}

export function StatusBadge({ status, roundsPlayed, rounds, running }: { status: GameStatus; roundsPlayed: number; rounds: number; running?: number | null }) {
  if (running) return <span className="badge badge-running"><span className="pulse-dot" />Round {running} running</span>;
  if (status === "lobby") return <span className="badge badge-lobby">Lobby</span>;
  if (status === "finished") return <span className="badge badge-done">Finished</span>;
  return <span className="badge badge-live">Round {roundsPlayed} of {rounds} played</span>;
}

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" className={`btn btn-small btn-ghost ${className}`} onClick={copy} aria-live="polite">
      {done ? <CheckIcon size={15} /> : <CopyIcon size={15} />} {done ? "Copied" : label}
    </button>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "warn" | "ok"; children: ReactNode }) {
  return <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : undefined}>{children}</div>;
}

/** A small (i) that explains a term on hover, focus or tap. Fixed-positioned so scrolling tables don't clip it. */
export function InfoTip({ children, label = "What's this?" }: { children: ReactNode; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(280, window.innerWidth - 32);
    setPos({ top: r.bottom + 8, left: Math.max(16, Math.min(window.innerWidth - w - 16, r.left + r.width / 2 - w / 2)) });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [pos]);
  return (
    <span className="infotip" onMouseEnter={show} onMouseLeave={hide}>
      <button ref={btn} type="button" className="infotip-btn" aria-label={label} aria-expanded={!!pos}
        onClick={() => (pos ? hide() : show())} onFocus={show} onBlur={hide}>
        <InfoIcon size={15} />
      </button>
      {pos && <span className="infotip-pop" role="tooltip" style={{ top: pos.top, left: pos.left }}>{children}</span>}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner-wrap"><span className="spinner" aria-hidden />{label && <span>{label}</span>}</span>;
}

export function Meter({ value, max, label }: { value: number | null; max: number; label: string }) {
  const v = value ?? 0;
  const ratio = max > 0 ? Math.min(1.2, v / max) : 0;
  const over = value !== null && v > max;
  return (
    <div className={`meter ${over ? "over" : ratio > 0.85 ? "near" : ""}`} title={`${label}: ${value ?? "–"} of ${max}`}>
      <div className="meter-label"><span>{label}</span><b>{value ?? "–"}</b><span className="muted">/ {max}</span></div>
      <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
    </div>
  );
}
