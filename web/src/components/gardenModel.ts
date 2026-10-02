// Geometry and the live animation for the garden. The garden plays the action stream a moment behind
// the game clock (DELAY), so actions that arrive in bursts (the server flushes a few times a second)
// play out smoothly at the game times they happened, and a bee can be seen flying to a flower before
// its first question there. Everything is driven by real time (performance.now()) once scheduled.
// Bees can visit dozens of flowers a second; a drawn bee can't. When visits come faster than a bee can
// fly and linger, it skips ahead to its latest visit (the flowers it skipped still light up and show
// their feeds), so it hops at a readable pace without falling behind.
//
// Each team's patch has its cosmos on the left and its orchid on the right (which flower is which is
// public: every action says which one a bee visited). Each bee has its own slot on an arc above every
// patch, so bees visiting the same patch never sit on top of each other.
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
const LOOKAHEAD = 380;
const MIN_FLY = 110;
const HOP_MS = 210;    // a flight when skipping ahead
const DWELL_MS = 160;  // the least time a bee lingers at a flower before hopping on
const ASK_MS = 420;
const FEED_MS = 650;
const ERR_MS = 700;
export const FX_MS = 1100;
const MAX_FX = 48;
const MERGE_MS = 700;  // feeds at the same flower within this share one effect, with a count

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

/** x offset of a flower within its patch: the cosmos on the left, the orchid on the right. */
export const flowerX = (kind: FlowerKind) => (kind === "cosmos" ? -FLOWER_DX : FLOWER_DX);

/** Where a bee hovers while it questions a flower: its slot, pulled toward that flower. */
export function hoverAt(p: Pt, kind: FlowerKind, b: number, n: number): Pt {
  const s = slot(p, b, n);
  const fx = p.x + flowerX(kind), fy = p.y + FLOWER_Y;
  return { x: s.x + (fx - s.x) * 0.38, y: s.y + (fy - s.y) * 0.3 };
}

/** Where a feeding bee sits: on the flower head, nudged a little per bee. */
export function landing(p: Pt, kind: FlowerKind, b: number, n: number): Pt {
  const s = slot({ x: 0, y: 0 }, b, n);
  return { x: p.x + flowerX(kind) + s.x * 0.12, y: p.y + FLOWER_Y - 6 + (s.y - FLOWER_Y + 6) * 0.1 };
}

/** A bee's home: its slot over its own patch. */
export const homeOf = (layout: Layout, team: string, b: number, n: number): Pt => (layout.pos[team] ? slot(layout.pos[team], b, n) : { x: 0, y: 0 });

export type Mode = "home" | "rest" | "fly" | "ask" | "feed" | "error" | "idle";

export interface BeeSprite {
  team: string; index: number;
  x: number; y: number;
  flip: boolean;      // facing left
  mode: Mode;
  pulse: number;      // 0..1 within an ask
  tilt: number;       // degrees
  flap: number;       // wing stroke, 0.35..1 (1: wings still)
}

export interface Fx { id: number; x: number; y: number; t0: number; nectar: boolean; count: number; key: string }

/** Where a bee is headed: a flower, or home. */
type Anchor = { patch: string; kind: FlowerKind } | null;

interface BeeState {
  team: string; index: number;
  anchor: Anchor;
  visit: number | null;     // the latest visit scheduled
  shown: number | null;     // the visit the drawn bee is at (or flying to)
  pending: { anchor: Anchor; visit: number; when: number } | null; // a newer visit to hop to
  from: Pt; t0: number; t1: number; // the flight in progress (real time)
  queue: { t: number; a: Action }[];
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
  /** Set when the garden has nothing left to animate (lets the page stop its animation loop). */
  idle = false;

  constructor(layout: Layout, order: string[]) {
    this.layout = layout;
    this.order = order;
    this.setTeams(layout, order);
  }

  setTeams(layout: Layout, order: string[]) {
    this.layout = layout;
    this.order = order;
    const n = order.length;
    order.forEach((team, index) => {
      const b = this.bees.get(team);
      if (b) { b.index = index; return; }
      const home = homeOf(layout, team, index, n);
      this.bees.set(team, { team, index, anchor: null, visit: null, shown: null, pending: null, from: home, t0: 0, t1: 0, queue: [], askAt: -1e9, feedAt: -1e9, errorAt: -1e9, last: home });
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
      b.visit = b.shown = a.visit;
      b.anchor = { patch: a.patch, kind: a.kind };
    }
    for (const b of this.bees.values()) {
      b.queue = [];
      b.pending = null;
      b.t0 = b.t1 = 0;
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
    // Real-time playback, never past the target.
    this.display = Math.min(target, this.display + dt);
    if (this.display < target && status !== "running") this.display = Math.min(target, this.display + dt); // catch up a little faster

    // Schedule what happens up to a little ahead of what's shown.
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
        const anchor = { patch: a.patch, kind: a.kind };
        if (now >= b.t1 + DWELL_MS) { b.shown = a.visit; b.pending = null; this.fly(b, anchor, now, when); }
        else b.pending = { anchor, visit: a.visit, when };
      }
      b.queue.push({ t: when, a });
      if (b.queue.length > 64) b.queue.splice(0, b.queue.length - 64);
    }

    // Hop on to the latest visit once a bee has lingered long enough where it is.
    for (const b of this.bees.values()) {
      if (b.pending && now >= b.t1 + DWELL_MS) {
        b.shown = b.pending.visit;
        this.fly(b, b.pending.anchor, now, Math.max(now + HOP_MS, b.pending.when));
        b.pending = null;
      }
    }

    // Fire what's due. The flower lights up and shows its feeds whatever the drawn bee is doing; the
    // bee itself asks and sips only at the flower it's drawn at.
    const n = this.order.length;
    for (const b of this.bees.values()) {
      while (b.queue.length && b.queue[0].t <= now) {
        const { t, a } = b.queue.shift()!;
        const here = a.visit === b.shown;
        if (a.action === "ask") { if (here) b.askAt = t; this.glow.set(`${a.patch}:${a.kind}`, t); }
        else if (a.action === "feed") {
          if (here) b.feedAt = t;
          const p = this.layout.pos[a.patch];
          if (p) this.spawn(landing(p, a.kind, b.index, n), `${a.patch}:${a.kind}`, !!a.nectar, now);
        } else if (a.action === "error") b.errorAt = t;
      }
    }

    // A finished game: once everything has played, the bees go home to rest.
    if (status === "finished" && this.display >= target) {
      for (const b of this.bees.values()) {
        if (b.anchor && !b.queue.length && now >= b.t1 && now - Math.max(b.askAt, b.feedAt) > 600) this.fly(b, null, now, now + 900);
      }
    }
    this.fx = this.fx.filter((f) => now - f.t0 < FX_MS);
    const busy = this.fx.length > 0 || [...this.bees.values()].some((b) => b.queue.length || b.pending || now < b.t1 + 50 || now - b.feedAt < FEED_MS || now - b.askAt < ASK_MS || now - b.errorAt < ERR_MS);
    this.idle = status !== "running" && this.display >= target && !busy;
  }

  private spawn(at: Pt, key: string, nectar: boolean, now: number) {
    // Feeds that land on the same flower close together share one effect with a count.
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
      const face = (p: Pt) => (b.anchor && this.layout.pos[b.anchor.patch] ? p.x > this.layout.pos[b.anchor.patch].x + flowerX(b.anchor.kind) : p.x > (this.layout.pos[b.team]?.x ?? 0));
      let s: BeeSprite;
      if (now < b.t1) {
        const u = ease(Math.max(0, Math.min(1, (now - b.t0) / Math.max(1, b.t1 - b.t0))));
        const p = bezier(b.from, target, u);
        const dx = target.x - b.from.x;
        s = { team: b.team, index: b.index, x: p.x, y: p.y, flip: Math.abs(dx) > 1 ? dx < 0 : face(p), mode: "fly", pulse: 0, tilt: Math.max(-16, Math.min(16, (target.y - b.from.y) * 0.08)) * (dx < 0 ? -1 : 1), flap: 1 };
      } else if (!b.anchor || !this.layout.pos[b.anchor.patch]) {
        const resting = status === "finished" || status === "lobby";
        s = { team: b.team, index: b.index, x: home.x, y: home.y + (resting ? 0 : bob), flip: face(home), mode: resting ? (status === "finished" ? "rest" : "home") : "idle", pulse: 0, tilt: 0, flap: 1 };
      } else {
        const sinceFeed = now - b.feedAt, sinceAsk = now - b.askAt, sinceErr = now - b.errorAt;
        let p = target, mode: Mode = "idle", pulse = 0, tilt = 0;
        if (sinceFeed >= 0 && sinceFeed < FEED_MS) {
          // Drop onto the flower, sip, lift off again.
          const q = sinceFeed / FEED_MS;
          const land = landing(this.layout.pos[b.anchor.patch], b.anchor.kind, b.index, n);
          p = q < 0.25 ? lerp(target, land, ease(q / 0.25)) : q > 0.8 ? lerp(land, target, ease((q - 0.8) / 0.2)) : land;
          mode = "feed";
        } else if (sinceErr >= 0 && sinceErr < ERR_MS) {
          mode = "error";
          tilt = Math.sin(now / 25) * 14;
        } else if (sinceAsk >= 0 && sinceAsk < ASK_MS) {
          mode = "ask";
          pulse = Math.sin(Math.PI * (sinceAsk / ASK_MS));
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
