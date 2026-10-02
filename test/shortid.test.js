import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { allocatePrefixLen, normalizeCode, uuidToCode } from "../server/lib/shortid.js";

test("uuidToCode gives 26 Crockford characters with a full-entropy first character", () => {
  const firsts = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = uuidToCode(crypto.randomUUID());
    assert.match(c, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    firsts.add(c[0]);
  }
  assert.equal(firsts.size, 32);
  assert.equal(uuidToCode("00000000-0000-0000-0000-000000000000"), "0".repeat(26));
});

test("normalizeCode follows Crockford's forgiving decoding", () => {
  assert.equal(normalizeCode("7k-io"), "7K10");
  assert.equal(normalizeCode("lol"), "101");
  assert.equal(normalizeCode("u"), null); // U is excluded from the alphabet
  assert.equal(normalizeCode(""), null);
});

// A fake pg client over an in-memory table, enough for allocatePrefixLen.
const fakeClient = (rows) => ({
  async query(_sql, [like]) {
    const prefix = like.slice(0, -1);
    return { rowCount: rows.some((r) => r.code.startsWith(prefix)) ? 1 : 0 };
  },
});

test("every record stays uniquely addressable by its own short id, and by longer prefixes", async () => {
  const rows = [];
  for (let i = 0; i < 3000; i++) {
    const code = uuidToCode(crypto.randomUUID());
    rows.push({ code, prefix_len: await allocatePrefixLen(fakeClient(rows), "t", code) });
  }
  const lookup = (s) => rows.filter((r) => r.code.startsWith(s) && r.prefix_len <= s.length);
  for (const r of rows) {
    for (const len of [r.prefix_len, r.prefix_len + 1, 26]) assert.deepEqual(lookup(r.code.slice(0, len)), [r]);
  }
  assert.equal(rows[0].prefix_len, 1);
  assert.ok(Math.max(...rows.map((r) => r.prefix_len)) <= 6);
});
