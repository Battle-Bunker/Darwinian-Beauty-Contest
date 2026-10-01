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

test("tree[T] values", () => {
  const t = parseType("Tree[Int]");
  assert.equal(typeToString(t), "tree[int]");
  const leaf = (v) => ({ value: v, children: [] });
  assert.equal(checkValue(t, { value: 1, children: [leaf(2), { value: 3, children: [leaf(4)] }] }, 8), null);
  assert.match(checkValue(t, { value: 1 }, 8), /children/);
  assert.match(checkValue(t, { value: 1.5, children: [] }, 8), /int/);
  assert.match(checkValue(t, { value: 1, children: [], extra: 1 }, 8), /value/);
  let deep = leaf(0);
  for (let i = 0; i < 9; i++) deep = { value: i, children: [deep] };
  assert.match(checkValue(t, deep, 8), /more than 8 nodes/);
  assert.equal(checkValue(parseType("list[tree[str]]"), [leaf("a")], 8), null);
});

test("graph and digraph values", () => {
  const g = parseType("graph"), d = parseType("digraph");
  assert.equal(checkValue(g, { nodes: 4, edges: [[0, 1], [1, 2], [2, 3]] }, 8), null);
  assert.equal(checkValue(g, { nodes: 0, edges: [] }, 8), null);
  assert.match(checkValue(g, { nodes: 3, edges: [[0, 1], [1, 0]] }, 8), /repeats/);
  assert.equal(checkValue(d, { nodes: 3, edges: [[0, 1], [1, 0]] }, 8), null);
  assert.match(checkValue(g, { nodes: 3, edges: [[0, 3]] }, 8), /0 to 2/);
  assert.match(checkValue(g, { nodes: 3, edges: [[1, 1]] }, 8), /self-loop/);
  assert.match(checkValue(g, { nodes: 9, edges: [] }, 8), /0 to 8/);
  assert.match(checkValue(g, { nodes: 3, edges: [[0, 1]], labels: [] }, 8), /must be/);
});
