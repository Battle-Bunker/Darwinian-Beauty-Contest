// What each viewer may see of a turn (server/games.js actionView and ledgerEntry). Public as it happens:
// arrivals, challenges, responses and whether the bee fed; on a feed also the percent, energy, nectar and
// surplus. The flower's team alone sees the percent and energy of a turn without a feed and the flower's
// CPU time; the bee's team alone its decision times, errors, versions and prints. Everything is revealed
// once the game is over (prints if revealOnFinish).
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionView, ledgerEntry, turnOf } from "../server/games.js";

const row = (fields) => ({
  seq: 9, at_ms: 550, round: 3, turn: 2, bee_team: "B", flower_team: "F", action: "feed",
  c: 5, r: 7, percent: 25, energy: 1000, cpu_ms: 12.5, surplus: 750, flower_error: null, nectar: 250,
  bee_ms: 3.25, bee_error: null, log: "hi", bee_version: 2, flower_version: 4, ...fields,
});
const leave = row({ action: "leave", nectar: null, surplus: 0, percent: 60, energy: 800 });
const arrive = row({ action: "arrive", at_ms: 400, c: null, r: null, percent: null, energy: null, cpu_ms: null, surplus: null, nectar: null, bee_ms: null, log: null });
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

test("a feed: the challenge, response, percent, energy, nectar and surplus are public; CPU time is the flower's", () => {
  for (const [who, me] of Object.entries(viewers)) {
    const v = actionView(row({}), me, false, false);
    assert.deepEqual([v.c, v.r, v.percent, v.energy, v.nectar, v.surplus], [5, 7, 25, 1000, 250, 750], who);
    assert.equal("ms" in v, who === "flower", `${who}: the flower's CPU time`);
    assert.equal("flowerError" in v, who === "flower");
    assert.equal("beeMs" in v, who === "bee", `${who}: the bee's decision time`);
    assert.equal("beeError" in v, who === "bee");
    assert.equal("log" in v, who === "bee", `${who}: what the bee printed`);
  }
  assert.equal(actionView(row({}), "F", false, false).ms, 12.5);
  assert.equal(actionView(row({}), "B", false, false).beeMs, 3.25);
});

test("a turn without a feed: the percent and energy are the flower team's; surplus is 0 and there is no nectar", () => {
  for (const [who, me] of Object.entries(viewers)) {
    const v = actionView(leave, me, false, false);
    assert.deepEqual([v.action, v.c, v.r, v.surplus], ["leave", 5, 7, 0], who);
    assert.ok(!("nectar" in v));
    assert.equal("percent" in v, who === "flower", `${who}: percent`);
    assert.equal("energy" in v, who === "flower", `${who}: energy`);
  }
  const f = actionView(leave, "F", false, false);
  assert.deepEqual([f.percent, f.energy, f.ms], [60, 800, 12.5]);
  // A late bee: its error is its own team's; everyone else just sees that it left.
  const late = row({ action: "leave", nectar: null, surplus: 0, bee_ms: null, bee_error: "too slow: no reply within 50 ms" });
  assert.ok(!("beeError" in actionView(late, "X", false, false)));
  assert.equal(actionView(late, "B", false, false).beeError, "too slow: no reply within 50 ms");
  // Why a flower failed is its own team's.
  const failed = row({ action: "leave", r: null, nectar: null, surplus: 0, percent: null, energy: 0, flower_error: "Timeout: took too long" });
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
      assert.deepEqual([v.percent, v.energy, v.ms, v.beeMs, v.surplus], [a.percent, a.energy, 12.5, 3.25, a.surplus]);
      assert.equal("log" in v, me === "B", "prints stay hidden unless the game is revealed");
    }
  }
  assert.equal(actionView(row({}), undefined, true, true).log, "hi");
});

test("the team ledger over the API: the viewer's own view during play, every field after", () => {
  const idx = new Map([["B", 0], ["F", 1], ["X", 2]]);
  const t = turnOf(leave, idx);
  assert.deepEqual(ledgerEntry(t, 2), { round: 3, bee: 0, flower: 1, challenge: 5, response: 7, fed: false, percent: null, energy: null, nectar: null, surplus: 0, ms: null });
  assert.deepEqual(ledgerEntry(t, -1), ledgerEntry(t, 2), "a spectator gets the public fields");
  assert.deepEqual(ledgerEntry(t, 1), { round: 3, bee: 0, flower: 1, challenge: 5, response: 7, fed: false, percent: 60, energy: 800, nectar: null, surplus: 0, ms: 12.5 });
  assert.deepEqual(ledgerEntry(t, null), ledgerEntry(t, 1), "after the game: everything");
  const fed = turnOf(row({}), idx);
  assert.deepEqual(ledgerEntry(fed, 0), { round: 3, bee: 0, flower: 1, challenge: 5, response: 7, fed: true, percent: 25, energy: 1000, nectar: 250, surplus: 750, ms: null });
});
