// The garden (server/engine.js), one flower per team: lockstep rounds of one turn per bee, queued
// challenges, flowers drawn at random, [response, percent] within 150 ms and excess energy from CPU time,
// responses delivered at 150 ms, the bees' 50 ms decision deadline with late replies and re-requests, the
// nectar/pollen split and feedCost, the team ledger delivered between turns, stateless flowers, bees that
// keep their state until replaced, versions pinned per turn, pacing and the game clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Garden, entryFor, tryBee, tryFlower } from "../server/engine.js";
import { starters } from "./fixtures/programs.js";
import { play } from "./fixtures/garden.js";
import { DEFAULT_CONFIG, available, excessEnergy, normalizeConfig, roundMs } from "../server/lib/gameConfig.js";
import { size } from "../server/lib/measure.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const byBee = (actions, b) => actions.filter((a) => a.bee === b);
const arrivals = (actions, b) => byBee(actions, b).filter((a) => a.action === "arrive");
const tooSlow = (a) => a.action === "leave" && /too slow/.test(a.beeError || "");
const busy = (ms) => `t = time.perf_counter()\n    while time.perf_counter() - t < ${ms / 1000}:\n        pass\n`;
const flower = (expr, pct = 50) => `def flower(c, ledger):\n    return ${expr}, ${pct}\n`;
const leaver = (next = "1") => `def first(ledger):\n    return 1\ndef decide(c, r, ledger):\n    return "leave", ${next}\n`;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Stop the garden once done(actions so far) holds (or it runs out of rounds).
const stopWhen = (done) => async (garden) => {
  while (!garden.closed && !done(garden.out)) await wait(5);
  await garden.stop();
};

test("defaults: a 1,100-node flower with 150 ms, an 11,000-node bee with 50 ms, 200 ms rounds, feedCost 10", () => {
  const { flower: f, bee } = DEFAULT_CONFIG.budgets;
  assert.deepEqual(f, { size: 1100, perMinute: 220, cap: 220, ms: 150 });
  assert.deepEqual(bee, { size: 11000, perMinute: 2200, cap: 2200, ms: 50 });
  assert.equal(roundMs(DEFAULT_CONFIG), 200);
  assert.equal(DEFAULT_CONFIG.feedCost, 10);
  assert.equal(DEFAULT_CONFIG.minutes, 2);
  // all configurable
  const c = normalizeConfig({ feedCost: 3, budgets: { flower: { size: 900, perMinute: 100, cap: 50, ms: 120 }, bee: { size: 5000, ms: 30 } } });
  assert.deepEqual(c.budgets.flower, { size: 900, perMinute: 100, cap: 50, ms: 120 });
  assert.deepEqual(c.budgets.bee, { size: 5000, perMinute: 2200, cap: 2200, ms: 30 });
  assert.equal(roundMs(c), 150);
  assert.equal(c.feedCost, 3);
  assert.ok(!("cosmos" in c.budgets) && !("orchid" in c.budgets));
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
    }
    for (const a of out.actions) assert.equal(a.atMs, (a.round - 1) * 200 + (a.action === "arrive" ? 0 : 150), JSON.stringify(a));
    const seqs = out.actions.map((a) => a.seq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "actions are numbered in order");
    // The ledgers add up to the turns.
    const feeds = out.actions.filter((a) => a.action === "feed");
    assert.equal(out.feeds.flat().reduce((x, y) => x + y, 0), feeds.length);
    close(out.nectar.flat().reduce((x, y) => x + y, 0), feeds.reduce((s, a) => s + a.nectar, 0));
    close(out.pollen.flat().reduce((x, y) => x + y, 0), feeds.reduce((s, a) => s + a.pollen, 0));
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
    busy60: `import time\ndef flower(c, ledger):\n    ${busy(60)}    return c, 40\n`,
    sleep60: `import time\ndef flower(c, ledger):\n    time.sleep(0.06)\n    return c, 40\n`,
    late: `import time\ndef flower(c, ledger):\n    ${busy(200)}    return c, 40\n`,
    bare: `def flower(c, ledger):\n    return c\n`,
    badPercent: `def flower(c, ledger):\n    return c, "half"\n`,
    nanPercent: `def flower(c, ledger):\n    return c, float("nan")\n`,
    crash: `def flower(c, ledger):\n    return 1 / 0, 40\n`,
    high: `def flower(c, ledger):\n    return c, 250\n`,
    low: `def flower(c, ledger):\n    return c, -3.5\n`,
    oneArg: `def flower(c):\n    return [c, c], 12.5\n`,
  };
  const bee = `def first(ledger):\n    return 7\ndef decide(c, r, ledger):\n    return "feed", 7\n`;
  const got = {};
  for (const [name, code] of Object.entries(cases)) { // one at a time, so a busy flower has a core to itself
    const out = await play(normalizeConfig({ responseType: "any", feedCost: 0 }), [{ flower: code, bee }], 3);
    got[name] = { turns: ends(out.actions), size: (await size("python", code)).size, problems: out.problems };
  }
  for (const name of ["busy60", "sleep60", "high", "low", "oneArg"]) {
    const { turns, size: s } = got[name];
    assert.equal(turns.length, 3, name);
    for (const t of turns) {
      assert.equal(t.flowerError, null, `${name}: ${t.flowerError}`);
      assert.equal(typeof t.ms, "number");
      assert.equal(t.energy, excessEnergy(config, s, t.ms), `${name}: E = (1100 − ${s}) × (150 − ${t.ms})`);
      assert.ok(t.energy > 0);
    }
  }
  for (const t of got.busy60.turns) assert.ok(t.ms > 40 && t.ms < 100, `busy for 60 ms: ${t.ms} ms of CPU`);
  for (const t of got.sleep60.turns) assert.ok(t.ms < 20, `asleep for 60 ms: only ${t.ms} ms of CPU`);
  assert.ok(got.sleep60.turns[0].energy > got.busy60.turns[0].energy * 1.4, "sleeping costs no energy, working does");
  assert.deepEqual(got.high.turns.map((t) => t.percent), [100, 100, 100], "percent is clamped to 0–100");
  assert.deepEqual(got.low.turns.map((t) => t.percent), [0, 0, 0]);
  assert.deepEqual(got.oneArg.turns.map((t) => [t.r, t.percent]), [[[7, 7], 12.5], [[7, 7], 12.5], [[7, 7], 12.5]], "the ledger argument is optional");
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
  for (const t of got.late.turns) assert.ok(t.ms >= 140, `stopped at its limit: ${t.ms} ms of CPU`);
});

test("typescript: energy from CPU time, and a late flower gives none", async () => {
  const config = normalizeConfig({ language: "typescript" });
  const busyTs = (ms) => `function flower(c: number, ledger: readonly unknown[]): [number, number] { const t = Date.now(); while (Date.now() - t < ${ms}) {} return [c, 30]; }`;
  const bee = `function first(ledger: unknown[]) { return 3; }\nfunction decide(c: number, r: number | null, ledger: unknown[]) { return ["leave", 3]; }`;
  const runs = [];
  for (const code of [busyTs(40), busyTs(200)]) {
    const out = await play(config, [{ flower: code, bee }], 2);
    runs.push({ turns: ends(out.actions), size: (await size("typescript", code)).size });
  }
  const [fast, late] = runs;
  for (const t of fast.turns) {
    assert.ok(t.ms > 25 && t.ms < 90, `${t.ms}`);
    assert.equal(t.energy, excessEnergy(config, fast.size, t.ms));
    assert.equal(t.r, 3);
  }
  for (const t of late.turns) {
    assert.equal(t.r, null);
    assert.equal(t.energy, 0);
    assert.match(t.flowerError, /Timeout/);
  }
});

test("nectar and pollen: a feed splits E by percent; a turn without a feed pays nobody", async () => {
  const bee = `n = 0\ndef first(ledger):\n    return 1\ndef decide(c, r, ledger):\n    global n\n    n += 1\n    return ("feed" if n % 2 else "leave"), n\n`;
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

test("feedCost: a bee that feeds sits out exactly feedCost rounds, then plays the challenge it queued", async () => {
  for (const feedCost of [0, 7]) {
    const bee = `def first(ledger):\n    return 0\ndef decide(c, r, ledger):\n    return "feed", c + 1\n`;
    const out = await play(normalizeConfig({ feedCost }), [{ flower: flower("c"), bee }], 30);
    const arr = arrivals(out.actions, 0).map((a) => a.round);
    assert.deepEqual(arr, arr.map((_, i) => 1 + i * (feedCost + 1)), `feedCost ${feedCost}: ${arr}`);
    assert.deepEqual(ends(out.actions).map((a) => a.c), arr.map((_, i) => i));
  }
});

test("neither side learns its counterpart until the turn is over: the ledger holds only finished turns", async () => {
  // Every flower answers with what its ledger holds; every bee prints what its ledger holds as it decides.
  const config = normalizeConfig({ responseType: "any", feedCost: 2 });
  const fl = `def flower(c, ledger, *rest):\n    return [len(ledger), max([e["round"] for e in ledger] or [0]), len(rest), sorted(GAME)], 50\n`;
  const bee = `import json
def first(*args):
    return 1
def decide(c, r, ledger, *rest):
    print(json.dumps([len(ledger), max([e["round"] for e in ledger] or [0]), len(rest)]))
    return ("feed" if c % 3 == 0 else "leave"), c + 1
`;
  const out = await play(config, [0, 1, 2].map(() => ({ flower: fl, bee })), 40);
  const turns = ends(out.actions);
  const finishedBefore = (r) => out.history.filter((t) => t.round < r).length;
  assert.ok(turns.length > 60);
  for (const a of turns) {
    const [len, maxRound, extra, gameKeys] = a.r;
    assert.equal(len, finishedBefore(a.round), "the flower's ledger: every turn finished before this round, none of this one");
    assert.ok(maxRound < a.round);
    assert.equal(extra, 0, "flower(challenge, ledger): nothing about the bee that asked");
    assert.deepEqual(gameKeys, ["challenge_type", "feed_cost", "flower_ms", "flower_size_cap", "max_len", "max_nodes", "ms", "response_type", "round_ms", "size", "team", "teams"]);
    const [blen, bmax, bextra] = JSON.parse(a.log);
    assert.equal(blen, finishedBefore(a.round), "the bee decides without its own turn in its ledger");
    assert.ok(bmax < a.round);
    assert.equal(bextra, 0, "decide(challenge, response, ledger): nothing about the flower");
  }
  // After the turn, both sides find it in their ledgers, counterpart included.
  const t = turns.find((a) => a.round < 30);
  const later = turns.find((a) => a.bee === t.bee && a.round > t.round);
  assert.ok(later.r[0] > out.history.indexOf(out.history.find((h) => h.round === t.round && h.bee === t.bee)));
  const entry = entryFor(out.history.find((h) => h.round === t.round && h.bee === t.bee), t.bee);
  assert.equal(entry.flower, t.flower, "the bee's team learns whose flower it was");
  assert.equal(entryFor(out.history.find((h) => h.round === t.round && h.bee === t.bee), t.flower).bee, t.bee, "and the flower's team whose bee");
});

test("the team ledger: every turn's public fields, plus the team's own private details", () => {
  const fed = { round: 5, bee: 0, flower: 1, c: 3, r: 4, fed: true, percent: 25, energy: 1000, nectar: 250, pollen: 750, ms: 12 };
  const left = { round: 5, bee: 2, flower: 1, c: 7, r: null, fed: false, percent: 60, energy: 800, nectar: null, pollen: 0, ms: 3 };
  // A feed: public, but the flower's CPU time is its own team's.
  for (const ti of [0, 2]) assert.deepEqual(entryFor(fed, ti), { round: 5, bee: 0, flower: 1, challenge: 3, response: 4, fed: true, percent: 25, energy: 1000, nectar: 250, pollen: 750, ms: null });
  assert.equal(entryFor(fed, 1).ms, 12);
  // No feed: pollen 0, no nectar; the percent and energy are the flower's team's.
  for (const ti of [0, 2]) assert.deepEqual(entryFor(left, ti), { round: 5, bee: 2, flower: 1, challenge: 7, response: null, fed: false, percent: null, energy: null, nectar: null, pollen: 0, ms: null });
  assert.deepEqual(entryFor(left, 1), { round: 5, bee: 2, flower: 1, challenge: 7, response: null, fed: false, percent: 60, energy: 800, nectar: null, pollen: 0, ms: 3 });
});

test("python: every team's programs get exactly its own view of the ledger, delivered incrementally", async () => {
  // Bees and flowers print/return a digest of their whole ledger; it must equal the engine's view for the team.
  const config = normalizeConfig({ responseType: "str", feedCost: 1, maxLen: 64 });
  const digest = `json.dumps(ledger, separators=(",", ":"))`;
  const fl = (pct) => `import hashlib, json\ndef flower(c, ledger):\n    return hashlib.sha256(${digest}.encode()).hexdigest()[:40], ${pct}\n`;
  const bee = `import hashlib, json
def first(ledger):
    return 0
def decide(c, r, ledger):
    print(len(ledger), hashlib.sha256(${digest}.encode()).hexdigest()[:40])
    return ("feed" if c % 2 else "leave"), c + 1
`;
  const out = await play(config, [10, 50, 90].map((p) => ({ flower: fl(p), bee })), 30);
  const sha = (x) => crypto.createHash("sha256").update(x).digest("hex").slice(0, 40);
  const view = (ti, round) => JSON.stringify(out.history.filter((t) => t.round < round).map((t) => entryFor(t, ti)));
  const turns = ends(out.actions);
  assert.ok(turns.length > 40);
  for (const a of turns) {
    if (a.r !== null) assert.equal(a.r, sha(view(a.flower, a.round)), `flower ${a.flower}, round ${a.round}`);
    const [len, h] = a.log.trim().split(" ");
    assert.equal(Number(len), out.history.filter((t) => t.round < a.round).length);
    assert.equal(h, sha(view(a.bee, a.round)), `bee ${a.bee}, round ${a.round}`);
  }
  // The views differ by team: each sees the percent of its own unfed turns only.
  const last = out.round + 1;
  assert.notEqual(view(0, last), view(1, last));
});

test("typescript: a flower's ledger is frozen and shared safely; nothing it does survives the call", async () => {
  const config = normalizeConfig({ language: "typescript", responseType: "any" });
  const fl = `function flower(c: number, ledger: any[]): [any, number] {
  const out: any[] = [ledger.length, Object.isFrozen(ledger), ledger.length ? Object.isFrozen(ledger[0]) : true];
  try { (ledger as any).push(1); } catch { out.push("no push"); }
  try { ledger.constructor.constructor("return 1")(); out.push("compiled"); } catch { out.push("no compile"); }
  try { (ledger as any).__proto__.stash = ((ledger as any).__proto__.stash || 0) + 1; } catch {}
  out.push((ledger as any).stash ?? null);
  return [out, 50];
}`;
  const bee = `function first(l: any[]) { return 1; }\nfunction decide(c: number, r: any, l: any[]) { return ["leave", 1]; }`;
  const out = await play(config, [{ flower: fl, bee }], 6);
  const rs = ends(out.actions).map((a) => a.r);
  assert.deepEqual(rs.map((r) => r[0]), [0, 1, 2, 3, 4, 5], "one more entry each round");
  for (const r of rs) assert.deepEqual(r.slice(1), [true, true, "no push", "no compile", null]);
});

test("a bare \"leave\" gets first() asked at once: in time it makes the next round, slower costs a round (paced)", async () => {
  const fast = `def first(ledger):\n    return 1\ndef decide(c, r, ledger):\n    return "leave"\n`;
  const slow = `import time\nn = 0\ndef first(ledger):\n    global n\n    n += 1\n    if n > 1:\n        time.sleep(0.12)\n    return 2\ndef decide(c, r, ledger):\n    return "leave"\n`;
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee: fast }, { flower: flower("c"), bee: slow }], 12, null, { paced: true });
  assert.deepEqual(out.problems, []);
  const r0 = arrivals(out.actions, 0).map((a) => a.round), r1 = arrivals(out.actions, 1).map((a) => a.round);
  assert.ok(r0.length >= 9 && r1.length >= 4, `${r0} / ${r1}`);
  assert.deepEqual(r0.slice(1).map((r, i) => r - r0[i]), r0.slice(1).map(() => 1), `bee 0 plays every round: ${r0}`);
  assert.deepEqual(r1.slice(1).map((r, i) => r - r1[i]), r1.slice(1).map(() => 2), `bee 1 misses every other round: ${r1}`);
  assert.ok(ends(out.actions).every((a) => a.action === "leave" && !a.beeError), "a bare leave is a leave, not an error");
});

test("a bad next challenge: the feed still counts, then first() supplies the next one", async () => {
  const bee = `n = 0\ndef first(ledger):\n    return 1000\ndef decide(c, r, ledger):\n    global n\n    n += 1\n    return ("feed", "seven") if n == 2 else ("leave", n)\n`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower: flower("c"), bee }], 6);
  const turns = ends(out.actions);
  assert.deepEqual(turns.map((a) => [a.action, a.c]), [["leave", 1000], ["feed", 1], ["leave", 1000], ["leave", 3], ["leave", 4], ["leave", 5]]);
  assert.match(turns[1].beeError, /next challenge must be an int/);
});

test("a late [\"leave\", c] queues c, though the turn is settled without it; the bee loses a round (paced)", async () => {
  const bee = `import time
n = 0
def first(ledger):
    return 1
def decide(c, r, ledger):
    global n
    n += 1
    if n == 3:
        ${busy(80).replaceAll("\n    ", "\n        ")}        return "leave", 777
    return "feed" if n == 99 else "leave", 100 + n
`;
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee }], 10, null, { paced: true });
  const mine = byBee(out.actions, 0);
  const turns = ends(mine);
  const late = turns.find(tooSlow);
  assert.ok(late, JSON.stringify(mine));
  assert.equal(late.atMs, (late.round - 1) * 200 + 150);
  assert.equal(late.beeMs, null);
  assert.deepEqual(turns.map((a) => a.c).slice(0, 5), [1, 101, 102, 777, 104]);
  const a777 = turns.find((a) => a.c === 777);
  assert.equal(late.c, 102, "too slow deciding after asking 102");
  assert.equal(a777.round, late.round + 2, "the round after, its call was still running: no turn");
  assert.ok(!mine.some((a) => a.round === late.round + 1));
});

test("a late reply never feeds: a late [\"feed\", c] is a leave, c is never asked, and first() supplies the next (paced)", async () => {
  const bee = `import time
n = 0
k = 0
def first(ledger):
    global k
    k += 1
    return 500 + k
def decide(c, r, ledger):
    global n
    n += 1
    if n == 3:
        ${busy(80).replaceAll("\n    ", "\n        ")}        return "feed", 7
    return "leave", 100 + n
`;
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
  test(`${language}: a bee that runs over 2 s: too slow at 50 ms, a Timeout at 2 s, then first() (paced)`, async () => {
    const bee = language === "python"
      ? `n = 0\ndef first(ledger):\n    return 1000\ndef decide(c, r, ledger):\n    global n\n    n += 1\n    if n == 3:\n        while True:\n            pass\n    return "leave", n\n`
      : `let n = 0;\nfunction first(l: any[]) { return 1000; }\nfunction decide(c: number, r: any, l: any[]) { n += 1; if (n === 3) { while (true) {} } return ["leave", n]; }\n`;
    const other = language === "python" ? leaver("9") : `function first(l: any[]) { return 9; }\nfunction decide(c: number, r: any, l: any[]) { return ["leave", 9]; }`;
    const fl = language === "python" ? flower("c") : `function flower(c: number, l: any[]) { return [c, 50]; }`;
    const out = await play(normalizeConfig({ language }), [{ flower: fl, bee }, { flower: fl, bee: other }], 18, null, { paced: true });
    const mine = byBee(out.actions, 0);
    const late = mine.find(tooSlow);
    assert.ok(late, JSON.stringify(mine));
    const after = ends(mine).filter((a) => a.round > late.round);
    assert.ok(after.length && after[0].c === 1000, JSON.stringify(after[0]));
    assert.ok(after[0].round >= late.round + 9 && after[0].round <= late.round + 13, `back in round ${after[0].round} (late in ${late.round})`);
    assert.ok(out.problems.some((p) => p.team === 0 && p.kind === "bee"));
    const others = arrivals(out.actions, 1).filter((a) => a.round > late.round && a.round < after[0].round);
    assert.ok(others.length >= after[0].round - late.round - 2, "the other bee played on");
    assert.ok(out.wallMs < 18 * 200 + 1500, `${Math.round(out.wallMs)} ms`);
  });
}

test("a hung bee is killed and starts afresh", async () => {
  // It swallows the runner's timeout, so the runner never replies: the process is killed and restarted.
  const bee = `n = 0
def first(ledger):
    return 0
def decide(c, r, ledger):
    global n
    n += 1
    if n == 3:
        while True:
            try:
                while True:
                    pass
            except BaseException:
                pass
    return "leave", n
`;
  const out = await play(normalizeConfig({}), [{ flower: flower("c"), bee }], 40, async (garden) => {
    while (garden.history.filter((t) => t.c === 1).length < 2 && garden.rounds < 40) await wait(50);
    await garden.stop();
  }, { paced: true });
  const cs = ends(out.actions).map((a) => a.c);
  assert.deepEqual(cs.slice(0, 3), [0, 1, 2]);
  assert.ok(cs.slice(3).includes(0), "it starts again from first()");
  assert.ok(out.actions.some(tooSlow));
});

test("responses can't reveal timing: every response reaches the bee at the end of the flower window (paced)", async () => {
  // Two flowers, one working 120 ms, one answering at once. The bee times the gap between its decisions.
  const slow = `import time\ndef flower(c, ledger):\n    ${busy(120)}    return 1, 50\n`;
  const quick = flower("2");
  const bee = `import time
last = 0.0
def first(ledger):
    return 1
def decide(c, r, ledger):
    global last
    t = time.perf_counter()
    if last:
        print(round((t - last) * 1000, 1))
    last = time.perf_counter()
    return "leave", 1
`;
  const gapsOf = (acts) => {
    const gaps = { 1: [], 2: [] };
    for (const a of ends(acts).filter((x) => x.bee === 0 && x.log)) gaps[a.r]?.push(Number(a.log));
    return gaps;
  };
  const enough = (acts) => { const g = gapsOf(acts); return g[1].length >= 4 && g[2].length >= 4; };
  const out = await play(normalizeConfig({}), [{ flower: slow, bee }, { flower: quick, bee: leaver() }], 80, stopWhen(enough), { paced: true });
  const gaps = gapsOf(out.actions);
  assert.ok(gaps[1].length >= 3 && gaps[2].length >= 3, JSON.stringify(gaps));
  for (const g of [...gaps[1], ...gaps[2]]) assert.ok(g > 185 && g < 225, `${g} ms between decisions`);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean(gaps[1]) - mean(gaps[2])) < 15, JSON.stringify(gaps));
});

for (const language of ["python", "typescript"]) {
  test(`${language}: GAME: the team, the time limits, the size cap and the flower's own size`, async () => {
    const config = normalizeConfig({ language, responseType: "any", challengeType: "any" });
    const p = language === "python"
      ? { flower: `def flower(c, ledger):\n    return [GAME["team"], GAME["teams"], GAME["ms"], GAME["round_ms"], GAME["flower_size_cap"], GAME["size"]], 1\n`,
        bee: `def first(ledger):\n    return [GAME["team"], GAME["ms"], GAME["flower_ms"], GAME["feed_cost"]]\ndef decide(c, r, ledger):\n    return "leave", c\n` }
      : { flower: `function flower(c: any, l: any[]) { return [[GAME.team, GAME.teams, GAME.ms, GAME.round_ms, GAME.flower_size_cap, GAME.size], 1]; }`,
        bee: `function first(l: any[]) { return [GAME.team, GAME.ms, GAME.flower_ms, GAME.feed_cost]; }\nfunction decide(c: any, r: any, l: any[]) { return ["leave", c]; }` };
    const out = await play(config, [p, p], 10);
    const s = (await size(language, p.flower)).size;
    for (const a of ends(out.actions)) {
      assert.deepEqual(a.c, [a.bee, 50, 150, 10]);
      assert.deepEqual(a.r, [a.flower, 2, 150, 200, 1100, s]);
    }
  });
}

for (const language of ["python", "typescript"]) {
  test(`${language}: flowers are stateless: fresh randomness, a clock, no answer cache`, async () => {
    const config = normalizeConfig({ language });
    const py = {
      counter: `import math\nn = 0\ndef flower(c, ledger):\n    global n\n    n += 1\n    math.k = getattr(math, "k", 0) + 1\n    return n * 1000 + math.k, 1\n`,
      anytime: `import random, time\ndef flower(c, ledger):\n    t0 = time.perf_counter()\n    best = 0\n    while time.perf_counter() - t0 < 0.3 * GAME["ms"] / 1000:\n        best = max(best, random.randint(0, 10**9))\n    return best, 1\n`,
    };
    const ts = {
      counter: `let n = 0;\nfunction flower(c: number, l: any[]): [number, number] { n += 1; (Math as any).k = ((Math as any).k || 0) + 1; return [n * 1000 + (Math as any).k, 1]; }\n`,
      anytime: `function flower(c: number, l: any[]): [number, number] {\n  const t0 = Date.now(); let best = 0;\n  while (Date.now() - t0 < 0.3 * GAME.ms) best = Math.max(best, Math.floor(Math.random() * 1e9));\n  return [best, 1];\n}\n`,
    };
    const p = language === "python" ? py : ts;
    const bee = language === "python" ? leaver("7") : `function first(l: any[]) { return 7; }\nfunction decide(c: number, r: any, l: any[]) { return ["leave", 7]; }`;
    const out = await play(config, [{ flower: p.counter, bee }, { flower: p.anytime, bee }], 16);
    const turns = ends(out.actions);
    for (const a of turns) assert.equal(a.flowerError, null, a.flowerError);
    for (const a of turns.filter((a) => a.flower === 0)) assert.equal(a.r, 1001, "nothing survives between calls");
    const anytime = turns.filter((a) => a.flower === 1);
    assert.ok(anytime.length >= 6);
    assert.ok(new Set(anytime.map((a) => a.r)).size >= anytime.length - 1, "the same question gets a fresh answer every call");
    assert.ok(anytime.reduce((s, a) => s + a.ms, 0) / anytime.length >= 35, "it searched for its share of the 150 ms");
  });
}

test("programs run minified: the names they define can't carry data", async () => {
  const config = normalizeConfig({ responseType: "any" });
  const helper = (name) => `def ${name}():\n    return 0\ndef flower(c, ledger):\n    return [len(${name}.__name__), sorted(k for k in globals() if not k.startswith("__"))], 1\n`;
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
  test(`${language}: a bee keeps its state until new code replaces it; between turns, new code goes live at once`, async () => {
    const config = normalizeConfig({ language });
    const py = {
      flower: (k) => flower(String(k)),
      bee: `n = 0\ndef first(ledger):\n    global n\n    n += 1\n    return n\ndef decide(c, r, ledger):\n    global n\n    n += 1\n    return "leave", n\n`,
    };
    const ts = {
      flower: (k) => `function flower(c: number, l: any[]) { return [${k}, 50]; }`,
      bee: `let n = 0;\nfunction first(l: any[]) { n += 1; return n; }\nfunction decide(c: number, r: any, l: any[]) { n += 1; return ["leave", n]; }\n`,
    };
    const p = language === "python" ? py : ts;
    const out = await play(config, [{ flower: p.flower(1), bee: p.bee }], 60, async (garden) => {
      while (garden.rounds < 20) await wait(5);
      await garden.setProgram(0, "flower", p.flower(3), 2);
      await garden.setProgram(0, "bee", p.bee, 2);
    });
    const turns = ends(out.actions);
    const v1 = turns.filter((a) => a.beeVersion === 1), v2 = turns.filter((a) => a.beeVersion === 2);
    assert.ok(v1.length > 5 && v2.length > 5, `${v1.length} then ${v2.length}`);
    assert.deepEqual(v1.map((a) => a.c), v1.map((_, i) => i + 1), "the bee remembers between calls");
    assert.deepEqual(v2.map((a) => a.c), v2.map((_, i) => i + 1), "new code starts afresh");
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
  const slowFlower = (v) => `import time\ndef flower(c, ledger):\n    time.sleep(0.1)\n    return ${v}, 50\n`;
  let at = null, retiredDuring = null;
  const out = await play(normalizeConfig({}), [{ flower: slowFlower(1), bee: leaver() }], 200, async (garden) => {
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
  const slowFlower = `import time\ndef flower(c, ledger):\n    time.sleep(0.1)\n    return c, 50\n`;
  const v1 = `def first(ledger):\n    return 100\ndef decide(c, r, ledger):\n    return "feed", 999\n`;
  const v2 = `def first(ledger):\n    return 5000\ndef decide(c, r, ledger):\n    return "leave", 5001\n`;
  const config = normalizeConfig({ feedCost: 3 });
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
  const bee = `n = 0\ndef first(ledger):\n    return 0\ndef decide(c, r, ledger):\n    global n\n    n += 1\n    if n == 2:\n        return "dance"\n    if n == 4:\n        raise ValueError("oops")\n    return "feed" if n == 6 else "leave", n\n`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower: flower("c"), bee }], 12);
  const turns = ends(out.actions);
  assert.match(turns[1].beeError, /decide must return/);
  assert.match(turns[3].beeError, /ValueError: oops/);
  assert.equal(turns[1].action, "leave");
  assert.deepEqual(turns.map((a) => a.c).slice(0, 6), [0, 1, 0, 3, 0, 5], "after a bad reply, first() opens the next turn");
  assert.ok(out.problems.some((p) => p.kind === "bee"));
  const dud = await play(normalizeConfig({}), [{ flower: flower("c"), bee: `import os\n` + bee }], 5);
  assert.equal(dud.actions.length, 0);
  assert.match(dud.problems[0].error, /not allowed/);
  const missing = await play(normalizeConfig({}), [{ flower: flower("c"), bee: `def first(ledger):\n    return 1\n` }], 3);
  assert.match(missing.problems[0].error, /must define first\(ledger\) and decide/);
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
    assert.deepEqual(await ask(1), { v: [2, 50] });
    pool.users++; // a turn is pinned to version 1 while version 2 goes live
    await garden.setProgram(0, "flower", flower("c + 100"), 2);
    assert.ok(garden.retiring.has(pool));
    const hung = pool.procs[0];
    hung.child.kill("SIGSTOP");
    const lost = await ask(2);
    assert.equal(lost.dead, true);
    assert.match(lost.e, /stopped responding/);
    assert.ok(await exited(hung), "the hung process is gone");
    for (let c = 3; c < 10; c++) assert.deepEqual(await ask(c), { v: [c + 1, 50] });
    assert.notEqual(pool.procs[0], hung);
    assert.deepEqual((await garden.flowers[0].pool.call(3)).v, [103, 50], "version 2 answers its own turns");
    for (const p of [...pool.procs, ...garden.flowers[0].pool.procs]) seen.add(p);
  } finally {
    await garden.run();
  }
  for (const p of seen) assert.ok(await exited(p), "closing the garden kills every process, respawned ones too");
});

test("a flower whose processes keep dying is respawned at most once a second per process, with the ledger so far", async () => {
  const { garden, pool, ask } = await flowerPool(`def flower(c, ledger):\n    return len(ledger), 50\n`);
  try {
    garden.history.push({ round: 1, bee: 0, flower: 0, c: 1, r: 1, fed: false, nectar: null, percent: 50, energy: 1, ms: 1, pollen: 0 });
    garden.delivered = 1; // as if delivered at the last round boundary: a respawned process starts with it
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
    assert.deepEqual(answers.slice(0, n), answers.slice(0, n).map(() => ({ v: [1, 50] })), "respawned with the ledger so far");
    assert.ok(answers.slice(n).every((a) => a.dead), JSON.stringify(answers));
    await wait(1000);
    assert.deepEqual(await ask(7), { v: [1, 50] });
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

test("adoption: a garden carries on from the stored round, clock, turn counts, ledgers and team ledger", async () => {
  const config = normalizeConfig({ feedCost: 4 });
  const history = [
    { round: 37, bee: 0, flower: 0, c: 5, r: 5, fed: false, nectar: null, percent: 50, energy: 10, ms: 1, pollen: 0 },
    { round: 38, bee: 0, flower: 0, c: 5, r: 5, fed: true, nectar: 5, percent: 50, energy: 10, ms: 1, pollen: 5 },
  ];
  const bee = `def first(ledger):\n    print(len(ledger), ledger[-1]["fed"])\n    return 1\ndef decide(c, r, ledger):\n    return "leave", 1\n`;
  const garden = new Garden({
    config, teams: 1, round: 40, clockMs: 8000, lastSeq: 77, endMs: 9200, paced: false, history, turns: [12],
    ledgers: { feeds: [[1]], nectar: [[5]], pollen: [[5]] },
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
  assert.equal(ends(d.actions)[0].log.trim(), "2 True", "the new bee's ledger starts with the stored turns");
  assert.ok(d.actions.every((a) => a.atMs === 8000 + (a.round - 41) * 200 + (a.action === "arrive" ? 0 : 150)));
  assert.deepEqual(d.feeds, [[1]]);
  assert.equal(d.pollen[0][0], 5);
});

test("change budgets accrue per minute of game time up to a cap", () => {
  const { flower: f, bee } = DEFAULT_CONFIG.budgets;
  for (const b of [f, bee]) assert.equal(b.cap, b.perMinute, "a minute's worth");
  assert.equal(available(f, { bank: 0, atMs: 0 }, 30000), 110);
  assert.equal(available(f, { bank: 5, atMs: 30000 }, 45000), 60);
  assert.equal(available(f, { bank: 0, atMs: 0 }, 3600000), 220);
  assert.equal(available(bee, { bank: 0, atMs: 0 }, 30000), 1100);
});

test("try a flower: responses, percent, energy and CPU time", async () => {
  const config = normalizeConfig({});
  const r = await tryFlower({ config, code: `def flower(c, ledger):\n    return c + len(ledger), 40\n`, challenges: [1, 2, "x"], ledger: [{ round: 1 }] });
  assert.deepEqual(r.results.map((x) => x.r), [2, 3, null]);
  assert.deepEqual(r.results.map((x) => x.percent), [40, 40, null]);
  assert.ok(r.results[0].energy > 0 && typeof r.results[0].ms === "number");
  assert.equal(r.results[0].energy, excessEnergy(config, r.size, r.results[0].ms));
  assert.ok(r.results[2].error);
});

test("try a bee: unpaced, in a garden of its own flower", async () => {
  const config = normalizeConfig({});
  const t0 = performance.now();
  const r = await tryBee({ config, programs: starters(config), rounds: 100 });
  assert.equal(r.rounds, 100);
  assert.ok(performance.now() - t0 < (100 * 200) / 2, "much faster than real time");
  assert.ok(r.actions.length > 20 && r.feeds > 0 && r.nectar > 0 && r.pollen > 0);
});
