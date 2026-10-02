// The garden: one continuous stream of bee actions. Pure with respect to the database: programs go in
// (and can be replaced at any moment), actions come out.
//
// Every team owns a patch of two flowers (clover = rewarding, orchid = deceptive) and one bee. A bee is
// shown flowers from its own shuffled deck of every flower in the garden (each comes up once before any
// comes up again). At a flower it asks challenges, may feed once (nectar only at clovers), and leaves.
//
// Time runs in rounds, in lockstep: a round is one action slot for every bee and lasts exactly
// roundMs (clover.ms + bee.ms = 150 + 50 = 200 ms) of game time; game time is rounds × roundMs. A live
// game paces rounds to real time (each lasts at least roundMs of wall time, longer if the machine is
// short of cores: game time stays virtual, so that's still fair).
//   0 ms   Each bee's QUEUED action runs: an ask goes to its flower, or the bee feeds. A bee with nothing
//          queued as the round starts loses the slot. Queued challenges are secret until asked.
//   150 ms The flowers' answers are delivered (null if a flower wasn't done within its own time limit:
//          a clover gets the whole 150 ms, an orchid its own, shorter limit), so when an answer arrives
//          says nothing about which flower gave it. Each bee that acted is asked for its next action:
//          forage(seen, visit), after a feed tasted(seen, nectar) first, in the same call.
//   200 ms Its reply is due, 50 ms after the call started on its own core. The reply is queued for the
//          bee's next slot: ["ask", c] at the same flower, "feed" (then the bee sits out feedCost
//          rounds), or ["leave", c] (c is asked first at the next flower). A reply that gives no next
//          challenge (a plain "leave", a second feed, an invalid challenge, an error) ends the visit,
//          and the engine asks again at once, outside the round flow: forage([], {fed: false, ...}),
//          the bee's first challenge at its next flower. It plays as soon as one is queued in time.
// A late reply doesn't stop the round: at the deadline the bee loses its next slot and its visit ends,
// but the engine keeps listening (the call runs on, up to a hard limit of 2 s). If the late reply is
// ["leave", c], c is the first ask at the next flower; anything else is asked again, as above.
//
// Flowers are stateless: every ask runs the flower afresh, with fresh randomness and the clock, so the
// same challenge can get a different answer every time. A bee keeps its state for as long as that
// version of it plays; new code (or a crash) starts it afresh.
// A team may replace any of its programs at any time: a flower's next ask runs the new code; a bee
// swaps at the next round boundary, abandoning its visit and whatever it had queued.
// Every program runs in its minified form (vendor/measure.js): the same text its size is measured on,
// so names, which minifying shortens, can't hide data.
import os from "node:os";
import { ProgramProcess } from "./runners/proc.js";
import { checkValue, parseType } from "./lib/types.js";
import { zeroLedger } from "./lib/scoring.js";
import { limitsOf, roundMs } from "./lib/gameConfig.js";
import { size } from "./lib/measure.js";

export const KINDS = ["clover", "orchid", "bee"];
export const FLOWERS = ["clover", "orchid"];

/** The text the game actually runs: the program minified. */
export const runnable = async (language, code) => (await size(language, code)).minified;

/** What programs may read as GAME, plus "ms": each program's own time limit per call. */
export function gameInfo(config) {
  const { maxLen, maxNodes } = limitsOf(config);
  return {
    feed_cost: config.feedCost, challenge_type: config.challengeType, response_type: config.responseType,
    max_len: maxLen, max_nodes: maxNodes, round_ms: roundMs(config),
  };
}

// Responses can be big trees and graphs; this caps the JSON text of any single value.
const MAX_CHARS = 262144;
const MAX_LOG = 2000; // characters of a bee's print output kept per action
// A bee's 50 ms is a deadline, not an interruption: the call runs on, and only this hard limit stops it.
const BEE_LIMIT_MS = 2000;
const flowerSetup = (config, kind, code) => ({
  code, ms: config.budgets[kind].ms, game: { ...gameInfo(config), ms: config.budgets[kind].ms }, maxChars: MAX_CHARS,
});
const beeSetup = (config, code) => ({
  code, ms: config.budgets.bee.ms, limitMs: Math.max(BEE_LIMIT_MS, 2 * config.budgets.bee.ms),
  game: { ...gameInfo(config), ms: config.budgets.bee.ms }, maxChars: MAX_CHARS,
});

// Time limits are a costly signal (a clover gets more than an orchid), so timing must be fair: never
// run more programs at once than there are CPU cores, across every game this process runs. Each program
// then has a core to itself, and its wall-clock time limit is effectively a CPU limit. A late bee keeps
// its core until it replies, which only stretches the round in wall time.
const CPU_SLOTS = Math.max(1, Number(process.env.CPU_SLOTS) || os.availableParallelism?.() || os.cpus().length);
let cpuBusy = 0;
const cpuWaiters = [];
async function withCpu(fn) {
  if (cpuBusy < CPU_SLOTS) cpuBusy++;
  else await new Promise((resolve) => cpuWaiters.push(resolve));
  try {
    return await fn();
  } finally {
    const next = cpuWaiters.shift();
    if (next) next(); else cpuBusy--;
  }
}

// A flower is stateless, so any of a few identical processes can answer for it: a popular flower that
// several bees question at once doesn't queue behind one process.
const FLOWER_POOL = Math.max(1, Number(process.env.FLOWER_POOL) || 2);
class FlowerPool {
  constructor(language, setup) {
    this.procs = Array.from({ length: FLOWER_POOL }, () => new ProgramProcess(language, "flower", setup));
    this.pending = this.procs.map(() => 0);
    this.ready = Promise.all(this.procs.map((p) => p.ready)).then((r) => r[0]);
  }
  /** { res, ms }: the reply, and how long the flower ran (not counting the wait for a free core). */
  async call(obj) {
    let i = 0;
    for (let j = 1; j < this.procs.length; j++) if (this.pending[j] < this.pending[i]) i = j;
    this.pending[i]++;
    try {
      return await withCpu(async () => {
        const t0 = performance.now();
        const res = await this.procs[i].call(obj);
        return { res, ms: performance.now() - t0 };
      });
    } finally {
      this.pending[i]--;
    }
  }
  kill() { for (const p of this.procs) p.kill(); }
}

const RETIRE_MS = 5000; // a replaced flower finishes the asks it's already answering, then goes
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const LATE = Symbol("late");
/** `done`, or LATE if it hasn't settled `ms` after `from` (a performance.now() time). */
function byDeadline(done, from, ms) {
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(LATE), Math.max(0, from + ms - performance.now())); });
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}
const isPair = (a, verb) => Array.isArray(a) && a.length === 2 && a[0] === verb;
const shapeError = (a) => `forage must return ["ask", challenge], "feed", ["leave", challenge] or "leave" (got ${JSON.stringify(a)?.slice(0, 60)})`;
const validShape = (a) => isPair(a, "ask") || isPair(a, "leave") || a === "feed" || a === "leave";
const FRESH = 0; // a bee runner's `seen` is empty, ready for the next flower (visits are numbered from 1)

export class Garden {
  /**
   * teams: number of teams (ledger rows/columns are team indices).
   * round: rounds already played; clockMs: the game time they took (round × roundMs for a game this engine
   * started). endMs: game time at which run() stops (default config.minutes). maxRounds: stop after this
   * many rounds instead (for trying a bee). lastSeq: the last action number already used. ledgers:
   * { feeds, nectar } so far. paced: rounds last at least roundMs of wall time (false: back to back, for
   * tests and the "try" tool).
   */
  constructor({ config, teams, clockMs = 0, round = 0, endMs = config.minutes * 60000, maxRounds = Infinity, lastSeq = 0, ledgers = null, paced = true }) {
    this.config = config;
    this.n = teams;
    this.cType = parseType(config.challengeType);
    this.rType = parseType(config.responseType);
    this.limits = limitsOf(config);
    this.roundMs = roundMs(config);
    this.windowMs = config.budgets.clover.ms; // the flower window: answers are delivered at its end
    this.beeMs = config.budgets.bee.ms;       // the bees' decision window
    this.paced = paced;
    this.endMs = endMs;
    this.maxRounds = maxRounds;
    this.rounds = 0;                  // rounds run by this garden
    this.round = round;               // the game's rounds so far, counting the one in progress
    this.roundBase = round;
    this.clockBase = clockMs;
    this.seq = lastSeq;
    this.flowers = [];                // { team, kind, version, pool }
    this.bees = Array.from({ length: teams }, (_, ti) => ({
      ti, version: null, code: null, pending: null, proc: null, gen: 0, broken: false,
      sitOut: 0, deck: [], visit: null, visits: 0,
      queued: null,      // the action for the bee's next slot: { act: "ask", c, fresh, beeMs, log } | { act: "feed", beeMs, log }
      busy: false,       // a call is in flight (or the bee is acting this round): no other request goes to it
      asking: null,      // a request outside the round flow (loading, a first challenge): { inTime }
      askedRound: -1,    // the round of its latest request for a first challenge (one new one a round)
      seen: FRESH,       // the visit whose steps the runner's `seen` holds
      log: "",           // printed output not yet attached to an action
    }));
    this.feeds = ledgers?.feeds ?? zeroLedger(teams);
    this.nectar = ledgers?.nectar ?? zeroLedger(teams);
    this.out = [];                    // actions not yet drained
    this.problems = [];               // { team, kind, version, error }: the first error of each program version
    this.seenProblem = new Set();
    this.stopped = false;
    this.closed = false;
    this.paused = false;
    this.gate = null;
    this.retiring = new Set();
  }

  /** Game time: rounds × roundMs (the round in progress counts in full). It stands still between rounds. */
  clockMs() {
    return this.clockBase + (this.round - this.roundBase) * this.roundMs;
  }

  /** Game time at which round r starts. */
  #startOf(r) {
    return this.clockBase + (r - 1 - this.roundBase) * this.roundMs;
  }

  /** Put a program in play (or replace one). code is the source; the garden runs it minified. */
  async setProgram(ti, kind, code, version) {
    const minified = await runnable(this.config.language, code);
    if (kind === "bee") {
      this.bees[ti].pending = { code: minified, version }; // takes over at the next round boundary
      return;
    }
    const pool = new FlowerPool(this.config.language, flowerSetup(this.config, kind, minified));
    pool.ready.then((r) => { if (!r.ok) this.#problem(ti, kind, version, r.e); });
    let slot = this.flowers.find((f) => f.team === ti && f.kind === kind);
    if (!slot) this.flowers.push((slot = { team: ti, kind }));
    else this.#retire(slot.pool);
    Object.assign(slot, { version, pool });
  }

  /** Pause after the round in progress (the clock stands still until resume). */
  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.gate?.();
  }

  /** Stop the loop (after the round in progress) and every program. */
  async stop() {
    this.stopped = true;
    this.gate?.();
    await this.running;
  }

  /** Runs until the game clock reaches endMs (or maxRounds, or stop()). */
  run() {
    this.running ??= this.#loop().finally(() => this.#close());
    return this.running;
  }

  /** Everything new since the last drain: actions, program problems, the clock and the ledgers. */
  drain() {
    return { actions: this.out.splice(0), problems: this.problems.splice(0), clockMs: Math.round(this.clockMs()), round: this.round, lastSeq: this.seq, feeds: this.feeds, nectar: this.nectar };
  }

  async #loop() {
    while (!this.stopped) {
      if (this.paused) { await new Promise((resolve) => { this.gate = resolve; }); this.gate = null; continue; }
      if (this.clockMs() >= this.endMs || this.rounds >= this.maxRounds) break;
      if (!this.flowers.length || !this.bees.some((b) => b.pending || b.proc)) { // nobody can play yet
        this.rounds++;
        await sleep(100);
        continue;
      }
      await this.#round();
    }
  }

  async #round() {
    const t0 = performance.now();
    this.rounds++;
    const r = ++this.round;
    const start = this.#startOf(r);
    // The round boundary: new bees take over, crashed ones start afresh, idle ones are asked again.
    for (const b of this.bees) this.#boundary(b, start);
    if (!this.paced) await this.#settle();
    // The slots: a bee acts only if an action is queued as the round starts. Feeding bees sit out.
    const acting = [];
    for (const b of this.bees) {
      if (!b.proc || b.broken) continue;
      if (b.sitOut > 0) { b.sitOut--; continue; }
      if (b.queued && !b.busy) {
        const q = b.queued;
        b.queued = null;
        b.busy = true;
        acting.push({ b, q, gen: b.gen });
      }
    }
    // The flower window: every ask goes to its flower at once.
    const steps = await Promise.all(acting.map((s) => this.#act(s)));
    for (const s of steps) if (s.rec) this.#record(s.b, s.v, s.rec, start);
    if (this.paced) await sleep(t0 + this.windowMs - performance.now());
    // The decision window: answers are delivered and every bee that acted decides its next action.
    const decided = await Promise.all(steps.map((s) => this.#decide(s)));
    for (const d of decided) if (d) this.#record(d.b, d.v, d.rec, start + this.windowMs);
    if (this.paced) await sleep(t0 + this.roundMs - performance.now());
  }

  #close() {
    this.closed = true;
    for (const f of this.flowers) f.pool.kill();
    for (const b of this.bees) b.proc?.kill();
    for (const p of this.retiring) p.kill();
  }

  #retire(proc) {
    this.retiring.add(proc);
    setTimeout(() => { proc.kill(); this.retiring.delete(proc); }, RETIRE_MS).unref?.();
  }

  #problem(team, kind, version, error) {
    const key = `${team}:${kind}:${version}`;
    if (this.seenProblem.has(key)) return;
    this.seenProblem.add(key);
    this.problems.push({ team, kind, version, error: String(error).slice(0, 300) });
  }

  #record(b, v, fields, atMs) {
    this.out.push({
      seq: ++this.seq, atMs: Math.round(atMs), round: this.round, bee: b.ti, visit: v.no, patch: v.slot.team, kind: v.slot.kind,
      beeVersion: b.version, flowerVersion: v.slot.version,
      c: null, r: null, after: false, nectar: null, ms: null, beeMs: null, error: null, by: null, log: null, ...fields,
    });
  }

  /** What the bee printed since its last recorded action, plus `out`. */
  #takeLog(b, out) {
    const s = (b.log + (out || "")).slice(0, MAX_LOG);
    b.log = "";
    return s || null;
  }

  #keepLog(b, out) {
    if (out) b.log = (b.log + out).slice(0, MAX_LOG);
  }

  #boundary(b, start) {
    if (b.pending) {
      const { code, version } = b.pending;
      b.pending = null;
      this.#startBee(b, code, version, start);
    } else if (b.proc && !b.broken && b.proc.dead) this.#startBee(b, b.code, b.version, start); // crashed or hung
    else if (b.proc && !b.broken && !b.busy && !b.queued) this.#askFirst(b); // its last request gave no challenge
  }

  #startBee(b, code, version, start) {
    if (b.visit) this.#record(b, b.visit, { action: "leave", error: version === b.version ? "the bee restarted" : "a new bee took over", by: "engine" }, start);
    b.visit = null;
    b.queued = null;
    b.log = "";
    b.proc?.kill(); // its call in flight, if any, ends at once (and frees its core); the reply is ignored
    b.gen++;
    b.code = code;
    b.version = version;
    b.broken = false;
    b.seen = FRESH;
    const proc = (b.proc = new ProgramProcess(this.config.language, "bee", beeSetup(this.config, code)));
    const gen = b.gen;
    // Loading counts as a call in flight. Then the new bee is asked for its first challenge at once.
    b.busy = true;
    const loaded = proc.ready.then((load) => {
      if (gen !== b.gen || this.closed) return;
      b.busy = false;
      b.asking = null;
      if (!load.ok) {
        b.broken = true; // idle until its team sends new code
        this.#problem(b.ti, "bee", b.version, load.e);
        return;
      }
      this.#askFirst(b, true);
    });
    b.asking = { inTime: loaded };
  }

  /**
   * One request to the bee, on a core of its own: { gen, started (the performance.now() it got its core),
   * done ({ res, ms }) }. The core stays held until the reply, however late.
   */
  #call(b, req) {
    const proc = b.proc;
    let began;
    const started = new Promise((resolve) => { began = resolve; });
    const done = withCpu(async () => {
      const t0 = performance.now();
      began(t0);
      const res = await proc.call(req);
      return { res, ms: performance.now() - t0 };
    });
    b.busy = true;
    return { gen: b.gen, started, done };
  }

  /**
   * Ask the bee for its first challenge at its next flower: forage([], {fed: false, ...}), with its
   * runner's `seen` emptied. Outside the round flow; at most one in flight, and one new one a round.
   */
  #askFirst(b, force = false) {
    if (this.closed || this.stopped || b.broken || b.pending || !b.proc || b.proc.dead || b.busy || b.queued) return;
    if (!force && b.askedRound === this.round) return; // asked this round already: again at the next boundary
    b.askedRound = this.round;
    b.seen = FRESH;
    const call = this.#call(b, { op: "forage", new: true, step: null, visit: { fed: false, nectar: null, flowers: this.flowers.length } });
    const asking = {};
    const handled = call.done.then(({ res, ms }) => {
      if (call.gen !== b.gen || this.closed) return;
      b.busy = false;
      if (b.asking === asking) b.asking = null;
      this.#onFirst(b, res, ms);
    });
    // An unpaced garden waits for it before the next round, as long as it answers within the bee's time.
    asking.inTime = call.started.then((t) => byDeadline(handled, t, this.beeMs));
    b.asking = asking;
  }

  /** Unpaced: the requests outside the round flow that answer in time make it into the next round. */
  async #settle() {
    const waited = new Set();
    for (;;) {
      const asks = this.bees.map((b) => b.asking).filter((a) => a && !waited.has(a));
      if (!asks.length) return;
      for (const a of asks) waited.add(a);
      await Promise.all(asks.map((a) => a.inTime));
    }
  }

  /** The reply to a request for a first challenge: ["ask", c] or ["leave", c] queue c; else ask again. */
  #onFirst(b, res, ms) {
    const a = res.a;
    if (!res.e && (isPair(a, "ask") || isPair(a, "leave"))) {
      const bad = checkValue(this.cType, a[1], this.limits, "challenge");
      if (!bad) {
        b.queued = { act: "ask", c: a[1], fresh: true, beeMs: ms, log: this.#takeLog(b, res.out) };
        return;
      }
      this.#problem(b.ti, "bee", b.version, bad);
    } else if (res.e || !validShape(a)) this.#problem(b.ti, "bee", b.version, res.e || shapeError(a));
    this.#keepLog(b, res.out);
    if (!res.dead) this.#askFirst(b);
  }

  #draw(b) {
    while (b.deck.length) {
      const slot = b.deck.pop();
      if (this.flowers.includes(slot)) return slot;
    }
    b.deck = shuffle([...this.flowers]);
    return b.deck.pop() ?? null;
  }

  /** The flower's answer, labelled with the version that gave it (the flower may be replaced meanwhile). */
  async #ask(slot, c) {
    const { pool, version } = slot;
    const { res, ms } = await pool.call({ c });
    const bad = res.e || checkValue(this.rType, res.v, this.limits, "response");
    if (bad) {
      this.#problem(slot.team, slot.kind, version, bad);
      return { r: null, ms, error: String(bad).slice(0, 300), by: "flower", flowerVersion: version };
    }
    return { r: res.v, ms, flowerVersion: version };
  }

  /** A bee's slot: its queued ask (at a new flower if it's the first there) or its feed. */
  async #act({ b, q, gen }) {
    if (q.act === "ask") {
      if (q.fresh || !b.visit) {
        const slot = this.#draw(b);
        b.visit = slot && { slot, no: ++b.visits, asks: 0, fed: false, nectar: null };
      }
      const v = b.visit;
      if (!v) return { b, gen };
      const answer = await this.#ask(v.slot, q.c);
      v.asks++;
      return { b, v, gen, step: [q.c, answer.r], rec: { action: "ask", c: q.c, after: v.fed, beeMs: q.beeMs, log: q.log, ...answer } };
    }
    const v = b.visit;
    if (!v) return { b, gen };
    v.fed = true;
    v.nectar = v.slot.kind === "clover";
    this.feeds[b.ti][v.slot.team]++;
    if (v.nectar) this.nectar[b.ti][v.slot.team]++;
    b.sitOut = this.config.feedCost; // feeding: no slot for the next feedCost rounds
    return { b, v, gen, fed: true, rec: { action: "feed", nectar: v.nectar, beeMs: q.beeMs, log: q.log } };
  }

  /**
   * The bee that acted decides its next action: forage with the answer (after a feed: tasted, then
   * forage, in the same call). Returns the record to make at the end of the flower window, if any.
   */
  async #decide({ b, v, gen, step, fed }) {
    if (gen !== b.gen) return null; // replaced meanwhile
    b.busy = false;
    if (!v || !b.proc || b.proc.dead || this.stopped) return null; // crashed: it starts afresh at the next boundary
    const req = { op: "forage", new: b.seen !== FRESH && b.seen !== v.no, step: step ?? null, visit: { fed: v.fed, nectar: v.nectar, flowers: this.flowers.length } };
    if (fed) req.tasted = v.nectar;
    b.seen = v.no;
    const call = this.#call(b, req);
    const res = await byDeadline(call.done, await call.started, this.beeMs);
    if (res !== LATE) {
      if (call.gen !== b.gen) return null;
      b.busy = false;
      return this.#onReply(b, v, res.res, res.ms);
    }
    // Too slow: the bee loses its next slot and the visit ends, but the engine keeps listening.
    b.visit = null;
    this.#problem(b.ti, "bee", b.version, `too slow: no reply within ${this.beeMs} ms`);
    call.done.then(({ res: late, ms }) => {
      if (call.gen !== b.gen || this.closed) return;
      b.busy = false;
      this.#onLate(b, late, ms);
    });
    return { b, v, rec: { action: "error", error: `too slow: no reply within ${this.beeMs} ms`, by: "bee" } };
  }

  /** A reply in time. Queues the next action, or ends the visit (and asks again if it gave no challenge). */
  #onReply(b, v, res, ms) {
    const a = res.a;
    const err = res.e || (validShape(a) ? null : shapeError(a));
    if (err) { // a mistake ends the visit
      this.#problem(b.ti, "bee", b.version, err);
      b.visit = null;
      const rec = { action: "error", error: String(err).slice(0, 300), by: "bee", beeMs: ms, log: this.#takeLog(b, res.out) };
      if (!res.dead) this.#askFirst(b);
      return { b, v, rec };
    }
    if (isPair(a, "ask")) {
      const bad = checkValue(this.cType, a[1], this.limits, "challenge");
      if (!bad) {
        b.queued = { act: "ask", c: a[1], fresh: false, beeMs: ms, log: this.#takeLog(b, res.out) };
        return null;
      }
      b.visit = null;
      const rec = { action: "error", error: String(bad).slice(0, 300), by: "challenge", beeMs: ms, log: this.#takeLog(b, res.out) };
      this.#askFirst(b);
      return { b, v, rec };
    }
    if (a === "feed" && !v.fed) {
      b.queued = { act: "feed", beeMs: ms, log: this.#takeLog(b, res.out) };
      return null;
    }
    // "leave", ["leave", c], or a second feed (which also moves on)
    b.visit = null;
    const rec = { action: "leave", beeMs: ms, log: this.#takeLog(b, res.out) };
    if (isPair(a, "leave")) {
      const bad = checkValue(this.cType, a[1], this.limits, "challenge");
      if (!bad) {
        b.queued = { act: "ask", c: a[1], fresh: true, beeMs: ms, log: null };
        return { b, v, rec };
      }
      Object.assign(rec, { error: String(bad).slice(0, 300), by: "challenge" });
    }
    this.#askFirst(b);
    return { b, v, rec };
  }

  /**
   * A reply after the deadline (its visit is already over). Only ["leave", c] carries a challenge for
   * the next turn: c is the first ask at the next flower. Anything else (an ask or a feed meant for the
   * abandoned visit, a plain leave, an error) doesn't, so the bee is asked again.
   */
  #onLate(b, res, ms) {
    const a = res.a;
    if (!res.e && isPair(a, "leave") && !checkValue(this.cType, a[1], this.limits, "challenge")) {
      b.queued = { act: "ask", c: a[1], fresh: true, beeMs: ms, log: this.#takeLog(b, res.out) };
      return;
    }
    if (res.e || !validShape(a)) this.#problem(b.ti, "bee", b.version, res.e || shapeError(a));
    this.#keepLog(b, res.out);
    if (!res.dead) this.#askFirst(b);
  }
}

/** Run a flower program on a list of challenges (for the "try it" tool). */
export async function tryFlower({ config, code, kind, challenges }) {
  const cType = parseType(config.challengeType), rType = parseType(config.responseType);
  const limits = limitsOf(config);
  const proc = new ProgramProcess(config.language, "flower", flowerSetup(config, kind, await runnable(config.language, code)));
  try {
    const load = await proc.ready;
    if (!load.ok) return { error: load.e, results: [] };
    const results = [];
    for (const c of challenges.slice(0, 50)) {
      const bad = checkValue(cType, c, limits, "challenge");
      if (bad) { results.push({ c, r: null, error: bad }); continue; }
      const t0 = performance.now();
      const res = await withCpu(() => proc.call({ c }));
      const ms = +(performance.now() - t0).toFixed(1);
      if (res.e) results.push({ c, r: null, error: res.e, ms });
      else {
        const badR = checkValue(rType, res.v, limits, "response");
        results.push(badR ? { c, r: null, error: badR, ms } : { c, r: res.v, ms });
      }
    }
    return { results };
  } finally {
    proc.kill();
  }
}

/** A bee foraging a garden of just its own team's two flowers for `rounds` rounds, unpaced (the "try it" tool). */
export async function tryBee({ config, programs, rounds = 300 }) {
  const garden = new Garden({ config, teams: 1, endMs: Infinity, maxRounds: rounds, paced: false });
  await Promise.all(KINDS.map((k) => garden.setProgram(0, k, programs[k], 1)));
  await garden.run();
  const { actions, problems, feeds, nectar } = garden.drain();
  return { actions, problems, feeds: feeds[0][0], nectar: nectar[0][0], rounds: garden.rounds };
}
