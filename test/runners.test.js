// No free compute: no program code may run after its clock stops. A reply (and a bee's MEMORY) is turned
// into plain data on the clock: Python copies it into exact built-in types, refusing subclasses whose hooks
// (items, __iter__, __float__, __repr__, ...) would otherwise run while the reply is encoded; TypeScript
// encodes it inside the program's context under its time limit, so toJSON, getters and proxies are counted.
// (Regressions for the free-compute reports in docs/research/one-flower-ecosystem.md.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { play } from "./fixtures/garden.js";
import { excessEnergy, normalizeConfig } from "../server/lib/gameConfig.js";
import { size } from "../server/lib/measure.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const pyBee = `def first():\n    return 1\ndef decide(c, r):\n    return "feed", 1\n`;
const tsBee = `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { return ["feed", 1]; }`;

async function turnsOf(language, flower, rounds = 2, responseType = "any") {
  const config = normalizeConfig({ language, responseType, feedCost: 0, maxResponseBytes: 65536, budgets: { flower: { minMs: 150 } } }); // R held at 150; big replies fit
  const out = await play(config, [{ flower, bee: language === "python" ? pyBee : tsBee }], rounds);
  return { turns: ends(out.actions), config, size: (await size(language, flower)).size };
}

test("typescript: work done in a reply's toJSON is on the flower's clock", async () => {
  const burn = (ms) => `const t = Date.now(); while (Date.now() - t < ${ms}) {}`;
  const flower = (ms) => `function flower(c: number): [any, number] {\n  return [{ toJSON() { ${burn(ms)} return { nodes: 1 }; } }, 50];\n}`;
  const charged = await turnsOf("typescript", flower(100));
  for (const t of charged.turns) {
    assert.deepEqual(t.r, { nodes: 1 });
    assert.ok(t.ms >= 70, `100 ms in toJSON is charged: ${t.ms} ms (floor loose for a busy machine)`);
    assert.equal(t.energy, excessEnergy(charged.config, charged.size, t.ms, t.budgetMs, t.rBytes));
  }
  const stopped = await turnsOf("typescript", flower(400));
  for (const t of stopped.turns) {
    assert.equal(t.r, null, "400 ms in toJSON is stopped at the 150 ms limit");
    assert.equal(t.energy, 0);
    assert.match(t.flowerError, /Timeout/);
  }
  // Getters run on the clock too.
  const getter = await turnsOf("typescript", `function flower(c: number): [any, number] {\n  return [{ get x() { ${burn(100)} return 1; } }, 50];\n}`);
  for (const t of getter.turns) assert.ok(t.ms >= 70 && t.r.x === 1, `${t.ms}`);
});

test("python: subclasses of dict, list, str, int and float are refused: their hooks can't run after the clock stops", async () => {
  const cases = {
    dictItems: `import time\nclass D(dict):\n    def items(self):\n        t = time.perf_counter()\n        while time.perf_counter() - t < 0.3:\n            pass\n        return super().items()\ndef flower(c):\n    return D(nodes=1), 50\n`,
    dictIter: `class D(dict):\n    def __iter__(self):\n        return iter(["nodes"])\ndef flower(c):\n    return D(nodes=1), 50\n`,
    listSub: `class L(list):\n    pass\ndef flower(c):\n    return L([1, 2]), 50\n`,
    strSub: `class S(str):\n    def __str__(self):\n        return "x"\ndef flower(c):\n    return S("a"), 50\n`,
    intPercent: `class I(int):\n    def __index__(self):\n        return 3\ndef flower(c):\n    return 1, I(50)\n`,
    floatPercent: `class F(float):\n    def __float__(self):\n        return 3.0\n    def __repr__(self):\n        return "50.0"\ndef flower(c):\n    return 1, F(50)\n`,
    nested: `class D(dict):\n    pass\ndef flower(c):\n    return {"a": [1, {"b": D()}]}, 50\n`,
    key: `class K(str):\n    pass\ndef flower(c):\n    return {K("a"): 1}, 50\n`,
  };
  for (const [name, code] of Object.entries(cases)) {
    const { turns } = await turnsOf("python", code);
    assert.ok(turns.length, name);
    for (const t of turns) {
      assert.equal(t.r, null, `${name}: refused`);
      assert.equal(t.energy, 0, `${name}: no energy`);
      assert.match(t.flowerError, /not plain data/, `${name}: ${t.flowerError}`);
      assert.ok(t.ms < 100, `${name}: nothing ran for long (${t.ms} ms)`);
    }
  }
  // Plain data in the same shapes is fine: tuples become lists, int keys strings.
  const { turns } = await turnsOf("python", `def flower(c):\n    return {"a": (1, 2.5, None, True), 3: [{"b": "x"}]}, 50.0\n`);
  for (const t of turns) assert.deepEqual([t.r, t.percent], [{ a: [1, 2.5, null, true], 3: [{ b: "x" }] }, 50]);
});

test("python: copying a big reply into plain data is the flower's own compute", async () => {
  const { turns } = await turnsOf("python", `def flower(c):\n    return [[i] * 60 for i in range(60)], 50\n`, 2);
  for (const t of turns) {
    assert.equal(t.flowerError, null);
    assert.equal(t.rBytes, JSON.stringify(Array.from({ length: 60 }, (_, i) => Array(60).fill(i))).length, "(over 4 KB: shown by size and preview)");
    assert.ok(t.ms > 0);
  }
});

test("bees: a reply's hooks run on the bee's clock too; Python refuses subclasses in a bee's reply", async () => {
  const flower = `def flower(c):\n    return c, 50\n`;
  const pyHook = `class T(tuple):\n    pass\ndef first():\n    return 1\ndef decide(c, r):\n    return T(("feed", 2))\n`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower, bee: pyHook }], 3);
  for (const t of ends(out.actions)) {
    assert.equal(t.action, "leave");
    assert.match(t.beeError, /not plain data \(a \w+\)/); // (the class's name is minified)
  }
  // TypeScript: 80 ms in toJSON makes the bee late (its 50 ms are wall time, encoding included).
  const tsHook = `function first() { return 1; }\nfunction decide(c: number, r: any): any { return { toJSON() { const t = Date.now(); while (Date.now() - t < 80) {} return ["feed", 2]; } }; }`;
  const ts = await play(normalizeConfig({ language: "typescript", feedCost: 0 }), [{ flower: `function flower(c: number) { return [c, 50]; }`, bee: tsHook }], 4, null, { paced: true });
  const late = ends(ts.actions).filter((a) => /too slow/.test(a.beeError || ""));
  assert.ok(late.length >= 1, JSON.stringify(ends(ts.actions)));
  assert.ok(!ends(ts.actions).some((a) => a.action === "feed"), "a late reply never feeds");
});
