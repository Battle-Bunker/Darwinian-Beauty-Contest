// What each viewer may see of an action (server/games.js actionView): behaviour is public at once;
// code changes, print output and how long programs actually took are their own team's during play.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionView } from "../server/games.js";

const row = (fields) => ({
  seq: 1, at_ms: 400, round: 3, bee_team: "B", visit: 2, patch_team: "P", kind: "orchid", action: "ask",
  c: 5, r: 7, after: false, nectar: null, ms: 42.5, bee_ms: 3.25, error: null, error_by: null, log: "hi",
  bee_version: 2, flower_version: 4, ...fields,
});

test("flower and bee timings are their own team's during play, everyone's once it's over", () => {
  const a = row({});
  const other = actionView(a, "X", false, false), spectator = actionView(a, undefined, false, false);
  for (const v of [other, spectator]) {
    assert.equal(v.c, 5);
    assert.equal(v.r, 7, "what was asked and answered is public at once");
    assert.ok(!("ms" in v), "but not how long the flower took");
    assert.ok(!("beeMs" in v), "nor how long the bee took to decide");
    assert.ok(!("beeVersion" in v) && !("flowerVersion" in v) && !("log" in v));
  }
  const patch = actionView(a, "P", false, false);
  assert.equal(patch.ms, 42.5, "the flower's own team sees its answer time");
  assert.ok(!("beeMs" in patch));
  const bee = actionView(a, "B", false, false);
  assert.equal(bee.beeMs, 3.25, "the bee's own team sees its decision time");
  assert.ok(!("ms" in bee));
  assert.equal(bee.log, "hi");
  const over = actionView(a, "X", true, false);
  assert.equal(over.ms, 42.5);
  assert.equal(over.beeMs, 3.25);
  assert.ok(!("log" in over), "print output only once revealed");
  assert.equal(actionView(a, undefined, true, true).log, "hi");
  // a decision record: beeMs only
  const leave = row({ action: "leave", c: null, r: null, ms: null });
  assert.ok(!("beeMs" in actionView(leave, "X", false, false)));
  assert.equal(actionView(leave, "B", false, false).beeMs, 3.25);
});

test("why the engine ended a visit is the bee's team's business during play", () => {
  const a = row({ action: "leave", c: null, r: null, ms: null, error: "a new bee took over", error_by: "engine" });
  assert.ok(!("error" in actionView(a, "X", false, false)));
  assert.equal(actionView(a, "B", false, false).error, "a new bee took over");
  assert.equal(actionView(a, "X", true, false).error, "a new bee took over");
  const slow = row({ action: "error", c: null, r: null, ms: null, bee_ms: null, error: "too slow: no reply within 50 ms", error_by: "bee" });
  assert.equal(actionView(slow, "X", false, false).error, "too slow: no reply within 50 ms", "a bee's mistakes are public");
});
