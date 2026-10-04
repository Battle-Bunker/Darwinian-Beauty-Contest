#!/usr/bin/env node
// Experiment 3: scripted bots playing each other on the real engine (server/engine.js Garden: the real Python
// runner, CPU-timed flowers, 50 ms bee deadlines, lockstep rounds, uniform draws), unpaced (rounds back to
// back; game time is unchanged), with no database and no server. No LLM calls.
//   DBC_ROOT=<checkout at 2661f14> node analysis/one-flower/games.mjs [--rounds 600] [--only g1,g3]
// Programs use the ledger argument of 2661f14 (bots.mjs). Scores: fitness = N² × pollination share × forage
// share, computed here from the drained ledgers and cross-checked against the engine's own score().
import { flowerCode, beeCode } from "./bots.mjs";
import { fitnessAll } from "./sim.mjs";

const ROOT = process.env.DBC_ROOT ? `file://${process.env.DBC_ROOT.replace(/\/?$/, "/")}` : new URL("../../", import.meta.url).href;
const { Garden } = await import(new URL("server/engine.js", ROOT).href);
const { normalizeConfig } = await import(new URL("server/lib/gameConfig.js", ROOT).href);
const { score } = await import(new URL("server/lib/scoring.js", ROOT).href);

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 600));
const REPS = Number(arg("--reps", 5));
const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
/** The same game REPS times (draws are Math.random); each numeric field averaged, plus the fitness sd. */
async function playReps(name, teams, rounds = ROUNDS) {
  const runs = [];
  for (let k = 0; k < REPS; k++) runs.push(await play(`${name}#${k + 1}`, teams, rounds));
  const rows = runs[0].rows.map((r0, i) => {
    const o = { team: r0.team };
    for (const key of Object.keys(r0)) if (key !== "team") { const xs = runs.map((r) => r.rows[i][key]).filter((x) => typeof x === "number"); o[key] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
    o.fitnessSd = sd(runs.map((r) => r.rows[i].fitness));
    o.tooSlow = runs.reduce((s, r) => s + r.rows[i].tooSlow, 0);
    return o;
  });
  return { name, rows, reps: REPS };
}
const ONLY = arg("--only", null);
const want = (k) => !ONLY || ONLY.split(",").includes(k);
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f3 = (x) => (x === null || x === undefined ? "–" : x.toFixed(3));
const f1 = (x) => (x === null || x === undefined ? "–" : x.toFixed(1));
const K = [101, 2003, 30007, 400009, 500029, 600011, 700001, 800011];
const KEYS = ["ka7Q", "kB2x", "kc9R", "kD4m", "ke6T", "kF1z", "kg8W", "kH3p"];

async function play(name, teams, rounds = ROUNDS) {
  const config = normalizeConfig({ language: "python", feedCost: 10 });
  const n = teams.length;
  const garden = new Garden({ config, teams: n, endMs: Infinity, maxRounds: rounds, paced: false });
  await Promise.all(teams.flatMap((t, i) => [garden.setProgram(i, "flower", t.flower, 1), garden.setProgram(i, "bee", t.bee, 1)]));
  const t0 = performance.now();
  await garden.run();
  const out = garden.drain();
  const pollen = out.pollen ?? out.surplus;
  const mine = fitnessAll(out.nectar, pollen);
  const real = score(teams.map((_, i) => i), out.feeds, out.nectar, pollen);
  real.forEach((x, i) => { if (Math.abs(x.fitness - mine[i].fitness) > 1e-9 * Math.max(1, x.fitness)) throw new Error(`score mismatch ${name} team ${i}`); });
  const ends = out.actions.filter((a) => a.action !== "arrive");
  const rows = teams.map((t, i) => {
    const atF = ends.filter((a) => a.flower === i && a.r !== null);
    const byB = ends.filter((a) => a.bee === i);
    const fed = byB.filter((a) => a.action === "feed");
    const rivalVisits = byB.filter((a) => a.flower !== i), rivalFed = rivalVisits.filter((a) => a.action === "feed");
    const fedByRivals = ends.filter((a) => a.flower === i && a.bee !== i && a.action === "feed");
    const beeMs = byB.map((a) => a.beeMs).filter((x) => typeof x === "number");
    const win = [0, 1, 2].map((w) => fedByRivals.filter((a) => a.round > (w * rounds) / 3 && a.round <= ((w + 1) * rounds) / 3).length);
    return {
      win1: win[0], win2: win[1], win3: win[2],
      team: t.name, size: garden.flowers[i]?.size, flowerMs: q(atF.map((a) => a.ms), 0.5), E: q(atF.map((a) => a.energy), 0.5),
      flowerFail: ends.filter((a) => a.flower === i && a.r === null).length,
      fedByRivals: fedByRivals.length, pctToRivals: fedByRivals.length ? fedByRivals.reduce((s, a) => s + a.percent, 0) / fedByRivals.length : null,
      beeFeeds: fed.length, selfFeeds: fed.filter((a) => a.flower === i).length, rivalFeedRate: rivalVisits.length ? rivalFed.length / rivalVisits.length : null,
      nectarPerRivalFeed: rivalFed.length ? rivalFed.reduce((s, a) => s + a.nectar, 0) / rivalFed.length : null,
      beeMs50: q(beeMs, 0.5), beeMs99: q(beeMs, 0.99), tooSlow: byB.filter((a) => /too slow/.test(a.beeError || "")).length,
      fitness: mine[i].fitness, pollS: mine[i].pollinationShare * n, forS: mine[i].forageShare * n,
    };
  });
  console.error(`${name}: ${garden.rounds} rounds, ${(performance.now() - t0) / 1000 | 0} s, problems: ${JSON.stringify(out.problems.slice(0, 3))}`);
  return { name, rows, ledger: out.actions.length };
}

function print(title, res) {
  console.log(`#### ${title}${res.reps ? ` (mean of ${res.reps} games of ${ROUNDS} rounds; too slow: total)` : ""}\n`);
  console.log("| team | flower size | flower ms (p50) | E (p50) | rival feeds at it | % to rivals | bee feeds | self-feeds | bee's rival feed rate | nectar / rival feed | bee ms p50 / p99 | too slow | pollination ×N | forage ×N | fitness |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of res.rows) console.log(`| ${r.team} | ${r.size} | ${f1(r.flowerMs)} | ${Math.round(r.E ?? 0)} | ${f1(r.fedByRivals)} | ${f1(r.pctToRivals)} | ${f1(r.beeFeeds)} | ${f1(r.selfFeeds)} | ${f3(r.rivalFeedRate)} | ${Math.round(r.nectarPerRivalFeed ?? 0)} | ${f1(r.beeMs50)} / ${f1(r.beeMs99)} | ${r.tooSlow} | ${f3(r.pollS)} | ${f3(r.forS)} | ${f3(r.fitness)}${r.fitnessSd !== undefined ? ` ± ${r.fitnessSd.toFixed(2)}` : ""} |`);
  console.log();
}

const T = (name, i, fl, be) => ({ name, flower: flowerCode({ K: K[i], ...fl }), bee: beeCode(be) });

if (want("g1")) {
  // Energy: identical naive bees (feed everywhere), so only the flowers differ.
  const res = await playReps("g1", [
    T("rule, 30%", 0, { pct: 30 }, { kind: "naive" }),
    T("rule + MAC handshake code, 30%", 1, { pct: 30, handshake: KEYS[1], pOwn: 30 }, { kind: "naive" }),
    T("proof of work 60 ms, 30%", 2, { pct: 30, kind: "pow", powMs: 60 }, { kind: "naive" }),
    T("proof of work 125 ms, 30%", 3, { pct: 30, kind: "pow", powMs: 125 }, { kind: "naive" }),
  ]);
  print("G1. Energy: the same bees, four flowers (N = 4, every bee feeds everywhere)", res);
}

if (want("g2")) {
  // Self-feeding: every flower gives rivals 30%; with a handshake it gives its own bee 50%.
  const hs = (i) => ({ pct: 30, handshake: KEYS[i], pOwn: 50 });
  const res = await playReps("g2", [
    T("handshake, greedy bee", 0, hs(0), { kind: "greedy", handshake: KEYS[0] }),
    T("handshake, self-only bee", 1, hs(1), { kind: "self", handshake: KEYS[1] }),
    T("handshake, naive bee", 2, hs(2), { kind: "naive", handshake: KEYS[2] }),
    T("no handshake, greedy bee", 3, { pct: 30 }, { kind: "greedy" }),
    T("no handshake, naive bee", 4, { pct: 30 }, { kind: "naive" }),
    T("no handshake, greedy bee", 5, { pct: 30 }, { kind: "greedy" }),
  ]);
  print("G2. Self-feeding through a keyed handshake (N = 6)", res);
}

if (want("g3")) {
  // Reputation: generous, average and stingy flowers, each with its own learnable rule; greedy vs naive bees.
  const teams = (mimic) => [
    T("60%, greedy bee", 0, { pct: 60 }, { kind: "greedy" }),
    T("60%, naive bee", 1, { pct: 60 }, { kind: "naive" }),
    T("30%, greedy bee", 2, { pct: 30 }, { kind: "greedy" }),
    T("30%, naive bee", 3, { pct: 30 }, { kind: "naive" }),
    T(mimic ? "5% MIMIC of the best-paying rule, greedy bee" : "5%, greedy bee", 4, { pct: 5, kind: mimic ? "mimic" : "rule" }, { kind: "greedy" }),
    T("5%, naive bee", 5, { pct: 5 }, { kind: "naive" }),
  ];
  print("G3a. Reputation by signal: generous, average and stingy flowers with their own rules (N = 6)", await playReps("g3a", teams(false)));
  print("G3b. The same, but team 4's stingy flower reads history and answers with the best-paying flower's rule", await playReps("g3b", teams(true)));
}

if (want("g4")) {
  console.log(`#### G4. Team 0's percent to rival bees, against five teams at 30% (all: handshake, greedy bee, own rule; N = 6; mean of ${REPS} games of ${ROUNDS} rounds)\n`);
  console.log("| team 0's % to rivals | rival feeds at team 0 | team 0 pollination ×N | team 0 forage ×N | team 0 fitness | others' mean fitness |");
  console.log("|---|---|---|---|---|---|");
  for (const p of [5, 15, 30, 50, 70]) {
    const teams = [0, 1, 2, 3, 4, 5].map((i) => T(`t${i}`, i, { pct: i === 0 ? p : 30, handshake: KEYS[i], pOwn: 50 }, { kind: "greedy", handshake: KEYS[i] }));
    const res = await playReps(`g4 p=${p}`, teams);
    const r0 = res.rows[0], others = res.rows.slice(1).reduce((s, r) => s + r.fitness, 0) / 5;
    console.log(`| ${p} | ${f1(r0.fedByRivals)} | ${f3(r0.pollS)} | ${f3(r0.forS)} | ${f3(r0.fitness)} ± ${r0.fitnessSd.toFixed(2)} | ${f3(others)} |`);
  }
  console.log();
}

if (want("g5")) {
  // A 10-minute game (3,000 rounds): how long does a bee that rebuilds everything from history take to decide?
  const hs = (i) => ({ pct: 30, handshake: KEYS[i], pOwn: 50 });
  const res = await play("g5", [0, 1, 2, 3, 4, 5].map((i) => T(`handshake, greedy bee ${i}`, i, hs(i), { kind: "greedy", handshake: KEYS[i] })), 3000);
  print(`G5. A 10-minute game (3,000 rounds): bees rebuild their state from the whole history on every call (one game, ${res.ledger} actions)`, res);
}

if (want("g6")) {
  // Partial defection, on the real engine: G3b's runtime mimic (team 4) at several percents.
  console.log(`#### G6. The runtime mimic's percent (it wears the best-paying rival rule; teams 0–1 pay 60%, 2–3 30%, 5 5%; N = 6; mean of ${REPS} games of ${ROUNDS} rounds)\n`);
  console.log("| mimic's percent | mimic fitness | rival feeds at mimic (rounds 1–200 / 201–400 / 401–600) | 60% teams' mean fitness | rival feeds at the 60% teams |");
  console.log("|---|---|---|---|---|");
  for (const p of [0, 5, 15, 30, 45]) {
    const teams = [
      T("60%, greedy bee", 0, { pct: 60 }, { kind: "greedy" }), T("60%, naive bee", 1, { pct: 60 }, { kind: "naive" }),
      T("30%, greedy bee", 2, { pct: 30 }, { kind: "greedy" }), T("30%, naive bee", 3, { pct: 30 }, { kind: "naive" }),
      T("mimic", 4, { pct: p, kind: "mimic" }, { kind: "greedy" }), T("5%, naive bee", 5, { pct: 5 }, { kind: "naive" }),
    ];
    const r = await playReps(`g6 p=${p}`, teams);
    const m = r.rows[4];
    console.log(`| ${p} | ${f3(m.fitness)} ± ${m.fitnessSd.toFixed(2)} | ${f1(m.fedByRivals)} (${f1(m.win1)} / ${f1(m.win2)} / ${f1(m.win3)}) | ${f3((r.rows[0].fitness + r.rows[1].fitness) / 2)} | ${f1(r.rows[0].fedByRivals + r.rows[1].fedByRivals)} |`);
  }
  console.log();
}

if (want("g7")) {
  // Moving: the 60% flowers derive a new rule every T rounds from a secret and the round number (no code change).
  console.log(`#### G7. Cooperators that change their rule every T rounds, against the runtime mimic at 5% (mean of ${REPS} games of ${ROUNDS} rounds)\n`);
  console.log("| cooperators' rule | 60% teams' mean fitness | rival feeds at the 60% teams | mimic fitness | rival feeds at mimic |");
  console.log("|---|---|---|---|---|");
  for (const [name, fl] of [["static (G3b)", {}], ["new rule every 20 rounds (4 s)", { kind: "rotating", rotate: 20 }], ["new rule every 5 rounds (1 s)", { kind: "rotating", rotate: 5 }]]) {
    for (const mimic of [false, true]) {
      const teams = [
        T("60%, greedy bee", 0, { pct: 60, ...fl, seed: "rotA" }, { kind: "greedy" }), T("60%, naive bee", 1, { pct: 60, ...fl, seed: "rotB" }, { kind: "naive" }),
        T("30%, greedy bee", 2, { pct: 30 }, { kind: "greedy" }), T("30%, naive bee", 3, { pct: 30 }, { kind: "naive" }),
        T("x", 4, { pct: 5, kind: mimic ? "mimic" : "rule" }, { kind: "greedy" }), T("5%, naive bee", 5, { pct: 5 }, { kind: "naive" }),
      ];
      const r = await playReps(`g7 ${name} ${mimic}`, teams);
      console.log(`| ${name}; team 4 ${mimic ? "mimics" : "has its own 5% rule"} | ${f3((r.rows[0].fitness + r.rows[1].fitness) / 2)} | ${f1(r.rows[0].fedByRivals + r.rows[1].fedByRivals)} | ${f3(r.rows[4].fitness)} ± ${r.rows[4].fitnessSd.toFixed(2)} | ${f1(r.rows[4].fedByRivals)} |`);
    }
  }
  console.log();
}
