// Darwinian fitness = N² × pollination share × forage share (server/lib/scoring.js), with forage = Σ nectar^alpha
// and pollination = Σ pollen^beta: the game's config.scoring (0.85 and 0.85 by default), or √ (0.5) for a game
// stored without them. score() without exponents is √, so the tests from before the exponents still hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_SCORING, powsum, rootsum, score, scoringOf } from "../server/lib/scoring.js";
import { DEFAULT_CONFIG, normalizeConfig } from "../server/lib/gameConfig.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const fill = (n, x) => Array.from({ length: n }, () => new Array(n).fill(x));

test("rootsum rewards spreading", () => {
  close(rootsum([4, 0, 0, 0]), 2);
  close(rootsum([1, 1, 1, 1]), 4);
});

test("a perfectly even game scores par 1 for everyone, at any N", () => {
  for (const n of [2, 3, 7, 12]) {
    for (const s of score([...Array(n).keys()], fill(n, 3), fill(n, 500), fill(n, 900))) {
      close(s.fitness, 1);
      close(s.pollinationShare, 1 / n);
      close(s.forageShare, 1 / n);
    }
  }
});

test("pollination from the pollen columns, forage from the nectar rows; own cells count", () => {
  // rows: bee team; columns: flower team
  const feeds = [[2, 1, 0], [0, 0, 4], [1, 1, 1]];
  const nectar = [[100, 25, 0], [0, 0, 400], [9, 0, 0]];
  const pollen = [[64, 81, 0], [0, 0, 100], [1, 0, 25]];
  const s = score(["a", "b", "c"], feeds, nectar, pollen);
  close(s[0].pollination, 8 + 0 + 1);
  close(s[1].pollination, 9);
  close(s[2].pollination, 0 + 10 + 5);
  close(s[0].forage, 10 + 5);
  close(s[1].forage, 20);
  close(s[2].forage, 3);
  assert.deepEqual(s.map((t) => t.pollen), [65, 81, 125]);
  const tot = (k) => s.reduce((x, t) => x + t[k], 0);
  for (const t of s) {
    close(t.pollinationShare, t.pollination / tot("pollination"));
    close(t.forageShare, t.forage / tot("forage"));
    close(t.fitness, 9 * t.pollinationShare * t.forageShare);
    for (const gone of ["allure", "allureShare", "surplusShare", "surplus"]) assert.ok(!(gone in t), `${gone} is no longer a score term`);
  }
  assert.deepEqual(s.map((t) => [t.feedsReceived, t.feedsGiven, t.pollinators]), [[3, 3, 2], [2, 4, 2], [5, 3, 2]]);
  assert.deepEqual(s.map((t) => [t.nectarCollected, t.nectarGiven, t.nectarSources]), [[125, 109, 2], [400, 25, 1], [9, 400, 1]]);
});

test("rootsum over the pollen column rewards being pollinated by many teams", () => {
  // Both flowers kept 400 in all; one from a single bee team, one spread over four.
  const pollen = [[400, 100, 0, 0], [0, 100, 0, 0], [0, 100, 0, 0], [0, 100, 0, 0]];
  const s = score([0, 1, 2, 3], pollen.map((r) => r.map((x) => (x ? 1 : 0))), pollen, pollen);
  close(s[0].pollination, 20);
  close(s[1].pollination, 40);
  assert.equal(s[0].pollen, s[1].pollen);
});

test("a term whose total is 0 gives every team a share of 1/N", () => {
  const zero = fill(2, 0);
  for (const t of score(["a", "b"], zero, zero, zero)) {
    close(t.fitness, 1);
    close(t.pollinationShare, 0.5);
    close(t.forageShare, 0.5);
  }
  // Feeds happened but every flower gave all its energy away: no pollen anywhere.
  const s = score(["a", "b"], [[2, 0], [2, 0]], [[50, 0], [10, 0]], zero);
  assert.deepEqual(s.map((t) => t.pollinationShare), [0.5, 0.5]);
  close(s[0].fitness, 4 * 0.5 * (Math.sqrt(50) / (Math.sqrt(50) + Math.sqrt(10))));
  // No nectar anywhere: every bee gets 1/N of forage.
  const t = score(["a", "b"], [[1, 0], [0, 0]], zero, [[9, 0], [0, 0]]);
  assert.deepEqual(t.map((x) => x.forageShare), [0.5, 0.5]);
  assert.deepEqual(t.map((x) => x.pollinationShare), [1, 0]);
  assert.deepEqual(t.map((x) => x.fitness), [2, 0]);
});

test("exponents: forage = Σ nectar^alpha over the row, pollination = Σ pollen^beta over the column", () => {
  const feeds = [[2, 1, 0], [0, 0, 4], [1, 1, 1]];
  const nectar = [[100, 25, 0], [0, 0, 400], [9, 0, 0]];
  const pollen = [[64, 81, 0], [0, 0, 100], [1, 0, 25]];
  const [alpha, beta] = [0.85, 0.7];
  const s = score(["a", "b", "c"], feeds, nectar, pollen, { alpha, beta });
  close(s[0].forage, 100 ** alpha + 25 ** alpha);
  close(s[1].forage, 400 ** alpha);
  close(s[2].forage, 9 ** alpha);
  close(s[0].pollination, 64 ** beta + 0 + 1 ** beta);
  close(s[1].pollination, 81 ** beta);
  close(s[2].pollination, 100 ** beta + 25 ** beta);
  const tot = (k) => s.reduce((x, t) => x + t[k], 0);
  for (const t of s) {
    close(t.pollinationShare, t.pollination / tot("pollination"));
    close(t.forageShare, t.forage / tot("forage"));
    close(t.fitness, 9 * t.pollinationShare * t.forageShare);
  }
  // The rest is unchanged by the exponents.
  const root = score(["a", "b", "c"], feeds, nectar, pollen);
  for (const k of ["pollen", "feedsReceived", "feedsGiven", "pollinators", "nectarCollected", "nectarGiven", "nectarSources"]) {
    assert.deepEqual(s.map((t) => t[k]), root.map((t) => t[k]), k);
  }
  // An even game is still par 1 for everyone, and a zero total still gives 1/N.
  for (const t of score([0, 1, 2], fill(3, 1), fill(3, 500), fill(3, 900), { alpha, beta })) close(t.fitness, 1);
  for (const t of score(["a", "b"], fill(2, 0), fill(2, 0), fill(2, 0), { alpha, beta })) close(t.fitness, 1);
  // At 0.85, spreading still beats the same total from one source, by less than at 0.5.
  close(powsum([400, 0, 0, 0], 0.85), 400 ** 0.85);
  close(powsum([100, 100, 100, 100], 0.85) / powsum([400, 0, 0, 0], 0.85), 4 ** 0.15);
  close(powsum([1, 2, 3], 1), 6);
});

test("new games are scored with 0.85 and 0.85 (and, with prevalence, mode \"final\"); a game stored without exponents is scored with √, exactly as before", () => {
  assert.deepEqual(DEFAULT_CONFIG.scoring, { alpha: 0.85, beta: 0.85, mode: "final" });
  const fresh = normalizeConfig({});
  assert.deepEqual(fresh.scoring, { alpha: 0.85, beta: 0.85, mode: "final" });
  assert.deepEqual(scoringOf(fresh), { alpha: 0.85, beta: 0.85, mode: "final" });
  // A config stored before the exponents existed has no `scoring`: √ (and time-average).
  const { scoring: _, ...old } = fresh;
  assert.deepEqual(scoringOf(old), { alpha: 0.5, beta: 0.5, mode: "timeAverage" });
  assert.deepEqual(scoringOf(old), LEGACY_SCORING);
  assert.deepEqual(scoringOf(null), LEGACY_SCORING);
  // Its scores are bit for bit the ones the old Σ√ gave (the same Math.sqrt), so results don't move.
  const feeds = [[3, 1, 2], [0, 5, 1], [2, 2, 2]];
  const nectar = [[1234.5, 17.25, 980.125], [0, 4410.75, 3.5], [77.7, 61.1, 1e6 / 3]];
  const pollen = [[333.3, 12, 7e4 / 9], [0, 1.5, 999.99], [2.2, 5555.5, 0.01]];
  const oldRoot = (v) => v.reduce((s, x) => s + Math.sqrt(Math.max(0, x)), 0);
  const was = (b, f) => [oldRoot(pollen.map((r) => r[f])), oldRoot(nectar[b])];
  const legacy = score([0, 1, 2], feeds, nectar, pollen, scoringOf(old));
  for (const [i, t] of legacy.entries()) assert.deepEqual([t.pollination, t.forage], was(i, i));
  assert.deepEqual(legacy, score([0, 1, 2], feeds, nectar, pollen), "score() without exponents is √ too");
  const now = score([0, 1, 2], feeds, nectar, pollen, scoringOf(fresh));
  assert.ok(now.every((t, i) => t.forage > legacy[i].forage && t.pollination > legacy[i].pollination));
});

test("the exponents and mode are config: each exponent in (0, 1], the mode \"final\" or \"timeAverage\", kept from the base when left out (a √ base stays √, a base without a mode time-average)", () => {
  assert.deepEqual(normalizeConfig({ scoring: { alpha: 0.6 } }).scoring, { alpha: 0.6, beta: 0.85, mode: "final" });
  assert.deepEqual(normalizeConfig({ scoring: { alpha: 1, beta: "0.3" } }).scoring, { alpha: 1, beta: 0.3, mode: "final" });
  assert.deepEqual(normalizeConfig({ scoring: { alpha: null, beta: "", mode: "" } }).scoring, { alpha: 0.85, beta: 0.85, mode: "final" });
  assert.deepEqual(normalizeConfig({ scoring: { mode: "timeAverage" } }).scoring, { alpha: 0.85, beta: 0.85, mode: "timeAverage" });
  for (const bad of ["window", "Final", 1, true, {}]) assert.throws(() => normalizeConfig({ scoring: { mode: bad } }), /scoring\.mode must be "final" or "timeAverage"/, String(bad));
  for (const bad of [0, -0.5, 1.01, 2, "x", NaN, Infinity, true, [0.5], {}]) {
    assert.throws(() => normalizeConfig({ scoring: { alpha: bad } }), /scoring\.alpha must be a number in \(0, 1\]/, String(bad));
    assert.throws(() => normalizeConfig({ scoring: { beta: bad } }), /scoring\.beta must be a number in \(0, 1\]/, String(bad));
  }
  // Updating a lobby game's settings keeps its exponents unless they are given.
  const base = normalizeConfig({ scoring: { alpha: 0.7, beta: 0.9, mode: "timeAverage" } });
  assert.deepEqual(normalizeConfig({ minutes: 3 }, base).scoring, { alpha: 0.7, beta: 0.9, mode: "timeAverage" });
  assert.deepEqual(normalizeConfig({ scoring: { beta: 0.4 } }, base).scoring, { alpha: 0.7, beta: 0.4, mode: "timeAverage" });
  const { scoring: _, ...old } = base;
  assert.deepEqual(normalizeConfig({ minutes: 3 }, old).scoring, { alpha: 0.5, beta: 0.5, mode: "timeAverage" }, "a config stored without them stays √, and time-average");
  const v3 = { ...base, scoring: { alpha: 0.85, beta: 0.85 } };
  assert.equal(normalizeConfig({ minutes: 3 }, v3).scoring.mode, "timeAverage", "a v3 config (exponents, no mode) stays time-average");
});
