// The garden: one continuous stream of bee actions. Pure with respect to the database: programs go in
// (and can be replaced at any moment), actions come out.
//
// Every team owns a patch of two flowers (clover = rewarding, orchid = deceptive) and one bee. The bees
// take turns round robin, as fast as the programs run: in each round every bee that isn't feeding takes
// one turn, all of them at once. A bee is shown flowers from its own shuffled deck of every flower in
// the garden (each comes up once before any comes up again). At a flower it may ask challenges (a turn
// each), feed once (nectar only at clovers; the bee then sits out the next feedCost rounds), keep asking
// after feeding, and leave (free once it has asked; an empty glance costs a turn). After a feed,
// anything but an ask ends the visit.
// Flowers are stateless: every ask runs the flower afresh, with fresh randomness and the clock, so the
// same challenge can get a different answer every time. A bee keeps its state for as long as that
// version of it plays; new code (or a crash) starts it afresh.
// A team may replace any of its programs at any time: a flower's next ask runs the new code; a bee
// swaps at the start of its next turn, abandoning the visit it was on.
// Every program runs in its minified form (vendor/measure.js): the same text its size is measured on,
// so names, which minifying shortens, can't hide data.
import os from "node:os";
import { ProgramProcess } from "./runners/proc.js";
import { checkValue, parseType } from "./lib/types.js";
import { zeroLedger } from "./lib/scoring.js";
import { limitsOf } from "./lib/gameConfig.js";
import { size } from "./lib/measure.js";

export const KINDS = ["clover", "orchid", "bee"];
export const FLOWERS = ["clover", "orchid"];

/** The text the game actually runs: the program minified. */
export const runnable = async (language, code) => (await size(language, code)).minified;

/** What programs may read as GAME, plus "ms": each program's own compute budget per call. */
export function gameInfo(config) {
  const { maxLen, maxNodes } = limitsOf(config);
  return {
    feed_cost: config.feedCost, challenge_type: config.challengeType, response_type: config.responseType,
    max_len: maxLen, max_nodes: maxNodes,
  };
}

// Responses can be big trees and graphs; this caps the JSON text of any single value.
const MAX_CHARS = 262144;
const MAX_LOG = 2000; // characters of a bee's print output kept per action
const flowerSetup = (config, kind, code) => ({
  code, ms: config.budgets[kind].ms, game: { ...gameInfo(config), ms: config.budgets[kind].ms }, maxChars: MAX_CHARS,
});

// Compute budgets are a costly signal (clovers get 3× an orchid's), so timing must be fair: never run
// more programs at once than there are CPU cores, across every game this process runs. Each program
// then has a core to itself, and its wall-clock time limit is effectively a CPU limit.
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

export class Garden {
  /**
   * teams: number of teams (ledger rows/columns are team indices).
   * clockMs: game time already played; round: rounds already played. endMs: game time at which run()
   * stops (default config.minutes). maxRounds: stop after this many rounds instead (for trying a bee).
   * lastSeq: the last action number already used. ledgers: { feeds, nectar } so far.
   */
  constructor({ config, teams, clockMs = 0, round = 0, endMs = config.minutes * 60000, maxRounds = Infinity, lastSeq = 0, ledgers = null }) {
    this.config = config;
    this.n = teams;
    this.cType = parseType(config.challengeType);
    this.rType = parseType(config.responseType);
    this.limits = limitsOf(config);
    this.endMs = endMs;
    this.maxRounds = maxRounds;
    this.rounds = 0;                  // rounds run by this garden
    this.round = round;               // rounds in the game so far (the current round is round + 1)
    this.seq = lastSeq;
    this.clockBase = clockMs;
    this.startedAt = null;            // performance.now() when the clock last started
    this.flowers = [];                // { team, kind, version, pool }
    this.bees = Array.from({ length: teams }, (_, ti) => ({ ti, version: null, code: null, pending: null, proc: null, broken: false, sitOut: 0, deck: [], visit: null, visits: 0 }));
    this.feeds = ledgers?.feeds ?? zeroLedger(teams);
    this.nectar = ledgers?.nectar ?? zeroLedger(teams);
    this.out = [];                    // actions not yet drained
    this.problems = [];               // { team, kind, version, error }: the first error of each program version
    this.seenProblem = new Set();
    this.stopped = false;
    this.paused = false;
    this.gate = null;
    this.retiring = new Set();
  }

  clockMs() {
    return this.clockBase + (this.startedAt !== null ? performance.now() - this.startedAt : 0);
  }

  /** Put a program in play (or replace one). code is the source; the garden runs it minified. */
  async setProgram(ti, kind, code, version) {
    const minified = await runnable(this.config.language, code);
    if (kind === "bee") {
      this.bees[ti].pending = { code: minified, version };
      return;
    }
    const pool = new FlowerPool(this.config.language, flowerSetup(this.config, kind, minified));
    pool.ready.then((r) => { if (!r.ok) this.#problem(ti, kind, version, r.e); });
    let slot = this.flowers.find((f) => f.team === ti && f.kind === kind);
    if (!slot) this.flowers.push((slot = { team: ti, kind }));
    else this.#retire(slot.pool);
    Object.assign(slot, { version, pool });
  }

  pause() {
    if (this.paused) return;
    this.clockBase = this.clockMs();
    this.startedAt = null;
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.startedAt = performance.now();
    this.gate?.();
  }

  /** Stop the loop (after the turns in flight) and every program. */
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
    if (!this.paused) this.startedAt = performance.now();
    while (!this.stopped) {
      if (this.paused) { await new Promise((resolve) => { this.gate = resolve; }); this.gate = null; continue; }
      if (this.clockMs() >= this.endMs || this.rounds >= this.maxRounds) break;
      const bees = this.bees.filter((b) => b.pending || (b.proc && !b.broken));
      this.rounds++;
      if (!bees.length || !this.flowers.length) { await new Promise((r) => setTimeout(r, 100)); continue; } // nobody can play
      this.round++;
      // Feeding bees are out of the round robin: they sit this round out.
      const acting = [];
      for (const b of bees) { if (b.sitOut > 0) b.sitOut--; else acting.push(b); }
      if (acting.length) await Promise.all(acting.map((b) => this.#turn(b)));
      else await new Promise((r) => setImmediate(r));
    }
    this.clockBase = this.clockMs();
    this.startedAt = null;
  }

  #close() {
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

  #record(b, v, fields) {
    this.out.push({
      seq: ++this.seq, atMs: Math.round(this.clockMs()), round: this.round, bee: b.ti, visit: v.no, patch: v.slot.team, kind: v.slot.kind,
      beeVersion: b.version, flowerVersion: v.slot.version,
      c: null, r: null, after: false, nectar: null, ms: null, error: null, by: null, log: null, ...fields,
    });
  }

  #startBee(b, code, version) {
    if (b.visit) this.#record(b, b.visit, { action: "leave", error: version === b.version ? "the bee restarted" : "a new bee took over", by: "engine" });
    b.visit = null;
    b.proc?.kill();
    b.code = code;
    b.version = version;
    b.broken = false;
    b.proc = new ProgramProcess(this.config.language, "bee", {
      code, ms: this.config.budgets.bee.ms, game: { ...gameInfo(this.config), ms: this.config.budgets.bee.ms }, maxChars: MAX_CHARS,
    });
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

  async #turn(b) {
    if (b.pending) { const { code, version } = b.pending; b.pending = null; this.#startBee(b, code, version); }
    else if (b.proc.dead) this.#startBee(b, b.code, b.version); // crashed or hung: start it afresh
    const load = await b.proc.ready;
    if (!load.ok) {
      b.broken = true; // idle until its team sends new code
      this.#problem(b.ti, "bee", b.version, load.e);
      return;
    }
    const call = (obj) => withCpu(() => b.proc.call(obj));
    for (let step = 0; step < 4 && !this.stopped; step++) {
      if (!b.visit) {
        const slot = this.#draw(b);
        if (!slot) return;
        b.visit = { slot, no: ++b.visits, asks: 0, fed: false, nectar: null, first: true, last: null };
      }
      const v = b.visit;
      const res = await call({ op: "forage", new: v.first, step: v.last, visit: { fed: v.fed, nectar: v.nectar, flowers: this.flowers.length } });
      v.first = false;
      v.last = null;
      const log = res.out ? res.out.slice(0, MAX_LOG) : null;
      let action = res.a, err = res.e || null;
      if (!err) {
        if (Array.isArray(action) && action.length === 2 && action[0] === "ask") action = "ask";
        else if (action !== "feed" && action !== "leave") err = `forage must return ["ask", challenge], "feed" or "leave" (got ${JSON.stringify(res.a)?.slice(0, 60)})`;
      }
      if (err) { // a mistake costs a turn and ends the visit
        this.#problem(b.ti, "bee", b.version, err);
        this.#record(b, v, { action: "error", error: String(err).slice(0, 300), by: "bee", log });
        b.visit = null;
        return;
      }
      if (action === "ask") {
        const c = res.a[1];
        const bad = checkValue(this.cType, c, this.limits, "challenge");
        const answer = bad ? { r: null, error: String(bad).slice(0, 300), by: "challenge" } : await this.#ask(v.slot, c);
        this.#record(b, v, { action: "ask", c, after: v.fed, log, ...answer });
        v.asks++;
        v.last = [c, answer.r];
        return;
      }
      if (action === "feed" && !v.fed) {
        if (!v.asks) {
          this.#record(b, v, { action: "error", error: "must ask at least once before feeding", by: "bee", log });
          b.visit = null;
          return;
        }
        v.fed = true;
        v.nectar = v.slot.kind === "clover";
        this.feeds[b.ti][v.slot.team]++;
        if (v.nectar) this.nectar[b.ti][v.slot.team]++;
        const t = await call({ op: "tasted", nectar: v.nectar });
        const logs = [log, t.out].filter(Boolean).join("").slice(0, MAX_LOG) || null;
        this.#record(b, v, { action: "feed", nectar: v.nectar, log: logs, ...(t.e ? { error: ("tasted: " + t.e).slice(0, 300), by: "bee" } : {}) });
        if (this.config.feedCost === 0) continue;
        b.sitOut = this.config.feedCost; // feeding: out of the round robin for the next feedCost rounds
        return;
      }
      // leave (or a second feed, which also moves on): free once the bee has asked here
      this.#record(b, v, { action: "leave", log });
      b.visit = null;
      if (!v.asks) return;
    }
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

/** A bee foraging a garden of just its own team's two flowers for `rounds` rounds (the "try it" tool). */
export async function tryBee({ config, programs, rounds = 300 }) {
  const garden = new Garden({ config, teams: 1, endMs: Infinity, maxRounds: rounds });
  await Promise.all(KINDS.map((k) => garden.setProgram(0, k, programs[k], 1)));
  await garden.run();
  const { actions, problems, feeds, nectar } = garden.drain();
  return { actions, problems, feeds: feeds[0][0], nectar: nectar[0][0], rounds: garden.rounds };
}
