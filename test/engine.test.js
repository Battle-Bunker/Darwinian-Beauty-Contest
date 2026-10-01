import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateRound } from "../server/engine.js";
import { starters } from "./fixtures/programs.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";

for (const language of ["python", "typescript"]) {
  test(`${language}: round invariants hold`, async () => {
    const config = normalizeConfig({ language, turns: 60, feedCost: 4 });
    const s = starters(config);
    const teams = [0, 1, 2, 3].map((i) => ({ id: "t" + i, programs: s }));
    const r = await simulateRound({ config, teams, seed: 99 });
    for (let b = 0; b < teams.length; b++) {
      const vs = r.visits.filter((v) => v.bee === b).sort((x, y) => x.seq - y.seq);
      assert.ok(vs.length > 0);
      let t = 0;
      for (const v of vs) {
        assert.equal(v.start, t, "visits are contiguous in turn time");
        const cost = v.steps.length + (v.action === "feed" ? config.feedCost : 0) + (v.action !== "feed" && v.steps.length === 0 ? 1 : 0);
        assert.equal(v.end - v.start, cost, "turn accounting");
        if (v.action === "feed") assert.equal(v.nectar, v.kind === "clover");
        else assert.equal(v.nectar, null);
        t = v.end;
      }
      assert.ok(t <= config.turns);
      // Shuffled deck: every flower appears once before any repeats.
      const firstLap = vs.slice(0, 8).map((v) => `${v.patch}:${v.kind}`);
      assert.equal(new Set(firstLap).size, Math.min(8, vs.length));
    }
    const fed = r.visits.filter((v) => v.action === "feed");
    assert.equal(r.feeds.flat().reduce((a, b) => a + b, 0), fed.length);
    assert.equal(r.nectar.flat().reduce((a, b) => a + b, 0), fed.filter((v) => v.nectar).length);
  });
}

test("flowers are pure: no state survives between calls, randomness is fixed", async () => {
  const config = normalizeConfig({ turns: 40 });
  const counter = `import math\nn = 0\ndef flower(c):\n    global n\n    n += 1\n    math.k = getattr(math, "k", 0) + 1\n    return n * 1000 + math.k\n`;
  const rnd = `import random\ndef flower(c):\n    return random.randint(0, 10**9)\n`;
  // A bee that asks every flower three different questions, then leaves.
  const bee = `def forage(seen, t):\n    return ["ask", len(seen)] if len(seen) < 3 else "leave"\n`;
  const r = await simulateRound({ config, seed: 5, teams: [{ id: "a", programs: { clover: counter, orchid: rnd, bee } }] });
  for (const v of r.visits) {
    if (v.kind === "clover") assert.deepEqual(v.steps.map((s) => s.r), [1001, 1001, 1001]);
    else assert.equal(new Set(v.steps.map((s) => s.r)).size, 1);
  }
});
