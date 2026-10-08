// Responses up to maxResponseBytes (1,024 by default) of JSON: the cap is checked by the runner inside the
// flower's time (writing the JSON is its compute), and with energy.bytes every byte under it costs energy, E ×
// (cap − bytes) / cap; maxLen/maxNodes are for challenges only, a response over INLINE_BYTES (4 KB, under a
// raised cap) is shown as its size, hash and preview, and a big response reaches the bee before its 50 ms
// start, so reading it in costs the bee nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { play } from "./fixtures/garden.js";
import { excessEnergy, normalizeConfig } from "../server/lib/gameConfig.js";
import { INLINE_BYTES, largeResponse } from "../server/engine.js";
import { size } from "../server/lib/measure.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const programs = {
  python: {
    flower: (expr) => `def flower(c):\n    return ${expr}, 40\n`,
    // The bee tells what it got: the response's length, as its next challenge (and in its print).
    bee: `def first():\n    return 1\ndef decide(c, r):\n    n = -1 if r is None else len(r)\n    print(n)\n    return "leave", n % 1000\n`,
  },
  typescript: {
    flower: (expr) => `function flower(c: number): [any, number] { return [${expr}, 40]; }`,
    bee: `function first() { return 1; }\nfunction decide(c: number, r: any): ["leave", number] { const n = r === null ? -1 : r.length; console.log(n); return ["leave", ((n % 1000) + 1000) % 1000]; }`,
  },
};

for (const language of ["python", "typescript"]) {
  const P = programs[language];
  const big = language === "python" ? (n) => `"y" * ${n}` : (n) => `"y".repeat(${n})`;

  test(`${language}: a response over maxResponseBytes is a failure (null, E = 0), checked inside the flower's time`, async () => {
    const config = normalizeConfig({ language, responseType: "str", maxResponseBytes: 2000, feedCost: 0 });
    const out = await play(config, [{ flower: P.flower(big(3000)), bee: P.bee }], 3);
    for (const a of ends(out.actions)) {
      assert.equal(a.r, null);
      assert.equal(a.rBytes, null);
      assert.equal(a.energy, 0);
      assert.match(a.flowerError, /the response is 3002 bytes of JSON, over the cap of 2000/);
      assert.equal(typeof a.ms, "number", "its CPU time is still measured");
      assert.equal(a.log.trim(), "-1", "the bee got null");
    }
    // Just under the cap is fine (a string's JSON is 2 bytes longer: its quotes).
    const ok = await play(config, [{ flower: P.flower(big(1998)), bee: P.bee }], 2);
    for (const a of ends(ok.actions)) assert.deepEqual([a.flowerError, a.rBytes, a.log.trim()], [null, 2000, "1998"]);
  });

  test(`${language}: maxLen and maxNodes don't limit responses (only challenges); nesting is limited to 256 levels`, async () => {
    const config = normalizeConfig({ language, responseType: "any", maxLen: 8, maxNodes: 8, maxResponseBytes: 65536, feedCost: 0 });
    const long = language === "python" ? `list(range(500))` : `Array.from({ length: 500 }, (_, i) => i)`;
    const out = await play(config, [{ flower: P.flower(long), bee: P.bee }], 2);
    for (const a of ends(out.actions)) assert.deepEqual([a.flowerError, a.log.trim()], [null, "500"]);
    const deep = (n) => (language === "python"
      ? `__import__("functools").reduce(lambda x, _: [x], range(${n}), 0)`
      : `Array.from({ length: ${n} }).reduce((x: any) => [x], 0)`);
    const okDeep = await play(config, [{ flower: P.flower(deep(255)), bee: P.bee }], 1);
    assert.equal(ends(okDeep.actions)[0].flowerError, null);
    const tooDeep = await play(config, [{ flower: P.flower(deep(300)), bee: P.bee }], 1);
    assert.match(ends(tooDeep.actions)[0].flowerError, /nested more than 256 levels deep/);
  });

  test(`${language}: a response over 4 KB is shown as its size, SHA-256 and first 4 KB; the bee gets all of it`, async () => {
    const config = normalizeConfig({ language, responseType: "str", maxResponseBytes: 65536, feedCost: 0 });
    const out = await play(config, [{ flower: P.flower(big(10000)), bee: P.bee }], 2);
    const text = JSON.stringify("y".repeat(10000));
    for (const a of ends(out.actions)) {
      assert.equal(a.r, null, "not inline");
      assert.equal(a.rBytes, 10002);
      assert.equal(a.rHash, sha(text));
      assert.equal(a.rPreview, text.slice(0, INLINE_BYTES));
      assert.equal(a.rFull, text, "the whole text, for storing apart");
      assert.equal(a.log.trim(), "10000", "the bee read the whole response");
    }
    // At 4 KB and under, the response is inline.
    const small = await play(config, [{ flower: P.flower(big(4094)), bee: P.bee }], 1);
    const a = ends(small.actions)[0];
    assert.deepEqual([a.r.length, a.rBytes, a.rHash, a.rPreview, a.rFull], [4094, 4096, undefined, undefined, undefined]);
  });

  test(`${language}: a 1 MB response reaches the bee before its 50 ms start: reading it in costs the bee nothing`, async () => {
    const config = normalizeConfig({ language, responseType: "list[int]", maxResponseBytes: 1 << 20, feedCost: 0 });
    const n = 150000; // about 0.94 MB of JSON (so a 1 MB cap, not the 64 KiB default)
    const list = language === "python" ? `list(range(${n}))` : `Array.from({ length: ${n} }, (_, i) => i)`;
    const out = await play(config, [{ flower: P.flower(list), bee: P.bee }], 4, null, { paced: true });
    const turns = ends(out.actions);
    assert.ok(turns.length >= 3);
    for (const a of turns) {
      assert.equal(a.flowerError, null);
      assert.ok(a.rBytes > 900000 && a.rBytes <= config.maxResponseBytes, `${a.rBytes}`);
      assert.equal(a.log.trim(), String(n));
      assert.equal(a.beeError, null);
      assert.ok(a.beeMs < 25, `the bee's decision took ${a.beeMs} ms`);
    }
    console.log(`${language}: a ${turns[0].rBytes}-byte response cost the flower ${turns.map((a) => a.ms).join(", ")} ms of CPU; the bee decided in ${turns.map((a) => a.beeMs).join(", ")} ms`);
  });
}

test("a preview is cut at a whole character", () => {
  const text = JSON.stringify("é".repeat(5000)); // 2 bytes a character
  const { rPreview, rHash, rFull } = largeResponse(text);
  assert.equal(rFull, text);
  assert.equal(rHash, sha(text));
  assert.ok(Buffer.byteLength(rPreview) <= INLINE_BYTES);
  assert.equal(rPreview, text.slice(0, rPreview.length));
  assert.ok(!rPreview.includes("�"));
  assert.equal(Buffer.byteLength(rPreview), 4095, '1 quote byte + 2047 two-byte characters');
});

for (const language of ["python", "typescript"]) {
  const P = programs[language];
  const big = language === "python" ? (n) => `"y" * ${n}` : (n) => `"y".repeat(${n})`;
  // A bee that always feeds, and says how long the response was.
  const feeder = language === "python"
    ? `def first():\n    return 1\ndef decide(c, r):\n    print(-1 if r is None else len(r))\n    return "feed", 1\n`
    : `function first() { return 1; }\nfunction decide(c: number, r: any): ["feed", number] { console.log(r === null ? -1 : r.length); return ["feed", 1]; }`;

  test(`${language}: the byte factor: E = (cap − size) × (R − CPU ms) × (1024 − bytes) / 1024; at the cap an answer with E = 0 a bee can feed on; one byte over, refused`, async () => {
    const config = normalizeConfig({ language, responseType: "str", feedCost: 0, budgets: { flower: { minMs: 150 } } }); // R held at 150
    assert.deepEqual([config.maxResponseBytes, config.energy], [1024, { bytes: true }], "the defaults");
    const run = async (n) => {
      const code = P.flower(big(n));
      const out = await play(config, [{ flower: code, bee: feeder }], 2);
      return { turns: ends(out.actions), s: (await size(language, code)).size };
    };
    // The string's JSON is n + 2 bytes (its quotes).
    for (const n of [0, 510, 1000]) {
      const { turns, s } = await run(n);
      for (const t of turns) {
        assert.deepEqual([t.flowerError, t.rBytes, t.action], [null, n + 2, "feed"]);
        assert.equal(t.energy, excessEnergy(config, s, t.ms, 150, n + 2));
        assert.ok(Math.abs(t.energy - (1100 - s) * (150 - t.ms) * (1022 - n) / 1024) < 1e-6, `${n}: ${t.energy}`);
        assert.ok(t.energy > 0);
      }
    }
    const atCap = await run(1022);
    for (const t of atCap.turns) {
      assert.deepEqual([t.flowerError, t.rBytes, t.r.length, t.energy], [null, 1024, 1022, 0], "exactly the cap: an answer, with nothing to give");
      assert.deepEqual([t.action, t.nectar, t.pollen, t.log.trim()], ["feed", 0, 0, "1022"], "the bee got it, and fed");
    }
    const over = await run(1023);
    for (const t of over.turns) {
      assert.deepEqual([t.r, t.energy, t.action], [null, 0, "feed"]);
      assert.match(t.flowerError, /the response is 1025 bytes of JSON, over the cap of 1024/);
      assert.equal(t.log.trim(), "-1");
    }
  });

  test(`${language}: a game stored without energy.bytes keeps E without the byte factor (and its 64 KiB cap)`, async () => {
    const { energy: _, ...old } = normalizeConfig({ language, responseType: "str", feedCost: 0, maxResponseBytes: 65536, budgets: { flower: { minMs: 150 } } });
    const code = P.flower(big(30000));
    const out = await play(old, [{ flower: code, bee: feeder }], 2);
    const s = (await size(language, code)).size;
    for (const t of ends(out.actions)) {
      assert.deepEqual([t.flowerError, t.rBytes], [null, 30002]);
      assert.equal(t.energy, (1100 - s) * (150 - t.ms), "two factors only");
      assert.equal(t.energy, excessEnergy(old, s, t.ms, 150, t.rBytes));
    }
  });
}
