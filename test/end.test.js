// The game's hidden end (RULES.md "The game"): `minutes` is the shortest a game lasts and endFactor × minutes
// the longest. At the start the server draws the end uniformly from that range, rounded up to a whole round
// (games.end_ms), and keeps it hidden: a team's views show the range and the time played, never the end or the
// time left, until the game is over. A config stored without endFactor ends at `minutes`, as before.
// (That nothing a team can read carries it: test/query.test.js, against a database.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, drawEndMs, endFactorOf, lengthOf, normalizeConfig, roundMs } from "../server/lib/gameConfig.js";
import { timingOf } from "../server/games.js";
import { play } from "./fixtures/garden.js";
import { starters } from "./fixtures/programs.js";
import { CLASSIC, classic } from "./fixtures/classic.js";

let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("new games last 5 to 10 minutes; endFactor is config (1 to 100, kept from the base); a config stored without it ends at minutes", () => {
  assert.deepEqual([DEFAULT_CONFIG.minutes, DEFAULT_CONFIG.endFactor], [5, 2]);
  const d = normalizeConfig({});
  assert.deepEqual([d.minutes, d.endFactor, lengthOf(d)], [5, 2, { minMs: 300000, maxMs: 600000 }]);
  assert.deepEqual([normalizeConfig({ endFactor: 0.5 }).endFactor, normalizeConfig({ endFactor: 1e9 }).endFactor, normalizeConfig({ endFactor: "x" }).endFactor], [1, 100, 2]);
  assert.equal(normalizeConfig({ minutes: 3 }, normalizeConfig({ endFactor: 4 })).endFactor, 4, "kept from the base");
  const old = { ...CLASSIC, minutes: 3 }; // as stored
  assert.ok(!("endFactor" in old));
  assert.deepEqual([endFactorOf(old), lengthOf(old)], [1, { minMs: 180000, maxMs: 180000 }]);
  assert.equal(normalizeConfig({ minutes: 4 }, old).endFactor, 1, "an old config, edited, keeps its fixed end");
});

test("the end is drawn uniformly from [minutes, endFactor × minutes], rounded up to a whole round", () => {
  const config = normalizeConfig({ minutes: 5, endFactor: 2 });
  const r = roundMs(config), n = 40000, draws = [];
  for (let i = 0; i < n; i++) draws.push(drawEndMs(config, rand));
  assert.ok(draws.every((x) => x >= 300000 && x <= 600000 && x % r === 0), "in range, whole rounds");
  // Uniform: the mean, the spread and each tenth of the range get their share.
  const mean = draws.reduce((a, b) => a + b, 0) / n;
  assert.ok(Math.abs(mean - 450000) < 3000, `mean ${mean}`);
  const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  assert.ok(Math.abs(sd - 300000 / Math.sqrt(12)) < 2000, `sd ${sd}`);
  const tenths = new Array(10).fill(0);
  for (const x of draws) tenths[Math.min(9, Math.floor((x - 300000) / 30000))]++;
  assert.ok(tenths.every((k) => Math.abs(k / n - 0.1) < 0.01), `${tenths}`);
  // The ends of the range, and a fixed end.
  assert.deepEqual([drawEndMs(config, () => 0), drawEndMs(config, () => 0.5), drawEndMs(config, () => 1 - 1e-12)], [300000, 450000, 600000]);
  assert.equal(drawEndMs(normalizeConfig({ minutes: 5, endFactor: 1 }), rand), 300000);
  assert.equal(drawEndMs({ ...CLASSIC, minutes: 3 }, rand), 180000, "a config without endFactor: minutes exactly");
  assert.equal(drawEndMs(normalizeConfig({ minutes: 0.34, endFactor: 1 }), rand), 20400);
  assert.equal(drawEndMs(normalizeConfig({ minutes: 0.341, endFactor: 1 }), rand), 20600, "rounded up to the round in progress");
});

test("timingOf: the range is public; the end is null while hidden (lobby, running, paused) and revealed once finished; a fixed end shows all along; the owner's flag adds drawnEndMs", () => {
  const config = normalizeConfig({ minutes: 5, endFactor: 2 });
  const g = (status, end_ms = 437400, cfg = config) => ({ status, config: cfg, end_ms });
  for (const status of ["lobby", "running", "paused"]) {
    assert.deepEqual(timingOf(g(status)), { minMs: 300000, maxMs: 600000, endMs: null }, status);
    assert.deepEqual(timingOf(g(status), true), { minMs: 300000, maxMs: 600000, endMs: null, drawnEndMs: 437400 }, `${status}, the owner`);
  }
  assert.deepEqual(timingOf(g("lobby", null), true).drawnEndMs, null, "not drawn before the start");
  assert.deepEqual(timingOf(g("finished")), { minMs: 300000, maxMs: 600000, endMs: 437400 });
  // Fixed ends: endFactor 1, or an old config (no endFactor, no end_ms): the end is minutes, and public.
  const fixed = normalizeConfig({ minutes: 5, endFactor: 1 });
  assert.deepEqual(timingOf(g("running", 300000, fixed)), { minMs: 300000, maxMs: 300000, endMs: 300000 });
  assert.deepEqual(timingOf(g("running", null, classic({ minutes: 2 }))), { minMs: 120000, maxMs: 120000, endMs: 120000 });
  assert.deepEqual(timingOf(g("finished", null, classic({ minutes: 2 }))), { minMs: 120000, maxMs: 120000, endMs: 120000 });
});

test("a garden stops at its end, on a round boundary: the drawn end is the clock it finishes at", async () => {
  const config = normalizeConfig({ minutes: 5, endFactor: 2, feedPrice: 0 });
  const teams = [starters(config, "A"), starters(config, "B")];
  const end = drawEndMs(normalizeConfig({ minutes: 0.1, endFactor: 2 }), () => 0.37); // 6 s to 12 s: 8,220 ms, rounded up to 8,400
  assert.equal(end, 8400);
  const out = await play(config, teams, Infinity, null, { endMs: end });
  assert.deepEqual([out.clockMs, out.round], [8400, 42], "it ran to the drawn end exactly, and no further");
});
