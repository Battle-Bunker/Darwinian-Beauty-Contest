#!/usr/bin/env node
// Workspaces, the streams and the fair-play audit (no server, no model calls; uses the arena schema in dbc_one for a
// throwaway arena row):
//   node arena/test-workspace.mjs
// 1. prepareWorkspace writes the files a team needs (rules, interface, config, tools, its own versions, status), the
//    public stream as a hard link to the runner's shared copy, and nothing secret; other teams' versions never appear.
// 2. The shared stream grows in every workspace at once, a team damaging it through its link gets it repaired;
//    stream/history.jsonl (the team's history) and stream/mine.jsonl carry the team's own private fields and nobody
//    else's. A response over 4 KB is its size, hash and a short preview in the files, fetched whole on request.
//    tools/stream.py, tools/garden.py and tools/query.py read them (the query checks need vendor/query/history.py,
//    the generated client: they are skipped while it doesn't exist).
// 3. The audit: reading the game's public API on localhost is fine; logins, credentials, writes, other hosts and
//    ports, raw sockets, paths outside the workspace and writes into stream/ are violations.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "arena-ws-test-"));
process.env.ARENA_WS_ROOT = root;
const { prepareWorkspace, audit, allowedUrl, escapesWorkspace } = await import("./lib/workspace.js");
const { GameStream, STREAM_PREVIEW } = await import("./lib/stream.js");
const { DB_URL, migrate, pool, q } = await import("./lib/db.js");
const HAVE_CLIENT = fs.existsSync(new URL("../vendor/query/history.py", import.meta.url));
await migrate();
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 600)}`}`); if (!ok) failed++; };
check("database: dbc_one, never dbc or dbc_live", /\/dbc_one(\?|$)/.test(DB_URL) || !/\/(dbc|dbc_live)(\?|$)/.test(DB_URL), DB_URL);

const AID = `test-ws-${process.pid}`;
await q("INSERT INTO arena.arenas (id, preset, settings, owner_name) VALUES ($1, 'test', $2, 'owner')", [AID, { config: {} }]);
for (const slug of ["luna", "tess"]) {
  await q(`INSERT INTO arena.personas (id, arena_id, slug, name, team_name, model, archetype, is_kid, persona_prompt, notebook)
           VALUES ($1, $2, $3, $3, $3, 'haiku', 'test', false, 'p', $4)`, [`${AID}/${slug}`, AID, slug, `notes of ${slug}`]);
}
const arena = { id: AID, settings: { config: {} } };
const gameRow = { id: -1, generation: 1, game_short_id: "G" };

const config = { language: "python", minutes: 2, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512, revealOnFinish: true,
  budgets: { flower: { size: 1100, perMinute: 220, cap: 220, ms: 150 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50 } } };
const viewFor = (me) => ({
  game: { status: "running", clockMs: 30000, endMs: 120000, round: 150, config },
  me: { teamId: me }, myTeam: { name: me === "T1" ? "Moonpetal" : "Show Your Work" }, participants: ["T1", "T2"],
  interface: { types: { challenge: "int", response: "int", challengeMeans: "an integer", responseMeans: "an integer", rules: ["ints: whole numbers."] },
    flower: "def flower(challenge): ...", bee: "def first(): ...\ndef decide(challenge, response): ..." },
  teams: [
    { id: "T1", name: "Moonpetal", programs: me === "T1" ? { flower: [{ version: 1, size: 40, cost: 0, atMs: 0, code: "def flower(c):\n    return c, 50\n" }, { version: 2, size: 41, cost: 2, atMs: 20000, code: "def flower(c):\n    return c + 1, 50\n" }],
      bee: [{ version: 1, size: 300, cost: 0, atMs: 0, code: "def first():\n    return 1\n\ndef decide(c, r):\n    return 'leave', 1\n" }] } : null, banks: null },
    { id: "T2", name: "Show Your Work", programs: me === "T2" ? { flower: [{ version: 1, size: 40, cost: 0, atMs: 0, code: "SECRET_CODE_OF_T2 = 1\n" }], bee: [] } : null, banks: null },
  ],
  scores: [{ teamId: "T1", fitness: 1.1 }, { teamId: "T2", fitness: 0.9 }],
});

// A fake game: every turn with all its fields; the API pages show each team what it may see (RULES.md).
const IDS = ["T1", "T2"];
const turns = [];
const acts = [];
// Every 10th turn's response is a graph of about 10 KB: over 4 KB, the API gives it as its size, hash and first 4 KB.
const bigGraph = (k) => ({ nodes: 400, edges: Array.from({ length: 399 }, (_, i) => [i, i + 1]), labels: Array.from({ length: 400 }, (_, i) => `label-${k}-${i}`) });
// Pollen grains: on every feed, the feeding bee's team gets 20 characters of the flower's minified code (wrapping).
const CODES = { T1: 'import hashlib as d\nb="moonpetal-secret"\ndef flower(c):\n return(c*7+1)%1000,40', T2: 'def flower(a):\n return(a*3+1)%1000,25' };
const grainFor = (team, k) => { const code = CODES[team], st = (k * 37) % code.length; return Array.from({ length: 20 }, (_, i) => code[(st + i) % code.length]).join(""); };
const addTurns = (n) => {
  for (let i = 0; i < n; i++) {
    const k = turns.length + 1, bee = IDS[k % 2], flower = IDS[Math.floor(k / 2) % 2], fed = k % 3 === 0, percent = 10 * (k % 7), energy = 1000 * k;
    const r = k % 10 === 0 ? bigGraph(k) : (k % 5) * 3, text = JSON.stringify(r);
    const t = { k, round: k, bee, flower, c: k % 5, r, text, bytes: Buffer.byteLength(text), big: text.length > 4096, hash: crypto.createHash("sha256").update(text).digest("hex"),
      fed, percent, energy, ms: 1.5, beeMs: 3, log: `hi ${k}`, ...(fed ? { grain: grainFor(flower, k), grainVersion: 1, grainCodeLength: CODES[flower].length } : {}) };
    turns.push(t);
    acts.push({ seq: acts.length + 1, atMs: (k - 1) * 200, round: k, turn: k, bee, flower, action: "arrive", _t: t });
    acts.push({ seq: acts.length + 1, atMs: (k - 1) * 200 + 150, round: k, turn: k, bee, flower, action: fed ? "feed" : "leave", _t: t });
    t.seq = acts.length;
  }
};
let publicGrains = true;
const publicOf = (a) => {
  const { _t: t, ...x } = a;
  if (a.action === "arrive") return x;
  return { ...x, c: t.c, r: t.big ? null : t.r, rBytes: t.bytes, ...(t.big ? { rHash: t.hash, rPreview: t.text.slice(0, 4096) } : {}), pollen: t.fed ? (1 - t.percent / 100) * t.energy : 0,
    ...(t.fed ? { nectar: (t.percent / 100) * t.energy, percent: t.percent, energy: t.energy } : {}),
    // (as the public API gives grains once the game is over: the shared file must drop them all the same)
    ...(t.fed && publicGrains ? { grain: t.grain, grainVersion: t.grainVersion, grainCodeLength: t.grainCodeLength } : {}) };
};
const mineOf = (a, me) => {
  const x = publicOf(a), t = a._t;
  if (t.flower === me && a.action !== "arrive") Object.assign(x, { percent: t.percent, energy: t.energy, ms: t.ms, flowerVersion: 1 });
  if (t.bee === me && a.action !== "arrive") Object.assign(x, { beeMs: t.beeMs, log: t.log, beeVersion: 1 });
  for (const f of ["grain", "grainVersion", "grainCodeLength"]) delete x[f];
  if (t.bee === me && t.fed) Object.assign(x, { grain: t.grain, grainVersion: t.grainVersion, grainCodeLength: t.grainCodeLength });
  return x;
};
/** A turn record as GET .../ledger gives it to a team (the turns entity, masked for that team). */
const entryOf = (t, me) => ({ seq: t.seq, game: "G", round: t.round, atMs: (t.round - 1) * 200, turn: t.k, bee: IDS.indexOf(t.bee), flower: IDS.indexOf(t.flower), challenge: t.c, response: t.big ? null : t.r,
  responseBytes: t.bytes, responseHash: t.big ? t.hash : null, fed: t.fed,
  percent: t.fed || t.flower === me ? t.percent : null, energy: t.fed || t.flower === me ? t.energy : null,
  nectar: t.fed ? (t.percent / 100) * t.energy : null, pollen: t.fed ? (1 - t.percent / 100) * t.energy : 0,
  ms: t.flower === me ? t.ms : null, flowerVersion: t.flower === me ? 1 : null, flowerError: null,
  beeMs: t.bee === me ? t.beeMs : null, beeVersion: t.bee === me ? 1 : null, beeError: null,
  grain: t.fed && t.bee === me ? t.grain : null, grainVersion: t.fed && t.bee === me ? 1 : null, grainCodeLength: t.fed && t.bee === me ? t.grainCodeLength : null });
addTurns(25);
const meOf = (tok) => tok.replace("tok-", "");
const stream = new GameStream({ root: path.join(root, AID), gen: 1, gPath: "/x", gameUuid: null, teams: [{ id: "T1", name: "Moonpetal" }, { id: "T2", name: "Show Your Work" }],
  fetchPage: async (after) => ({ actions: acts.filter((a) => a.seq > after).slice(0, 5000).map(publicOf), lastSeq: acts.length, clockMs: turns.length * 200, status: "running" }),
  // ?mine=1 with a team's token: its own bee's turns and those at its flower, with its private fields.
  fetchMine: async (tok, after) => ({ actions: acts.filter((a) => a.seq > after && (a.bee === meOf(tok) || a.flower === meOf(tok))).map((a) => mineOf(a, meOf(tok))) }),
  // The team's history with its token: every finished turn, private fields only at its own flower and for its own bee.
  fetchLedger: async (tok, after) => ({ participants: IDS, team: IDS.indexOf(meOf(tok)), entries: turns.filter((t) => t.seq > after).map((t) => entryOf(t, meOf(tok))) }) }).load();

const apiBase = "http://localhost:4100/api/rooms/R/games/G";
const p1 = { id: `${AID}/luna`, slug: "luna" }, p2 = { id: `${AID}/tess`, slug: "tess" };
const { dir } = await prepareWorkspace({ arena, gameRow, persona: p1, view: viewFor("T1"), stream, apiBase, statusText: "Game running: 0:30 of 2:00\n", tok: "tok-T1" });
const { dir: dir2 } = await prepareWorkspace({ arena, gameRow, persona: p2, view: viewFor("T2"), stream, apiBase, tok: "tok-T2" });
await stream.poll();
const has = (f) => fs.existsSync(path.join(dir, f));
check("workspace: rules, interface, config, README, notebook, status, schema", ["RULES.md", "interface.txt", "config.json", "README.md", "notebook.md", "status.txt", "stream/SCHEMA.md"].every(has));
check("workspace: the notebook comes from the persona", fs.readFileSync(path.join(dir, "notebook.md"), "utf8") === "notes of luna");
check("workspace: the tools", ["tools/_runner.py", "tools/submit.py", "tools/check.py", "tools/try.py", "tools/status.py", "tools/stream.py", "tools/query.py", "tools/garden.py", "tools/scaffold.py"].every(has)
  && !has("tools/ledger.py") && (has("tools/history.py") || !HAVE_CLIENT));
check("workspace: the program files are the versions playing now", fs.readFileSync(path.join(dir, "flower.py"), "utf8").includes("return c + 1, 50") && has("bee.py") && !has("cosmos.py") && !has("orchid.py"));
check("workspace: interface.txt has both programs", /flower:\ndef flower\(challenge\)/.test(fs.readFileSync(path.join(dir, "interface.txt"), "utf8")) && /bee:\ndef first/.test(fs.readFileSync(path.join(dir, "interface.txt"), "utf8")));
check("workspace: its own version history", has("history/flower/v1.py") && has("history/flower/v2.py") && /\| 0:20 \| flower \| v2 \| 41 \| 2 \|/.test(fs.readFileSync(path.join(dir, "history/versions.md"), "utf8")));
const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
check("config.json: the settings, the teams in index order, your index, the public API", cfg.minutes === 2 && cfg.feedCost === 10 && cfg.teams.join() === "Moonpetal,Show Your Work" && cfg.your_index === 0
  && cfg.flowers === 2 && cfg.public_api === apiBase && cfg.budgets.flower.size === 1100);
const st1 = fs.statSync(path.join(dir, "stream/actions.jsonl")), st2 = fs.statSync(path.join(dir2, "stream/actions.jsonl"));
check("stream: one shared public file, hard-linked into each workspace", st1.ino === st2.ino && st1.ino === fs.statSync(stream.sharedFile).ino && st1.nlink >= 3);
check("stream: the public lines as the API gave them", fs.readFileSync(path.join(dir, "stream/actions.jsonl"), "utf8").trim().split("\n").length === 50);
const teamsJson = JSON.parse(fs.readFileSync(path.join(dir, "stream/teams.json"), "utf8"));
check("stream/teams.json: names, indices and which team is yours", teamsJson.me === "T1" && teamsJson.teams.T2 === "Show Your Work" && teamsJson.myIndex === 0 && teamsJson.names[1] === "Show Your Work");
addTurns(15);
await stream.poll();
check("stream: new actions appear in every workspace at once", fs.readFileSync(path.join(dir2, "stream/actions.jsonl"), "utf8").trim().split("\n").length === 80);
fs.truncateSync(path.join(dir2, "stream/actions.jsonl"), 10); // a team damages its link
addTurns(5);
await stream.poll();
const lines = fs.readFileSync(path.join(dir, "stream/actions.jsonl"), "utf8").trim().split("\n");
check("stream: damage through a link is repaired from the master copy", lines.length === 90 && lines.every((l) => JSON.parse(l).seq));
// Nothing secret, nothing of other teams' code or versions.
const devSecret = fs.existsSync(new URL("./runs/.dev-secret", import.meta.url)) ? fs.readFileSync(new URL("./runs/.dev-secret", import.meta.url), "utf8").trim() : "no-dev-secret-file";
// (tools/history.py, the generated client, has the code that would send a token as a Bearer header: it never holds one.)
const grep = (d) => spawnSync("grep", ["-rIlF", "--exclude=history.py", "-e", devSecret, "-e", "Bearer ", "-e", "postgres://", "-e", "DEV_LOGIN_SECRET", "-e", "SECRET_CODE_OF_T2", "-e", "tok-T", d], { encoding: "utf8" }).stdout.trim()
  + spawnSync("grep", ["-rIlF", "-e", devSecret, "-e", "postgres://", "-e", "tok-T", path.join(d, "tools", "history.py")], { encoding: "utf8" }).stdout.trim();
check("workspace: no credentials, tokens, database URLs or other teams' code", grep(dir) === "", grep(dir));
check("workspace: other teams' versions aren't shown during play", !fs.readFileSync(path.join(dir, "history/versions.md"), "utf8").includes("Show Your Work"));

// The team's history and mine.jsonl: each team's own private fields, nobody else's.
const rd = (d, f) => fs.readFileSync(path.join(d, "stream", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const led1 = rd(dir, "history.jsonl"), led2 = rd(dir2, "history.jsonl");
check("history.jsonl: every finished turn, kept up to date", led1.length === 45 && led2.length === 45 && led1[led1.length - 1].seq === 90, led1.length);
check("history.jsonl: compute time only at your own flower, decision time only for your own bee", led1.every((e) => (e.flower === 0) === (e.ms != null)) && led2.every((e) => (e.flower === 1) === (e.ms != null))
  && led1.every((e) => (e.bee === 0) === (e.beeMs != null)));
check("history.jsonl: percent and energy on every feed, and on turns without a feed only at your own flower",
  led1.every((e) => (e.fed || e.flower === 0) === (e.percent != null && e.energy != null)) && led2.some((e) => !e.fed && e.flower === 0 && e.percent == null));
check("history.jsonl: nectar and pollen on feeds; pollen 0 otherwise", led1.every((e) => (e.fed ? e.nectar != null : e.nectar == null && e.pollen === 0)));
const mine1 = rd(dir, "mine.jsonl"), mine2 = rd(dir2, "mine.jsonl");
check("mine.jsonl: only the team's own bee's turns and those at its flower", mine1.length && mine1.every((a) => a.bee === "T1" || a.flower === "T1") && mine2.every((a) => a.bee === "T2" || a.flower === "T2"));
check("mine.jsonl: with its private fields (compute time, printouts), up to date with the stream", mine1.some((a) => a.beeMs === 3 && a.log) && mine1.some((a) => a.flower === "T1" && a.ms === 1.5)
  && !mine1.some((a) => a.flower !== "T1" && a.ms != null) && mine1[mine1.length - 1].seq >= 85);
const shared = fs.readFileSync(stream.sharedFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
check("the shared stream never carries private fields", shared.every((a) => !("ms" in a) && !("beeMs" in a) && !("log" in a) && !(a.action === "leave" && ("percent" in a || "energy" in a))));

// tools/stream.py, tools/garden.py and tools/query.py on the workspace's files.
const pyEnv = { PATH: process.env.PATH, PYTHONPATH: path.join(dir, "tools") };
const py = (tool, ...a) => spawnSync("python3", [`tools/${tool}.py`, ...a], { cwd: dir, encoding: "utf8", env: pyEnv });
const pyc = (code) => spawnSync("python3", ["-c", code], { cwd: dir, encoding: "utf8", env: pyEnv });
let r = py("stream", "tail", "-n", "4");
check("stream.py tail: the latest public actions", r.status === 0 && r.stdout.trim().split("\n").length === 4 && /arrive|feed|leave/.test(r.stdout), r.stdout + r.stderr);
r = pyc("from stream import Stream; s=Stream(); t=list(s.turns(since_round=40)); print(len(t), s.last()['seq'], s.name(1), s.my_index, s.n, sorted(k for k in t[0] if '_' in k))");
check("stream.py as a library: turns(since_round) with the Python field names, last(), names, your index", r.stdout.trim() === "6 90 Show Your Work 0 2 ['at_ms', 'bee_error', 'bee_ms', 'bee_version', 'flower_error', 'flower_version', 'grain_code_length', 'grain_version', 'response_bytes', 'response_hash']", r.stdout + r.stderr);

// Big responses: in the files only their size, hash and a short preview; the counts don't take them for failures.
const bigLines = shared.filter((a) => a.rHash);
check("big responses: the public file keeps their size, hash and a preview cut short (no response body)", bigLines.length === 4 && bigLines.every((a) => a.r === null && a.rBytes > 4096 && a.rPreview.length === STREAM_PREVIEW)
  && fs.statSync(stream.sharedFile).size < 40000, bigLines.map((a) => [a.rBytes, a.rPreview?.length]));
check("big responses: history.jsonl has their size and hash; mine.jsonl their short preview", led1.filter((e) => e.responseHash).length === 4 && led1.every((e) => e.responseHash ? e.response === null && e.responseBytes > 4096 : e.response !== null)
  && mine1.filter((a) => a.rHash).every((a) => a.rPreview.length === STREAM_PREVIEW));
check("big responses are answers, not failures, in the headline counts", stream.headline("T1").flower.noResponse === 0 && stream.headline("T2").flower.noResponse === 0, JSON.stringify(stream.headline("T1")));
r = py("stream", "tail", "-n", "90");
check("stream.py tail: a big response as its size and how to fetch it", r.status === 0 && /r=<\d+ bytes: tools\/stream\.py response \d+>/.test(r.stdout), r.stdout.slice(-600) + r.stderr);
// Pollen grains: each team's own in its own files only; never in the shared public file.
check("grains: the shared public file never carries a grain (even when the public API reveals them, after the game)", shared.every((a) => !("grain" in a) && !("grainVersion" in a))
  && acts.some((a) => a._t?.grain));
check("grains: history.jsonl and mine.jsonl carry the team's own bee's grains, nobody else's", led1.filter((e) => e.grain).length > 0 && led1.every((e) => (e.grain != null) === (e.fed && e.bee === 0))
  && led2.every((e) => (e.grain != null) === (e.fed && e.bee === 1)) && mine1.every((a) => !a.grain || a.bee === "T1"), led1.filter((e) => e.grain).length);
r = pyc("import garden, json; g = garden.grains(); print(len(g), sorted(set(x['flower'] for x in g)), g[0]['code_length'] in (" + Object.values(CODES).map((c) => c.length).join(",") + "), all(len(x['grain']) == 20 for x in g))");
check("garden.grains(): your grains, per species and version", r.status === 0 && r.stdout.trim() === `${led1.filter((e) => e.grain).length} [${[...new Set(led1.filter((e) => e.grain).map((e) => e.flower))].sort().join(", ")}] True True`, r.stdout + r.stderr);
r = py("grains");
check("grains.py: per species and version, how much is pieced together", r.status === 0 && /species of\s+version\s+grains/.test(r.stdout) && /v1/.test(r.stdout) && /(complete|% in \d+ piece)/.test(r.stdout), r.stdout + r.stderr);
r = py("grains", "--json");
const gj = JSON.parse(r.stdout || "[]");
check("grains.py --json: the assembly per version", r.status === 0 && gj.length && gj.every((x) => x.grains > 0 && x.code_length && Array.isArray(x.pieces)), r.stdout.slice(0, 300) + r.stderr);
// The assembler on enough grains: the whole minified code, rotated to where it starts (it compiles).
r = pyc(`import grains\ncode = ${JSON.stringify(CODES.T1)}\nL = len(code)\ng = [''.join(code[(s + i) % L] for i in range(24)) for s in range(0, L, 11)]\na = grains.assemble(g, L)\nprint(a['complete'], a['compiles'], a['code'] == code)\nb = grains.assemble(g[:2], L)\nprint(b['complete'], len(b['pieces']), b['share'] < 1)`);
check("grains: pieced together, the whole code where it starts; too few grains stay pieces", r.status === 0 && r.stdout.trim() === "True True True\nFalse 1 True", r.stdout + r.stderr);
r = py("grains", "--save");
check("grains.py --save: complete versions into grains/ in the workspace", r.status === 0 && (!/saved/.test(r.stdout) || fs.readdirSync(path.join(dir, "grains")).length > 0), r.stdout + r.stderr);

// The whole response, fetched on request from the game's public API (a fake one here).
const respServer = http.createServer((req, res) => {
  const m = req.url.match(/\/responses\/(\d+)$/), t = m && turns.find((x) => x.seq === Number(m[1]));
  if (!t) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"That turn has no response"}'); }
  res.writeHead(200, { "content-type": "application/json" }); res.end(t.text);
});
await new Promise((ok) => respServer.listen(0, "127.0.0.1", ok));
const cfgFile = path.join(dir, "config.json"), cfgText = fs.readFileSync(cfgFile, "utf8");
fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(cfgText), public_api: `http://127.0.0.1:${respServer.address().port}/api/rooms/R/games/G` }));
const bigT = turns.find((t) => t.big);
// (spawnSync would block this process, and with it the fake server: these run asynchronously.)
const { spawn: spawnA } = await import("node:child_process");
const run = (argv) => new Promise((ok) => { const c = spawnA("python3", argv, { cwd: dir, env: pyEnv }); let stdout = "", stderr = "";
  c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d)); c.on("close", (status) => ok({ status, stdout, stderr })); });
const pyA = (tool, ...a) => run([`tools/${tool}.py`, ...a]), pycA = (code) => run(["-c", code]);
r = await pyA("stream", "response", String(bigT.seq));
check("stream.py response: a whole response, its size, hash and shape", r.status === 0 && r.stdout.includes(`${bigT.bytes} bytes, sha256 ${bigT.hash}; graph: 400 nodes, 399 edges, 400 labels`) && r.stdout.includes("--out FILE"), r.stdout + r.stderr);
r = await pyA("stream", "response", String(bigT.seq), "--out", "big.json");
check("stream.py response --out: saved in the workspace", r.status === 0 && fs.readFileSync(path.join(dir, "big.json"), "utf8") === bigT.text, r.stdout + r.stderr);
r = await pyA("stream", "response", String(bigT.seq), "--out", "../escape.json");
check("stream.py response --out: never outside the workspace or in stream/", r.status !== 0 && (await pyA("stream", "response", String(bigT.seq), "--out", "stream/x.json")).status !== 0
  && !fs.existsSync(path.join(dir, "..", "escape.json")), r.stdout + r.stderr);
if (HAVE_CLIENT) {
  r = await pycA(`import garden\nt = [t for t in garden.local.turns.rows() if t.response_hash][0]\nr = garden.response(t)\nprint(t.seq, t.response, t.response_bytes, r["nodes"], len(r["labels"]), garden.response(t.seq) == r, garden.response(garden.local.turns.order_by("round").first()))`);
  check("garden.response: a turn's whole response, fetched when it is over 4 KB; a small one is the turn's own", r.status === 0 && r.stdout.trim() === `${bigT.seq} None ${bigT.bytes} 400 400 True 3`, r.stdout + r.stderr);
}
fs.writeFileSync(cfgFile, cfgText);
await new Promise((ok) => respServer.close(ok));
r = pyc("import garden; print(garden.MY_INDEX, garden.N, garden.name(1), garden.API)");
check("garden.py imports with tools/ on the path: your index, the teams, the public API", r.stdout.trim() === `0 2 Show Your Work ${apiBase}`, r.stdout + r.stderr);
if (HAVE_CLIENT) {
  r = pyc("import garden; H = garden.local; print(H.turns.count().value(), H.turns.my_flower().count().value(), H.turns.eq('fed', True).count().value(), H.turns.my_flower().eq('fed', False).not_null('percent').count().value(), H.turns.eq('flower', 1).eq('fed', False).not_null('percent').count().value())");
  const nMine = led1.filter((e) => e.flower === 0).length, nFed = led1.filter((e) => e.fed).length;
  check("garden.local: your team's history over history.jsonl, masked as the team may see it (unfed percent only at your own flower)",
    r.stdout.trim() === `45 ${nMine} ${nFed} ${led1.filter((e) => e.flower === 0 && !e.fed).length} 0`, r.stdout + r.stderr);
  r = pyc("import garden; t = garden.local.turns.order_by('round', desc=True).limit(1).rows()[0]; print(t.round, t.bee, t.flower, t.fed, t.seq, type(t).__name__)");
  check("garden.local: rows are Turn records, with seq", /^45 \d \d (True|False) 90 \w+$/.test(r.stdout.trim()), r.stdout + r.stderr);
  r = pyc("import garden; garden.HISTORY");
  check("garden.HISTORY is gone (programs see no history), with a pointer to garden.local", r.status !== 0 && /garden\.HISTORY is now garden\.local/.test(r.stderr), r.stdout + r.stderr);
  r = py("query", "--local", 'turns.my_flower().group_by("fed").count()');
  check("query.py --local: the builder's chain on the team's history file, as a table", r.status === 0 && /fed\s+count/.test(r.stdout) && /True/.test(r.stdout) && /False/.test(r.stdout), r.stdout + r.stderr);
  r = py("query", "--local", 'turns.eq("fed", True).sum("nectar").value()');
  const sumN = led1.filter((e) => e.fed).reduce((a, e) => a + e.nectar, 0);
  check("query.py --local: .value()", r.status === 0 && Math.abs(Number(r.stdout.trim()) - sumN) < 1e-6, r.stdout + r.stderr);
  r = py("query", "--ast", 'turns.my_bee().eq("fed", True).group_by("flower").sum("nectar")');
  const astOut = JSON.parse(r.stdout || "{}");
  check("query.py --ast: the query as JSON (the AST the game runs)", astOut.from === "turns" && astOut.scope === "myBee" && astOut.groupBy?.[0] === "flower" && astOut.where?.[0]?.field === "fed", r.stdout + r.stderr);
  r = py("query", "--local", 'turns.my_bee().count().__class__');
  check("query.py: only builder methods with literal arguments", r.status !== 0 && /query error/.test(r.stderr), r.stdout + r.stderr);
  r = py("query", "--local", 'turns.eq("fed", open("x").read())');
  check("query.py: arguments are literals only", r.status !== 0 && /query error/.test(r.stderr), r.stdout + r.stderr);
  r = py("query", "summary", "--local");
  check("query.py summary --local: per species and per bee, yours marked, your flower's private numbers", r.status === 0 && /\* Moonpetal/.test(r.stdout) && /your flower: \d+ visits/.test(r.stdout)
    && /compute mean 1\.5 ms/.test(r.stdout), r.stdout + r.stderr);
} else console.log("SKIP history queries: vendor/query/history.py isn't there yet");

// A workspace prepared in the lobby has no ledger indices yet (participants are fixed at the start): the stream adds
// them once the game runs, and a scaffold already running (garden.MY_INDEX) sees them without restarting.
const { spawn } = await import("node:child_process");
let lobbyStarted = false;
const stream2 = new GameStream({ root: path.join(root, AID), gen: 2, gPath: "/y", teams: [{ id: "T1", name: "Moonpetal" }, { id: "T2", name: "Show Your Work" }],
  fetchPage: async () => ({ actions: [], lastSeq: 0, clockMs: 0, status: lobbyStarted ? "running" : "lobby" }), fetchMine: async () => ({ actions: [] }),
  fetchLedger: async () => ({ participants: lobbyStarted ? IDS : null, team: lobbyStarted ? 0 : null, entries: [] }) }).load();
const lobbyView = { ...viewFor("T1"), participants: null, game: { ...viewFor("T1").game, status: "lobby", clockMs: 0 } };
await prepareWorkspace({ arena, gameRow: { ...gameRow, generation: 2 }, persona: p1, view: lobbyView, stream: stream2, apiBase, tok: "tok-T1" });
const tj = () => JSON.parse(fs.readFileSync(path.join(dir, "stream/teams.json"), "utf8"));
check("lobby: teams.json has no indices yet; the team files exist before the first turn", tj().myIndex === null && tj().me === "T1"
  && fs.readFileSync(path.join(dir, "stream/history.jsonl"), "utf8") === "" && fs.existsSync(path.join(dir, "stream/mine.jsonl")));
const waiter = spawn("python3", ["-c", "import time, garden\nprint('lobby', garden.MY_INDEX, garden.N, flush=True)\nt = time.time()\nwhile garden.MY_INDEX is None and time.time() - t < 10:\n    time.sleep(0.05)\nprint('started', garden.MY_INDEX, garden.N, garden.name(1), flush=True)"],
  { cwd: dir, env: { PATH: process.env.PATH, PYTHONPATH: path.join(dir, "tools") } });
let wout = "";
waiter.stdout.on("data", (d) => (wout += d));
waiter.stderr.on("data", (d) => (wout += d));
const waiterDone = new Promise((r) => waiter.on("close", r));
await stream2.poll();
await new Promise((r) => setTimeout(r, 400));
lobbyStarted = true;
await stream2.poll();
await waiterDone;
check("game start: the stream writes the indices into teams.json", tj().myIndex === 0 && tj().participants.join() === "T1,T2" && tj().names[1] === "Show Your Work", JSON.stringify(tj()));
check("game start: a scaffold started in the lobby learns its index without restarting", /lobby None 0/.test(wout) && /started 0 2 Show Your Work/.test(wout), wout);

// ---------------------------------------------------------------- the audit
const tr = (...tools) => tools.map((t, i) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: t[0], input: t[1] }] } }));
const sev = (...tools) => { const f = audit(tr(...tools), dir, AID, "luna", { port: 4100 }); return f.some((x) => x.severity === "violation") ? "violation" : f.length ? "warning" : "ok"; };
const bash = (command) => ["Bash", { command }];
const writePy = (content) => ["Write", { file_path: path.join(dir, "follow.py"), content }];
check("audit: python urllib GET of the public API on localhost is fine", sev(bash(`python3 -c "import urllib.request; print(urllib.request.urlopen('${apiBase}/actions?after=0&limit=10').read()[:200])"`)) === "ok");
check("audit: a script following the SSE stream is fine", sev(writePy(`import json, urllib.request\nURL = "${apiBase}/events?after=0"\nfor line in urllib.request.urlopen(URL):\n    if line.startswith(b"data: "):\n        print(json.loads(line[6:]))\n`)) === "ok");
check("audit: a script calling tools/submit.py via subprocess is fine", sev(writePy(`import subprocess\nsubprocess.run(["python3", "tools/submit.py", "flower"])\n`)) === "ok");
check("audit: running such a script in the background is fine", sev(bash("python3 follow.py > follow.log 2>&1 &")) === "ok" && sev(["Bash", { command: "python3 follow.py > follow.log 2>&1", run_in_background: true }]) === "ok");
const { taskDir } = await import("./lib/workspace.js");
check("audit: reading the output file of its own background task is fine", sev(["Read", { file_path: path.join(taskDir(dir), "tasks", "b1.output") }]) === "ok" && sev(bash(`tail ${taskDir(dir)}/tasks/b1.output`)) === "ok");
check("audit: another session's task output is not", sev(["Read", { file_path: path.join(taskDir(dir2), "tasks", "b1.output") }]) === "violation");
check("audit: the game's WebSocket on localhost:4100 is fine, another port's isn't", sev(writePy(`URL = "ws://localhost:4100/api/rooms/R/games/G/ws?after=0"\n`)) === "ok"
  && sev(writePy(`URL = "ws://localhost:5432/"\n`)) === "violation");
check("audit: logging in is a violation", sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:4100/api/auth/dev/login')"`)) === "violation");
check("audit: a POST to the API is a violation", sev(writePy(`import urllib.request\nurllib.request.urlopen(urllib.request.Request("${apiBase}/programs", data=b"{}", method="POST"))\n`)) === "violation");
check("audit: a history query POSTed to the game's query endpoint (this game or the room's) is fine", sev(writePy(`import json, urllib.request\nq = json.dumps({"from": "turns", "limit": 5}).encode()\nreq = urllib.request.Request("${apiBase}/query", data=q, method="POST", headers={"content-type": "application/json"})\nprint(urllib.request.urlopen(req).read())\n`)) === "ok"
  && sev(bash(`curl -s -X POST -H 'content-type: application/json' -d '{"from":"scores"}' http://localhost:4100/api/rooms/R/query`)) === "ok" && sev(bash("curl -s http://localhost:4100/api/query/schema")) === "ok");
check("audit: a POST elsewhere next to a query, or a query with credentials or on another port, is a violation",
  sev(writePy(`import urllib.request\nurllib.request.urlopen(urllib.request.Request("${apiBase}/query", data=b"{}"))\nurllib.request.urlopen(urllib.request.Request("${apiBase}/programs", data=b"{}"))\n`)) === "violation"
  && sev(bash(`curl -s -X POST -H 'Authorization: Bearer x' -d '{}' ${apiBase}/query`)) === "violation" && sev(bash(`curl -s -X POST -d '{}' http://localhost:4000/api/rooms/R/games/G/query`)) === "violation"
  && sev(writePy(`import urllib.request\nurllib.request.urlopen(urllib.request.Request(API + "/query", data=b"{}"))\n`)) === "violation");
check("audit: credentials in a request are a violation", sev(writePy(`import urllib.request\nreq = urllib.request.Request("${apiBase}", headers={"Authorization": "Bearer x"})\n`)) === "violation");
check("audit: another port (the database, another server) is a violation", sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:3401/api/rooms/X')"`)) === "violation"
  && sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:4000/api/rooms/X')"`)) === "violation");
check("audit: another host is a violation", sev(bash(`python3 -c "import urllib.request; urllib.request.urlopen('https://example.com/')"`)) === "violation");
check("audit: raw sockets are a violation", sev(writePy(`import socket\ns = socket.socket()\n`)) === "violation");
check("audit: curl is a violation unless it reads the public API", sev(bash(`curl -s ${apiBase}/actions?after=0`)) === "ok" && sev(bash(`curl -s -X POST ${apiBase}/programs -d '{}'`)) === "violation");
check("audit: writing to stream/ is a violation", sev(["Write", { file_path: path.join(dir, "stream/actions.jsonl"), content: "" }]) === "violation"
  && sev(bash("echo x >> stream/actions.jsonl")) === "violation" && sev(writePy(`open("stream/actions.jsonl", "w").write("")\n`)) === "violation"
  && sev(writePy(`open("stream/history.jsonl", "a").write("")\n`)) === "violation" && sev(bash("truncate -s 0 stream/history.jsonl")) === "violation");
check("audit: reading stream/ is fine", sev(bash("tail -n 5 stream/actions.jsonl")) === "ok" && sev(writePy(`for l in open("stream/actions.jsonl"):\n    pass\n`)) === "ok" && sev(bash("cp stream/actions.jsonl copy.jsonl")) === "ok");
check("audit: paths outside the workspace are violations", sev(bash("cat /etc/hostname")) === "violation" && sev(["Read", { file_path: "/etc/hostname" }]) === "violation" && sev(bash("ls ../")) === "violation");
check("audit: another team's workspace is a violation", sev(bash(`cat ${root}/${AID}/tess/flower.py`.replace(root, "/home/user/arena-ws"))) === "violation");
// mesa-a game 2: Mallory was stopped (and lost a session) for `cd <arena>/tools`, her own tools/ with "mallory/" left out:
// a path that names nothing in the arena's folder (no team's folder, not the runner's) is a warning, never a stop.
// Another team's folder, the runner's files, a glob over the arena, the arena's folder itself and anything outside the
// arena stay violations, whether named by cd, a path, a Read or written code.
const A = path.join(root, AID);
const mallory = `cd ${A}/tools && python3 -c "\nimport garden; ts=garden.turns(); print(len(ts), garden.MY_INDEX)"; wc -l ../stream/history.jsonl`;
const stops = (...tools) => audit(tr(...tools), dir, AID, "luna", { port: 4100 }).filter((f) => f.severity === "violation");
check("audit: a mistyped path into the arena's folder (no team's folder) is a warning, not a stop",
  sev(bash(mallory)) === "warning" && stops(bash(mallory)).length === 0 && sev(["Read", { file_path: `${A}/tools/garden.py` }]) === "warning"
  && sev(["Glob", { pattern: `${A}/tools/*.py` }]) === "warning", JSON.stringify(audit(tr(bash(mallory)), dir, AID, "luna", { port: 4100 })));
check("audit: the same shapes into another team's folder or outside the arena are violations, and stop the session",
  sev(bash(`cd ${A}/tess && cat flower.py`)) === "violation" && sev(bash("cat ../tess/flower.py")) === "violation" && sev(bash("cat /home/user/nowhere/x")) === "violation"
  && sev(["Read", { file_path: `${A}/tess/flower.py` }]) === "violation" && sev(["Glob", { pattern: "../*/flower.py" }]) === "violation"
  && stops(bash(`cd ${A}/tess && cat flower.py`)).length > 0);
// mesa-a game 4: Tobi's session busy-waited for 150 s (a sleep substitute), taking a core from the garden's flowers. A
// busy-wait or a deliberate CPU burn outside the team's programs is a warning (told to the session, logged), never a stop;
// sleeping is fine, and so is a busy loop in its own flower (its work, timed against its R).
const spins = (...tools) => audit(tr(...tools), dir, AID, "luna", { port: 4100 }).filter((f) => /^busy-wait/.test(f.detail));
check("audit: a busy-wait in a command or a script is a warning, never a stop; sleeping and the team's own flower are fine",
  spins(bash(`python3 -c "\nimport time\nt=time.time()\nwhile time.time()-t<150: pass\n"`)).length === 1 && stops(bash(`python3 -c "import time; t=time.time(); while time.time()-t<150: pass"`)).length === 0
  && spins(writePy("import time\nend = time.perf_counter() + 30\nwhile time.perf_counter() < end:\n    pass\n")).length === 1 && spins(bash("while true; do :; done")).length === 1
  && spins(writePy("for i in range(10**9):\n    pass\n")).length === 1 && spins(bash(`python3 -c "import time; time.sleep(30)"`)).length === 0
  && spins(["Write", { file_path: path.join(dir, "flower.py"), content: "import time\ndef flower(c):\n    t = time.process_time()\n    while time.process_time() - t < 0.05:\n        pass\n    return 1, 50\n" }]).length === 0
  && spins(writePy("while time.time() < end:\n    x = step(x)\n")).length === 0);
{ // Under a folder called arena-ws (as /home/user/arena-ws/<arena>/<team> is), where every path naming arena-ws/ is judged.
  const W = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aw-")), "arena-ws", "AR");
  for (const t of ["luna", "tess", "luna-2", ".runner/g1"]) fs.mkdirSync(path.join(W, t), { recursive: true });
  const writeIn = (content) => ["Write", { file_path: path.join(W, "luna", "f.py"), content }];
  const s2 = (...tools) => { const f = audit(tr(...tools), path.join(W, "luna"), "AR", "luna", { port: 4100 }); return f.some((x) => x.severity === "violation") ? "violation" : f.length ? "warning" : "ok"; };
  check("audit (arena-ws): a mistyped arena path is a warning, in a command or in code",
    s2(bash(`cd ${W}/tools && python3 -c "import garden"; wc -l ../stream/history.jsonl`)) === "warning" && s2(writeIn(`P = "arena-ws/AR/nobody/x"\n`)) === "warning"
    && s2(writeIn(`P = "${W}/tools/x.json"\n`)) === "warning");
  check("audit (arena-ws): another team's folder (even one whose name starts with this team's), the runner's files, a glob, the arena's folder and another arena are violations",
    s2(bash(`cat ${W}/tess/flower.py`)) === "violation" && s2(bash(`cat ${W}/luna-2/flower.py`)) === "violation" && s2(bash(`cat ${W}/.runner/g1/actions.jsonl`)) === "violation"
    && s2(bash(`cat ${W}/*/flower.py`)) === "violation" && s2(bash(`ls ${W}`)) === "violation" && s2(bash(`cat ${path.dirname(W)}/BR/luna/flower.py`)) === "violation"
    && s2(writeIn(`P = "arena-ws/AR/tess/flower.py"\n`)) === "violation" && s2(writeIn(`P = "${W}/tess/flower.py"\n`)) === "violation");
  fs.rmSync(path.dirname(path.dirname(W)), { recursive: true, force: true });
}
check("audit: environment and database access are violations", sev(bash("env | head")) === "violation" && sev(bash("psql -c 'select 1'")) === "violation");
check("audit: allowedUrl", allowedUrl(`${apiBase}/events?after=3`) && allowedUrl("http://127.0.0.1:4100/api/rooms/X") && !allowedUrl("http://localhost:4100/api/auth/dev/login") && !allowedUrl("http://localhost:5432/") && !allowedUrl("http://localhost:4000/api/rooms/X"));
check("audit: a Python variable called nc is not netcat; netcat still is", sev(writePy(`nc = sum(1 for x in small if x)\nif nc >= 3 and no <= 0.1 * (nc + no):\n    nc += 1\n`)) === "ok" && sev(writePy(`import os\nos.system("cat f | nc localhost 80")\n`)) === "violation");
check("audit: '..' inside the workspace is fine, leaving it isn't", !escapesWorkspace("cat history/flower/../bee/v1.py", dir) && escapesWorkspace("cat ../../x", dir));
// csig-a game 4: Mallory's lobby was stopped for a ".." in a Python comment inside a heredoc.
const malloryCmd = "python3 - <<'EOF'\nsrc = open(\"bee.py\").read()\no = open(\"orchid.py\").read()\n# take shared recipe code from the orchid (ring .. recipe), minus knight/chain generators\nstart = o.index(\"def ring(\")\nend = o.index(\"def flower(\")\nshared = o[start:end]\na = shared.index(\"JUMPS = \")\nb = shared.index(\"def recipe(\")\nshared = shared[:a] + 'JUMPS = [(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)]\\n\\n\\n' + shared[b:]\n# in the bee, km and chain are checked, not cooked\nshared = shared.replace('    if name == \"km\":\\n        return knight(c)\\n    if name == \"chain\":\\n        return chain(c)\\n', '')\nopen(\"_shared.txt\", \"w\").write(shared)\nprint(len(shared))\nEOF";
const W = (c) => escapesWorkspace(c, dir);
check("audit: '..' in prose (a comment in a python heredoc) isn't a path", !W(malloryCmd) && !W(`python3 - <<'EOF'\n# ring .. recipe\nx = 1  # a .. b\nprint("ring .. recipe", ...)\nEOF`));
check("audit: python's ... and a '..' placeholder aren't paths", !W(`python3 - <<'EOF'\ndef f(x: int) -> int: ...\nk = {a: (x if x else '..') for a in b}\nEOF`) && !W(`python3 -c "print(...)"`));
check("audit: shell comments and echo don't count; shell escapes still do",
  !W(`ls # see .. later`) && !W(`echo ..`) && W(`cd ..`) && W(`cat ../x`) && W(`ls ${dir}/..`) && W(`ln -s .. up`) && W(`ln -s ../../other x`) && W(`python3 tools/try.py flower ../other/flower.py`));
check("audit: escapes in python programs still count (heredoc and -c)",
  W(`python3 - <<'EOF'\nopen("../x").read()\nEOF`) && W(`python3 - <<'EOF'\nimport os\nos.chdir("..")\nEOF`) && W(`python3 - <<'EOF'\nfrom pathlib import Path\nPath("..").iterdir()\nEOF`)
  && W(`python3 -c "import os; os.chdir('..')"`) && W(`python3 - <<'EOF'\nimport os\nos.listdir(os.path.join('.', '..'))\nEOF`) && W(`python3 - <<'EOF'\nos.symlink("../../kenji", "k")\nEOF`)
  && !W(`python3 - <<'EOF'\nopen("history/flower/../bee/v1.py").read()\nEOF`));
check("audit: '..' in a sed replacement isn't a path; a file argument or a non-sed command still is",
  !escapesWorkspace(`cd ${dir}; python3 tools/try.py flower flower.py 5 77 2>&1 | sed -E 's/"edges".*"labels"/../' | cut -c1-60`, dir)
  && !escapesWorkspace(`sed -e "s/x/../g" flower.py`, dir) && !escapesWorkspace(`perl -pe 's#a#../..#' f`, dir)
  && escapesWorkspace(`sed 's/a/b/' ../../x`, dir) && escapesWorkspace(`ls 's/../../'`, dir) && escapesWorkspace(`sed 's/a/b/' 's/../../x'`, dir));

await q("DELETE FROM arena.personas WHERE arena_id = $1", [AID]);
await q("DELETE FROM arena.arenas WHERE id = $1", [AID]);
await pool.end();
fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all workspace checks passed");
process.exit(failed ? 1 : 0);
