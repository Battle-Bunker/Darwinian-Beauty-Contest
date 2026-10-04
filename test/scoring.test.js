// Darwinian fitness = N² × pollination share × forage share (server/lib/scoring.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rootsum, score } from "../server/lib/scoring.js";

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

test("pollination from the surplus columns, forage from the nectar rows; own cells count", () => {
  // rows: bee team; columns: flower team
  const feeds = [[2, 1, 0], [0, 0, 4], [1, 1, 1]];
  const nectar = [[100, 25, 0], [0, 0, 400], [9, 0, 0]];
  const surplus = [[64, 81, 0], [0, 0, 100], [1, 0, 25]];
  const s = score(["a", "b", "c"], feeds, nectar, surplus);
  close(s[0].pollination, 8 + 0 + 1);
  close(s[1].pollination, 9);
  close(s[2].pollination, 0 + 10 + 5);
  close(s[0].forage, 10 + 5);
  close(s[1].forage, 20);
  close(s[2].forage, 3);
  assert.deepEqual(s.map((t) => t.surplus), [65, 81, 125]);
  const tot = (k) => s.reduce((x, t) => x + t[k], 0);
  for (const t of s) {
    close(t.pollinationShare, t.pollination / tot("pollination"));
    close(t.forageShare, t.forage / tot("forage"));
    close(t.fitness, 9 * t.pollinationShare * t.forageShare);
    for (const gone of ["allure", "allureShare", "surplusShare"]) assert.ok(!(gone in t), `${gone} is no longer a score term`);
  }
  assert.deepEqual(s.map((t) => [t.feedsReceived, t.feedsGiven, t.pollinators]), [[3, 3, 2], [2, 4, 2], [5, 3, 2]]);
  assert.deepEqual(s.map((t) => [t.nectarCollected, t.nectarGiven, t.nectarSources]), [[125, 109, 2], [400, 25, 1], [9, 400, 1]]);
});

test("rootsum over the surplus column rewards being pollinated by many teams", () => {
  // Both flowers kept 400 in all; one from a single bee team, one spread over four.
  const surplus = [[400, 100, 0, 0], [0, 100, 0, 0], [0, 100, 0, 0], [0, 100, 0, 0]];
  const s = score([0, 1, 2, 3], surplus.map((r) => r.map((x) => (x ? 1 : 0))), surplus, surplus);
  close(s[0].pollination, 20);
  close(s[1].pollination, 40);
  assert.equal(s[0].surplus, s[1].surplus);
});

test("a term whose total is 0 gives every team a share of 1/N", () => {
  const zero = fill(2, 0);
  for (const t of score(["a", "b"], zero, zero, zero)) {
    close(t.fitness, 1);
    close(t.pollinationShare, 0.5);
    close(t.forageShare, 0.5);
  }
  // Feeds happened but every flower gave all its energy away: no surplus anywhere.
  const s = score(["a", "b"], [[2, 0], [2, 0]], [[50, 0], [10, 0]], zero);
  assert.deepEqual(s.map((t) => t.pollinationShare), [0.5, 0.5]);
  close(s[0].fitness, 4 * 0.5 * (Math.sqrt(50) / (Math.sqrt(50) + Math.sqrt(10))));
  // No nectar anywhere: every bee gets 1/N of forage.
  const t = score(["a", "b"], [[1, 0], [0, 0]], zero, [[9, 0], [0, 0]]);
  assert.deepEqual(t.map((x) => x.forageShare), [0.5, 0.5]);
  assert.deepEqual(t.map((x) => x.pollinationShare), [1, 0]);
  assert.deepEqual(t.map((x) => x.fitness), [2, 0]);
});
