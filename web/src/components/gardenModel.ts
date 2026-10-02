// Geometry and timeline for the garden animation. Everything is a pure function of the round's
// visits and a time t measured in turns (0 → round.turns), so scrubbing and replaying are exact.
//
// Within a visit [start, end) (engine v2):
//   asksBeforeFeed asks occupy [start, askEnd), one turn each (the flight in fills the first half of the first)
//   a feed occupies [askEnd, feedEnd) (feedCost turns); the result shows a little before halfway
//   the remaining asks [feedEnd, end) are the bee "studying" the flower it just fed at
//   an error costs one turn after the asks; a leave costs nothing (or 1 turn if nothing was asked)
import type { Visit } from "../types";

export const CELL_W = 250;
export const CELL_H = 215;
export const TOP_PAD = 70;
export const SIDE_PAD = 26;
export const FLOWER_DX = 30;
export const FLOWER_Y = -30;

export interface Pt { x: number; y: number }

export interface Layout {
  width: number;
  height: number;
  cols: number;
  pos: Record<string, Pt>;
}

/** Pick a grid that keeps the garden roughly 2:1 and readable at this container width. */
export function layoutGarden(teamIds: string[], containerWidth: number): Layout {
  const n = Math.max(1, teamIds.length);
  const maxCols = Math.max(2, Math.floor((containerWidth || 900) / 150));
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= Math.min(n, maxCols); cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (cols * CELL_W + 2 * SIDE_PAD) / (rows * CELL_H + TOP_PAD);
    const empty = rows * cols - n;
    const score = Math.abs(Math.log(aspect / 2)) + 0.25 * empty;
    if (score < best.score) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const pos: Record<string, Pt> = {};
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    // Centre a short last row, and nudge patches a little so the garden doesn't look like a spreadsheet.
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const offset = ((cols - inRow) * CELL_W) / 2;
    const jx = (((i * 37) % 11) - 5) * 2.5, jy = (((i * 53) % 7) - 3) * 4;
    pos[id] = { x: SIDE_PAD + offset + CELL_W * (col + 0.5) + jx, y: TOP_PAD + CELL_H * row + 120 + jy };
  });
  return { width: cols * CELL_W + 2 * SIDE_PAD, height: TOP_PAD + rows * CELL_H + 36, cols, pos };
}

/**
 * Where bee number `b` (of n) hovers around a patch: one slot per bee on an arc over the flowers
 * (from just below the left side, over the top, to just below the right), so bees never collide.
 */
export function slot(p: Pt, b: number, n: number): Pt {
  const from = -Math.PI - 0.45, span = Math.PI + 0.9;
  const a = from + (span * (b + 0.5)) / Math.max(n, 1);
  return { x: p.x + 94 * Math.cos(a), y: p.y + FLOWER_Y - 6 + 58 * Math.sin(a) };
}

/**
 * How a team's patch is drawn, stable per (game, team) so every viewer sees the same picture. Two
 * independent bits: which side the clover is on, and which variety (daisy or star) is on the left.
 * Neither says anything about which flower is the clover unless you may know (owner, or revealed).
 */
export interface PatchLook { cloverLeft: boolean; daisyLeft: boolean }

export function patchLook(gameId: string, teamId: string): PatchLook {
  let h = 2166136261;
  const key = `${gameId}:${teamId}`;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return { cloverLeft: (h & 1) === 1, daisyLeft: (h & 2) === 2 };
}

/** x offset of a flower of this kind within its patch (0 = between the two, for viewers who can't know). */
export function kindX(kind: string | undefined, look: PatchLook | undefined): number {
  if (!look || (kind !== "clover" && kind !== "orchid")) return 0;
  return (kind === "clover") === look.cloverLeft ? -FLOWER_DX : FLOWER_DX;
}

/** Where a feeding bee sits: on the flower if the viewer may know which one, else between the two. */
export function landing(p: Pt, kind: string | undefined, b: number, n: number, look?: PatchLook): Pt {
  const s = slot({ x: 0, y: 0 }, b, n);
  const nudge = { x: s.x * 0.2, y: (s.y - FLOWER_Y + 6) * 0.15 };
  return { x: p.x + kindX(kind, look) + nudge.x, y: p.y + FLOWER_Y - 4 + nudge.y };
}

export interface Track {
  teamId: string;
  index: number;      // bee slot (participants order)
  visits: Visit[];    // by seq
}

export type Mode = "home" | "fly" | "ask" | "feed" | "study" | "error" | "glance" | "done";

export interface BeeFrame {
  x: number; y: number;
  flip: boolean;      // facing left
  mode: Mode;
  pulse: number;      // 0..1 within the current ask
  tilt: number;       // degrees
  visit?: Visit;
}

export interface FeedEffect {
  t0: number; span: number; at: Pt; nectar: boolean; bee: string; patch: string;
}

export interface Tally { feeds: number; nectar: number; errors: number; asks: number; studied: number; visits: number }
export interface PatchTally { fedAt: number; nectarGiven: number; pollinators: Set<string>; visits: number }

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });

/** The phases of a visit: asks before the feed end at askEnd, the feed ends at feedEnd, then post-feed asks. */
export function phases(v: Visit) {
  const before = Math.min(v.asks, v.asksBeforeFeed ?? v.asks);
  const after = v.action === "feed" ? v.asks - before : 0;
  const askEnd = v.start + before;
  const feedEnd = v.end - after;
  return { askEnd, feedEnd, after };
}
/** When a feed's result (nectar or not) appears. */
export const feedResultAt = (v: Visit) => { const p = phases(v); return p.askEnd + (p.feedEnd - p.askEnd) * 0.45; };

export interface Model {
  tracks: Track[];
  effects: FeedEffect[];
  n: number;
}

export function buildModel(visits: Visit[], beeOrder: string[], pos: Record<string, Pt>, looks: Record<string, PatchLook>): Model {
  const n = beeOrder.length;
  const byBee = new Map<string, Visit[]>(beeOrder.map((id) => [id, []]));
  for (const v of visits) byBee.get(v.bee)?.push(v);
  const tracks: Track[] = beeOrder.map((teamId, index) => ({ teamId, index, visits: byBee.get(teamId)!.sort((a, b) => a.seq - b.seq) }));
  const effects: FeedEffect[] = [];
  for (const tr of tracks) {
    for (const v of tr.visits) {
      if (v.action !== "feed" || !pos[v.patch]) continue;
      const p = phases(v);
      effects.push({ t0: feedResultAt(v), span: Math.max(1.6, (p.feedEnd - p.askEnd) * 0.55 + 0.6), at: landing(pos[v.patch], v.kind, tr.index, n, looks[v.patch]), nectar: !!v.nectar, bee: v.bee, patch: v.patch });
    }
  }
  effects.sort((a, b) => a.t0 - b.t0);
  return { tracks, effects, n };
}

function bezier(a: Pt, b: Pt, u: number): Pt {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 30 - dist * 0.22 };
  const k = 1 - u;
  return { x: k * k * a.x + 2 * k * u * c.x + u * u * b.x, y: k * k * a.y + 2 * k * u * c.y + u * u * b.y };
}

/** Where a bee hovers while it studies a flower it has fed at: close to the flower, a little above. */
const studySpot = (land: Pt, slotPt: Pt): Pt => { const p = lerp(land, slotPt, 0.4); return { x: p.x, y: p.y - 6 }; };

/** The bee's position and pose at time t (turns). */
export function beeFrame(tr: Track, t: number, pos: Record<string, Pt>, n: number, home: Pt, looks: Record<string, PatchLook>): BeeFrame {
  const vs = tr.visits;
  const at = (teamId: string) => (pos[teamId] ? slot(pos[teamId], tr.index, n) : home);
  const faceTo = (p: Pt, patch: Pt | undefined) => (patch ? p.x > patch.x : false);
  const bob = Math.sin(t * 6 + tr.index) * 1.5;
  // Where a visit leaves the bee: by the flower if it was studying it, else at its hover slot.
  const endSpot = (v: Visit): Pt => {
    const target = at(v.patch);
    if (v.action === "feed" && phases(v).after > 0 && pos[v.patch]) return studySpot(landing(pos[v.patch], v.kind, tr.index, n, looks[v.patch]), target);
    return target;
  };

  if (!vs.length || t < vs[0].start) {
    const p = home;
    return { x: p.x, y: p.y + bob, flip: faceTo(p, pos[tr.teamId]), mode: "home", pulse: 0, tilt: 0 };
  }
  // Binary search: last visit with start <= t.
  let lo = 0, hi = vs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (vs[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  const k = lo, v = vs[k];
  const patch = pos[v.patch];
  const target = at(v.patch);
  if (t >= v.end) {
    const e = endSpot(v);
    return { x: e.x, y: e.y + bob, flip: faceTo(target, patch), mode: k === vs.length - 1 ? "done" : "glance", pulse: 0, tilt: 0, visit: v };
  }
  const from = k === 0 ? home : endSpot(vs[k - 1]);
  const rel = t - v.start, dur = v.end - v.start;
  const fly = Math.min(0.5, dur * 0.5);
  if (rel < fly) {
    const u = ease(rel / fly);
    const p = bezier(from, target, u);
    const dx = target.x - from.x;
    return { x: p.x, y: p.y, flip: Math.abs(dx) > 1 ? dx < 0 : faceTo(p, patch), mode: "fly", pulse: 0, tilt: Math.max(-18, Math.min(18, (target.y - from.y) * 0.08)) * (dx < 0 ? -1 : 1), visit: v };
  }
  const { askEnd, feedEnd, after } = phases(v);
  const pulseAt = (from0: number) => {
    const r = t - from0, i = Math.floor(r);
    const frac = i === 0 && from0 === v.start ? (r - fly) / Math.max(0.01, 1 - fly) : r - i;
    return Math.sin(Math.PI * Math.min(1, Math.max(0, frac)));
  };
  if (t < askEnd) {
    return { x: target.x, y: target.y + bob, flip: faceTo(target, patch), mode: "ask", pulse: pulseAt(v.start), tilt: 0, visit: v };
  }
  if (v.action === "feed") {
    const land = landing(patch, v.kind, tr.index, n, looks[v.patch]);
    if (t < feedEnd) {
      const q = (t - askEnd) / Math.max(0.01, feedEnd - askEnd);
      // Fly down onto the flower, sip, then lift off: back to the hover slot, or just above the flower to study it.
      const leaveTo = after > 0 ? studySpot(land, target) : target;
      const p = q < 0.25 ? lerp(target, land, ease(q / 0.25)) : q > 0.85 ? lerp(land, leaveTo, ease((q - 0.85) / 0.15)) : land;
      return { x: p.x, y: p.y + (q > 0.25 && q < 0.85 ? Math.sin(t * 14) * 0.8 : 0), flip: faceTo(target, patch), mode: "feed", pulse: 0, tilt: 0, visit: v };
    }
    const sp = studySpot(land, target);
    return { x: sp.x, y: sp.y + bob * 0.6, flip: faceTo(target, patch), mode: "study", pulse: pulseAt(feedEnd), tilt: 0, visit: v };
  }
  if (v.action === "error") {
    return { x: target.x, y: target.y, flip: faceTo(target, patch), mode: "error", pulse: 0, tilt: Math.sin(t * 40) * 14, visit: v };
  }
  return { x: target.x, y: target.y + bob, flip: faceTo(target, patch), mode: "glance", pulse: 0, tilt: 0, visit: v };
}

/** Running tallies of everything that has happened by time t. */
export function tallies(model: Model, t: number) {
  const bees: Record<string, Tally> = {};
  const patches: Record<string, PatchTally> = {};
  for (const tr of model.tracks) {
    bees[tr.teamId] = { feeds: 0, nectar: 0, errors: 0, asks: 0, studied: 0, visits: 0 };
    patches[tr.teamId] ||= { fedAt: 0, nectarGiven: 0, pollinators: new Set(), visits: 0 };
  }
  for (const tr of model.tracks) {
    const b = bees[tr.teamId];
    for (const v of tr.visits) {
      if (v.start > t) break;
      b.visits++;
      const p = (patches[v.patch] ||= { fedAt: 0, nectarGiven: 0, pollinators: new Set(), visits: 0 });
      p.visits++;
      if (t >= v.end) {
        b.asks += v.asks;
        if (v.action === "feed") b.studied += v.asks - Math.min(v.asks, v.asksBeforeFeed ?? v.asks);
      } else {
        const ph = phases(v);
        b.asks += Math.min(ph.askEnd - v.start, Math.max(0, Math.ceil(t - v.start)));
        if (t > ph.feedEnd) { const s = Math.min(ph.after, Math.ceil(t - ph.feedEnd)); b.asks += s; b.studied += s; }
      }
      if (v.action === "feed" && t >= feedResultAt(v)) {
        b.feeds++;
        p.fedAt++;
        p.pollinators.add(v.bee);
        if (v.nectar) { b.nectar++; p.nectarGiven++; }
      }
      if (v.action === "error" && t >= phases(v).askEnd) b.errors++;
    }
  }
  return { bees, patches };
}
