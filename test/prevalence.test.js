// Species prevalence (server/lib/prevalence.js, RULES.md "Species prevalence"): a turn's flower species s is
// drawn with probability p_s = (c(t) + P_s) / Σ_k (c(t) + P_k), P_s = N × s's share of Σ_b D_{b,s}^β (decayed
// ledgers starting at a prior), capped; c(t) runs from cStart to cEnd over the game. A config without
// `prevalence` draws uniformly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prevalence, drawWeighted } from "../server/lib/prevalence.js";
import { DEFAULT_CONFIG, normalizeConfig, prevalenceOf } from "../server/lib/gameConfig.js";
import { score } from "../server/lib/scoring.js";
import { play } from "./fixtures/garden.js";

const close = (a, b, eps = 1e-9, what = "") => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${what} ${a} vs ${b}`);
const cfg = (prevalence, rest = {}) => normalizeConfig({ ...rest, prevalence });
const arrivals = (actions) => actions.filter((a) => a.action === "arrive");

test("the defaults: on for new games (basis pollination, half-life 90 s, c from 1 to 0.1, prior 20,000,000, cap 4); off for a config stored without it", () => {
  assert.deepEqual(DEFAULT_CONFIG.prevalence, { on: true, basis: "pollination", halfLifeS: 90, cStart: 1, cEnd: 0.1, prior: null, cap: 4 });
  assert.deepEqual(prevalenceOf(normalizeConfig({})), { on: true, basis: "pollination", halfLifeS: 90, cStart: 1, cEnd: 0.1, prior: 20000000, cap: 4 });
  assert.equal(prevalenceOf(cfg({ basis: "feeds" })).prior, 1, "the feeds basis: a prior of 1 feed");
  assert.equal(prevalenceOf(cfg({}, { energy: { bytes: false } })).prior, 20000000 / 1024, "a node·ms game: the same prior in its unit");
  assert.equal(prevalenceOf(cfg({ prior: 5 })).prior, 5);
  const { prevalence: _, ...old } = normalizeConfig({});
  assert.equal(prevalenceOf(old), null, "a stored config without prevalence: uniform draws");
  assert.equal(prevalenceOf(normalizeConfig({}, old)), null, "and it stays off when the config is edited");
  assert.equal(prevalenceOf(normalizeConfig({ prevalence: { on: true } }, old)).basis, "pollination");
  assert.equal(prevalenceOf(cfg({ on: false })), null);
  const n = cfg({ halfLifeS: null, cap: null, basis: "nonsense", cStart: -3 }).prevalence;
  assert.deepEqual([n.halfLifeS, n.cap, n.basis, n.cStart], [null, null, "pollination", 0], "null: cumulative and no cap; bad values clamped or ignored");
});

test("c(t) runs linearly from cStart at the start to cEnd at the end of the game, and stays there", () => {
  const m = new Prevalence(cfg({ cStart: 2, cEnd: 0.5 }, { minutes: 10 }), 3);
  const T = 600000;
  for (const [t, c] of [[0, 2], [T / 4, 1.625], [T / 2, 1.25], [T, 0.5], [2 * T, 0.5]]) close(m.c(t), c, 1e-12, `c(${t})`);
  close(m.weights(T / 2).c, 1.25);
});

test("P_s is N × the species' share of Σ_b D^β; p_s = (c + P_s) / (N (c + 1)) without a cap; a species nobody fed keeps c / Σ w", () => {
  const config = cfg({ halfLifeS: null, prior: 0, cap: null, cStart: 0.5, cEnd: 0.5 });
  const m = new Prevalence(config, 4);
  const beta = config.scoring.beta;
  // No success yet: every P_s is 1, every p_s 1/N.
  assert.deepEqual(m.weights(0).P, [1, 1, 1, 1]);
  assert.deepEqual(m.weights(0).p, [0.25, 0.25, 0.25, 0.25]);
  m.feed(0, 1, 900, 100); m.feed(2, 1, 400, 0); m.feed(1, 2, 1000, 50);
  const q = [0, 900 ** beta + 400 ** beta, 1000 ** beta, 0], Q = q.reduce((a, b) => a + b);
  const { c, P, p } = m.weights(0);
  q.forEach((x, s) => close(P[s], (4 * x) / Q, 1e-12, `P_${s}`));
  P.forEach((x, s) => close(p[s], (c + x) / (4 * (c + 1)), 1e-12, `p_${s}`));
  close(p[0], 0.5 / (4 * 1.5), 1e-12, "no pollination: c / Σ w");
  close(p.reduce((a, b) => a + b), 1, 1e-12);
});

test("a cap: P_s is capped, and p_s = w_s / Σ w with the capped weights", () => {
  const m = new Prevalence(cfg({ halfLifeS: null, prior: 0, cap: 2, cStart: 1, cEnd: 1 }), 4);
  m.feed(3, 0, 5000, 0);
  const { P, w, p } = m.weights(0);
  assert.deepEqual(P, [2, 0, 0, 0], "all the success is species 0's: P_0 = N = 4, capped at 2");
  assert.deepEqual(w, [3, 1, 1, 1]);
  assert.deepEqual(p, [0.5, 1 / 6, 1 / 6, 1 / 6]);
});

test("decay: every cell, prior included, halves every halfLifeS of game time (rounds, so a pause doesn't decay); rebuilding from the feeds gives the same model", () => {
  const config = cfg({ halfLifeS: 1, prior: 64 }); // 200 ms rounds: halves every 5 rounds
  const m = new Prevalence(config, 2);
  const feeds = [];
  for (let r = 1; r <= 20; r++) {
    m.decay();
    if (r === 3) { m.feed(0, 1, 1000, 10); feeds.push({ round: r, bee: 0, flower: 1, pollen: 1000, nectar: 10 }); }
    if (r === 11) { m.feed(1, 1, 300, 0); feeds.push({ round: r, bee: 1, flower: 1, pollen: 300, nectar: 0 }); }
    if (r === 8) close(m.D[0][1], 64 * 2 ** (-8 / 5) + 1000 * 2 ** (-5 / 5), 1e-12, "round 8");
  }
  close(m.D[0][0], 64 * 2 ** -4, 1e-12, "the prior, after 20 rounds = 4 half-lives");
  close(m.D[0][1], 64 * 2 ** -4 + 1000 * 2 ** (-17 / 5), 1e-12);
  close(m.D[1][1], 64 * 2 ** -4 + 300 * 2 ** (-9 / 5), 1e-12);
  const re = Prevalence.rebuild(config, 2, 20, feeds);
  for (let b = 0; b < 2; b++) for (let s = 0; s < 2; s++) close(re.D[b][s], m.D[b][s], 1e-12, `rebuilt D[${b}][${s}]`);
  const [a, b] = [re.weights(1000), m.weights(1000)];
  for (const k of ["P", "p"]) a[k].forEach((x, s) => close(x, b[k][s], 1e-12, `rebuilt ${k}_${s}`));
  // Cumulative (halfLifeS null): no decay.
  const cum = new Prevalence(cfg({ halfLifeS: null, prior: 64 }), 2);
  for (let r = 0; r < 50; r++) cum.decay();
  assert.equal(cum.D[1][0], 64);
});

test("the prior damps the start: one early feed moves P far less than without it", () => {
  const without = new Prevalence(cfg({ prior: 0 }), 6), withPrior = new Prevalence(cfg({}), 6);
  for (const m of [without, withPrior]) m.feed(0, 0, 3e7, 0); // one big feed (node·ms·bytes)
  assert.equal(without.weights(0).P[0], 4, "without a prior: all of the success (6, capped at 4)");
  const P0 = withPrior.weights(0).P[0];
  assert.ok(P0 > 1 && P0 < 1.6, `with the 20,000,000 prior: ${P0}`);
});

test("the feeds basis counts feeds; the fitness basis is N × the recent fitness share (the scoreboard's fitness, of the ledgers)", () => {
  const f = new Prevalence(cfg({ basis: "feeds", halfLifeS: null, prior: 0, cap: null }), 3);
  f.feed(0, 0, 1e9, 0); f.feed(1, 1, 1, 0); f.feed(2, 1, 1, 0);
  const qf = [1, 2, 0], Qf = 1 + 2 * 1; // Σ_b F^β: one feed each from bees 0 (at 0), 1 and 2 (at 1)
  close(f.weights(0).P[0], (3 * qf[0]) / Qf);
  close(f.weights(0).P[1], (3 * 2) / Qf);
  const config = cfg({ basis: "fitness", halfLifeS: null, prior: 0, cap: null });
  const m = new Prevalence(config, 3);
  const pollen = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], nectar = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [b, s, y, x] of [[0, 1, 500, 100], [1, 2, 200, 300], [2, 1, 50, 20], [1, 0, 700, 10]]) {
    m.feed(b, s, y, x); pollen[b][s] += y; nectar[b][s] += x;
  }
  const fit = score([0, 1, 2], pollen.map((r) => r.map(() => 0)), nectar, pollen, config.scoring).map((x) => x.fitness);
  const F = fit.reduce((a, b) => a + b);
  m.weights(0).P.forEach((P, s) => close(P, (3 * fit[s]) / F, 1e-9, `P_${s}`));
});

test("draws follow p_s: drawn proportionally to the weights, among the species that have a flower", () => {
  const w = [4, 1, 2, 1], counts = [0, 0, 0, 0], n = 80000;
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) counts[drawWeighted(w, [0, 1, 2, 3], rand)]++;
  counts.forEach((k, i) => close(k / n, w[i] / 8, 0.02, `species ${i}`));
  const only = [0, 0, 0, 0];
  for (let i = 0; i < 9000; i++) only[drawWeighted(w, [1, 2], rand)]++;
  assert.deepEqual([only[0], only[3]], [0, 0]);
  close(only[2] / 9000, 2 / 3, 0.05, "among 1 and 2 only");
});

// A garden of 3 whose bees feed only at species 0's flower (the flowers answer their team).
const flower = `def flower(c):\n    return GAME["team"], 50\n`;
const bee = `def first():\n    return 1\ndef decide(c, r):\n    return ("feed" if r == 0 else "leave"), c + 1\n`;

test("in a game: once species 0 is the only one fed, draws follow p = (c + P) / Σ (c + P): 2/3 to species 0 here", async () => {
  // Feeds basis, cumulative, no prior, no cap, c = 1: after the first feed, P = [3, 0, 0] and p = [4, 1, 1] / 6.
  const config = cfg({ basis: "feeds", halfLifeS: null, prior: 0, cap: null, cStart: 1, cEnd: 1 }, { feedCost: 0, budgets: { flower: { minMs: 150 } } });
  const out = await play(config, [{ flower, bee }, { flower, bee }, { flower, bee }], 120);
  const first = out.actions.find((a) => a.action === "feed");
  assert.ok(first, "someone fed");
  const after = arrivals(out.actions).filter((a) => a.round > first.round);
  const share = after.filter((a) => a.flower === 0).length / after.length;
  assert.ok(after.length > 200, `${after.length} draws`);
  close(share, 2 / 3, 0.15, `species 0's share of ${after.length} draws`);
  // The samples: about once a second (every 5 rounds), with c and the weights the draws used.
  assert.deepEqual(out.samples.slice(0, 3).map((x) => [x.round, x.atMs]), [[1, 0], [6, 1000], [11, 2000]]);
  const late = out.samples.filter((x) => x.round > first.round);
  assert.ok(late.length > 10 && late.every((x) => x.c === 1 && x.P[0] === 3 && Math.abs(x.p[0] - 2 / 3) < 1e-6 && Math.abs(x.p[1] - 1 / 6) < 1e-6), JSON.stringify(late[0]));
  assert.deepEqual(out.sample, out.samples.at(-1), "the latest");
});

test("in a game: c(t) in the samples runs from cStart to cEnd over the game's length", async () => {
  const config = cfg({ cStart: 3, cEnd: 1 }, { minutes: 0.1, feedCost: 0 }); // 6 s: 30 rounds
  const out = await play(config, [{ flower, bee }, { flower, bee }], 30);
  assert.deepEqual(out.samples.map((x) => x.round), [1, 6, 11, 16, 21, 26]);
  for (const x of out.samples) close(x.c, 3 - 2 * Math.min(1, x.atMs / 6000), 1e-6, `c at ${x.atMs} ms`);
});

test("an old config (no prevalence) draws uniformly and publishes no samples", async () => {
  const { prevalence: _, ...old } = normalizeConfig({ feedCost: 0, budgets: { flower: { minMs: 150 } } });
  const out = await play(old, [{ flower, bee }, { flower, bee }, { flower, bee }], 120);
  assert.deepEqual([out.samples, out.sample], [[], null]);
  const draws = arrivals(out.actions);
  assert.ok(draws.length > 250);
  close(draws.filter((a) => a.flower === 0).length / draws.length, 1 / 3, 0.1, "species 0's share: about 1/3 though it is the only one fed");
});
