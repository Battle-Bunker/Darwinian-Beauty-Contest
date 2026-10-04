// The garden: one continuous stream of turns. Pure with respect to the database: programs go in (and can
// be replaced at any moment), actions, the ledgers and the bees' MEMORY come out.
//
// Every team has one flower species and one bee. Time runs in rounds, in lockstep: a round lasts exactly
// roundMs (flower.ms + bee.ms = 150 + 50 = 200 ms) of game time; game time is rounds × roundMs. A live game
// paces rounds to real time (each lasts at least roundMs of wall time, longer if the machine is short of
// cores: game time stays virtual, so that's still fair). Every bee that isn't feeding gets one TURN per round:
//   0 ms   Each bee with a challenge QUEUED (and no call in flight) takes its turn; one with nothing
//          queued loses it. The engine draws a flower uniformly at random among all N species, the bee's
//          own included (a public `arrive`, flushed at once), pins both versions, and calls
//          flower(challenge), which has flower.ms to return [response, percent]. The runner reports the
//          CPU time of the call; excess energy E = (flower size cap − the flower's size) × max(0,
//          flower.ms − CPU ms). A late answer, an error, a malformed return or a response over
//          maxResponseBytes: response null, E = 0. The response goes to the bee's process at once.
//   150 ms Every response is delivered at once, however fast its flower was. Each bee that took a turn
//          is called: decide(challenge, response), with bee.ms to return ["feed" | "leave", next].
//   200 ms The turn is settled. A feed: the flower gives the bee nectar = percent/100 × E and pollen =
//          (1 − percent/100) × E, and the bee sits out feedCost rounds, starting with fed(nectar).
//          No feed: nothing is given. `next` is queued for the bee's next turn.
// A late reply doesn't stop the round: at the deadline the turn is settled without it (never a feed), but
// the engine keeps listening (the call runs on, up to a hard limit of 2 s). If the late reply is
// ["leave", c], c is queued; anything else gets the bee asked first() for a challenge, outside the round
// flow (as does any reply that gives no usable next challenge). At most one such request is in flight per
// bee, and at most one new one a round.
//
// Every call runs fresh: flowers and bees alike are stateless, except for a bee's MEMORY, a key-value
// store the engine keeps (string keys; string, number, boolean or null values; at most budgets.bee.memory
// bytes, counting each key's UTF-8 bytes plus its value's JSON) and sends with every call; the reply carries
// it back and the engine saves it if it fits (else keeps the old one). A new bee version starts with {};
// a crash or a restarted process keeps it. After an in-time feed the bee's instance is kept for fed(nectar)
// (if it defines it), run as the turn is settled, within bee.ms; MEMORY is saved after it too.
//
// Programs get no history: only their arguments, GAME and (bees) MEMORY. A response may be up to
// maxResponseBytes of JSON (checked by the runner, inside the flower's time). It reaches the bee before its
// decision window ("stage"), so reading it in is never on the bee's clock. Actions carry a response over
// INLINE_BYTES as its size, hash and preview only; live.js stores the whole text apart.
//
// A turn keeps the program versions in effect at its arrival until it is settled: a new flower answers
// turns that start after it went live; a new bee takes over when its turn in progress is settled (or at
// once between turns), dropping whatever the old bee had queued, and is asked first() at once.
// Every program runs in its minified form (vendor/measure.js): the same text its size is measured on, so
// names, which minifying shortens, can't hide data.
import os from "node:os";
import { ProgramProcess } from "./runners/proc.js";
import { createHash } from "node:crypto";
import { checkValue, parseType } from "./lib/types.js";
import { zeroLedger } from "./lib/scoring.js";
import { KINDS, excessEnergy, limitsOf, responseLimits, roundMs } from "./lib/gameConfig.js";
import { size as measure } from "./lib/measure.js";

export { KINDS };

/** What programs may read as GAME (each program also gets its own `ms`; a flower its `size`, a bee `memory`). */
export function gameInfo(config, team, teams) {
  const { maxLen, maxNodes } = limitsOf(config);
  return {
    team, teams, feed_cost: config.feedCost, challenge_type: config.challengeType, response_type: config.responseType,
    max_len: maxLen, max_nodes: maxNodes, max_response_bytes: config.maxResponseBytes, round_ms: roundMs(config),
    flower_ms: config.budgets.flower.ms, flower_size_cap: config.budgets.flower.size,
  };
}

/** JSON with sorted keys and no spaces: how a bee's MEMORY is stored. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const EMPTY_MEMORY = "{}";

/** A MEMORY's size: Σ over its entries of the key's UTF-8 bytes + the value's JSON text's UTF-8 bytes. */
export function memorySize(m) {
  let n = 0;
  if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) n += Buffer.byteLength(k) + Buffer.byteLength(JSON.stringify(v) ?? "null");
  return n;
}

/** Why `m` isn't a valid MEMORY (string keys to strings, finite numbers, booleans or null), or null. */
export function memoryShapeError(m) {
  if (m === null || typeof m !== "object" || Array.isArray(m)) {
    return `MEMORY must be a dict (an object) of string keys to strings, numbers, booleans or null, not ${Array.isArray(m) ? "a list" : m === null ? "null" : `a ${typeof m}`}`;
  }
  for (const [k, v] of Object.entries(m)) {
    if (v === null || typeof v === "string" || typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v) && (!Number.isInteger(v) || Math.abs(v) <= Number.MAX_SAFE_INTEGER)) continue;
    const what = Array.isArray(v) ? "a list" : typeof v === "object" ? "a dict" : typeof v === "number" ? "a number out of range" : `a ${typeof v}`;
    return `MEMORY[${JSON.stringify(k.slice(0, 20))}] is ${what}: values must be strings, numbers, booleans or null`;
  }
  return null;
}

// A bee's replies (its challenges) are small; this caps the JSON text of one.
const MAX_CHARS = 262144;
// A response over this many bytes of JSON is shown as its size, hash and first INLINE_BYTES (actions, the
// ledger, live feeds, queries); its whole text is stored apart and served by seq.
export const INLINE_BYTES = 4096;
const MAX_LOG = 2000; // characters of a bee's print output kept per action
// A bee's 50 ms is a deadline, not an interruption: the call runs on, and only this hard limit stops it.
const BEE_LIMIT_MS = 2000;
const flowerSetup = (config, team, teams, code, size) => ({
  code, ms: config.budgets.flower.ms, maxResponseBytes: config.maxResponseBytes,
  game: { ...gameInfo(config, team, teams), ms: config.budgets.flower.ms, size },
});
const beeSetup = (config, team, teams, code) => ({
  code, ms: config.budgets.bee.ms, limitMs: Math.max(BEE_LIMIT_MS, 2 * config.budgets.bee.ms), maxChars: MAX_CHARS,
  game: { ...gameInfo(config, team, teams), ms: config.budgets.bee.ms, memory: config.budgets.bee.memory },
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
// when its slot is next picked. Respawns are spaced out: at most one per
// slot per RESPAWN_MS, twice as long after each respawn that dies before answering (up to RESPAWN_MAX_MS),
// so a flower that always hangs can't stall round after round. Meanwhile its calls go to a live process if
// it has one, else get the dead one's error at once.
const FLOWER_POOL = Math.max(1, Number(process.env.FLOWER_POOL) || 2);
const RESPAWN_MS = 1000;
const RESPAWN_MAX_MS = 60000;
export class FlowerPool {
  /** setup() gives a new process's setup. */
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
 * Read a flower's reply: { r, rBytes, rFull?, rHash?, rPreview?, percent, energy, ms, flowerError }. A late
 * answer, an error or a malformed return (not [response, percent], a response of the wrong type or over
 * maxResponseBytes, a percent that isn't a number) gives a null response and E = 0. percent is clamped to
 * 0–100; ms is the call's CPU time. A response over INLINE_BYTES also gets its JSON text (rFull), its
 * SHA-256 and its first INLINE_BYTES (rPreview).
 */
export function readAnswer(config, rType, res, size) {
  const ms = typeof res.cpu === "number" && Number.isFinite(res.cpu) ? Math.round(res.cpu * 1000) / 1000 : null;
  const fail = (e) => ({ r: null, rBytes: null, percent: null, energy: 0, ms, flowerError: String(e).slice(0, 300) });
  if (res.e) return fail(res.e);
  const v = res.v;
  if (!Array.isArray(v) || v.length !== 2) return fail(`flower must return [response, percent] (got ${JSON.stringify(v)?.slice(0, 60)})`);
  const bad = checkValue(rType, v[0], responseLimits(), "response");
  if (bad) return fail(bad);
  if (typeof v[1] !== "number" || !Number.isFinite(v[1])) return fail(`percent must be a number from 0 to 100 (got ${JSON.stringify(v[1])?.slice(0, 30)})`);
  let rBytes = typeof res.bytes === "number" ? res.bytes : null, full = null;
  if (rBytes === null || rBytes > INLINE_BYTES) {
    full = rawResponse(res) ?? JSON.stringify(v[0]);
    rBytes = Buffer.byteLength(full);
    if (rBytes > config.maxResponseBytes) return fail(`the response is ${rBytes} bytes of JSON, over the cap of ${config.maxResponseBytes}`);
  }
  const answer = { r: v[0], rBytes, percent: Math.min(100, Math.max(0, v[1])), energy: ms === null ? 0 : excessEnergy(config, size, ms), ms, flowerError: null };
  return rBytes > INLINE_BYTES ? { ...answer, ...largeResponse(full) } : answer;
}

/**
 * The response's JSON text as the runner wrote it, cut from its reply line {"cpu":…,"bytes":…,"v":[R,P]}
 * (P is a number, so the last comma is R's end), or null.
 */
function rawResponse(res) {
  const raw = res.raw;
  if (typeof raw !== "string" || !raw.endsWith("]}")) return null;
  const i = raw.indexOf('"v":['), j = raw.lastIndexOf(",");
  return i > 0 && j > i + 5 ? raw.slice(i + 5, j) : null;
}

/** A response over INLINE_BYTES: its JSON text, its SHA-256 (hex) and its first INLINE_BYTES (whole characters). */
export function largeResponse(full) {
  const head = Buffer.from(full.slice(0, INLINE_BYTES));
  let end = Math.min(INLINE_BYTES, head.length);
  if (end < head.length) while (end > 0 && (head[end] & 0xc0) === 0x80) end--;
  return { rFull: full, rHash: createHash("sha256").update(full).digest("hex"), rPreview: head.subarray(0, end).toString() };
}

/** What a viewer is shown of a response: { r, rBytes, rHash?, rPreview? } (the value itself only up to INLINE_BYTES). */
export const shownResponse = (a) => (a.rFull !== undefined
  ? { r: null, rBytes: a.rBytes, rHash: a.rHash, rPreview: a.rPreview }
  : { r: a.r ?? null, rBytes: a.rBytes ?? null });

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
   * ledgers: { feeds, nectar, pollen } so far. lastFed: per team, the round its bee last fed in (null:
   * never), so an adopted garden keeps it sitting out. turns: each bee's turns so far. memories: per team,
   * its bee's saved MEMORY, { version, memory (canonical JSON), error }, or null. game: the game's short id
   * (turn records' `game`). keepHistory: keep every finished turn's `turns` record in `history` (tests).
   * paced: rounds last at least roundMs of wall time (false: back to back, for tests and the "try" tool).
   */
  constructor({ config, teams, clockMs = 0, round = 0, endMs = config.minutes * 60000, maxRounds = Infinity, lastSeq = 0,
    ledgers = null, lastFed = null, turns = null, memories = null, game = "", keepHistory = false, paced = true }) {
    this.config = config;
    this.n = teams;
    this.cType = parseType(config.challengeType);
    this.rType = parseType(config.responseType);
    this.limits = limitsOf(config);
    this.roundMs = roundMs(config);
    this.windowMs = config.budgets.flower.ms; // the flower window: responses are delivered at its end
    this.beeMs = config.budgets.bee.ms;       // the bees' decision window
    this.paced = paced;
    this.game = game;
    this.memoryCap = config.budgets.bee.memory;
    this.endMs = endMs;
    this.maxRounds = maxRounds;
    this.rounds = 0;                  // rounds run by this garden
    this.round = round;               // the game's rounds so far, counting the one in progress
    this.roundBase = round;
    this.clockBase = clockMs;
    this.seq = lastSeq;
    this.history = keepHistory ? [] : null; // finished turns' records, if kept
    this.flowers = new Array(teams).fill(null); // per team: { team, version, size, pool }
    this.bees = Array.from({ length: teams }, (_, ti) => ({
      ti, version: null, code: null, pending: null, proc: null, gen: 0, broken: false, loading: false,
      sitOut: lastFed?.[ti] == null ? 0 : Math.max(0, lastFed[ti] + config.feedCost - round), turns: turns?.[ti] ?? 0,
      turn: null,        // the turn in progress
      queued: null,      // the challenge for its next turn: { c }
      busy: false,       // a call is in flight (or the bee is in a turn): no other request goes to it
      asking: null,      // a request outside the round flow (loading, first()): { inTime }
      askedRound: -1,    // the round of its latest first() request (one new one a round)
      log: "",           // printed output not yet attached to an action
      // MEMORY: the canonical JSON saved after its last call, the bee version it belongs to, the last error
      memory: memories?.[ti]?.memory ?? EMPTY_MEMORY, memoryVersion: memories?.[ti]?.version ?? null,
      memoryError: memories?.[ti]?.error ?? null, memoryChanged: false,
      fedDone: null,     // a fed() call in flight: the bee's next request waits for it (and its MEMORY)
    }));
    this.feeds = ledgers?.feeds ?? zeroLedger(teams);
    this.nectar = ledgers?.nectar ?? zeroLedger(teams);
    this.pollen = ledgers?.pollen ?? zeroLedger(teams); // pollen[b][f]: the pollen f's species gave b's bee
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
    const pool = new FlowerPool(this.config.language, () => flowerSetup(this.config, ti, this.n, minified, size));
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
    // A fed() still running when the loop ends gets to finish (it is stopped within bee.ms anyway).
    this.running ??= this.#loop().then(() => Promise.all(this.bees.map((b) => b.fedDone))).finally(() => this.#close());
    return this.running;
  }

  /** Everything new since the last drain: actions, program problems, the clock and the ledgers. */
  drain() {
    const memories = [];
    for (const b of this.bees) {
      if (!b.memoryChanged) continue;
      b.memoryChanged = false;
      memories.push({ team: b.ti, ...this.memoryOf(b.ti) });
    }
    return {
      actions: this.out.splice(0), problems: this.problems.splice(0), clockMs: Math.round(this.clockMs()), round: this.round,
      lastSeq: this.seq, feeds: this.feeds, nectar: this.nectar, pollen: this.pollen, memories,
    };
  }

  /** Team ti's bee's MEMORY: { version, memory (canonical JSON), bytes (its key-value size), error }. */
  memoryOf(ti) {
    const b = this.bees[ti];
    let bytes = 0;
    try { bytes = memorySize(JSON.parse(b.memory)); } catch {}
    return { version: b.memoryVersion, memory: b.memory, bytes, error: b.memoryError };
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
    // The round boundary: new bees take over, crashed ones start afresh, bees with nothing queued are asked
    // first() again.
    for (const b of this.bees) this.#boundary(b);
    if (!this.paced) await this.#awaitRequests();
    // Turns. Feeding bees sit out; a bee with nothing queued (or a call still in flight) loses its turn.
    const turns = [];
    for (const b of this.bees) {
      if (b.sitOut > 0) { b.sitOut--; continue; } // feeding rounds pass whatever the bee is doing
      if (!b.proc || b.broken || b.loading || !b.queued || b.busy) continue;
      const slot = this.#draw();
      if (!slot) continue;
      const t = {
        b, gen: b.gen, no: ++b.turns, round: r, start, c: b.queued.c, flower: slot.team, pool: slot.pool, size: slot.size,
        flowerVersion: slot.version, beeVersion: b.version, fed: false, nectar: null, pollen: 0, beeMs: null, beeError: null, log: null,
        staged: null, // the response's delivery to the bee, ahead of its decision window
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
    if (this.history) for (const t of turns) this.history.push(t.record);
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
      c: null, r: null, rBytes: null, percent: null, energy: null, ms: null, pollen: null, nectar: null, flowerError: null,
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
    if (b.memoryVersion !== version) this.#setMemory(b, EMPTY_MEMORY, version, null); // a new version starts with {}
    b.queued = null;
    b.log = "";
    b.proc?.kill(); // its call in flight, if any, ends at once (and frees its core); the reply is ignored
    b.gen++;
    b.fedDone = null;
    b.code = code;
    b.version = version;
    b.broken = false;
    const proc = (b.proc = new ProgramProcess(this.config.language, "bee", beeSetup(this.config, b.ti, this.n, code)));
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
   * after any fed() ahead of it, and `before`), done ({ res, ms }) }. The core stays held until the reply.
   */
  #call(b, req, before = null) {
    const proc = b.proc;
    let began;
    const started = new Promise((resolve) => { began = resolve; });
    const done = (async () => {
      await b.fedDone; // a fed() in flight goes first, and its MEMORY with it
      await before;    // (a decision: its response reaches the bee first)
      return withCpu(async () => {
        const t0 = performance.now();
        began(t0);
        const res = await proc.call({ ...req, memory: b.memory }); // MEMORY as saved after its last call
        return { res, ms: performance.now() - t0 };
      });
    })();
    b.busy = true;
    return { gen: b.gen, started, done };
  }

  /** Ask the bee for a challenge: first(). Outside the round flow; at most one in flight, one new one a round. */
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
    this.#saveMemory(b, res);
    if (!res.e) {
      const bad = checkValue(this.cType, res.a, this.limits, "challenge");
      if (!bad) { b.queued = { c: res.a }; return; }
      this.#problem(b.ti, "bee", b.version, `first returned a bad challenge: ${bad}`);
    } else this.#problem(b.ti, "bee", b.version, res.e);
    if (!res.dead) this.#askFirst(b);
  }

  /**
   * The flower's response to a turn, from the version the turn is pinned to. It goes to the bee's process
   * at once ("stage": read in there, off the bee's clock), so a big response costs the bee no time.
   */
  async #answer(t) {
    const res = await t.pool.call(t.c);
    Object.assign(t, readAnswer(this.config, this.rType, res, t.size));
    if (t.flowerError) this.#problem(t.flower, "flower", t.flowerVersion, t.flowerError);
    const b = t.b;
    if (t.gen === b.gen && b.proc && !b.proc.dead && !this.stopped) {
      const line = `{"op":"stage","c":${JSON.stringify(t.c)},"r":${t.rFull ?? JSON.stringify(t.r)}}`;
      const proc = b.proc;
      t.staged = (async () => { await b.fedDone; return withCpu(() => proc.call(line)); })();
    }
  }

  /** The bee decides, by its deadline; then the turn is settled. */
  async #decide(t) {
    const b = t.b;
    if (t.gen !== b.gen || !b.proc || b.proc.dead || this.stopped) {
      t.beeError = this.stopped ? "the game ended before the bee decided" : "the bee's process died";
      if (t.gen === b.gen) b.busy = false;
      return this.#settle(t);
    }
    const staged = t.staged ? await t.staged : null;
    const req = staged?.ok ? { op: "decide", staged: true } : { op: "decide", c: t.c, r: t.r };
    const call = this.#call(b, req);
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
    const memoryError = this.#saveMemory(b, res); // the decision counts either way
    if (memoryError) t.beeError = memoryError;
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
      t.beeError = [t.beeError, String(bad).slice(0, 300)].filter(Boolean).join("; ");
      this.#problem(b.ti, "bee", b.version, bad);
    }
  }

  /**
   * Save the MEMORY a bee's call returned with (unless the call crashed): if it is a key-value store within
   * the cap, it replaces the old one; otherwise the old one is kept. Returns the error, if any.
   */
  #saveMemory(b, res) {
    if (res.e || res.dead) return null; // a call that crashed saves nothing
    let error = res.memoryError ?? null, json = null;
    if (!error && typeof res.memory === "string") {
      let m;
      try { m = JSON.parse(res.memory); } catch { error = "MEMORY is not plain JSON"; }
      if (!error) error = memoryShapeError(m);
      if (!error) {
        const bytes = memorySize(m);
        if (bytes > this.memoryCap) error = `MEMORY is ${bytes} bytes, over its cap of ${this.memoryCap}: the old memory was kept`;
        else json = canonicalJson(m);
      }
    }
    if (json !== null && (json !== b.memory || b.memoryError)) this.#setMemory(b, json, b.version, null);
    if (error) {
      error = error.endsWith("was kept") ? error : `${error}: the old memory was kept`;
      this.#setMemory(b, b.memory, b.memoryVersion, error);
      this.#problem(b.ti, "bee", b.version, error);
    }
    return error;
  }

  #setMemory(b, json, version, error) {
    b.memory = json;
    b.memoryVersion = version;
    b.memoryError = error;
    b.memoryChanged = true;
  }

  /**
   * A reply after the deadline (its turn is already settled, never as a feed). Only ["leave", c] gives a
   * challenge for the next turn; anything else gets the bee asked first() again.
   */
  #onLate(b, res) {
    this.#keepLog(b, res.out);
    this.#saveMemory(b, res);
    const a = res.a;
    if (!res.e && Array.isArray(a) && a.length === 2 && a[0] === "leave" && !checkValue(this.cType, a[1], this.limits, "challenge")) {
      b.queued = { c: a[1] };
      return;
    }
    if (res.e) this.#problem(b.ti, "bee", b.version, res.e);
    if (!res.dead) this.#askFirst(b);
  }

  /** Settle a turn: nectar and pollen, the ledgers, the end of the turn's record; then the bee moves on. */
  #settle(t) {
    const b = t.b, f = t.flower;
    if (t.fed) {
      t.nectar = ((t.percent ?? 0) / 100) * t.energy;
      t.pollen = t.energy - t.nectar;
      this.feeds[b.ti][f]++;
      this.nectar[b.ti][f] += t.nectar;
      this.pollen[b.ti][f] += t.pollen;
    }
    const large = t.rFull !== undefined ? { rFull: t.rFull, rHash: t.rHash, rPreview: t.rPreview } : {};
    this.#record(t, t.fed ? "feed" : "leave", {
      c: t.c, r: t.rFull !== undefined ? null : t.r, rBytes: t.rBytes ?? null, ...large,
      percent: t.percent, energy: t.energy, ms: t.ms, pollen: t.pollen, nectar: t.fed ? t.nectar : null,
      flowerError: t.flowerError, beeMs: t.beeMs, beeError: t.beeError, log: t.log,
    }, t.start + this.windowMs);
    // The turn as a `turns` record (server/query/schema.js), unmasked.
    if (this.history) {
      t.record = {
        game: this.game, seq: this.seq, round: t.round, atMs: Math.round(t.start), turn: t.no, bee: b.ti, flower: f,
        challenge: t.c, response: t.rFull !== undefined ? null : t.r, responseBytes: t.rBytes ?? null, responseHash: t.rHash ?? null,
        fed: t.fed, percent: t.percent, energy: t.energy, nectar: t.fed ? t.nectar : null, pollen: t.pollen, ms: t.ms,
        flowerVersion: t.flowerVersion, flowerError: t.flowerError, beeMs: t.beeMs, beeVersion: t.beeVersion, beeError: t.beeError,
      };
    }
    // The turn is over: its flower version may go, and new code for the bee takes over now.
    b.turn = null;
    t.pool.users--;
    this.#reap(t.pool);
    if (t.gen !== b.gen) return;
    if (t.fed) b.sitOut = this.config.feedCost;
    if (b.pending) this.#swapIn(b); // drops the old bee's queued challenge (and any late reply), and its fed()
    else {
      if (t.fed && !this.stopped && !this.closed && b.proc && !b.proc.dead) this.#fed(b, t.nectar);
      if (!b.queued && !b.busy) this.#askFirst(b);
    }
  }

  /**
   * After a feed decided in time: fed(nectar) in the instance that decided (the runner kept it, if the
   * program defines fed), within bee.ms; then its MEMORY is saved. It doesn't make the bee busy, so it never
   * costs a turn, but every later request to the bee waits for it.
   */
  #fed(b, nectar) {
    const gen = b.gen, proc = b.proc;
    const run = withCpu(() => proc.call({ op: "fed", nectar }, this.beeMs + 1500)).then((res) => {
      if (gen !== b.gen || this.closed) return;
      this.#keepLog(b, res.out);
      if (res.skipped) return;
      if (res.e) {
        const error = `fed() failed (${String(res.e).slice(0, 200)}): MEMORY is as saved after decide`;
        this.#setMemory(b, b.memory, b.memoryVersion, error);
        this.#problem(b.ti, "bee", b.version, error);
        return;
      }
      this.#saveMemory(b, res);
    });
    const done = logged(run).finally(() => { if (b.fedDone === done) b.fedDone = null; });
    b.fedDone = done;
  }
}

/**
 * Run a flower program on a list of challenges (for the "try it" tool), as team 0 of 1. A response over
 * INLINE_BYTES comes back as its size, hash and preview, as in actions.
 */
export async function tryFlower({ config, code, challenges }) {
  const cType = parseType(config.challengeType), rType = parseType(config.responseType);
  const limits = limitsOf(config);
  const { size, minified } = await measure(config.language, code);
  const proc = new ProgramProcess(config.language, "flower", flowerSetup(config, 0, 1, minified, size));
  try {
    const load = await proc.ready;
    if (!load.ok) return { error: load.e, results: [] };
    const results = [];
    for (const c of challenges.slice(0, 50)) {
      const bad = checkValue(cType, c, limits, "challenge");
      if (bad) { results.push({ c, r: null, rBytes: null, percent: null, energy: 0, ms: null, error: bad }); continue; }
      const res = await withCpu(() => proc.call({ op: "call", c }));
      const { flowerError, rFull, ...answer } = readAnswer(config, rType, res, size);
      if (rFull !== undefined) answer.r = null;
      results.push({ c, ...answer, ...(flowerError ? { error: flowerError } : {}) });
    }
    return { size, results };
  } finally {
    proc.kill();
  }
}

/**
 * A bee foraging a garden of just its own team's flower for `rounds` rounds, unpaced (the "try it" tool),
 * fed() and all. `memory`: the test bee's MEMORY to start with (a local simulation; it never touches a
 * game's bee). Actions carry a response over INLINE_BYTES as its size, hash and preview.
 */
export async function tryBee({ config, programs, rounds = 300, memory = {} }) {
  const memories = [{ version: 1, memory: canonicalJson(memory ?? {}), error: null }];
  const garden = new Garden({ config, teams: 1, endMs: Infinity, maxRounds: rounds, paced: false, memories, game: "try" });
  await Promise.all(KINDS.map((k) => garden.setProgram(0, k, programs[k], 1)));
  await garden.run();
  const { actions, problems, feeds, nectar, pollen } = garden.drain();
  for (const a of actions) delete a.rFull;
  const m = garden.memoryOf(0);
  return { actions, problems, feeds: feeds[0][0], nectar: nectar[0][0], pollen: pollen[0][0], rounds: garden.rounds,
    memory: { value: JSON.parse(m.memory), bytes: m.bytes, cap: config.budgets.bee.memory, error: m.error } };
}
