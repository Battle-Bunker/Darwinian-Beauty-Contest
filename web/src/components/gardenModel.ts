// Geometry and the animation model for the garden: one flower per team and one bee per team. What the
// garden shows at game time D is computed from the turns (lib/turns.ts), not replayed event by event, so
// the live garden (D runs a moment behind the game clock) and the replay (D is wherever the scrubber is)
// are the same code, and any number of bees costs one binary search each per frame.
//
// A turn, in game time from its arrival t0: the bee flies to the flower it was drawn (FLY), asks its
// challenge, the response is delivered at flower.ms (150), and the bee decides: a feed lands it on the
// flower, where it sits out its feed_cost rounds until its next arrival; a leave keeps it hovering until
// its next turn takes it somewhere else.
import { showValue, fmtE } from "../lib/format";
import { fed, PATCH, type Turn, type TurnIndex } from "../lib/turns";

export const CELL_W = 170;
export const CELL_H = 214;
export const TOP_PAD = 58;
export const SIDE_PAD = 36;
/** The flowers of a species' patch, around the cell's ground point: [dx, head height]. The middle one is tallest. */
export const PATCH_AT: [number, number][] = [[-40, -48], [0, -70], [40, -52]];
export const PATCH_SCALE = 1.02;
/** Ground point → the patch's middle (for rings and pings around the whole species). */
export const HEAD_Y = -60;
const HOVER_R = 40;
const LAND_R = 12;
export const FX_MS = 900;

export interface Pt { x: number; y: number }

export interface Layout {
  width: number;
  height: number;
  cols: number;
  /** Ground point of each flower, by participant index. */
  pos: Pt[];
}

/** Pick a grid that keeps the garden roughly 2:1 and readable at this container width. */
export function layoutGarden(n: number, containerWidth: number): Layout {
  n = Math.max(1, n);
  const w = containerWidth || 900;
  // Wide screens: about 2:1. Phones: closer to square (more, smaller flowers per row, fewer rows).
  const narrow = w < 600;
  const maxCols = Math.max(2, Math.floor(w / (narrow ? 100 : 150)));
  const target = narrow ? 1 : 2;
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= Math.min(n, maxCols); cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (cols * CELL_W + 2 * SIDE_PAD) / (rows * CELL_H + TOP_PAD);
    const empty = rows * cols - n;
    const score = Math.abs(Math.log(aspect / target)) + 0.25 * empty;
    if (score < best.score) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const pos: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    // Centre a short last row, and nudge flowers a little so the garden doesn't look like a spreadsheet.
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const offset = ((cols - inRow) * CELL_W) / 2;
    const jx = (((i * 37) % 11) - 5) * 2, jy = (((i * 53) % 7) - 3) * 3;
    pos.push({ x: SIDE_PAD + offset + CELL_W * (col + 0.5) + jx, y: TOP_PAD + CELL_H * row + 138 + jy });
  }
  return { width: cols * CELL_W + 2 * SIDE_PAD, height: TOP_PAD + rows * CELL_H + 8, cols, pos };
}

/** The head of flower `inst` of species f's patch (or the patch's middle, without inst). */
export const headOf = (layout: Layout, f: number, inst?: number): Pt => {
  const p = layout.pos[f] ?? { x: 0, y: 0 };
  if (inst === undefined) return { x: p.x, y: p.y + HEAD_Y };
  const [dx, dy] = PATCH_AT[inst] ?? PATCH_AT[1];
  return { x: p.x + dx, y: p.y + dy };
};

/** The angle (radians) a visitor hovers at: the round's visitors to one flower fan out over its top. */
function slotAngle(slot: number, of: number): number {
  const step = of > 1 ? Math.min(0.62, 4.4 / (of - 1)) : 0;
  return -Math.PI / 2 + (slot - (of - 1) / 2) * step;
}

export const hoverPt = (layout: Layout, t: Turn): Pt => {
  const h = headOf(layout, t.flower, t.inst), a = slotAngle(t.slot, t.of);
  return { x: h.x + HOVER_R * Math.cos(a), y: h.y + HOVER_R * Math.sin(a) * 0.92 };
};

/** Where a feeding bee sits: on the flower head, at its own angle (the golden angle apart, bee by bee), so
 *  bees feeding at one flower from different rounds don't sit on top of each other. */
export const landPt = (layout: Layout, t: Turn): Pt => {
  const h = headOf(layout, t.flower, t.inst), a = -Math.PI / 2 + t.bee * 2.39996;
  return { x: h.x + LAND_R * Math.cos(a), y: h.y + LAND_R * 0.8 * Math.sin(a) - 2 };
};

/** A bee's home: by its own species' patch, low on the left. */
export const homePt = (layout: Layout, b: number): Pt => {
  const p = layout.pos[b] ?? { x: 0, y: 0 };
  return { x: p.x - 64, y: p.y - 10 };
};

export type BeeMode = "home" | "fly" | "visit" | "feed" | "idle";
export type BubbleKind = "ask" | "answer" | "none" | "fed" | "left" | "err";

export interface BeeDraw {
  x: number; y: number;
  flip: boolean;      // facing left
  tilt: number;       // degrees
  flap: number;       // wing stroke, 0.35..1 (1: wings still)
  mode: BeeMode;
  bubble: string | null;
  bubbleKind: BubbleKind;
  pop: number;        // 0..1, the bubble's pop
  ring: "mine" | "visitor" | null;
  named: boolean;     // show its name even when names are off (the followed team's bee)
}

/** A feed: a drop and sparkles, with the nectar the flower gave (public on every feed). */
export interface FxDraw { x: number; y: number; u: number; text: string | null; pollen: string | null }
/** The latest visit at the focus team's flower, with the details only that team sees (everyone, once revealed). */
export interface Readout { flower: number; line1: string; line2: string; kind: "fed" | "left" | "fail"; age: number }

export interface Frame {
  bees: BeeDraw[];
  glow: number[];     // per flower of each patch (species × PATCH + flower): a visit's challenge is being answered (0..1)
  ping: number[];     // per species: the focus team's bee just arrived (0..1)
  fx: FxDraw[];
  trail: { from: Pt; to: Pt; o: number } | null;
  readout: Readout | null;
}

export interface FrameParams {
  D: number;                 // the game time shown
  roundMs: number;
  flowerMs: number;
  beeMs: number;
  focus: number | null;      // the team whose bee and flower are highlighted
  bubbles: "all" | "focus" | "none";
  resting: boolean;          // lobby, or a finished game outside the replay: every bee at home
  moving: boolean;           // time is moving (wings beat, bees bob)
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
function arc(a: Pt, b: Pt, u: number): Pt {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 10 - dist * 0.16 };
  const k = 1 - u;
  return { x: k * k * a.x + 2 * k * u * c.x + u * u * b.x, y: k * k * a.y + 2 * k * u * c.y + u * u * b.y };
}

/** A short form of a challenge or response for a bubble: small scalars as they are, anything else "…". */
export function short(v: unknown): string {
  if (v === null || v === undefined) return "None";
  const t = showValue(v, 8);
  return t.length <= 7 ? t : typeof v === "object" ? "…" : t.slice(0, 6) + "…";
}

const restPt = (layout: Layout, t: Turn) => (fed(t) ? landPt(layout, t) : hoverPt(layout, t));

export function computeFrame(idx: TurnIndex, layout: Layout, p: FrameParams, now: number): Frame {
  const n = idx.bees.length;
  const R = p.roundMs, F = p.flowerMs;
  const FLY = Math.min(100, R * 0.5);
  const DEC = F + Math.min(25, p.beeMs / 2);
  const LAND = Math.min(110, R * 0.5);
  const glow = new Array<number>(n * PATCH).fill(0);   // per flower of every patch: species f, flower i at f × PATCH + i
  const ping = new Array<number>(n).fill(0);
  const fx: FxDraw[] = [];
  let trail: Frame["trail"] = null;
  let readT: Turn | null = null as Turn | null;
  const bees: BeeDraw[] = [];

  for (let b = 0; b < n; b++) {
    const list = idx.bees[b];
    const k = p.resting ? -1 : idx.at(b, p.D);
    const home = homePt(layout, b);
    const bob = p.moving ? Math.sin(now / 160 + b * 1.7) * 1.2 : 0;
    const flap = p.moving ? 0.35 + 0.65 * Math.abs(Math.sin(now / 30 + b * 0.7)) : 1;
    if (k < 0) {
      bees.push({ x: home.x, y: home.y + (p.resting ? 0 : bob), flip: false, tilt: 0, flap: p.resting ? 1 : flap, mode: "home", bubble: null, bubbleKind: "ask", pop: 0, ring: b === p.focus ? "mine" : null, named: b === p.focus });
      continue;
    }
    const T = list[k], P = k > 0 ? list[k - 1] : null;
    const u = p.D - T.t0;
    const H = hoverPt(layout, T);
    const S = P ? restPt(layout, P) : home;
    const head = headOf(layout, T.flower, T.inst);
    const isFed = fed(T);
    const end = T.end;
    let pos: Pt, mode: BeeMode, tilt = 0, flip: boolean;

    if (u < FLY) {
      const v = ease(Math.max(0, u / FLY));
      pos = arc(S, H, v);
      mode = "fly";
      const dx = H.x - S.x;
      flip = Math.abs(dx) > 1 ? dx < 0 : pos.x > head.x;
      tilt = Math.max(-16, Math.min(16, (H.y - S.y) * 0.08)) * (dx < 0 ? -1 : 1);
    } else if (isFed && u >= DEC) {
      pos = lerp(H, landPt(layout, T), ease(Math.min(1, (u - DEC) / LAND)));
      mode = "feed";
      flip = pos.x > head.x;
    } else {
      pos = { x: H.x, y: H.y + bob };
      mode = u > R + 600 ? "idle" : "visit";
      flip = pos.x > head.x;
    }

    // Bubbles: the challenge while the flower thinks, then its response, then the decision's colour.
    let bubble: string | null = null, kind: BubbleKind = "ask", pop = 0;
    const show = p.bubbles === "all" || (p.bubbles === "focus" && p.focus !== null && (b === p.focus || T.flower === p.focus));
    if (show && u >= FLY * 0.5 && u < R + 80) {
      if (u < F) {
        bubble = end ? `${short(end.c)}?` : "?";
        kind = "ask";
        pop = Math.min(1, (u - FLY * 0.5) / 80);
      } else if (end) {
        const failed = end.r === null || end.r === undefined || !!end.flowerError;
        bubble = `→ ${failed ? "None" : short(end.r)}`;
        kind = end.beeError && u >= DEC ? "err" : failed ? "none" : u < DEC ? "answer" : isFed ? "fed" : "left";
        pop = Math.min(1, (u - F) / 80);
      }
    }
    if (mode === "feed" && u >= R + 80) bubble = null;

    let ring: BeeDraw["ring"] = null;
    if (p.focus !== null) {
      if (b === p.focus) ring = "mine";
      else if (T.flower === p.focus && (u < R + 60 || (isFed && u >= DEC))) ring = "visitor";
    }

    // A flower glows while it answers.
    const g = u < F ? 1 - (u / F) * 0.4 : u < F + 160 ? 0.6 * (1 - (u - F) / 160) : 0;
    const gi = T.flower * PATCH + T.inst;
    if (g > glow[gi]) glow[gi] = g;

    if (isFed && u >= DEC && u < DEC + FX_MS) {
      // The nectar the bee got (gold), and at the followed team's flower the pollen it gave (green): both public on a feed.
      fx.push({
        ...landPt(layout, T), u: (u - DEC) / FX_MS,
        text: end && typeof end.nectar === "number" ? `+${fmtE(end.nectar)}` : null,
        pollen: T.flower === p.focus && end && typeof end.pollen === "number" ? `${fmtE(end.pollen)} pollen` : null,
      });
    }

    if (p.focus !== null) {
      if (b === p.focus) {
        if (T.flower !== p.focus && u < 500) ping[T.flower] = Math.max(ping[T.flower], 1 - u / 500);
        if (u < 450 && P) trail = { from: S, to: H, o: 1 - u / 450 };
      }
    }

    bees.push({ x: pos.x, y: pos.y, flip, tilt, flap: mode === "feed" ? 1 : flap, mode, bubble, bubbleKind: kind, pop, ring, named: b === p.focus });
  }

  // The focus flower's latest visit whose details the viewer can see (unfed visits: its own team only).
  if (p.focus !== null && !p.resting) {
    readT = idx.latestAt(p.focus, p.D - DEC, (t) => !!t.end && (typeof t.end.energy === "number" || !!t.end.flowerError));
  }
  let readout: Readout | null = null;
  if (readT && readT.end) {
    const e = readT.end;
    const age = p.D - readT.t0 - DEC;
    if (e.flowerError || e.r === null) {
      readout = { flower: readT.flower, line1: "no answer in time: E = 0", line2: fed(readT) ? "fed, but nothing to share" : "left", kind: "fail", age };
    } else {
      const E = e.energy ?? 0;
      // Compute first (it shrinks what's left), then E, then how E went: nectar and pollen, or lost.
      const line1 = `${typeof e.ms === "number" ? `${e.ms < 10 ? e.ms.toFixed(1) : Math.round(e.ms)} ms CPU → ` : ""}E ${fmtE(E)}, offers ${e.percent ?? "?"}%`;
      readout = fed(readT)
        ? { flower: readT.flower, line1, line2: `fed: nectar ${fmtE(e.nectar ?? 0)} · pollen ${fmtE(e.pollen ?? 0)}`, kind: "fed", age }
        : { flower: readT.flower, line1, line2: `left: ${fmtE(E)} lost`, kind: "left", age };
    }
  }
  return { bees, glow, ping, fx, trail, readout };
}

