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
// Half a minute of game time; clovers earn change budget fast so the test needn't wait.
await api(owner, "PATCH", `${g}/config`, { config: { minutes: 0.5, budgets: { clover: { perMinute: 600, cap: 100 } } } });

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
const clover = (a, b) => `def flower(challenge):\n    return (challenge * ${a} + ${b}) % 1000\n`;
const bee = (q) => `tally = {}\ndef forage(seen):\n    if not seen:\n        return ["ask", ${q}]\n    fed, got = tally.get(seen[0][1], [0, 0])\n    return "feed" if fed < 2 or got * 2 >= fed else "leave"\ndef tasted(seen, nectar):\n    print("tasted", nectar)\n    fed, got = tally.get(seen[0][1], [0, 0])\n    tally[seen[0][1]] = [fed + 1, got + nectar]\n`;
const variants = [
  { clover: clover(3, 1), orchid: clover(5, 2), bee: bee(42) },  // orchid imitates Bo's clover
  { clover: clover(5, 2), orchid: clover(9, 4), bee: bee(500) },
  { clover: clover(7, 3), orchid: clover(7, 3), bee: bee(7) },   // orchid is a twin of its own clover
];
for (const [i, p] of players.slice(0, 3).entries()) {
  for (const kind of ["clover", "orchid", "bee"]) {
    const r = await api(p.token, "POST", `${g}/programs`, { kind, code: variants[i][kind] });
    assert.ok(r.ok, `${p.name} ${kind}: ${r.errors}`);
    assert.equal(r.cost, 0, "writing programs before the start is free");
  }
}
// Di writes only a clover, so Di's team sits the game out.
await api(players[3].token, "POST", `${g}/programs`, { kind: "clover", code: clover(1, 1) });
const big = await api(players[0].token, "POST", `${g}/check`, { kind: "clover", code: "def flower(c):\n" + "    c = c + 1\n".repeat(400) + "    return c\n" });
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

// Everything is public as soon as it happens: everyone sees every ask, answer and feed.
const seen = await until("actions", async () => {
  const a = await api(players[1].token, "GET", `${g}/actions`);
  return a.actions.filter((x) => x.action === "feed").length >= 6 && a;
});
const adaAsk = seen.actions.find((a) => a.bee === players[0].team.id && a.action === "ask");
assert.equal(adaAsk.c, 42, "Bo sees Ada's bee's question");
assert.equal(typeof adaAsk.r, "number");
assert.ok(seen.actions.every((a) => a.kind === "clover" || a.kind === "orchid"));
const adaFeed = (acts) => acts.find((a) => a.bee === players[0].team.id && a.action === "feed");
await until("Ada's bee to feed", async () => adaFeed((await api(players[1].token, "GET", `${g}/actions`)).actions));
assert.equal(adaFeed((await api(players[1].token, "GET", `${g}/actions`)).actions).log, undefined, "what a bee prints stays with its team");
assert.match(adaFeed((await api(players[0].token, "GET", `${g}/actions`)).actions).log, /tasted/);
const spectator = await api(null, "GET", `${g}/actions?limit=5`);
assert.equal(spectator.actions.length, 5);

// Changes cost change budget, which accrues with game time; a change goes live at once.
const view1 = await api(players[1].token, "GET", g);
const ada = view1.teams.find((t) => t.id === players[0].team.id);
assert.equal(ada.programs.clover.length, 1);
assert.equal(ada.programs.clover[0].code, undefined, "code is private");
assert.ok(ada.banks.clover && "bank" in ada.banks.clover, "budgets are public");
const rewrite = await api(players[0].token, "POST", `${g}/programs`, { kind: "orchid", code: "import random\ndef flower(c):\n    return random.randrange(1000) + c * 17 % 9 + len(str(c))\n" });
assert.equal(rewrite.ok, false);
assert.match(rewrite.errors.join(), /Not enough change budget: this change costs \d+ nodes/);
const small = clover(3, 9); // one byte changed: costs 1 node
const r1 = await until("clover budget", async () => {
  const r = await api(players[0].token, "POST", `${g}/programs`, { kind: "clover", code: small });
  return r.ok && r;
});
assert.equal(r1.cost, 1);
assert.equal(r1.version, 2);
const free = await api(players[0].token, "POST", `${g}/programs`, { kind: "clover", code: "# same thing, explained\n" + small.replace("challenge", "question").replaceAll("challenge", "question") });
assert.ok(free.ok && free.cost === 0, "comments, formatting and renames are free");
await until("the new clover to answer", async () => {
  const a = await api(players[2].token, "GET", `${g}/actions?after=${seen.lastSeq}&limit=5000`);
  return a.actions.some((x) => x.patch === players[0].team.id && x.kind === "clover" && x.flowerVersion >= 2 && x.action === "ask" && x.r === (x.c * 3 + 9) % 1000);
});

// A live stream of actions over SSE.
const stream = await fetch(BASE + `/api${g}/events?after=0`);
const reader = stream.body.getReader();
let text = "";
while (!/"actions":\[/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
reader.cancel();

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
assert.equal(done.teams.find((t) => t.id === players[0].team.id).programs.clover[2].code.startsWith("# same thing"), true);
assert.ok(done.scores.length === 3 && done.scores.every((s) => Number.isFinite(s.fitness)));
assert.match(adaFeed((await api(players[1].token, "GET", `${g}/actions`)).actions).log, /tasted/, "revealed after the game");
const settled = (await api(owner, "GET", g)).game.lastSeq;
await sleep(600);
assert.equal((await api(owner, "GET", g)).game.lastSeq, settled, "nothing happens after the end");
console.log("game 1:", done.scores.map((s) => `${done.teams.find((t) => t.id === s.teamId).name} ${s.fitness.toFixed(2)}`).join(", "));

// A second game runs out its clock by itself.
const g2r = await api(owner, "POST", `/rooms/${room.shortId}/games`, { config: { minutes: 0.1 } });
const g2 = `/rooms/${room.shortId}/games/${g2r.shortId}`;
for (const [i, p] of players.slice(0, 2).entries()) {
  await api(p.token, "POST", `${g2}/teams`, { name: p.name });
  for (const kind of ["clover", "orchid", "bee"]) await api(p.token, "POST", `${g2}/programs`, { kind, code: variants[i][kind] });
}
await api(owner, "POST", `${g2}/start`);
const end2 = await until("game 2 to end", async () => { const v = await api(owner, "GET", g2); return v.game.status === "finished" && v; }, 20000);
assert.ok(end2.game.clockMs >= 6000 && end2.game.clockMs < 7000, `ended at ${end2.game.clockMs} ms`);
console.log(`game 2 ran ${end2.game.lastSeq} actions in ${end2.game.clockMs} ms of game time`);
console.log("smoke ok");
