#!/usr/bin/env node
// Self-contained check of the usage-limit pause/resume path, with a stub `claude` (no real model calls, no games).
//   node arena/test-pause.mjs
// 1. classify() on the exact messages; 2. a call that hits "session limit" pauses (pause file written, call held,
// not counted as an attempt); 3. deleting the pause file resumes it and the same call is re-issued and succeeds.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-pause-"));
const mode = path.join(dir, "mode"), log = path.join(dir, "calls.log");
fs.writeFileSync(path.join(dir, "claude"), `#!/bin/bash
cat > /dev/null
echo call >> "${log}"
if [ "$(cat "${mode}")" = "limit" ]; then
  echo '{"type":"result","is_error":true,"result":"You'"'"'ve hit your session limit · resets 3:10am (UTC)","total_cost_usd":0,"api_error_status":429}'
else
  echo '{"type":"result","is_error":false,"result":"ok after resume","total_cost_usd":0,"usage":{},"modelUsage":{"stub":{}}}'
fi
`, { mode: 0o755 });

if (!process.env.ARENA_PAUSE_TEST_CHILD) {
  // Re-run this file with the stub first on PATH and a private pause file (never the real arena/runs/PAUSED).
  const r = spawnSync(process.execPath, [process.argv[1]], {
    stdio: "inherit",
    env: { ...process.env, ARENA_PAUSE_TEST_CHILD: dir, PATH: `${dir}:${process.env.PATH}`, ARENA_PAUSE_FILE: path.join(dir, "PAUSED") },
  });
  process.exit(r.status ?? 1);
}

const { classify, callModel, PAUSE_FILE, isPaused } = await import("./lib/llm.js");
const { pool, q } = await import("./lib/db.js");
const childDir = process.env.ARENA_PAUSE_TEST_CHILD;
const cmode = path.join(childDir, "mode"), clog = path.join(childDir, "calls.log");
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failed++; };

for (const [t, limit] of [["You've hit your session limit · resets 3:10am (UTC)", true], ["Claude usage limit reached", true],
  ["API Error: 429 rate_limit_error", true], ["Overloaded", false], ["SyntaxError: invalid syntax", false]]) {
  check(classify({ json: { is_error: true, result: t } }).limit === limit, `classify(${JSON.stringify(t)}).limit === ${limit}`);
}

fs.writeFileSync(cmode, "limit");
const call = callModel({ model: "haiku", system: "s", prompt: "p", retries: 0, ctx: { purpose: "test", arenaId: "pause-test" } });
const t0 = Date.now();
while (!isPaused() && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 100));
check(isPaused(), "a session-limit failure writes the pause file");
check(/session limit/.test(fs.readFileSync(PAUSE_FILE, "utf8")), "the pause file holds the raw error text");
await new Promise((r) => setTimeout(r, 1500));
check(fs.readFileSync(clog, "utf8").trim().split("\n").length === 1, "no new calls start while paused");
fs.writeFileSync(cmode, "ok");
fs.unlinkSync(PAUSE_FILE); // manual resume
const res = await call;     // retries: 0, so success proves the held call didn't use up its only attempt
check(res.text === "ok after resume", "after rm of the pause file the same call is re-issued and succeeds (not counted as an attempt)");
await q("DELETE FROM arena.llm_calls WHERE arena_id = 'pause-test'");
await pool.end();
fs.rmSync(childDir, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all pause/resume checks passed");
process.exit(failed ? 1 : 0);
