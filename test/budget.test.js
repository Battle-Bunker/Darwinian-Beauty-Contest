// R, each flower call's hidden time budget (RULES.md "Energy"): drawn uniformly from [minMs, ms] for every
// call (minMs 2% of ms by default: 3 to 150 ms), the call's hard limit (and GAME.ms for it), the ceiling of its
// energy E = (cap − size) × max(0, R − CPU ms); the response still reaches the bee at the fixed 150 ms; the
// flower's team sees R during play, everyone after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, defaultMinMs, drawBudget, excessEnergy, normalizeConfig } from "../server/lib/gameConfig.js";
import { tryFlower } from "../server/engine.js";
import { actionView } from "../server/games.js";
import { mask } from "../server/query/mask.js";
import { play } from "./fixtures/garden.js";
import { size } from "../server/lib/measure.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");

test("R is drawn uniformly from [minMs, ms] (3 to 150 by default), independently per call", () => {
  const c = normalizeConfig({});
  assert.deepEqual([c.budgets.flower.minMs, c.budgets.flower.ms], [3, 150]);
  const draws = Array.from({ length: 20000 }, () => drawBudget(c));
  assert.ok(draws.every((r) => r >= 3 && r <= 150));
  const bins = Array(10).fill(0);
  for (const r of draws) bins[Math.min(9, Math.floor((r - 3) / 14.7))]++;
  for (const n of bins) assert.ok(n > 1700 && n < 2300, `uniform: ${bins}`);
  const mean = draws.reduce((s, r) => s + r, 0) / draws.length;
  assert.ok(Math.abs(mean - 76.5) < 1.5, `mean ${mean}`);
  // Configurable; minMs never above ms.
  const narrow = normalizeConfig({ budgets: { flower: { ms: 120, minMs: 100 } } });
  assert.ok(Array.from({ length: 1000 }, () => drawBudget(narrow)).every((r) => r >= 100 && r <= 120));
  assert.equal(normalizeConfig({ budgets: { flower: { ms: 80, minMs: 200 } } }).budgets.flower.minMs, 80);
  // E counts down from R: the same CPU costs the same energy whatever R is.
  assert.equal(excessEnergy(c, 100, 30, 90), 1000 * 60);
  assert.equal(excessEnergy(c, 100, 30, 140) - excessEnergy(c, 100, 0, 140), -1000 * 30);
  assert.equal(excessEnergy(c, 100, 95, 90), 0, "work past R: nothing");
});

test("R's floor: 2% of ms by default (at least 1 ms), following ms; a minMs that is set is kept, never above ms", () => {
  assert.equal(DEFAULT_CONFIG.budgets.flower.minMs, 3);
  assert.deepEqual([150, 300, 100, 75, 49, 10, 1].map(defaultMinMs), [3, 6, 2, 2, 1, 1, 1]);
  const floor = (cfg, base) => normalizeConfig(cfg, base).budgets.flower.minMs;
  assert.equal(floor({}), 3);
  assert.equal(floor({ budgets: { flower: { ms: 300 } } }), 6);
  assert.equal(floor({ budgets: { flower: { ms: 20 } } }), 1, "at least 1 ms");
  assert.equal(floor({ budgets: { flower: { ms: 150, minMs: 50 } } }), 50, "an explicit floor overrides the 2%");
  assert.equal(floor({ budgets: { flower: { minMs: 10 } } }), 10);
  assert.equal(floor({ budgets: { flower: { ms: 120, minMs: 500 } } }), 120, "never above ms");
  // Changing a lobby game's ms: a floor at its default follows; one that was set stays.
  const auto = normalizeConfig({});
  assert.equal(floor({ budgets: { flower: { ms: 250 } } }, auto), 5);
  assert.equal(floor({ minutes: 5 }, auto), 3);
  const set = normalizeConfig({ budgets: { flower: { minMs: 40 } } });
  assert.equal(floor({ budgets: { flower: { ms: 250 } } }, set), 40);
  assert.equal(floor({ budgets: { flower: { ms: 30 } } }, set), 30, "a set floor is still never above ms");
  // A stored config from before (minMs 50 with ms 150) keeps its 50.
  const before = { ...auto, budgets: { ...auto.budgets, flower: { ...auto.budgets.flower, minMs: 50 } } };
  assert.equal(floor({ minutes: 5 }, before), 50);
  // Draws respect it.
  const c = normalizeConfig({ budgets: { flower: { ms: 300 } } });
  const draws = Array.from({ length: 5000 }, () => drawBudget(c));
  assert.ok(draws.every((r) => r >= 6 && r <= 300));
  assert.ok(Math.min(...draws) < 10 && Math.max(...draws) > 290);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: each call's R is its hard limit and its GAME.ms; E = (cap − size) × (R − CPU ms); the bee still hears at 150 ms`, async () => {
    // The flower works 70 ms of CPU and reports the R it was told; the bee records when it is called.
    const flower = language === "python"
      ? `import time\ndef flower(c):\n    t = time.process_time()\n    while time.process_time() - t < 0.07:\n        pass\n    return GAME["ms"], 20\n`
      : `function flower(c: number): [number, number] { const t = performance.now(); while (performance.now() - t < 70) {} return [GAME.ms, 20]; }`;
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    return "leave", 1\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["leave", number] { return ["leave", 1]; }`;
    const config = normalizeConfig({ language, responseType: "float" });
    const out = await play(config, [{ flower, bee }], 40, null, { paced: true });
    const turns = ends(out.actions);
    assert.ok(turns.length >= 30, `${turns.length} turns`);
    const s = (await size(language, flower)).size;
    const done = turns.filter((t) => t.flowerError === null), late = turns.filter((t) => t.flowerError !== null);
    assert.ok(done.length >= 5 && late.length >= 5, `R both above and below 70 ms: ${done.length} answered, ${late.length} too slow`);
    for (const t of turns) {
      assert.ok(t.budgetMs >= 3 && t.budgetMs <= 150, `R ${t.budgetMs}`);
      assert.equal(t.atMs, (t.round - 1) * 200 + 150, "the turn ends at 150 ms, whatever R");
    }
    for (const t of done) {
      assert.equal(t.r, t.budgetMs, "the flower was told its R as GAME.ms");
      // (CPU time starts a moment before the limit's clock, so it can pass R by a hair; E is then 0.)
      assert.ok(t.ms < t.budgetMs + 5, `answered within R: ${t.ms} vs ${t.budgetMs}`);
      assert.equal(t.energy, excessEnergy(config, s, t.ms, t.budgetMs), "E counts down from R");
    }
    for (const t of late) {
      assert.match(t.flowerError, /Timeout/);
      assert.deepEqual([t.r, t.energy], [null, 0], "over R: no response, no energy");
      assert.ok(t.budgetMs < 100, `only a small R stops 70 ms of work: ${t.budgetMs}`);
    }
  });
}

test("who sees R: the flower's team during play, everyone after the game", () => {
  const leave = { seq: 9, at_ms: 550, round: 3, turn: 2, bee_team: "B", flower_team: "F", action: "leave", c: 5, r: 7, r_bytes: 1,
    percent: 25, energy: 1000, cpu_ms: 4, pollen: 0, nectar: null, bee_ms: 1, log: null, bee_version: 2, flower_version: 4, budget_ms: 77.5 };
  for (const [me, sees] of [["F", true], ["B", false], ["X", false], [undefined, false]]) {
    const v = actionView(leave, me, false, false);
    assert.equal("budgetMs" in v, sees, `team ${me}`);
    if (sees) assert.equal(v.budgetMs, 77.5);
    assert.equal(actionView(leave, me, true, false).budgetMs, 77.5, "after the game: everyone");
  }
  const t = { game: "g", seq: 9, round: 3, bee: 0, flower: 1, fed: true, ms: 4, budgetMs: 77.5 };
  assert.deepEqual([mask("turns", t, 1).budgetMs, mask("turns", t, 0).budgetMs, mask("turns", t, null).budgetMs], [77.5, null, null]);
  assert.equal(mask("turns", t, null, { over: true }).budgetMs, 77.5);
});

test("try a flower with budgetMs: a number, \"random\" (the default), or one per challenge; each result says its R", async () => {
  const config = normalizeConfig({ responseType: "float" });
  const code = `def flower(c):\n    return GAME["ms"], 10\n`;
  const fixed = await tryFlower({ config, code, challenges: [1, 2, 3], budgetMs: 80 });
  assert.deepEqual(fixed.results.map((x) => [x.budgetMs, x.r]), [[80, 80], [80, 80], [80, 80]]);
  const each = await tryFlower({ config, code, challenges: [1, 2, 3], budgetMs: [60, 120, 999] });
  assert.deepEqual(each.results.map((x) => x.budgetMs), [60, 120, 150], "clamped to [minMs, ms]");
  for (const x of each.results) assert.equal(x.energy, excessEnergy(config, each.size, x.ms, x.budgetMs));
  const random = await tryFlower({ config, code, challenges: Array.from({ length: 12 }, (_, i) => i) });
  // (At an R of a few ms even this flower can be late: then no answer.)
  assert.ok(random.results.every((x) => x.budgetMs >= 3 && x.budgetMs <= 150 && (x.r === x.budgetMs || /Timeout/.test(x.error))));
  assert.ok(random.results.filter((x) => x.r === x.budgetMs).length >= 9, "nearly every call answers");
  assert.ok(new Set(random.results.map((x) => x.budgetMs)).size > 6, "drawn per challenge");
  // A busy flower over its R times out, as in a game.
  const busy = await tryFlower({ config, code: `import time\ndef flower(c):\n    t = time.process_time()\n    while time.process_time() - t < 0.09:\n        pass\n    return 1, 10\n`, challenges: [1, 2], budgetMs: [60, 140] });
  assert.match(busy.results[0].error, /Timeout/);
  assert.equal(busy.results[0].energy, 0);
  assert.equal(busy.results[1].error, undefined);
});
