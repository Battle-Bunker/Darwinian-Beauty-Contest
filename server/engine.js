// The garden: one continuous stream of turns. Pure with respect to the database: programs go in (and can
// be replaced at any moment), actions and the ledgers come out.
//
// Every team has one flower and one bee. Time runs in rounds, in lockstep: a round lasts exactly roundMs
// (flower.ms + bee.ms = 150 + 50 = 200 ms) of game time; game time is rounds × roundMs. A live game paces
// rounds to real time (each lasts at least roundMs of wall time, longer if the machine is short of cores:
// game time stays virtual, so that's still fair). Every bee that isn't feeding gets one TURN per round:
//   0 ms   The last round's turns are delivered to every program's ledger. Each bee with a challenge
//          QUEUED (and no call in flight) takes its turn; one with nothing queued loses it. The engine
//          draws a flower uniformly at random among all N, the bee's own included (a public `arrive`,
//          flushed at once), pins both versions, and calls flower(challenge, ledger), which has
//          flower.ms to return [response, percent]. The runner reports the CPU time of the call;
//          excess energy E = (flower size cap − the flower's size) × max(0, flower.ms − CPU ms). A late
//          answer, an error or a malformed return: response null, E = 0.
//   150 ms Every response is delivered at once, however fast its flower was. Each bee that took a turn
//          is called: decide(challenge, response, ledger), with bee.ms to return ["feed" | "leave", next].
//   200 ms The turn is settled. A feed: nectar = percent/100 × E to the bee, (1 − percent/100) × E to the
//          flower team's surplus, and the bee sits out feedCost rounds. No feed: nobody gets anything.
//          `next` is queued for the bee's next turn.
// A late reply doesn't stop the round: at the deadline the turn is settled without it (never a feed), but
// the engine keeps listening (the call runs on, up to a hard limit of 2 s). If the late reply is
// ["leave", c], c is queued; anything else gets the bee asked first(ledger) for a challenge, outside the
// round flow (as does any reply that gives no usable next challenge). At most one such request is in
// flight per bee, and at most one new one a round.
//
// The ledger: each team's programs see every finished turn (the public part) plus their own team's
// private details (entryFor). A round's turns reach them together, at the start of the next round,
// incrementally and outside every timed call, so neither side learns its counterpart until the turn is
// over, and a growing ledger never costs a program time or energy.
//
// Flowers are stateless: every call runs the flower afresh. A bee keeps its state for as long as that
// version of it plays; new code (or a crash) starts it afresh. A turn keeps the program versions in effect
// at its arrival until it is settled: a new flower answers turns that start after it went live; a new bee
// takes over when its turn in progress is settled (or at once between turns), dropping whatever the old
// bee had queued, and is asked first(ledger) at once.
// Every program runs in its minified form (vendor/measure.js): the same text its size is measured on, so
// names, which minifying shortens, can't hide data.
import os from "node:os";
import { ProgramProcess } from "./runners/proc.js";
import { checkValue, parseType } from "./lib/types.js";
import { zeroLedger } from "./lib/scoring.js";
import { KINDS, excessEnergy, limitsOf, roundMs } from "./lib/gameConfig.js";
import { size as measure } from "./lib/measure.js";

export { KINDS };

/** What programs may read as GAME (each program also gets its own `ms`, and a flower its `size`). */
export function gameInfo(config, team, teams) {
  const { maxLen, maxNodes } = limitsOf(config);
  return {
    team, teams, feed_cost: config.feedCost, challenge_type: config.challengeType, response_type: config.responseType,
    max_len: maxLen, max_nodes: maxNodes, round_ms: roundMs(config),
    flower_ms: config.budgets.flower.ms, flower_size_cap: config.budgets.flower.size,
  };
}

/**
 * One finished turn as team `ti`'s programs (and operators) see it: the public part of every turn, plus
 * the nectar of the team's own turns and the private details of turns at its own flower. Hidden: null.
 */
export function entryFor(t, ti) {
  const ours = t.bee === ti || t.flower === ti, atOurFlower = t.flower === ti;
  return {
    round: t.round, bee: t.bee, flower: t.flower, challenge: t.c, response: t.r, fed: t.fed,
    nectar: ours && t.fed ? t.nectar : null,
    percent: atOurFlower ? t.percent : null, energy: atOurFlower ? t.energy : null,
    ms: atOurFlower ? t.ms : null, surplus: atOurFlower ? t.surplus : null,
  };
}

// Responses can be big trees and graphs; this caps the JSON text of any single value.
const MAX_CHARS = 262144;
const MAX_LOG = 2000; // characters of a bee's print output kept per action
// A bee's 50 ms is a deadline, not an interruption: the call runs on, and only this hard limit stops it.
const BEE_LIMIT_MS = 2000;
const flowerSetup = (config, team, teams, code, size, ledger) => ({
  code, ms: config.budgets.flower.ms, maxChars: MAX_CHARS, ledger,
  game: { ...gameInfo(config, team, teams), ms: config.budgets.flower.ms, size },
});
const beeSetup = (config, team, teams, code, ledger) => ({
  code, ms: config.budgets.bee.ms, limitMs: Math.max(BEE_LIMIT_MS, 2 * config.budgets.bee.ms), maxChars: MAX_CHARS, ledger,
  game: { ...gameInfo(config, team, teams), ms: config.budgets.bee.ms },
});

// Time limits must be fair, so never run more programs at once than there are CPU cores, across every
// game this process runs. Each program then has a core to itself, and its wall-clock time limit is
// effectively a CPU limit. A late bee keeps its core until it replies, which only stretches the round in
// wall time.
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
// several bees question at once doesn't queue behind one process. A process that dies (it crashed, or
// stopped responding and proc.js killed it) is replaced by a fresh one running the same version's code
// (with the ledger as it is now) when its slot is next picked. Respawns are spaced out: at most one per
// slot per RESPAWN_MS, twice as long after each respawn that dies before answering (up to RESPAWN_MAX_MS),
// so a flower that always hangs can't stall round after round. Meanwhile its calls go to a live process if
// it has one, else get the dead one's error at once.
const FLOWER_POOL = Math.max(1, Number(process.env.FLOWER_POOL) || 2);
const RESPAWN_MS = 1000;
const RESPAWN_MAX_MS = 60000;
export class FlowerPool {
  /** setup() gives a new process's setup, the ledger so far included. */
  constructor(language, setup) {
    this.language = language;
    this.setup = setup;
    this.users = 0;       // turns pinned to this version
    this.retired = false; // replaced: it goes once no turn uses it
    this.killed = false;  // no respawns once killed
    this.procs = Array.from({ length: FLOWER_POOL }, () => new ProgramProcess(language, "flower", setup()));
    this.pending = this.procs.map(() => 0);
    this.respawns = this.procs.map(() => 0);  // per slot: respawns since it last answered
    this.respawnAt = this.procs.map(() => 0); // per slot: no respawn before this performance.now()
    this.ready = Promise.all(this.procs.map((p) => p.ready)).then((r) => r[0]);
  }
  /** The flower's reply to challenge c: { v, cpu } or { e, cpu?, dead? }. */
  async call(c) {
    // The least busy slot, passing over dead ones that can't respawn yet.
    const now = performance.now();
    const load = (j) => (this.procs[j].dead && now < this.respawnAt[j] ? Infinity : this.pending[j]);
    let i = 0;
    for (let j = 1; j < this.procs.length; j++) if (load(j) < load(i)) i = j;
    this.pending[i]++;
    try {
      return await withCpu(async () => {
        const proc = this.#live(i);
        await proc.ready; // a fresh process starts up on this core, before the flower's time starts
        const res = await proc.call({ op: "call", c });
        if (!res.dead) this.respawns[i] = 0;
        return res;
      });
    } finally {
      this.pending[i]--;
    }
  }
  /** New ledger entries for every live process (a dead one's replacement starts with the whole ledger). */
  deliver(entries) {
    for (const p of this.procs) if (!p.dead) p.sync(entries);
  }
  /** Slot i's process: a fresh one in place of a dead one, unless the slot must wait to respawn. */
  #live(i) {
    const old = this.procs[i];
    if (!old.dead || this.killed || performance.now() < this.respawnAt[i]) return old;
    old.kill(); // gone already, unless it died some other way
    this.respawnAt[i] = performance.now() + Math.min(RESPAWN_MAX_MS, RESPAWN_MS * 2 ** this.respawns[i]);
    this.respawns[i]++;
    return (this.procs[i] = new ProgramProcess(this.language, "flower", this.setup()));
  }
  kill() {
    this.killed = true;
    for (const p of this.procs) p.kill();
  }
}

/**
 * Read a flower's reply: { r, percent, energy, ms, flowerError }. A late answer, an error or a malformed
 * return (not [response, percent], a response of the wrong type, a percent that isn't a number) gives a
 * null response and E = 0. percent is clamped to 0–100; ms is the call's CPU time.
 */
export function readAnswer(config, rType, res, size) {
  const ms = typeof res.cpu === "number" && Number.isFinite(res.cpu) ? Math.round(res.cpu * 1000) / 1000 : null;
  const fail = (e) => ({ r: null, percent: null, energy: 0, ms, flowerError: String(e).slice(0, 300) });
  if (res.e) return fail(res.e);
  const v = res.v;
  if (!Array.isArray(v) || v.length !== 2) return fail(`flower must return [response, percent] (got ${JSON.stringify(v)?.slice(0, 60)})`);
  const bad = checkValue(rType, v[0], limitsOf(config), "response");
  if (bad) return fail(bad);
  if (typeof v[1] !== "number" || !Number.isFinite(v[1])) return fail(`percent must be a number from 0 to 100 (got ${JSON.stringify(v[1])?.slice(0, 30)})`);
  return { r: v[0], percent: Math.min(100, Math.max(0, v[1])), energy: ms === null ? 0 : excessEnergy(config, size, ms), ms, flowerError: null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
/** Wait until performance.now() reaches t (timers have whole-millisecond resolution and can fire early). */
async function until(t) {
  for (let left = t - performance.now(); left > 0; left = t - performance.now()) await sleep(Math.ceil(left));
}
const LATE = Symbol("late");
/** `done`, or LATE if it hasn't settled `ms` after `from` (a performance.now() time). */
function byDeadline(done, from, ms) {
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(LATE), Math.max(0, from + ms - performance.now())); });
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}
// Replies handled outside the round flow must never become unhandled rejections (they'd take the server down).
const logged = (p) => p.catch((e) => console.error("garden:", e));
const shapeError = (a) => `decide must return ["feed", challenge] or ["leave", challenge] (got ${JSON.stringify(a)?.slice(0, 60)})`;
const round3 = (x) => Math.round(x * 1000) / 1000;

export class Garden {
  /**
   * teams: number of teams (team indices are participants order). round: rounds already played; clockMs:
   * the game time they took. endMs: game time at which run() stops (default config.minutes). maxRounds:
   * stop after this many rounds instead (for trying a bee). lastSeq: the last action number already used.
   * ledgers: { feeds, nectar, surplus } so far. history: the finished turns so far ({ round, bee, flower,
   * c, r, fed, nectar, percent, energy, ms, surplus }, team indices), which the programs' ledgers start
   * from. turns: each bee's turns so far. paced: rounds last at least roundMs of wall time (false: back to
   * back, for tests and the "try" tool).
   */
  constructor({ config, teams, clockMs = 0, round = 0, endMs = config.minutes * 60000, maxRounds = Infinity, lastSeq = 0,
    ledgers = null, history = [], turns = null, paced = true }) {
    this.config = config;
    this.n = teams;
    this.cType = parseType(config.challengeType);
    this.rType = parseType(config.responseType);
    this.limits = limitsOf(config);
    this.roundMs = roundMs(config);
    this.windowMs = config.budgets.flower.ms; // the flower window: responses are delivered at its end
    this.beeMs = config.budgets.bee.ms;       // the bees' decision window
    this.paced = paced;
    this.endMs = endMs;
    this.maxRounds = maxRounds;
    this.rounds = 0;                  // rounds run by this garden
    this.round = round;               // the game's rounds so far, counting the one in progress
    this.roundBase = round;
    this.clockBase = clockMs;
    this.seq = lastSeq;
    this.history = history.slice();   // finished turns
    this.delivered = this.history.length; // how many of them are in the programs' ledgers
    this.flowers = new Array(teams).fill(null); // per team: { team, version, size, pool }
    this.bees = Array.from({ length: teams }, (_, ti) => ({
      ti, version: null, code: null, pending: null, proc: null, gen: 0, broken: false, loading: false,
      sitOut: 0, turns: turns?.[ti] ?? 0,
      turn: null,        // the turn in progress
      queued: null,      // the challenge for its next turn: { c }
      busy: false,       // a call is in flight (or the bee is in a turn): no other request goes to it
      asking: null,      // a request outside the round flow (loading, first()): { inTime }
      askedRound: -1,    // the round of its latest first() request (one new one a round)
      log: "",           // printed output not yet attached to an action
    }));
    // A bee that fed shortly before the garden was adopted still sits out the rest of its rounds.
    for (const t of this.history) if (t.fed) this.bees[t.bee].sitOut = Math.max(0, t.round + config.feedCost - round);
    this.feeds = ledgers?.feeds ?? zeroLedger(teams);
    this.nectar = ledgers?.nectar ?? zeroLedger(teams);
    this.surplus = ledgers?.surplus ?? zeroLedger(teams); // surplus[b][f]: what f's flower kept from b's feeds
    this.out = [];                    // actions not yet drained
    this.problems = [];               // { team, kind, version, error }: the first error of each program version
    this.seenProblem = new Set();
    this.stopped = false;
    this.halt = new Promise((resolve) => { this.halted = resolve; }); // settles on stop(): pacing waits end early
    this.closed = false;
    this.paused = false;
    this.gate = null;
    this.retiring = new Set();        // replaced flower pools still answering turns pinned to them
    this.onArrive = null;             // called once a round's arrivals are recorded (live games flush them at once)
  }

  /** Game time: rounds × roundMs (the round in progress counts in full). It stands still between rounds. */
  clockMs() {
    return this.clockBase + (this.round - this.roundBase) * this.roundMs;
  }

  /** Game time at which round r starts. */
  #startOf(r) {
    return this.clockBase + (r - 1 - this.roundBase) * this.roundMs;
  }

  /** Team ti's ledger as delivered so far: what a program started now begins with. */
  ledgerFor(ti) {
    return this.history.slice(0, this.delivered).map((t) => entryFor(t, ti));
  }

  /** Put a program in play (or replace one). code is the source; the garden runs it minified. */
  async setProgram(ti, kind, code, version) {
    const { size, minified } = await measure(this.config.language, code);
    if (kind === "bee") {
      // It takes over when the bee's turn in progress is settled; a bee between turns (or not started yet) at once.
      const b = this.bees[ti];
      b.pending = { code: minified, version };
      if (this.running && !this.closed && !b.turn) this.#swapIn(b);
      return;
    }
    const pool = new FlowerPool(this.config.language, () => flowerSetup(this.config, ti, this.n, minified, size, this.ledgerFor(ti)));
    pool.ready.then((r) => { if (!r.ok) this.#problem(ti, "flower", version, r.e); });
    const slot = (this.flowers[ti] ??= { team: ti });
    if (slot.pool) this.#retire(slot.pool);
    Object.assign(slot, { version, size, pool }); // for turns that start from now on
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

  /** Stop the loop and every program (the round in progress is settled without waiting out its time). */
  async stop() {
    this.stopped = true;
    this.halted();
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
    return {
      actions: this.out.splice(0), problems: this.problems.splice(0), clockMs: Math.round(this.clockMs()), round: this.round,
      lastSeq: this.seq, feeds: this.feeds, nectar: this.nectar, surplus: this.surplus,
    };
  }

  async #loop() {
    while (!this.stopped) {
      if (this.paused) { await new Promise((resolve) => { this.gate = resolve; }); this.gate = null; continue; }
      if (this.clockMs() >= this.endMs || this.rounds >= this.maxRounds) break;
      if (!this.flowers.some(Boolean) || !this.bees.some((b) => b.pending || b.proc)) { // nobody can play yet
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
    // The round boundary: the last round's turns reach the ledgers; new bees take over, crashed ones start
    // afresh, bees with nothing queued are asked first() again.
    this.#deliver();
    for (const b of this.bees) this.#boundary(b);
    if (!this.paced) await this.#awaitRequests();
    // Turns. Feeding bees sit out; a bee with nothing queued (or a call still in flight) loses its turn.
    const turns = [];
    for (const b of this.bees) {
      if (!b.proc || b.broken || b.loading) continue;
      if (b.sitOut > 0) { b.sitOut--; continue; }
      if (!b.queued || b.busy) continue;
      const slot = this.#draw();
      if (!slot) continue;
      const t = {
        b, gen: b.gen, no: ++b.turns, round: r, start, c: b.queued.c, flower: slot.team, pool: slot.pool, size: slot.size,
        flowerVersion: slot.version, beeVersion: b.version, fed: false, nectar: null, surplus: 0, beeMs: null, beeError: null, log: null,
      };
      b.queued = null;
      b.busy = true;
      b.turn = t;
      slot.pool.users++;
      this.#record(t, "arrive", {}, start);
      turns.push(t);
    }
    if (turns.length) this.onArrive?.();
    // The flower window: every flower is called at once.
    await Promise.all(turns.map((t) => this.#answer(t)));
    if (this.paced) await Promise.race([until(t0 + this.windowMs), this.halt]);
    // The decision window: every response is delivered and every bee that took a turn decides.
    await Promise.all(turns.map((t) => this.#decide(t)));
    if (this.paced) await Promise.race([until(t0 + this.roundMs), this.halt]);
  }

  #close() {
    this.closed = true;
    for (const f of this.flowers) f?.pool.kill();
    for (const b of this.bees) b.proc?.kill();
    for (const p of this.retiring) p.kill();
  }

  /** A replaced flower version goes once no turn is pinned to it. */
  #retire(pool) {
    pool.retired = true;
    this.retiring.add(pool);
    this.#reap(pool);
  }

  #reap(pool) {
    if (pool.retired && pool.users <= 0) {
      pool.kill();
      this.retiring.delete(pool);
    }
  }

  /** The flower for a turn: any of the N flowers, uniformly at random, every time. */
  #draw() {
    const live = this.flowers.filter(Boolean);
    return live.length ? live[Math.floor(Math.random() * live.length)] : null;
  }

  /** The turns finished since the last delivery reach every program's ledger, each team its own view. */
  #deliver() {
    if (this.delivered >= this.history.length) return;
    const fresh = this.history.slice(this.delivered);
    this.delivered = this.history.length;
    for (let ti = 0; ti < this.n; ti++) {
      const b = this.bees[ti], f = this.flowers[ti];
      if (!(b.proc && !b.proc.dead) && !f) continue;
      const entries = fresh.map((t) => entryFor(t, ti));
      if (b.proc && !b.proc.dead) b.proc.sync(entries);
      f?.pool.deliver(entries);
    }
  }

  /** New code for a bee between turns takes over now: the old bee's queued challenge goes with it. */
  #swapIn(b) {
    const { code, version } = b.pending;
    b.pending = null;
    this.#startBee(b, code, version);
  }

  #problem(team, kind, version, error) {
    const key = `${team}:${kind}:${version}`;
    if (this.seenProblem.has(key)) return;
    this.seenProblem.add(key);
    this.problems.push({ team, kind, version, error: String(error).slice(0, 300) });
  }

  #record(t, action, fields, atMs) {
    this.out.push({
      seq: ++this.seq, atMs: Math.round(atMs), round: t.round, turn: t.no, bee: t.b.ti, flower: t.flower, action,
      beeVersion: t.beeVersion, flowerVersion: t.flowerVersion,
      c: null, r: null, percent: null, energy: null, ms: null, surplus: null, nectar: null, flowerError: null,
      beeMs: null, beeError: null, log: null, ...fields,
    });
  }

  /** What the bee printed since its last recorded turn, plus `out`. */
  #takeLog(b, out) {
    const s = (b.log + (out || "")).slice(0, MAX_LOG);
    b.log = "";
    return s || null;
  }

  #keepLog(b, out) {
    if (out) b.log = (b.log + out).slice(0, MAX_LOG);
  }

  #boundary(b) {
    if (b.proc && !b.broken && b.proc.dead) { // crashed or hung: it starts afresh (with its new code, if any)
      const { code, version } = b.pending ?? b;
      b.pending = null;
      this.#startBee(b, code, version);
    } else if (b.pending && !b.turn) this.#swapIn(b);
    else if (b.proc && !b.broken && !b.busy && !b.queued) this.#askFirst(b); // its last reply gave no challenge
  }

  #startBee(b, code, version) {
    b.queued = null;
    b.log = "";
    b.proc?.kill(); // its call in flight, if any, ends at once (and frees its core); the reply is ignored
    b.gen++;
    b.code = code;
    b.version = version;
    b.broken = false;
    const proc = (b.proc = new ProgramProcess(this.config.language, "bee", beeSetup(this.config, b.ti, this.n, code, this.ledgerFor(b.ti))));
    const gen = b.gen;
    // Loading counts as a call in flight (and a loading bee takes no turn). Then the new bee is asked
    // for its first challenge at once.
    b.busy = true;
    b.loading = true;
    const loaded = logged(proc.ready.then((load) => {
      if (gen !== b.gen || this.closed) return;
      b.busy = false;
      b.loading = false;
      b.asking = null;
      this.#keepLog(b, load.out);
      if (!load.ok) {
        b.broken = true; // idle until its team sends new code
        this.#problem(b.ti, "bee", b.version, load.e);
        return;
      }
      this.#askFirst(b, true);
    }));
    b.asking = { inTime: loaded };
  }

  /**
   * One request to the bee, on a core of its own: { gen, started (the performance.now() it got its core,
   * after any ledger delivery ahead of it), done ({ res, ms }) }. The core stays held until the reply.
   */
  #call(b, req) {
    const proc = b.proc;
    let began;
    const started = new Promise((resolve) => { began = resolve; });
    const done = (async () => {
      await proc.synced; // the ledger is up to date before the bee's clock starts
      return withCpu(async () => {
        const t0 = performance.now();
        began(t0);
        const res = await proc.call(req);
        return { res, ms: performance.now() - t0 };
      });
    })();
    b.busy = true;
    return { gen: b.gen, started, done };
  }

  /** Ask the bee for a challenge: first(ledger). Outside the round flow; at most one in flight, one new one a round. */
  #askFirst(b, force = false) {
    if (this.closed || this.stopped || b.broken || b.pending || !b.proc || b.proc.dead || b.busy || b.queued || b.turn) return;
    if (!force && b.askedRound === this.round) return; // asked this round already: again at the next boundary
    b.askedRound = this.round;
    const call = this.#call(b, { op: "first" });
    const asking = {};
    const handled = logged(call.done.then(({ res }) => {
      if (call.gen !== b.gen || this.closed) return;
      b.busy = false;
      if (b.asking === asking) b.asking = null;
      this.#onFirst(b, res);
    }));
    // An unpaced garden waits for it before the next round, as long as it answers within the bee's time.
    asking.inTime = call.started.then((t) => byDeadline(handled, t, this.beeMs));
    b.asking = asking;
  }

  /** Unpaced: the requests outside the round flow that answer in time make it into the next round. */
  async #awaitRequests() {
    const waited = new Set();
    for (;;) {
      const asks = this.bees.map((b) => b.asking).filter((a) => a && !waited.has(a));
      if (!asks.length) return;
      for (const a of asks) waited.add(a);
      await Promise.all(asks.map((a) => a.inTime));
    }
  }

  /** first()'s reply: a valid challenge is queued; anything else gets the bee asked again (next round). */
  #onFirst(b, res) {
    this.#keepLog(b, res.out);
    if (!res.e) {
      const bad = checkValue(this.cType, res.a, this.limits, "challenge");
      if (!bad) { b.queued = { c: res.a }; return; }
      this.#problem(b.ti, "bee", b.version, `first returned a bad challenge: ${bad}`);
    } else this.#problem(b.ti, "bee", b.version, res.e);
    if (!res.dead) this.#askFirst(b);
  }

  /** The flower's response to a turn, from the version the turn is pinned to. */
  async #answer(t) {
    const res = await t.pool.call(t.c);
    Object.assign(t, readAnswer(this.config, this.rType, res, t.size));
    if (t.flowerError) this.#problem(t.flower, "flower", t.flowerVersion, t.flowerError);
  }

  /** The bee decides, by its deadline; then the turn is settled. */
  async #decide(t) {
    const b = t.b;
    if (t.gen !== b.gen || !b.proc || b.proc.dead || this.stopped) {
      t.beeError = this.stopped ? "the game ended before the bee decided" : "the bee's process died";
      if (t.gen === b.gen) b.busy = false;
      return this.#settle(t);
    }
    const call = this.#call(b, { op: "decide", c: t.c, r: t.r });
    const res = await byDeadline(call.done, await call.started, this.beeMs);
    if (res !== LATE) {
      if (call.gen === b.gen) b.busy = false;
      this.#onDecision(t, res.res, res.ms);
      return this.#settle(t);
    }
    // Too slow: the turn is settled as no feed, but the engine keeps listening for the next challenge.
    t.beeError = `too slow: no reply within ${this.beeMs} ms`;
    this.#problem(b.ti, "bee", b.version, t.beeError);
    logged(call.done.then(({ res: late }) => {
      if (call.gen !== b.gen || this.closed) return;
      b.busy = false;
      this.#onLate(b, late);
    }));
    return this.#settle(t);
  }

  /** A reply in time: the feed or leave counts; a usable next challenge is queued. */
  #onDecision(t, res, ms) {
    const b = t.b;
    t.beeMs = round3(ms);
    t.log = this.#takeLog(b, res.out);
    if (res.e) {
      t.beeError = String(res.e).slice(0, 300);
      this.#problem(b.ti, "bee", b.version, res.e);
      return;
    }
    const a = res.a;
    const pair = Array.isArray(a) && a.length === 2 && (a[0] === "feed" || a[0] === "leave");
    const verb = pair ? a[0] : a === "feed" || a === "leave" ? a : null;
    if (!verb) {
      t.beeError = shapeError(a);
      this.#problem(b.ti, "bee", b.version, t.beeError);
      return;
    }
    t.fed = verb === "feed";
    if (!pair) return; // no next challenge: first() is asked at once
    const bad = checkValue(this.cType, a[1], this.limits, "next challenge");
    if (!bad) b.queued = { c: a[1] };
    else {
      t.beeError = String(bad).slice(0, 300);
      this.#problem(b.ti, "bee", b.version, bad);
    }
  }

  /**
   * A reply after the deadline (its turn is already settled, never as a feed). Only ["leave", c] gives a
   * challenge for the next turn; anything else gets the bee asked first() again.
   */
  #onLate(b, res) {
    this.#keepLog(b, res.out);
    const a = res.a;
    if (!res.e && Array.isArray(a) && a.length === 2 && a[0] === "leave" && !checkValue(this.cType, a[1], this.limits, "challenge")) {
      b.queued = { c: a[1] };
      return;
    }
    if (res.e) this.#problem(b.ti, "bee", b.version, res.e);
    if (!res.dead) this.#askFirst(b);
  }

  /** Settle a turn: nectar and surplus, the ledgers, the end of the turn's record; then the bee moves on. */
  #settle(t) {
    const b = t.b, f = t.flower;
    if (t.fed) {
      t.nectar = ((t.percent ?? 0) / 100) * t.energy;
      t.surplus = t.energy - t.nectar;
      this.feeds[b.ti][f]++;
      this.nectar[b.ti][f] += t.nectar;
      this.surplus[b.ti][f] += t.surplus;
    }
    this.#record(t, t.fed ? "feed" : "leave", {
      c: t.c, r: t.r, percent: t.percent, energy: t.energy, ms: t.ms, surplus: t.surplus, nectar: t.fed ? t.nectar : null,
      flowerError: t.flowerError, beeMs: t.beeMs, beeError: t.beeError, log: t.log,
    }, t.start + this.windowMs);
    this.history.push({
      round: t.round, bee: b.ti, flower: f, c: t.c, r: t.r, fed: t.fed, nectar: t.fed ? t.nectar : null,
      percent: t.percent, energy: t.energy, ms: t.ms, surplus: t.surplus,
    });
    // The turn is over: its flower version may go, and new code for the bee takes over now.
    b.turn = null;
    t.pool.users--;
    this.#reap(t.pool);
    if (t.gen !== b.gen) return;
    if (t.fed) b.sitOut = this.config.feedCost;
    if (b.pending) this.#swapIn(b); // drops the old bee's queued challenge (and any late reply)
    else if (!b.queued && !b.busy) this.#askFirst(b);
  }
}

/** Run a flower program on a list of challenges (for the "try it" tool), as team 0 of 1. */
export async function tryFlower({ config, code, challenges, ledger = [] }) {
  const cType = parseType(config.challengeType), rType = parseType(config.responseType);
  const limits = limitsOf(config);
  const { size, minified } = await measure(config.language, code);
  const proc = new ProgramProcess(config.language, "flower", flowerSetup(config, 0, 1, minified, size, Array.isArray(ledger) ? ledger : []));
  try {
    const load = await proc.ready;
    if (!load.ok) return { error: load.e, results: [] };
    const results = [];
    for (const c of challenges.slice(0, 50)) {
      const bad = checkValue(cType, c, limits, "challenge");
      if (bad) { results.push({ c, r: null, percent: null, energy: 0, ms: null, error: bad }); continue; }
      const res = await withCpu(() => proc.call({ op: "call", c }));
      const { flowerError, ...answer } = readAnswer(config, rType, res, size);
      results.push({ c, ...answer, ...(flowerError ? { error: flowerError } : {}) });
    }
    return { size, results };
  } finally {
    proc.kill();
  }
}

/** A bee foraging a garden of just its own team's flower for `rounds` rounds, unpaced (the "try it" tool). */
export async function tryBee({ config, programs, rounds = 300 }) {
  const garden = new Garden({ config, teams: 1, endMs: Infinity, maxRounds: rounds, paced: false });
  await Promise.all(KINDS.map((k) => garden.setProgram(0, k, programs[k], 1)));
  await garden.run();
  const { actions, problems, feeds, nectar, surplus } = garden.drain();
  return { actions, problems, feeds: feeds[0][0], nectar: nectar[0][0], surplus: surplus[0][0], rounds: garden.rounds };
}
