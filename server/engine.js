// The round simulator. Pure with respect to the database: programs + config + seed in, visits out.
//
// Every team owns a patch of two flowers (clover = rewarding, orchid = deceptive) and one bee.
// Each bee gets `turns` turns. It is shown flowers drawn from a shuffled deck of all 2N flowers
// (every flower comes up once before any repeats). At each flower it may ask challenges
// (1 turn each), then feed (feedCost turns; nectar only at clovers) or leave (free).
// Bees run independently and in parallel; flowers are stateless, so order never matters.
import { ProgramProcess } from "./runners/proc.js";
import { checkValue, parseType } from "./lib/types.js";
import { zeroLedger } from "./lib/scoring.js";

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

/** What programs may read as GAME. No round number: that would let code change without spending change budget. */
export function gameInfo(config, nTeams) {
  return {
    turns: config.turns, feed_cost: config.feedCost, challenge_type: config.challengeType,
    response_type: config.responseType, max_len: config.maxLen, flowers: 2 * nTeams,
  };
}

const MAX_LOG = 4000;

/**
 * teams: [{ id, programs: { clover, orchid, bee } }] (code strings), in a stable order.
 * Returns { visits, feeds, nectar, problems }, ledgers indexed like `teams`.
 */
export async function simulateRound({ config, teams, seed }) {
  const n = teams.length;
  const cType = parseType(config.challengeType);
  const rType = parseType(config.responseType);
  const game = gameInfo(config, n);
  const flowers = teams.flatMap((t, ti) => ["clover", "orchid"].map((kind) => ({ team: ti, kind, code: t.programs[kind] })));
  const procs = [];
  const problems = teams.map(() => ({ clover: null, orchid: null, bee: null }));

  try {
    for (const f of flowers) {
      f.proc = new ProgramProcess(config.language, "flower", { code: f.code, ms: config.budgets[f.kind].ms, game });
      f.cache = new Map(); // pure functions: one answer per challenge per round
      procs.push(f.proc);
    }
    const bees = teams.map((t, ti) => {
      const proc = new ProgramProcess(config.language, "bee", { code: t.programs.bee, ms: config.budgets.bee.ms, seed: (seed + 7919 * (ti + 1)) >>> 0, game });
      procs.push(proc);
      return proc;
    });
    const loads = await Promise.all([...flowers.map((f) => f.proc.ready), ...bees.map((b) => b.ready)]);
    flowers.forEach((f, i) => { if (!loads[i].ok) problems[f.team][f.kind] = loads[i].e; });
    bees.forEach((_, ti) => { const r = loads[flowers.length + ti]; if (!r.ok) problems[ti].bee = r.e; });

    async function ask(flower, c) {
      const key = JSON.stringify(c);
      if (!flower.cache.has(key)) {
        flower.cache.set(key, flower.proc.call({ c }).then((res) => {
          if (res.e) return { r: null, flowerError: res.e };
          const bad = checkValue(rType, res.v, config.maxLen, "response");
          return bad ? { r: null, flowerError: bad } : { r: res.v };
        }));
      }
      return flower.cache.get(key);
    }

    const runBee = async (ti) => {
      const bee = bees[ti];
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
      let turns = config.turns, logLen = 0;
      const note = (visit, text) => {
        if (!text || logLen >= MAX_LOG) return;
        const t = text.slice(0, MAX_LOG - logLen);
        logLen += t.length;
        visit.beeLog = (visit.beeLog || "") + t;
      };
      if (problems[ti].bee) return visits;
      while (turns > 0 && !bee.dead) {
        const fi = draw();
        const flower = flowers[fi];
        const visit = { bee: ti, patch: flower.team, kind: flower.kind, start: config.turns - turns, steps: [], action: null, nectar: null };
        const seen = [];
        for (;;) {
          const res = await bee.call({ op: "forage", seen, turns });
          note(visit, res.out);
          let action = res.a, err = res.e || null;
          if (!err) {
            if (Array.isArray(action) && action.length === 2 && action[0] === "ask") action = "ask";
            else if (action !== "feed" && action !== "leave") err = `forage must return ["ask", challenge], "feed" or "leave" (got ${JSON.stringify(res.a)?.slice(0, 60)})`;
          }
          if (err) { // any mistake costs a turn and ends the visit, so a broken bee always runs out
            turns -= 1;
            visit.action = "error";
            visit.beeError = err.slice(0, 300);
            break;
          }
          if (action === "ask") {
            turns -= 1;
            const c = res.a[1];
            const bad = checkValue(cType, c, config.maxLen, "challenge");
            const step = bad ? { c, r: null, challengeError: bad } : { c, ...(await ask(flower, c)) };
            visit.steps.push(step);
            seen.push([c, step.r]);
            if (turns <= 0) { visit.action = "leave"; break; }
            continue;
          }
          if (action === "feed") {
            if (!seen.length) { turns -= 1; visit.action = "error"; visit.beeError = "must ask at least once before feeding"; break; }
            if (turns < config.feedCost) { visit.action = "leave"; visit.note = "not enough turns left to feed"; break; }
            turns -= config.feedCost;
            visit.action = "feed";
            visit.nectar = flower.kind === "clover";
            const t = await bee.call({ op: "tasted", seen, nectar: visit.nectar });
            note(visit, t.out);
            if (t.e) visit.beeError = ("tasted: " + t.e).slice(0, 300);
            break;
          }
          // leave: free once you've looked; a glance with no questions still costs a turn
          if (!seen.length) turns -= 1;
          visit.action = "leave";
          break;
        }
        visit.end = config.turns - turns;
        visits.push(visit);
      }
      if (bee.dead && !problems[ti].bee) problems[ti].bee = bee.dead;
      if (!problems[ti].bee) problems[ti].bee = visits.find((v) => v.beeError)?.beeError ?? null;
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
    for (const f of flowers) {
      if (problems[f.team][f.kind]) continue;
      for (const p of f.cache.values()) {
        const res = await p;
        if (res.flowerError) { problems[f.team][f.kind] = res.flowerError; break; }
      }
    }
    return { visits, feeds, nectar, problems };
  } finally {
    for (const p of procs) p.kill();
  }
}

/** Run a flower program on a list of challenges (for the "try it" tool). */
export async function tryFlower({ config, code, kind, challenges, nTeams = 2 }) {
  const cType = parseType(config.challengeType), rType = parseType(config.responseType);
  const proc = new ProgramProcess(config.language, "flower", { code, ms: config.budgets[kind].ms, game: gameInfo(config, nTeams) });
  try {
    const load = await proc.ready;
    if (!load.ok) return { error: load.e, results: [] };
    const results = [];
    for (const c of challenges.slice(0, 50)) {
      const bad = checkValue(cType, c, config.maxLen, "challenge");
      if (bad) { results.push({ c, r: null, error: bad }); continue; }
      const res = await proc.call({ c });
      if (res.e) results.push({ c, r: null, error: res.e });
      else {
        const badR = checkValue(rType, res.v, config.maxLen, "response");
        results.push(badR ? { c, r: null, error: badR } : { c, r: res.v });
      }
    }
    return { results };
  } finally {
    proc.kill();
  }
}
