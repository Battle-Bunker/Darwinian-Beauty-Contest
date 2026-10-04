// A bee's MEMORY (server/engine.js, the runners): the only thing that carries over between its calls,
// capped in bytes of canonical JSON, cleared by a new version, kept across crashes and restarts, written by
// nobody but the bee; and what a stateless bee call costs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Garden, canonicalJson } from "../server/engine.js";
import { play } from "./fixtures/garden.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const flower = `def flower(c):\n    return c, 50\n`;
const tsFlower = `function flower(c: number): [number, number] { return [c, 50]; }`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("canonical JSON: sorted keys, no spaces; that's what is measured", () => {
  assert.equal(canonicalJson({ b: [1, 2, { d: null, c: "x" }], a: true }), '{"a":true,"b":[1,2,{"c":"x","d":null}]}');
  assert.equal(canonicalJson({}), "{}");
  assert.equal(Buffer.byteLength(canonicalJson({ a: [1, 2] })), 11);
  assert.equal(canonicalJson({ "é": 1 }), '{"é":1}');
});

for (const language of ["python", "typescript"]) {
  test(`${language}: the cap is enforced: a MEMORY over it isn't saved, the old one is kept, the error is recorded, the decision counts`, async () => {
    // Each turn the bee stores n and a string of n × 10 bytes ({"n":5,"pad":"xx…"} is 66 bytes); the pad is
    // 100 bytes at n = 6 and 7, which an 80-byte cap refuses.
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    n = MEMORY.get("n", 0) + 1\n    MEMORY["n"] = n\n    MEMORY["pad"] = "x" * (10 * n if n < 6 or n > 7 else 100)\n    return "feed", n\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { const n = (MEMORY.n ?? 0) + 1; MEMORY.n = n; MEMORY.pad = "x".repeat(n < 6 || n > 7 ? 10 * n : 100); return ["feed", n]; }`;
    const config = normalizeConfig({ language, feedCost: 0, budgets: { bee: { memory: 80 } } });
    const out = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee }], 9);
    const turns = ends(out.actions);
    // n counts saved turns: 1..5 are saved; the write at n = 6 is refused, so every later call computes n = 6
    // again, and is refused again.
    assert.deepEqual(turns.map((a) => a.action), turns.map(() => "feed"), "every decision counted");
    assert.deepEqual(turns.map((a) => a.c), [1, 1, 2, 3, 4, 5, 6, 6, 6]);
    const refused = turns.filter((a) => a.beeError);
    assert.equal(refused.length, 4);
    for (const a of refused) assert.match(a.beeError, /MEMORY is 116 bytes, over its cap of 80: the old memory was kept/);
    assert.equal(out.memories.length, 1);
    assert.deepEqual(JSON.parse(out.memories[0].memory), { n: 5, pad: "x".repeat(50) }, "the last memory that fitted");
    assert.match(out.memories[0].error, /over its cap/);
    assert.ok(out.problems.some((p) => p.kind === "bee" && /over its cap/.test(p.error)));
  });
}

test("python: a MEMORY that isn't plain JSON (a dict subclass, a set) isn't saved; the decision counts", async () => {
  const bee = `class D(dict):
    def items(self):
        return [("x", 1)]
def first():
    return 1
def decide(c, r):
    global MEMORY
    n = MEMORY.get("n", 0) + 1
    MEMORY["n"] = n
    if n == 2 and c == 1:
        MEMORY = D(n=n)
    elif n == 2:
        MEMORY["s"] = {1, 2}
    return "feed", n
`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower, bee }], 4);
  const turns = ends(out.actions);
  assert.ok(turns.every((a) => a.action === "feed"));
  assert.deepEqual(turns.map((a) => a.c), [1, 1, 2, 2]);
  assert.match(turns[1].beeError, /MEMORY is not plain data \(a \w+\)/); // (the class's name is minified)
  assert.match(turns[2].beeError, /MEMORY is not plain data \(a set\)/);
  assert.deepEqual(JSON.parse(out.memories[0].memory), { n: 1 });
});

for (const language of ["python", "typescript"]) {
  test(`${language}: MEMORY survives the bee's process crashing and restarting; a new version clears it`, async () => {
    const bee = language === "python"
      ? `def first():\n    return MEMORY.get("n", 0)\ndef decide(c, r):\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    return "leave", MEMORY["n"]\n`
      : `function first() { return MEMORY.n ?? 0; }\nfunction decide(c: number, r: any): ["leave", number] { MEMORY.n = (MEMORY.n ?? 0) + 1; return ["leave", MEMORY.n]; }`;
    const config = normalizeConfig({ language });
    let killedAt = null, newVersionAt = null;
    const out = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee }], 400, async (garden) => {
      while (garden.history.length < 5) await wait(5);
      killedAt = garden.history.length;
      garden.bees[0].proc.kill(); // the runner dies: the bee is restarted at the next round
      while (garden.history.length < killedAt + 6) await wait(5);
      newVersionAt = garden.round;
      await garden.setProgram(0, "bee", bee + (language === "python" ? "# v2\n" : "// v2\n"), 2);
      while (garden.history.filter((t) => t.beeVersion === 2).length < 4) await wait(5);
      await garden.stop();
    });
    const v1 = out.history.filter((t) => t.beeVersion === 1 && !t.beeError).map((t) => t.challenge);
    // The challenges count up through the restart (first() answers with the count so far): none goes back.
    for (let i = 1; i < v1.length; i++) assert.ok(v1[i] >= v1[i - 1], `v1: ${v1}`);
    assert.ok(v1.at(-1) >= killedAt, `it kept counting after the crash: ${v1}`);
    const v2 = out.history.filter((t) => t.beeVersion === 2).map((t) => t.challenge);
    assert.deepEqual(v2.slice(0, 3), [0, 1, 2], "the new version started from an empty MEMORY");
    assert.ok(newVersionAt > 0);
  });
}

test("no operator write path: only the garden writes bee_memories, and the API has no field for it", () => {
  const files = ["server/games.js", "server/routes/api.js", "server/live.js", "server/realtime.js", "server/sockets.js", "server/query/sql.js"];
  const writers = files.filter((f) => /\b(INSERT INTO|UPDATE|DELETE FROM)\s+bee_memories\b/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(writers, ["server/live.js"], "live.js flushes the garden's memories; nothing else writes them");
  const live = fs.readFileSync(path.join(ROOT, "server/live.js"), "utf8");
  assert.match(live, /for \(const m of d\.memories\)/, "and only from the garden's drain()");
  // The routes: the only request field named memory is try's, which runs a local test bee.
  const api = fs.readFileSync(path.join(ROOT, "server/routes/api.js"), "utf8");
  assert.ok(!/memory/i.test(api.replace(/tryProgram\(req\.game, req\.user, req\.body \|\| \{\}\)/, "")), "no route names memory");
  const games = fs.readFileSync(path.join(ROOT, "server/games.js"), "utf8");
  const tryFn = games.slice(games.indexOf("export async function tryProgram"), games.indexOf("// ---------- the views"));
  assert.match(tryFn, /tryBee\(\{ config: cfg, programs: \{ flower: own, bee: code \}, rounds: n, memory: memory \?\? \{\} \}\)/);
  assert.ok(!/bee_memories/.test(tryFn), "try never touches a game's memory");
});

test("a stateless bee call fits easily in 50 ms: Python forks, TypeScript gets a fresh context (with a 20,000-turn HISTORY)", async () => {
  // 20,000 turns of history (8 teams × 2,500 rounds); the bee runs a typical query on every call.
  const history = [];
  for (let round = 1; round <= 2500; round++) {
    for (let bee = 0; bee < 8; bee++) {
      const fed = (round + bee) % 3 === 0, flower = (round * 7 + bee * 3) % 8, energy = 100000 + ((round * 31 + bee) % 997) * 50;
      history.push({ game: "g", round, atMs: (round - 1) * 200, turn: round, bee, flower, challenge: round % 97, response: (round * 13) % 101, fed,
        percent: 40, energy, nectar: fed ? 0.4 * energy : null, pollen: fed ? 0.6 * energy : 0, ms: 2, flowerVersion: 1, flowerError: null,
        beeMs: 3, beeVersion: 1, beeError: null });
    }
  }
  const results = {};
  for (const language of ["python", "typescript"]) {
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    rows = HISTORY.turns.my_bee().eq("fed", True).group_by("flower").sum("nectar").count().rows()\n    MEMORY["best"] = max(rows, key=lambda x: x["sum_nectar"] or 0)["flower"] if rows else None\n    return "leave", c + 1\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["leave", number] { const rows = HISTORY.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").count().rows(); MEMORY.best = rows.length ? rows.reduce((a, b) => ((b.sum_nectar ?? 0) > (a.sum_nectar ?? 0) ? b : a)).flower : null; return ["leave", c + 1]; }`;
    const config = normalizeConfig({ language });
    const garden = new Garden({ config, teams: 8, round: 2500, clockMs: 500000, history, endMs: Infinity, maxRounds: 40, paced: false, game: "g" });
    for (let ti = 0; ti < 8; ti++) {
      await garden.setProgram(ti, "flower", language === "python" ? flower : tsFlower, 1);
      await garden.setProgram(ti, "bee", bee, 1);
    }
    await garden.run();
    const d = garden.drain();
    const ms = ends(d.actions).map((a) => a.beeMs).filter((x) => typeof x === "number").sort((a, b) => a - b);
    assert.ok(ms.length > 100, `${language}: ${ms.length} decisions`);
    assert.ok(!ends(d.actions).some((a) => a.beeError), `${language}: ${ends(d.actions).find((a) => a.beeError)?.beeError}`);
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
    results[language] = { median: q(0.5), p95: q(0.95), max: ms.at(-1), n: ms.length };
    assert.ok(q(0.95) < 25, `${language}: 95% of decisions within 25 ms of their 50 (${JSON.stringify(results[language])})`);
  }
  console.log("stateless bee decision wall time (ms), 20,000-turn HISTORY:", JSON.stringify(results));
});
