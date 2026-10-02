#!/usr/bin/env node
// Workspaces, the shared stream and the fair-play audit (no server, no model calls; uses the arena schema in dbc_live
// for a throwaway arena row):
//   node arena/test-workspace.mjs
// 1. prepareWorkspace writes the files a team needs (rules, interface, config, tools, its own versions, status), the
//    live stream as a hard link to the runner's shared copy, and nothing secret; other teams' versions never appear.
// 2. The shared stream grows in every workspace at once, a team damaging it through its link gets it repaired, and
//    stream/mine.jsonl carries only the team's own private details. tools/stream.py reads it (summary, answers, sql).
// 3. The audit: reading the game's public API on localhost is fine; logins, credentials, writes, other hosts and
//    ports, paths outside the workspace and writes into stream/ are violations.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "arena-ws-test-"));
process.env.ARENA_WS_ROOT = root;
const { prepareWorkspace, audit, allowedUrl, escapesWorkspace, wsDir } = await import("./lib/workspace.js");
const { GameStream, privateView } = await import("./lib/stream.js");
const { migrate, pool, q } = await import("./lib/db.js");
await migrate();
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 600)}`}`); if (!ok) failed++; };

const AID = `test-ws-${process.pid}`;
await q("INSERT INTO arena.arenas (id, preset, settings, owner_name) VALUES ($1, 'test', $2, 'owner')", [AID, { config: {} }]);
for (const slug of ["luna", "tess"]) {
  await q(`INSERT INTO arena.personas (id, arena_id, slug, name, team_name, model, archetype, is_kid, persona_prompt, notebook)
           VALUES ($1, $2, $3, $3, $3, 'haiku', 'test', false, 'p', $4)`, [`${AID}/${slug}`, AID, slug, `notes of ${slug}`]);
}
const arena = { id: AID, settings: { config: {} } };
const gameRow = { id: -1, generation: 1, game_short_id: "G" };

const config = { language: "python", minutes: 2, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512, revealOnFinish: true,
  budgets: { clover: { size: 1100, perMinute: 220, cap: 220, ms: 150 }, orchid: { size: 2200, perMinute: 1540, cap: 1540, ms: 50 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 25 } } };
const viewFor = (me) => ({
  game: { status: "running", clockMs: 30000, endMs: 120000, round: 400, config },
  me: { teamId: me }, myTeam: { name: me === "T1" ? "Moonpetal" : "Show Your Work" }, participants: ["T1", "T2"],
  interface: { types: { challenge: "int", response: "int", challengeMeans: "an integer", responseMeans: "an integer", rules: ["ints: whole numbers."] }, flower: "def flower(challenge): ...", bee: "def forage(seen, visit): ..." },
  teams: [
    { id: "T1", name: "Moonpetal", programs: me === "T1" ? { clover: [{ version: 1, size: 40, cost: 0, atMs: 0, code: "def flower(c):\n    return c\n" }, { version: 2, size: 41, cost: 2, atMs: 20000, code: "def flower(c):\n    return c + 1\n" }],
      orchid: [{ version: 1, size: 30, cost: 0, atMs: 0, code: "def flower(c):\n    return 0\n" }], bee: [{ version: 1, size: 300, cost: 0, atMs: 0, code: "def forage(seen, visit):\n    return 'leave'\n" }] } : null, banks: null },
    { id: "T2", name: "Show Your Work", programs: me === "T2" ? { clover: [{ version: 1, size: 40, cost: 0, atMs: 0, code: "SECRET_CODE_OF_T2 = 1\n" }], orchid: [], bee: [] } : null, banks: null },
  ],
  scores: [{ teamId: "T1", fitness: 1.1 }, { teamId: "T2", fitness: 0.9 }],
});

// A fake public stream: pages of actions.
const acts = [];
const addActs = (n) => { for (let i = 0; i < n; i++) { const seq = acts.length + 1; acts.push({ seq, atMs: seq * 100, round: seq, bee: seq % 2 ? "T1" : "T2", visit: Math.ceil(seq / 4), patch: seq % 3 ? "T2" : "T1",
  kind: seq % 4 ? "clover" : "orchid", action: seq % 5 === 0 ? "feed" : "ask", ...(seq % 5 === 0 ? { nectar: seq % 4 !== 0 } : { c: seq % 7, r: (seq % 7) * 3, ms: 2.5 }) }); } };
addActs(50);
const stream = new GameStream({ root: path.join(root, AID), gen: 1, gPath: "/x", gameUuid: null, teams: [{ id: "T1", name: "Moonpetal" }, { id: "T2", name: "Show Your Work" }],
  fetchPage: async (after) => ({ actions: acts.filter((a) => a.seq > after).slice(0, 5000), lastSeq: acts.length, clockMs: acts.length * 100, status: "running" }) }).load();
await stream.poll();

const apiBase = "http://localhost:4000/api/rooms/R/games/G";
const p1 = { id: `${AID}/luna`, slug: "luna" }, p2 = { id: `${AID}/tess`, slug: "tess" };
const { dir } = await prepareWorkspace({ arena, gameRow, persona: p1, view: viewFor("T1"), stream, apiBase, statusText: "Game running: 0:30 of 2:00\n" });
const { dir: dir2 } = await prepareWorkspace({ arena, gameRow, persona: p2, view: viewFor("T2"), stream, apiBase });
const has = (f) => fs.existsSync(path.join(dir, f));
check("workspace: rules, interface, config, README, notebook, status", ["RULES.md", "interface.txt", "config.json", "README.md", "notebook.md", "status.txt"].every(has));
check("workspace: the notebook comes from the persona", fs.readFileSync(path.join(dir, "notebook.md"), "utf8") === "notes of luna");
check("workspace: the tools", ["tools/_runner.py", "tools/submit.py", "tools/check.py", "tools/try.py", "tools/status.py", "tools/stream.py"].every(has));
check("workspace: program files are the versions playing now", fs.readFileSync(path.join(dir, "clover.py"), "utf8").includes("return c + 1"));
check("workspace: its own version history", has("history/clover/v1.py") && has("history/clover/v2.py") && /\| 0:20 \| clover \| v2 \| 41 \| 2 \|/.test(fs.readFileSync(path.join(dir, "history/versions.md"), "utf8")));
const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
check("config.json: the settings, the teams and the public API", cfg.minutes === 2 && cfg.feedCost === 10 && cfg.teams.length === 2 && cfg.public_api === apiBase);
const st1 = fs.statSync(path.join(dir, "stream/actions.jsonl")), st2 = fs.statSync(path.join(dir2, "stream/actions.jsonl"));
check("stream: one shared file, hard-linked into each workspace", st1.ino === st2.ino && st1.ino === fs.statSync(stream.sharedFile).ino && st1.nlink >= 3);
check("stream: the public lines as the API gave them", fs.readFileSync(path.join(dir, "stream/actions.jsonl"), "utf8").trim().split("\n").length === 50);
const teamsJson = JSON.parse(fs.readFileSync(path.join(dir, "stream/teams.json"), "utf8"));
check("stream/teams.json: names and which team is yours", teamsJson.me === "T1" && teamsJson.teams.T2 === "Show Your Work");
addActs(30);
await stream.poll();
check("stream: new actions appear in every workspace at once", fs.readFileSync(path.join(dir2, "stream/actions.jsonl"), "utf8").trim().split("\n").length === 80);
fs.truncateSync(path.join(dir2, "stream/actions.jsonl"), 10); // a team damages its link
addActs(5);
await stream.poll();
const lines = fs.readFileSync(path.join(dir, "stream/actions.jsonl"), "utf8").trim().split("\n");
check("stream: damage through a link is repaired from the master copy", lines.length === 85 && lines.every((l) => JSON.parse(l).seq));
// Nothing secret, nothing of other teams' code or versions.
const all = (d) => spawnSync("grep", ["-rIl", "-e", "Bearer", "-e", "postgres://", "-e", "DEV_LOGIN", "-e", "secret", "-e", "SECRET_CODE_OF_T2", d], { encoding: "utf8" }).stdout.trim();
check("workspace: no credentials, database URLs or other teams' code", all(dir) === "", all(dir));
check("workspace: other teams' versions aren't shown during play", !fs.readFileSync(path.join(dir, "history/versions.md"), "utf8").includes("Show Your Work"));

// mine.jsonl: the private view of one team (same rule as the API).
const row = { seq: 7, at_ms: 700, round: 7, bee_team: "T1", visit: 2, patch_team: "T2", kind: "clover", action: "leave", bee_version: 3, flower_version: 5, error: "a new bee took over", error_by: "engine", log: "hi" };
const v1 = privateView(row, "T1"), v2 = privateView(row, "T2");
check("mine.jsonl: your bee's version, printout and engine leave, by seq", v1.seq === 7 && v1.beeVersion === 3 && v1.log === "hi" && v1.by === "engine" && v1.flowerVersion === undefined && v1.c === undefined);
check("mine.jsonl: the patch owner gets its flower version, not the bee's details", v2.flowerVersion === 5 && v2.beeVersion === undefined && v2.log === undefined && v2.error === undefined);
check("mine.jsonl: nothing for a team the action doesn't involve", privateView(row, "T3") === null);

// tools/stream.py on the workspace's stream.
const py = (...a) => spawnSync("python3", ["tools/stream.py", ...a], { cwd: dir, encoding: "utf8" });
let r = py("summary");
check("stream.py summary: per-bee and per-flower counts with names", r.status === 0 && /85 actions/.test(r.stdout) && /\* Moonpetal/.test(r.stdout) && /Show Your Work\s+clover/.test(r.stdout), r.stdout + r.stderr);
r = py("summary", "--since", "0.1");
check("stream.py summary --since: only the recent stretch", r.status === 0 && /26 actions, game time 0:06-0:08/.test(r.stdout), r.stdout + r.stderr);
r = py("answers", "3");
check("stream.py answers: what each flower answered", r.status === 0 && /9  x\d+/.test(r.stdout), r.stdout + r.stderr);
r = py("sql", "SELECT action, count(*) FROM actions GROUP BY 1 ORDER BY 1");
check("stream.py sql: a local SQLite copy", r.status === 0 && /ask\t68/.test(r.stdout) && /feed\t17/.test(r.stdout) && fs.existsSync(path.join(dir, "cache/stream.sqlite")), r.stdout + r.stderr);
r = spawnSync("python3", ["-c", "import sys; sys.path.insert(0,'tools'); from stream import Stream; s=Stream(); print(len(list(s.actions(since_ms=8000))), s.last()['seq'], s.name('T2'))"], { cwd: dir, encoding: "utf8" });
check("stream.py as a library: actions(since_ms), last(), names", r.stdout.trim() === "6 85 Show Your Work", r.stdout + r.stderr);

// ---------------------------------------------------------------- the audit
const tr = (...tools) => tools.map((t, i) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: t[0], input: t[1] }] } }));
const sev = (...tools) => { const f = audit(tr(...tools), dir, AID, "luna", { port: 4000 }); return f.some((x) => x.severity === "violation") ? "violation" : f.length ? "warning" : "ok"; };
const bash = (command) => ["Bash", { command }];
const writePy = (content) => ["Write", { file_path: path.join(dir, "follow.py"), content }];
check("audit: python urllib GET of the public API on localhost is fine", sev(bash(`python3 -c "import urllib.request; print(urllib.request.urlopen('${apiBase}/actions?after=0&limit=10').read()[:200])"`)) === "ok");
check("audit: a script following the SSE stream is fine", sev(writePy(`import json, urllib.request\nURL = "${apiBase}/events?after=0"\nfor line in urllib.request.urlopen(URL):\n    if line.startswith(b"data: "):\n        print(json.loads(line[6:]))\n`)) === "ok");
check("audit: a script calling tools/submit.py via subprocess is fine", sev(writePy(`import subprocess\nsubprocess.run(["python3", "tools/submit.py", "orchid"])\n`)) === "ok");
check("audit: running such a script in the background is fine", sev(bash("python3 follow.py > follow.log 2>&1 &")) === "ok" && sev(["Bash", { command: "python3 follow.py > follow.log 2>&1", run_in_background: true }]) === "ok");
const { taskDir } = await import("./lib/workspace.js");
check("audit: reading the output file of its own background task is fine", sev(["Read", { file_path: path.join(taskDir(dir), "tasks", "b1.output") }]) === "ok" && sev(bash(`tail ${taskDir(dir)}/tasks/b1.output`)) === "ok");
check("audit: another session's task output is not", sev(["Read", { file_path: path.join(taskDir(dir2), "tasks", "b1.output") }]) === "violation");
check("audit: logging in is a violation", sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:4000/api/auth/dev/login')"`)) === "violation");
check("audit: a POST to the API is a violation", sev(writePy(`import urllib.request\nurllib.request.urlopen(urllib.request.Request("${apiBase}/programs", data=b"{}", method="POST"))\n`)) === "violation");
check("audit: credentials in a request are a violation", sev(writePy(`import urllib.request\nreq = urllib.request.Request("${apiBase}", headers={"Authorization": "Bearer x"})\n`)) === "violation");
check("audit: another port (the database, another server) is a violation", sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:3401/api/rooms/X')"`)) === "violation");
check("audit: another host is a violation", sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('https://example.com/')"`)) === "violation");
check("audit: raw sockets are a violation", sev(writePy(`import socket\ns = socket.socket()\n`)) === "violation");
check("audit: curl is a violation unless it reads the public API", sev(bash(`curl -s ${apiBase}/actions?after=0`)) === "ok" && sev(bash(`curl -s -X POST ${apiBase}/programs -d '{}'`)) === "violation");
check("audit: writing to stream/ is a violation", sev(["Write", { file_path: path.join(dir, "stream/actions.jsonl"), content: "" }]) === "violation"
  && sev(bash("echo x >> stream/actions.jsonl")) === "violation" && sev(writePy(`open("stream/actions.jsonl", "w").write("")\n`)) === "violation");
check("audit: reading stream/ is fine", sev(bash("tail -n 5 stream/actions.jsonl")) === "ok" && sev(writePy(`for l in open("stream/actions.jsonl"):\n    pass\n`)) === "ok" && sev(bash("cp stream/actions.jsonl copy.jsonl")) === "ok");
check("audit: paths outside the workspace are violations", sev(bash("cat /etc/hostname")) === "violation" && sev(["Read", { file_path: "/etc/hostname" }]) === "violation" && sev(bash("ls ../")) === "violation");
check("audit: another team's workspace is a violation", sev(bash(`cat ${root}/${AID}/tess/clover.py`.replace(root, "/home/user/arena-ws"))) === "violation");
check("audit: environment and database access are violations", sev(bash("env | head")) === "violation" && sev(bash("psql -c 'select 1'")) === "violation");
check("audit: allowedUrl", allowedUrl(`${apiBase}/events?after=3`) && allowedUrl("http://127.0.0.1:4000/api/rooms/X") && !allowedUrl("http://localhost:4000/api/auth/dev/login") && !allowedUrl("http://localhost:5432/"));
check("audit: '..' inside the workspace is fine, leaving it isn't", !escapesWorkspace("cat history/clover/../orchid/v1.py", dir) && escapesWorkspace("cat ../../x", dir));

await q("DELETE FROM arena.personas WHERE arena_id = $1", [AID]);
await q("DELETE FROM arena.arenas WHERE id = $1", [AID]);
await pool.end();
fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all workspace checks passed");
process.exit(failed ? 1 : 0);
