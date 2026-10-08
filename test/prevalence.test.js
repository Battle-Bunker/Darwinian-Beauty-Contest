// Prevalence on both sides and the feed price (server/lib/prevalence.js; RULES.md "Prevalence"). Each round
// ceil(slots × N) distinct bees are drawn without replacement with weights c(t) + B_b, and each visits a species
// drawn with weights c(t) + F_s. F_s = N × share of Σ_b (decayed pollen s gave b)^β, capped: per-(species, bee)
// cells, so diverse dissemination counts for more. With pools (v3, the default) B_b = N × share of the bee's
// single nectar balance (floored at 0), capped: the balance starts at the endowment, each feed adds nectar −
// price, and it relaxes toward the endowment with the half-life; a bee below the price can't feed. With pools
// false (v2) B_b = N × share of max(0, Σ_s signed (decayed net nectar)^α). Fitness is the time-average of F × B.
// A config from before plays as it did.
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

test("the defaults: prevalence on (half-life 90 s, c 1→0.1, cap 4, slots 0.25, prior 0.12 × Emax, pools, endowment 10 × price), a feed price of 0.05 × Emax; a config from before has none", () => {
  assert.deepEqual(DEFAULT_CONFIG.prevalence, { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null, pools: true, endowment: null });
  const d = normalizeConfig({});
  assert.equal(emaxOf(d), 1100 * 50 * 1024, "Emax = size cap × R's cap × byte cap");
  assert.deepEqual(prevalenceOf(d), { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: 0.12 * 56320000, pools: true, endowment: 10 * 2816000 });
  assert.equal(feedPriceOf(d), 2816000, "about 2.8M");
  assert.deepEqual([d.feedCost, d.feedPrice], [0, null]);
  assert.equal(prevalenceOf(cfg({ endowment: 5e6 })).endowment, 5e6, "an explicit endowment");
  assert.equal(feedPriceOf(normalizeConfig({ feedPrice: 0 })), 0, "0: free");
  assert.equal(prevalenceOf(cfg({ pools: false })).pools, false, "pools can be turned off (v2)");
  // A config from before: no prevalence, free feeds, the window at flower.ms; it stays so when edited.
  const old = classic();
  assert.deepEqual([prevalenceOf(old), feedPriceOf(old), windowMsOf(old), old.feedCost], [null, 0, 150, 20]);
  assert.equal(prevalenceOf(normalizeConfig({ minutes: 4 }, old)), null);
  // A stored v2 config (slots but no pools) stays on, with the v2 per-cell bee formula.
  const v2 = prevalenceOf({ ...d, prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null } });
  assert.deepEqual([v2.on, v2.pools], [true, false]);
  // The superseded one-sided form (no slots) plays as a config from before.
  assert.equal(prevalenceOf({ ...d, prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, prior: null, cap: 4 } }), null);
  const n = cfg({ halfLifeS: null, cap: null, slots: 7, cStart: -3 }).prevalence;
  assert.deepEqual([n.halfLifeS, n.cap, n.slots, n.cStart], [null, null, 1, 0], "null: cumulative and no cap; bad values clamped");
});

test("c(t) runs linearly from cStart at the start to cEnd at the end of the game, and stays there", () => {
  const m = new Prevalence(cfg({ cStart: 2, cEnd: 0.5 }, { minutes: 10 }), 3);
  for (const [t, c] of [[0, 2], [150000, 1.625], [300000, 1.25], [600000, 0.5], [1200000, 0.5]]) close(m.c(t), c, 1e-12, `c(${t})`);
  close(m.weights(300000).c, 1.25);
});

test("F_s is N × the species' share of Σ_b (pollen)^β: per-(species, bee) cells, so diverse dissemination counts for more", () => {
  const config = cfg({ halfLifeS: null, prior: 0, cap: null, cStart: 0.5, cEnd: 0.5 });
  const { beta } = config.scoring;
  const m = new Prevalence(config, 4);
  assert.deepEqual(m.weights(0).F, [1, 1, 1, 1], "no pollen yet: 1 for all");
  // Species 1 gets 900 from bee 0 and 400 from bee 2; species 2 gets 1000 from bee 1; species 3 gets 10 from bee 1.
  m.feed(0, 1, 900, 0); m.feed(2, 1, 400, 0); m.feed(1, 2, 1000, 0); m.feed(1, 3, 10, 0);
  const qF = [0, 900 ** beta + 400 ** beta, 1000 ** beta, 10 ** beta], QF = qF.reduce((a, b) => a + b);
  const { c, F, pF } = m.weights(0);
  qF.forEach((x, s) => close(F[s], (4 * x) / QF, 1e-12, `F_${s}`));
  F.forEach((x, s) => close(pF[s], (c + x) / (4 * (c + 1)), 1e-12, `pF_${s}`));
  // Diversity: species 0 gets 1,300 pollen spread over two bee teams, species 1 the same 1,300 from one.
  const div = new Prevalence(config, 2);
  div.feed(0, 0, 650, 0); div.feed(1, 0, 650, 0); // to species 0, from bees 0 and 1
  div.feed(0, 1, 1300, 0);                        // to species 1, from bee 0 only
  assert.ok(div.weights(0).F[0] > div.weights(0).F[1], "the same pollen, spread over more bee teams, gives more flower success");
});

test("the bee balance (pools): N × share of the balance (floored at 0), capped; a bee below the price can't feed", () => {
  const config = cfg({ halfLifeS: null, cap: null, endowment: 100 }, { feedPrice: 10 });
  const m = new Prevalence(config, 3);
  assert.deepEqual(m.balances(), [100, 100, 100], "every bee starts at the endowment");
  assert.deepEqual([0, 1, 2].map((b) => m.canFeed(b)), [true, true, true]);
  m.feed(0, 0, 1000, 40);   // net +40
  m.feed(1, 0, 1000, -95);  // net −95: below the price
  assert.deepEqual(m.balances(), [140, 5, 100]);
  assert.deepEqual([0, 1, 2].map((b) => m.canFeed(b)), [true, false, true], "bee 1 is below the price of 10");
  const total = 140 + 5 + 100;
  m.weights(0).B.forEach((x, b) => close(x, (3 * [140, 5, 100][b]) / total, 1e-12, `B_${b}`));
  // A negative balance floors at 0 for the share.
  const neg = new Prevalence(cfg({ halfLifeS: null, cap: null, endowment: 100 }, { feedPrice: 10 }), 2);
  neg.feed(0, 0, 0, 300); neg.feed(1, 0, 0, -500);
  assert.deepEqual(neg.balances(), [400, -400]);
  assert.deepEqual(neg.weights(0).B, [2, 0], "the negative balance weighs 0; all the success is bee 0's");
  // The cap.
  const capped = new Prevalence(cfg({ halfLifeS: null, cap: 2, endowment: 0 }, { feedPrice: 0 }), 3);
  capped.feed(0, 0, 0, 1000);
  assert.deepEqual(capped.weights(0).B, [2, 0, 0]);
});

test("pools false keeps the v2 per-cell bee formula: B = N × share of max(0, Σ signed net^α), losses offsetting gains", () => {
  const config = cfg({ halfLifeS: null, prior: 0, cap: null, pools: false });
  const { alpha } = config.scoring;
  const m = new Prevalence(config, 3);
  assert.equal(m.balances(), null, "no balance under pools false");
  m.feed(0, 0, 1e6, 5000);
  for (let i = 0; i < 10; i++) m.feed(1, 2, 1e6, -2000);
  m.feed(2, 0, 1e6, 5000); m.feed(2, 1, 1e6, -5000);
  const { B } = m.weights(0);
  assert.equal(B[1], 0, "net negative: no success");
  assert.equal(B[2], 0, "|D|^α with signs: they cancel");
  assert.equal(B[0], 3, "all the success is bee 0's");
  void alpha;
});

test("the balance relaxes toward the endowment with the half-life (metabolism above, recovery below); cumulative never relaxes; rebuilds exactly", () => {
  const config = cfg({ halfLifeS: 1, endowment: 100, cap: null }, { feedPrice: 10 }); // 200 ms rounds: d = 2^(−0.2)
  const d = Math.pow(2, -0.2);
  const m = new Prevalence(config, 2);
  const feeds = [];
  const feed = (round, bee, net) => { m.feed(bee, 0, 0, net); feeds.push({ round, bee, flower: 0, pollen: 0, net }); };
  for (let r = 1; r <= 10; r++) { m.decay(); if (r === 2) feed(r, 0, 80); if (r === 6) feed(r, 1, -70); }
  close(m.balances()[0], 100 + 80 * d ** 8, 1e-9, "above b0: decays back toward it");
  close(m.balances()[1], 100 - 70 * d ** 4, 1e-9, "below b0: recovers toward it");
  const re = Prevalence.rebuild(config, 2, 10, feeds);
  re.balances().forEach((x, b) => close(x, m.balances()[b], 1e-9, `rebuilt balance[${b}]`));
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) close(re.pollen[i][j], m.pollen[i][j], 1e-9, `pollen[${i}][${j}]`);
  // Cumulative: the balance only moves on a feed.
  const cum = new Prevalence(cfg({ halfLifeS: null, endowment: 100 }, { feedPrice: 10 }), 2);
  for (let r = 0; r < 50; r++) cum.decay();
  assert.deepEqual(cum.balances(), [100, 100]);
  cum.feed(0, 0, 0, 25); for (let r = 0; r < 50; r++) cum.decay();
  assert.equal(cum.balances()[0], 125, "no relaxation when cumulative");
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
  // Cumulative, no prior, no cap, c = 1, every bee visits, free feeds: after the first feed, F = [3, 0, 0] and p^F = [4, 1, 1] / 6.
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

test("the feed price and the balance (pools): every feed shows nectar, price and net, and the balance after it; a bee drained below the price is too poor to feed", async () => {
  // Two 0% flowers, both bees always feed. endowment 3 × price, cumulative: a feed loses the price, and a bee can
  // feed while its balance is at least the price, so it feeds three times (6M → 4M → 2M → 0), then is too poor.
  const price = 2e6, endowment = 3 * price;
  const bee = `def first():\n    return 1\ndef decide(c, r):\n    return "feed", c + 1\ndef fed(n):\n    MEMORY["gross"] = n\n`;
  const config = cfg({ halfLifeS: null, cap: null, endowment, slots: 1 }, { feedPrice: price, budgets: { flower: { minMs: 50 } } });
  const out = await play(config, [{ flower: flower(0), bee }, { flower: flower(0), bee }], 40);
  const turns = ends(out.actions);
  const feeds = turns.filter((a) => a.action === "feed");
  assert.ok(feeds.length >= 2, `${feeds.length} feeds`);
  for (const a of feeds) assert.deepEqual([a.nectar, a.price, a.net], [0, price, -price], "a 0% flower: net −price");
  // The balance after each feed, carried on the record.
  const b0feeds = feeds.filter((a) => a.bee === 0).sort((x, y) => x.round - y.round);
  assert.deepEqual(b0feeds.map((a) => a.balance), [4e6, 2e6, 0], "balance after each feed; it can feed down to exactly the price");
  const poor = turns.filter((a) => a.bee === 0 && /too poor to feed/.test(a.beeError ?? ""));
  assert.ok(poor.length >= 3 && poor.every((a) => a.action === "leave" && a.price === null), "the rest are leaves recorded 'too poor to feed'");
  assert.ok(JSON.parse(out.memories.find((m) => m.team === 0).memory).gross === 0, "fed() got the gross nectar (0 here)");
  const last = out.samples.at(-1);
  assert.deepEqual(last.balance, [0, 0], "the sample carries each bee's balance");
});

test("a bee below the price recovers over time toward its endowment and can feed again", () => {
  const config = cfg({ halfLifeS: 1, cap: null, endowment: 100 }, { feedPrice: 60 });
  const m = new Prevalence(config, 2);
  m.feed(0, 0, 0, -50); // balance 50, below the price of 60
  assert.equal(m.canFeed(0), false);
  let rounds = 0;
  while (!m.canFeed(0) && rounds < 1000) { m.decay(); rounds++; }
  assert.ok(m.canFeed(0) && rounds > 0, `recovered to the price after ${rounds} rounds`);
  assert.ok(m.balances()[0] >= 60 && m.balances()[0] < 100, "recovered toward the endowment, not past it");
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
  assert.ok(ends(out.actions).filter((a) => a.action === "feed").every((a) => a.price === 0 && a.net === a.nectar && a.balance === null), "free feeds, no balance");
  const sat = await play(classic(), [{ flower: flower(), bee: feedAt0 }], 30);
  const fedRounds = ends(sat.actions).filter((a) => a.action === "feed").map((a) => a.round);
  assert.ok(fedRounds.length >= 2 && fedRounds.every((r, i) => i === 0 || r - fedRounds[i - 1] === 21), `a feed sits the bee out 20 rounds: ${fedRounds}`);
});

test("GAME tells programs the feed price and the window, never prevalence or the balance; a new game's flower gets R ≤ 50 but answers at 150 ms", async () => {
  const f = `def flower(c):\n    return [GAME["ms"], GAME["flower_ms"], GAME["flower_window_ms"], GAME["feed_price"], GAME["round_ms"], sorted(k for k in GAME if "prev" in k or "success" in k or "balance" in k or "nectar" in k)], 0\n`;
  const b = `def first():\n    return 1\ndef decide(c, r):\n    return "leave", 1\n`;
  const out = await play(normalizeConfig({ responseType: "any" }), [{ flower: f, bee: b }], 6);
  for (const a of ends(out.actions)) {
    const [ms, cap, win, price, round, hidden] = a.r;
    assert.ok(ms >= 1 && ms <= 50 && ms === a.budgetMs, `R ${ms}`);
    assert.deepEqual([cap, win, price, round, hidden], [50, 150, 2816000, 200, []]);
    assert.equal(a.atMs, (a.round - 1) * 200 + 150, "delivered at the end of the 150 ms window");
  }
});
