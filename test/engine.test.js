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

test("pure flowers (old rules): no state survives between calls, randomness is fixed", async () => {
  const config = normalizeConfig({ turns: 40, pureFlowers: true });
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

for (const language of ["python", "typescript"]) {
  test(`${language}: flowers are stateless but not pure: fresh randomness, a clock, their own budget`, async () => {
    const config = normalizeConfig({ language, turns: 60 });
    const py = {
      counter: `import math\nn = 0\ndef flower(c):\n    global n\n    n += 1\n    math.k = getattr(math, "k", 0) + 1\n    return n * 1000 + math.k\n`,
      // An anytime search: keep drawing until most of the budget is gone, return the best draw.
      anytime: `import random, time\ndef flower(c):\n    t0 = time.perf_counter()\n    best = 0\n    while time.perf_counter() - t0 < 0.6 * GAME["ms"] / 1000:\n        best = max(best, random.randint(0, 10**9))\n    return best\n`,
      bee: `def forage(seen, t):\n    return ["ask", 7] if len(seen) < 3 else "leave"\n`,
    };
    const ts = {
      counter: `let n = 0;\nfunction flower(c: number): number { n += 1; (Math as any).k = ((Math as any).k || 0) + 1; return n * 1000 + (Math as any).k; }\n`,
      anytime: `function flower(c: number): number {\n  const t0 = Date.now(); let best = 0;\n  while (Date.now() - t0 < 0.6 * GAME.ms) best = Math.max(best, Math.floor(Math.random() * 1e9));\n  return best;\n}\n`,
      bee: `function forage(seen: any[], t: number) { return seen.length < 3 ? ["ask", 7] : "leave"; }\n`,
    };
    const p = language === "python" ? py : ts;
    const r = await simulateRound({ config, seed: 5, teams: [{ id: "a", programs: { clover: p.counter, orchid: p.anytime, bee: p.bee } }] });
    const answers = new Set();
    for (const v of r.visits) {
      for (const s of v.steps) assert.equal(s.flowerError, undefined, s.flowerError);
      if (v.kind === "clover") assert.deepEqual(v.steps.map((s) => s.r), [1001, 1001, 1001], "nothing survives between calls");
      else v.steps.forEach((s) => answers.add(s.r));
    }
    // The same question (7) gets a different answer on (almost) every call: no per-round answer cache.
    const orchidAsks = r.visits.filter((v) => v.kind === "orchid").reduce((a, v) => a + v.steps.length, 0);
    assert.ok(orchidAsks >= 6 && answers.size >= orchidAsks - 1, `${answers.size} distinct of ${orchidAsks}`);
    // The orchid searched for most of its own 50 ms budget on every call.
    assert.equal(r.compute[0].orchid.calls, orchidAsks);
    assert.ok(r.compute[0].orchid.meanMs >= 25, `mean ${r.compute[0].orchid.meanMs} ms`);
  });
}

test("pure flowers can't read the clock", async () => {
  const config = normalizeConfig({ turns: 20, pureFlowers: true });
  const clock = `import time\ndef flower(c):\n    return int(time.time())\n`;
  const bee = `def forage(seen, t):\n    return ["ask", 1] if not seen else "leave"\n`;
  const r = await simulateRound({ config, seed: 1, teams: [{ id: "a", programs: { clover: clock, orchid: clock, bee } }] });
  assert.match(r.problems[0].clover, /not allowed/);
});
