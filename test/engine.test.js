// The garden (server/engine.js), one flower species per team: lockstep rounds of one turn per bee, queued
// challenges, flowers drawn at random, [response, percent] within 150 ms and excess energy from CPU time,
// responses delivered at 150 ms, the bees' 50 ms decision deadline with late replies and re-requests, the
// nectar/pollen split and feedCost, programs that see no history, stateless programs, versions pinned per
// turn, pacing and the game clock. Bee MEMORY and fed() have their own file (memory.test.js), and so do big
// responses (responses.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Garden, tryBee, tryFlower } from "../server/engine.js";
import { mask } from "../server/query/mask.js";
import { starters } from "./fixtures/programs.js";
import { play } from "./fixtures/garden.js";
import { DEFAULT_CONFIG, available, excessEnergy, normalizeConfig, roundMs } from "../server/lib/gameConfig.js";
import { size } from "../server/lib/measure.js";
import { SCHEMA } from "../server/query/schema.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const byBee = (actions, b) => actions.filter((a) => a.bee === b);
const arrivals = (actions, b) => byBee(actions, b).filter((a) => a.action === "arrive");
const tooSlow = (a) => a.action === "leave" && /too slow/.test(a.beeError || "");
const busy = (ms) => `t = time.perf_counter()\n    while time.perf_counter() - t < ${ms / 1000}:\n        pass\n`;
const flower = (expr, pct = 50) => `def flower(c):\n    return ${expr}, ${pct}\n`;
const leaver = (next = "1") => `def first():\n    return 1\ndef decide(c, r):\n    return "leave", ${next}\n`;
// A Python bee that counts its decide() calls in MEMORY: `n` is the call's number.
const counting = (body, firstBody = "return 1") => `def first():\n    ${firstBody}\ndef decide(c, r):\n    n = MEMORY["n"] = MEMORY.get("n", 0) + 1\n${body}`;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Stop the garden once done(actions so far) holds (or it runs out of rounds).
const stopWhen = (done) => async (garden) => {
  while (!garden.closed && !done(garden.out)) await wait(5);
  await garden.stop();
};

test("defaults: a 1,100-node flower with R from 3 to 150 ms, an 11,000-node bee with 50 ms and 50 bytes of memory, 200 ms rounds, feedCost 20, 64 KiB responses", () => {
  const { flower: f, bee } = DEFAULT_CONFIG.budgets;
  assert.deepEqual(f, { size: 1100, perMinute: 220, cap: 220, ms: 150, minMs: 3 });
  assert.deepEqual(bee, { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 });
  assert.equal(DEFAULT_CONFIG.maxResponseBytes, 65536);
  assert.equal(normalizeConfig({ maxResponseBytes: 5000 }).maxResponseBytes, 5000);
  assert.equal(normalizeConfig({ maxResponseBytes: 1e9 }).maxResponseBytes, 16777216);
  assert.equal(normalizeConfig({ budgets: { bee: { memory: 0 } } }).budgets.bee.memory, 0);
  assert.equal(roundMs(DEFAULT_CONFIG), 200);
  assert.equal(DEFAULT_CONFIG.feedCost, 20);
  assert.equal(normalizeConfig({}).feedCost, 20);
  assert.equal(DEFAULT_CONFIG.minutes, 2);
  // all configurable
  const c = normalizeConfig({ feedCost: 3, budgets: { flower: { size: 900, perMinute: 100, cap: 50, ms: 120 }, bee: { size: 5000, ms: 30, memory: 64 } } });
  assert.deepEqual(c.budgets.flower, { size: 900, perMinute: 100, cap: 50, ms: 120, minMs: 2 }, "R's floor: 2% of ms");
  assert.deepEqual(c.budgets.bee, { size: 5000, perMinute: 2200, cap: 2200, ms: 30, memory: 64 });
  assert.equal(roundMs(c), 150);
  assert.equal(c.feedCost, 3);
  assert.ok(!("cosmos" in c.budgets) && !("orchid" in c.budgets) && !("memory" in c.budgets.flower));
});

test("excess energy: E = (size cap − size) × max(0, 150 − CPU ms)", () => {
  const config = normalizeConfig({});
  assert.equal(excessEnergy(config, 300, 20), 800 * 130);
  assert.equal(excessEnergy(config, 1100, 1), 0, "a flower at the size cap has nothing to give");
  assert.equal(excessEnergy(config, 100, 150), 0);
  assert.equal(excessEnergy(config, 100, 400), 0, "never negative");
  assert.equal(excessEnergy(normalizeConfig({ budgets: { flower: { size: 2000, ms: 100 } } }), 500, 40), 1500 * 60);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: lockstep: one turn per bee per round; a feed sits the bee out for exactly feedCost rounds`, async () => {
    const config = normalizeConfig({ language, feedCost: 4 });
    const teams = [0, 1, 2, 3].map((i) => starters(config, `t${i}`));
    const out = await play(config, teams, 60);
    assert.equal(out.rounds, 60);
    assert.equal(out.round, 60);
    assert.equal(out.clockMs, 60 * 200, "game time is rounds × 200 ms");
    assert.deepEqual(out.problems, []);
    for (let b = 0; b < 4; b++) {
      const mine = byBee(out.actions, b);
      const arr = mine.filter((a) => a.action === "arrive"), end = ends(mine);
      assert.ok(arr.length > 15, `bee ${b} took ${arr.length} turns`);
      assert.equal(arr.length, end.length, "every turn that starts is settled");
      // The starters always have a challenge queued in time, so a bee plays every round it isn't feeding.
      let expect = 1;
      for (const [i, a] of arr.entries()) {
        assert.equal(a.round, expect, `bee ${b}: turn ${a.turn} in round ${a.round}`);
        assert.equal(a.turn, i + 1);
        const e = end[i];
        assert.deepEqual([e.round, e.turn, e.flower], [a.round, a.turn, a.flower], "a turn ends in the round it began, at the same flower");
        expect = a.round + 1 + (e.action === "feed" ? config.feedCost : 0);
      }
      // The bee fed every other turn, counting its turns in MEMORY.
      assert.deepEqual(end.map((a) => a.action), end.map((_, i) => (i % 2 ? "leave" : "feed")));
    }
    for (const a of out.actions) assert.equal(a.atMs, (a.round - 1) * 200 + (a.action === "arrive" ? 0 : 150), JSON.stringify(a));
    const seqs = out.actions.map((a) => a.seq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "actions are numbered in order");
    // The ledgers add up to the turns.
    const feeds = out.actions.filter((a) => a.action === "feed");
    assert.equal(out.feeds.flat().reduce((x, y) => x + y, 0), feeds.length);
    close(out.nectar.flat().reduce((x, y) => x + y, 0), feeds.reduce((s, a) => s + a.nectar, 0));
    close(out.pollen.flat().reduce((x, y) => x + y, 0), feeds.reduce((s, a) => s + a.pollen, 0));
    // The history is in natural order: by round, then bee.
    const keys = out.history.map((t) => t.round * 100 + t.bee);
    assert.deepEqual(keys, [...keys].sort((x, y) => x - y));
    assert.equal(out.history.length, ends(out.actions).length);
  });
}

test("every turn draws a flower uniformly at random among all N, the bee's own included", async () => {
  const out = await play(normalizeConfig({}), [0, 1, 2].map(() => ({ flower: flower("c"), bee: leaver() })), 300);
  const turns = ends(out.actions);
  assert.equal(turns.length, 900);
  const counts = [0, 1, 2].map((f) => turns.filter((a) => a.flower === f).length);
  // 300 expected each, standard deviation about 14: far outside ±70 only if the draw isn't uniform.
  for (const n of counts) assert.ok(n > 230 && n < 370, `${counts}`);
  for (let b = 0; b < 3; b++) {
    const mine = turns.filter((a) => a.bee === b).map((a) => a.flower);
    assert.ok(mine.filter((f) => f === b).length > 60, `bee ${b} visits its own flower too`);
    assert.ok(mine.some((f, i) => i > 0 && f === mine[i - 1]), "the same flower can come up twice in a row");
  }
});

test("energy is counted in CPU time: a busy flower spends it, a sleeping one doesn't; late or malformed answers give none", async () => {
  const config = normalizeConfig({ responseType: "any" });
  const cases = {
    busy60: `import time\ndef flower(c):\n    ${busy(60)}    return c, 40\n`,
    sleep60: `import time\ndef flower(c):\n    time.sleep(0.06)\n    return c, 40\n`,
    late: `import time\ndef flower(c):\n    ${busy(200)}    return c, 40\n`,
    bare: `def flower(c):\n    return c\n`,
    badPercent: `def flower(c):\n    return c, "half"\n`,
    nanPercent: `def flower(c):\n    return c, float("nan")\n`,
    crash: `def flower(c):\n    return 1 / 0, 40\n`,
    high: `def flower(c):\n    return c, 250\n`,
    low: `def flower(c):\n    return c, -3.5\n`,
    list: `def flower(c):\n    return [c, c], 12.5\n`,
  };
  const bee = `def first():\n    return 7\ndef decide(c, r):\n    return "feed", 7\n`;
  const got = {};
  for (const [name, code] of Object.entries(cases)) { // one at a time, so a busy flower has a core to itself
    const out = await play(normalizeConfig({ responseType: "any", feedCost: 0, budgets: { flower: { minMs: 150 } } }), [{ flower: code, bee }], 3);
    got[name] = { turns: ends(out.actions), size: (await size("python", code)).size, problems: out.problems };
  }
  for (const name of ["busy60", "sleep60", "high", "low", "list"]) {
    const { turns, size: s } = got[name];
    assert.equal(turns.length, 3, name);
    for (const t of turns) {
      assert.equal(t.flowerError, null, `${name}: ${t.flowerError}`);
      assert.equal(typeof t.ms, "number");
      assert.equal(t.budgetMs, 150);
      assert.equal(t.energy, excessEnergy(config, s, t.ms, t.budgetMs, t.rBytes), `${name}: E = (1100 − ${s}) × (150 − ${t.ms}) × (1024 − ${t.rBytes}) / 1024`);
      assert.ok(t.energy > 0);
    }
  }
  for (const t of got.busy60.turns) assert.ok(t.ms > 40 && t.ms < 100, `busy for 60 ms: ${t.ms} ms of CPU`);
  for (const t of got.sleep60.turns) assert.ok(t.ms < 20, `asleep for 60 ms: only ${t.ms} ms of CPU`);
  assert.ok(got.sleep60.turns[0].energy > got.busy60.turns[0].energy * 1.4, "sleeping costs no energy, working does");
  assert.deepEqual(got.high.turns.map((t) => t.percent), [100, 100, 100], "percent is clamped to 0–100");
  assert.deepEqual(got.low.turns.map((t) => t.percent), [0, 0, 0]);
  assert.deepEqual(got.list.turns.map((t) => [t.r, t.percent]), [[[7, 7], 12.5], [[7, 7], 12.5], [[7, 7], 12.5]]);
  for (const [name, pattern] of [["late", /Timeout/], ["bare", /must return \[response, percent\]/], ["badPercent", /percent must be a number/],
    ["nanPercent", /not plain data|percent/], ["crash", /ZeroDivisionError/]]) {
    const { turns, problems } = got[name];
    assert.ok(turns.length >= 1, name);
    for (const t of turns) {
      assert.equal(t.r, null, `${name}: the response is null`);
      assert.equal(t.energy, 0, `${name}: E = 0`);
      assert.equal(t.percent, null);
      assert.match(t.flowerError, pattern, name);
      assert.equal(t.action, "feed", "the bee may still feed");
      assert.equal(t.nectar, 0);
      assert.equal(t.pollen, 0);
    }
    assert.match(problems.find((p) => p.kind === "flower").error, pattern);
  }
  for (const t of got.late.turns) assert.ok(t.ms >= 120, `stopped near its limit: ${t.ms} ms of CPU (floor loose for a busy machine)`);
});

test("typescript: energy from CPU time, and a late flower gives none", async () => {
  const config = normalizeConfig({ language: "typescript", budgets: { flower: { minMs: 150 } } });
  const busyTs = (ms) => `function flower(c: number): [number, number] { const t = Date.now(); while (Date.now() - t < ${ms}) {} return [c, 30]; }`;
  const bee = `function first() { return 3; }\nfunction decide(c: number, r: number | null) { return ["leave", 3]; }`;
  const runs = [];
  for (const code of [busyTs(40), busyTs(200)]) {
    const out = await play(config, [{ flower: code, bee }], 2);
    runs.push({ turns: ends(out.actions), size: (await size("typescript", code)).size });
  }
  const [fast, late] = runs;
  for (const t of fast.turns) {
    assert.ok(t.ms > 25 && t.ms < 90, `${t.ms}`);
    assert.equal(t.energy, excessEnergy(config, fast.size, t.ms, t.budgetMs, t.rBytes));
    assert.equal(t.r, 3);
  }
  for (const t of late.turns) {
    assert.equal(t.r, null);
    assert.equal(t.energy, 0);
    assert.match(t.flowerError, /Timeout/);
  }
});

test("nectar and pollen: a feed splits E by percent between them; a turn without a feed gives nothing", async () => {
  const bee = counting(`    return ("feed" if n % 2 else "leave"), n\n`);
  const out = await play(normalizeConfig({ feedCost: 1 }), [{ flower: flower("c", 30), bee }], 40);
  const turns = ends(out.actions);
  const fed = turns.filter((a) => a.action === "feed"), left = turns.filter((a) => a.action === "leave");
  assert.ok(fed.length >= 10 && left.length >= 10);
  for (const a of fed) {
    assert.ok(a.energy > 0);
    close(a.nectar, 0.3 * a.energy);
    close(a.pollen, 0.7 * a.energy);
    close(a.nectar + a.pollen, a.energy);
  }
  for (const a of left) {
    assert.ok(a.energy > 0, "the energy was there");
    assert.equal(a.nectar, null, "but no nectar");
    assert.equal(a.pollen, 0, "and no pollen");
  }
  assert.equal(out.feeds[0][0], fed.length);
  close(out.nectar[0][0], fed.reduce((s, a) => s + a.nectar, 0));
  close(out.pollen[0][0], fed.reduce((s, a) => s + a.pollen, 0));
});

test("feedCost: a bee that feeds sits out exactly feedCost rounds (20 by default), then plays the challenge it queued", async () => {
  for (const feedCost of [0, 7, undefined]) {
    const bee = `def first():\n    return 0\ndef decide(c, r):\n    return "feed", c + 1\n`;
    const config = normalizeConfig({ feedCost });
    const out = await play(config, [{ flower: flower("c"), bee }], 50);
    const arr = arrivals(out.actions, 0).map((a) => a.round);
    assert.deepEqual(arr, arr.map((_, i) => 1 + i * (config.feedCost + 1)), `feedCost ${feedCost}: ${arr}`);
    assert.deepEqual(ends(out.actions).map((a) => a.c), arr.map((_, i) => i));
    if (feedCost === undefined) assert.deepEqual(arr, [1, 22, 43], "the default: 20 rounds out after a feed");
  }
});

for (const language of ["python", "typescript"]) {
  test(`${language}: programs see only their arguments and GAME (and the bee its MEMORY): no HISTORY, nothing about the counterpart`, async () => {
    const config = normalizeConfig({ language, responseType: "any", feedCost: 2 });
    const p = language === "python"
      ? {
        flower: `def flower(c, *rest):\n    return [len(rest), "HISTORY" in NAMES, sorted(k for k in NAMES if not k.startswith("__") and len(k) > 1)], 50\nNAMES = dir()  # (minified to a one-letter name)\n`,
        bee: `def first(*args):\n    return len(args)\ndef decide(c, r, *rest):\n    print("[%d, %s, [%s]]" % (len(rest), str("HISTORY" in NAMES).lower(), ", ".join('"' + k + '"' for k in NAMES if not k.startswith("__") and len(k) > 1)))\n    return "leave", 0\nNAMES = dir()\n`,
      }
      : {
        flower: `function flower(c: number, ...rest: any[]): [any, number] { return [[rest.length, typeof (globalThis as any).HISTORY, Object.keys(globalThis).filter((k) => !k.startsWith("__")).sort()], 50]; }`,
        bee: `function first(...args: any[]) { return args.length; }\nfunction decide(c: number, r: any, ...rest: any[]): ["leave", number] { console.log(JSON.stringify([rest.length, typeof (globalThis as any).HISTORY, Object.keys(globalThis).filter((k) => !k.startsWith("__")).sort()])); return ["leave", 0]; }`,
      };
    const out = await play(config, [0, 1].map(() => p), 6);
    const turns = ends(out.actions);
    assert.ok(turns.length >= 10);
    const none = language === "python" ? false : "undefined";
    for (const a of turns) {
      assert.equal(a.c, 0, "first() is called with nothing");
      const [extra, history, globalNames] = a.r;
      assert.equal(extra, 0, "flower(challenge): nothing about the bee that asked");
      assert.equal(history, none, "no HISTORY");
      assert.deepEqual(globalNames, language === "python" ? ["GAME", "flower"] : ["GAME", "console", "flower"]);
      const [bextra, bhistory, beeNames] = JSON.parse(a.log);
      assert.equal(bextra, 0, "decide(challenge, response): nothing about the flower");
      assert.equal(bhistory, none);
      assert.deepEqual(beeNames, language === "python" ? ["GAME", "MEMORY", "decide", "first"] : ["GAME", "MEMORY", "console", "decide", "first"]);
    }
  });
}

test("GAME's keys: the game's settings, nothing about other teams", async () => {
  const config = normalizeConfig({ responseType: "any" });
  const p = { flower: `def flower(c):\n    return sorted(GAME), 50\n`, bee: `def first():\n    return 1\ndef decide(c, r):\n    print(" ".join(sorted(GAME)))\n    return "leave", 1\n` };
  const out = await play(config, [p], 2);
  const common = ["challenge_type", "feed_cost", "flower_ms", "flower_size_cap", "max_len", "max_nodes", "max_response_bytes", "ms", "response_type", "round_ms", "team", "teams"];
  for (const a of ends(out.actions)) {
    assert.deepEqual(a.r, [...common, "size"].sort());
    assert.deepEqual(a.log.trim().split(" "), [...common, "memory"].sort());
  }
});

test("turn records (the ledger's, and the query schema's): every turn's public fields, plus the team's own private details", () => {
  const base = { game: "g", seq: 9, round: 5, atMs: 800, turn: 2, budgetMs: 88.5, flowerVersion: 3, flowerError: null, beeMs: 1.5, beeVersion: 4, beeError: null };
  const fed = { ...base, bee: 0, flower: 1, challenge: 3, response: 4, responseBytes: 1, responseHash: null, fed: true, percent: 25, energy: 1000, nectar: 250, pollen: 750, ms: 12,
    grain: "abc", grainVersion: 3, grainCodeLength: 9 };
  const left = { ...base, bee: 2, flower: 1, challenge: 7, response: null, responseBytes: 5000, responseHash: "ab", fed: false, percent: 60, energy: 800, nectar: null, pollen: 0, ms: 3,
    grain: null, grainVersion: null, grainCodeLength: null };
  const names = SCHEMA.entities.turns.fields.map((f) => f.name);
  const view = (r, ti) => mask("turns", r, ti);
  for (const r of [fed, left]) for (const ti of [0, 1, 2, null]) assert.deepEqual(Object.keys(view(r, ti)), names, "every schema field, in order");
  // A feed: public, but the flower's CPU time, version and errors are its team's, the bee's timing (and its
  // pollen grain) its team's.
  const pub = { ...fed, ms: null, budgetMs: null, flowerVersion: null, flowerError: null, beeMs: null, beeVersion: null, beeError: null, grain: null, grainVersion: null, grainCodeLength: null };
  assert.deepEqual(view(fed, 2), pub);
  assert.deepEqual(view(fed, null), pub, "a spectator sees the same");
  assert.deepEqual(view(fed, 1), { ...pub, ms: 12, budgetMs: 88.5, flowerVersion: 3 });
  assert.deepEqual(view(fed, 0), { ...pub, beeMs: 1.5, beeVersion: 4, grain: "abc", grainVersion: 3, grainCodeLength: 9 });
  // No feed: pollen 0, no nectar; the percent and energy are the flower's team's. A big response's size and hash are public.
  const hid = { ...left, percent: null, energy: null, ms: null, budgetMs: null, flowerVersion: null, flowerError: null, beeMs: null, beeVersion: null, beeError: null };
  assert.deepEqual(view(left, 0), hid);
  assert.deepEqual(view(left, 1), { ...hid, percent: 60, energy: 800, ms: 3, budgetMs: 88.5, flowerVersion: 3 });
  assert.deepEqual(view(left, 2), { ...hid, beeMs: 1.5, beeVersion: 4 });
});

test("nothing persists between calls but MEMORY: globals start afresh every call, in both languages", async () => {
  const py = {
    flower: `seen = []\ndef flower(c):\n    seen.append(c)\n    return len(seen), 50\n`,
    bee: `calls = [0]\ndef first():\n    calls[0] += 1\n    return calls[0]\ndef decide(c, r):\n    calls[0] += 1\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    print(calls[0], MEMORY["n"])\n    return "leave", calls[0]\n`,
  };
  const ts = {
    flower: `const seen: number[] = [];\nfunction flower(c: number): [number, number] { seen.push(c); return [seen.length, 50]; }`,
    bee: `let calls = 0;\nfunction first() { calls += 1; return calls; }\nfunction decide(c: number, r: any): ["leave", number] { calls += 1; MEMORY.n = (MEMORY.n ?? 0) + 1; console.log(calls, MEMORY.n); return ["leave", calls]; }`,
  };
  for (const [language, p] of [["python", py], ["typescript", ts]]) {
    const out = await play(normalizeConfig({ language }), [p], 8);
    const turns = ends(out.actions);
    assert.equal(turns.length, 8);
    assert.ok(turns.every((a) => a.r === 1), `${language}: a flower's globals start afresh`);
    assert.deepEqual(turns.map((a) => a.c), [1, 1, 1, 1, 1, 1, 1, 1], `${language}: so do a bee's (first: 1; each decide: 1)`);
    assert.deepEqual(turns.map((a) => a.log.trim()), turns.map((_, i) => `1 ${i + 1}`), `${language}: only MEMORY carries over`);
  }
});

test("a bare \"leave\" gets first() asked at once: in time it makes the next round, slower costs a round (paced)", async () => {
  const fast = `def first():\n    return 1\ndef decide(c, r):\n    return "leave"\n`;
  // first() is slow once the bee has decided once (it notes that in MEMORY).
  const slow = `import time\ndef first():\n    if MEMORY.get("decided"):\n        time.sleep(0.12)\n    return 2\ndef decide(c, r):\n    MEMORY["decided"] = True\n    return "leave"\n`;
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee: fast }, { flower: flower("c"), bee: slow }], 12, null, { paced: true });
  assert.deepEqual(out.problems, []);
  const r0 = arrivals(out.actions, 0).map((a) => a.round), r1 = arrivals(out.actions, 1).map((a) => a.round);
  assert.ok(r0.length >= 9 && r1.length >= 4, `${r0} / ${r1}`);
  assert.deepEqual(r0.slice(1).map((r, i) => r - r0[i]), r0.slice(1).map(() => 1), `bee 0 plays every round: ${r0}`);
  assert.deepEqual(r1.slice(1).map((r, i) => r - r1[i]), r1.slice(1).map(() => 2), `bee 1 misses every other round: ${r1}`);
  assert.ok(ends(out.actions).every((a) => a.action === "leave" && !a.beeError), "a bare leave is a leave, not an error");
});

test("a bad next challenge: the feed still counts, then first() supplies the next one", async () => {
  const bee = counting(`    return ("feed", "seven") if n == 2 else ("leave", n)\n`, "return 1000");
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower: flower("c"), bee }], 6);
  const turns = ends(out.actions);
  assert.deepEqual(turns.map((a) => [a.action, a.c]), [["leave", 1000], ["feed", 1], ["leave", 1000], ["leave", 3], ["leave", 4], ["leave", 5]]);
  assert.match(turns[1].beeError, /next challenge must be an int/);
});

test("a late [\"leave\", c] queues c, though the turn is settled without it; the bee loses a round (paced)", async () => {
  const bee = counting(`    if n == 3:\n        import time\n        t = time.perf_counter()\n        while time.perf_counter() - t < 0.08:\n            pass\n        return "leave", 777\n    return "leave", 100 + n\n`);
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee }], 10, null, { paced: true });
  const mine = byBee(out.actions, 0);
  const turns = ends(mine);
  const late = turns.find(tooSlow);
  assert.ok(late, JSON.stringify(mine));
  assert.equal(late.atMs, (late.round - 1) * 200 + 150);
  assert.equal(late.beeMs, null);
  assert.deepEqual(turns.map((a) => a.c).slice(0, 5), [1, 101, 102, 777, 104], "the late reply's MEMORY was saved too (n = 3, then 4)");
  const a777 = turns.find((a) => a.c === 777);
  assert.equal(late.c, 102, "too slow deciding after asking 102");
  assert.equal(a777.round, late.round + 2, "the round after, its call was still running: no turn");
  assert.ok(!mine.some((a) => a.round === late.round + 1));
});

test("a late reply never feeds: a late [\"feed\", c] is a leave, c is never asked, and first() supplies the next (paced)", async () => {
  const bee = counting(`    if n == 3:\n        import time\n        t = time.perf_counter()\n        while time.perf_counter() - t < 0.08:\n            pass\n        return "feed", 7\n    return "leave", 100 + n\n`,
    `k = MEMORY["k"] = MEMORY.get("k", 0) + 1\n    return 500 + k`);
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee }], 10, null, { paced: true });
  const turns = ends(byBee(out.actions, 0));
  const late = turns.find(tooSlow);
  assert.ok(late, JSON.stringify(turns));
  assert.equal(late.action, "leave");
  assert.ok(!out.actions.some((a) => a.action === "feed"), "nothing fed");
  assert.equal(out.feeds[0][0], 0);
  assert.ok(!turns.some((a) => a.c === 7), "the late feed's challenge is never asked");
  assert.deepEqual(turns.map((a) => a.c).slice(0, 5), [501, 101, 102, 502, 104]);
  assert.equal(turns[3].round, late.round + 2);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: a bee call that runs over 2 s: too slow at 50 ms, a Timeout at 2 s, then first() (paced)`, async () => {
    // It hangs deciding after challenge 3; first() starts it at 1 again.
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    if c == 3:\n        while True:\n            pass\n    return "leave", c + 1\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["leave", number] { if (c === 3) { while (true) {} } return ["leave", c + 1]; }\n`;
    const other = language === "python" ? leaver("9") : `function first() { return 9; }\nfunction decide(c: number, r: any) { return ["leave", 9]; }`;
    const fl = language === "python" ? flower("c") : `function flower(c: number) { return [c, 50]; }`;
    const out = await play(normalizeConfig({ language }), [{ flower: fl, bee }, { flower: fl, bee: other }], 18, null, { paced: true });
    const mine = byBee(out.actions, 0);
    const late = mine.find(tooSlow);
    assert.ok(late, JSON.stringify(mine));
    assert.equal(late.c, 3);
    const after = ends(mine).filter((a) => a.round > late.round);
    assert.ok(after.length && after[0].c === 1, JSON.stringify(after[0]));
    assert.ok(after[0].round >= late.round + 9 && after[0].round <= late.round + 14, `back in round ${after[0].round} (late in ${late.round})`);
    assert.ok(out.problems.some((p) => p.team === 0 && p.kind === "bee"));
    const others = arrivals(out.actions, 1).filter((a) => a.round > late.round && a.round < after[0].round);
    assert.ok(others.length >= after[0].round - late.round - 2, "the other bee played on");
    assert.ok(out.wallMs < 18 * 200 + 1500, `${Math.round(out.wallMs)} ms`);
  });
}

test("a bee call that swallows its timeout is killed; the bee carries on", async () => {
  const bee = `def first():\n    return 1\ndef decide(c, r):\n    if c == 3:\n        while True:\n            try:\n                while True:\n                    pass\n            except BaseException:\n                pass\n    return "leave", c + 1\n`;
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee }], 40, async (garden) => {
    while (garden.history.filter((t) => t.challenge === 1).length < 2 && garden.rounds < 40) await wait(50);
    await garden.stop();
  }, { paced: true });
  const cs = ends(out.actions).map((a) => a.c);
  assert.deepEqual(cs.slice(0, 3), [1, 2, 3]);
  assert.ok(cs.slice(3).includes(1), "it starts again from first()");
  assert.ok(out.actions.some(tooSlow));
});

test("responses can't reveal timing: every response reaches the bee at the end of the flower window, and the bee's clock starts at 0 (paced)", async () => {
  // Two flowers, one working 120 ms, one answering at once. The bee reads its clock as decide starts: about
  // 0, whichever flower answered (every call's clock starts at 0).
  const slow = `import time\ndef flower(c):\n    ${busy(120)}    return 1, 50\n`;
  const quick = flower("2");
  const bee = `import time\ndef first():\n    return 1\ndef decide(c, r):\n    print(round(time.time() * 1000, 3))\n    return "leave", 1\n`;
  const startsOf = (acts) => {
    const starts = { 1: [], 2: [] };
    for (const a of ends(acts).filter((x) => x.bee === 0 && x.log)) starts[a.r]?.push(Number(a.log));
    return starts;
  };
  const enough = (acts) => { const s = startsOf(acts); return s[1].length >= 4 && s[2].length >= 4; };
  const out = await play(normalizeConfig({}), [{ flower: slow, bee }, { flower: quick, bee: leaver() }], 80, stopWhen(enough), { paced: true });
  const starts = startsOf(out.actions);
  assert.ok(starts[1].length >= 3 && starts[2].length >= 3, JSON.stringify(starts));
  for (const ms of [...starts[1], ...starts[2]]) assert.ok(ms >= 0 && ms < 5, `the bee's clock read ${ms} ms as decide started`);
  // Every turn is settled 150 ms into its round, whichever flower answered.
  for (const a of ends(out.actions)) assert.equal(a.atMs, (a.round - 1) * 200 + 150);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: GAME: the team, the time limits, the size cap, the flower's own size and the bee's memory cap`, async () => {
    // (R from 50 ms up, so that every call answers: R itself is budget.test.js's.)
    const config = normalizeConfig({ language, responseType: "any", challengeType: "any", budgets: { flower: { minMs: 50 } } });
    const p = language === "python"
      ? { flower: `def flower(c):\n    return [GAME["team"], GAME["teams"], GAME["ms"], GAME["round_ms"], GAME["flower_size_cap"], GAME["size"]], 1\n`,
        bee: `def first():\n    return [GAME["team"], GAME["ms"], GAME["flower_ms"], GAME["feed_cost"], GAME["memory"]]\ndef decide(c, r):\n    return "leave", c\n` }
      : { flower: `function flower(c: any) { return [[GAME.team, GAME.teams, GAME.ms, GAME.round_ms, GAME.flower_size_cap, GAME.size], 1]; }`,
        bee: `function first() { return [GAME.team, GAME.ms, GAME.flower_ms, GAME.feed_cost, GAME.memory]; }\nfunction decide(c: any, r: any) { return ["leave", c]; }` };
    const out = await play(config, [p, p], 10);
    const s = (await size(language, p.flower)).size;
    for (const a of ends(out.actions)) {
      assert.deepEqual(a.c, [a.bee, 50, 150, 20, 50], "feed_cost 20 by default");
      assert.deepEqual(a.r, [a.flower, 2, a.budgetMs, 200, 1100, s], "a flower's GAME ms is its call's R");
      assert.ok(a.budgetMs >= 50 && a.budgetMs <= 150);
    }
  });
}

for (const language of ["python", "typescript"]) {
  test(`${language}: flowers are stateless: fresh randomness, a clock, no answer cache`, async () => {
    const config = normalizeConfig({ language, budgets: { flower: { minMs: 50 } } }); // every call answers
    const py = {
      counter: `import math\nn = 0\ndef flower(c):\n    global n\n    n += 1\n    math.k = getattr(math, "k", 0) + 1\n    return n * 1000 + math.k, 1\n`,
      anytime: `import random, time\ndef flower(c):\n    t0 = time.perf_counter()\n    best = 0\n    while time.perf_counter() - t0 < 0.3 * GAME["ms"] / 1000:\n        best = max(best, random.randint(0, 10**9))\n    return best, 1\n`,
    };
    const ts = {
      counter: `let n = 0;\nfunction flower(c: number): [number, number] { n += 1; (Math as any).k = ((Math as any).k || 0) + 1; return [n * 1000 + (Math as any).k, 1]; }\n`,
      anytime: `function flower(c: number): [number, number] {\n  const t0 = Date.now(); let best = 0;\n  while (Date.now() - t0 < 0.3 * GAME.ms) best = Math.max(best, Math.floor(Math.random() * 1e9));\n  return [best, 1];\n}\n`,
    };
    const p = language === "python" ? py : ts;
    const bee = language === "python" ? leaver("7") : `function first() { return 7; }\nfunction decide(c: number, r: any) { return ["leave", 7]; }`;
    const out = await play(config, [{ flower: p.counter, bee }, { flower: p.anytime, bee }], 16);
    const turns = ends(out.actions);
    for (const a of turns) assert.equal(a.flowerError, null, a.flowerError);
    for (const a of turns.filter((a) => a.flower === 0)) assert.equal(a.r, 1001, "nothing survives between calls");
    const anytime = turns.filter((a) => a.flower === 1);
    assert.ok(anytime.length >= 6);
    assert.ok(new Set(anytime.map((a) => a.r)).size >= anytime.length - 1, "the same question gets a fresh answer every call");
    assert.ok(anytime.reduce((s, a) => s + a.ms, 0) / anytime.length >= 20, "it searched for its share of the 150 ms (loosely, so a busy machine doesn't fail it)");
  });
}

test("programs run minified: the names they define can't carry data", async () => {
  const config = normalizeConfig({ responseType: "any" });
  const helper = (name) => `def ${name}():\n    return 0\ndef flower(c):\n    return [len(${name}.__name__), sorted(k for k in NAMES if not k.startswith("__"))], 1\nNAMES = dir()\n`;
  const answers = async (code) => {
    const out = await play(config, [{ flower: code, bee: leaver() }], 4);
    return new Set(ends(out.actions).map((a) => JSON.stringify(a.r)));
  };
  const long = await answers(helper("a_helper_with_a_very_long_and_meaningful_name"));
  assert.equal(long.size, 1);
  const [nameLength, globalNames] = JSON.parse([...long][0]);
  assert.equal(nameLength, 1);
  assert.ok(globalNames.every((k) => ["GAME", "flower"].includes(k) || k.length === 1), globalNames.join());
  assert.deepEqual([...await answers(helper("h"))], [...long]);
});

for (const language of ["python", "typescript"]) {
  test(`${language}: new code goes live at once between turns; a new bee version starts with an empty MEMORY`, async () => {
    const config = normalizeConfig({ language });
    const py = {
      flower: (k) => flower(String(k)),
      bee: `def first():\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    return MEMORY["n"]\ndef decide(c, r):\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    return "leave", MEMORY["n"]\n`,
    };
    const ts = {
      flower: (k) => `function flower(c: number) { return [${k}, 50]; }`,
      bee: `function first() { MEMORY.n = (MEMORY.n ?? 0) + 1; return MEMORY.n; }\nfunction decide(c: number, r: any) { MEMORY.n = (MEMORY.n ?? 0) + 1; return ["leave", MEMORY.n]; }\n`,
    };
    const p = language === "python" ? py : ts;
    let memoryBefore = null;
    const out = await play(config, [{ flower: p.flower(1), bee: p.bee }], 60, async (garden) => {
      while (garden.rounds < 20) await wait(5);
      memoryBefore = garden.memoryOf(0);
      await garden.setProgram(0, "flower", p.flower(3), 2);
      await garden.setProgram(0, "bee", p.bee, 2);
    });
    const turns = ends(out.actions);
    const v1 = turns.filter((a) => a.beeVersion === 1), v2 = turns.filter((a) => a.beeVersion === 2);
    assert.ok(v1.length > 5 && v2.length > 5, `${v1.length} then ${v2.length}`);
    assert.deepEqual(v1.map((a) => a.c), v1.map((_, i) => i + 1), "MEMORY carries over between calls");
    assert.deepEqual(v2.map((a) => a.c), v2.map((_, i) => i + 1), "the new version starts from an empty MEMORY");
    assert.equal(memoryBefore.version, 1);
    assert.ok(JSON.parse(memoryBefore.memory).n > 5);
    const memoryAfter = out.memories.at(-1);
    assert.equal(memoryAfter.version, 2);
    assert.equal(JSON.parse(memoryAfter.memory).n, v2.at(-1).c + 1, "the new version's memory counts its own calls only");
    assert.ok(v1.every((a) => a.round < v2[0].round));
    assert.ok(turns.some((a) => a.flowerVersion === 1 && a.r === 1) && turns.some((a) => a.flowerVersion === 2 && a.r === 3));
    assert.ok(turns.every((a) => a.r === (a.flowerVersion === 1 ? 1 : 3)), "each response comes from the version it's labelled with");
  });
}

// Wait for a turn that has begun and isn't settled yet (its flower is working), then run `swap`.
const midTurn = (swap, done) => async (garden) => {
  const open = () => garden.out.some((a) => a.action === "arrive" && !garden.out.some((e) => e.action !== "arrive" && e.bee === a.bee && e.turn === a.turn));
  while (!garden.closed && !(open() && garden.round >= 3)) await wait(1);
  const at = garden.seq;
  await swap(garden);
  while (!garden.closed && !done(garden.out)) await wait(5);
  await garden.stop();
  return at;
};

test("versions are pinned per turn: a flower swap reaches turns that start after it", async () => {
  const slowFlower = (v) => `import time\ndef flower(c):\n    time.sleep(0.1)\n    return ${v}, 50\n`;
  let at = null, retiredDuring = null;
  const out = await play(normalizeConfig({ budgets: { flower: { minMs: 150 } } }), [{ flower: slowFlower(1), bee: leaver() }], 200, async (garden) => {
    at = await midTurn(async (g) => { await g.setProgram(0, "flower", slowFlower(3), 2); retiredDuring = g.retiring.size; },
      (acts) => acts.filter((a) => a.action === "leave" && a.flowerVersion === 2).length >= 2)(garden);
  });
  const spanning = out.actions.find((a) => a.action === "arrive" && a.seq <= at && !out.actions.some((e) => e.action === "leave" && e.turn === a.turn && e.seq <= at));
  const end = out.actions.find((e) => e.action === "leave" && e.turn === spanning.turn);
  assert.ok(end.seq > at, "the turn was in progress at the swap");
  assert.deepEqual([end.flowerVersion, end.r], [1, 1], "it kept the version it started with");
  const later = ends(out.actions).filter((a) => a.turn > spanning.turn);
  assert.ok(later.length && later.every((a) => a.flowerVersion === 2 && a.r === 3));
  assert.equal(retiredDuring, 1, "the old version stays up while a turn is pinned to it");
  for (const a of out.actions.filter((x) => x.action === "arrive")) {
    assert.equal(out.actions.find((e) => e.action !== "arrive" && e.turn === a.turn).flowerVersion, a.flowerVersion, "one version per turn");
  }
});

test("versions are pinned per turn: a bee swap takes over when the turn is settled; the old bee's feed counts, its queued challenge goes", async () => {
  const slowFlower = `import time\ndef flower(c):\n    time.sleep(0.1)\n    return c, 50\n`;
  const v1 = `def first():\n    return 100\ndef decide(c, r):\n    return "feed", 999\n`;
  const v2 = `def first():\n    return 5000\ndef decide(c, r):\n    return "leave", 5001\n`;
  const config = normalizeConfig({ feedCost: 3, budgets: { flower: { minMs: 150 } } });
  let at = null;
  const out = await play(config, [{ flower: slowFlower, bee: v1 }], 300, async (garden) => {
    at = await midTurn((g) => g.setProgram(0, "bee", v2, 2), (acts) => acts.filter((a) => a.action === "leave" && a.beeVersion === 2).length >= 2)(garden);
  });
  const turns = ends(out.actions);
  const spanning = turns.find((a) => a.seq > at);
  assert.ok(out.actions.some((a) => a.action === "arrive" && a.turn === spanning.turn && a.seq <= at), "the turn was in progress at the swap");
  assert.deepEqual([spanning.beeVersion, spanning.action], [1, "feed"], "the old bee decided it, and its feed counts");
  const next = turns.find((a) => a.turn === spanning.turn + 1);
  assert.equal(next.beeVersion, 2);
  assert.equal(next.c, 5000, "the new bee opens with its own first challenge: the old bee's 999 is dropped");
  assert.equal(next.round, spanning.round + 1 + config.feedCost, "and the feed's rounds are still sat out");
  assert.ok(!turns.some((a) => a.c === 999 && a.beeVersion === 2));
});

test("a broken bee: errors and bad replies are leaves, and first() is asked again; a bee that can't load sits out", async () => {
  // A crash saves no MEMORY, so the crash is triggered by the challenge, not by the count.
  const bee = counting(`    if n == 2:\n        return "dance"\n    if c == 3:\n        raise ValueError("oops")\n    return "feed" if n == 6 else "leave", n\n`, "return 0");
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower: flower("c"), bee }], 12);
  const turns = ends(out.actions);
  assert.match(turns[1].beeError, /decide must return/);
  assert.match(turns[3].beeError, /ValueError: oops/);
  assert.equal(turns[1].action, "leave");
  // The crash (at n = 4) saved nothing, so the next decision is n = 4 again.
  assert.deepEqual(turns.map((a) => a.c).slice(0, 7), [0, 1, 0, 3, 0, 4, 5], "after a bad reply, first() opens the next turn");
  assert.equal(turns[6].action, "feed");
  assert.ok(out.problems.some((p) => p.kind === "bee"));
  const dud = await play(normalizeConfig({}), [{ flower: flower("c"), bee: `import os\n` + bee }], 5);
  assert.equal(dud.actions.length, 0);
  assert.match(dud.problems[0].error, /not allowed/);
  const missing = await play(normalizeConfig({}), [{ flower: flower("c"), bee: `def first():\n    return 1\n` }], 3);
  assert.match(missing.problems[0].error, /must define first\(\) and decide\(challenge, response\)/);
});

// A garden that plays no rounds, holding a flower whose pool of processes a test asks directly. Running
// the garden just closes it, which kills every flower process.
async function flowerPool(code) {
  const garden = new Garden({ config: normalizeConfig({}), teams: 1, maxRounds: 0, paced: false });
  await garden.setProgram(0, "flower", code, 1);
  const pool = garden.flowers[0].pool;
  assert.equal((await pool.ready).ok, true);
  return { garden, pool, ask: async (c) => { const { cpu, ...res } = await pool.call(c); return res; } };
}
const exited = (p) => new Promise((resolve) => {
  if (p.child.exitCode !== null || p.child.signalCode !== null) return resolve(true);
  p.child.once("exit", () => resolve(true));
  setTimeout(() => resolve(false), 3000).unref();
});
const died = async (p) => {
  p.kill();
  while (!p.dead) await wait(2);
};

test("a flower process that stops responding is replaced: later calls are answered again, by the same version", async () => {
  const { garden, pool, ask } = await flowerPool(flower("c + 1"));
  const seen = new Set(pool.procs);
  try {
    assert.deepEqual(await ask(1), { v: [2, 50], bytes: 1 });
    pool.users++; // a turn is pinned to version 1 while version 2 goes live
    await garden.setProgram(0, "flower", flower("c + 100"), 2);
    assert.ok(garden.retiring.has(pool));
    const hung = pool.procs[0];
    hung.child.kill("SIGSTOP");
    const lost = await ask(2);
    assert.equal(lost.dead, true);
    assert.match(lost.e, /stopped responding/);
    assert.ok(await exited(hung), "the hung process is gone");
    for (let c = 3; c < 10; c++) assert.deepEqual(await ask(c), { v: [c + 1, 50], bytes: String(c + 1).length });
    assert.notEqual(pool.procs[0], hung);
    assert.deepEqual((await garden.flowers[0].pool.call(3)).v, [103, 50], "version 2 answers its own turns");
    for (const p of [...pool.procs, ...garden.flowers[0].pool.procs]) seen.add(p);
  } finally {
    await garden.run();
  }
  for (const p of seen) assert.ok(await exited(p), "closing the garden kills every process, respawned ones too");
});

test("a flower whose processes keep dying is respawned at most once a second per process", async () => {
  const { garden, pool, ask } = await flowerPool(flower("c * 2"));
  try {
    const n = pool.procs.length;
    const seen = new Set(pool.procs);
    const answers = [];
    const t0 = performance.now();
    for (let c = 0; c < 20; c++) {
      for (const p of pool.procs) await died(p);
      answers.push(await ask(c));
      for (const p of pool.procs) seen.add(p);
    }
    assert.ok(performance.now() - t0 < 1000, "all within a second");
    assert.equal(seen.size, 2 * n, "one respawn per slot");
    assert.deepEqual(answers.slice(0, n), answers.slice(0, n).map((_, c) => ({ v: [2 * c, 50], bytes: String(2 * c).length })), "respawned, answering as before");
    assert.ok(answers.slice(n).every((a) => a.dead), JSON.stringify(answers));
    await wait(1000);
    assert.deepEqual(await ask(7), { v: [14, 50], bytes: 2 });
  } finally {
    await garden.run();
  }
});

test("paced: a round takes at least 200 ms of wall time", async () => {
  const config = normalizeConfig({});
  const out = await play(config, [0, 1, 2].map((i) => starters(config, i)), 10, null, { paced: true });
  assert.equal(out.round, 10);
  assert.equal(out.clockMs, 2000);
  assert.ok(out.wallMs >= 10 * 200 - 1, `${out.wallMs} ms`);
  assert.ok(out.wallMs < 10 * 200 + 400, `${out.wallMs} ms`);
});

test("the clock: game time is rounds × 200 ms; it stands still while paused, and ends the game", async () => {
  const config = normalizeConfig({ feedCost: 1 });
  const garden = new Garden({ config, teams: 2, endMs: 1200 });
  await Promise.all([0, 1].flatMap((ti) => Object.entries(starters(config, ti)).map(([k, code]) => garden.setProgram(ti, k, code, 1))));
  const t0 = Date.now();
  const run = garden.run();
  await wait(300);
  garden.pause();
  await wait(250); // the round in progress finishes
  const paused = garden.clockMs(), round = garden.round;
  await wait(400);
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
  assert.ok(actions.every((a) => a.round <= 6 && a.atMs < 1200));
});

test("adoption: a garden carries on from the stored round, clock, turn counts, ledgers, last feeds and MEMORY", async () => {
  const config = normalizeConfig({ feedCost: 4 });
  const bee = `import json\ndef first():\n    print(json.dumps(MEMORY))\n    return 1\ndef decide(c, r):\n    return "leave", 1\n`;
  const garden = new Garden({
    config, teams: 1, round: 40, clockMs: 8000, lastSeq: 77, endMs: 9200, paced: false, lastFed: [38], turns: [12],
    ledgers: { feeds: [[1]], nectar: [[5]], pollen: [[5]] }, memories: [{ version: 2, memory: '{"x":5}', error: null }], game: "g",
  });
  await garden.setProgram(0, "flower", flower("c"), 3);
  await garden.setProgram(0, "bee", bee, 2);
  await garden.run();
  const d = garden.drain();
  assert.equal(d.round, 46);
  assert.equal(d.clockMs, 9200);
  assert.equal(d.actions[0].seq, 78);
  assert.equal(d.actions[0].turn, 13, "turn numbers carry on");
  assert.equal(d.actions[0].round, 43, "the feed in round 38 still sits the bee out until round 43");
  assert.equal(ends(d.actions)[0].log.trim(), '{"x": 5}', "the bee starts with its stored MEMORY");
  assert.ok(d.actions.every((a) => a.atMs === 8000 + (a.round - 41) * 200 + (a.action === "arrive" ? 0 : 150)));
  assert.deepEqual(d.feeds, [[1]]);
  assert.equal(d.pollen[0][0], 5);
  assert.equal(garden.history, null, "a live garden keeps no turn records");
});

test("change budgets accrue per minute of game time up to a cap", () => {
  const { flower: f, bee } = DEFAULT_CONFIG.budgets;
  for (const b of [f, bee]) assert.equal(b.cap, b.perMinute, "a minute's worth");
  assert.equal(available(f, { bank: 0, atMs: 0 }, 30000), 110);
  assert.equal(available(f, { bank: 5, atMs: 30000 }, 45000), 60);
  assert.equal(available(f, { bank: 0, atMs: 0 }, 3600000), 220);
  assert.equal(available(bee, { bank: 0, atMs: 0 }, 30000), 1100);
});

test("try a flower: responses (big ones as a preview), percent, energy and CPU time", async () => {
  const config = normalizeConfig({ responseType: "any", budgets: { flower: { minMs: 50 } } }); // every call answers
  const r = await tryFlower({ config, code: `def flower(c):\n    return (c + 1 if c < 5 else "y" * 9000), 40\n`, challenges: [1, 2, "x", 9] });
  assert.deepEqual(r.results.map((x) => x.r), [2, 3, null, null]);
  assert.deepEqual(r.results.map((x) => x.rBytes), [1, 1, null, 9002]);
  assert.equal(r.results[3].rPreview, `"${"y".repeat(4095)}`, "the first 4 KB of a big response");
  assert.match(r.results[3].rHash, /^[0-9a-f]{64}$/);
  assert.ok(!("rFull" in r.results[3]));
  assert.deepEqual(r.results.map((x) => x.percent), [40, 40, null, 40]);
  assert.ok(r.results[0].energy > 0 && typeof r.results[0].ms === "number");
  assert.equal(r.results[0].energy, excessEnergy(config, r.size, r.results[0].ms, r.results[0].budgetMs, r.results[0].rBytes));
  assert.ok(r.results.every((x) => x.budgetMs >= 50 && x.budgetMs <= 150), "R drawn per challenge, as in a game");
  assert.ok(r.results[2].error);
});

test("try a bee: unpaced, in a garden of its own flower, with a simulated MEMORY", async () => {
  const config = normalizeConfig({});
  const t0 = performance.now();
  const r = await tryBee({ config, programs: starters(config), rounds: 100, memory: { turns: 41 } });
  assert.equal(r.rounds, 100);
  assert.ok(performance.now() - t0 < (100 * 200) / 2, "much faster than real time");
  assert.ok(r.actions.length > 20 && r.feeds > 0 && r.nectar > 0 && r.pollen > 0);
  assert.ok(r.memory.value.turns > 41 && r.memory.cap === 50, JSON.stringify(r.memory));
  assert.equal(ends(r.actions)[0].action, "leave", "it started from the memory it was given (41 turns: the next is even)");
});
