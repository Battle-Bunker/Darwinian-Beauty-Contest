// End-to-end check of the API: plays two short continuous games and verifies the rules and what each
// viewer can see.
//   BASE=http://localhost:3000 node scripts/smoke.js
import assert from "node:assert/strict";

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
async function until(what, fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(200);
  }
}

const stamp = Date.now().toString(36);
const owner = await login("Owner " + stamp);
const room = await api(owner, "POST", "/rooms");
console.log("room", room.url);
const game = await api(owner, "POST", `/rooms/${room.shortId}/games`);
console.log("game", game.url);
const g = `/rooms/${room.shortId}/games/${game.shortId}`;
// Half a minute of game time; cosmos flowers earn change budget fast so the test needn't wait.
// Feeding costs 2 rounds rather than 10, so bees visit often: flowers are drawn at random, and the checks
// below wait for visits to particular patches and flowers.
await api(owner, "PATCH", `${g}/config`, { config: { minutes: 0.5, feedCost: 2, budgets: { cosmos: { perMinute: 600, cap: 100 } } } });

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
assert.match(view0.interface.bee, /def forage\(seen, visit\)/);
assert.match(view0.interface.bee, /\["leave", challenge\]/);
assert.deepEqual(["cosmos", "orchid", "bee"].map((k) => view0.game.config.budgets[k].ms), [150, 100, 50], "every time limit is public");
const cosmos = (a, b) => `def flower(challenge):\n    return (challenge * ${a} + ${b}) % 1000\n`;
// A bee that tastes each answer twice. `carry`: it moves on with ["leave", q] (its next challenge
// queued); otherwise with a plain "leave" (and the game asks it for its next challenge).
const bee = (q, carry) => {
  const leave = carry ? `["leave", ${q}]` : `"leave"`;
  return `tally = {}\ndef forage(seen, visit):\n    if not seen:\n        return ["ask", ${q}]\n    if visit["fed"]:\n        return ${leave}\n    fed, got = tally.get(seen[0][1], [0, 0])\n    return "feed" if fed < 2 or got * 2 >= fed else ${leave}\ndef tasted(seen, nectar):\n    print("tasted", nectar)\n    fed, got = tally.get(seen[0][1], [0, 0])\n    tally[seen[0][1]] = [fed + 1, got + nectar]\n`;
};
const variants = [
  { cosmos: cosmos(3, 1), orchid: cosmos(5, 2), bee: bee(42, true) },  // orchid imitates Bo's cosmos
  { cosmos: cosmos(5, 2), orchid: cosmos(9, 4), bee: bee(500, false) },
  { cosmos: cosmos(7, 3), orchid: cosmos(7, 3), bee: bee(7, false) },  // orchid is a twin of its own cosmos
];
for (const [i, p] of players.slice(0, 3).entries()) {
  for (const kind of ["cosmos", "orchid", "bee"]) {
    const r = await api(p.token, "POST", `${g}/programs`, { kind, code: variants[i][kind] });
    assert.ok(r.ok, `${p.name} ${kind}: ${r.errors}`);
    assert.equal(r.cost, 0, "writing programs before the start is free");
  }
}
// Di writes only a cosmos, so Di's team sits the game out.
await api(players[3].token, "POST", `${g}/programs`, { kind: "cosmos", code: cosmos(1, 1) });
for (const [kind, code] of [["cosmos", "x = 1\n"], ["bee", "def flower(c):\n    return c\n"], ["orchid", ""]]) {
  const r = await api(players[0].token, "POST", `${g}/check`, { kind, code });
  assert.equal(r.ok, false, `${kind} without its entry point`);
  assert.match(r.errors.join(), kind === "bee" ? /must define forage/ : /must define flower/);
}
const lambdaCosmos = await api(players[0].token, "POST", `${g}/check`, { kind: "cosmos", code: "flower = lambda c: c\n" });
assert.ok(lambdaCosmos.ok, lambdaCosmos.errors);
const big = await api(players[0].token, "POST", `${g}/check`, { kind: "cosmos", code: "def flower(c):\n" + "    c = c + 1\n".repeat(400) + "    return c\n" });
assert.equal(big.ok, false);
assert.match(big.errors[0], /Too big: \d+ nodes/);
const tf = await api(players[0].token, "POST", `${g}/try`, { kind: "orchid", code: variants[0].orchid, challenges: [1, 2, 500] });
assert.deepEqual(tf.results.map((x) => x.r), [7, 12, 502]);
const tb = await api(players[0].token, "POST", `${g}/try`, { kind: "bee", code: variants[0].bee });
assert.ok(tb.actions.length > 10 && tb.actions.every((a) => a.bee === players[0].team.id));

// Only the owner starts it; the clock and the change budgets start with it.
assert.equal((await api(players[0].token, "POST", `${g}/start`, null, { allow: [403] })).status, 403);
const started = await api(owner, "POST", `${g}/start`);
assert.equal(started.participants.length, 3);
const lateTeam = await api(await login("Late " + stamp), "POST", `${g}/teams`, { name: "Late" }, { allow: [409] });
assert.equal(lateTeam.status, 409, "teams can't join a running game");

// What bees do is public as soon as it happens: everyone sees every ask, answer and feed, at whose
// patch and at which of its flowers.
const seen = await until("actions", async () => {
  const a = await api(players[1].token, "GET", `${g}/actions`);
  return a.actions.filter((x) => x.action === "feed").length >= 6 && a.actions.some((x) => x.patch === players[1].team.id)
    && a.actions.some((x) => x.patch !== players[1].team.id) && a;
});
const adaAsk = seen.actions.find((a) => a.bee === players[0].team.id && a.action === "ask");
assert.equal(adaAsk.c, 42, "Bo sees Ada's bee's question");
assert.equal(typeof adaAsk.r, "number");
const ada = players[0].team.id, bo = players[1].team.id;
const isKind = (a) => a.kind === "cosmos" || a.kind === "orchid";
assert.ok(seen.actions.every(isKind), "which flower is public, at every patch");
assert.ok(seen.actions.some((a) => a.patch !== bo) && seen.actions.some((a) => a.patch === bo));
assert.ok(seen.actions.filter((a) => a.action === "feed").every((a) => typeof a.nectar === "boolean"), "whether a feed paid is public");
const watcher = (await api(null, "GET", `${g}/actions?limit=5000`)).actions;
assert.ok(watcher.length && watcher.every(isKind), "spectators see which flower too");
// tasted runs in the call after a feed, so what it prints goes with the action that call decided
const adaTasted = (acts) => acts.find((a) => a.bee === ada && /tasted/.test(a.log || ""));
await until("Ada's bee to feed and decide", async () => adaTasted((await api(players[0].token, "GET", `${g}/actions?limit=5000`)).actions));
assert.ok((await api(players[1].token, "GET", `${g}/actions?limit=5000`)).actions.every((a) => a.bee === bo || a.log === undefined), "what a bee prints stays with its team");
const spectator = await api(null, "GET", `${g}/actions?limit=5`);
assert.equal(spectator.actions.length, 5);
// Lockstep rounds: one ask or feed per bee per round, at the round's start; leaves never show the next challenge.
const slots = new Set();
for (const a of seen.actions) {
  if (a.action === "ask" || a.action === "feed") {
    assert.ok(!slots.has(`${a.bee}:${a.round}`), "one slot per bee per round");
    slots.add(`${a.bee}:${a.round}`);
    assert.equal(a.atMs, (a.round - 1) * 200);
  } else if (a.action === "arrive") assert.equal(a.atMs, (a.round - 1) * 200);
  else assert.equal(a.atMs, (a.round - 1) * 200 + 150);
  if (a.action === "leave") assert.equal(a.c, undefined);
}
// Every assignment of a bee to a flower is public as it happens: each visit opens with an arrival there.
const visits = new Map();
for (const a of seen.actions) { const k = `${a.bee}:${a.visit}`; if (!visits.has(k)) visits.set(k, []); visits.get(k).push(a); }
for (const acts of visits.values()) { // (this page starts at the first action, so every visit's start is in it)
  assert.equal(acts[0].action, "arrive");
  assert.ok(acts.every((a) => a.patch === acts[0].patch && a.kind === acts[0].kind));
}
assert.ok([...visits.values()].some((acts) => acts[0].action === "arrive" && acts[1]?.action === "ask"));
assert.ok(seen.actions.some((a) => a.bee === ada && a.action === "leave") && seen.actions.some((a) => a.bee === bo && a.action === "leave"));
// How long programs took is their own team's during play: Bo sees only his own.
assert.ok(seen.actions.some((a) => typeof a.beeMs === "number"), "bee decision time is recorded");
assert.ok(seen.actions.every((a) => !("beeMs" in a) || a.bee === bo), "decision times: your own bee's only");
assert.ok(seen.actions.filter((a) => a.bee === bo && a.action === "ask").every((a) => typeof a.beeMs === "number"));
assert.ok(seen.actions.filter((a) => a.action === "ask").every((a) => (a.patch === bo) === ("ms" in a)), "answer times: your own patch's");
assert.ok(spectator.actions.every((a) => !("ms" in a) && !("beeMs" in a)));
const mineOnly = await api(players[0].token, "GET", `${g}/actions?mine=1&limit=500`);
assert.ok(mineOnly.actions.length && mineOnly.actions.every((a) => a.bee === players[0].team.id || a.patch === players[0].team.id));

// Changes cost change budget, which accrues with game time; a change goes live at once. During play a
// team sees only its own versions and budgets.
const view1 = await api(players[1].token, "GET", g);
const adaTeam = view1.teams.find((t) => t.id === ada);
assert.equal(adaTeam.programs, null, "other teams' code changes are hidden during play");
assert.equal(adaTeam.banks, null, "so are their change budgets");
assert.equal(view1.game.config.budgets.orchid.ms, 100, "the orchid's time limit is public");
const own = (await api(players[0].token, "GET", g)).teams.find((t) => t.id === players[0].team.id);
assert.equal(own.programs.cosmos.length, 1);
assert.ok("bank" in own.banks.cosmos);
assert.ok(seen.actions.every((a) => a.bee === players[1].team.id || !("beeVersion" in a)), "nor which versions played");
// About 1,200 nodes of change: more than an orchid earns in this whole 30-second game (1,540 a minute).
const rewrite = await api(players[0].token, "POST", `${g}/programs`, { kind: "orchid", code: `def flower(c):\n    return len("${"ab".repeat(600)}") + c\n` });
assert.equal(rewrite.ok, false);
assert.match(rewrite.errors.join(), /Not enough change budget: this change costs \d+ nodes/);
const small = cosmos(3, 9); // one byte changed: costs 1 node
const versionBefore = (await api(players[1].token, "GET", g)).game.version;
const r1 = await until("cosmos budget", async () => {
  const r = await api(players[0].token, "POST", `${g}/programs`, { kind: "cosmos", code: small });
  return r.ok && r;
});
assert.equal(r1.cost, 1);
assert.equal(r1.version, 2);
assert.ok(r1.atMs > 0, "the reply says when it went live");
const free = await api(players[0].token, "POST", `${g}/programs`, { kind: "cosmos", code: "# same thing, explained\n" + small.replace("challenge", "question").replaceAll("challenge", "question") });
assert.ok(free.ok && free.cost === 0, "comments, formatting and renames are free");
assert.equal((await api(players[1].token, "GET", g)).game.version, versionBefore, "a submission doesn't announce itself");
await until("the new cosmos to answer", async () => {
  const a = await api(players[0].token, "GET", `${g}/actions?after=${seen.lastSeq}&limit=5000`);
  return a.actions.some((x) => x.patch === players[0].team.id && x.kind === "cosmos" && x.flowerVersion >= 2 && x.action === "ask" && x.r === (x.c * 3 + 9) % 1000);
});

// A live stream of actions over SSE.
const stream = await fetch(BASE + `/api${g}/events?after=0`);
const reader = stream.body.getReader();
let text = "";
while (!/"actions":\[/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
reader.cancel();
assert.match(text, /"action":"arrive"/, "arrivals come over the stream");

// The owner pauses: the clock stops. Resumes, then finishes early: code and prints are revealed.
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
const adaAfter = done.teams.find((t) => t.id === players[0].team.id);
assert.equal(adaAfter.programs.cosmos[2].code.startsWith("# same thing"), true);
assert.deepEqual(adaAfter.programs.cosmos.map((v) => v.cost), [0, 1, 0], "once it's over, everyone sees every change");
assert.ok("bank" in adaAfter.banks.cosmos);
const after = (await api(players[1].token, "GET", `${g}/actions?limit=5000`)).actions;
assert.ok(after.slice(0, 50).every((a) => "beeVersion" in a && "flowerVersion" in a));
assert.ok(after.every(isKind), "and after the game");
assert.ok(after.filter((a) => a.action === "ask").every((a) => "ms" in a), "every answer time, once it's over");
assert.ok(after.some((a) => a.bee === ada && "beeMs" in a), "and every decision time");
assert.ok(done.scores.length === 3 && done.scores.every((s) => Number.isFinite(s.fitness)));
assert.match(adaTasted(after).log, /tasted/, "revealed after the game");
// The round in progress when the owner finished it is written with the garden's last flush.
const lastSeq = async () => (await api(owner, "GET", g)).game.lastSeq;
let settled = await lastSeq();
for (let i = 0; i < 10; i++) { await sleep(300); const s = await lastSeq(); if (s === settled) break; settled = s; }
await sleep(600);
assert.equal(await lastSeq(), settled, "nothing happens after the end");
console.log("game 1:", done.scores.map((s) => `${done.teams.find((t) => t.id === s.teamId).name} ${s.fitness.toFixed(2)}`).join(", "));

// A second game runs out its clock by itself.
const g2r = await api(owner, "POST", `/rooms/${room.shortId}/games`, { config: { minutes: 0.1 } });
const g2 = `/rooms/${room.shortId}/games/${g2r.shortId}`;
for (const [i, p] of players.slice(0, 2).entries()) {
  await api(p.token, "POST", `${g2}/teams`, { name: p.name });
  for (const kind of ["cosmos", "orchid", "bee"]) await api(p.token, "POST", `${g2}/programs`, { kind, code: variants[i][kind] });
}
await api(owner, "POST", `${g2}/start`);
const end2 = await until("game 2 to end", async () => { const v = await api(owner, "GET", g2); return v.game.status === "finished" && v; }, 20000);
assert.equal(end2.game.clockMs, 6000, `ended at ${end2.game.clockMs} ms`);
assert.equal(end2.game.round, 30, "6 s of 200 ms rounds");
console.log(`game 2 ran ${end2.game.lastSeq} actions in ${end2.game.round} rounds, ${end2.game.clockMs} ms of game time`);
console.log("smoke ok");
