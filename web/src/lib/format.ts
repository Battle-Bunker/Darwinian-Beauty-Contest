/** A value from a program (challenge or response) as a short readable string. */
export function showValue(v: unknown, max = 40): string {
  let s: string;
  if (v === null || v === undefined) s = "None";
  else if (typeof v === "string") s = JSON.stringify(v);
  else if (typeof v === "number") s = Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  else s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Energy, nectar and surplus (node·ms), compactly: 950, 12.3k, 4.56M. Exact values go in titles and tables.
 */
export function fmtE(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a < 1000) return s + (a < 10 && a % 1 ? a.toFixed(1) : Math.round(a).toString());
  if (a < 1e6) return s + (a / 1e3).toFixed(a < 1e4 ? 2 : a < 1e5 ? 1 : 0) + "k";
  if (a < 1e9) return s + (a / 1e6).toFixed(a < 1e7 ? 2 : a < 1e8 ? 1 : 0) + "M";
  return s + (a / 1e9).toFixed(2) + "G";
}

/** An exact energy figure for titles: 123,486.5 node·ms. */
export const fmtEExact = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? "–" : `${(Math.round(x * 10) / 10).toLocaleString()} node·ms`;

/** A flower's CPU time: one decimal under 10 ms. */
export const fmtMs = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? "–" : x < 10 ? x.toFixed(1) : String(Math.round(x));

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

/** A size in bytes: 512 B, 4.1 KB, 1.00 MB. */
export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}
