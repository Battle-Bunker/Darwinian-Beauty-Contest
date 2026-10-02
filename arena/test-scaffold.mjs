#!/usr/bin/env node
// Scaffolds (lib/scaffold.js, tools/garden.py, tools/scaffold.py) with a fake game API and real processes; no model
// calls, no game server (the arena schema in dbc_live for throwaway rows):
//   node arena/test-scaffold.mjs
// A stub scaffold: it starts from a session, survives the session's end, submits a change by itself when a rival
// clover answers, is refused (with a wait time) when a change is over budget, is restarted after it crashes, a
// forbidden scaffold fails the audit, a greedy one is throttled to its CPU share, and everything stops at game end.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "arena-scaffold-"));
process.env.ARENA_WS_ROOT = path.join(root, "ws");
const { TeamDesk } = await import("./lib/team.js");
const { auditScaffold } = await import("./lib/scaffold.js");
const { installTools, killLeftovers } = await import("./lib/workspace.js");
const { migrate, pool, q, all } = await import("./lib/db.js");
await migrate();

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 700)}`}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------------------------------------------------------------- a fake game: clock, budgets, submissions
const config = { language: "python", minutes: 2, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512,
  budgets: { clover: { size: 1100, perMinute: 220, cap: 220, ms: 150 }, orchid: { size: 2200, perMinute: 600, cap: 600, ms: 100 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50 } } };
const t0 = Date.now();
const clock = () => Date.now() - t0;
const bank = { orchid: { bank: 50, atMs: 0 } };
const submits = [];
const avail = (k) => Math.min(config.budgets[k].cap, (bank[k]?.bank ?? 0) + config.budgets[k].perMinute * (clock() - (bank[k]?.atMs ?? 0)) / 60000);
const fakeApi = {
  view: async () => ({ game: { status: "running", clockMs: clock(), endMs: 120000, round: Math.floor(clock() / 200), config },
    teams: [{ id: "T1", name: "Moonpetal", banks: { clover: { bank: 0, atMs: 0 }, orchid: bank.orchid, bee: { bank: 0, atMs: 0 } },
      programs: { clover: [{ version: 1, size: 10, atMs: 0, code: "def flower(c):\n    return c\n" }], orchid: [{ version: submits.length + 1, size: 10, atMs: 0, code: "def flower(c):\n    return 0\n" }], bee: [] } },
      { id: "T2", name: "Rival", programs: null, banks: null }], scores: [{ teamId: "T1", fitness: 1 }, { teamId: "T2", fitness: 1 }] }),
  check: async (tok, g, kind, code) => ({ ok: true, size: code.length, budget: config.budgets[kind], cost: code.length, available: Math.floor(avail(kind)), errors: [] }),
  try: async (tok, g, kind, code, ch) => ({ results: (ch || [1]).map((c) => ({ c, r: 0, ms: 1 })) }),
  submit: async (tok, g, kind, code) => {
    const cost = code.length, a = avail(kind);
    if (cost > a) return { ok: false, errors: [`Not enough change budget: this change costs ${cost} nodes and your ${kind} has ${Math.floor(a)} (it earns ${config.budgets[kind].perMinute} a minute, banking up to ${config.budgets[kind].cap}). ` +
      (cost <= config.budgets[kind].cap ? `Enough in about ${Math.ceil((cost - a) * 60 / config.budgets[kind].perMinute)} s of game time.` : "It can never afford a change this big: make it smaller.")] };
    bank[kind] = { bank: a - cost, atMs: clock() };
    submits.push({ tok, kind, code });
    return { ok: true, submitted: true, version: submits.length + 1, cost, available: Math.floor(a - cost), atMs: clock(), errors: [] };
  },
};

// ---------------------------------------------------------------- a workspace and its desk
const AID = `test-scaffold-${process.pid}`;
const dir = path.join(process.env.ARENA_WS_ROOT, AID, "luna");
fs.mkdirSync(path.join(dir, "stream"), { recursive: true });
installTools(dir);
fs.writeFileSync(path.join(dir, "stream", "actions.jsonl"), "");
fs.writeFileSync(path.join(dir, "stream", "teams.json"), JSON.stringify({ teams: { T1: "Moonpetal", T2: "Rival" }, me: "T1" }));
fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ ...config, public_api: "http://localhost:4000/api/rooms/R/games/G" }));
const append = (a) => fs.appendFileSync(path.join(dir, "stream", "actions.jsonl"), JSON.stringify(a) + "\n");
const logs = [];
const desk = await new TeamDesk({ arena: { id: AID, settings: { scaffold: { cpuShare: 0.2 } } }, gameRow: { id: -424242, generation: 1 }, persona: { id: `${AID}/luna`, slug: "luna", name: "Luna" },
  entry: { team_id: "T1", login_name: "x" }, gPath: "/rooms/R/games/G", dir, stream: { get clockMs() { return clock(); }, status: "running" }, log: (m) => logs.push(m),
  apiBase: "http://localhost:4000/api/rooms/R/games/G", api: fakeApi, tok: "SECRET-TOKEN" }).start();
const tool = (...a) => new Promise((resolve) => {
  const c = spawn("python3", a, { cwd: dir });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (out += d));
  c.on("close", (status) => resolve({ status, out }));
});

// The stub scaffold: copy a rival clover's answer into the orchid, then try something over budget, then crash once.
fs.writeFileSync(path.join(dir, "scaffold.py"), `import os, sys
sys.path.insert(0, "tools")
import garden
import helper

print("scaffold up; me =", garden.ME, "; orchid budget", round(garden.status()["budgets"]["orchid"]["exact"], 1), flush=True)
seen = 0
for a in garden.follow(after=0):
    if a["action"] != "ask" or a["kind"] != "clover" or a["patch"] == garden.ME:
        continue
    seen += 1
    if seen == 1:
        r = garden.submit("orchid", helper.table_orchid({a["c"]: a["r"]}))
        print("copied", a["c"], "->", a["r"], "ok", r["ok"], "cost", r.get("cost"), flush=True)
    elif seen == 2:
        r = garden.submit("orchid", "def flower(c):\\n    return 0\\n" + "#" * 400)
        print("big change ok", r["ok"], "wait_s", r.get("wait_s"), flush=True)
    elif seen == 3 and not os.path.exists("crashed.flag"):
        open("crashed.flag", "w").write("once")
        print("crashing on purpose", flush=True)
        raise RuntimeError("boom")
`);
fs.writeFileSync(path.join(dir, "helper.py"), `def table_orchid(t):\n    return "T = %r\\ndef flower(c):\\n    return T.get(c, 0)\\n" % t\n`);

// 1. Started by a session; the session ends; the scaffold keeps running.
desk.session = { id: null, no: 1, gate: () => null, requests: 0, submitted: [] };
let r = await tool("tools/scaffold.py", "start", "scaffold.py");
check("start: audited and started from a session", r.status === 0 && /is running \(pid \d+\)/.test(r.out), r.out);
const pid1 = desk.scaffold.child?.pid;
const row = (await all("SELECT * FROM arena.scaffolds WHERE game_id = -424242 ORDER BY id"))[0];
check("start: recorded with its audited source (entry file and the workspace module it imports)", row?.status === "running" && row.source.includes("# ==== scaffold.py") && row.source.includes("# ==== helper.py"));
desk.session = null;
const killed = await killLeftovers("no-such-tag", dir, () => desk.scaffold.pids());
check("the end of the session doesn't stop the scaffold", pid1 && alive(pid1) && !killed.includes(pid1));
const ready = await until("scaffold up", () => /scaffold up; me = T1 ; orchid budget/.test(desk.scaffold.logTail()));
check("the scaffold talks to the runner between sessions (status through garden.py)", !!ready, desk.scaffold.logTail());

// 2. A rival clover answers: the scaffold copies it into the orchid and submits it by itself.
append({ seq: 1, atMs: clock(), round: 1, bee: "T1", visit: 1, patch: "T2", kind: "clover", action: "ask", c: 42, r: 127 });
const sub = await until("an automatic submission", () => submits.length >= 1 && submits[0]);
check("an automatic submission, with the team's token held by the runner", sub && sub.kind === "orchid" && sub.code.includes("T = {42: 127}") && sub.tok === "SECRET-TOKEN", JSON.stringify(sub));
const reqRows = await until("recorded", async () => { const x = await all("SELECT * FROM arena.requests WHERE game_id = -424242 AND op = 'submit'"); return x.length ? x : null; });
check("recorded in arena.requests with source 'scaffold'", reqRows?.[0]?.source === "scaffold" && reqRows[0].ok && reqRows[0].scaffold_id === row.id, JSON.stringify(reqRows?.[0]));
check("the scaffold's token never appears in the workspace", !fs.readdirSync(path.join(dir, ".runner", "res")).some((f) => fs.readFileSync(path.join(dir, ".runner", "res", f), "utf8").includes("SECRET-TOKEN")));

// 3. A change over budget: refused, with how long until it's affordable.
append({ seq: 2, atMs: clock(), round: 2, bee: "T1", visit: 2, patch: "T2", kind: "clover", action: "ask", c: 7, r: 22 });
const big = await until("the refusal", () => (desk.scaffold.logTail().match(/big change ok (\w+) wait_s (\S+)/) || null));
check("over budget: refused, and told when it can afford it", big && big[1] === "False" && Number(big[2]) > 0, desk.scaffold.logTail());

// 4. It crashes: restarted after a backoff, re-audited.
append({ seq: 3, atMs: clock(), round: 3, bee: "T1", visit: 3, patch: "T2", kind: "clover", action: "ask", c: 8, r: 25 });
const restarted = await until("a restart", () => desk.scaffold.restarts >= 1 && desk.scaffold.child?.pid && desk.scaffold.child.pid !== pid1, 20000);
check("after a crash it is restarted (backoff), as a new process", !!restarted && /crashing on purpose/.test(desk.scaffold.logTail(200)) && (desk.scaffold.logTail(200).match(/==== scaffold scaffold\.py starting/g) || []).length >= 2, desk.scaffold.logTail(60));
const rows = await all("SELECT action, status FROM arena.scaffolds WHERE game_id = -424242 ORDER BY id");
desk.session = { id: null, no: 2, gate: () => null, requests: 0, submitted: [] };
check("the crash and the restart are recorded", rows.some((x) => x.status === "crashed") && rows.some((x) => x.action === "crash-restart"), JSON.stringify(rows));
r = await tool("tools/scaffold.py", "status");
check("tools/scaffold.py status", /scaffold scaffold\.py: running/.test(r.out) && /restarts 1, crashes 1/.test(r.out), r.out);
r = await tool("tools/scaffold.py", "logs", "-n", "5");
check("tools/scaffold.py logs", r.status === 0 && /crashing on purpose|starting/.test(r.out), r.out);

// 5. Only the team's sessions and its scaffold get answers.
desk.session = null;
r = await tool("tools/status.py");
check("between sessions, a request that isn't the scaffold's is refused", r.status === 1 && /no session of your team is running/.test(r.out), r.out);

// 6. The audit refuses forbidden scaffolds.
desk.session = { id: null, no: 2, gate: () => null, requests: 0, submitted: [] };
const bad = {
  "bad_path.py": `print(open("/etc/hostname").read())\n`,
  "bad_spawn.py": `import subprocess\nsubprocess.Popen(["sleep", "100"])\n`,
  "bad_net.py": `import urllib.request\nurllib.request.urlopen("http://localhost:3401/api/rooms/X")\n`,
  "bad_login.py": `import urllib.request\nurllib.request.urlopen("http://localhost:4000/api/auth/dev/login")\n`,
  "bad_stream.py": `open("stream/actions.jsonl", "a").write("x")\n`,
  "bad_env.py": `import os\nprint(os.environ)\n`,
  "bad_eval.py": `eval("1+1")\n`,
  "bad_parent.py": `import os\nprint(os.listdir(".."))\n`,
};
for (const [f, code] of Object.entries(bad)) fs.writeFileSync(path.join(dir, f), code);
const results = {};
for (const f of Object.keys(bad)) results[f] = auditScaffold(dir, f, { arenaId: AID, slug: "luna", port: "4000" }).found.some((x) => x.severity === "violation");
check("the audit refuses: paths outside, subprocesses, other ports, logins, stream writes, the environment, eval, '..'", Object.values(results).every(Boolean), JSON.stringify(results));
const okCode = auditScaffold(dir, "scaffold.py", { arenaId: AID, slug: "luna", port: "4000" }).found.filter((x) => x.severity === "violation");
check("the audit passes the stub scaffold (garden.py, a workspace module)", okCode.length === 0, JSON.stringify(okCode));
fs.writeFileSync(path.join(dir, "ok_api.py"), `import sys, json, urllib.request\nsys.path.insert(0, "tools")\nimport garden\nURL = garden.API + "/events?after=0"\nprint(json.loads(urllib.request.urlopen("http://localhost:4000/api/rooms/R/games/G/scores").read()))\n`);
check("the audit allows reading the public API (and API path fragments aren't paths)", auditScaffold(dir, "ok_api.py", { arenaId: AID, slug: "luna", port: "4000" }).found.filter((x) => x.severity === "violation").length === 0);
const before = desk.scaffold.child?.pid;
r = await tool("tools/scaffold.py", "restart", "bad_spawn.py");
check("a forbidden scaffold is not started; the refusal is recorded as a violation", r.status === 1 && /audit refused/.test(r.out) && desk.scaffold.state === "refused" && before && !alive(before)
  && (await all("SELECT * FROM arena.violations WHERE game_id = -424242 AND tool = 'scaffold' AND severity = 'violation'")).length >= 1, r.out);

// 7. A greedy scaffold is held to its CPU share.
fs.writeFileSync(path.join(dir, "busy.py"), `import time\nprint("busy", flush=True)\nt = time.time()\nwhile True:\n    pass\n`);
r = await tool("tools/scaffold.py", "start", "busy.py");
await sleep(3500);
const st = desk.scaffold.status();
check("a busy scaffold is throttled to its CPU share (paused while over it)", st.state === "running" && st.throttledMs > 1000 && st.cpuSeconds < 3.5 * 0.5, JSON.stringify(st));

// 8. The game ends: the scaffold is stopped.
const lastPid = desk.scaffold.child?.pid;
await desk.stop("game over");
check("the end of the game stops the scaffold and its process group", lastPid && !alive(lastPid) && desk.scaffold.state === "stopped" && /scaffold stopped \(game over\)/.test(desk.scaffold.logTail()));

await q("DELETE FROM arena.requests WHERE game_id = -424242");
await q("DELETE FROM arena.scaffolds WHERE game_id = -424242");
await q("DELETE FROM arena.violations WHERE game_id = -424242");
await pool.end();
fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all scaffold checks passed");
process.exit(failed ? 1 : 0);
