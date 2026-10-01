// Engine v2: turns per flower, asks after feeding, bee MEMORY across rounds, per-program compute budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateRound } from "../server/engine.js";
import { DEFAULT_CONFIG, normalizeConfig, turnsFor } from "../server/lib/gameConfig.js";

const clover = `def flower(c):\n    return c * 2\n`;
const orchid = `def flower(c):\n    return c * 3\n`;

test("defaults: turns scale with the garden; budgets are asymmetric around the orchid", () => {
  const c = normalizeConfig({});
  assert.equal(turnsFor(c, 5), 1000);
  assert.equal(turnsFor(normalizeConfig({ turns: 80 }), 5), 80);
  const { clover: cl, orchid: or, bee } = DEFAULT_CONFIG.budgets;
  assert.equal(cl.nodes * 2, or.nodes);
  assert.equal(cl.ms, 3 * or.ms);
  assert.equal(bee.nodes, 5 * or.nodes);
  assert.equal(bee.ms * 2, or.ms);
  assert.equal(or.changes, Math.round(0.7 * or.nodes));
});

test("a bee can keep asking after it feeds; feeding again just moves on", async () => {
  const bee = `def forage(seen, turns_left, visit):
    if not visit["fed"]:
        return ["ask", 1] if not seen else "feed"
    if len(seen) < 3:
        return ["ask", len(seen) + 10]
    return "feed" if visit["nectar"] is False else "leave"
`;
  const config = normalizeConfig({ turns: 40, feedCost: 5 });
  const r = await simulateRound({ config, seed: 7, teams: [{ id: "a", programs: { clover, orchid, bee } }] });
  for (const kind of ["clover", "orchid"]) {
    const v = r.visits.find((x) => x.kind === kind);
    assert.equal(v.action, "feed");
    assert.equal(v.nectar, kind === "clover");
    assert.deepEqual(v.steps.map((s) => [s.c, !!s.after]), [[1, false], [11, true], [12, true]]);
    assert.equal(v.end - v.start, 3 + 5); // "feed" again at the orchid ends the visit for free
    assert.equal(v.beeError, undefined);
  }
  assert.equal(r.feeds[0][0], r.visits.filter((v) => v.action === "feed").length);
});

for (const [language, bee1, bee2] of [
  ["python",
    `seen_answers = {}\nrounds = len(MEMORY)\ndef forage(seen, turns_left):\n    if seen:\n        seen_answers[seen[0][1]] = seen_answers.get(seen[0][1], 0) + 1\n        return "leave"\n    return ["ask", 5]\n`,
    `prev = MEMORY[-1]
try:
    prev["seen_answers"][999] = 1
    mutable = True
except TypeError:
    mutable = False
mine = dict(prev["seen_answers"])
mine[999] = 1
def forage(seen, turns_left):
    if seen:
        return "leave"
    return ["ask", 1000 * len(MEMORY) + 100 * MEMORY[0]["rounds"] + 10 * (not mutable) + len(prev["seen_answers"])]
`],
  ["typescript",
    `const seenAnswers = new Map<number, number>();\nconst rounds = MEMORY.length;\nfunction forage(seen: any[], t: number): any {\n  if (seen.length) { seenAnswers.set(seen[0][1], (seenAnswers.get(seen[0][1]) ?? 0) + 1); return "leave"; }\n  return ["ask", 5];\n}\n`,
    `const prev = MEMORY[MEMORY.length - 1];
let mutable = true;
try { prev.seenAnswers.set(999, 1); } catch (e) { mutable = false; }
const mine = new Map(prev.seenAnswers);
mine.set(999, 1);
function forage(seen: any[], t: number): any {
  if (seen.length) return "leave";
  return ["ask", 1000 * MEMORY.length + 100 * MEMORY[0].rounds + 10 * (mutable ? 0 : 1) + prev.seenAnswers.size];
}
`],
]) {
  test(`${language}: bees keep read-only MEMORY of earlier rounds`, async () => {
    const config = normalizeConfig({ language, turns: 20 });
    const flowers = language === "python" ? { clover, orchid } : {
      clover: `function flower(c: number): number { return c * 2; }`, orchid: `function flower(c: number): number { return c * 3; }`,
    };
    const r1 = await simulateRound({ config, seed: 1, teams: [{ id: "a", programs: { ...flowers, bee: bee1 } }] });
    const m1 = r1.memories[0];
    assert.ok(m1.snapshot && m1.bytes > 0, JSON.stringify(m1));
    // Round 2 reads round 1's memory: 1 round of memory, rounds=0 then, read-only, 2 distinct answers (10 and 15).
    const r2 = await simulateRound({ config, seed: 2, teams: [{ id: "a", programs: { ...flowers, bee: bee2 }, memory: [m1.snapshot] }] });
    assert.deepEqual(r2.problems[0], { clover: null, orchid: null, bee: null });
    assert.equal(r2.visits[0].steps[0].c, 1000 + 0 + 10 + 2);
    // An oversized memory is dropped with a note rather than truncated.
    const tiny = normalizeConfig({ language, turns: 20, beeMemoryKb: 0 });
    const r3 = await simulateRound({ config: tiny, seed: 1, teams: [{ id: "a", programs: { ...flowers, bee: bee1 } }] });
    assert.equal(r3.memories[0].snapshot, null);
  });
}

test("compute budgets are per program: a clover can be given far more compute than an orchid", async () => {
  // ~100ms of pure Python work, against a 400ms clover budget and a 50ms orchid budget: wide margins,
  // so the test checks the mechanism, not the machine's speed.
  const busy = `def flower(c):\n    x = 0\n    for i in range(1_400_000):\n        x = (x + i * c) % 1000003\n    return x\n`;
  const bee = `def forage(seen, turns_left):\n    return "leave" if seen else ["ask", 3]\n`;
  const config = normalizeConfig({ turns: 4, budgets: { clover: { ms: 400 }, orchid: { ms: 50 } } });
  const r = await simulateRound({ config, seed: 3, teams: [{ id: "a", programs: { clover: busy, orchid: busy, bee } }] });
  const byKind = Object.fromEntries(r.visits.map((v) => [v.kind, v.steps[0]]));
  assert.equal(typeof byKind.clover.r, "number", JSON.stringify(byKind.clover));
  assert.match(byKind.orchid.flowerError, /Timeout/);
});
