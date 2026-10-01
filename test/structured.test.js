// Structured responses (trees, graphs) through the real runners, in both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateRound } from "../server/engine.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { programInterface } from "../server/lib/interface.js";

const PY = {
  // a path graph whose length depends on the challenge: distance 0 -> last = n - 1
  clover: `def flower(c):\n    n = 2 + c % 5\n    return {"nodes": n, "edges": [[i, i + 1] for i in range(n - 1)]}\n`,
  // a star: everything hangs off node 0, so 0 -> last is always 1 step
  orchid: `def flower(c):\n    n = 2 + c % 5\n    return {"nodes": n, "edges": [[0, i] for i in range(1, n)]}\n`,
  bee: `def dist(g, a, b):
    adj = {i: [] for i in range(g["nodes"])}
    for x, y in g["edges"]:
        adj[x].append(y)
        adj[y].append(x)
    seen, frontier, d = {a}, [a], 0
    while frontier:
        if b in frontier:
            return d
        frontier = [y for x in frontier for y in adj[x] if y not in seen]
        seen.update(frontier)
        d += 1
    return -1

def forage(seen, turns_left):
    if not seen:
        return ["ask", 3]
    g = seen[0][1]
    return "feed" if g and dist(g, 0, g["nodes"] - 1) > 1 else "leave"
`,
};
const TS = {
  clover: `function flower(c: number) { return { value: c, children: [{ value: c * 2, children: [] }, { value: c * 3, children: [] }] }; }`,
  orchid: `function flower(c: number) { return { value: c, children: [{ value: c * 2, children: [{ value: 1, children: [] }] }] }; }`,
  bee: `type Tree = { value: number; children: Tree[] };
function forage(seen: [number, Tree | null][], turnsLeft: number): any {
  if (seen.length === 0) return ["ask", 5];
  const t = seen[0][1];
  return t && t.children.length === 2 ? "feed" : "leave";
}`,
};

test("int -> graph: a bee measuring shortest paths only feeds at clovers", async () => {
  const config = normalizeConfig({ responseType: "graph", turns: 60 });
  const r = await simulateRound({ config, seed: 3, teams: [{ id: "a", programs: PY }, { id: "b", programs: PY }] });
  assert.deepEqual(r.problems.map((p) => [p.clover, p.orchid, p.bee]), [[null, null, null], [null, null, null]]);
  const fed = r.visits.filter((v) => v.action === "feed");
  assert.ok(fed.length > 0 && fed.every((v) => v.kind === "clover" && v.nectar));
  assert.deepEqual(r.visits.find((v) => v.kind === "orchid").steps[0].r, { nodes: 5, edges: [[0, 1], [0, 2], [0, 3], [0, 4]] });
});

test("int -> tree[int] in TypeScript", async () => {
  const config = normalizeConfig({ language: "typescript", responseType: "tree[int]", turns: 40 });
  const r = await simulateRound({ config, seed: 4, teams: [{ id: "a", programs: TS }, { id: "b", programs: TS }] });
  const fed = r.visits.filter((v) => v.action === "feed");
  assert.ok(fed.length > 0 && fed.every((v) => v.kind === "clover"));
  assert.deepEqual(fed[0].steps[0].r, { value: 5, children: [{ value: 10, children: [] }, { value: 15, children: [] }] });
});

test("malformed structures reach the bee as null", async () => {
  const config = normalizeConfig({ responseType: "graph", turns: 10 });
  const bad = `def flower(c):\n    return {"nodes": 2, "edges": [[0, 5]]}\n`;
  const r = await simulateRound({ config, seed: 1, teams: [{ id: "a", programs: { clover: bad, orchid: bad, bee: PY.bee } }] });
  assert.ok(r.visits.every((v) => v.steps.every((s) => s.r === null && /edges\[0\]/.test(s.flowerError))));
  assert.match(r.problems[0].clover, /edges\[0\]/);
});

test("the interface names types and functions but contains no behaviour", () => {
  for (const language of ["python", "typescript"]) {
    const i = programInterface(normalizeConfig({ language, responseType: "tree[int]" }));
    assert.match(i.flower, /flower/);
    assert.match(i.bee, /forage/);
    const code = (i.flower + "\n" + i.bee).split("\n").map((l) => l.replace(/(#|\/\/).*$/, "")).join("\n");
    assert.doesNotMatch(code, /return|%|\*|=>/); // signatures only: no bodies, no formulas
    assert.ok(i.types.rules.some((r) => r.startsWith("tree")));
  }
});
