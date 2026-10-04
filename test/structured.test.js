// Structured responses (trees, graphs) through the real runners, in both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { play } from "./fixtures/garden.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { programInterface } from "../server/lib/interface.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");

// Team 0's flower answers with a path graph (0 -> last is n - 1 steps), team 1's with a star (always 1 step).
const PATH = `def flower(c):\n    n = 2 + c % 5\n    return {"nodes": n, "edges": [[i, i + 1] for i in range(n - 1)]}, 50\n`;
const STAR = `def flower(c):\n    n = 2 + c % 5\n    return {"nodes": n, "edges": [[0, i] for i in range(1, n)]}, 50\n`;
const PATH_BEE = `def dist(g, a, b):
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

def first():
    return 3

def decide(c, g):
    return ("feed" if g and dist(g, 0, g["nodes"] - 1) > 1 else "leave"), 3
`;

test("int -> graph: a bee measuring shortest paths feeds only at the flower answering with paths", async () => {
  const config = normalizeConfig({ responseType: "graph", feedCost: 1 });
  const r = await play(config, [{ flower: PATH, bee: PATH_BEE }, { flower: STAR, bee: PATH_BEE }], 40);
  assert.deepEqual(r.problems, []);
  const fed = r.actions.filter((a) => a.action === "feed");
  assert.ok(fed.length > 0 && fed.every((a) => a.flower === 0 && a.nectar > 0));
  assert.deepEqual(ends(r.actions).find((a) => a.flower === 1).r, { nodes: 5, edges: [[0, 1], [0, 2], [0, 3], [0, 4]] });
});

test("int -> tree[int] in TypeScript", async () => {
  const two = `function flower(c: number) { return [{ value: c, children: [{ value: c * 2, children: [] }, { value: c * 3, children: [] }] }, 40]; }`;
  const deep = `function flower(c: number) { return [{ value: c, children: [{ value: c * 2, children: [{ value: 1, children: [] }] }] }, 40]; }`;
  const bee = `type Tree = { value: number; children: Tree[] };
function first() { return 5; }
function decide(c: number, t: Tree | null): ["feed" | "leave", number] { return [t && t.children.length === 2 ? "feed" : "leave", 5]; }`;
  const config = normalizeConfig({ language: "typescript", responseType: "tree[int]", feedCost: 1 });
  const r = await play(config, [{ flower: two, bee }, { flower: deep, bee }], 30);
  const fed = r.actions.filter((a) => a.action === "feed");
  assert.ok(fed.length > 0 && fed.every((a) => a.flower === 0));
  assert.deepEqual(fed[0].r, { value: 5, children: [{ value: 10, children: [] }, { value: 15, children: [] }] });
});

test("malformed structures reach the bee as null, with no energy", async () => {
  const config = normalizeConfig({ responseType: "graph" });
  const bad = `def flower(c):\n    return {"nodes": 2, "edges": [[0, 5]]}, 50\n`;
  const r = await play(config, [{ flower: bad, bee: PATH_BEE }], 8);
  const turns = ends(r.actions);
  assert.ok(turns.length && turns.every((a) => a.r === null && a.energy === 0 && /edges\[0\]/.test(a.flowerError)));
  assert.match(r.problems.find((p) => p.kind === "flower").error, /edges\[0\]/);
});

test("the interface names types and functions but contains no behaviour", () => {
  for (const language of ["python", "typescript"]) {
    const i = programInterface(normalizeConfig({ language, responseType: "tree[int]" }));
    assert.match(i.flower, /flower\(challenge/);
    assert.match(i.bee, /first\(\)/);
    assert.match(i.bee, /decide\(challenge[:,]/);
    const code = (i.flower + "\n" + i.bee).split("\n").map((l) => l.replace(/(#|\/\/).*$/, "")).join("\n");
    assert.doesNotMatch(code, /return|%|\*|=>/); // signatures only: no bodies, no formulas
    assert.ok(i.types.rules.some((r) => r.startsWith("tree")));
  }
});

test("int -> graph[any]: a Paley-style clique certificate with number labels, in both languages", async () => {
  // The flower: a clique of quadratic residues mod p (labels = the numbers); the bee checks every pair.
  const clique = `def flower(c):\n    clique = [0, 1, 4][: 2 + c % 2]  # differences 1, 3, 4 are all squares mod 13\n    k = len(clique)\n    return {"nodes": k, "edges": [[i, j] for i in range(k) for j in range(i + 1, k)], "labels": clique}, 30\n`;
  const fake = `def flower(c):\n    return {"nodes": 3, "edges": [[0, 1], [1, 2], [0, 2]], "labels": [0, 2, 5]}, 30\n`;
  const bee = `def first():\n    return 7\ndef decide(c, g):\n    sq = {(x * x) % 13 for x in range(1, 13)}\n    ok = g and all((g["labels"][a] - g["labels"][b]) % 13 in sq for a, b in g["edges"])\n    return ("feed" if ok else "leave"), 7\n`;
  const r = await play(normalizeConfig({ responseType: "graph[any]", feedCost: 1 }), [{ flower: clique, bee }, { flower: fake, bee }], 20);
  assert.deepEqual(r.problems, []);
  const fed = r.actions.filter((a) => a.action === "feed");
  assert.ok(fed.length > 0 && fed.every((a) => a.flower === 0));
  const ts = {
    flower: `function flower(c: number) { return [{ nodes: 2, edges: [[0, 1]], labels: [{ x: c, y: 0 }, { x: 0, y: c }], edgeLabels: ["side"] }, 30]; }`,
    bee: `function first() { return 3; }\nfunction decide(c: number, g: any): any { return [g && typeof g.labels[0] === "object" ? "feed" : "leave", 3]; }`,
  };
  const r2 = await play(normalizeConfig({ language: "typescript", responseType: "graph[any]" }), [ts], 15);
  assert.ok(r2.actions.some((a) => a.action === "feed"));
  assert.deepEqual(ends(r2.actions)[0].r, { nodes: 2, edges: [[0, 1]], labels: [{ x: 3, y: 0 }, { x: 0, y: 3 }], edgeLabels: ["side"] });
});
