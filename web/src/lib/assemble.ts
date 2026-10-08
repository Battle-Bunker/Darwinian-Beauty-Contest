// Best-effort assembly of pollen grains. A grain is a run of characters of one flower version's minified
// code, from an unknown start, wrapping past the end, so the code is a circle and the grains are arcs of
// it. Like shotgun sequencing: drop duplicate and contained grains, find where one grain's end overlaps
// another's start (at least MIN_OVERLAP characters, longest first), and greedily join them into contigs.
// The result is the pieces recovered, in no known order (no grain says where it starts), with unknown
// characters in between. A wrong join is possible where the code repeats itself; with the real code at
// hand (after the game, or your own flower), placeGrains says exactly what leaked.

export const MIN_OVERLAP = 8;

export interface Assembly {
  /** The recovered pieces, longest first. */
  contigs: string[];
  /** The whole code was recovered (up to where it starts: grains don't say). */
  complete: boolean;
  /** Characters recovered, at most the code's length. */
  known: number;
  length: number;
  /** Distinct grains used (after dropping repeats and grains inside others). */
  used: number;
}

/** Overlap of a's end with b's start, at least `min` long (0 if none); `max` caps it. */
function overlap(a: string, b: string, min: number): number {
  const max = Math.min(a.length, b.length) - 1;
  for (let k = max; k >= min; k--) if (a.endsWith(b.slice(0, k))) return k;
  return 0;
}

export function assemble(grains: string[], length: number, min = MIN_OVERLAP): Assembly {
  const L = Math.max(1, length);
  // A grain as long as the code is the whole code (wrapped from some start).
  const whole = grains.find((g) => g.length >= L);
  if (whole) return { contigs: [whole.slice(0, L)], complete: true, known: L, length: L, used: 1 };
  // Distinct grains, longest first, without those inside another.
  const distinct = [...new Set(grains.filter((g) => g.length > 0))].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const g of distinct) if (!kept.some((k) => k.includes(g))) kept.push(g);
  const n = kept.length;
  if (!n) return { contigs: [], complete: false, known: 0, length: L, used: 0 };

  // Candidate joins: index every grain by its first `min` characters, then look for each grain's suffixes.
  const byPrefix = new Map<string, number[]>();
  kept.forEach((g, i) => {
    if (g.length < min) return;
    const p = g.slice(0, min);
    const list = byPrefix.get(p);
    if (list) list.push(i); else byPrefix.set(p, [i]);
  });
  const edges: [number, number, number][] = [];
  kept.forEach((a, i) => {
    const seen = new Set<number>();
    for (let s = 1; s <= a.length - min; s++) {
      for (const j of byPrefix.get(a.slice(s, s + min)) ?? []) {
        if (j === i || seen.has(j)) continue;
        const k = overlap(a, kept[j], min);
        if (k >= min) { edges.push([k, i, j]); seen.add(j); }
      }
    }
  });
  edges.sort((x, y) => y[0] - x[0]);

  // Greedy: take the longest overlaps first, each grain joined at most once on each side, no cycles
  // (a cycle closing the whole circle is noted instead).
  const next = new Array<number>(n).fill(-1), prev = new Array<number>(n).fill(-1), ov = new Array<number>(n).fill(0);
  const root = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (root[x] === x ? x : (root[x] = find(root[x])));
  let closed: { i: number; j: number; k: number } | null = null;
  for (const [k, i, j] of edges) {
    if (next[i] !== -1 || prev[j] !== -1) continue;
    if (find(i) === find(j)) { if (!closed) closed = { i, j, k }; continue; }
    next[i] = j; prev[j] = i; ov[i] = k;
    root[find(i)] = find(j);
  }

  // Follow the chains into contigs.
  const contigs: string[] = [];
  for (let s = 0; s < n; s++) {
    if (prev[s] !== -1) continue;
    let text = kept[s], cur = s;
    while (next[cur] !== -1) { const j = next[cur]; text += kept[j].slice(ov[cur]); cur = j; }
    contigs.push(text);
  }
  contigs.sort((a, b) => b.length - a.length);
  // One contig that has gone round the circle (or closes on itself) is the whole code.
  if (contigs.length === 1 && (contigs[0].length >= L || closed)) {
    return { contigs: [contigs[0].slice(0, L)], complete: contigs[0].length >= L || !!closed, known: L, length: L, used: n };
  }
  const known = Math.min(L, contigs.reduce((t, c) => t + c.length, 0));
  return { contigs, complete: false, known, length: L, used: n };
}

/**
 * Where grains fall in the real code (a circle): which characters leaked. A grain found more than once
 * (the code repeats itself) marks its first place. Returns per-character coverage and how many grains
 * weren't found at all (from another version, or the code isn't the one that answered).
 */
export function placeGrains(code: string, grains: string[]): { covered: Uint8Array; missing: number; fraction: number } {
  const L = code.length;
  const covered = new Uint8Array(L);
  if (!L) return { covered, missing: grains.length, fraction: 0 };
  const twice = code + code;
  let missing = 0;
  for (const g of new Set(grains)) {
    if (g.length >= L) { covered.fill(1); continue; }
    const at = twice.indexOf(g);
    if (at < 0 || at >= L) { missing++; continue; }
    for (let k = 0; k < g.length; k++) covered[(at + k) % L] = 1;
  }
  let n = 0;
  for (const c of covered) n += c;
  return { covered, missing, fraction: n / L };
}

/** Whether a recovered piece is really in the code (a wrong join isn't). */
export const inCode = (code: string, piece: string) => piece.length >= code.length ? (code + code).includes(piece.slice(0, code.length)) : (code + code).includes(piece);

/**
 * Where a whole code recovered from grains probably starts (grains don't say): the first statement that
 * usually opens a program, else where it already starts. Returns the rotated text.
 */
export function guessStart(text: string): string {
  const m = /(^|[^\w$])(import |from |function |"use strict"|const |let |var |def |class )/.exec(text);
  if (!m) return text;
  const at = m.index + m[1].length;
  return text.slice(at) + text.slice(0, at);
}
