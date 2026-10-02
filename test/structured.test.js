// Structured responses (trees, graphs) through the real runners, in both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { play } from "./fixtures/garden.js";
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

def forage(seen):
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
function forage(seen: [number, Tree | null][]): any {
  if (seen.length === 0) return ["ask", 5];
  const t = seen[0][1];
  return t && t.children.length === 2 ? "feed" : "leave";
}`,
};

test("int -> graph: a bee measuring shortest paths only feeds at clovers", async () => {
  const config = normalizeConfig({ responseType: "graph" });
  const r = await play(config, [PY, PY], 40);
  assert.deepEqual(r.problems, []);
  const fed = r.actions.filter((a) => a.action === "feed");
  assert.ok(fed.length > 0 && fed.every((a) => a.kind === "clover" && a.nectar));
  assert.deepEqual(r.actions.find((a) => a.kind === "orchid" && a.action === "ask").r, { nodes: 5, edges: [[0, 1], [0, 2], [0, 3], [0, 4]] });
});

test("int -> tree[int] in TypeScript", async () => {
  const config = normalizeConfig({ language: "typescript", responseType: "tree[int]" });
  const r = await play(config, [TS, TS], 30);
  const fed = r.actions.filter((a) => a.action === "feed");
  assert.ok(fed.length > 0 && fed.every((a) => a.kind === "clover"));
  const asked = r.actions.find((a) => a.action === "ask" && a.visit === fed[0].visit && a.bee === fed[0].bee);
  assert.deepEqual(asked.r, { value: 5, children: [{ value: 10, children: [] }, { value: 15, children: [] }] });
});

test("malformed structures reach the bee as null", async () => {
  const config = normalizeConfig({ responseType: "graph" });
  const bad = `def flower(c):\n    return {"nodes": 2, "edges": [[0, 5]]}\n`;
  const r = await play(config, [{ clover: bad, orchid: bad, bee: PY.bee }], 8);
  const asks = r.actions.filter((a) => a.action === "ask");
  assert.ok(asks.length && asks.every((a) => a.r === null && a.by === "flower" && /edges\[0\]/.test(a.error)));
  assert.match(r.problems.find((p) => p.kind === "clover").error, /edges\[0\]/);
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

test("int -> graph[any]: a Paley-style clique certificate with number labels, in both languages", async () => {
  // Clover: a clique of quadratic residues mod p (labels = the numbers); the bee checks every pair.
  const py = {
    clover: `def flower(c):\n    p = 13\n    q = sorted({(x * x) % p for x in range(1, p)})\n    clique = [0, 1, 4][: 2 + c % 2]  # differences 1, 3, 4 are all squares mod 13\n    k = len(clique)\n    return {"nodes": k, "edges": [[i, j] for i in range(k) for j in range(i + 1, k)], "labels": clique}\n`,
    orchid: `def flower(c):\n    return {"nodes": 3, "edges": [[0, 1], [1, 2], [0, 2]], "labels": [0, 2, 5]}\n`,
    bee: `def forage(seen):\n    if not seen:\n        return ["ask", 7]\n    g = seen[0][1]\n    sq = {(x * x) % 13 for x in range(1, 13)}\n    ok = g and all((g["labels"][a] - g["labels"][b]) % 13 in sq for a, b in g["edges"])\n    return "feed" if ok else "leave"\n`,
  };
  const config = normalizeConfig({ responseType: "graph[any]" });
  const r = await play(config, [py], 20);
  assert.deepEqual(r.problems, []);
  const fed = r.actions.filter((a) => a.action === "feed");
  assert.ok(fed.length > 0 && fed.every((a) => a.kind === "clover"));
  const ts = {
    clover: `function flower(c: number) { return { nodes: 2, edges: [[0, 1]], labels: [{ x: c, y: 0 }, { x: 0, y: c }], edgeLabels: ["side"] }; }`,
    orchid: `function flower(c: number) { return { nodes: 2, edges: [[0, 1]], labels: ["a", "b"] }; }`,
    bee: `function forage(seen: any[]): any { if (!seen.length) return ["ask", 3]; const g = seen[0][1]; return g && typeof g.labels[0] === "object" ? "feed" : "leave"; }`,
  };
  const r2 = await play(normalizeConfig({ language: "typescript", responseType: "graph[any]" }), [ts], 15);
  assert.ok(r2.actions.filter((a) => a.action === "feed").every((a) => a.kind === "clover"));
  assert.deepEqual(r2.actions.find((a) => a.kind === "clover" && a.action === "ask").r, { nodes: 2, edges: [[0, 1]], labels: [{ x: 3, y: 0 }, { x: 0, y: 3 }], edgeLabels: ["side"] });
});
