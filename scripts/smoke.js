// End-to-end check of the API (one flower per team): plays two short games over HTTP, SSE and WebSocket,
// and verifies the rules and what each viewer can see.
//   BASE=http://localhost:3000 node scripts/smoke.js      (the server must use a dbc_one database)
import assert from "node:assert/strict";
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
// rounds rather than 10, so bees take turns often.
await api(owner, "PATCH", `${g}/config`, { config: { minutes: 0.5, feedCost: 2, budgets: { flower: { perMinute: 600, cap: 100 } } } });

const players = [];
for (const name of ["Ada", "Bo", "Cy", "Di"]) {
  const token = await login(`${name} ${stamp}`);
  const team = await api(token, "POST", `${g}/teams`, { name: `${name}'s hive` });
  players.push({ name, token, team });
}
const mate = await login("Mate " + stamp);
await api(mate, "POST", `${g}/teams/join`, { joinCode: players[0].team.joinCode });

const view0 = await api(players[0].token, "GET", g);
assert.match(view0.interface.flower, /def flower\(challenge, ledger\)/);
assert.match(view0.interface.bee, /def first\(ledger\)/);
assert.match(view0.interface.bee, /def decide\(challenge, response, ledger\)/);
assert.deepEqual(["flower", "bee"].map((k) => view0.game.config.budgets[k].ms), [150, 50], "every time limit is public");
assert.deepEqual(view0.teams.map((t) => t.ready), view0.teams.map(() => ({ flower: false, bee: false })));

const flower = (a, b, pct) => `def flower(challenge, ledger):\n    return (challenge * ${a} + ${b}) % 1000, ${pct}\n`;
// A bee that feeds every other turn and now and then prints how much of the ledger it has.
const bee = (q) => `n = 0
def first(ledger):
    return ${q}
def decide(challenge, response, ledger):
    global n
    n += 1
    if n % 3 == 0:
        print("ledger", len(ledger))
    return ("feed" if n % 2 else "leave"), ${q}
`;
const variants = [
  { flower: flower(3, 1, 30), bee: bee(42) },
  { flower: flower(5, 2, 60), bee: bee(500) },
  { flower: flower(7, 3, 90), bee: bee(7) },
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
for (const [kind, code, err] of [["flower", "x = 1\n", /must define flower/], ["bee", "def first(ledger):\n    return 1\n", /must define first\(ledger\) and decide/],
  ["bee", flower(1, 1, 1), /must define first/], ["cosmos", "x", null]]) {
  const r = await api(players[0].token, "POST", `${g}/check`, { kind, code }, { allow: [400] });
  if (!err) { assert.equal(r.status, 400, "cosmos is not a program any more"); continue; }
  assert.equal(r.ok, false, `${kind} without its entry points`);
  assert.match(r.errors.join(), err);
}
const big = await api(players[0].token, "POST", `${g}/check`, { kind: "flower", code: "def flower(c, ledger):\n" + "    c = c + 1\n".repeat(400) + "    return c, 1\n" });
assert.equal(big.ok, false);
assert.match(big.errors[0], /Too big: \d+ nodes > budget 1100/);
const tf = await api(players[0].token, "POST", `${g}/try`, { kind: "flower", code: variants[0].flower, challenges: [1, 2, 500] });
assert.deepEqual(tf.results.map((x) => [x.r, x.percent]), [[4, 30], [7, 30], [501, 30]]);
assert.ok(tf.results.every((x) => x.energy > 0 && typeof x.ms === "number"));
const tb = await api(players[0].token, "POST", `${g}/try`, { kind: "bee", code: variants[0].bee, rounds: 60 });
assert.ok(tb.actions.length > 10 && tb.actions.every((a) => a.bee === players[0].team.id && a.flower === players[0].team.id));
assert.ok(tb.feeds > 0 && tb.nectar > 0 && tb.surplus > 0);

// Only the owner starts it; the clock and the change budgets start with it.
assert.equal((await api(players[0].token, "POST", `${g}/start`, null, { allow: [403] })).status, 403);
const started = await api(owner, "POST", `${g}/start`);
assert.equal(started.participants.length, 3);
const [ada, bo, cy] = players.slice(0, 3).map((p) => p.team.id);
assert.deepEqual(started.participants, [ada, bo, cy]);
const lateTeam = await api(await login("Late " + stamp), "POST", `${g}/teams`, { name: "Late" }, { allow: [409] });
assert.equal(lateTeam.status, 409, "teams can't join a running game");

// Every turn is public as it happens: the arrival, the challenge, the response and whether the bee fed;
// a feed's percent, energy, nectar and surplus too.
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
  assert.ok("c" in a && "r" in a && a.surplus !== undefined);
  if (a.action === "feed") {
    assert.ok(a.energy > 0 && a.nectar > 0 && a.surplus > 0, "a feed is public in full");
    assert.ok(Math.abs(a.nectar + a.surplus - a.energy) < 1e-6 * a.energy);
    assert.ok(Math.abs(a.nectar - (a.percent / 100) * a.energy) < 1e-6 * a.energy);
  } else {
    assert.equal(a.surplus, 0, "a turn without a feed pays nobody");
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
assert.ok(spectator.filter((a) => a.action === "leave").every((a) => !("percent" in a) && a.surplus === 0));
assert.ok(spectator.filter((a) => a.action === "feed").every((a) => typeof a.nectar === "number" && typeof a.percent === "number"));
const latest = await api(null, "GET", `${g}/actions?before=${seen.lastSeq + 1}&limit=5`);
assert.deepEqual(latest.actions.map((a) => a.seq), [4, 3, 2, 1, 0].map((i) => seen.lastSeq - i));
const mineOnly = await api(players[0].token, "GET", `${g}/actions?mine=1&limit=5000`);
assert.ok(mineOnly.actions.length && mineOnly.actions.every((a) => a.bee === ada || a.flower === ada));
assert.equal((await api(null, "GET", `${g}/actions?mine=1`, null, { allow: [403] })).status, 403);
// The bee's prints show it reading the ledger as it grows.
const adaLogs = async () => (await api(players[0].token, "GET", `${g}/actions?limit=5000`)).actions.filter((a) => a.bee === ada && /ledger \d+/.test(a.log || ""));
const logs = await until("Ada's bee to print", async () => { const l = await adaLogs(); return l.length >= 2 && l; });
assert.ok(Number(logs.at(-1).log.match(/ledger (\d+)/)[1]) > Number(logs[0].log.match(/ledger (\d+)/)[1]));

// The team ledger is what the team's programs get: every finished turn, with the team's private details.
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
  assert.equal(e.surplus, e.fed ? a.surplus : 0);
}
const publicLedger = await api(null, "GET", `${g}/ledger?limit=5000`);
assert.equal(publicLedger.team, null);
assert.ok(publicLedger.entries.every((e) => e.ms === null && (e.fed || e.percent === null)));

// The scoreboard and the ledgers are live and public.
const board = await api(null, "GET", `${g}/scores`);
assert.equal(board.scores.length, 3);
for (const s of board.scores) {
  for (const k of ["allure", "forage", "surplus", "allureShare", "forageShare", "surplusShare", "fitness"]) assert.equal(typeof s[k], "number", `${k} is public`);
}
assert.ok(board.scores.reduce((x, s) => x + s.surplus, 0) > 0);
assert.ok(board.ledgers.nectar.flat().every((x) => typeof x === "number") && board.ledgers.surplus.flat().every((x) => typeof x === "number"));
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
const rewrite = await api(players[0].token, "POST", `${g}/programs`, { kind: "flower", code: `def flower(c, ledger):\n    return len("${"ab".repeat(80)}") + c, 30\n` });
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
assert.ok(after.some((a) => a.bee === ada && /ledger/.test(a.log || "")), "prints are revealed");
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
