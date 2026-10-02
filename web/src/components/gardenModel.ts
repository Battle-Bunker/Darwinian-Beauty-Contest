// Geometry and the live animation for the garden. The garden plays the action stream a moment behind
// the game clock (DELAY), so actions that arrive in bursts (the server flushes a few times a second)
// play out at the game times they happened. The game runs in lockstep rounds (200 ms by default): each
// bee acts at most once a round, so a bee can be shown doing every single thing it does. A bee flies to
// its next patch right after the last action of its previous visit, arriving as its first question
// there is asked; when it feeds it sits on the patch for the rounds it's out of play.
//
// Each team's patch has its cosmos on the left and its orchid on the right; a bee hovers by and lands on
// the flower it's at (every action says which). Each bee has its own slot on an arc above every patch, so
// bees visiting the same patch never sit on top of each other. (An action without a kind, which the API
// shouldn't send, falls back to the middle of the patch.)
import type { Action, FlowerKind } from "../types";
import type { LiveStore } from "../lib/live";

export const CELL_W = 250;
export const CELL_H = 215;
export const TOP_PAD = 70;
export const SIDE_PAD = 26;
export const FLOWER_DX = 30;
export const FLOWER_Y = -30;

/** How far behind the game clock the garden plays (ms of game time). */
export const DELAY = 1100;
/** How far ahead of what it shows the garden looks, to start flights in time. */
const LOOKAHEAD = 450;
const FLY_MS = 200;    // a flight between patches, ideally
const MIN_FLY = 160;   // never shorter than this
const ASK_MS = 600;    // the question bubble stays up this long after a question (it pops at each new one)
const ERR_MS = 700;
export const FX_MS = 1100;
const MAX_FX = 48;
const MERGE_MS = 400;  // feeds at the same spot within this share one effect, with a count

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

/** x offset of a flower within its patch: the cosmos on the left, the orchid on the right; 0 (the middle
 *  of the patch) when which flower it is isn't known. */
export const flowerX = (kind: FlowerKind | undefined) => (kind === "cosmos" ? -FLOWER_DX : kind === "orchid" ? FLOWER_DX : 0);

/** -0.5..0.5: bee b's place in a row of n. */
const rowPos = (b: number, n: number) => (n > 1 ? b / (n - 1) - 0.5 : 0);

/** Where a bee hovers while it questions a flower: its slot, pulled toward that flower (fallback: above the patch). */
export function hoverAt(p: Pt, kind: FlowerKind | undefined, b: number, n: number): Pt {
  if (kind === undefined) {
    const u = rowPos(b, n);
    return { x: p.x + u * Math.min(96, 19 * Math.max(1, n - 1)), y: p.y + FLOWER_Y - 44 + Math.abs(u) * 14 };
  }
  const s = slot(p, b, n);
  const fx = p.x + flowerX(kind), fy = p.y + FLOWER_Y;
  return { x: s.x + (fx - s.x) * 0.38, y: s.y + (fy - s.y) * 0.3 };
}

/** Where a feeding bee sits: on the flower head (fallback: between the two flowers), nudged a little per bee. */
export function landing(p: Pt, kind: FlowerKind | undefined, b: number, n: number): Pt {
  if (kind === undefined) return { x: p.x + rowPos(b, n) * 14, y: p.y + FLOWER_Y - 8 };
  const s = slot({ x: 0, y: 0 }, b, n);
  return { x: p.x + flowerX(kind) + s.x * 0.12, y: p.y + FLOWER_Y - 6 + (s.y - FLOWER_Y + 6) * 0.1 };
}

/** The key of the spot an action happened at: the flower if known, else the patch. */
export const spotKey = (patch: string, kind: FlowerKind | undefined) => `${patch}:${kind ?? ""}`;

/** A bee's home: its slot over its own patch. */
export const homeOf = (layout: Layout, team: string, b: number, n: number): Pt => (layout.pos[team] ? slot(layout.pos[team], b, n) : { x: 0, y: 0 });

export type Mode = "home" | "rest" | "fly" | "ask" | "feed" | "error" | "idle";

export interface BeeSprite {
  team: string; index: number;
  x: number; y: number;
  flip: boolean;      // facing left
  mode: Mode;
  pulse: number;      // 0..1: the question bubble's pop
  tilt: number;       // degrees
  flap: number;       // wing stroke, 0.35..1 (1: wings still)
}

export interface Fx { id: number; x: number; y: number; t0: number; nectar: boolean; count: number; key: string }

/** Where a bee is headed: a flower (or a patch, when which flower isn't known), or home. */
type Anchor = { patch: string; kind: FlowerKind | undefined } | null;

/** Something a bee does at real time t: an action, or setting off for its next visit. */
type Event = { t: number; a: Action } | { t: number; fly: { anchor: Anchor; arrive: number } };

interface BeeState {
  team: string; index: number;
  anchor: Anchor;
  visit: number | null;     // the latest visit scheduled
  lastT: number;            // real time of the last event scheduled
  from: Pt; t0: number; t1: number; // the flight in progress (real time)
  queue: Event[];
  askAt: number; feedAt: number; errorAt: number;
  last: Pt; // where it was drawn last
}

export interface Frame { bees: BeeSprite[]; fx: Fx[]; glow: Record<string, number>; display: number }

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
function bezier(a: Pt, b: Pt, u: number): Pt {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 20 - dist * 0.18 };
  const k = 1 - u;
  return { x: k * k * a.x + 2 * k * u * c.x + u * u * b.x, y: k * k * a.y + 2 * k * u * c.y + u * u * b.y };
}

/** First index in `actions` (sorted by seq) with seq > after. */
function indexAfter(actions: Action[], after: number): number {
  let lo = 0, hi = actions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].seq <= after) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export class GardenAnimator {
  layout: Layout;
  order: string[];
  private bees = new Map<string, BeeState>();
  private fx: Fx[] = [];
  private glow = new Map<string, number>();
  private display = -1;   // the game time being shown; -1 until the first step
  private cursor = 0;     // the last seq scheduled
  private lastReal = 0;
  private fxId = 0;
  private feedHold = 2000; // how long a feeding bee sits on its flower: the rounds it's out of play
  /** Set when the garden has nothing left to animate (lets the page stop its animation loop). */
  idle = false;

  constructor(layout: Layout, order: string[]) {
    this.layout = layout;
    this.order = order;
    this.setTeams(layout, order);
  }

  /** Round length and how many rounds a feeding bee sits out (the game's config). */
  setTiming(roundMs: number, feedRounds: number) {
    this.feedHold = Math.max(500, Math.min(6000, roundMs * Math.max(1, feedRounds)));
  }

  setTeams(layout: Layout, order: string[]) {
    this.layout = layout;
    this.order = order;
    const n = order.length;
    order.forEach((team, index) => {
      const b = this.bees.get(team);
      if (b) { b.index = index; return; }
      const home = homeOf(layout, team, index, n);
      this.bees.set(team, { team, index, anchor: null, visit: null, lastT: 0, from: home, t0: 0, t1: 0, queue: [], askAt: -1e9, feedAt: -1e9, errorAt: -1e9, last: home });
    });
  }

  private anchorPt(b: BeeState): Pt {
    const n = this.order.length;
    if (!b.anchor || !this.layout.pos[b.anchor.patch]) return homeOf(this.layout, b.team, b.index, n);
    return hoverAt(this.layout.pos[b.anchor.patch], b.anchor.kind, b.index, n);
  }

  private fly(b: BeeState, anchor: Anchor, now: number, arrive: number) {
    b.from = b.last;
    b.anchor = anchor;
    b.t0 = now;
    b.t1 = Math.max(now + MIN_FLY, arrive);
  }

  /** Put every bee straight where the actions up to game time `t` leave it (no animation). */
  private jump(store: LiveStore, t: number) {
    const acts = store.actions;
    let i = indexAfter(acts, this.cursor);
    for (; i < acts.length && acts[i].atMs <= t; i++) {
      const a = acts[i], b = this.bees.get(a.bee);
      this.cursor = a.seq;
      if (!b) continue;
      b.visit = a.visit;
      b.anchor = { patch: a.patch, kind: a.kind };
    }
    for (const b of this.bees.values()) {
      b.queue = [];
      b.lastT = 0;
      b.t0 = b.t1 = 0;
      b.feedAt = -1e9;
      b.last = this.anchorPt(b);
    }
    this.fx = [];
    this.display = t;
  }

  /**
   * Advance to real time `now`. clock: the game clock now; status decides whether the garden plays
   * (running), catches up and holds (paused), or sends the bees home (finished, lobby).
   */
  step(store: LiveStore, now: number, clock: number, status: string) {
    const dt = this.lastReal ? Math.min(250, now - this.lastReal) : 0;
    this.lastReal = now;
    if (status === "lobby") { this.display = clock; this.idle = true; return; }
    const target = status === "running" ? clock - DELAY : clock;
    if (this.display < 0) {
      // First step: a finished game shows its bees at home; otherwise start just behind the clock.
      this.jump(store, status === "finished" ? clock : Math.max(0, target));
      if (status === "finished") for (const b of this.bees.values()) { b.anchor = null; b.last = this.anchorPt(b); }
    } else if (this.display < target - 4000) {
      this.jump(store, target - 200); // fell far behind (a hidden tab): skip ahead
    }
    // Real-time playback, never past the target (a stopped game catches up a little faster).
    this.display = Math.min(target, this.display + dt * (status === "running" ? 1 : 2));

    // Schedule what happens up to a little ahead of what's shown. A new visit starts with a flight that
    // sets off once the previous visit's last action has played, and lands as the first one here happens.
    const acts = store.actions;
    if (acts.length && this.cursor < acts[0].seq - 1) this.cursor = acts[0].seq - 1; // ring moved on
    for (let i = indexAfter(acts, this.cursor); i < acts.length && acts[i].atMs <= this.display + LOOKAHEAD; i++) {
      const a = acts[i];
      this.cursor = a.seq;
      const b = this.bees.get(a.bee);
      if (!b) continue;
      const when = now + Math.max(0, a.atMs - this.display);
      if (a.visit !== b.visit) {
        b.visit = a.visit;
        const start = Math.min(when, Math.max(b.lastT, when - FLY_MS, now));
        b.queue.push({ t: start, fly: { anchor: { patch: a.patch, kind: a.kind }, arrive: Math.max(start + MIN_FLY, when) } });
      }
      b.queue.push({ t: when, a });
      b.lastT = when;
      if (b.queue.length > 64) b.queue.splice(0, b.queue.length - 64);
    }

    // Fire what's due, in order, bee by bee.
    const n = this.order.length;
    for (const b of this.bees.values()) {
      while (b.queue.length && b.queue[0].t <= now) {
        const e = b.queue.shift()!;
        if ("fly" in e) { b.feedAt = -1e9; this.fly(b, e.fly.anchor, now, e.fly.arrive); continue; }
        const { t, a } = e;
        if (a.action === "ask") { b.askAt = t; b.feedAt = -1e9; this.glow.set(spotKey(a.patch, a.kind), t); }
        else if (a.action === "feed") {
          b.feedAt = t;
          const p = this.layout.pos[a.patch];
          if (p) this.spawn(landing(p, a.kind, b.index, n), spotKey(a.patch, a.kind), !!a.nectar, now);
        } else if (a.action === "error") { b.errorAt = t; b.feedAt = -1e9; }
        else b.feedAt = -1e9; // leave
      }
    }

    // A finished game: once everything has played, the bees go home to rest.
    if (status === "finished" && this.display >= target) {
      for (const b of this.bees.values()) {
        if (b.anchor && !b.queue.length && now >= b.t1 && now - Math.max(b.askAt, b.feedAt) > 600) this.fly(b, null, now, now + 900);
      }
    }
    this.fx = this.fx.filter((f) => now - f.t0 < FX_MS);
    const busy = this.fx.length > 0 || [...this.bees.values()].some((b) => b.queue.length || now < b.t1 + 50 || now - b.feedAt < this.feedHold || now - b.askAt < ASK_MS || now - b.errorAt < ERR_MS);
    this.idle = status !== "running" && this.display >= target && !busy;
  }

  private spawn(at: Pt, key: string, nectar: boolean, now: number) {
    // Feeds that land on the same spot close together share one effect with a count.
    const same = this.fx.find((f) => f.key === key && f.nectar === nectar && now - f.t0 < MERGE_MS);
    if (same) { same.count++; return; }
    this.fx.push({ id: ++this.fxId, x: at.x, y: at.y, t0: now, nectar, count: 1, key });
    if (this.fx.length > MAX_FX) this.fx.splice(0, this.fx.length - MAX_FX);
  }

  /** What to draw at real time `now`. */
  frame(now: number, status: string): Frame {
    const n = this.order.length;
    const bees: BeeSprite[] = [];
    for (const b of this.bees.values()) {
      const home = homeOf(this.layout, b.team, b.index, n);
      const target = this.anchorPt(b);
      const bob = Math.sin(now / 160 + b.index * 1.7) * 1.4;
      const patchPt = b.anchor ? this.layout.pos[b.anchor.patch] : undefined;
      const face = (p: Pt) => (b.anchor && patchPt ? p.x > patchPt.x + flowerX(b.anchor.kind) : p.x > (this.layout.pos[b.team]?.x ?? 0));
      let s: BeeSprite;
      if (now < b.t1) {
        const u = ease(Math.max(0, Math.min(1, (now - b.t0) / Math.max(1, b.t1 - b.t0))));
        const p = bezier(b.from, target, u);
        const dx = target.x - b.from.x;
        s = { team: b.team, index: b.index, x: p.x, y: p.y, flip: Math.abs(dx) > 1 ? dx < 0 : face(p), mode: "fly", pulse: 0, tilt: Math.max(-16, Math.min(16, (target.y - b.from.y) * 0.08)) * (dx < 0 ? -1 : 1), flap: 1 };
      } else if (!b.anchor || !patchPt) {
        const resting = status === "finished" || status === "lobby";
        s = { team: b.team, index: b.index, x: home.x, y: home.y + (resting ? 0 : bob), flip: face(home), mode: resting ? (status === "finished" ? "rest" : "home") : "idle", pulse: 0, tilt: 0, flap: 1 };
      } else {
        const sinceFeed = now - b.feedAt, sinceAsk = now - b.askAt, sinceErr = now - b.errorAt;
        let p = target, mode: Mode = "idle", pulse = 0, tilt = 0;
        if (sinceFeed >= 0 && sinceFeed < this.feedHold) {
          // Drop onto the flower (or the patch), sip while out of play, lift off at the end.
          const land = landing(patchPt, b.anchor.kind, b.index, n);
          const down = Math.min(1, sinceFeed / 180), up = Math.max(0, (sinceFeed - (this.feedHold - 180)) / 180);
          p = up > 0 ? lerp(land, target, ease(up)) : lerp(target, land, ease(down));
          mode = "feed";
        } else if (sinceErr >= 0 && sinceErr < ERR_MS) {
          mode = "error";
          tilt = Math.sin(now / 25) * 14;
        } else if (sinceAsk >= 0 && sinceAsk < ASK_MS) {
          mode = "ask";
          pulse = sinceAsk < 160 ? Math.sin((Math.PI / 2) * (sinceAsk / 160)) : Math.max(0.55, 1 - (sinceAsk - 160) / 900);
        }
        const still = status === "paused";
        s = { team: b.team, index: b.index, x: p.x, y: p.y + (mode === "feed" || still ? 0 : bob), flip: face(p), mode, pulse, tilt, flap: 1 };
      }
      // Wings beat whenever the bee is airborne in a live game (drawn here, not by CSS: the bee is redrawn every frame anyway).
      if (status === "running" && s.mode !== "feed") s.flap = 0.35 + 0.65 * Math.abs(Math.sin(now / 30 + b.index * 0.7));
      b.last = { x: s.x, y: s.y };
      bees.push(s);
    }
    // Busy bees on top.
    bees.sort((a, b) => Number(a.mode !== "idle" && a.mode !== "home" && a.mode !== "rest") - Number(b.mode !== "idle" && b.mode !== "home" && b.mode !== "rest"));
    const glow: Record<string, number> = {};
    for (const [k, t] of this.glow) {
      const u = (now - t) / 500;
      if (u >= 0 && u < 1) glow[k] = 1 - u;
      else if (u >= 1) this.glow.delete(k);
    }
    return { bees, fx: this.fx.map((f) => ({ ...f })), glow, display: this.display };
  }
}
