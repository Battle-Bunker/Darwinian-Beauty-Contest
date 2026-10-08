// Prevalence on both sides and the feed price (server/lib/prevalence.js; RULES.md "Prevalence"). Each round
// ceil(slots × N) distinct bees are drawn without replacement with weights c(t) + B_b, and each visits a species
// drawn with weights c(t) + F_s. F_s = N × share of Σ_b (decayed pollen s gave b)^β; B_b = N × share of
// max(0, Σ_s signed (decayed net nectar b got at s)^α), net = nectar − feedPrice; both capped, every cell
// starting at a prior. Fitness is the time-average of F × B. A config from before plays as it did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prevalence, drawWeighted, sampleWithout, scoreboard } from "../server/lib/prevalence.js";
import { DEFAULT_CONFIG, emaxOf, feedPriceOf, normalizeConfig, prevalenceOf, windowMsOf } from "../server/lib/gameConfig.js";
import { play } from "./fixtures/garden.js";
import { classic } from "./fixtures/classic.js";

const close = (a, b, eps = 1e-9, what = "") => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${what} ${a} vs ${b}`);
const cfg = (prevalence, rest = {}) => normalizeConfig({ ...rest, prevalence });
const arrivals = (actions) => actions.filter((a) => a.action === "arrive");
const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
let seed = 11;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("the defaults: prevalence on (half-life 90 s, c from 1 to 0.1, cap 4, slots 0.25, prior 0.12 × Emax), a feed price of 0.05 × Emax, no sit-out; a config from before has none of it", () => {
  assert.deepEqual(DEFAULT_CONFIG.prevalence, { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null });
  const d = normalizeConfig({});
  assert.equal(emaxOf(d), 1100 * 50 * 1024, "Emax = size cap × R's cap × byte cap");
  assert.deepEqual(prevalenceOf(d), { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: 0.12 * 56320000 });
  assert.equal(feedPriceOf(d), 2816000, "about 2.8M");
  assert.deepEqual([d.feedCost, d.feedPrice], [0, null]);
  assert.equal(feedPriceOf(normalizeConfig({ feedPrice: 0 })), 0, "0: free");
  assert.equal(feedPriceOf(normalizeConfig({ feedPrice: 5000 })), 5000);
  assert.equal(feedPriceOf(normalizeConfig({ budgets: { flower: { ms: 100 } } })), 0.05 * 1100 * 100 * 1024, "the default follows the caps");
  // A config from before: no prevalence, free feeds, the window at flower.ms; it stays so when edited.
  const old = classic();
  assert.deepEqual([prevalenceOf(old), feedPriceOf(old), windowMsOf(old), old.feedCost], [null, 0, 150, 20]);
  assert.equal(prevalenceOf(normalizeConfig({ minutes: 4 }, old)), null);
  // The superseded one-sided form (no slots) plays as a config from before.
  assert.equal(prevalenceOf({ ...d, prevalence: { on: true, basis: "pollination", halfLifeS: 90, cStart: 1, cEnd: 0.1, prior: null, cap: 4 } }), null);
  const n = cfg({ halfLifeS: null, cap: null, slots: 7, cStart: -3 }).prevalence;
  assert.deepEqual([n.halfLifeS, n.cap, n.slots, n.cStart], [null, null, 1, 0], "null: cumulative and no cap; bad values clamped");
});

test("c(t) runs linearly from cStart at the start to cEnd at the end of the game, and stays there", () => {
  const m = new Prevalence(cfg({ cStart: 2, cEnd: 0.5 }, { minutes: 10 }), 3);
  for (const [t, c] of [[0, 2], [150000, 1.625], [300000, 1.25], [600000, 0.5], [1200000, 0.5]]) close(m.c(t), c, 1e-12, `c(${t})`);
  close(m.weights(300000).c, 1.25);
});

test("F_s is N × the species' share of Σ_b (pollen)^β; B_b is N × the bee's share of max(0, Σ_s signed (net nectar)^α); capped; 1 for all with no success", () => {
  const config = cfg({ halfLifeS: null, prior: 0, cap: null, cStart: 0.5, cEnd: 0.5 });
  const { alpha, beta } = config.scoring;
  const m = new Prevalence(config, 4);
  const w0 = m.weights(0);
  assert.deepEqual([w0.F, w0.B, w0.pF, w0.pB], [[1, 1, 1, 1], [1, 1, 1, 1], [0.25, 0.25, 0.25, 0.25], [0.25, 0.25, 0.25, 0.25]]);
  // feed(bee, species, pollen, net)
  m.feed(0, 1, 900, 100); m.feed(2, 1, 400, 30); m.feed(1, 2, 1000, -50); m.feed(1, 3, 10, 80);
  const qF = [0, 900 ** beta + 400 ** beta, 1000 ** beta, 10 ** beta], QF = qF.reduce((a, b) => a + b);
  const qB = [100 ** alpha, Math.max(0, 80 ** alpha - 50 ** alpha), 30 ** alpha, 0], QB = qB.reduce((a, b) => a + b);
  const { c, F, B, pF, pB } = m.weights(0);
  qF.forEach((x, s) => close(F[s], (4 * x) / QF, 1e-12, `F_${s}`));
  qB.forEach((x, b) => close(B[b], (4 * x) / QB, 1e-12, `B_${b}`));
  F.forEach((x, s) => close(pF[s], (c + x) / (4 * (c + 1)), 1e-12, `pF_${s}`));
  B.forEach((x, b) => close(pB[b], (c + x) / (4 * (c + 1)), 1e-12, `pB_${b}`));
  close(pF[0], 0.5 / 6, 1e-12, "a species nobody pollinated: c / Σ w");
});

test("signed bee success: a bee whose net nectar is negative scores 0, however much it fed; losses offset gains", () => {
  const config = cfg({ halfLifeS: null, prior: 0, cap: null });
  const m = new Prevalence(config, 3);
  m.feed(0, 0, 1e6, 5000);           // bee 0: a good feed
  for (let i = 0; i < 10; i++) m.feed(1, 2, 1e6, -2000); // bee 1: ten feeds at a stingy flower, each a net loss
  m.feed(2, 0, 1e6, 5000); m.feed(2, 1, 1e6, -5000);     // bee 2: a gain and an equal loss
  const { B } = m.weights(0);
  assert.equal(B[1], 0, "net negative: no success");
  assert.equal(B[2], 0, "|D|^α with signs: they cancel");
  assert.equal(B[0], 3, "all the success is bee 0's");
  // The cap: B_0 would be 3; capped at 2.
  const capped = new Prevalence(cfg({ halfLifeS: null, prior: 0, cap: 2 }), 3);
  capped.feed(0, 0, 1, 5000);
  const w = capped.weights(0);
  assert.deepEqual(w.B, [2, 0, 0]);
  close(w.pB[0], (w.c + 2) / (3 * w.c + 2), 1e-12, "p uses the capped weights");
});

test("decay: every cell, prior included, halves every halfLifeS of game time; rebuilding from the feeds gives the same ledgers", () => {
  const config = cfg({ halfLifeS: 1, prior: 64 }); // 200 ms rounds: halves every 5 rounds
  const m = new Prevalence(config, 2);
  const feeds = [];
  const feed = (round, bee, flower, pollen, net) => { m.feed(bee, flower, pollen, net); feeds.push({ round, bee, flower, pollen, net }); };
  for (let r = 1; r <= 20; r++) {
    m.decay();
    if (r === 3) feed(r, 0, 1, 1000, -300);
    if (r === 11) feed(r, 1, 1, 300, 50);
  }
  close(m.pollen[0][0], 64 * 2 ** -4, 1e-12, "the prior after 20 rounds = 4 half-lives");
  close(m.pollen[1][0], 64 * 2 ** -4 + 1000 * 2 ** (-17 / 5), 1e-12, "pollen species 1 gave bee 0");
  close(m.net[0][1], 64 * 2 ** -4 - 300 * 2 ** (-17 / 5), 1e-12, "bee 0's net at species 1: decays toward 0 from below too");
  const re = Prevalence.rebuild(config, 2, 20, feeds);
  for (const k of ["pollen", "net"]) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) close(re[k][i][j], m[k][i][j], 1e-12, `${k}[${i}][${j}]`);
  const cum = new Prevalence(cfg({ halfLifeS: null, prior: 64 }), 2);
  for (let r = 0; r < 50; r++) cum.decay();
  assert.equal(cum.net[1][0], 64, "cumulative: no decay");
});

test("fitness is the time-average of F × B over the rounds played (1 before any)", () => {
  const m = new Prevalence(cfg({}), 2);
  assert.deepEqual(m.fitness(), [1, 1]);
  m.tally([2, 0], [1, 2]); m.tally([1, 1], [1, 1]); m.tally([0.5, 1.5], [4, 0]);
  assert.deepEqual(m.fitness(), [(2 + 1 + 2) / 3, (0 + 1 + 0) / 3]);
  // The scoreboard: the stored sums, with the latest sample's F, B and chances; a game without: the old rule.
  const z = [[0, 0], [0, 0]];
  const rows = scoreboard(cfg({}), ["a", "b"], z, z, z, { sum: m.sum, rounds: m.rounds }, { F: [1.5, 0.5], B: [1, 1], pF: [0.6, 0.4], pB: [0.5, 0.5] });
  assert.deepEqual(rows.map((r) => [r.fitness, r.flowerSuccess, r.beeSuccess, r.flowerP, r.beeP]), [[5 / 3, 1.5, 1, 0.6, 0.5], [1 / 3, 0.5, 1, 0.4, 0.5]]);
  const old = scoreboard(classic(), ["a", "b"], [[1, 0], [0, 1]], [[4, 0], [0, 1]], [[1, 0], [0, 1]], null, null);
  assert.ok(old.every((r) => r.flowerSuccess === null && r.beeP === null));
  assert.ok(Math.abs(old[0].fitness - 4 * (1 / 2) * (4 ** 0.85 / (4 ** 0.85 + 1))) < 1e-12, "N² × pollination share × forage share");
});

test("draws: a flower by weight with replacement; bees by weight without replacement (each slot a distinct bee)", () => {
  const w = [4, 1, 2, 1], n = 80000;
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) counts[drawWeighted(w, [0, 1, 2, 3], rand)]++;
  counts.forEach((k, i) => close(k / n, w[i] / 8, 0.02, `species ${i}`));
  // Two slots from four bees: never the same bee twice; each bee's chance of a slot is exact sampling without
  // replacement: P(i) = w_i/W + Σ_{j≠i} (w_j/W) · w_i/(W − w_j).
  const W = 8, inc = w.map((wi, i) => wi / W + w.reduce((a, wj, j) => (j === i ? a : a + (wj / W) * (wi / (W - wj))), 0));
  const got = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const pick = sampleWithout(w, [0, 1, 2, 3], 2, rand);
    assert.ok(pick.length === 2 && pick[0] !== pick[1]);
    for (const b of pick) got[b]++;
  }
  got.forEach((k, i) => close(k / n, inc[i], 0.02, `bee ${i}'s chance of a slot`));
  close(inc.reduce((a, b) => a + b, 0), 2, 1e-12);
  assert.deepEqual(sampleWithout(w, [1, 3], 5, rand).sort(), [1, 3], "fewer ready bees than slots: all of them");
});

// Flowers answer their team; the bees feed only at species 0's flower.
const flower = (pct = 50) => `def flower(c):\n    return GAME["team"], ${pct}\n`;
const feedAt0 = `def first():\n    return 1\ndef decide(c, r):\n    return ("feed" if r == 0 else "leave"), c + 1\n`;

test("in a game: ceil(slots × N) distinct bees visit each round; the rest wait with their challenges", async () => {
  const config = cfg({ slots: 0.5 }, { feedPrice: 0 }); // 4 teams: 2 bees a round
  const out = await play(config, [0, 1, 2, 3].map(() => ({ flower: flower(), bee: feedAt0 })), 60);
  const byRound = new Map();
  for (const a of arrivals(out.actions)) byRound.set(a.round, [...(byRound.get(a.round) ?? []), a.bee]);
  const full = [...byRound.values()].filter((bees) => bees.length === 2);
  assert.ok(full.length >= 55, `${full.length} of ${byRound.size} rounds had both slots filled`);
  assert.ok([...byRound.values()].every((bees) => bees.length <= 2 && new Set(bees).size === bees.length), "never more, never a bee twice");
  // Every bee visits, in time: its challenge waited.
  const turns = ends(out.actions);
  for (let b = 0; b < 4; b++) {
    const mine = turns.filter((a) => a.bee === b);
    assert.ok(mine.length >= 10, `bee ${b}: ${mine.length} turns`);
    assert.ok(mine.every((a, i) => i === 0 || a.c === mine[i - 1].c + 1), "each turn plays the challenge queued at its last");
  }
  assert.deepEqual(out.samples[0].slots, 2);
});

test("in a game: once species 0 is the only one pollinated, visits follow p^F = (c + F) / Σ (c + F): 2/3 to species 0 here", async () => {
  // Cumulative, no prior, no cap, c = 1, every bee visits: after the first feed, F = [3, 0, 0] and p^F = [4, 1, 1] / 6.
  const config = cfg({ halfLifeS: null, prior: 0, cap: null, cStart: 1, cEnd: 1, slots: 1 }, { feedPrice: 0 });
  const out = await play(config, [0, 1, 2].map(() => ({ flower: flower(), bee: feedAt0 })), 120);
  const first = out.actions.find((a) => a.action === "feed");
  const after = arrivals(out.actions).filter((a) => a.round > first.round);
  assert.ok(after.length > 250, `${after.length} visits`);
  close(after.filter((a) => a.flower === 0).length / after.length, 2 / 3, 0.12, "species 0's share");
  const late = out.samples.filter((x) => x.round > first.round);
  assert.ok(late.length > 10 && late.every((x) => x.F[0] === 3 && Math.abs(x.pF[0] - 2 / 3) < 1e-6 && Math.abs(x.pF[1] - 1 / 6) < 1e-6), JSON.stringify(late[0]));
  assert.deepEqual(out.samples.slice(0, 3).map((x) => [x.round, x.atMs]), [[1, 0], [6, 1000], [11, 2000]], "about once a second of game time");
});

test("the feed price: every feed costs the bee feedPrice out of its nectar; at a 0% flower the net is −price and the bee loses B", async () => {
  // Bee 0 feeds only at species 0, a 0% flower (nothing for the bee); bee 1 only at species 1, a generous one.
  const price = 1e6;
  const flowers = [flower(0), flower(90)];
  const bee = (s) => `def first():\n    return 1\ndef decide(c, r):\n    MEMORY["seen"] = MEMORY.get("seen", 0) + 1\n    return ("feed" if r == ${s} else "leave"), c + 1\ndef fed(n):\n    MEMORY["gross"] = n\n`;
  const config = cfg({ slots: 1, cap: null }, { feedPrice: price, budgets: { flower: { minMs: 50 } } }); // R held at 50: every feed has energy
  const out = await play(config, [{ flower: flowers[0], bee: bee(0) }, { flower: flowers[1], bee: bee(1) }], 80);
  const feeds = ends(out.actions).filter((a) => a.action === "feed");
  const at0 = feeds.filter((a) => a.flower === 0), at1 = feeds.filter((a) => a.flower === 1);
  assert.ok(at0.length >= 3 && at1.length >= 3, `${at0.length} and ${at1.length} feeds`);
  for (const a of at0) assert.deepEqual([a.nectar, a.price, a.net], [0, price, -price], "a 0% flower: a net loss of the price");
  for (const a of at1) {
    assert.equal(a.price, price);
    close(a.net, a.nectar - price, 1e-12);
    assert.ok(a.net > 0, "a generous flower: a net gain");
  }
  assert.ok(ends(out.actions).filter((a) => a.action === "leave").every((a) => a.price === null && a.net === null), "a leave costs nothing");
  // fed() gets the gross nectar.
  const mem1 = JSON.parse(out.memories.filter((m) => m.team === 1).at(-1).memory);
  assert.ok(at1.some((a) => Math.abs(a.nectar - mem1.gross) < 1e-6), `fed(${mem1.gross}) is a feed's gross nectar`);
  // Bee 0's success falls to 0; bee 1 takes it all (B = N = 2).
  const last = out.samples.at(-1);
  assert.deepEqual(last.B, [0, 2], JSON.stringify(last));
  assert.ok(last.pB[1] > last.pB[0]);
});

test("in a game: the fitness sums are the time-average of the F × B each round's draws used (replayed from its feeds)", async () => {
  const config = cfg({ slots: 0.67, halfLifeS: 2, cap: 3 }, { feedPrice: 500000 });
  const bees = [feedAt0, `def first():\n    return 1\ndef decide(c, r):\n    return "feed", c + 1\n`, `def first():\n    return 1\ndef decide(c, r):\n    return ("feed" if c % 3 else "leave"), c + 1\n`];
  const out = await play(config, [0, 1, 2].map((i) => ({ flower: flower(20 + 30 * i), bee: bees[i] })), 70);
  assert.equal(out.fitness.rounds, 70);
  // Replay: as each round begins, decay and tally F × B; then that round's feeds.
  const m = new Prevalence(config, 3);
  const feeds = ends(out.actions).filter((a) => a.action === "feed");
  for (let r = 1; r <= 70; r++) {
    m.decay();
    const { F, B } = m.success();
    m.tally(F, B);
    for (const a of feeds.filter((x) => x.round === r)) m.feed(a.bee, a.flower, a.pollen, a.net);
  }
  m.sum.forEach((x, i) => close(out.fitness.sum[i], x, 1e-9, `team ${i}`));
  const fit = m.fitness();
  assert.ok(fit.some((x) => Math.abs(x - 1) > 0.05), `fitness moved off par: ${fit}`);
  for (const x of out.samples) assert.equal(x.fitness.length, 3);
});

test("an old config is unchanged: every bee every round, species drawn uniformly, free feeds, a 20-round sit-out, no samples", async () => {
  const config = classic({ feedCost: 0 });
  const out = await play(config, [0, 1, 2].map(() => ({ flower: flower(), bee: feedAt0 })), 100);
  assert.deepEqual([out.samples, out.sample, out.fitness], [[], null, null]);
  const visits = arrivals(out.actions);
  const rounds = new Map();
  for (const a of visits) rounds.set(a.round, (rounds.get(a.round) ?? 0) + 1);
  assert.ok([...rounds.values()].filter((k) => k === 3).length >= 95, "every bee, every round");
  close(visits.filter((a) => a.flower === 0).length / visits.length, 1 / 3, 0.1, "uniform, though only species 0 is fed");
  assert.ok(ends(out.actions).filter((a) => a.action === "feed").every((a) => a.price === 0 && a.net === a.nectar), "free feeds");
  const sat = await play(classic(), [{ flower: flower(), bee: feedAt0 }], 30);
  const fedRounds = ends(sat.actions).filter((a) => a.action === "feed").map((a) => a.round);
  assert.ok(fedRounds.length >= 2 && fedRounds.every((r, i) => i === 0 || r - fedRounds[i - 1] === 21), `a feed sits the bee out 20 rounds: ${fedRounds}`);
});

test("GAME tells programs the feed price and the window, never prevalence; a new game's flower gets R ≤ 50 but answers at 150 ms", async () => {
  const f = `def flower(c):\n    return [GAME["ms"], GAME["flower_ms"], GAME["flower_window_ms"], GAME["feed_price"], GAME["round_ms"], sorted(k for k in GAME if "prev" in k or "success" in k)], 0\n`;
  const b = `def first():\n    return 1\ndef decide(c, r):\n    return "leave", 1\n`;
  const out = await play(normalizeConfig({ responseType: "any" }), [{ flower: f, bee: b }], 6);
  for (const a of ends(out.actions)) {
    const [ms, cap, win, price, round, prev] = a.r;
    assert.ok(ms >= 1 && ms <= 50 && ms === a.budgetMs, `R ${ms}`);
    assert.deepEqual([cap, win, price, round, prev], [50, 150, 2816000, 200, []]);
    assert.equal(a.atMs, (a.round - 1) * 200 + 150, "delivered at the end of the 150 ms window");
  }
});
