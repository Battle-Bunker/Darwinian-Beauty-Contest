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

export function teamMap(view: GameView): Record<string, Team> {
  return Object.fromEntries(view.teams.map((t) => [t.id, t]));
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Readable text colour (dark ink or white) on a given hex background. */
export function inkOn(hex: string): string {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.36 ? "#1f1a10" : "#ffffff";
}

export const KIND_LABEL = { clover: "Clover", orchid: "Orchid", bee: "Bee" } as const;
