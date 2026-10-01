import { test } from "node:test";
import assert from "node:assert/strict";
import { checkValue, parseType, typeToString } from "../server/lib/types.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";

test("types parse and check", () => {
  const t = parseType("list[ list[int] ]");
  assert.equal(typeToString(t), "list[list[int]]");
  assert.equal(checkValue(t, [[1, 2], []], 4), null);
  assert.match(checkValue(t, [[1.5]], 4), /int/);
  assert.match(checkValue(parseType("str"), "x".repeat(5), 4), /longer/);
  assert.match(checkValue(parseType("int"), true, 4), /int/);
  assert.match(checkValue(parseType("float"), Infinity, 4), /finite/);
  assert.throws(() => parseType("dict"));
});

test("config clamps and keeps defaults", () => {
  const c = normalizeConfig({ turns: -5, budgets: { bee: { ms: "200" } }, challengeType: "str" });
  assert.equal(c.turns, 1);
  assert.equal(c.budgets.bee.ms, 200);
  assert.equal(c.budgets.clover.nodes, 150);
  assert.equal(c.challengeType, "str");
  assert.throws(() => normalizeConfig({ responseType: "set[int]" }));
});
