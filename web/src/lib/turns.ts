// Turns, from the action stream. A turn makes two actions, its arrival (public at once) and its end (feed
// or leave, which carries the whole turn); they're paired here by (bee, turn). Each bee's turns are kept in
// time order, so what the garden shows at any game time is a lookup (TurnIndex.at), not a replay: the live
// garden, the scrubbable replay and the round inspector all read the same index.
import type { Action } from "../types";

export interface Turn {
  bee: number;              // participant index of the bee's team
  flower: number;           // participant index of the flower's team
  round: number;
  turn: number;
  t0: number;               // game time of the arrival
  arrive: Action | null;
  end: Action | null;       // the feed or leave, once known
  slot: number;             // this bee's place among the round's visitors at this flower
  of: number;               // how many bees visited this flower this round
}

export const fed = (t: Turn) => t.end?.action === "feed";

/** First index in `actions` (sorted by seq) with seq > after. */
export function indexAfter(actions: Action[], after: number): number {
  let lo = 0, hi = actions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].seq <= after) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export class TurnIndex {
  readonly order: string[];
  readonly flowerMs: number;
  /** Per bee (participant index), its turns, oldest first. */
  readonly bees: Turn[][];
  /** The last seq taken in. */
  cursor = 0;
  /** Bumps whenever a turn is added or completed. */
  rev = 0;
  /** The latest arrival time seen. */
  lastT = -1;
  private pos = new Map<string, number>();
  private byKey = new Map<string, Turn>();
  private groups = new Map<string, Turn[]>();
  /** Live gardens keep only recent turns per bee; a replay keeps everything. */
  private keep: number;

  constructor(order: string[], flowerMs: number, keep = Infinity) {
    this.order = order;
    this.flowerMs = flowerMs;
    this.keep = keep;
    order.forEach((id, i) => this.pos.set(id, i));
    this.bees = order.map(() => []);
  }

  indexOf(teamId: string): number { return this.pos.get(teamId) ?? -1; }

  /** Take in every action after `cursor` (actions sorted by seq; a ring that moved on is fine). */
  ingest(actions: Action[]) {
    let i = indexAfter(actions, this.cursor);
    for (; i < actions.length; i++) this.add(actions[i]);
  }

  add(a: Action) {
    if (a.seq <= this.cursor) return;
    this.cursor = a.seq;
    const b = this.pos.get(a.bee), f = this.pos.get(a.flower);
    if (b === undefined || f === undefined) return;
    const key = `${b}:${a.turn}`;
    let t = this.byKey.get(key);
    if (!t) {
      const t0 = a.action === "arrive" ? a.atMs : a.atMs - this.flowerMs;
      t = { bee: b, flower: f, round: a.round, turn: a.turn, t0, arrive: null, end: null, slot: 0, of: 1 };
      this.byKey.set(key, t);
      const list = this.bees[b];
      // Turns come in order per bee; insert in place if one ever doesn't (a page loaded out of order).
      if (!list.length || list[list.length - 1].t0 <= t0) list.push(t);
      else list.splice(this.firstAfter(b, t0), 0, t);
      if (t0 > this.lastT) this.lastT = t0;
      const gk = `${a.round}:${f}`;
      const g = this.groups.get(gk);
      if (g) {
        g.push(t);
        g.sort((x, y) => x.bee - y.bee);
        g.forEach((x, k) => { x.slot = k; x.of = g.length; });
      } else this.groups.set(gk, [t]);
      if (list.length > this.keep * 2) this.trim(b);
    }
    if (a.action === "arrive") t.arrive = a;
    else t.end = a;
    this.rev++;
  }

  private trim(b: number) {
    const list = this.bees[b];
    const drop = list.splice(0, list.length - this.keep);
    for (const t of drop) {
      this.byKey.delete(`${b}:${t.turn}`);
      this.groups.delete(`${t.round}:${t.flower}`);
    }
  }

  /** Index of bee b's first turn arriving after game time t. */
  private firstAfter(b: number, t: number): number {
    const list = this.bees[b];
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t0 <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Index of bee b's latest turn that has arrived by game time t (-1: none). */
  at(b: number, t: number): number {
    return this.firstAfter(b, t) - 1;
  }

  /** Every turn arriving in [from, to), all bees, in time order. */
  between(from: number, to: number): Turn[] {
    const out: Turn[] = [];
    for (let b = 0; b < this.bees.length; b++) {
      const list = this.bees[b];
      for (let k = this.firstAfter(b, from - 1e-6); k < list.length && list[k].t0 < to; k++) out.push(list[k]);
    }
    return out.sort((x, y) => x.t0 - y.t0 || x.bee - y.bee);
  }
}
