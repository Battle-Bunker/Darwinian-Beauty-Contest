// Darwinian fitness = N³ × allure share × forage share × surplus share (server/lib/scoring.js).
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
      close(s.allureShare, 1 / n);
      close(s.forageShare, 1 / n);
      close(s.surplusShare, 1 / n);
    }
  }
});

test("allure from the feed columns, forage from the nectar rows, surplus from the surplus columns; own cells count", () => {
  // rows: bee team; columns: flower team
  const feeds = [[2, 1, 0], [0, 0, 4], [1, 1, 1]];
  const nectar = [[100, 25, 0], [0, 0, 400], [9, 0, 0]];
  const surplus = [[50, 75, 0], [0, 0, 100], [1, 30, 20]];
  const s = score(["a", "b", "c"], feeds, nectar, surplus);
  close(s[0].allure, Math.SQRT2 + 0 + 1);
  close(s[2].allure, 0 + 2 + 1);
  close(s[0].forage, 10 + 5);
  close(s[1].forage, 20);
  close(s[2].forage, 3);
  assert.deepEqual(s.map((t) => t.surplus), [51, 105, 120]);
  const tot = (k) => s.reduce((x, t) => x + t[k], 0);
  for (const t of s) {
    close(t.allureShare, t.allure / tot("allure"));
    close(t.forageShare, t.forage / tot("forage"));
    close(t.surplusShare, t.surplus / tot("surplus"));
    close(t.fitness, 27 * t.allureShare * t.forageShare * t.surplusShare);
  }
  assert.deepEqual(s.map((t) => [t.feedsReceived, t.feedsGiven, t.pollinators]), [[3, 3, 2], [2, 4, 2], [5, 3, 2]]);
  assert.deepEqual(s.map((t) => [t.nectarCollected, t.nectarGiven, t.nectarSources]), [[125, 109, 2], [400, 25, 1], [9, 400, 1]]);
});

test("a term whose total is 0 gives every team a share of 1/N", () => {
  const zero = fill(2, 0);
  for (const t of score(["a", "b"], zero, zero, zero)) {
    close(t.fitness, 1);
    close(t.allureShare, 0.5);
  }
  // Feeds happened but every flower gave all its energy away (no surplus anywhere) and nobody fed at b.
  const s = score(["a", "b"], [[2, 0], [2, 0]], [[50, 0], [10, 0]], zero);
  assert.deepEqual(s.map((t) => t.surplusShare), [0.5, 0.5]);
  assert.deepEqual(s.map((t) => t.allureShare), [1, 0]);
  close(s[0].fitness, 8 * 1 * (Math.sqrt(50) / (Math.sqrt(50) + Math.sqrt(10))) * 0.5);
  assert.equal(s[1].fitness, 0);
});
