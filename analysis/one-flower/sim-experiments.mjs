#!/usr/bin/env node
// Experiment 2: equilibrium questions on the offline model (sim.mjs), thousands of games, no LLM calls.
//   node analysis/one-flower/sim-experiments.mjs [--seeds 40] [--only e3]
// Every table is the mean over `seeds` games with the same seeds across the rows of a table (common random
// numbers). Unless a row says otherwise: N = 6 teams, 600 rounds (a 2-minute game), feedCost 10, every team has
// a keyed handshake (E = 156,299, the measured MAC flower), gives its own bee 50% and rivals 30%, shows a unique
// unforgeable label (a signature), and runs the greedy bee. Team 0 is the deviant.
import { meanScores, team, E_MIN, E_MAC, E_POW } from "./sim.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg("--seeds", 40));
const ONLY = arg("--only", null);
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);
function table(head, rows) {
  console.log("| " + head.join(" | ") + " |");
  console.log("|" + head.map(() => "---").join("|") + "|");
  for (const r of rows) console.log("| " + r.join(" | ") + " |");
  console.log();
}
const pop = (N, o = {}) => Array.from({ length: N }, (_, i) => team({ label: "sig" + i, ...o }));
const othersMean = (res, k = "fitness") => res.slice(1).reduce((s, x) => s + x[k], 0) / (res.length - 1);
const run = (teams, opts = {}) => meanScores(teams, { seeds: SEEDS, ...opts });
const want = (k) => !ONLY || ONLY.split(",").includes(k);

// ---------------------------------------------------------------------------------------------------------
if (want("e1")) {
  console.log("### E1. One deviant bee among greedy bees (N = 6)\n");
  const rows = [];
  for (const R of [600, 3000]) {
    const devs = [
      ["greedy (the population's own)", {}],
      ["naive: feeds at every flower", { bee: "naive" }],
      ["self only: feeds only at its own flower", { bee: "selfOnly" }],
      ["thresh 20: own flower, and labels paying >= 20%", { bee: "thresh", theta: 20 }],
      ["greedy, but never at its own flower", { noSelf: true }],
      ["never feeds", { bee: "never" }],
      ["greedy, no handshake (can't recognise its own flower)", { handshake: false }],
      ["greedy, gives its own bee 100% (keeps no pollen from it)", { pOwn: 100 }],
      ["greedy, flower gives everyone 100%", { pOwn: 100, pRival: 100 }],
    ];
    for (const [name, o] of devs) {
      const teams = pop(6); teams[0] = { ...teams[0], ...o };
      const res = run(teams, { R, seeds: R > 1000 ? Math.max(8, SEEDS / 4) : SEEDS });
      const d = res[0];
      rows.push([R, name, f3(d.fitness), f3(othersMean(res)), f3(d.pollinationShare * 6), f3(d.forageShare * 6), f1(d.feeds), f1(d.selfFeeds), f2(d.rivalFeedRate), f1(d.fedByRivals)]);
    }
  }
  table(["rounds", "team 0's bee", "fitness", "others' mean", "pollination share ×N", "forage share ×N", "feeds", "self-feeds", "rival feed rate", "rival bees' feeds at team 0"], rows);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e2")) {
  console.log("### E2. Number of teams: do greedy bees feed at rivals, and does staying home pay?\n");
  const rows = [];
  for (const N of [2, 3, 4, 6, 8]) {
    const base = run(pop(N));
    const selfOnly = pop(N); selfOnly[0] = { ...selfOnly[0], bee: "selfOnly" };
    const so = run(selfOnly);
    const naive = pop(N); naive[0] = { ...naive[0], bee: "naive" };
    const nv = run(naive);
    rows.push([N, f2(base[0].rivalFeedRate), f1(base[0].feeds), f1(base[0].selfFeeds), f3(so[0].fitness), f3(othersMean(so)), f3(nv[0].fitness), f3(othersMean(nv))]);
  }
  table(["N", "greedy bee: rival feed rate", "feeds", "self-feeds", "self-only deviant: fitness", "others", "naive deviant: fitness", "others"], rows);
}

// ---------------------------------------------------------------------------------------------------------
// The percent a flower gives rival bees: team 0 sweeps its pRival against a population at p0; best response.
const GRID = [0, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80];
function bestResponse(world, p0, R = 600) {
  const out = [];
  for (const p of GRID) {
    const teams = world(p0); teams[0] = { ...teams[0], pRival: p };
    const res = run(teams, { R });
    out.push({ p, fit: res[0].fitness, fedBy: res[0].fedByRivals });
  }
  const best = out.reduce((a, b) => (b.fit > a.fit ? b : a));
  return { out, best };
}
if (want("e3")) {
  console.log("### E3. The percent offered to rival bees: best response of team 0 to a population at p0\n");
  const worlds = {
    "signatures, greedy bees": (p0) => pop(6, { pRival: p0 }),
    "no signals (one shared label), greedy bees": (p0) => pop(6, { pRival: p0, label: "anon" }),
    "signatures, naive bees (feed everywhere)": (p0) => pop(6, { pRival: p0, bee: "naive" }),
    "signatures, thresh-20 bees": (p0) => pop(6, { pRival: p0, bee: "thresh", theta: 20 }),
  };
  const rows = [];
  for (const [name, world] of Object.entries(worlds)) {
    // Iterate the best response from p0 = 30 until it repeats (at most 5 steps).
    let p0 = 30;
    const path = [p0];
    let last = null;
    for (let k = 0; k < 5; k++) {
      last = bestResponse(world, p0);
      if (last.best.p === p0) break;
      p0 = last.best.p;
      path.push(p0);
    }
    const curve = last.out.map((x) => `${x.p}:${x.fit.toFixed(2)}`).join(" ");
    rows.push([name, path.join(" → "), `${last.best.p}`, curve]);
  }
  table(["world", "best-response path from 30", "fixed point", "team 0's fitness by its percent, at the fixed point (p:fitness)"], rows);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e4")) {
  console.log("### E4. The percent a flower gives its own bee (self-feeds through the handshake)\n");
  const rows = [];
  for (const p of [0, 10, 25, 40, 50, 60, 75, 90, 100]) {
    const teams = pop(6); teams[0] = { ...teams[0], pOwn: p };
    const res = run(teams);
    rows.push([p, f3(res[0].fitness), f3(res[0].pollinationShare * 6), f3(res[0].forageShare * 6), f1(res[0].selfFeeds)]);
  }
  table(["pOwn", "fitness", "pollination share ×N", "forage share ×N", "self-feeds"], rows);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e5")) {
  console.log("### E5. Mimicry: a stingy flower (5%) wearing a generous flower's label (team 1, 50%)\n");
  const rows = [];
  const cases = [
    ["stingy, its own unique label", { label: "sig0" }],
    ["stingy, copies team 1's label exactly", { label: "sig1" }],
    ["stingy; no flower has a signal (all show one label)", { label: "anon" }, "anon"],
    ["stingy, a fresh label every round (whitewashing)", { labelAt: (r) => "w" + r }],
  ];
  for (const prior of [30, 5]) {
    for (const [name, o, all] of cases) {
      const teams = pop(6, all ? { label: all } : {}); teams[1] = { ...teams[1], pRival: 50 }; teams[0] = { ...teams[0], pRival: 5, ...o };
      const res = run(teams, { prior });
      rows.push([prior, name, f3(res[0].fitness), f1(res[0].fedByRivals), f3(res[1].fitness), f1(res[1].fedByRivals), f3((res[2].fitness + res[3].fitness + res[4].fitness + res[5].fitness) / 4)]);
    }
  }
  table(["bees' prior for an unknown label (%)", "team 0 (stingy, 5%)", "team 0 fitness", "rival feeds at team 0", "team 1 (generous, 50%) fitness", "rival feeds at team 1", "teams 2–5 mean"], rows);

  console.log("#### E5b. The generous flower rotates its signal every T = 100 rounds; the mimic copies each new one after a lag L\n");
  const rows2 = [];
  const T = 100;
  for (const L of [0, 10, 25, 50, 100, Infinity]) {
    const teams = pop(6);
    teams[1] = { ...teams[1], pRival: 50, labelAt: (r) => "g" + Math.floor(r / T) };
    teams[0] = { ...teams[0], pRival: 5, labelAt: (r) => (r - L >= 0 && Number.isFinite(L) ? "g" + Math.floor((r - L) / T) : "m") };
    const res = run(teams);
    rows2.push([Number.isFinite(L) ? L : "never copies", f3(res[0].fitness), f1(res[0].fedByRivals), f3(res[1].fitness), f1(res[1].fedByRivals)]);
  }
  const still = pop(6); still[1] = { ...still[1], pRival: 50 }; still[0] = { ...still[0], pRival: 5, label: "m" };
  const rs = run(still);
  rows2.push(["(no rotation, no copying)", f3(rs[0].fitness), f1(rs[0].fedByRivals), f3(rs[1].fitness), f1(rs[1].fedByRivals)]);
  table(["copy lag L (rounds)", "mimic fitness", "rival feeds at mimic", "generous fitness", "rival feeds at generous"], rows2);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e6")) {
  console.log("### E6. Proof of work: the same flower with 85% of its CPU burned (E 24,474 instead of 156,299)\n");
  const rows = [];
  const cases = [
    ["signatures everywhere; team 0 cheap (MAC flower)", pop(6), {}],
    ["signatures everywhere; team 0 burns 85% on proof of work", pop(6), { E: E_POW }],
    ["signatures everywhere; team 0 minimal, no handshake (E 162,721)", pop(6), { E: E_MIN, handshake: false }],
    ["no signals but team 0's; team 0 generous (50%), cheap signature", pop(6, { label: "anon" }), { label: "sig0", pRival: 50 }],
    ["no signals but team 0's; team 0 generous (50%), proof-of-work signal", pop(6, { label: "anon" }), { label: "pow", pRival: 50, E: E_POW }],
    ["no signals; team 0 stingy (5%) does the same proof of work (an honest understudy)", pop(6, { label: "anon" }), { label: "pow", pRival: 5, E: E_POW }],
  ];
  for (const [name, teams, o] of cases) {
    teams[0] = { ...teams[0], ...o };
    const res = run(teams);
    rows.push([name, f3(res[0].fitness), f3(othersMean(res)), f1(res[0].fedByRivals), f3(res[0].pollinationShare * 6), f3(res[0].forageShare * 6)]);
  }
  table(["case", "team 0 fitness", "others' mean", "rival feeds at team 0", "pollination share ×N", "forage share ×N"], rows);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e7")) {
  console.log("### E7. Autarky: does a world of self-feeders hold? (rows: everyone plays the row; team 0 deviates)\n");
  const rows = [];
  const worlds = [
    ["everyone self-only (handshake), p to rivals 30", pop(6, { bee: "selfOnly" })],
    ["everyone self-only, flowers give rivals 0", pop(6, { bee: "selfOnly", pRival: 0 })],
    ["everyone greedy, no signals (one shared label), rivals get 0", pop(6, { label: "anon", pRival: 0 })],
  ];
  for (const [name, base] of worlds) {
    const b = run(base);
    for (const [dname, o] of [["greedy bee", { bee: "greedy" }], ["naive bee", { bee: "naive" }], ["greedy, flower pays rivals 50%", { bee: "greedy", pRival: 50 }]]) {
      const teams = base.map((t) => ({ ...t })); teams[0] = { ...teams[0], ...o };
      const res = run(teams);
      rows.push([name, f3(b[0].fitness), dname, f3(res[0].fitness), f3(othersMean(res))]);
    }
  }
  table(["world", "fitness (all alike)", "team 0 deviates to", "team 0 fitness", "others' mean"], rows);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e8")) {
  console.log("### E8. The proposed flower-constancy rule: pollen counts only if the bee's next feed is at the same species\n");
  const rows = [];
  const RULES = [false, true, "reward"];
  const ruleName = (c) => (c === "reward" ? "constancy + delivery pays the bee" : c ? "constancy" : "today");
  for (const constancy of RULES) {
    for (const [name, o] of [["greedy (the population's own)", {}], ["naive", { bee: "naive" }], ["self only", { bee: "selfOnly" }], ["greedy, never at its own flower", { noSelf: true }]]) {
      const teams = pop(6); teams[0] = { ...teams[0], ...o };
      const res = run(teams, { constancy });
      const d = res[0];
      rows.push([ruleName(constancy), name, f3(d.fitness), f3(othersMean(res)), f1(d.feeds), f1(d.selfFeeds), f2(d.rivalFeedRate), f2(d.delivered), f2(d.rivalDelivered), f2(othersMean(res, "rivalDelivered"))]);
    }
  }
  table(["rule", "team 0's bee", "fitness", "others' mean", "feeds", "self-feeds", "rival feed rate", "team 0's pollen that counts", "of it, from rival bees", "others: rival pollen that counts"], rows);

  console.log("#### E8b. Mimicry under each rule (bees' prior 30%; team 1 generous at 50%, team 0 stingy at 5%)\n");
  const rows2 = [];
  for (const constancy of RULES) {
    for (const [name, o] of [["stingy, its own label", { label: "sig0" }], ["stingy, copies team 1's label", { label: "sig1" }]]) {
      const teams = pop(6); teams[1] = { ...teams[1], pRival: 50 }; teams[0] = { ...teams[0], pRival: 5, ...o };
      const res = run(teams, { constancy });
      rows2.push([ruleName(constancy), name, f3(res[0].fitness), f1(res[0].fedByRivals), f3(res[1].fitness), f1(res[1].fedByRivals), f2(res[1].rivalDelivered)]);
    }
  }
  table(["rule", "team 0", "team 0 fitness", "rival feeds at team 0", "team 1 (generous) fitness", "rival feeds at team 1", "team 1's rival pollen that counts"], rows2);

  console.log("#### E8c. Team 0's percent to rival bees against a population at 30%, under each rule\n");
  const rows3 = [];
  for (const constancy of RULES) {
    const cells = [];
    for (const p of [0, 10, 20, 30, 40, 50, 60, 80]) {
      const teams = pop(6); teams[0] = { ...teams[0], pRival: p };
      cells.push(`${p}:${run(teams, { constancy })[0].fitness.toFixed(2)}`);
    }
    rows3.push([ruleName(constancy), cells.join(" ")]);
  }
  table(["rule", "team 0's fitness by its percent to rivals (p:fitness)"], rows3);
}

// ---------------------------------------------------------------------------------------------------------
if (want("e9")) {
  console.log("### E9. Self-incompatibility: pollen given to a flower's own bee never counts (with and without constancy)\n");
  const rows = [];
  for (const [rname, opts] of [["today", {}], ["self-incompatible", { selfSterile: true }], ["constancy + self-incompatible", { constancy: true, selfSterile: true }], ["constancy + delivery pays the bee + self-incompatible", { constancy: "reward", selfSterile: true }]]) {
    const base = run(pop(6), opts)[0];
    const devs = {};
    for (const [k, o] of [["naive", { bee: "naive" }], ["self only", { bee: "selfOnly" }]]) { const t = pop(6); t[0] = { ...t[0], ...o }; devs[k] = run(t, opts)[0].fitness; }
    const curve = [0, 10, 30, 50, 70].map((p) => { const t = pop(6); t[0] = { ...t[0], pRival: p }; return `${p}:${run(t, opts)[0].fitness.toFixed(2)}`; }).join(" ");
    const mim = (() => { const t = pop(6); t[1] = { ...t[1], pRival: 50 }; t[0] = { ...t[0], pRival: 5, label: "sig1" }; const r = run(t, opts); return `${r[0].fitness.toFixed(2)} / ${r[1].fitness.toFixed(2)}`; })();
    const own = (() => { const t = pop(6); t[1] = { ...t[1], pRival: 50 }; t[0] = { ...t[0], pRival: 5 }; const r = run(t, opts); return `${r[0].fitness.toFixed(2)} / ${r[1].fitness.toFixed(2)}`; })();
    rows.push([rname, f2(base.rivalFeedRate), f1(base.selfFeeds) + " / " + f1(base.feeds), f2(base.rivalDelivered), f3(devs.naive), f3(devs["self only"]), curve, own, mim]);
  }
  table(["rule", "greedy bee: rival feed rate", "self-feeds / feeds", "rival pollen that counts", "naive deviant", "self-only deviant", "team 0's fitness by its % to rivals (vs 30%)", "stingy 5% own label: stingy / generous fitness", "stingy 5% mimic: stingy / generous fitness"], rows);
}

// ---------------------------------------------------------------------------------------------------------
// The user's theory: a cooperator keeps moving its signal; a lean imitator follows with a lag.
// Team 1 = cooperator C (50% to rivals), team 0 = imitator I (5%, a lean 40-node flower), teams 2–5 at 30%.
const Eof = (size) => (1100 - size) * 149.3;
function dynamic({ T = Infinity, Li = 0, copies = true, pI = 5, pC = 50, Sc = 60, Si = 40 }) {
  const teams = pop(6);
  const cLabel = (r) => (Number.isFinite(T) ? "c" + Math.floor(r / T) : "c0");
  teams[1] = { ...teams[1], pRival: pC, E: Eof(Sc), label: undefined, labelAt: cLabel };
  teams[0] = { ...teams[0], pRival: pI, E: Eof(Si), label: undefined, labelAt: (r) => (copies && r - Li >= 1 ? cLabel(r - Li) : "i") };
  return teams;
}
if (want("e10")) {
  console.log("### E10. The user's dynamic: a moving cooperator (50%) and a lean imitator (5%) that copies its signal after a lag\n");
  console.log("T = rounds between the cooperator's signal changes; L_i = the imitator's copy lag; L_b = rounds rival bees need to learn a new signal family (5 rounds = 1 s).\n");
  const rows = [];
  for (const R of [1500, 3000]) {
    const cases = [
      ["no imitation (its own label, or C signs)", { copies: false }, 0],
      ["static signal, copied from the start", {}, 0],
      ["C moves every 150 (30 s); runtime mimic, lag 1; bees recognise at once", { T: 150, Li: 1 }, 0],
      ["C moves every 150; copy lag 150 (30 s); bees recognise at once", { T: 150, Li: 150 }, 0],
      ["C moves every 150; copy lag 150; bees also need 150", { T: 150, Li: 150 }, 150],
      ["C moves every 500 (100 s); copy lag 300 (60 s); bees at once", { T: 500, Li: 300 }, 0],
      ["C moves every 500; copy lag 300; bees also need 300", { T: 500, Li: 300 }, 300],
      ["static signal copied; C's signal costs 400 nodes, I's copy 40", { Sc: 400 }, 0],
      ["no imitation; C's signal costs 400 nodes", { copies: false, Sc: 400 }, 0],
    ];
    for (const [name, o, Lb] of cases) {
      const res = run(dynamic(o), { R, learnLag: Lb, seeds: Math.max(10, SEEDS / 2) });
      rows.push([R === 1500 ? "5 min" : "10 min", name, f3(res[1].fitness), f1(res[1].fedByRivals), f3(res[0].fitness), f1(res[0].fedByRivals), f3(othersMean(res.slice(1).concat([]), "fitness"))]);
    }
  }
  table(["game", "case", "cooperator fitness", "rival feeds at C", "imitator fitness", "rival feeds at I"], rows.map((r) => r.slice(0, 6)));

  console.log("#### E10b. When bees learn a new signal as slowly as imitators copy it, a moving cooperator is a newcomer: valued at the bees' prior for unknown signals, which a stingy flower with a fresh signal every round (a whitewasher, 5%) exploits too (5 min, T = L_b = 150)\n");
  const rows2 = [];
  for (const prior of [30, 15, 5]) {
    const mover = run(dynamic({ T: 150, copies: false }), { R: 1500, learnLag: 150, prior, seeds: Math.max(10, SEEDS / 2) });
    const ww = dynamic({ T: 150, copies: false }); ww[0] = { ...ww[0], labelAt: (r) => "w" + r };
    const wres = run(ww, { R: 1500, learnLag: 150, prior, seeds: Math.max(10, SEEDS / 2) });
    const still = run(dynamic({ copies: false }), { R: 1500, learnLag: 150, prior, seeds: Math.max(10, SEEDS / 2) });
    rows2.push([prior, f3(still[1].fitness), f3(mover[1].fitness), f3(mover[0].fitness), f3(wres[1].fitness), f3(wres[0].fitness)]);
  }
  table(["bees' prior for an unknown signal (%)", "C static, no imitator", "C moving, no imitator", "stingy flower, own static signal", "C moving, stingy whitewasher present", "whitewasher fitness"], rows2);
}

if (want("e11")) {
  console.log("### E11. Partial defection: an imitator wearing the cooperator's (static) signal, by the percent it pays\n");
  const rows = [];
  for (const pI of [0, 5, 10, 20, 30, 40, 50]) {
    const res = run(dynamic({ pI }), { R: 1500 });
    rows.push([pI, f3(res[0].fitness), f1(res[0].fedByRivals), f3(res[1].fitness), f1(res[1].fedByRivals)]);
  }
  const alone = run(dynamic({ copies: false }), { R: 1500 });
  rows.push(["(own label, 5%)", f3(alone[0].fitness), f1(alone[0].fedByRivals), f3(alone[1].fitness), f1(alone[1].fedByRivals)]);
  table(["imitator's percent", "imitator fitness", "rival feeds at imitator", "cooperator (50%) fitness", "rival feeds at cooperator"], rows);
}

if (want("e12")) {
  console.log("### E12. Selfing: own cells counted (today), excluded, or self-pollination discounted (×0.25)\n");
  const VARIANTS = [
    ["counted (today)", {}],
    ["own cells excluded", { selfW: { poll: 0, forage: 0 } }],
    ["own cells excluded, smoothed shares (ε = 300)", { selfW: { poll: 0, forage: 0 }, eps: 300 }],
    ["self-pollination ×0.25", { selfW: { poll: 0.25, forage: 1 } }],
    ["self-pollination ×0.25, smoothed shares (ε = 300)", { selfW: { poll: 0.25, forage: 1 }, eps: 300 }],
    ["counted, smoothed shares (ε = 300)", { eps: 300 }],
  ];
  const hetero = () => {
    // flowers 60, 60, 30, 30, 5, 5 to rivals; bees greedy / naive alternating; all with handshakes.
    const ps = [60, 60, 30, 30, 5, 5];
    return ps.map((p, i) => team({ label: "sig" + i, pRival: p, bee: i % 2 ? "naive" : "greedy" }));
  };
  const rows = [];
  for (const [name, opts] of VARIANTS) {
    const base = run(pop(6), opts)[0];
    const dev = (o) => { const t = pop(6); t[0] = { ...t[0], ...o }; return run(t, opts)[0].fitness; };
    const h = run(hetero(), opts).map((x) => x.fitness);
    const spread = Math.max(...h) - Math.min(...h);
    rows.push([name, f1(base.selfFeeds) + " / " + f1(base.feeds), f2(base.rivalFeedRate), f3(dev({ pOwn: 0 })), f3(dev({ bee: "selfOnly", pOwn: 0 })), f3(dev({ noSelf: true })), h.map((x) => x.toFixed(2)).join(" "), f2(spread)]);
  }
  table(["scoring", "greedy bee: self-feeds / feeds", "rival feed rate", "deviant gives own bee 0%", "deviant self-only at 0%", "deviant never self-feeds", "mixed population fitness (60g 60n 30g 30n 5g 5n)", "spread (max − min)"], rows);
}
