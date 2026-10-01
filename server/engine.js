// The round simulator. Pure with respect to the database: programs + config + seed (+ bee memory) in,
// visits out.
//
// Every team owns a patch of two flowers (clover = rewarding, orchid = deceptive) and one bee.
// Each bee gets turnsPerFlower × (number of flowers) turns, and is shown flowers drawn from a
// shuffled deck of all 2N flowers (every flower comes up once before any repeats). At each flower it
// may ask challenges (1 turn each), feed once (feedCost turns; nectar only at clovers), keep asking
// after feeding, and leave (free). After a feed, anything other than an ask ends the visit. Bees run
// independently and in parallel. Flowers are stateless: nothing survives from one call to the next.
// They may use fresh randomness and the clock, so the same challenge can get a different answer every
// time, and every ask runs the flower again. At the end of the round each bee's top-level data is
// snapshotted; later rounds see those snapshots, read-only, as MEMORY.
import os from "node:os";
import { ProgramProcess } from "./runners/proc.js";
import { checkValue, parseType } from "./lib/types.js";
import { zeroLedger } from "./lib/scoring.js";
import { limitsOf, turnsFor } from "./lib/gameConfig.js";

export const KINDS = ["clover", "orchid", "bee"];

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What programs may read as GAME, plus "ms": each program's own compute budget per call.
 *  (Flowers can't tell which round it is; bees can, from MEMORY.) */
export function gameInfo(config, nTeams) {
  const { maxLen, maxNodes } = limitsOf(config);
  return {
    turns: turnsFor(config, nTeams), feed_cost: config.feedCost, challenge_type: config.challengeType,
    response_type: config.responseType, max_len: maxLen, max_nodes: maxNodes, flowers: 2 * nTeams,
  };
}

// Responses can be big trees and graphs; this caps the JSON text of any single value.
const MAX_CHARS = 262144;

/** Setup for a flower process. */
const flowerSetup = (config, kind, code, game) => ({
  code, ms: config.budgets[kind].ms, game: { ...game, ms: config.budgets[kind].ms }, maxChars: MAX_CHARS,
});
const MAX_LOG = 4000;

// Compute budgets are a costly signal (clovers get 3× an orchid's), so timing must be fair: never run
// more programs at once than there are CPU cores, across every round this process is simulating.
// Each program then has a core to itself, and its wall-clock time limit is effectively a CPU limit.
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

// A flower is stateless, so any of a few identical processes can answer for it: popular clovers that
// many bees question at once don't queue behind one process.
const FLOWER_POOL = Math.max(1, Number(process.env.FLOWER_POOL) || 2);
class FlowerPool {
  constructor(language, setup) {
    this.procs = Array.from({ length: FLOWER_POOL }, () => new ProgramProcess(language, "flower", setup));
    this.pending = this.procs.map(() => 0);
    this.ready = Promise.all(this.procs.map((p) => p.ready)).then((r) => r[0]);
  }
  async call(obj) {
    let i = 0;
    for (let j = 1; j < this.procs.length; j++) if (this.pending[j] < this.pending[i]) i = j;
    this.pending[i]++;
    try {
      return await withCpu(() => this.procs[i].call(obj));
    } finally {
      this.pending[i]--;
    }
  }
  kill() { for (const p of this.procs) p.kill(); }
}

/**
 * teams: [{ id, programs: { clover, orchid, bee }, memory?: (string|null)[] }] in a stable order.
 *   memory[k] is the bee's snapshot from round k+1 (null when nothing was kept).
 * Returns { visits, feeds, nectar, problems, memories, turns }, ledgers indexed like `teams`.
 *   memories[i] = { snapshot: string|null, bytes, note } — what this round leaves for the next.
 */
export async function simulateRound({ config, teams, seed }) {
  const n = teams.length;
  const cType = parseType(config.challengeType);
  const rType = parseType(config.responseType);
  const limits = limitsOf(config);
  const game = gameInfo(config, n);
  const TURNS = game.turns;
  const memoryBytes = config.beeMemoryKb * 1024;
  const flowers = teams.flatMap((t, ti) => ["clover", "orchid"].map((kind) => ({ team: ti, kind, code: t.programs[kind] })));
  const killers = [];
  const problems = teams.map(() => ({ clover: null, orchid: null, bee: null }));
  const memories = teams.map(() => ({ snapshot: null, bytes: 0, note: null }));

  try {
    for (const f of flowers) {
      f.pool = new FlowerPool(config.language, flowerSetup(config, f.kind, f.code, game));
      f.times = [];        // milliseconds per answered call: do clovers spend their compute as a signal?
      f.firstError = null;
      killers.push(f.pool);
    }
    const bees = teams.map((t, ti) => {
      const proc = new ProgramProcess(config.language, "bee", {
        code: t.programs.bee, ms: config.budgets.bee.ms, seed: (seed + 7919 * (ti + 1)) >>> 0, game: { ...game, ms: config.budgets.bee.ms },
        maxChars: MAX_CHARS, memory: t.memory || [],
      });
      killers.push(proc);
      return proc;
    });
    const loads = await Promise.all([...flowers.map((f) => f.pool.ready), ...bees.map((b) => b.ready)]);
    flowers.forEach((f, i) => { if (!loads[i].ok) problems[f.team][f.kind] = loads[i].e; });
    bees.forEach((_, ti) => { const r = loads[flowers.length + ti]; if (!r.ok) problems[ti].bee = r.e; });

    function ask(flower, c) {
      const t0 = performance.now();
      return flower.pool.call({ c }).then((res) => {
        flower.times.push(performance.now() - t0);
        const bad = res.e || checkValue(rType, res.v, limits, "response");
        if (bad) { flower.firstError ??= bad; return { r: null, flowerError: bad }; }
        return { r: res.v };
      });
    }

    const runBee = async (ti) => {
      const bee = bees[ti];
      const callBee = (obj) => withCpu(() => bee.call(obj));
      const rand = mulberry32((seed ^ Math.imul(ti + 1, 2654435761)) >>> 0);
      let deck = [];
      const draw = () => {
        if (!deck.length) {
          deck = flowers.map((_, i) => i);
          for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        }
        return deck.pop();
      };
      const visits = [];
      let turns = TURNS, logLen = 0;
      const note = (visit, text) => {
        if (!text || logLen >= MAX_LOG) return;
        const t = text.slice(0, MAX_LOG - logLen);
        logLen += t.length;
        visit.beeLog = (visit.beeLog || "") + t;
      };
      if (problems[ti].bee) return visits;
      while (turns > 0 && !bee.dead) {
        const flower = flowers[draw()];
        const visit = { bee: ti, patch: flower.team, kind: flower.kind, start: TURNS - turns, steps: [], action: null, nectar: null };
        let fed = false, step = null, first = true;
        for (;;) {
          const res = await callBee({ op: "forage", new: first, step, turns, visit: { fed, nectar: visit.nectar } });
          first = false;
          step = null;
          note(visit, res.out);
          let action = res.a, err = res.e || null;
          if (!err) {
            if (Array.isArray(action) && action.length === 2 && action[0] === "ask") action = "ask";
            else if (action !== "feed" && action !== "leave") err = `forage must return ["ask", challenge], "feed" or "leave" (got ${JSON.stringify(res.a)?.slice(0, 60)})`;
          }
          if (err) { // any mistake costs a turn and ends the visit, so a broken bee always runs out
            turns -= 1;
            if (!fed) visit.action = "error";
            visit.beeError = err.slice(0, 300);
            break;
          }
          if (action === "ask") {
            turns -= 1;
            const c = res.a[1];
            const bad = checkValue(cType, c, limits, "challenge");
            const s = bad ? { c, r: null, challengeError: bad } : { c, ...(await ask(flower, c)) };
            if (fed) s.after = true; // asked after feeding
            visit.steps.push(s);
            step = [c, s.r];
            if (turns <= 0) { if (!fed) visit.action = "leave"; break; }
            continue;
          }
          if (action === "feed" && fed) break; // one feed per visit: after feeding, anything but an ask moves on
          if (action === "feed") {
            if (!visit.steps.length) { turns -= 1; visit.action = "error"; visit.beeError = "must ask at least once before feeding"; break; }
            if (turns < config.feedCost) { visit.action = "leave"; visit.note = "not enough turns left to feed"; break; }
            turns -= config.feedCost;
            fed = true;
            visit.action = "feed";
            visit.nectar = flower.kind === "clover";
            const t = await callBee({ op: "tasted", nectar: visit.nectar });
            note(visit, t.out);
            if (t.e) visit.beeError = ("tasted: " + t.e).slice(0, 300);
            if (turns <= 0) break;
            continue; // it may keep asking this flower, or leave
          }
          // leave: free once you've looked; a glance with no questions still costs a turn
          if (!visit.steps.length) turns -= 1;
          if (!fed) visit.action = "leave";
          break;
        }
        visit.end = TURNS - turns;
        visits.push(visit);
      }
      if (bee.dead && !problems[ti].bee) problems[ti].bee = bee.dead;
      if (!problems[ti].bee) problems[ti].bee = visits.find((v) => v.beeError)?.beeError ?? null;
      if (memoryBytes > 0 && !bee.dead) {
        const snap = await withCpu(() => bee.call({ op: "snapshot", maxBytes: memoryBytes }, 10000));
        if (snap.e) memories[ti].note = "memory not saved: " + snap.e;
        else memories[ti] = { snapshot: snap.snap ?? null, bytes: snap.snap ? Buffer.byteLength(snap.snap) : 0, note: snap.note ?? null };
      } else if (bee.dead) {
        memories[ti].note = "the bee stopped responding, so nothing was kept this round";
      }
      return visits;
    };

    const perBee = await Promise.all(teams.map((_, ti) => runBee(ti)));
    const feeds = zeroLedger(n), nectar = zeroLedger(n);
    const visits = [];
    perBee.forEach((vs, ti) => vs.forEach((v, k) => {
      visits.push({ ...v, seq: k });
      if (v.action === "feed") { feeds[ti][v.patch]++; if (v.nectar) nectar[ti][v.patch]++; }
    }));
    // Flower runtime errors (first one per flower) are reported privately to the owner.
    for (const f of flowers) if (!problems[f.team][f.kind] && f.firstError) problems[f.team][f.kind] = f.firstError;
    // Compute used per flower (wall ms per call, including ~1-3 ms of process overhead).
    const compute = teams.map(() => ({ clover: null, orchid: null }));
    for (const f of flowers) {
      if (!f.times.length) continue;
      const sorted = [...f.times].sort((a, b) => a - b);
      compute[f.team][f.kind] = {
        calls: sorted.length,
        meanMs: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1),
        p90Ms: +sorted[Math.floor(0.9 * (sorted.length - 1))].toFixed(1),
        budgetMs: config.budgets[f.kind].ms,
      };
    }
    return { visits, feeds, nectar, problems, memories, compute, turns: TURNS };
  } finally {
    for (const k of killers) k.kill();
  }
}

/** Run a flower program on a list of challenges (for the "try it" tool). */
export async function tryFlower({ config, code, kind, challenges, nTeams = 2 }) {
  const cType = parseType(config.challengeType), rType = parseType(config.responseType);
  const limits = limitsOf(config);
  const proc = new ProgramProcess(config.language, "flower", flowerSetup(config, kind, code, gameInfo(config, nTeams)));
  try {
    const load = await proc.ready;
    if (!load.ok) return { error: load.e, results: [] };
    const results = [];
    for (const c of challenges.slice(0, 50)) {
      const bad = checkValue(cType, c, limits, "challenge");
      if (bad) { results.push({ c, r: null, error: bad }); continue; }
      const res = await withCpu(() => proc.call({ c }));
      if (res.e) results.push({ c, r: null, error: res.e });
      else {
        const badR = checkValue(rType, res.v, limits, "response");
        results.push(badR ? { c, r: null, error: badR } : { c, r: res.v });
      }
    }
    return { results };
  } finally {
    proc.kill();
  }
}
