// A bee's MEMORY (server/engine.js, the runners): a key-value store, the only thing that carries over from
// one turn to the next; capped in bytes (Σ key bytes + value JSON bytes), cleared by a new version, kept
// across crashes and restarts, written by nobody but the bee. And fed(nectar): after a feed, in the same
// program instance as that decision, with MEMORY saved after it; a valid challenge it returns replaces the
// one decide queued.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Garden, canonicalJson, memoryShapeError, memorySize, tryBee } from "../server/engine.js";
import { play } from "./fixtures/garden.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const flower = `def flower(c):\n    return c, 50\n`;
const tsFlower = `function flower(c: number): [number, number] { return [c, 50]; }`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("the size of a MEMORY: Σ over entries of the key's UTF-8 bytes + the value's JSON bytes (RULES.md's examples)", () => {
  const cases = [
    [{}, 0], [{ n: 7 }, 2], [{ n: -12 }, 4], [{ p: 0.25 }, 5], [{ ok: true }, 6], [{ x: null }, 5], [{ best: "a7" }, 8],
    [{ q: 'say "hi"' }, 13], [{ "é": 1 }, 3], [{ n: 7, best: "a7", ok: true }, 16], [{ "": "" }, 2],
  ];
  for (const [m, n] of cases) assert.equal(memorySize(m), n, JSON.stringify(m));
  assert.equal(canonicalJson({ b: 1, a: "x" }), '{"a":"x","b":1}', "stored with sorted keys");
});

test("the shape of a MEMORY: string keys to strings, finite numbers, booleans or null; nothing nested", () => {
  for (const ok of [{}, { a: 1, b: "x", c: true, d: null, e: -0.5 }, { [String(Number.MAX_SAFE_INTEGER)]: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(memoryShapeError(ok), null, JSON.stringify(ok));
  }
  for (const [bad, re] of [[[1, 2], /not a list/], [null, /not null/], [5, /not a number/], ["x", /not a string/], [{ a: [1] }, /"a"\] is a list/],
    [{ a: { b: 1 } }, /is a dict/], [{ a: 2 ** 60 }, /out of range/]]) {
    assert.match(memoryShapeError(bad), re, JSON.stringify(bad));
  }
});

for (const language of ["python", "typescript"]) {
  test(`${language}: the cap is enforced: a MEMORY over it isn't saved, the old one is kept, the error is recorded, the decision counts`, async () => {
    // Each turn the bee stores n and a string of n bytes: {"n": 5, "s": "xxxxx"} is 1 + 1 + 1 + 7 = 10 bytes.
    // With a cap of 12, n = 6 and 7 (the pad 100 bytes long) are refused.
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    n = MEMORY.get("n", 0) + 1\n    MEMORY["n"] = n\n    MEMORY["s"] = "x" * (n if n < 6 or n > 7 else 100)\n    return "feed", n\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { const n = (MEMORY.n ?? 0) + 1; MEMORY.n = n; MEMORY.s = "x".repeat(n < 6 || n > 7 ? n : 100); return ["feed", n]; }`;
    const config = normalizeConfig({ language, feedCost: 0, budgets: { bee: { memory: 12 } } });
    const out = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee }], 9);
    const turns = ends(out.actions);
    // n counts saved turns: 1..5 are saved; the write at n = 6 is refused, so every later call computes n = 6
    // again, and is refused again.
    assert.deepEqual(turns.map((a) => a.action), turns.map(() => "feed"), "every decision counted");
    assert.deepEqual(turns.map((a) => a.c), [1, 1, 2, 3, 4, 5, 6, 6, 6]);
    const refused = turns.filter((a) => a.beeError);
    assert.equal(refused.length, 4);
    for (const a of refused) assert.match(a.beeError, /MEMORY is 105 bytes, over its cap of 12: the old memory was kept/);
    assert.equal(out.memories.length, 1);
    assert.deepEqual(JSON.parse(out.memories[0].memory), { n: 5, s: "xxxxx" }, "the last memory that fitted");
    assert.equal(out.memories[0].bytes, 10);
    assert.match(out.memories[0].error, /over its cap/);
    assert.ok(out.problems.some((p) => p.kind === "bee" && /over its cap/.test(p.error)));
  });
}

for (const language of ["python", "typescript"]) {
  test(`${language}: a MEMORY of the wrong shape (nested, not a dict) isn't saved; the decision counts`, async () => {
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    global MEMORY\n    n = MEMORY.get("n", 0) + 1\n    MEMORY["n"] = n\n    if c == 2:\n        MEMORY["l"] = [1, 2]\n    elif c == 3:\n        MEMORY = [n]\n    return "feed", c + 1\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { const n = (MEMORY.n ?? 0) + 1; MEMORY.n = n; if (c === 2) MEMORY.l = [1, 2]; else if (c === 3) (globalThis as any).MEMORY = [n]; return ["feed", c + 1]; }`;
    const out = await play(normalizeConfig({ language, feedCost: 0 }), [{ flower: language === "python" ? flower : tsFlower, bee }], 4);
    const turns = ends(out.actions);
    assert.ok(turns.every((a) => a.action === "feed"));
    assert.match(turns[1].beeError, language === "python" ? /MEMORY\['l'\] is a list/ : /MEMORY\["l"\] is a list/);
    assert.match(turns[2].beeError, /MEMORY must be a dict/);
    assert.equal(turns[3].beeError, null);
    assert.deepEqual(JSON.parse(out.memories[0].memory), { n: 2 }, "saved again once it had the right shape");
  });
}

test("python: a MEMORY with a dict subclass, a set, a huge int or a non-string key isn't saved; the decision counts", async () => {
  const bee = `class D(dict):
    def items(self):
        return [("x", 1)]
def first():
    return 1
def decide(c, r):
    global MEMORY
    n = MEMORY.get("n", 0) + 1
    MEMORY["n"] = n
    if c == 2:
        MEMORY = D(n=n)
    elif c == 3:
        MEMORY["s"] = {1, 2}
    elif c == 4:
        MEMORY["i"] = 2 ** 60
    elif c == 5:
        MEMORY[5] = 1
    return "feed", c + 1
`;
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower, bee }], 6);
  const turns = ends(out.actions);
  assert.ok(turns.every((a) => a.action === "feed"));
  assert.match(turns[1].beeError, /MEMORY must be a dict, not a \w+/); // (the class's name is minified)
  assert.match(turns[2].beeError, /is a set/);
  assert.match(turns[3].beeError, /an int beyond/);
  assert.match(turns[4].beeError, /keys must be strings/);
  assert.deepEqual(JSON.parse(out.memories[0].memory), { n: 2 });
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

// ---------- fed(nectar)

for (const language of ["python", "typescript"]) {
  test(`${language}: fed(nectar) runs after a feed in the same instance as its decision: globals intact, MEMORY saved after it`, async () => {
    // decide keeps what it worked out in a global (never in MEMORY); fed reads it back and stores it.
    const p = language === "python"
      ? {
        flower: `def flower(c):\n    return c * 3, 40\n`,
        bee: `import random\nTOKEN = random.randint(1, 10**9)\nSEEN = None\ndef first():\n    return 1\ndef decide(c, r):\n    global SEEN\n    SEEN = [c, r]\n    return ("feed" if c % 2 else "leave"), c + 1\ndef fed(nectar):\n    MEMORY["c"] = SEEN[0]\n    MEMORY["r"] = SEEN[1]\n    MEMORY["n"] = nectar\n    MEMORY["t"] = TOKEN\n    MEMORY["calls"] = MEMORY.get("calls", 0) + 1\n    print("fed", SEEN[0])\n`,
      }
      : {
        flower: `function flower(c: number): [number, number] { return [c * 3, 40]; }`,
        bee: `const TOKEN = Math.floor(Math.random() * 1e9) + 1;\nlet SEEN: any = null;\nfunction first() { return 1; }\nfunction decide(c: number, r: any): ["feed" | "leave", number] { SEEN = [c, r]; return [c % 2 ? "feed" : "leave", c + 1]; }\nfunction fed(nectar: number) { MEMORY.c = SEEN[0]; MEMORY.r = SEEN[1]; MEMORY.n = nectar; MEMORY.t = TOKEN; MEMORY.calls = (MEMORY.calls ?? 0) + 1; console.log("fed", SEEN[0]); }`,
      };
    const config = normalizeConfig({ language, feedCost: 1, budgets: { bee: { memory: 100 } } });
    const memories = [];
    const out = await play(config, [p], 14, async (garden) => {
      // Record the bee's MEMORY after each settled feed, once its fed() is done.
      let seen = 0;
      while (!garden.closed) {
        const feeds = garden.history.filter((t) => t.fed);
        if (feeds.length > seen && !garden.bees[0].fedDone) { seen = feeds.length; memories.push([feeds.at(-1), JSON.parse(garden.memoryOf(0).memory)]); }
        await wait(1);
      }
    });
    const feeds = out.history.filter((t) => t.fed);
    assert.ok(feeds.length >= 4, `${feeds.length} feeds`);
    const last = JSON.parse(out.memories.at(-1).memory);
    assert.equal(last.calls, feeds.length, "fed ran once per feed, never after a leave");
    const t = feeds.at(-1);
    assert.equal(last.c, t.challenge, "it saw the challenge its own decide saw");
    assert.equal(last.r, t.response, "and the response");
    assert.equal(last.n, t.nectar, "fed got the nectar of that feed");
    assert.ok(Number.isInteger(last.t) && last.t > 0);
    for (const [turn, m] of memories) assert.equal(m.c, turn.challenge, "every fed saw its own turn");
    assert.ok(new Set(memories.map(([, m]) => m.t)).size >= memories.length - 1, "a fresh instance (and TOKEN) every turn");
    // What fed printed shows up with the bee's next turn.
    const logs = ends(out.actions).map((a) => a.log || "");
    assert.ok(logs.some((l) => /^fed \d+/.test(l)), JSON.stringify(logs));
    assert.deepEqual(out.problems, []);
  });
}

for (const language of ["python", "typescript"]) {
  test(`${language}: fed() is stopped at 50 ms, saves nothing then, and costs no turn; a bee without fed() is fine`, async () => {
    const p = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    MEMORY["d"] = MEMORY.get("d", 0) + 1\n    return "feed", c + 1\ndef fed(nectar):\n    MEMORY["f"] = MEMORY.get("f", 0) + 1\n    if MEMORY["d"] == 2:\n        while True:\n            pass\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { MEMORY.d = (MEMORY.d ?? 0) + 1; return ["feed", c + 1]; }\nfunction fed(n: number) { MEMORY.f = (MEMORY.f ?? 0) + 1; if (MEMORY.d === 2) { while (true) {} } }`;
    const config = normalizeConfig({ language, feedCost: 0 });
    const out = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee: p }], 7, null, { paced: true });
    const rounds = ends(out.actions).map((a) => a.round);
    assert.ok(rounds.length >= 5, `${rounds}`);
    assert.deepEqual(rounds.slice(1).map((r, i) => r - rounds[i]), rounds.slice(1).map(() => 1), `with feedCost 0, a fed() that runs out its time still costs no turn: ${rounds}`);
    const m = JSON.parse(out.memories.at(-1).memory);
    assert.equal(m.d, rounds.length);
    assert.equal(m.f, rounds.length - 1, "the stopped fed (after decision 2) saved nothing; the others did");
    assert.ok(out.problems.some((x) => /fed\(\) failed \(Timeout/.test(x.error)), JSON.stringify(out.problems));
    // No fed() at all: nothing happens after a feed.
    const plain = language === "python" ? `def first():\n    return 1\ndef decide(c, r):\n    MEMORY["d"] = MEMORY.get("d", 0) + 1\n    return "feed", c + 1\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { MEMORY.d = (MEMORY.d ?? 0) + 1; return ["feed", c + 1]; }`;
    const out2 = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee: plain }], 4);
    assert.deepEqual(JSON.parse(out2.memories.at(-1).memory), { d: 4 });
    assert.deepEqual(out2.problems, []);
  });
}

test("fed() isn't called after a late decision (paced)", async () => {
  const bee = `import time\ndef first():\n    return 1\ndef decide(c, r):\n    if c == 2:\n        time.sleep(0.08)\n    return "feed", c + 1\ndef fed(n):\n    MEMORY["fed"] = MEMORY.get("fed", "") + str(MEMORY.get("c", "")) + ","\n`;
  const counting = bee.replace(`def decide(c, r):\n`, `def decide(c, r):\n    MEMORY["c"] = c\n`);
  const out = await play(normalizeConfig({ feedCost: 0 }), [{ flower, bee: counting }], 6, null, { paced: true });
  const turns = ends(out.actions);
  const late = turns.find((a) => /too slow/.test(a.beeError || ""));
  assert.ok(late && late.c === 2 && late.action === "leave", JSON.stringify(turns));
  const fedFor = JSON.parse(out.memories.at(-1).memory).fed.split(",").filter(Boolean).map(Number);
  assert.ok(!fedFor.includes(2), `no fed after the late decision: ${fedFor}`);
  assert.ok(fedFor.includes(1));
});

test("try a bee: fed() runs there too, and the test bee starts from the MEMORY given (within the cap)", async () => {
  const config = normalizeConfig({ feedCost: 1 });
  const bee = `def first():\n    return MEMORY.get("start", 0)\ndef decide(c, r):\n    return "feed", c + 1\ndef fed(n):\n    MEMORY["fed"] = MEMORY.get("fed", 0) + 1\n`;
  const r = await tryBee({ config, programs: { flower, bee }, rounds: 20, memory: { start: 40 } });
  assert.equal(ends(r.actions)[0].c, 40);
  assert.deepEqual(r.memory, { value: { start: 40, fed: r.feeds }, bytes: 5 + 2 + 3 + String(r.feeds).length, cap: 50, error: null });
  assert.ok(r.feeds >= 9);
});

// ---------- fed(nectar) may queue the next challenge

const fedQueues = {
  // fed's k-th call: 1000 × k when k is odd; None (explicitly, or by returning nothing) when it is even.
  python: `def first():\n    MEMORY["f"] = MEMORY.get("f", 0) + 1\n    return 1\ndef decide(c, r):\n    return "feed", c + 1\n` +
    `def fed(nectar):\n    k = MEMORY["k"] = MEMORY.get("k", 0) + 1\n    if k % 2:\n        return 1000 * k\n    if k % 4 == 2:\n        return None\n`,
  typescript: `function first() { MEMORY.f = ((MEMORY.f as number) ?? 0) + 1; return 1; }\n` +
    `function decide(c: number, r: any): ["feed", number] { return ["feed", c + 1]; }\n` +
    `function fed(nectar: number): number | null | void { const k = ((MEMORY.k as number) ?? 0) + 1; MEMORY.k = k; if (k % 2) return 1000 * k; if (k % 4 === 2) return null; }`,
};

for (const language of ["python", "typescript"]) {
  test(`${language}: fed() may return the next challenge: it replaces decide's; None or nothing keeps decide's`, async () => {
    for (const feedCost of [1, 0]) {
      const config = normalizeConfig({ language, feedCost });
      const out = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee: fedQueues[language] }], 8 * (feedCost + 1));
      const cs = ends(out.actions).map((a) => a.c);
      assert.ok(cs.length >= 7, `feedCost ${feedCost}: ${cs}`);
      // Turn i (from 0) plays fed's 1000 × i after an odd call of fed, else decide's c + 1.
      const expected = cs.map((_, i) => 0);
      for (let i = 0; i < cs.length; i++) expected[i] = i === 0 ? 1 : i % 2 ? 1000 * i : expected[i - 1] + 1;
      assert.deepEqual(cs, expected, `feedCost ${feedCost}`);
      const m = JSON.parse(out.memories.at(-1).memory);
      assert.equal(m.k, cs.length, "fed ran after every feed, and MEMORY was saved after it");
      assert.equal(m.f, 1, "first() was asked once, at the start");
      assert.deepEqual(out.problems, []);
    }
  });
}

test("fed() gives the challenge when decide gave none; first() is asked only when neither did", async () => {
  const bee = `def first():\n    MEMORY["f"] = MEMORY.get("f", 0) + 1\n    return 1\ndef decide(c, r):\n    return "feed"\n` +
    `def fed(nectar):\n    k = MEMORY["k"] = MEMORY.get("k", 0) + 1\n    if k != 3:\n        return 7 * k\n`;
  const out = await play(normalizeConfig({ feedCost: 1 }), [{ flower, bee }], 14);
  const cs = ends(out.actions).map((a) => a.c);
  assert.deepEqual(cs.slice(0, 6), [1, 7, 14, 1, 28, 35], `${cs}`);
  assert.equal(JSON.parse(out.memories.at(-1).memory).f, 2, "first() at the start, and after the fed that returned nothing");
});

for (const language of ["python", "typescript"]) {
  test(`${language}: a bad challenge from fed() keeps decide's and is shown to the team; a fed() that crashes or is stopped keeps decide's challenge and MEMORY`, async () => {
    // fed after the turn with challenge c: 1 a string, 2 a crash, 3 stopped at 50 ms, 4 an int beyond the
    // limits, 5 not plain data; from 6 on, nothing. It appends c to MEMORY["f"] first.
    const bee = language === "python"
      ? `def first():\n    return 1\ndef decide(c, r):\n    MEMORY["c"] = c\n    return "feed", c + 1\n` +
        `def fed(nectar):\n    c = MEMORY["c"]\n    MEMORY["f"] = MEMORY.get("f", "") + str(c)\n    if c == 1:\n        return "nope"\n    if c == 2:\n        return 1 // 0\n` +
        `    if c == 3:\n        while True:\n            pass\n    if c == 4:\n        return 2 ** 60\n    if c == 5:\n        return {1, 2}\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { MEMORY.c = c; return ["feed", c + 1]; }\n` +
        `function fed(n: number): any {\n  const c = MEMORY.c as number;\n  MEMORY.f = String(MEMORY.f ?? "") + c;\n  if (c === 1) return "nope";\n  if (c === 2) throw new Error("boom");\n` +
        `  if (c === 3) { while (true) {} }\n  if (c === 4) return 2 ** 60;\n  if (c === 5) { const o: any = {}; o.o = o; return o; }\n}`;
    const config = normalizeConfig({ language, feedCost: 1 });
    const out = await play(config, [{ flower: language === "python" ? flower : tsFlower, bee }], 14);
    const cs = ends(out.actions).map((a) => a.c);
    assert.deepEqual(cs, [1, 2, 3, 4, 5, 6, 7], "decide's challenge every time");
    assert.equal(JSON.parse(out.memories.at(-1).memory).f, "14567", "MEMORY saved after every fed but the crashed and the stopped one");
    // Each fed's error shows with the bee's next turn (its beeError), as its prints do; the first is also
    // the bee version's problem.
    const errs = ends(out.actions).map((a) => a.beeError ?? "");
    assert.equal(errs[0], "");
    assert.match(errs[1], /^fed\(\) returned a bad next challenge .*: decide's challenge stays queued$/, "a string for an int");
    assert.match(errs[2], /^fed\(\) failed \((ZeroDivisionError|.*boom).*: MEMORY is as saved after decide, and decide's challenge stays queued$/, "a crash");
    assert.match(errs[3], /^fed\(\) failed \(Timeout/, "stopped at 50 ms");
    assert.match(errs[4], /^fed\(\) returned a bad next challenge /, "an int beyond the limits");
    assert.match(errs[5], /^fed returned something that is not plain data.*: decide's challenge stays queued$/, "not plain data");
    assert.equal(errs[6], "");
    assert.match(out.problems[0].error, /^fed\(\) returned a bad next challenge/);
    assert.ok(out.problems.every((x) => x.kind === "bee"));
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

test("a stateless bee call fits easily in 50 ms: Python forks, TypeScript gets a fresh context", async () => {
  const results = {};
  for (const language of ["python", "typescript"]) {
    const bee = language === "python"
      ? `import hashlib\ndef first():\n    return 1\ndef decide(c, r):\n    h = hashlib.sha256(str(r).encode()).hexdigest()\n    MEMORY["h"] = h[:8]\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    return "leave", c + 1\n`
      : `function first() { return 1; }\nfunction decide(c: number, r: any): ["leave", number] { let h = 0; for (const ch of String(r)) h = (h * 31 + ch.charCodeAt(0)) | 0; MEMORY.h = h; MEMORY.n = (MEMORY.n ?? 0) + 1; return ["leave", c + 1]; }`;
    const config = normalizeConfig({ language });
    const garden = new Garden({ config, teams: 8, endMs: Infinity, maxRounds: 40, paced: false, game: "g" });
    for (let ti = 0; ti < 8; ti++) {
      await garden.setProgram(ti, "flower", language === "python" ? flower : tsFlower, 1);
      await garden.setProgram(ti, "bee", bee, 1);
    }
    await garden.run();
    const d = garden.drain();
    const ms = ends(d.actions).map((a) => a.beeMs).filter((x) => typeof x === "number").sort((a, b) => a - b);
    assert.ok(ms.length > 100, `${language}: ${ms.length} decisions`);
    // (A busy machine can make the odd call late; nothing else may go wrong.)
    const errors = ends(d.actions).filter((a) => a.beeError);
    assert.ok(errors.every((a) => /too slow/.test(a.beeError)), `${language}: ${errors[0]?.beeError}`);
    assert.ok(errors.length <= Math.ceil(0.02 * ms.length), `${language}: ${errors.length} late`);
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
    results[language] = { median: q(0.5), p95: q(0.95), max: ms.at(-1), n: ms.length };
    assert.ok(q(0.95) < 25, `${language}: 95% of decisions within 25 ms of their 50 (${JSON.stringify(results[language])})`);
  }
  console.log("stateless bee decision wall time (ms):", JSON.stringify(results));
});
