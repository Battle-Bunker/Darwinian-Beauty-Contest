#!/usr/bin/env node
// Scaffolds (lib/scaffold.js, tools/garden.py, tools/scaffold.py) with a fake game API and real processes; no model
// calls, no game server (the arena schema in dbc_one for throwaway rows):
//   node arena/test-scaffold.mjs
// A stub scaffold: it starts from a session with tools/ on its import path (and a module of its own there, audited
// too), survives the session's end, submits a change by itself when its history shows a rival species' answer,
// is refused (with a wait time) when a change is over budget, is restarted after it crashes, a forbidden scaffold
// fails the audit, a greedy one is throttled to its CPU share, and everything stops at game end.
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
const { setupAgentCgroups, cgroupsOf } = await import("./lib/cgroups.js");
await migrate();
// The agents' cgroups (lib/cgroups.js), as the runner makes them at start; where the box can't, scaffolds run uncontained.
const contained = setupAgentCgroups(() => {}).ok;

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 700)}`}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(100); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------------------------------------------------------------- a fake game: clock, budgets, submissions
const config = { language: "python", minutes: 2, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512,
  budgets: { flower: { size: 1100, perMinute: 600, cap: 600, ms: 150 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 } } };
const t0 = Date.now();
const clock = () => Date.now() - t0;
const bank = { flower: { bank: 80, atMs: 0 } };
const submits = [];
const avail = (k) => Math.min(config.budgets[k].cap, (bank[k]?.bank ?? 0) + config.budgets[k].perMinute * (clock() - (bank[k]?.atMs ?? 0)) / 60000);
const fakeApi = {
  view: async () => ({ game: { status: "running", clockMs: clock(), endMs: 120000, round: Math.floor(clock() / 200), config },
    teams: [{ id: "T1", name: "Moonpetal", banks: { flower: bank.flower, bee: { bank: 0, atMs: 0 } },
      programs: { flower: [{ version: submits.length + 1, size: 10, atMs: 0, code: "def flower(c):\n    return c, 50\n" }], bee: [] }, memory: { value: {}, bytes: 0, cap: 50, version: 1, error: null } },
      { id: "T2", name: "Rival", programs: null, banks: null }], scores: [{ teamId: "T1", fitness: 1 }, { teamId: "T2", fitness: 1 }] }),
  check: async (tok, g, kind, code) => ({ ok: true, size: code.length, budget: config.budgets[kind], cost: code.length, available: Math.floor(avail(kind)), errors: [] }),
  tryFlower: async (tok, g, code, ch) => ({ results: (ch || [1]).map((c) => ({ c, r: 0, percent: 50, energy: 1000, ms: 1 })) }),
  tryBee: async () => ({ rounds: 60, feeds: 0, nectar: 0, pollen: 0, memory: {}, problems: [], actions: [] }),
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
for (const f of ["actions.jsonl", "history.jsonl", "mine.jsonl"]) fs.writeFileSync(path.join(dir, "stream", f), "");
fs.writeFileSync(path.join(dir, "stream", "teams.json"), JSON.stringify({ teams: { T1: "Moonpetal", T2: "Rival" }, me: "T1", participants: ["T1", "T2"], names: ["Moonpetal", "Rival"], myIndex: 0 }));
fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ ...config, your_index: 0, public_api: "http://localhost:4100/api/rooms/R/games/G" }));
/** A turn record: a flower of the rival's species (index 1) answered c with r to our bee (index 0). */
const append = (seq, c, r) => fs.appendFileSync(path.join(dir, "stream", "history.jsonl"), JSON.stringify({ seq, game: "G", round: seq, atMs: (seq - 1) * 200, turn: seq, bee: 0, flower: 1,
  challenge: c, response: r, fed: false, percent: null, energy: null, nectar: null, pollen: 0, ms: null, flowerVersion: null, flowerError: null, beeMs: 1, beeVersion: 1, beeError: null }) + "\n");
const logs = [];
const desk = await new TeamDesk({ arena: { id: AID, settings: { scaffold: { cpuShare: 0.2 } } }, gameRow: { id: -424242, generation: 1 }, persona: { id: `${AID}/luna`, slug: "luna", name: "Luna" },
  entry: { team_id: "T1", login_name: "x" }, gPath: "/rooms/R/games/G", dir, stream: { get clockMs() { return clock(); }, status: "running" }, log: (m) => logs.push(m),
  apiBase: "http://localhost:4100/api/rooms/R/games/G", api: fakeApi, tok: "SECRET-TOKEN" }).start();
const tool = (...a) => new Promise((resolve) => {
  const c = spawn("python3", a, { cwd: dir });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (out += d));
  c.on("close", (status) => resolve({ status, out }));
});

// The stub scaffold: copy a rival flower's answer into our flower, then try something over budget, then crash once.
// It imports garden without touching sys.path (tools/ is on its import path), and a module of its own in tools/.
fs.writeFileSync(path.join(dir, "scaffold.py"), `import os
import garden
import helper

print("scaffold up; me =", garden.ME, garden.MY_INDEX, "; flower budget", round(garden.status()["budgets"]["flower"]["exact"], 1),
      "; memory", garden.memory()["bytes"], flush=True)
seen = 0
for t in garden.follow(from_start=True):
    if t.flower == garden.MY_INDEX or t.response is None:
        continue
    seen += 1
    if seen == 1:
        n = garden.local.turns.eq("flower", 1).count().value()
        r = garden.submit("flower", helper.table_flower({t.challenge: t.response}))
        print("copied", t.challenge, "->", t.response, "ok", r["ok"], "cost", r.get("cost"), "seen", n, flush=True)
    elif seen == 2:
        r = garden.submit("flower", "def flower(c):\\n    return 0, 50\\n" + "#" * 400)
        print("big change ok", r["ok"], "wait_s", r.get("wait_s"), flush=True)
    elif seen == 3 and not os.path.exists("crashed.flag"):
        open("crashed.flag", "w").write("once")
        print("crashing on purpose", flush=True)
        raise RuntimeError("boom")
`);
fs.writeFileSync(path.join(dir, "tools", "helper.py"), `def table_flower(t):\n    return "T = %r\\ndef flower(c):\\n    return T.get(c, 0), 50\\n" % t\n`);

// 1. Started by a session; the session ends; the scaffold keeps running.
desk.session = { id: null, no: 1, gate: () => null, requests: 0, submitted: [] };
let r = await tool("tools/scaffold.py", "start", "scaffold.py");
check("start: audited and started from a session", r.status === 0 && /is running \(pid \d+\)/.test(r.out), r.out);
const pid1 = desk.scaffold.child?.pid;
const row = (await all("SELECT * FROM arena.scaffolds WHERE game_id = -424242 ORDER BY id"))[0];
check("start: recorded with its audited source (the entry file and its own module in tools/, not the runner's tools)", row?.status === "running" && row.source.includes("# ==== scaffold.py")
  && row.source.includes("# ==== tools/helper.py") && !row.source.includes("# ==== tools/garden.py"), row?.source?.slice(0, 300));
desk.session = null;
const killed = await killLeftovers("no-such-tag", dir, () => desk.scaffold.pids());
check("the end of the session doesn't stop the scaffold", pid1 && alive(pid1) && !killed.includes(pid1));
const ready = await until("scaffold up", () => /scaffold up; me = T1 0 ; flower budget [\d.]+ ; memory 0/.test(desk.scaffold.logTail()));
check("import garden works with tools/ on the path; it talks to the runner between sessions", !!ready, desk.scaffold.logTail());

// 2. Its history shows a rival species' answer: the scaffold copies it into its flower and submits it by itself.
append(2, 42, 127);
const sub = await until("an automatic submission", () => submits.length >= 1 && submits[0]);
check("an automatic submission, with the team's token held by the runner", sub && sub.kind === "flower" && sub.code.includes("T = {42: 127}") && sub.tok === "SECRET-TOKEN", JSON.stringify(sub));
const reqRows = await until("recorded", async () => { const x = await all("SELECT * FROM arena.requests WHERE game_id = -424242 AND op = 'submit'"); return x.length ? x : null; });
check("recorded in arena.requests with source 'scaffold'", reqRows?.[0]?.source === "scaffold" && reqRows[0].ok && reqRows[0].scaffold_id === row.id, JSON.stringify(reqRows?.[0]));
check("the scaffold's token never appears in the workspace", !fs.readdirSync(path.join(dir, ".runner", "res")).some((f) => fs.readFileSync(path.join(dir, ".runner", "res", f), "utf8").includes("SECRET-TOKEN")));

// 3. A change over budget: refused, with how long until it's affordable.
append(4, 7, 22);
const big = await until("the refusal", () => (desk.scaffold.logTail().match(/big change ok (\w+) wait_s (\S+)/) || null));
check("over budget: refused, and told when it can afford it", big && big[1] === "False" && Number(big[2]) > 0, desk.scaffold.logTail());

// 4. It crashes: restarted after a backoff, re-audited.
append(6, 8, 25);
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
  "bad_login.py": `import urllib.request\nurllib.request.urlopen("http://localhost:4100/api/auth/dev/login")\n`,
  "bad_port.py": `import urllib.request\nurllib.request.urlopen("http://localhost:4000/api/rooms/X")\n`,
  "bad_stream.py": `open("stream/actions.jsonl", "a").write("x")\n`,
  "bad_history.py": `open("stream/history.jsonl", "w").write("")\n`,
  "bad_query.py": `import urllib.request\nurllib.request.urlopen(urllib.request.Request("http://localhost:4100/api/rooms/R/games/G/programs", data=b"{}"))\n`,
  "bad_socket.py": `import socket\ns = socket.create_connection(("localhost", 4100))\n`,
  "bad_module.py": `import sneaky\nsneaky.go()\n`,
  "bad_env.py": `import os\nprint(os.environ)\n`,
  "bad_eval.py": `eval("1+1")\n`,
  "bad_parent.py": `import os\nprint(os.listdir(".."))\n`,
};
for (const [f, code] of Object.entries(bad)) fs.writeFileSync(path.join(dir, f), code);
fs.writeFileSync(path.join(dir, "tools", "sneaky.py"), `import subprocess\ndef go():\n    subprocess.Popen(["sleep", "100"])\n`); // its own module in tools/
const results = {};
for (const f of Object.keys(bad)) results[f] = auditScaffold(dir, f, { arenaId: AID, slug: "luna", port: "4100" }).found.some((x) => x.severity === "violation");
check("the audit refuses: paths outside, subprocesses, other ports, logins, stream and history writes, POSTs other than queries, raw sockets, a module in tools/ that spawns, the environment, eval, '..'", Object.values(results).every(Boolean), JSON.stringify(results));
const okCode = auditScaffold(dir, "scaffold.py", { arenaId: AID, slug: "luna", port: "4100" }).found.filter((x) => x.severity === "violation");
check("the audit passes the stub scaffold (the runner's garden.py, its own module in tools/)", okCode.length === 0, JSON.stringify(okCode));
fs.writeFileSync(path.join(dir, "ok_api.py"), `import sys, json, urllib.request\nsys.path.insert(0, "tools")\nimport garden\nURL = garden.API + "/events?after=0"\nprint(json.loads(urllib.request.urlopen("http://localhost:4100/api/rooms/R/games/G/scores").read()))\n`);
check("the audit allows reading the public API (and API path fragments aren't paths)", auditScaffold(dir, "ok_api.py", { arenaId: AID, slug: "luna", port: "4100" }).found.filter((x) => x.severity === "violation").length === 0);
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
const cg = cgroupsOf(desk.scaffold.child?.pid);
check(`a scaffold runs in the agents' cgroups, cpuset and cpu dbc-agents${contained ? "" : " (skipped: no cgroups on this box)"}`, !contained || (cg?.cpuset === "/dbc-agents" && cg?.cpu === "/dbc-agents"), JSON.stringify(cg));

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
