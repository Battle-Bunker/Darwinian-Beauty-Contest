// The continuous garden (server/engine.js): lockstep rounds of one action slot per bee, queued
// challenges, answers delivered at the end of the flower window, the bees' 50 ms decision deadline with
// late replies and re-requests, stateless flowers, bees that keep their state until replaced, instant
// swaps, pacing and the game clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Garden, tryBee, tryFlower } from "../server/engine.js";
import { starters } from "./fixtures/programs.js";
import { play } from "./fixtures/garden.js";
import { DEFAULT_CONFIG, available, normalizeConfig, roundMs } from "../server/lib/gameConfig.js";

const SLOT = new Set(["ask", "feed"]);
const byBee = (actions, b) => actions.filter((a) => a.bee === b);
const slots = (actions, b) => byBee(actions, b).filter((a) => SLOT.has(a.action));
const tooSlow = (a) => a.action === "error" && /too slow/.test(a.error);
const busy = (ms) => `t = time.perf_counter()\n        while time.perf_counter() - t < ${ms / 1000}:\n            pass\n`;
const flowers = { cosmos: `def flower(c):\n    return c + 1\n`, orchid: `def flower(c):\n    return c + 2\n` };
const tsFlowers = { cosmos: `function flower(c: number) { return c + 1; }`, orchid: `function flower(c: number) { return c + 2; }` };

test("defaults: 150 ms flower window, an orchid limit below it, 50 ms bee decisions, 200 ms rounds", () => {
  const { cosmos, orchid, bee } = DEFAULT_CONFIG.budgets;
  assert.deepEqual([cosmos.ms, orchid.ms, bee.ms], [150, 100, 50]);
  assert.equal(roundMs(DEFAULT_CONFIG), 200);
  assert.equal(DEFAULT_CONFIG.feedCost, 10);
  assert.equal(DEFAULT_CONFIG.minutes, 2);
  // the orchid's limit is clamped to the cosmos's
  assert.equal(normalizeConfig({ budgets: { orchid: { ms: 500 } } }).budgets.orchid.ms, 150);
  assert.equal(normalizeConfig({ budgets: { cosmos: { ms: 80 } } }).budgets.orchid.ms, 80);
  assert.equal(normalizeConfig({ budgets: { orchid: { ms: 60 } } }).budgets.orchid.ms, 60);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: lockstep: at most one ask or feed per bee per round; a feed sits the bee out for exactly feedCost rounds`, async () => {
    const config = normalizeConfig({ language, feedCost: 4 });
    const s = starters(config);
    const out = await play(config, [s, s, s, s], 120);
    assert.equal(out.rounds, 120);
    assert.equal(out.round, 120);
    assert.equal(out.clockMs, 120 * 200, "game time is rounds × 200 ms");
    assert.deepEqual(out.problems, []);
    for (let b = 0; b < 4; b++) {
      const mine = slots(out.actions, b);
      assert.ok(mine.length > 30, `bee ${b} acted ${mine.length} times`);
      const rounds = mine.map((a) => a.round);
      assert.equal(new Set(rounds).size, rounds.length, "one action slot per round");
      // Every round it isn't feeding, it acts: these bees always have a challenge queued in time.
      let expect = 1;
      for (const a of mine) {
        assert.equal(a.round, expect, `bee ${b}: ${a.action} in round ${a.round}`);
        expect = a.round + 1 + (a.action === "feed" ? config.feedCost : 0);
        if (a.action === "feed") assert.equal(a.nectar, a.kind === "cosmos");
      }
      // A shuffled deck: every flower comes up once before any comes up again.
      const firstLap = [...new Map(mine.map((a) => [a.visit, `${a.patch}:${a.kind}`])).values()].slice(0, 8);
      assert.equal(new Set(firstLap).size, 8);
    }
    // Slot actions happen at the round's start; leaves are decided at the end of the flower window.
    for (const a of out.actions) assert.equal(a.atMs, (a.round - 1) * 200 + (SLOT.has(a.action) ? 0 : 150), JSON.stringify(a));
    assert.ok(out.actions.every((a, i) => i === 0 || a.atMs >= out.actions[i - 1].atMs));
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
  const out = await play(config, [{ ...flowers, bee }], 40);
  for (const kind of ["cosmos", "orchid"]) {
    const visit = out.actions.find((a) => a.kind === kind && a.action === "feed").visit;
    const steps = out.actions.filter((a) => a.visit === visit);
    assert.deepEqual(steps.map((a) => [a.action, a.c ?? null, !!a.after]),
      [["ask", 1, false], ["feed", null, false], ["ask", 11, true], ["ask", 12, true], ["leave", null, false]]);
    assert.equal(steps[1].nectar, kind === "cosmos");
    assert.equal(steps[1].round, steps[0].round + 1);
    assert.equal(steps[2].round, steps[1].round + 1 + config.feedCost, "after feeding, the bee sits out feedCost rounds");
  }
});

for (const language of ["python", "typescript"]) {
  test(`${language}: ["leave", c] asks c first at the next flower, without losing a slot`, async () => {
    // Its challenges encode how many steps it has seen at this flower: the runner's `seen` starts afresh
    // at every flower, whether the bee got there by ["leave", c] or by a request for a first challenge.
    const bee = language === "python"
      ? `n = 0\ndef forage(seen, visit):\n    global n\n    n += 1\n    if not seen:\n        return ["ask", 1000 + n]\n    if len(seen) < 2:\n        return ["ask", 100 * len(seen) + n]\n    return ["leave", 100 * len(seen) + n]\n`
      : `let n = 0;\nfunction forage(seen: any[], visit: any) {\n  n += 1;\n  if (!seen.length) return ["ask", 1000 + n];\n  if (seen.length < 2) return ["ask", 100 * seen.length + n];\n  return ["leave", 100 * seen.length + n];\n}\n`;
    const out = await play(normalizeConfig({ language }), [{ ...(language === "python" ? flowers : tsFlowers), bee }], 12);
    const asks = out.actions.filter((a) => a.action === "ask");
    assert.deepEqual(asks.map((a) => a.c), [1001, 102, 203, 104, 205, 106, 207, 108, 209, 110, 211, 112]);
    assert.deepEqual(asks.map((a) => a.round), asks.map((_, i) => i + 1), "a slot every round");
    const visits = [...new Set(asks.map((a) => a.visit))];
    assert.equal(visits.length, 6);
    for (const v of visits) assert.equal(asks.filter((a) => a.visit === v).length, 2);
    const leaves = out.actions.filter((a) => a.action === "leave");
    assert.equal(leaves.length, 6);
    assert.ok(leaves.every((a) => a.c === null && !a.error), "the next challenge stays secret until it's asked");
  });
}

test("a plain \"leave\" loses a slot unless the re-request answers in time (paced)", async () => {
  // Bee 0 answers its re-requests at once; bee 1 takes 120 ms, missing the next round's start.
  const fast = `def forage(seen, visit):\n    return "leave" if seen else ["ask", 1]\n`;
  const slow = `import time\ndef forage(seen, visit):\n    if seen:\n        return "leave"\n    time.sleep(0.12)\n    return ["ask", 2]\n`;
  const out = await play(normalizeConfig({}), [{ ...flowers, bee: fast }, { ...flowers, bee: slow }], 12, null, { paced: true });
  assert.deepEqual(out.problems, []);
  const r0 = slots(out.actions, 0).map((a) => a.round), r1 = slots(out.actions, 1).map((a) => a.round);
  assert.ok(r0.length >= 9 && r1.length >= 4, `${r0} / ${r1}`);
  assert.deepEqual(r0.slice(1).map((r, i) => r - r0[i]), r0.slice(1).map(() => 1), `bee 0 plays every round: ${r0}`);
  assert.deepEqual(r1.slice(1).map((r, i) => r - r1[i]), r1.slice(1).map(() => 2), `bee 1 misses every other round: ${r1}`);
  assert.ok(byBee(out.actions, 0).filter((a) => a.action === "leave").every((a) => a.atMs === (a.round - 1) * 200 + 150));
});

test("flowers get their own time limits: an orchid over 100 ms gets null, a cosmos taking 120 ms answers", async () => {
  const slowFlower = `import time\ndef flower(c):\n    ${busy(120)}    return c * 2\n`;
  const bee = `def forage(seen, visit):\n    return ["leave", 3]\n`;
  const out = await play(normalizeConfig({}), [{ cosmos: slowFlower, orchid: slowFlower, bee }], 4);
  const asks = out.actions.filter((a) => a.action === "ask");
  const cosmos = asks.filter((a) => a.kind === "cosmos"), orchid = asks.filter((a) => a.kind === "orchid");
  assert.ok(cosmos.length && orchid.length);
  for (const a of cosmos) {
    assert.equal(a.r, 6, JSON.stringify(a));
    assert.ok(a.ms >= 115 && a.ms < 150, `cosmos took ${a.ms} ms`);
  }
  for (const a of orchid) {
    assert.equal(a.r, null);
    assert.equal(a.by, "flower");
    assert.match(a.error, /Timeout/);
    assert.ok(a.ms >= 95 && a.ms < 140, `orchid stopped at ${a.ms} ms`);
  }
  assert.match(out.problems.find((p) => p.kind === "orchid").error, /Timeout/);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: GAME: each program's own time limit as ms, and the round length`, async () => {
    const config = normalizeConfig({ language });
    const p = language === "python"
      ? { flower: `def flower(c):\n    return GAME["ms"] * 1000 + GAME["round_ms"]\n`, bee: `def forage(seen, visit):\n    return ["leave", GAME["ms"] * 1000 + GAME["round_ms"]]\n` }
      : { flower: `function flower(c: number) { return GAME.ms * 1000 + GAME.round_ms; }`, bee: `function forage(seen: any[]) { return ["leave", GAME.ms * 1000 + GAME.round_ms]; }` };
    const out = await play(config, [{ cosmos: p.flower, orchid: p.flower, bee: p.bee }], 4);
    const asks = out.actions.filter((a) => a.action === "ask");
    assert.ok(asks.length === 4 && asks.every((a) => a.c === 50200));
    for (const a of asks) assert.equal(a.r, a.kind === "cosmos" ? 150200 : 100200);
  });
}

test("answers can't reveal timing: every answer reaches the bee at the end of the flower window (paced)", async () => {
  // The cosmos works for 120 ms, the orchid answers at once. The bee times the gap between its calls.
  const slowCosmos = `import time\ndef flower(c):\n    ${busy(120)}    return c\n`;
  const bee = `import time
last = 0.0
def forage(seen, visit):
    global last
    t = time.perf_counter()
    if seen and last:
        print(round((t - last) * 1000, 1))
    last = time.perf_counter()
    return ["leave", 1]
`;
  const out = await play(normalizeConfig({}), [{ cosmos: slowCosmos, orchid: `def flower(c):\n    return c\n`, bee }], 16, null, { paced: true });
  const asks = out.actions.filter((a) => a.action === "ask");
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean(asks.filter((a) => a.kind === "cosmos").map((a) => a.ms)) > 110);
  assert.ok(mean(asks.filter((a) => a.kind === "orchid").map((a) => a.ms)) < 30);
  const gaps = { cosmos: [], orchid: [] };
  // (The first gap runs from the bee's first call, while it loaded, so it doesn't count.)
  for (const a of out.actions.filter((x) => x.action === "leave" && x.log).slice(1)) gaps[a.kind].push(Number(a.log));
  assert.ok(gaps.cosmos.length >= 3 && gaps.orchid.length >= 3, JSON.stringify(gaps));
  for (const g of [...gaps.cosmos, ...gaps.orchid]) assert.ok(g > 185 && g < 225, `${g} ms between decisions`);
  assert.ok(Math.abs(mean(gaps.cosmos) - mean(gaps.orchid)) < 15, JSON.stringify(gaps));
});

test("a bee that takes 80 ms misses its next slot; its late [\"leave\", c] is the first ask at the next flower (paced)", async () => {
  const bee = `import time
n = 0
def forage(seen, visit):
    global n
    n += 1
    if n == 4:
        ${busy(80)}        return ["leave", 777]
    return ["leave", n]
`;
  const out = await play(normalizeConfig({}), [{ ...flowers, bee }], 10, null, { paced: true });
  const mine = byBee(out.actions, 0);
  const late = mine.find(tooSlow);
  assert.ok(late, JSON.stringify(mine));
  assert.equal(late.by, "bee");
  assert.equal(late.atMs, (late.round - 1) * 200 + 150);
  const asks = mine.filter((a) => a.action === "ask");
  assert.deepEqual(asks.map((a) => a.c).slice(0, 5), [1, 2, 3, 777, 5]);
  const a777 = asks.find((a) => a.c === 777);
  assert.equal(late.round, asks.find((a) => a.c === 3).round, "too slow deciding after asking 3");
  assert.ok(!mine.some((a) => a.round === late.round + 1), "the round after: no slot");
  assert.equal(a777.round, late.round + 2);
  assert.ok(a777.visit > late.visit, "at the next flower");
  assert.equal(mine.filter((a) => a.action === "leave").length, asks.length - 1, "every decision but the late one is a leave");
});

test("a late [\"ask\", c] is never asked: the bee is asked again, and that challenge opens its next flower (paced)", async () => {
  const bee = `import time
n = 0
def forage(seen, visit):
    global n
    n += 1
    if n == 4:
        ${busy(80)}        return ["ask", 7]
    if not seen:
        return ["ask", 500 + n]
    return ["leave", 100 * len(seen) + n]
`;
  const out = await play(normalizeConfig({}), [{ ...flowers, bee }], 10, null, { paced: true });
  const mine = byBee(out.actions, 0);
  const late = mine.find(tooSlow);
  assert.ok(late, JSON.stringify(mine));
  assert.ok(!out.actions.some((a) => a.c === 7), "the late ask's challenge is never asked");
  const asks = mine.filter((a) => a.action === "ask");
  // 501 (a first challenge), 102, 103, then too slow; the re-request (n = 5) gives 505; 106 after it.
  assert.deepEqual(asks.map((a) => a.c).slice(0, 5), [501, 102, 103, 505, 106]);
  const next = asks.find((a) => a.c === 505);
  assert.equal(next.round, late.round + 2);
  assert.ok(next.visit > late.visit, "at the next flower");
  assert.equal(asks.find((a) => a.c === 106).visit, next.visit + 1, "106 was decided with one step seen there");
});

for (const language of ["python", "typescript"]) {
  test(`${language}: a bee that runs over 2 s: too slow at 50 ms, a Timeout at 2 s, then asked again (paced)`, async () => {
    const bee = language === "python"
      ? `n = 0\ndef forage(seen, visit):\n    global n\n    n += 1\n    if n == 3:\n        while True:\n            pass\n    return ["leave", n]\n`
      : `let n = 0;\nfunction forage(seen: any[]) { n += 1; if (n === 3) { while (true) {} } return ["leave", n]; }\n`;
    const other = language === "python" ? `def forage(seen, visit):\n    return ["leave", 9]\n` : `function forage(seen: any[]) { return ["leave", 9]; }`;
    const f = language === "python" ? flowers : tsFlowers;
    const config = normalizeConfig({ language });
    const out = await play(config, [{ ...f, bee }, { ...f, bee: other }], 18, null, { paced: true });
    const mine = byBee(out.actions, 0);
    const late = mine.find(tooSlow);
    assert.ok(late, JSON.stringify(mine));
    const after = mine.filter((a) => a.round > late.round);
    assert.ok(after.length && after[0].action === "ask" && after[0].c === 4, JSON.stringify(after[0]));
    assert.ok(after[0].round >= late.round + 9 && after[0].round <= late.round + 13, `back in round ${after[0].round} (late in ${late.round})`);
    assert.ok(out.problems.some((p) => p.team === 0 && p.kind === "bee"), "the first problem is kept");
    // The other bee played on at the usual pace meanwhile.
    const others = slots(out.actions, 1).filter((a) => a.round > late.round && a.round < after[0].round);
    assert.ok(others.length >= after[0].round - late.round - 2, `${others.length} slots`);
    assert.ok(out.wallMs < 18 * 200 + 1500, `${Math.round(out.wallMs)} ms`);
  });
}

test("a hung bee is killed and starts afresh", async () => {
  // It swallows the runner's timeout, so the runner never replies: the process is killed and restarted.
  const bee = `n = 0
def forage(seen, visit):
    global n
    n += 1
    if n == 3:
        while True:
            try:
                while True:
                    pass
            except BaseException:
                pass
    return ["leave", n]
`;
  const out = await play(normalizeConfig({}), [{ ...flowers, bee }], 40, async (garden) => {
    while (!garden.out.some((a) => a.c === 1 && a.seq > 3) && garden.rounds < 40) await new Promise((r) => setTimeout(r, 50));
    await garden.stop();
  }, { paced: true });
  const asks = out.actions.filter((a) => a.action === "ask").map((a) => a.c);
  assert.deepEqual(asks.slice(0, 3), [1, 2, 1], "it starts again from n = 0");
  assert.ok(out.actions.some(tooSlow));
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
    const out = await play(config, [{ cosmos: p.counter, orchid: p.anytime, bee: p.bee }], 24);
    const asks = out.actions.filter((a) => a.action === "ask");
    for (const a of asks) assert.equal(a.error, null, a.error);
    for (const a of asks.filter((a) => a.kind === "cosmos")) assert.equal(a.r, 1001, "nothing survives between calls");
    const orchid = asks.filter((a) => a.kind === "orchid");
    assert.ok(orchid.length >= 6);
    assert.ok(new Set(orchid.map((a) => a.r)).size >= orchid.length - 1, "the same question gets a fresh answer every call");
    assert.ok(orchid.reduce((s, a) => s + a.ms, 0) / orchid.length >= 50, "the orchid searched for most of its 100 ms");
  });
}

test("programs run minified: the names they define can't carry data", async () => {
  const config = normalizeConfig({ responseType: "any" });
  const helper = (name) => `def ${name}():\n    return 0\ndef flower(c):\n    return [len(${name}.__name__), sorted(k for k in globals() if not k.startswith("__"))]\n`;
  const bee = `def forage(seen):\n    return ["ask", 1] if not seen else "leave"\n`;
  const answers = async (code) => {
    const out = await play(config, [{ cosmos: code, orchid: code, bee }], 6);
    return new Set(out.actions.filter((a) => a.action === "ask").map((a) => JSON.stringify(a.r)));
  };
  const long = await answers(helper("a_helper_with_a_very_long_and_meaningful_name"));
  assert.equal(long.size, 1);
  const [nameLength, globalNames] = JSON.parse([...long][0]);
  assert.equal(nameLength, 1);
  assert.ok(globalNames.every((k) => ["GAME", "flower"].includes(k) || k.length === 1), globalNames.join());
  assert.deepEqual([...await answers(helper("h"))], [...long]);
});

test("compute budgets are per program: a cosmos can be given far more compute than an orchid", async () => {
  // Works for 120 ms by the clock (a loop count would depend on how fast the machine is).
  const busyFlower = `import time\ndef flower(c):\n    t = time.perf_counter()\n    x = 0\n    while time.perf_counter() - t < 0.12:\n        x = (x + c) % 1000003\n    return x\n`;
  const bee = `def forage(seen):\n    return "leave" if seen else ["ask", 3]\n`;
  const config = normalizeConfig({ budgets: { cosmos: { ms: 400 }, orchid: { ms: 50 } } });
  const out = await play(config, [{ cosmos: busyFlower, orchid: busyFlower, bee }], 2);
  const byKind = Object.fromEntries(out.actions.filter((a) => a.action === "ask").map((a) => [a.kind, a]));
  assert.equal(typeof byKind.cosmos.r, "number", JSON.stringify(byKind.cosmos));
  assert.match(String(byKind.orchid.error), /Timeout/, JSON.stringify(out.actions));
  assert.equal(byKind.orchid.by, "flower");
  assert.ok(byKind.cosmos.ms > 115);
  assert.ok(byKind.orchid.ms < 100);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: a bee keeps its state until new code replaces it; the new code goes live at once`, async () => {
    const config = normalizeConfig({ language });
    const py = {
      cosmos: (k) => `def flower(c):\n    return ${k}\n`,
      bee: `n = 0\ndef forage(seen):\n    global n\n    if seen:\n        return "leave"\n    n += 1\n    return ["ask", n]\n`,
    };
    const ts = {
      cosmos: (k) => `function flower(c: number) { return ${k}; }`,
      bee: `let n = 0;\nfunction forage(seen: any[]) { if (seen.length) return "leave"; n += 1; return ["ask", n]; }\n`,
    };
    const p = language === "python" ? py : ts;
    const out = await play(config, [{ cosmos: p.cosmos(1), orchid: p.cosmos(2), bee: p.bee }], 60, async (garden) => {
      while (garden.rounds < 20) await new Promise((r) => setTimeout(r, 5));
      await garden.setProgram(0, "cosmos", p.cosmos(3), 2);
      await garden.setProgram(0, "bee", p.bee, 2);
    });
    const asks = out.actions.filter((a) => a.action === "ask");
    const v1 = asks.filter((a) => a.beeVersion === 1), v2 = asks.filter((a) => a.beeVersion === 2);
    assert.ok(v1.length > 5 && v2.length > 5, `${v1.length} then ${v2.length}`);
    assert.deepEqual(v1.map((a) => a.c), v1.map((_, i) => i + 1), "the bee remembers between calls");
    assert.deepEqual(v2.map((a) => a.c), v2.map((_, i) => i + 1), "new code starts afresh");
    assert.ok(v1.every((a) => a.round < v2[0].round));
    const cosmos = asks.filter((a) => a.kind === "cosmos");
    assert.ok(cosmos.some((a) => a.flowerVersion === 1 && a.r === 1) && cosmos.some((a) => a.flowerVersion === 2 && a.r === 3));
    assert.ok(cosmos.every((a) => a.r === (a.flowerVersion === 1 ? 1 : 3)), "each answer comes from the version it's labelled with");
    const swap = out.actions.find((a) => a.by === "engine");
    if (swap) assert.equal(swap.action, "leave", "the visit the old bee was on ends");
  });
}

test("a broken bee: mistakes end the visit and the bee is asked again; a bee that can't load sits out", async () => {
  const config = normalizeConfig({});
  // n counts flowers: the mistakes come at the 3rd, 6th and 9th.
  const bee = `n = 0\ndef forage(seen):\n    global n\n    if not seen:\n        n += 1\n        return ["ask", n]\n    if n == 3:\n        return "dance"\n    if n == 6:\n        return ["ask", "seven"]\n    if n == 9:\n        raise ValueError("oops")\n    return "leave"\n`;
  const out = await play(config, [{ ...flowers, bee }], 30);
  const errors = out.actions.filter((a) => a.action === "error");
  assert.match(errors[0].error, /forage must return/);
  assert.equal(errors[0].by, "bee");
  assert.equal(errors[1].by, "challenge");
  assert.match(errors[2].error, /ValueError: oops/);
  assert.ok(!out.actions.some((a) => a.c === "seven"));
  assert.ok(out.actions.filter((a) => a.action === "ask").length > 10, "it carries on");
  assert.ok(out.problems.some((p) => p.kind === "bee"));
  // A bee that can't even load sits out until its team sends new code.
  const dud = await play(config, [{ ...flowers, bee: `import os\n` + bee }], 5);
  assert.equal(dud.actions.length, 0);
  assert.match(dud.problems[0].error, /not allowed/);
});

test("paced: a round takes at least 200 ms of wall time", async () => {
  const config = normalizeConfig({});
  const s = starters(config);
  const out = await play(config, [s, s, s], 10, null, { paced: true });
  assert.equal(out.round, 10);
  assert.equal(out.clockMs, 2000);
  assert.ok(out.wallMs >= 10 * 200 - 1, `${out.wallMs} ms`);
  assert.ok(out.wallMs < 10 * 200 + 400, `${out.wallMs} ms`);
});

test("the clock: game time is rounds × 200 ms; it stands still while paused, and ends the game", async () => {
  const config = normalizeConfig({ feedCost: 1 });
  const s = starters(config);
  const garden = new Garden({ config, teams: 2, endMs: 1200 });
  await Promise.all([0, 1].flatMap((ti) => Object.entries(s).map(([k, code]) => garden.setProgram(ti, k, code, 1))));
  const t0 = Date.now();
  const run = garden.run();
  await new Promise((r) => setTimeout(r, 300));
  garden.pause();
  await new Promise((r) => setTimeout(r, 250)); // the round in progress finishes
  const paused = garden.clockMs(), round = garden.round;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(garden.clockMs(), paused, "the clock stands still while paused");
  assert.equal(garden.round, round);
  assert.equal(paused, round * 200);
  garden.resume();
  await run;
  const { clockMs, round: rounds, actions } = garden.drain();
  assert.equal(clockMs, 1200);
  assert.equal(rounds, 6);
  assert.ok(Date.now() - t0 >= 1200 + 400, "the pause didn't count");
  assert.ok(actions.length > 6);
  assert.ok(actions.every((a, i) => i === 0 || a.atMs >= actions[i - 1].atMs));
  assert.ok(actions.every((a) => a.round <= 6 && a.atMs < 1200));
});

test("adoption: a garden carries on from the stored round and clock", async () => {
  const config = normalizeConfig({});
  const s = starters(config);
  const garden = new Garden({ config, teams: 1, round: 40, clockMs: 8000, lastSeq: 77, endMs: 9000, paced: false });
  await Promise.all(Object.entries(s).map(([k, code]) => garden.setProgram(0, k, code, 1)));
  await garden.run();
  const d = garden.drain();
  assert.equal(d.round, 45);
  assert.equal(d.clockMs, 9000);
  assert.equal(d.actions[0].seq, 78);
  assert.ok(d.actions.every((a) => a.round > 40 && a.atMs >= 8000 && a.atMs === 8000 + (a.round - 41) * 200 + (SLOT.has(a.action) ? 0 : 150)));
});

test("change budgets accrue per minute of game time up to a cap", () => {
  const { cosmos, orchid, bee } = DEFAULT_CONFIG.budgets;
  assert.equal(cosmos.size * 2, orchid.size);
  assert.equal(bee.size, 5 * orchid.size);
  assert.equal(orchid.perMinute, 7 * cosmos.perMinute);
  for (const b of [cosmos, orchid, bee]) assert.equal(b.cap, b.perMinute, "a minute's worth");
  // Over a default game: 40% of a full-size cosmos or bee, 140% of an orchid.
  const total = (b) => b.perMinute * DEFAULT_CONFIG.minutes;
  assert.deepEqual([cosmos, orchid, bee].map((b) => total(b) / b.size), [0.4, 1.4, 0.4]);
  assert.equal(available(cosmos, { bank: 0, atMs: 0 }, 30000), 110);
  assert.equal(available(cosmos, { bank: 5, atMs: 30000 }, 45000), 60);
  assert.equal(available(cosmos, { bank: 0, atMs: 0 }, 3600000), 220);
});

test("try a flower: answers and timings", async () => {
  const config = normalizeConfig({});
  const r = await tryFlower({ config, kind: "cosmos", code: `def flower(c):\n    return c + 1\n`, challenges: [1, 2, "x"] });
  assert.deepEqual(r.results.map((x) => x.r), [2, 3, null]);
  assert.ok(r.results[2].error);
});

test("try a bee: unpaced, in a garden of its own two flowers", async () => {
  const config = normalizeConfig({});
  const s = starters(config);
  const t0 = performance.now();
  const r = await tryBee({ config, programs: s, rounds: 100 });
  assert.equal(r.rounds, 100);
  assert.ok(performance.now() - t0 < 100 * 200 / 2, "much faster than real time");
  assert.ok(r.actions.length > 20 && r.feeds > 0);
});
