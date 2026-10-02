import { test } from "node:test";
import assert from "node:assert/strict";
import { rootsum, score } from "../server/lib/scoring.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("rootsum rewards spreading", () => {
  close(rootsum([4, 0, 0, 0]), 2);
  close(rootsum([1, 1, 1, 1]), 4);
});

test("a perfectly even game scores par 1 for everyone, at any N", () => {
  for (const n of [2, 3, 7, 12]) {
    const flat = Array.from({ length: n }, () => new Array(n).fill(3));
    for (const s of score([...Array(n).keys()], flat, flat)) {
      close(s.fitness, 1);
      close(s.allureShare, 1 / n);
    }
  }
});

test("fitness = N² × allure share × forage share, own patch counts, nothing earned = par", () => {
  const feeds = [[2, 1, 0], [0, 0, 4], [1, 1, 1]];
  const nectar = [[1, 1, 0], [0, 0, 2], [1, 0, 0]];
  const s = score(["a", "b", "c"], feeds, nectar);
  // allure is per column, forage per row.
  close(s[0].allure, Math.SQRT2 + 0 + 1);
  close(s[1].forage, Math.SQRT2);
  const totA = s.reduce((x, t) => x + t.allure, 0), totF = s.reduce((x, t) => x + t.forage, 0);
  for (const t of s) close(t.fitness, 9 * (t.allure / totA) * (t.forage / totF));
  assert.equal(s[0].pollinators, 2);
  assert.equal(s[2].nectarSources, 1);
  const zero = [[0, 0], [0, 0]];
  for (const t of score(["a", "b"], zero, zero)) close(t.fitness, 1);
});
