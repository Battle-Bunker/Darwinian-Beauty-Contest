// Pollen carries genes (server/engine.js grainLength, grainOf): on every feed the feeding bee's team gets a
// grain of ⌊scale × pollen^exponent⌋ characters of the minified code of the flower version that answered,
// from a uniformly random start, wrapping; with the version and the code's length. Visible to the feeding
// team during play (everyone, if grains are public), to everyone after the game; never to programs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { grainLength, grainOf } from "../server/engine.js";
import { play } from "./fixtures/garden.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { size } from "../server/lib/measure.js";
import { actionView } from "../server/games.js";
import { mask } from "../server/query/mask.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("a grain's length: ⌊scale × pollen^exponent⌋ characters (27,000 pollen: 30); none without pollen, or when grains are off", () => {
  const c = normalizeConfig({});
  assert.deepEqual([c.grains, c.pollenGrain], ["feeder", { exponent: 1 / 3, scale: 1 }]);
  assert.deepEqual([27000, 26999, 1000, 8, 1, 0.5, 0, -5].map((p) => grainLength(c, p)), [30, 29, 10, 2, 1, 0, 0, 0]);
  assert.equal(grainLength(c, 150000), 53);
  assert.equal(grainLength(normalizeConfig({ pollenGrain: { scale: 2 } }), 27000), 60);
  assert.equal(grainLength(normalizeConfig({ pollenGrain: { exponent: 0.5 } }), 10000), 100);
  assert.equal(grainLength(normalizeConfig({ grains: "off" }), 27000), 0);
  assert.equal(grainLength(normalizeConfig({ pollenGrain: { scale: 0 } }), 27000), 0);
  assert.equal(normalizeConfig({ grains: "public" }).grains, "public");
  assert.equal(normalizeConfig({ grains: "nonsense" }).grains, "feeder");
});

test("a grain is a run of the code from a random start, wrapping past the end; the whole code if it's no longer", () => {
  assert.deepEqual(grainOf("abcdef", 4, 1), { grain: "bcde", grainCodeLength: 6 });
  assert.deepEqual(grainOf("abcdef", 4, 4), { grain: "efab", grainCodeLength: 6 }, "wraps to the start");
  assert.deepEqual(grainOf("abcdef", 6, 3), { grain: "abcdef", grainCodeLength: 6 }, "as long as the code: the whole code");
  assert.deepEqual(grainOf("abc", 50), { grain: "abc", grainCodeLength: 3 });
  assert.deepEqual(grainOf("abc", 0), { grain: null, grainCodeLength: 3 });
  assert.deepEqual(grainOf("a🐝b", 2, 1), { grain: "🐝b", grainCodeLength: 3 }, "characters, not UTF-16 halves");
  // Every start is as likely, so every character leaks as often.
  const code = "0123456789", seen = new Map();
  for (let i = 0; i < 20000; i++) {
    const { grain } = grainOf(code, 3);
    seen.set(grain, (seen.get(grain) ?? 0) + 1);
  }
  assert.deepEqual([...seen.keys()].sort(), ["012", "123", "234", "345", "456", "567", "678", "789", "890", "901"]);
  for (const n of seen.values()) assert.ok(n > 1700 && n < 2300, `${[...seen.entries()]}`);
});

test("every feed carries a grain of the answering version's minified code; leaves and pollen-less feeds don't", async () => {
  // A flower with a long comment-free body (so its minified code is longer than a grain), paying 30%.
  const body = Array.from({ length: 30 }, (_, i) => `    x${i} = c + ${i}`).join("\n");
  const flower = `def flower(c):\n${body}\n    return x29 % 1000, 30\n`;
  const { minified } = await size("python", flower);
  const bee = `def first():\n    return 1\ndef decide(c, r):\n    return ("feed" if c % 2 else "leave"), c + 1\n`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower, bee }], 12);
  const turns = ends(out.actions);
  const feeds = turns.filter((a) => a.action === "feed");
  assert.ok(feeds.length >= 5);
  for (const a of feeds) {
    assert.equal(a.grain.length, grainLength(normalizeConfig({}), a.pollen), `${a.grain.length} characters for ${a.pollen} pollen`);
    assert.ok(a.grain.length < minified.length);
    assert.ok((minified + minified).includes(a.grain), "a run of the minified code (wrapping)");
    assert.deepEqual([a.grainVersion, a.grainCodeLength], [1, minified.length]);
  }
  assert.ok(turns.filter((a) => a.action === "leave").every((a) => a.grain === null && a.grainVersion === null));
  // All 100% to nectar: no pollen, no grain.
  const generous = flower.replace("% 1000, 30", "% 1000, 100");
  const out2 = await play(normalizeConfig({ feedCost: 0 }), [{ flower: generous, bee }], 4);
  assert.ok(ends(out2.actions).every((a) => a.grain === null));
  // Grains off: none.
  const out3 = await play(normalizeConfig({ feedCost: 0, grains: "off" }), [{ flower, bee }], 4);
  assert.ok(ends(out3.actions).every((a) => a.grain === null));
});

test("a grain comes from the flower version pinned to the turn, even when a new version goes live mid-turn", async () => {
  const slow = (v) => `import time\ndef flower(c):\n    time.sleep(0.1)\n    return ${v}, 10\n`;
  const v1 = (await size("python", slow(1))).minified, v2 = (await size("python", slow(2))).minified;
  const bee = `def first():\n    return 1\ndef decide(c, r):\n    return "feed", 1\n`;
  let swappedAt = null;
  // (Grains three times as long, so each is the whole of these short flowers.)
  const out = await play(normalizeConfig({ feedCost: 0, pollenGrain: { scale: 3 }, budgets: { flower: { minMs: 150 } } }), [{ flower: slow(1), bee }], 200, async (garden) => {
    const open = () => garden.out.some((a) => a.action === "arrive" && !garden.out.some((e) => e.action !== "arrive" && e.turn === a.turn));
    while (!(open() && garden.round >= 3)) await wait(1);
    swappedAt = garden.seq;
    await garden.setProgram(0, "flower", slow(2), 2);
    while (!garden.out.some((a) => a.action === "feed" && a.flowerVersion === 2)) await wait(5);
    await garden.stop();
  });
  const feeds = out.actions.filter((a) => a.action === "feed");
  const spanning = feeds.find((a) => a.seq > swappedAt);
  assert.equal(spanning.flowerVersion, 1, "the turn in progress kept version 1");
  for (const a of feeds) {
    assert.equal(a.grainVersion, a.flowerVersion);
    assert.equal(a.grain, a.flowerVersion === 1 ? v1 : v2, "(a short flower: the whole code)");
  }
});

test("who sees a grain: the feeding bee's team during play (everyone if grains are public), everyone after the game", () => {
  const feed = { seq: 9, at_ms: 550, round: 3, turn: 2, bee_team: "B", flower_team: "F", action: "feed", c: 5, r: 7, r_bytes: 1, percent: 25,
    energy: 1000, cpu_ms: 1, pollen: 750, nectar: 250, bee_ms: 1, log: null, bee_version: 2, flower_version: 4, grain: "abc", grain_version: 4, grain_code_length: 9 };
  for (const [me, sees] of [["B", true], ["F", false], ["X", false], [undefined, false]]) {
    const v = actionView(feed, me, false, false);
    assert.equal("grain" in v, sees, `team ${me}`);
    if (sees) assert.deepEqual([v.grain, v.grainVersion, v.grainCodeLength], ["abc", 4, 9]);
    assert.equal(actionView(feed, me, false, false, true).grain, "abc", "public grains: everyone");
    assert.equal(actionView(feed, me, true, false).grain, "abc", "after the game: everyone");
  }
  const t = { game: "g", seq: 9, round: 3, bee: 0, flower: 1, fed: true, grain: "abc", grainVersion: 4, grainCodeLength: 9 };
  assert.deepEqual([mask("turns", t, 0).grain, mask("turns", t, 1).grain, mask("turns", t, null).grain], ["abc", null, null]);
  assert.equal(mask("turns", t, 1, { grainsPublic: true }).grainVersion, 4);
  assert.equal(mask("turns", t, null, { over: true }).grainCodeLength, 9);
});

test("programs never get grains: fed() gets the nectar only", async () => {
  const bee = `def first():\n    return 1\ndef decide(c, r):\n    return "feed", 1\ndef fed(*args):\n    MEMORY["args"] = len(args)\n    MEMORY["n"] = type(args[0]).__name__\n`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower: `def flower(c):\n    return c, 10\n`, bee }], 3);
  assert.deepEqual(JSON.parse(out.memories.at(-1).memory), { args: 1, n: "float" });
  assert.ok(out.actions.some((a) => a.grain));
});
