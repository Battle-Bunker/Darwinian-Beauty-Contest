// The continuous garden (server/engine.js): round-robin turns, the visit rules, stateless flowers,
// bees that keep their state until replaced, instant swaps, and the game clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Garden, tryFlower } from "../server/engine.js";
import { starters } from "./fixtures/programs.js";
import { play } from "./fixtures/garden.js";
import { DEFAULT_CONFIG, available, normalizeConfig } from "../server/lib/gameConfig.js";

/** How many turns an action costs. */
const turnsOf = (a, feedCost, visitAsked) =>
  a.action === "ask" || a.action === "error" ? 1 : a.action === "feed" ? feedCost : a.action === "leave" && !visitAsked && !a.by ? 1 : 0;

for (const language of ["python", "typescript"]) {
  test(`${language}: round robin: every bee's turns add up to the cycles played`, async () => {
    const config = normalizeConfig({ language, feedCost: 4 });
    const s = starters(config);
    const out = await play(config, [s, s, s, s], 120);
    assert.equal(out.cycles, 120);
    for (let b = 0; b < 4; b++) {
      const mine = out.actions.filter((a) => a.bee === b);
      assert.ok(mine.length > 10, `bee ${b} acted ${mine.length} times`);
      let used = 0;
      const asked = new Map();
      for (const a of mine) {
        used += turnsOf(a, config.feedCost, asked.get(a.visit));
        if (a.action === "ask") asked.set(a.visit, true);
        if (a.action === "feed") assert.equal(a.nectar, a.kind === "clover");
      }
      // A feed's turns may run past the last cycle.
      assert.ok(used >= out.cycles && used <= out.cycles + config.feedCost - 1, `bee ${b}: ${used} turns in ${out.cycles} cycles`);
      // A shuffled deck: every flower comes up once before any comes up again.
      const firstLap = [...new Map(mine.map((a) => [a.visit, `${a.patch}:${a.kind}`])).values()].slice(0, 8);
      assert.equal(new Set(firstLap).size, 8);
    }
    const seqs = out.actions.map((a) => a.seq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "actions are numbered in order");
    const feeds = out.actions.filter((a) => a.action === "feed");
    assert.equal(out.feeds.flat().reduce((a, b) => a + b, 0), feeds.length);
    assert.equal(out.nectar.flat().reduce((a, b) => a + b, 0), feeds.filter((a) => a.nectar).length);
  });
}

test("a bee can keep asking after it feeds; feeding again just moves on", async () => {
  const bee = `def forage(seen, visit):
    if not visit["fed"]:
        return ["ask", 1] if not seen else "feed"
    if len(seen) < 3:
        return ["ask", len(seen) + 10]
    return "feed" if visit["nectar"] is False else "leave"
`;
  const config = normalizeConfig({ feedCost: 5 });
  const out = await play(config, [{ clover: `def flower(c):\n    return c * 2\n`, orchid: `def flower(c):\n    return c * 3\n`, bee }], 40);
  for (const kind of ["clover", "orchid"]) {
    const visit = out.actions.find((a) => a.kind === kind && a.action === "feed").visit;
    const steps = out.actions.filter((a) => a.visit === visit);
    assert.deepEqual(steps.map((a) => [a.action, a.c ?? null, !!a.after]),
      [["ask", 1, false], ["feed", null, false], ["ask", 11, true], ["ask", 12, true], ["leave", null, false]]);
    assert.equal(steps[1].nectar, kind === "clover");
  }
});

for (const language of ["python", "typescript"]) {
  test(`${language}: flowers are stateless: fresh randomness, a clock, their own budget, no answer cache`, async () => {
    const config = normalizeConfig({ language });
    const py = {
      counter: `import math\nn = 0\ndef flower(c):\n    global n\n    n += 1\n    math.k = getattr(math, "k", 0) + 1\n    return n * 1000 + math.k\n`,
      // An anytime search: keep drawing until most of the budget is gone, return the best draw.
      anytime: `import random, time\ndef flower(c):\n    t0 = time.perf_counter()\n    best = 0\n    while time.perf_counter() - t0 < 0.6 * GAME["ms"] / 1000:\n        best = max(best, random.randint(0, 10**9))\n    return best\n`,
      bee: `def forage(seen):\n    return ["ask", 7] if len(seen) < 3 else "leave"\n`,
    };
    const ts = {
      counter: `let n = 0;\nfunction flower(c: number): number { n += 1; (Math as any).k = ((Math as any).k || 0) + 1; return n * 1000 + (Math as any).k; }\n`,
      anytime: `function flower(c: number): number {\n  const t0 = Date.now(); let best = 0;\n  while (Date.now() - t0 < 0.6 * GAME.ms) best = Math.max(best, Math.floor(Math.random() * 1e9));\n  return best;\n}\n`,
      bee: `function forage(seen: any[]) { return seen.length < 3 ? ["ask", 7] : "leave"; }\n`,
    };
    const p = language === "python" ? py : ts;
    const out = await play(config, [{ clover: p.counter, orchid: p.anytime, bee: p.bee }], 24);
    const asks = out.actions.filter((a) => a.action === "ask");
    for (const a of asks) assert.equal(a.error, null, a.error);
    for (const a of asks.filter((a) => a.kind === "clover")) assert.equal(a.r, 1001, "nothing survives between calls");
    const orchid = asks.filter((a) => a.kind === "orchid");
    assert.ok(orchid.length >= 6);
    assert.ok(new Set(orchid.map((a) => a.r)).size >= orchid.length - 1, "the same question gets a fresh answer every call");
    assert.ok(orchid.reduce((s, a) => s + a.ms, 0) / orchid.length >= 25, "the orchid searched for most of its 50 ms");
  });
}

test("programs run minified: the names they define can't carry data", async () => {
  const config = normalizeConfig({ responseType: "any" });
  const helper = (name) => `def ${name}():\n    return 0\ndef flower(c):\n    return [len(${name}.__name__), sorted(k for k in globals() if not k.startswith("__"))]\n`;
  const bee = `def forage(seen):\n    return ["ask", 1] if not seen else "leave"\n`;
  const answers = async (code) => {
    const out = await play(config, [{ clover: code, orchid: code, bee }], 6);
    return new Set(out.actions.filter((a) => a.action === "ask").map((a) => JSON.stringify(a.r)));
  };
  const long = await answers(helper("a_helper_with_a_very_long_and_meaningful_name"));
  assert.equal(long.size, 1);
  const [nameLength, globalNames] = JSON.parse([...long][0]);
  assert.equal(nameLength, 1);
  assert.ok(globalNames.every((k) => ["GAME", "flower"].includes(k) || k.length === 1), globalNames.join());
  assert.deepEqual([...await answers(helper("h"))], [...long]);
});

test("compute budgets are per program: a clover can be given far more compute than an orchid", async () => {
  const busy = `def flower(c):\n    x = 0\n    for i in range(1_400_000):\n        x = (x + i * c) % 1000003\n    return x\n`;
  const bee = `def forage(seen):\n    return "leave" if seen else ["ask", 3]\n`;
  const config = normalizeConfig({ budgets: { clover: { ms: 400 }, orchid: { ms: 50 } } });
  const out = await play(config, [{ clover: busy, orchid: busy, bee }], 2);
  const byKind = Object.fromEntries(out.actions.filter((a) => a.action === "ask").map((a) => [a.kind, a]));
  assert.equal(typeof byKind.clover.r, "number", JSON.stringify(byKind.clover));
  assert.match(byKind.orchid.error, /Timeout/);
  assert.equal(byKind.orchid.by, "flower");
  assert.ok(byKind.clover.ms > 50);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: a bee keeps its state until new code replaces it; the new code goes live at once`, async () => {
    const config = normalizeConfig({ language });
    const py = {
      clover: (k) => `def flower(c):\n    return ${k}\n`,
      bee: `n = 0\ndef forage(seen):\n    global n\n    if seen:\n        return "leave"\n    n += 1\n    return ["ask", n]\n`,
    };
    const ts = {
      clover: (k) => `function flower(c: number) { return ${k}; }`,
      bee: `let n = 0;\nfunction forage(seen: any[]) { if (seen.length) return "leave"; n += 1; return ["ask", n]; }\n`,
    };
    const p = language === "python" ? py : ts;
    const out = await play(config, [{ clover: p.clover(1), orchid: p.clover(2), bee: p.bee }], 60, async (garden) => {
      while (garden.cycles < 20) await new Promise((r) => setTimeout(r, 5));
      await garden.setProgram(0, "clover", p.clover(3), 2);
      await garden.setProgram(0, "bee", p.bee, 2);
    });
    const asks = out.actions.filter((a) => a.action === "ask");
    const v1 = asks.filter((a) => a.beeVersion === 1), v2 = asks.filter((a) => a.beeVersion === 2);
    assert.ok(v1.length > 5 && v2.length > 5, `${v1.length} then ${v2.length}`);
    assert.deepEqual(v1.map((a) => a.c), v1.map((_, i) => i + 1), "the bee remembers between calls");
    assert.deepEqual(v2.map((a) => a.c), v2.map((_, i) => i + 1), "new code starts afresh");
    const clover = asks.filter((a) => a.kind === "clover");
    assert.ok(clover.some((a) => a.flowerVersion === 1 && a.r === 1) && clover.some((a) => a.flowerVersion === 2 && a.r === 3));
    assert.ok(clover.every((a) => a.r === (a.flowerVersion === 1 ? 1 : 3)), "each answer comes from the version it's labelled with");
    const swap = out.actions.find((a) => a.by === "engine");
    if (swap) assert.equal(swap.action, "leave", "the visit the old bee was on ends");
  });
}

test("a broken bee: mistakes cost a turn and end the visit; a crash restarts it afresh", async () => {
  const config = normalizeConfig({});
  const bee = `n = 0\ndef forage(seen):\n    global n\n    n += 1\n    if n == 3:\n        return "dance"\n    if n == 6:\n        while True:\n            pass\n    return ["ask", n] if not seen else "leave"\n`;
  const out = await play(config, [{ clover: `def flower(c):\n    return c\n`, orchid: `def flower(c):\n    return -c\n`, bee }], 30);
  const errors = out.actions.filter((a) => a.action === "error");
  assert.match(errors[0].error, /forage must return/);
  assert.match(errors[1].error, /Timeout/);
  assert.ok(out.actions.filter((a) => a.action === "ask").length > 5, "it carries on");
  assert.ok(out.problems.some((p) => p.kind === "bee"));
  // A bee that can't even load sits out until its team sends new code.
  const dud = await play(config, [{ clover: `def flower(c):\n    return c\n`, orchid: `def flower(c):\n    return -c\n`, bee: `import os\n` + bee }], 5);
  assert.equal(dud.actions.length, 0);
  assert.match(dud.problems[0].error, /not allowed/);
});

test("the clock: game time runs while playing, stops while paused, and ends the game", async () => {
  const config = normalizeConfig({});
  const s = starters(config);
  const garden = new Garden({ config, teams: 2, endMs: 1200 });
  await Promise.all([0, 1].flatMap((ti) => Object.entries(s).map(([k, code]) => garden.setProgram(ti, k, code, 1))));
  const t0 = Date.now();
  const run = garden.run();
  await new Promise((r) => setTimeout(r, 300));
  garden.pause();
  const paused = garden.clockMs();
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(Math.abs(garden.clockMs() - paused) < 1, "the clock stands still while paused");
  garden.resume();
  await run;
  const { clockMs, actions } = garden.drain();
  assert.ok(clockMs >= 1200 && clockMs < 1700, `ended at ${clockMs} ms of game time`);
  assert.ok(Date.now() - t0 >= 1600, "the pause didn't count");
  assert.ok(actions.length > 10);
  assert.ok(actions.every((a, i) => i === 0 || a.atMs >= actions[i - 1].atMs));
});

test("change budgets accrue per minute of game time up to a cap", () => {
  const { clover, orchid, bee } = DEFAULT_CONFIG.budgets;
  assert.equal(clover.size * 2, orchid.size);
  assert.equal(bee.size, 5 * orchid.size);
  assert.equal(clover.ms, 3 * orchid.ms);
  assert.equal(orchid.perMinute, 7 * clover.perMinute);
  for (const b of [clover, orchid, bee]) assert.equal(b.cap, 10 * b.perMinute, "ten minutes' worth");
  assert.equal(available(clover, { bank: 0, atMs: 0 }, 60000), 22);
  assert.equal(available(clover, { bank: 5, atMs: 60000 }, 90000), 16);
  assert.equal(available(clover, { bank: 0, atMs: 0 }, 3600000), 220);
});

test("try a flower: answers and timings", async () => {
  const config = normalizeConfig({});
  const r = await tryFlower({ config, kind: "clover", code: `def flower(c):\n    return c + 1\n`, challenges: [1, 2, "x"] });
  assert.deepEqual(r.results.map((x) => x.r), [2, 3, null]);
  assert.ok(r.results[2].error);
});
