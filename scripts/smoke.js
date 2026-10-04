// End-to-end check of the API (one flower per team): plays two short games over HTTP, SSE and WebSocket,
// and verifies the rules and what each viewer can see.
//   BASE=http://localhost:3000 node scripts/smoke.js      (the server must use a dbc_one database)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { WebSocket } from "ws";

const BASE = process.env.BASE || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, method, path, body, { allow = [422] } = {}) {
  const res = await fetch(BASE + "/api" + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${json.error || ""}`);
  return { status: res.status, ...json };
}
const login = async (name) => (await api(null, "POST", "/auth/dev/login", { name })).token;
async function until(what, fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(200);
  }
}
const isEnd = (a) => a.action === "feed" || a.action === "leave";

const stamp = Date.now().toString(36);
const owner = await login("Owner " + stamp);
const room = await api(owner, "POST", "/rooms");
console.log("room", room.url);
const game = await api(owner, "POST", `/rooms/${room.shortId}/games`);
console.log("game", game.url);
const g = `/rooms/${room.shortId}/games/${game.shortId}`;
// Half a minute of game time. Flowers earn change budget fast so the test needn't wait; feeding costs 2
// rounds rather than 10, so bees take turns often. Responses can be any JSON (and big).
await api(owner, "PATCH", `${g}/config`, { config: { minutes: 0.5, feedCost: 2, responseType: "any", budgets: { flower: { perMinute: 600, cap: 100 } } } });

const players = [];
for (const name of ["Ada", "Bo", "Cy", "Di"]) {
  const token = await login(`${name} ${stamp}`);
  const team = await api(token, "POST", `${g}/teams`, { name: `${name}'s hive` });
  players.push({ name, token, team });
}
const mate = await login("Mate " + stamp);
await api(mate, "POST", `${g}/teams/join`, { joinCode: players[0].team.joinCode });

const view0 = await api(players[0].token, "GET", g);
assert.match(view0.interface.flower, /def flower\(challenge\)/);
assert.match(view0.interface.bee, /def first\(\)/);
assert.match(view0.interface.bee, /def decide\(challenge, response\)/);
assert.match(view0.interface.bee, /def fed\(nectar\)/);
assert.match(view0.interface.bee, /MEMORY/);
assert.doesNotMatch(view0.interface.bee + view0.interface.flower, /HISTORY\./, "programs get no history");
assert.equal(view0.game.config.budgets.bee.memory, 50);
assert.equal(view0.game.config.maxResponseBytes, 1048576);
assert.deepEqual(["flower", "bee"].map((k) => view0.game.config.budgets[k].ms), [150, 50], "every time limit is public");
assert.deepEqual(view0.teams.map((t) => t.ready), view0.teams.map(() => ({ flower: false, bee: false })));

const flower = (a, b, pct) => `def flower(challenge):\n    return (challenge * ${a} + ${b}) % 1000, ${pct}\n`;
// Cy's flower answers the challenge 7 (which Cy's own bee asks) with a response over 4 KB.
const bigFlower = `def flower(challenge):\n    if challenge == 7:\n        return list(range(2000)), 90\n    return (challenge * 7 + 3) % 1000, 90\n`;
// A bee that feeds every other turn (it counts its turns in MEMORY); after a feed, fed() adds up the
// nectar it got, and prints it.
const bee = (q) => `def first():
    return ${q}
def decide(challenge, response):
    n = MEMORY["n"] = MEMORY.get("n", 0) + 1
    return ("feed" if n % 2 else "leave"), ${q}
def fed(nectar):
    MEMORY["eaten"] = MEMORY.get("eaten", 0) + int(nectar)
    print("fed", int(nectar))
`;
const variants = [
  { flower: flower(3, 1, 30), bee: bee(42) },
  { flower: flower(5, 2, 60), bee: bee(500) },
  { flower: bigFlower, bee: bee(7) },
];
for (const [i, p] of players.slice(0, 3).entries()) {
  for (const kind of ["flower", "bee"]) {
    const r = await api(p.token, "POST", `${g}/programs`, { kind, code: variants[i][kind] });
    assert.ok(r.ok, `${p.name} ${kind}: ${r.errors}`);
    assert.equal(r.cost, 0, "writing programs before the start is free");
  }
}
// Di writes only a flower, so Di's team sits the game out.
await api(players[3].token, "POST", `${g}/programs`, { kind: "flower", code: flower(1, 1, 50) });
for (const [kind, code, err] of [["flower", "x = 1\n", /must define flower/], ["bee", "def first():\n    return 1\n", /must define first\(\) and decide/],
  ["bee", flower(1, 1, 1), /must define first/], ["cosmos", "x", null]]) {
  const r = await api(players[0].token, "POST", `${g}/check`, { kind, code }, { allow: [400] });
  if (!err) { assert.equal(r.status, 400, "cosmos is not a program any more"); continue; }
  assert.equal(r.ok, false, `${kind} without its entry points`);
  assert.match(r.errors.join(), err);
}
const big = await api(players[0].token, "POST", `${g}/check`, { kind: "flower", code: "def flower(c):\n" + "    c = c + 1\n".repeat(400) + "    return c, 1\n" });
assert.equal(big.ok, false);
assert.match(big.errors[0], /Too big: \d+ nodes > budget 1100/);
const tf = await api(players[0].token, "POST", `${g}/try`, { kind: "flower", code: variants[0].flower, challenges: [1, 2, 500] });
assert.deepEqual(tf.results.map((x) => [x.r, x.percent]), [[4, 30], [7, 30], [501, 30]]);
assert.ok(tf.results.every((x) => x.energy > 0 && typeof x.ms === "number"));
// Every call's clock starts at 0 (as if at the Unix epoch): a program can time itself, not the world.
const clock = await api(players[0].token, "POST", `${g}/try`, { kind: "flower", challenges: [1, 2],
  code: `import time\ndef flower(c):\n    return [round(time.time() * 1000, 3), time.gmtime()[0]], 50\n` });
assert.ok(clock.results.every((x) => x.r[0] >= 0 && x.r[0] < 20 && x.r[1] === 1970), JSON.stringify(clock.results));
const tb = await api(players[0].token, "POST", `${g}/try`, { kind: "bee", code: variants[0].bee, rounds: 60 });
assert.ok(tb.actions.length > 10 && tb.actions.every((a) => a.bee === players[0].team.id && a.flower === players[0].team.id));
assert.ok(tb.feeds > 0 && tb.nectar > 0 && tb.pollen > 0);

// Only the owner starts it; the clock and the change budgets start with it.
assert.equal((await api(players[0].token, "POST", `${g}/start`, null, { allow: [403] })).status, 403);
const started = await api(owner, "POST", `${g}/start`);
assert.equal(started.participants.length, 3);
const [ada, bo, cy] = players.slice(0, 3).map((p) => p.team.id);
assert.deepEqual(started.participants, [ada, bo, cy]);
const lateTeam = await api(await login("Late " + stamp), "POST", `${g}/teams`, { name: "Late" }, { allow: [409] });
assert.equal(lateTeam.status, 409, "teams can't join a running game");

// Every turn is public as it happens: the arrival, the challenge, the response and whether the bee fed;
// a feed's percent, energy, nectar and pollen too.
const seen = await until("turns", async () => {
  const a = await api(players[1].token, "GET", `${g}/actions?limit=5000`);
  const ends = a.actions.filter(isEnd);
  return ends.filter((x) => x.action === "feed").length >= 6 && ends.filter((x) => x.action === "leave").length >= 6
    && ends.some((x) => x.flower === bo) && ends.some((x) => x.flower !== bo && x.action === "leave") && a;
});
const ends = seen.actions.filter(isEnd);
const adaTurn = ends.find((a) => a.bee === ada);
assert.equal(adaTurn.c, 42, "Bo sees Ada's bee's challenge");
assert.equal(typeof adaTurn.r, "number");
for (const a of ends) {
  assert.ok("c" in a && "r" in a && a.pollen !== undefined);
  if (a.action === "feed") {
    assert.ok(a.energy > 0 && a.nectar > 0 && a.pollen > 0, "a feed is public in full");
    assert.ok(Math.abs(a.nectar + a.pollen - a.energy) < 1e-6 * a.energy);
    assert.ok(Math.abs(a.nectar - (a.percent / 100) * a.energy) < 1e-6 * a.energy);
  } else {
    assert.equal(a.pollen, 0, "a turn without a feed pays nobody");
    assert.ok(!("nectar" in a));
    assert.equal("percent" in a, a.flower === bo, "an unfed turn's percent: the flower's team only");
    assert.equal("energy" in a, a.flower === bo);
  }
  assert.equal("ms" in a, a.flower === bo, "the flower's CPU time: its own team only");
  assert.equal("beeMs" in a, a.bee === bo, "the bee's decision time: its own team only");
  assert.ok(a.bee === bo || !("log" in a), "what a bee prints stays with its team");
}
assert.ok(ends.some((a) => a.flower === bo && typeof a.ms === "number" && typeof a.percent === "number"));
// Lockstep rounds: one turn per bee per round; arrivals at the round's start, the end at 150 ms.
const turns = new Map();
for (const a of seen.actions) {
  if (a.action === "arrive") assert.equal(a.atMs, (a.round - 1) * 200);
  else assert.equal(a.atMs, (a.round - 1) * 200 + 150);
  const k = `${a.bee}:${a.turn}`;
  if (!turns.has(k)) turns.set(k, []);
  turns.get(k).push(a);
}
const rounds = new Set();
for (const acts of turns.values()) {
  assert.equal(acts[0].action, "arrive");
  if (acts[1]) assert.ok(isEnd(acts[1]) && acts[1].round === acts[0].round && acts[1].flower === acts[0].flower);
  assert.ok(!rounds.has(`${acts[0].bee}:${acts[0].round}`), "one turn per bee per round");
  rounds.add(`${acts[0].bee}:${acts[0].round}`);
}
const spectator = (await api(null, "GET", `${g}/actions?limit=5000`)).actions;
assert.ok(spectator.length >= seen.actions.length, "spectators see every turn too");
assert.ok(spectator.every((a) => !("ms" in a) && !("beeMs" in a) && !("log" in a) && !("beeVersion" in a) && !("flowerVersion" in a)));
assert.ok(spectator.filter((a) => a.action === "leave").every((a) => !("percent" in a) && a.pollen === 0));
assert.ok(spectator.filter((a) => a.action === "feed").every((a) => typeof a.nectar === "number" && typeof a.percent === "number"));
const latest = await api(null, "GET", `${g}/actions?before=${seen.lastSeq + 1}&limit=5`);
assert.deepEqual(latest.actions.map((a) => a.seq), [4, 3, 2, 1, 0].map((i) => seen.lastSeq - i));
const mineOnly = await api(players[0].token, "GET", `${g}/actions?mine=1&limit=5000`);
assert.ok(mineOnly.actions.length && mineOnly.actions.every((a) => a.bee === ada || a.flower === ada));
assert.equal((await api(null, "GET", `${g}/actions?mine=1`, null, { allow: [403] })).status, 403);
// What fed() printed shows up with the bee's next turn: the nectar of the feed before.
const adaLogs = async () => (await api(players[0].token, "GET", `${g}/actions?limit=5000`)).actions.filter((a) => a.bee === ada && /fed \d+/.test(a.log || ""));
const logs = await until("Ada's bee's fed() to print", async () => { const l = await adaLogs(); return l.length >= 2 && l; });
assert.ok(logs.every((a) => Number(a.log.match(/fed (\d+)/)[1]) > 0));

// A response over 4 KB: actions (pages and live feeds) carry its size, SHA-256 and first 4 KB; the whole
// response is one request away, for anyone.
const bigTurn = await until("a big response", async () => (await api(null, "GET", `${g}/actions?limit=5000`)).actions.find((a) => isEnd(a) && a.rPreview));
const bigText = JSON.stringify(Array.from({ length: 2000 }, (_, i) => i));
assert.deepEqual([bigTurn.r, bigTurn.rBytes, bigTurn.rHash, bigTurn.rPreview], [null, bigText.length, crypto.createHash("sha256").update(bigText).digest("hex"), bigText.slice(0, 4096)]);
const whole = await fetch(BASE + `/api${g}/responses/${bigTurn.seq}`);
assert.equal(whole.status, 200);
assert.match(whole.headers.get("content-type"), /application\/json/);
assert.equal(await whole.text(), bigText, "the whole response, by seq");
const smallTurn = ends.find((a) => a.r !== null);
assert.equal(await (await fetch(BASE + `/api${g}/responses/${smallTurn.seq}`)).text(), JSON.stringify(smallTurn.r), "a small one too");
assert.equal((await fetch(BASE + `/api${g}/responses/${seen.actions.find((a) => a.action === "arrive").seq}`)).status, 404, "an arrival has none");

// Pollen carries genes: each feed's grain of the answering flower's minified code goes to the feeding bee's
// team (Bo sees its own bee's), and to nobody else during play.
const grainLen = (pollen) => Math.floor(Math.cbrt(pollen) + 1e-9);
const boFeeds = seen.actions.filter((a) => a.action === "feed");
assert.ok(boFeeds.some((a) => a.bee === bo) && boFeeds.some((a) => a.bee !== bo));
for (const a of boFeeds) {
  if (a.bee !== bo) { assert.ok(!("grain" in a), "another team's grain is hidden"); continue; }
  if (a.pollen < 1) continue;
  assert.equal(a.grain.length, Math.min(grainLen(a.pollen), a.grainCodeLength), `${a.pollen} pollen`);
  assert.ok(Number.isInteger(a.grainVersion) && a.grainCodeLength > 0);
}
assert.ok(spectator.every((a) => !("grain" in a)), "a spectator sees no grains");

// The team ledger: every finished turn, with the team's private details.
const boLedger = await api(players[1].token, "GET", `${g}/ledger?limit=5000`);
assert.deepEqual(boLedger.participants, [ada, bo, cy]);
assert.equal(boLedger.team, 1);
const boActions = new Map((await api(players[1].token, "GET", `${g}/actions?limit=5000`)).actions.filter(isEnd).map((a) => [a.seq, a]));
assert.ok(boLedger.entries.length >= ends.length);
for (const e of boLedger.entries) {
  const a = boActions.get(e.seq);
  if (!a) continue; // written after the actions page was read
  assert.deepEqual([e.bee, e.flower, e.challenge, e.response, e.fed, e.round], [boLedger.participants.indexOf(a.bee), boLedger.participants.indexOf(a.flower), a.c, a.r, a.action === "feed", a.round]);
  assert.equal(e.percent === null, !e.fed && e.flower !== 1, "percent: public on a feed, else Bo's own flower");
  assert.equal(e.ms === null, e.flower !== 1, "ms: Bo's own flower only");
  assert.equal(e.nectar === null, !e.fed);
  assert.equal(e.pollen, e.fed ? a.pollen : 0);
}
assert.ok(boLedger.entries.every((e) => (e.beeMs === null) === (e.bee !== 1) || e.beeError), "beeMs: Bo's own bee only");
const publicLedger = await api(null, "GET", `${g}/ledger?limit=5000`);
assert.equal(publicLedger.team, null);
assert.ok(publicLedger.entries.every((e) => e.ms === null && e.beeMs === null && (e.fed || e.percent === null)));

// Querying history: the same records, through the query endpoint, filtered for the viewer.
const q = (token, body, roomLevel = false) => api(token, "POST", roomLevel ? `/rooms/${room.shortId}/query` : `${g}/query`, body, { allow: [400] });
const schema = await api(null, "GET", "/query/schema");
assert.deepEqual(Object.keys(schema.entities), ["turns", "versions", "teams", "pairs", "scores"]);
const boTurns = await q(players[1].token, { from: "turns", limit: 5000 });
assert.ok(boTurns.rows.length >= boLedger.entries.length - 3 && boTurns.rows.every((t) => (t.ms === null) === (t.flower !== 1)));
const boByFlower = await q(players[1].token, { from: "turns", scope: "myBee", where: [{ field: "fed", op: "eq", value: true }], groupBy: ["flower"],
  aggregates: [{ fn: "count", as: "feeds" }, { fn: "sum", field: "nectar", as: "nectar" }] });
assert.ok(boByFlower.rows.length && boByFlower.rows.every((r) => r.feeds > 0 && r.nectar >= 0));
const hidden = await q(null, { from: "turns", where: [{ field: "fed", op: "eq", value: false }], aggregates: [{ fn: "sum", field: "percent", as: "p" }, { fn: "count", field: "ms", as: "ms" }] });
assert.deepEqual(hidden.rows, [{ p: null, ms: 0 }], "a spectator's aggregates see no private field");
const upTo = Math.max(...boTurns.rows.map((t) => t.round)); // the game runs on: compare the same rounds
const mineP = await q(players[1].token, { from: "turns", where: [{ field: "fed", op: "eq", value: false }, { field: "round", op: "le", value: upTo }],
  aggregates: [{ fn: "count", field: "percent", as: "n" }] });
const unfedP = boTurns.rows.filter((t) => !t.fed && t.percent !== null);
assert.ok(unfedP.every((t) => t.flower === 1), "unfed percents: Bo's own flower's only");
assert.equal(mineP.rows[0].n, unfedP.length, "and the aggregate counts exactly those");
assert.deepEqual((await q(null, { from: "versions" })).rows, [], "nobody else's versions during play");
assert.equal((await q(players[1].token, { from: "versions" })).rows.length, 2, "your own");
assert.match((await q(null, { from: "turns", where: [{ field: "challenge", op: "lt", value: 3 }] })).error, /takes eq, ne, in, isNull/);
assert.deepEqual((await q(null, { from: "scores" }, true)).rows, [], "the room's finished games: none yet");
const client = await fetch(BASE + "/vendor/query/history.py");
assert.equal(client.status, 200);
assert.match(await client.text(), /def connect\(/, "the generated Python client is served");

// MEMORY: your own bee's during play (read only), nobody else's.
const ownView = await until("Bo's bee's memory", async () => { const v = await api(players[1].token, "GET", g); const m = v.teams.find((t) => t.id === bo).memory?.value; return m?.n > 2 && m.eaten > 0 && v; });
const boMemory = ownView.teams.find((t) => t.id === bo).memory;
assert.deepEqual([boMemory.cap, boMemory.version, typeof boMemory.bytes, boMemory.error], [50, 1, "number", null]);
assert.ok(boMemory.bytes <= 50);
assert.ok(ownView.teams.filter((t) => t.id !== bo).every((t) => t.memory === null), "other teams' memory is hidden");
assert.ok((await api(null, "GET", g)).teams.every((t) => t.memory === null), "and a spectator sees none");
const boTeamRows = (await q(players[1].token, { from: "teams" })).rows;
assert.ok(boTeamRows.every((t) => (t.index === 1) === (t.memory !== null)));
// Nobody can write it: the try tool's memory is the test bee's alone, and no other endpoint takes one.
const tried = await api(players[1].token, "POST", `${g}/try`, { kind: "bee", code: variants[1].bee, rounds: 20, memory: { n: 1000, from: "try" } });
assert.ok(tried.memory.value.n > 1000 && tried.memory.value.from === "try", "the test bee started from the memory it was given");
await api(players[1].token, "POST", `${g}/programs`, { kind: "bee", code: variants[1].bee, memory: { from: "submit" } });
await api(players[1].token, "POST", `${g}/check`, { kind: "bee", code: variants[1].bee, memory: { from: "check" } });
await sleep(600);
const after1 = (await api(players[1].token, "GET", g)).teams.find((t) => t.id === bo).memory;
assert.ok(!("from" in after1.value) && after1.value.n < 1000, `Bo's game bee's memory is its own: ${JSON.stringify(after1.value)}`);
assert.equal((await api(players[1].token, "POST", `${g}/try`, { kind: "bee", code: variants[1].bee, memory: { pad: "x".repeat(60) } }, { allow: [400] })).status, 400,
  "a test memory over the cap is refused");
assert.match((await api(players[1].token, "POST", `${g}/try`, { kind: "bee", code: variants[1].bee, memory: { list: [1] } }, { allow: [400] })).error, /is a list/,
  "and one that isn't a key-value store");

// The scoreboard and the ledgers are live and public.
const board = await api(null, "GET", `${g}/scores`);
assert.equal(board.scores.length, 3);
for (const s of board.scores) {
  for (const k of ["pollination", "forage", "pollinationShare", "forageShare", "fitness", "pollen"]) assert.equal(typeof s[k], "number", `${k} is public`);
  for (const k of ["allure", "allureShare", "surplusShare", "surplus"]) assert.ok(!(k in s), `${k} is no longer a score term`);
}
assert.ok(board.scores.reduce((x, s) => x + s.pollen, 0) > 0);
assert.ok(board.ledgers.nectar.flat().every((x) => typeof x === "number") && board.ledgers.pollen.flat().every((x) => typeof x === "number"));
const sum = (m) => m.flat().reduce((x, y) => x + y, 0);
assert.ok(sum(board.ledgers.feeds) > 0 && sum(board.ledgers.nectar) > 0);

// Changes cost change budget, which accrues with game time; a change goes live at once. During play a team
// sees only its own versions and budgets.
const view1 = await api(players[1].token, "GET", g);
const adaTeam = view1.teams.find((t) => t.id === ada);
assert.equal(adaTeam.programs, null, "other teams' code changes are hidden during play");
assert.equal(adaTeam.banks, null, "so are their change budgets");
assert.equal(view1.myTeam.index, 1);
assert.deepEqual(view1.teams.map((t) => t.index), [0, 1, 2, null]);
const own = (await api(players[0].token, "GET", g)).teams.find((t) => t.id === ada);
assert.equal(own.programs.flower.length, 1);
assert.ok("bank" in own.banks.flower && "bank" in own.banks.bee);
const rewrite = await api(players[0].token, "POST", `${g}/programs`, { kind: "flower", code: `def flower(c):\n    return len("${"ab".repeat(80)}") + c, 30\n` });
assert.equal(rewrite.ok, false);
assert.match(rewrite.errors.join(), /Not enough change budget: this change costs \d+ nodes/);
const small = flower(3, 9, 30); // one byte changed: costs 1 node
const versionBefore = (await api(players[1].token, "GET", g)).game.version;
const r1 = await until("flower budget", async () => {
  const r = await api(players[0].token, "POST", `${g}/programs`, { kind: "flower", code: small });
  return r.ok && r;
});
assert.equal(r1.cost, 1);
assert.equal(r1.version, 2);
assert.ok(r1.atMs > 0, "the reply says when it went live");
const free = await api(players[0].token, "POST", `${g}/programs`, { kind: "flower", code: "# same thing, explained\n" + small.replaceAll("challenge", "question") });
assert.ok(free.ok && free.cost === 0, "comments, formatting and renames are free");
assert.equal((await api(players[1].token, "GET", g)).game.version, versionBefore, "a submission doesn't announce itself");
await until("the new flower to answer", async () => {
  const a = await api(players[0].token, "GET", `${g}/actions?after=${seen.lastSeq}&limit=5000`);
  return a.actions.some((x) => x.flower === ada && x.flowerVersion >= 2 && isEnd(x) && x.r === (x.c * 3 + 9) % 1000);
});

// A live stream over SSE: arrivals and turns, filtered for the viewer (a spectator here).
const stream = await fetch(BASE + `/api${g}/events?after=0`);
const reader = stream.body.getReader();
let text = "";
while (!/"action":"(feed|leave)"/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
reader.cancel();
assert.match(text, /"action":"arrive"/, "arrivals come over the stream");
assert.doesNotMatch(text, /"beeMs"|"ms":/, "a spectator's stream has no timings");

// The same feed over a WebSocket: the same messages, filtered for the viewer (a Bearer token here).
const socketFeed = (query, token, enough) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/api${g}/ws?${query}`, { headers: token ? { authorization: "Bearer " + token } : {} });
  const msgs = [];
  const t = setTimeout(() => { ws.terminate(); reject(new Error(`socket: timed out with ${msgs.length} messages`)); }, 15000);
  ws.on("message", (d) => {
    msgs.push(JSON.parse(String(d)));
    if (enough(msgs)) { clearTimeout(t); ws.close(); resolve(msgs); }
  });
  ws.on("unexpected-response", (_req, res) => { clearTimeout(t); reject(new Error(`socket refused: ${res.statusCode}`)); });
  ws.on("error", (e) => { clearTimeout(t); reject(e); });
});
const actionsOf = (msgs) => msgs.flatMap((m) => m.actions || []);
const caughtUp = (msgs) => {
  const target = msgs.find((m) => typeof m.lastSeq === "number")?.lastSeq;
  const got = actionsOf(msgs);
  return target !== undefined && got.length > 0 && got.at(-1).seq >= target;
};
const boSocket = await socketFeed("after=0", players[1].token, caughtUp);
assert.equal(typeof boSocket[0].version, "number", "it opens with the game's version");
const boActs = actionsOf(boSocket);
assert.deepEqual(boActs.map((a) => a.seq), boActs.map((_, i) => i + 1), "every action from the start, in order");
assert.ok(boActs.filter(isEnd).every((a) => ("ms" in a) === (a.flower === bo) && ("beeMs" in a) === (a.bee === bo)), "Bo's own timings only");
const boHttp = (await api(players[1].token, "GET", `${g}/actions?after=0&limit=${boActs.length}`)).actions;
assert.deepEqual(boActs, boHttp, "exactly what the HTTP API shows Bo");
assert.ok(boActs.some((a) => a.rPreview) && boActs.filter((a) => a.rPreview).every((a) => a.r === null && a.rPreview.length === 4096), "big responses come as previews");
const watching = actionsOf(await socketFeed("after=0", null, caughtUp));
assert.ok(watching.length && watching.every((a) => !("ms" in a) && !("beeMs" in a)), "a spectator: no timings");
assert.ok(watching.filter((a) => a.action === "leave").every((a) => !("percent" in a)));
const resumeFrom = boActs[Math.floor(boActs.length / 2)].seq;
const resumed = actionsOf(await socketFeed(`after=${resumeFrom}`, null, (m) => actionsOf(m).length > 0));
assert.equal(resumed[0].seq, resumeFrom + 1, "?after= resumes right after it");

// The owner pauses: the clock stops. Resumes, then finishes early: everything is revealed.
assert.equal((await api(players[0].token, "POST", `${g}/status`, { action: "pause" }, { allow: [403] })).status, 403);
await api(owner, "POST", `${g}/status`, { action: "pause" });
await sleep(800);
const p1 = (await api(owner, "GET", g)).game.clockMs;
await sleep(800);
const p2 = (await api(owner, "GET", g)).game;
assert.equal(p2.status, "paused");
assert.equal(p2.clockMs, p1, "the clock stands still while paused");
await api(owner, "POST", `${g}/status`, { action: "resume" });
await until("the clock to move", async () => (await api(owner, "GET", g)).game.clockMs > p1);
await api(owner, "POST", `${g}/status`, { action: "finish" });
const done = await until("finish", async () => { const v = await api(players[1].token, "GET", g); return v.game.status === "finished" && v; });
assert.ok(done.game.revealed);
const adaAfter = done.teams.find((t) => t.id === ada);
assert.ok(adaAfter.programs.flower[2].code.startsWith("# same thing"));
assert.deepEqual(adaAfter.programs.flower.map((v) => v.cost), [0, 1, 0], "once it's over, everyone sees every change");
assert.ok("bank" in adaAfter.banks.flower);
// The round in progress when the owner finished it is written with the garden's last flush.
const lastSeq = async () => (await api(owner, "GET", g)).game.lastSeq;
let settled = await lastSeq();
for (let i = 0; i < 10; i++) { await sleep(300); const s = await lastSeq(); if (s === settled) break; settled = s; }
await sleep(600);
assert.equal(await lastSeq(), settled, "nothing happens after the end");
const after = (await api(null, "GET", `${g}/actions?limit=5000`)).actions;
assert.ok(after.every((a) => "beeVersion" in a && "flowerVersion" in a), "a spectator sees every version");
assert.ok(after.filter(isEnd).every((a) => "ms" in a && "beeMs" in a && "percent" in a && "energy" in a), "and every timing, percent and energy");
assert.ok(after.some((a) => a.bee === ada && /fed \d+/.test(a.log || "")), "prints are revealed");
assert.ok(done.teams.filter((t) => t.participant).every((t) => t.memory && typeof t.memory.value === "object"), "every bee's MEMORY is revealed");
const allGrains = after.filter((a) => a.action === "feed" && a.pollen >= 1);
assert.ok(allGrains.length && allGrains.every((a) => typeof a.grain === "string" && a.grain.length > 0), "every grain is revealed");
const lens = allGrains.map((a) => a.grain.length).sort((x, y) => x - y);
console.log(`grains: ${lens.length}, ${lens[0]}–${lens.at(-1)} characters (median ${lens[lens.length >> 1]}); flower code lengths ${[...new Set(allGrains.map((a) => a.grainCodeLength))].sort((x, y) => x - y).join(", ")}`);
const roomQuery = await api(null, "POST", `/rooms/${room.shortId}/query`, { from: "turns", groupBy: ["game"], aggregates: [{ fn: "count", as: "n" }, { fn: "count", field: "ms", as: "timed" }] });
assert.equal(roomQuery.rows.length, 1, "the finished game, across the room");
assert.ok(roomQuery.rows[0].n > 0 && roomQuery.rows[0].timed > 0, "fully revealed");
const finalLedger = await api(null, "GET", `${g}/ledger?limit=5000`);
assert.ok(finalLedger.entries.length && finalLedger.entries.every((e) => e.ms !== null || e.response === null));
assert.ok(done.scores.length === 3 && done.scores.every((s) => Number.isFinite(s.fitness)));
const totalFitness = done.scores.reduce((x, s) => x + s.fitness, 0);
console.log("game 1:", done.scores.map((s) => `${done.teams.find((t) => t.id === s.teamId).name} ${s.fitness.toFixed(2)}`).join(", "), `(sum ${totalFitness.toFixed(2)})`);

// A second game runs out its clock by itself.
const g2r = await api(owner, "POST", `/rooms/${room.shortId}/games`, { config: { minutes: 0.1 } });
const g2 = `/rooms/${room.shortId}/games/${g2r.shortId}`;
for (const [i, p] of players.slice(0, 2).entries()) {
  await api(p.token, "POST", `${g2}/teams`, { name: p.name });
  for (const kind of ["flower", "bee"]) await api(p.token, "POST", `${g2}/programs`, { kind, code: variants[i][kind] });
}
await api(owner, "POST", `${g2}/start`);
const end2 = await until("game 2 to end", async () => { const v = await api(owner, "GET", g2); return v.game.status === "finished" && v; }, 20000);
assert.equal(end2.game.clockMs, 6000, `ended at ${end2.game.clockMs} ms`);
assert.equal(end2.game.round, 30, "6 s of 200 ms rounds");
console.log(`game 2 ran ${end2.game.lastSeq} actions in ${end2.game.round} rounds, ${end2.game.clockMs} ms of game time`);
console.log("smoke ok");
