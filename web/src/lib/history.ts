// A finished game's whole history: every action, loaded page by page from the start (everything is
// revealed once a game is over), with the turns indexed for the replay as they arrive. Also the team
// ledger store, which reads GET .../ledger exactly as the team's programs see it.
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../api";
import type { Action, ActionsPage, GameStatus, LedgerEntry, LedgerPage } from "../types";
import type { ActionSource, Ticking } from "./live";
import { TurnIndex } from "./turns";

type Listener = () => void;
const PAGE = 5000;
/** Beyond this many actions a replay stops loading (and says so). */
export const HISTORY_CAP = 600_000;

class Notifier implements Ticking {
  rev = 0;
  private listeners = new Set<Listener>();
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  protected bump() {
    this.rev++;
    for (const fn of this.listeners) fn();
  }
}

export class HistoryStore extends Notifier implements ActionSource {
  actions: Action[] = [];
  lastSeq = 0;
  /** The game's last seq, as the server last reported it. */
  total = 0;
  complete = true; // it always starts from the first action
  done = false;
  capped = false;
  error: string | null = null;
  readonly turns: TurnIndex;
  private stopped = false;

  constructor(order: string[], flowerMs: number) {
    super();
    this.turns = new TurnIndex(order, flowerMs);
  }

  async load(base: string) {
    try {
      while (!this.stopped) {
        const page = await api<ActionsPage>("GET", `${base}/actions?after=${this.lastSeq}&limit=${PAGE}`);
        if (this.stopped) return;
        this.total = Math.max(this.total, page.lastSeq);
        for (const a of page.actions) {
          if (a.seq <= this.lastSeq) continue;
          this.actions.push(a);
          this.turns.add(a);
          this.lastSeq = a.seq;
        }
        if (page.actions.length < PAGE || this.lastSeq >= this.total) { this.done = true; this.bump(); return; }
        if (this.actions.length >= HISTORY_CAP) { this.done = true; this.capped = true; this.bump(); return; }
        this.bump();
      }
    } catch (e) {
      this.error = errorText(e);
      this.bump();
    }
  }

  stop() { this.stopped = true; }
}

/** One finished game's history, loaded once per page (and dropped when the page goes). */
export function useHistory(base: string, order: string[] | null, flowerMs: number, active: boolean): HistoryStore | null {
  const key = order?.join(",") ?? "";
  const store = useMemo(() => (active && order ? new HistoryStore(order, flowerMs) : null), [active, key, flowerMs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!store) return;
    store.load(base);
    return () => store.stop();
  }, [store, base]);
  return store;
}

/** The team ledger: what my team's programs see (everyone's everything once the game is over). */
export class LedgerStore extends Notifier {
  entries: LedgerEntry[] = [];
  participants: string[] | null = null;
  team: number | null = null;
  lastSeq = 0;
  status: GameStatus | null = null;
  /** Caught up with the game (at the last fetch). */
  caughtUp = false;
  loading = false;
  error: string | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private base: string) { super(); }

  /** Fetch until caught up. */
  async fetch() {
    if (this.loading || this.stopped) return;
    this.loading = true;
    try {
      for (;;) {
        const page = await api<LedgerPage>("GET", `${this.base}/ledger?after=${this.lastSeq}&limit=${PAGE}`);
        if (this.stopped) return;
        this.participants = page.participants;
        this.team = page.team;
        this.status = page.status;
        for (const e of page.entries) {
          if (e.seq <= this.lastSeq) continue;
          this.entries.push(e);
          this.lastSeq = e.seq;
        }
        this.caughtUp = page.entries.length < PAGE;
        this.error = null;
        this.bump();
        if (this.caughtUp || this.entries.length >= HISTORY_CAP) break;
      }
    } catch (e) {
      this.error = errorText(e);
      this.bump();
    } finally {
      this.loading = false;
    }
  }

  /** Follow the game: fetch now and every `ms` while `live()` says it's still going. */
  follow(ms: number, live: () => boolean) {
    const loop = async () => {
      await this.fetch();
      if (!this.stopped && live()) this.timer = setTimeout(loop, ms);
    };
    loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * My team's ledger for this page: loaded when `active`, followed every couple of seconds while the game
 * runs. A new store when the viewer's team or the game's phase changes (a finished game's ledger has
 * every field filled in, so it's fetched afresh).
 */
export function useLedger(base: string, active: boolean, status: GameStatus, teamKey: string): LedgerStore | null {
  const phase = status === "finished" ? "over" : status === "lobby" ? "lobby" : "live";
  const store = useMemo(() => (active && phase !== "lobby" ? new LedgerStore(base) : null), [active, base, phase, teamKey]);
  const statusRef = useLatest(status);
  useEffect(() => {
    if (!store) return;
    store.follow(2000, () => statusRef.current === "running" || statusRef.current === "paused");
    return () => store.stop();
  }, [store, statusRef]);
  return store;
}

function useLatest<T>(v: T) {
  const [ref] = useState(() => ({ current: v }));
  ref.current = v;
  return ref;
}
