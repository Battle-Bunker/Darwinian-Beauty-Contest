import type { GameView, Team } from "../types";

/** A value from a program (challenge or response) as a short readable string. */
export function showValue(v: unknown, max = 40): string {
  let s: string;
  if (v === null || v === undefined) s = "None";
  else if (typeof v === "string") s = JSON.stringify(v);
  else if (typeof v === "number") s = Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  else s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export const fmt2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
export const fmt3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "–");
export const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 1000) / 10}%` : "–");

/** Game time as m:ss (or h:mm:ss); `tenths` adds .d for the action feed. */
export function fmtClock(ms: number, tenths = false): string {
  const neg = ms < 0;
  const t = Math.max(0, Math.abs(ms));
  const total = tenths ? Math.floor(t / 100) / 10 : Math.floor(t / 1000);
  const s = Math.floor(total) % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const frac = tenths ? `.${Math.floor((t % 1000) / 100)}` : "";
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return (neg ? "−" : "") + body + frac;
}

/** A wait in game time, in words: "about 40 s", "2 min 5 s". */
export function fmtWait(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Budget numbers: whole nodes, or one decimal while small and growing. */
export const fmtNodes = (x: number) => (x < 100 && x % 1 !== 0 ? x.toFixed(1) : Math.floor(x).toLocaleString());

export function teamMap(view: GameView): Record<string, Team> {
  return Object.fromEntries(view.teams.map((t) => [t.id, t]));
}

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** "Ada's", but "Honey Hunters'" */
export const poss = (name: string | undefined) => (!name ? "?'s" : /s$/i.test(name) ? `${name}'` : `${name}'s`);
