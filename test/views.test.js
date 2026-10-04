// What each viewer may see of a turn (server/games.js actionView and ledgerEntry). Public as it happens:
// arrivals, challenges, responses and whether the bee fed; on a feed also the percent, energy, nectar and
// pollen. The flower's team alone sees the percent and energy of a turn without a feed and the flower's
// CPU time; the bee's team alone its decision times, errors, versions and prints. Everything is revealed
// once the game is over (prints if revealOnFinish).
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionView, turnOf } from "../server/games.js";
import { mask } from "../server/query/mask.js";

const row = (fields) => ({
  seq: 9, at_ms: 550, round: 3, turn: 2, bee_team: "B", flower_team: "F", action: "feed",
  c: 5, r: 7, r_bytes: 1, r_hash: null, r_preview: null, percent: 25, energy: 1000, cpu_ms: 12.5, pollen: 750, flower_error: null, nectar: 250,
  bee_ms: 3.25, bee_error: null, log: "hi", bee_version: 2, flower_version: 4, ...fields,
});
const leave = row({ action: "leave", nectar: null, pollen: 0, percent: 60, energy: 800 });
const arrive = row({ action: "arrive", at_ms: 400, c: null, r: null, percent: null, energy: null, cpu_ms: null, pollen: null, nectar: null, bee_ms: null, log: null });
const PUBLIC = ["seq", "atMs", "round", "turn", "bee", "flower", "action"];
const viewers = { spectator: undefined, other: "X", bee: "B", flower: "F" };

test("an arrival is public at once: whose bee, whose flower; versions only to their own teams", () => {
  for (const [who, me] of Object.entries(viewers)) {
    const v = actionView(arrive, me, false, false);
    assert.deepEqual(Object.keys(v).filter((k) => !k.endsWith("Version")), PUBLIC, who);
    assert.deepEqual([v.bee, v.flower, v.round, v.turn, v.atMs], ["B", "F", 3, 2, 400]);
    assert.equal("beeVersion" in v, who === "bee");
    assert.equal("flowerVersion" in v, who === "flower");
  }
});

test("a feed: the challenge, response, percent, energy, nectar and pollen are public; CPU time is the flower's", () => {
  for (const [who, me] of Object.entries(viewers)) {
    const v = actionView(row({}), me, false, false);
    assert.deepEqual([v.c, v.r, v.percent, v.energy, v.nectar, v.pollen], [5, 7, 25, 1000, 250, 750], who);
    assert.equal("ms" in v, who === "flower", `${who}: the flower's CPU time`);
    assert.equal("flowerError" in v, who === "flower");
    assert.equal("beeMs" in v, who === "bee", `${who}: the bee's decision time`);
    assert.equal("beeError" in v, who === "bee");
    assert.equal("log" in v, who === "bee", `${who}: what the bee printed`);
  }
  assert.equal(actionView(row({}), "F", false, false).ms, 12.5);
  assert.equal(actionView(row({}), "B", false, false).beeMs, 3.25);
});

test("a turn without a feed: the percent and energy are the flower team's; pollen is 0 and there is no nectar", () => {
  for (const [who, me] of Object.entries(viewers)) {
    const v = actionView(leave, me, false, false);
    assert.deepEqual([v.action, v.c, v.r, v.pollen], ["leave", 5, 7, 0], who);
    assert.ok(!("nectar" in v));
    assert.equal("percent" in v, who === "flower", `${who}: percent`);
    assert.equal("energy" in v, who === "flower", `${who}: energy`);
  }
  const f = actionView(leave, "F", false, false);
  assert.deepEqual([f.percent, f.energy, f.ms], [60, 800, 12.5]);
  // A late bee: its error is its own team's; everyone else just sees that it left.
  const late = row({ action: "leave", nectar: null, pollen: 0, bee_ms: null, bee_error: "too slow: no reply within 50 ms" });
  assert.ok(!("beeError" in actionView(late, "X", false, false)));
  assert.equal(actionView(late, "B", false, false).beeError, "too slow: no reply within 50 ms");
  // Why a flower failed is its own team's.
  const failed = row({ action: "leave", r: null, nectar: null, pollen: 0, percent: null, energy: 0, flower_error: "Timeout: took too long" });
  assert.equal(actionView(failed, "X", false, false).r, null);
  assert.ok(!("flowerError" in actionView(failed, "B", false, false)));
  assert.equal(actionView(failed, "F", false, false).flowerError, "Timeout: took too long");
});

test("once the game is over, everyone sees everything; prints only if revealed", () => {
  for (const a of [row({}), leave, arrive]) {
    for (const me of Object.values(viewers)) {
      const v = actionView(a, me, true, false);
      assert.equal(v.beeVersion, 2);
      assert.equal(v.flowerVersion, 4);
      if (a.action === "arrive") continue;
      assert.deepEqual([v.percent, v.energy, v.ms, v.beeMs, v.pollen], [a.percent, a.energy, 12.5, 3.25, a.pollen]);
      assert.equal("log" in v, me === "B", "prints stay hidden unless the game is revealed");
    }
  }
  assert.equal(actionView(row({}), undefined, true, true).log, "hi");
});

test("the team ledger over the API: the viewer's own view during play, every field after", () => {
  const idx = new Map([["B", 0], ["F", 1], ["X", 2]]);
  const opts = { game: "g", flowerMs: 150 };
  const t = turnOf(leave, idx, opts);
  const priv = { ms: null, flowerVersion: null, flowerError: null, beeMs: null, beeVersion: null, beeError: null, grain: null, grainVersion: null, grainCodeLength: null };
  const pub = { game: "g", seq: 9, round: 3, atMs: 400, turn: 2, bee: 0, flower: 1, challenge: 5, response: 7, responseBytes: 1, responseHash: null,
    fed: false, percent: null, energy: null, nectar: null, pollen: 0, ...priv };
  assert.deepEqual(mask("turns", t, 2), pub);
  assert.deepEqual(mask("turns", t, null), pub, "a spectator gets the public fields");
  assert.deepEqual(mask("turns", t, 1), { ...pub, percent: 60, energy: 800, ms: 12.5, flowerVersion: 4 });
  assert.deepEqual(mask("turns", t, 0), { ...pub, beeMs: 3.25, beeVersion: 2 });
  assert.deepEqual(mask("turns", t, 2, { over: true }), { ...pub, percent: 60, energy: 800, ms: 12.5, flowerVersion: 4, beeMs: 3.25, beeVersion: 2 },
    "after the game: everything");
  const fed = turnOf(row({}), idx, opts);
  assert.deepEqual(mask("turns", fed, 2), { ...pub, fed: true, percent: 25, energy: 1000, nectar: 250, pollen: 750 });
  // A response over 4 KB: no value, its size and hash (public).
  const big = turnOf(row({ r: null, r_bytes: 9000, r_hash: "ab12", r_preview: "[1,2" }), idx, opts);
  assert.deepEqual([big.response, big.responseBytes, big.responseHash], [null, 9000, "ab12"]);
});

test("a response over 4 KB: actions carry its size, hash and preview, for everyone", () => {
  const a = row({ r: null, r_bytes: 9000, r_hash: "ab12", r_preview: "[1,2" });
  for (const [who, me] of Object.entries(viewers)) {
    const v = actionView(a, me, false, false);
    assert.deepEqual([v.r, v.rBytes, v.rHash, v.rPreview], [null, 9000, "ab12", "[1,2"], who);
  }
  const small = actionView(row({}), undefined, false, false);
  assert.deepEqual([small.r, small.rBytes, "rHash" in small, "rPreview" in small], [7, 1, false, false]);
});
