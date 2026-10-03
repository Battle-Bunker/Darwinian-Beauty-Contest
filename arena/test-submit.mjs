#!/usr/bin/env node
// The workspace tools and the runner, end to end, with a fake game API and a stub `claude` (no model calls, no server):
//   node arena/test-submit.mjs
// 1. tools/*.py hand requests to the runner (lib/broker.js) and print its answers: submit, check, try (flower and bee),
//    status, ledger live;
//    nothing secret ever reaches the workspace; a refused or failed submission exits non-zero.
// 2. A stub session (runSession with a session tag) submits through the tool while it "runs", leaves a background
//    process behind, and the runner stops it afterwards (killLeftovers finds it by its ARENA_SESSION tag).
// 3. Fair play, live: a session that read a file outside its workspace has its next submission refused and is stopped.
// 4. A session stopped mid-way (the game ended) reports `killed` and an estimated cost from the transcript's usage.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-submit-"));
process.env.ARENA_PAUSE_FILE = path.join(tmp, "PAUSED");
process.env.ARENA_WS_ROOT = path.join(tmp, "ws");
const STUB = path.join(tmp, "claude");
process.env.ARENA_CLAUDE_BIN = STUB;

const { Broker } = await import("./lib/broker.js");
const { requestHandler, statusOf } = await import("./lib/team.js");
const { installTools, audit, killLeftovers, sessionProcesses } = await import("./lib/workspace.js");
const { runSession } = await import("./lib/llm.js");
const { migrate, pool, q } = await import("./lib/db.js");
await migrate();

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${extra}`}`); if (!ok) failed++; };
const SECRET = "tok-SECRET-1234567890";

// ---------------------------------------------------------------- a fake game API (records what the runner sent)
const calls = [];
const config = { language: "python", minutes: 2, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512,
  budgets: { flower: { size: 1100, perMinute: 220, cap: 220, ms: 150 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50 } } };
let gameOver = false, noFlowerYet = false;
const fakeApi = {
  view: async (tok) => { calls.push(["view", tok]); return {
    game: { status: "running", clockMs: 30000, endMs: 120000, round: 150, config },
    teams: [{ id: "T1", name: "Moonpetal", banks: { flower: { bank: 10, atMs: 0 }, bee: { bank: 0, atMs: 0 } },
      programs: { flower: [{ version: 1, size: 40, atMs: 0, code: "x" }], bee: [{ version: 2, size: 300, atMs: 20000 }] } },
      { id: "T2", name: "Rival", banks: null, programs: null }],
    scores: [{ teamId: "T1", fitness: 1.2, allure: 2, forage: 150, surplus: 300000, allureShare: 0.5, forageShare: 0.6, surplusShare: 0.5, pollinators: 2 },
      { teamId: "T2", fitness: 0.8, allure: 2, forage: 100, surplus: 300000, allureShare: 0.5, forageShare: 0.4, surplusShare: 0.5, pollinators: 2 }],
  }; },
  check: async (tok, g, kind, code) => { calls.push(["check", tok, kind, code]); return { ok: true, size: 42, budget: config.budgets[kind], distance: 3, cost: 3, available: 120, minified: code, errors: [] }; },
  tryFlower: async (tok, g, code, challenges, ledger) => { calls.push(["try", tok, "flower", code, ledger]);
    if (code.includes("CRASH")) return { results: (challenges || [1]).map((c) => ({ c, r: null, percent: null, energy: 0, error: "ZeroDivisionError: division by zero", ms: 1 })) };
    return { results: (challenges || [1]).map((c) => ({ c, r: c * 3 + 1, percent: 40, energy: 158000, ms: 1.5 })) }; },
  tryBee: async (tok, g, code, { flower, rounds } = {}) => { calls.push(["try", tok, "bee", code, flower, rounds]);
    if (noFlowerYet && !flower) throw Object.assign(new Error("Your bee needs a flower to visit"), { status: 409 });
    return { rounds: rounds ?? 300, feeds: 1, nectar: 10, surplus: 20, problems: [], actions: [{ action: "arrive" }, { action: "feed", c: 1, r: 4, percent: 33, energy: 30, nectar: 10, beeMs: 2 },
      { action: "arrive" }, { action: "leave", c: 2, r: 7, percent: 50, energy: 40, beeMs: 3 }] }; },
  ledger: async (tok, g, after, limit) => { calls.push(["ledger", tok, after, limit]);
    return { participants: ["T1", "T2"], team: 0, entries: [{ seq: 4, round: 1, bee: 1, flower: 0, challenge: 1, response: 4, fed: false, nectar: null, surplus: 0, percent: 40, energy: 1000, ms: 1.2 }],
      lastSeq: 4, round: 2, status: "running" }; },
  submit: async (tok, g, kind, code) => { calls.push(["submit", tok, kind, code]);
    return gameOver ? { ok: false, errors: ["Game over"] } : { ok: true, submitted: true, version: 2, size: 42, distance: 3, cost: 3, available: 117, errors: [] }; },
};

// ---------------------------------------------------------------- 1. the tools through the broker
const ws = path.join(process.env.ARENA_WS_ROOT, "A", "luna");
fs.mkdirSync(ws, { recursive: true });
installTools(ws);
fs.writeFileSync(path.join(ws, "flower.py"), "def flower(c, ledger):\n    return c * 3 + 1, 40\n");
fs.writeFileSync(path.join(ws, "crash.py"), "def flower(c, ledger):\n    return 1 // 0, 40  # CRASH\n");
fs.writeFileSync(path.join(ws, "bee.py"), "def first(ledger):\n    return 1\n\ndef decide(c, r, ledger):\n    return 'feed', 1\n");
fs.writeFileSync(path.join(ws, "led.jsonl"), JSON.stringify({ round: 1, bee: 0, flower: 1, challenge: 1, response: 2, fed: true }) + "\n");
const records = [];
let gateRefusal = null;
const broker = new Broker({ dir: ws, handle: requestHandler({ api: fakeApi, tok: SECRET, gPath: "/rooms/R/games/G", config, teamId: "T1", dir: ws,
  gate: () => gateRefusal, record: async (r) => records.push(r) }) }).start();
// Async: the broker answers on this process's event loop.
const tool = (...a) => new Promise((resolve) => {
  const c = spawn("python3", a, { cwd: ws });
  let stdout = "", stderr = "";
  c.stdout.on("data", (d) => (stdout += d));
  c.stderr.on("data", (d) => (stderr += d));
  c.on("close", (status) => resolve({ status, stdout, stderr }));
});

let r = await tool("tools/submit.py", "flower");
check("submit: exit 0 and says it's live", r.status === 0 && /flower v2 submitted: it cost 3 nodes of change, 117 left/.test(r.stdout), r.stdout + r.stderr);
check("submit: the runner sent the file's code with the team's token", calls.some((c) => c[0] === "submit" && c[1] === SECRET && c[3].includes("c * 3 + 1")));
check("submit: a runtime test ran first", calls.findIndex((c) => c[0] === "try") < calls.findIndex((c) => c[0] === "submit"));
check("submit: recorded for the audit (op, kind, code, version, cost)", records.some((x) => x.op === "submit" && x.ok && x.version === 2 && x.cost === 3 && x.code.includes("c * 3")));
r = await tool("tools/submit.py", "flower", "crash.py");
check("submit: a program that crashes in the runtime test is not submitted (exit 1)", r.status === 1 && /runtime test failed/.test(r.stdout) && !calls.some((c) => c[0] === "submit" && c[3].includes("CRASH")), r.stdout);
r = await tool("tools/submit.py", "flower", "crash.py", "--force");
check("submit --force skips the runtime test", r.status === 0 && calls.some((c) => c[0] === "submit" && c[3].includes("CRASH")));
r = await tool("tools/check.py", "flower");
check("check: size, cost now and what's available, and the flower's energy", r.status === 0 && /42 of 1,100 nodes\. Submitting now would cost 3 of the 120 you have/.test(r.stdout)
  && /\(1,100 − 42\) × 150 = 158,700 node·ms/.test(r.stdout), r.stdout);
r = await tool("tools/try.py", "flower", "flower.py", "5", "7");
check("try (flower): response, percent, energy and CPU time per challenge", r.status === 0 && /flower\(5\) -> 16, percent 40\s+\(energy 158,000, 1\.5 ms CPU\)/.test(r.stdout) && /flower\(7\) -> 22/.test(r.stdout), r.stdout + r.stderr);
r = await tool("tools/try.py", "flower", "--ledger", "led.jsonl", "3");
check("try (flower) --ledger: the ledger goes with the challenges", r.status === 0 && calls.filter((c) => c[0] === "try" && c[2] === "flower").pop()?.[4]?.[0]?.response === 2, r.stdout + r.stderr);
r = await tool("tools/try.py", "bee", "--rounds", "100");
check("try (bee): a summary of the garden of your own flower", r.status === 0 && /100 rounds in a garden of just your own flower: 2 turns, 1 feeds, 1 leaves; your bee got 10 nectar and your flower kept 20 surplus/.test(r.stdout)
  && /feed c=1 r=4 percent=33 energy=30 nectar=10/.test(r.stdout), r.stdout + r.stderr);
r = await tool("tools/try.py", "bee", "--flower", "flower.py");
check("try (bee) --flower: plays the named flower file", calls.filter((c) => c[0] === "try" && c[2] === "bee").pop()?.[4]?.includes("c * 3 + 1"), r.stdout + r.stderr);
r = await tool("tools/status.py", "--afford", "1000");
check("status: clock, time left, budgets with rate and cap", /Game running: 0:30 of 2:00 played \(1:30 left\), round 150/.test(r.stdout) && /flower\s+120 available, \+220\/min, cap 220/.test(r.stdout), r.stdout);
check("status: when a change of N nodes is affordable", /flower.*1,000 nodes: never \(cap 220/.test(r.stdout) && /bee.*1,000 nodes: now/.test(r.stdout), r.stdout);
check("status: the live scoreboard with the three shares, and the versions playing", /1\. Moonpetal \(you\): fitness 1\.20; allure 2\.00 \(share 0\.50, fed by 2 bee teams\), forage 150\.0 \(share 0\.60\)/.test(r.stdout)
  && /bee v2 \(live since 0:20/.test(r.stdout) && /Your flower's size 40 of 1,100/.test(r.stdout), r.stdout);
r = await tool("tools/ledger.py", "live", "--after", "3");
check("ledger live: fresh team ledger entries through the runner", r.status === 0 && /1 ledger entries after seq 3/.test(r.stdout) && calls.some((c) => c[0] === "ledger" && c[1] === SECRET && c[2] === 3), r.stdout + r.stderr);
noFlowerYet = true;
r = await tool("tools/submit.py", "bee");
const beeTry = calls.filter((c) => c[0] === "try" && c[2] === "bee").pop();
check("submit (bee, no flower submitted yet): the runtime test plays the workspace's flower file", r.status === 0 && beeTry?.[4]?.includes("c * 3 + 1"), r.stdout);
noFlowerYet = false;
gameOver = true;
r = await tool("tools/submit.py", "flower");
check("submit after the game ended: refused cleanly", r.status === 1 && /the game is over/.test(r.stdout) && records.some((x) => x.refused === "game over"), r.stdout);
gameOver = false;
gateRefusal = "fair-play violation (test): this session is over";
r = await tool("tools/submit.py", "flower");
check("a refusal from the fair-play gate reaches the tool", r.status === 1 && /refused: fair-play violation/.test(r.stdout), r.stdout);
gateRefusal = null;
r = await tool("tools/submit.py", "cosmos");
check("only flower and bee are kinds", r.status !== 0 && /flower or bee/.test(r.stdout + r.stderr), r.stdout + r.stderr);
const leaked = spawnSync("grep", ["-rl", SECRET, ws], { encoding: "utf8" }).stdout.trim();
check("the team's token is nowhere in the workspace (requests, answers)", leaked === "", leaked);
await broker.stop();

// ---------------------------------------------------------------- 2-4. stub sessions
fs.writeFileSync(STUB, `#!/usr/bin/env python3
import json, os, subprocess, sys, time
mode = open(${JSON.stringify(path.join(tmp, "mode"))}).read().strip()
sys.stdin.read()
def out(ev):
    print(json.dumps(ev), flush=True)
usage = {"input_tokens": 1000, "output_tokens": 500, "cache_read_input_tokens": 20000, "cache_creation_input_tokens": 3000}
def bash(i, cmd, run=True):
    out({"type": "assistant", "message": {"id": "m%d" % i, "content": [{"type": "tool_use", "id": "t%d" % i, "name": "Bash", "input": {"command": cmd}}], "usage": usage}})
    time.sleep(0.3)
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout if run else ""
    out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t%d" % i, "content": res}]}})
    return res
out({"type": "system", "subtype": "init"})
if mode == "violation":
    bash(1, "cat /etc/hostname", run=False)
res = bash(2, "python3 tools/submit.py flower")
open("submit-output.txt", "w").write(res)
subprocess.Popen(["sleep", "60"], start_new_session=True)   # a script the session leaves running
if mode == "hang":
    time.sleep(60)
out({"type": "result", "subtype": "success", "is_error": False, "result": "done", "total_cost_usd": 0.0123, "num_turns": 2, "usage": usage})
`, { mode: 0o755 });

async function stubSession(mode, { killAfterMs = null } = {}) {
  fs.writeFileSync(path.join(tmp, "mode"), mode);
  fs.rmSync(path.join(ws, "submit-output.txt"), { force: true });
  const control = {};
  const tag = `test:${mode}:${Date.now()}`;
  let violated = null;
  const gate = () => {
    if (violated) return violated;
    const found = audit(control.lines || [], ws, "A", "luna").filter((f) => f.severity === "violation");
    if (found.length) { violated = `fair-play violation (${found[0].detail.slice(0, 60)})`; control.kill?.("violation"); return violated; }
    return null;
  };
  const b = new Broker({ dir: ws, handle: requestHandler({ api: fakeApi, tok: SECRET, gPath: "/rooms/R/games/G", config, teamId: "T1", gate, record: async (x) => records.push(x) }) }).start();
  if (killAfterMs) setTimeout(() => control.kill?.("game over"), killAfterMs);
  const s = await runSession({ model: "haiku", cwd: ws, appendSystem: "sys", prompt: "go", maxTurns: 5, transcriptFile: path.join(tmp, `t-${mode}.jsonl`),
    timeoutMs: 30000, control, env: { ARENA_SESSION: tag }, holdOnLimit: false, ctx: { purpose: "test", arenaId: "test-submit" } });
  await b.stop();
  const leftBefore = sessionProcesses(tag, null);
  const killed = await killLeftovers(tag, ws);
  return { s, leftBefore, killed, after: sessionProcesses(tag, null), out: fs.existsSync(path.join(ws, "submit-output.txt")) ? fs.readFileSync(path.join(ws, "submit-output.txt"), "utf8") : "" };
}

let x = await stubSession("ok");
check("stub session: the submission made during the session went through the runner", /flower v2 submitted/.test(x.out), x.out);
check("stub session: finished normally with the CLI's reported cost", !x.s.killed && Math.abs(x.s.cost - 0.0123) < 1e-9 && !x.s.estimated);
check("stub session: what it left running carries its tag", x.leftBefore.length >= 1);
check("stub session: the runner stopped it afterwards", x.killed.length >= 1 && x.after.length === 0);
x = await stubSession("violation");
check("fair play, live: a submission after reading outside the workspace is refused", records.some((r) => r.op === "submit" && /fair-play violation/.test(r.refused || "")) && !/submitted/.test(x.out), x.out);
check("fair play, live: the session is stopped", x.s.killed === "violation");
x = await stubSession("hang", { killAfterMs: 2500 });
check("game over mid-session: the session is stopped", x.s.killed === "game over");
check("game over mid-session: its cost is estimated from the usage in the transcript", x.s.estimated && x.s.cost > 0, JSON.stringify(x.s));
check("game over mid-session: its leftovers are stopped too", x.after.length === 0);
const st = statusOf(await fakeApi.view("t"), "T1");
check("statusOf: budgets computed from bank + rate × time (capped)", st.budgets.flower.available === 120 && st.budgets.bee.available === 1100 && Object.keys(st.budgets).join() === "flower,bee");

await q("DELETE FROM arena.llm_calls WHERE arena_id = 'test-submit'");
await pool.end();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all submit/tool checks passed");
process.exit(failed ? 1 : 0);
