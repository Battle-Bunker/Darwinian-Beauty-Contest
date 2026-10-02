// The live side of a game page: a bounded ring of recent actions fed by the SSE stream, and the game
// clock interpolated locally between server updates. Lives outside React: actions can arrive at
// hundreds a second, so components read it at their own pace (useLiveTick) instead of re-rendering on
// every message.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Action, ActionsPage, GameStatus } from "../types";

/** How many recent actions a page holds (older ones fall off the front). */
export const RING = 5000;
/** How many recent actions to load when a page opens. */
export const BACKLOG = 2500;

type Listener = () => void;

export class LiveStore {
  /** Recent actions, oldest first, by seq. */
  actions: Action[] = [];
  /** The newest seq held. */
  lastSeq = 0;
  /** Bumps whenever actions or the clock change. */
  rev = 0;
  /** Set once the older end of the ring is the very first action of the game. */
  complete = false;
  /** The latest round seen (from actions, the stream, or the game view). */
  round = 0;
  /** The game's status as last reported (stream, scores or view). */
  status: GameStatus | null = null;

  private cap = RING;
  private listeners = new Set<Listener>();
  // Clock: the largest game time the server has reported, and the interpolation base while running.
  private serverMs = 0;
  private base = 0;
  private at = 0;
  private running = false;
  private endMs = Infinity;
  private rateWindow: [number, number][] = [];

  /** Add actions (in seq order). Anything already held is skipped. */
  ingest(list: Action[]) {
    let added = 0;
    for (const a of list) {
      if (a.seq <= this.lastSeq) continue;
      this.actions.push(a);
      this.lastSeq = a.seq;
      if (a.round > this.round) this.round = a.round;
      added++;
    }
    if (!added) return;
    if (this.actions.length && this.actions[0].seq === 1) this.complete = true;
    if (this.actions.length > this.cap + 500) {
      this.actions.splice(0, this.actions.length - this.cap);
      this.complete = false;
    }
    const now = performance.now();
    this.rateWindow.push([now, added]);
    while (this.rateWindow.length && now - this.rateWindow[0][0] > 5000) this.rateWindow.shift();
    this.bump();
  }

  /** Older actions (a page before the oldest held), e.g. to read further back in a finished game. */
  prepend(list: Action[]) {
    const first = this.actions[0]?.seq ?? Infinity;
    const older = list.filter((a) => a.seq < first);
    if (!older.length) return;
    this.actions = [...older, ...this.actions];
    this.cap = Math.max(this.cap, this.actions.length);
    if (this.actions[0].seq === 1) this.complete = true;
    this.bump();
  }

  /** Actions per second over the last few seconds of real time. */
  actionsPerSecond(): number {
    const now = performance.now();
    const w = this.rateWindow.filter(([t]) => now - t <= 5000);
    if (!w.length) return 0;
    const n = w.reduce((s, [, k]) => s + k, 0);
    return n / Math.max(1, Math.min(5, (now - w[0][0]) / 1000 + 0.25));
  }

  /**
   * A clock reading from the server. While running, the local estimate only moves forward (a reading
   * that arrives late is older than the estimate), unless it's far off.
   */
  syncClock(ms: number, status?: GameStatus, endMs?: number, round?: number) {
    if (endMs !== undefined) this.endMs = endMs;
    if (round !== undefined && round > this.round) this.round = round;
    const wasRunning = this.running;
    if (status !== undefined) { this.status = status; this.running = status === "running"; }
    const before = wasRunning ? Math.min(this.endMs, this.base + (performance.now() - this.at)) : this.serverMs;
    this.serverMs = Math.max(this.serverMs, ms);
    if (this.running) {
      if (!wasRunning) { this.base = this.serverMs; this.at = performance.now(); }
      else if (ms > before || before - ms > 1500) { this.base = ms; this.at = performance.now(); }
    }
    this.bump();
  }

  /** The game clock now (ms of game time), interpolated while running. */
  now(): number {
    if (!this.running) return this.serverMs;
    return Math.min(this.endMs, this.base + (performance.now() - this.at));
  }

  isRunning() { return this.running; }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private bump() {
    this.rev++;
    for (const fn of this.listeners) fn();
  }
}

/**
 * Re-render at most every `ms` while the store changes (and, with `always`, on that beat regardless,
 * for clocks). Returns the store's rev so it can key memos.
 */
export function useLiveTick(store: LiveStore, ms: number, always = false): number {
  const [rev, setRev] = useState(store.rev);
  const [, beat] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const flush = () => { timer = null; last = performance.now(); setRev(store.rev); };
    const onChange = () => {
      if (timer) return;
      const wait = Math.max(0, ms - (performance.now() - last));
      timer = setTimeout(flush, wait);
    };
    const off = store.subscribe(onChange);
    const interval = always ? setInterval(() => beat((b) => b + 1), ms) : null;
    return () => { off(); if (timer) clearTimeout(timer); if (interval) clearInterval(interval); };
  }, [store, ms, always]);
  return rev;
}

/**
 * Keep `store` fed for one game: load the recent backlog, then follow the SSE stream (reopening it
 * from the last action held after any error, so nothing is replayed or missed). `onVersion` gets the
 * game's version whenever something public but actions changed, or -1 when my team's programs did.
 */
export function useGameStream(store: LiveStore, base: string | null, onVersion: (v: number) => void) {
  const versionCb = useRef(onVersion);
  versionCb.current = onVersion;
  useEffect(() => {
    if (!base) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (closed) return;
      es = new EventSource(`/api${base}/events?after=${store.lastSeq}`);
      es.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (Array.isArray(msg.actions)) store.ingest(msg.actions);
        const was = store.status;
        if (typeof msg.clockMs === "number") store.syncClock(msg.clockMs, msg.status, undefined, msg.round);
        // {version}: something public changed; {programs: true}: my team submitted (private); a new status
        // (paused, finished): the page changes shape. Refetch the view for any of them.
        if (typeof msg.version === "number") versionCb.current(msg.version);
        else if (msg.programs || (was && msg.status && msg.status !== was)) versionCb.current(-1);
      };
      es.onerror = () => {
        // EventSource would reconnect with the original ?after=, replaying everything since; reopen ourselves.
        es?.close();
        es = null;
        if (!closed) retry = setTimeout(open, 1500);
      };
    };

    (async () => {
      try {
        // The latest BACKLOG actions, oldest first.
        const page = await api<ActionsPage>("GET", `${base}/actions?before=${Number.MAX_SAFE_INTEGER}&limit=${BACKLOG}`);
        if (closed) return;
        store.ingest(page.actions);
        if (page.actions.length < BACKLOG) store.complete = true;
        store.syncClock(page.clockMs, page.status, undefined, page.round);
      } catch { /* the stream still works without the backlog */ }
      open();
    })();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [store, base]);
}

/** Load the page of actions just before the oldest one held (for reading back through a stopped game). */
export async function loadEarlier(store: LiveStore, base: string, n = 2500): Promise<number> {
  const first = store.actions[0]?.seq;
  if (!first || first <= 1) { store.complete = true; return 0; }
  const page = await api<ActionsPage>("GET", `${base}/actions?before=${first}&limit=${n}`);
  store.prepend(page.actions);
  if (page.actions.length < n) store.complete = true;
  return page.actions.length;
}
