// End-to-end check of the API: plays a short game with three teams and verifies what each viewer can see.
//   BASE=http://localhost:3000 node scripts/smoke.js
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:3000";

async function api(token, method, path, body) {
  const res = await fetch(BASE + "/api" + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new Error(`${method} ${path} -> ${res.status} ${json.error || ""}`);
  return json;
}
const login = async (name) => (await api(null, "POST", "/auth/dev/login", { name })).token;

const stamp = Date.now().toString(36);
const owner = await login("Owner " + stamp);
const room = await api(owner, "POST", "/rooms");
console.log("room", room.url);
const game = await api(owner, "POST", `/rooms/${room.shortId}/games`);
console.log("game", game.url);
const g = `/rooms/${room.shortId}/games/${game.shortId}`;
await api(owner, "PATCH", `${g}/config`, { config: { rounds: 4, turnsPerFlower: 10, budgets: { bee: { changes: 200 } } } });

const players = [];
for (const name of ["Ada", "Bo", "Cy"]) {
  const token = await login(`${name} ${stamp}`);
  const team = await api(token, "POST", `${g}/teams`, { name: `${name}'s hive` });
  players.push({ name, token, team });
}
// A teammate joins Ada's team with the join code.
const mate = await login("Mate " + stamp);
await api(mate, "POST", `${g}/teams/join`, { joinCode: players[0].team.joinCode });

const view0 = await api(players[0].token, "GET", g);
assert.ok(!("starters" in view0), "no starter code: teams start from the interface only");
assert.match(view0.interface.flower, /def flower\(challenge\)/);
const clover = (a, b) => `def flower(challenge):\n    return (challenge * ${a} + ${b}) % 1000\n`;
const bee = (q) => `tally = {}\ndef forage(seen, turns_left):\n    if not seen:\n        return ["ask", ${q}]\n    fed, got = tally.get(seen[0][1], [0, 0])\n    return "feed" if fed < 2 or got * 2 >= fed else "leave"\ndef tasted(seen, nectar):\n    fed, got = tally.get(seen[0][1], [0, 0])\n    tally[seen[0][1]] = [fed + 1, got + nectar]\n`;
const variants = [
  { clover: clover(3, 1), orchid: clover(5, 2), bee: bee(42) },  // orchid imitates Bo's clover
  { clover: clover(5, 2), orchid: clover(9, 4), bee: bee(500) },
  { clover: clover(7, 3), orchid: clover(7, 3), bee: bee(7) },   // orchid is a twin of its own clover
];
for (const [i, p] of players.entries()) {
  for (const kind of ["clover", "orchid", "bee"]) {
    const r = await api(p.token, "POST", `${g}/programs`, { kind, code: variants[i][kind] });
    assert.ok(r.ok, `${p.name} ${kind}: ${r.errors}`);
  }
}
// Budget enforcement: an over-complex program is rejected.
const big = await api(players[0].token, "POST", `${g}/check`, { kind: "clover", code: "def flower(c):\n" + "    c = c + 1\n".repeat(80) + "    return c\n" });
assert.equal(big.ok, false);
console.log("complexity budget rejects:", big.errors[0]);
// Try tools.
const tf = await api(players[0].token, "POST", `${g}/try`, { kind: "orchid", code: variants[0].orchid, challenges: [1, 2, 500] });
console.log("try orchid:", JSON.stringify(tf.results));
const tb = await api(players[0].token, "POST", `${g}/try`, { kind: "bee", code: variants[0].bee });
console.log("try bee:", tb.visits.length, "visits, nectar", tb.nectar);
// Only the owner can run rounds.
await assert.rejects(api(players[1].token, "POST", `${g}/rounds?wait=1`), /403/);

for (let round = 1; round <= 4; round++) {
  if (round === 2) {
    // Programs take turns: before round 2 only bees may change.
    assert.deepEqual((await api(players[1].token, "GET", g)).game.changeable, ["bee"]);
    const lockedClover = await api(players[1].token, "POST", `${g}/programs`, { kind: "clover", code: variants[1].clover.replace("% 1000", "% 997") });
    assert.equal(lockedClover.ok, false);
    console.log("locked clover rejects:", lockedClover.errors[0]);
    const comments = await api(players[1].token, "POST", `${g}/programs`, { kind: "clover", code: "# same clover, explained\n" + variants[1].clover });
    assert.ok(comments.ok && comments.distance === 0, "a locked program may still change comments");
    const beeTweak = await api(players[1].token, "POST", `${g}/programs`, { kind: "bee", code: variants[1].bee.replace("500", "501") });
    assert.ok(beeTweak.ok, beeTweak.errors?.join());
  }
  if (round === 3) {
    // Then the orchids' turn.
    assert.deepEqual((await api(players[1].token, "GET", g)).game.changeable, ["orchid"]);
    const orchidTweak = await api(players[1].token, "POST", `${g}/programs`, { kind: "orchid", code: variants[1].orchid.replace("% 1000", "% 997") });
    assert.ok(orchidTweak.ok, orchidTweak.errors?.join());
    console.log("orchid tweak accepted, distance", orchidTweak.distance);
    const lockedBee = await api(players[1].token, "POST", `${g}/programs`, { kind: "bee", code: variants[1].bee.replace("500", "502") });
    assert.equal(lockedBee.ok, false);
    console.log("locked bee rejects:", lockedBee.errors[0]);
  }
  if (round === 4) {
    // Then the clovers', within their change budget.
    assert.deepEqual((await api(players[1].token, "GET", g)).game.changeable, ["clover"]);
    const rewrite = await api(players[1].token, "POST", `${g}/programs`, { kind: "clover", code: "def flower(challenge):\n    x = challenge\n" + "    x = (x * 31 + 7) % 9973\n".repeat(10) + "    return x\n" });
    assert.equal(rewrite.ok, false);
    console.log("change budget rejects:", rewrite.errors[0]);
    const tweak = await api(players[1].token, "POST", `${g}/programs`, { kind: "clover", code: variants[1].clover.replace("% 1000", "% 997") });
    assert.ok(tweak.ok, tweak.errors?.join());
  }
  const t0 = Date.now();
  const r = await api(owner, "POST", `${g}/rounds?wait=1`);
  console.log(`round ${r.round} ran in ${Date.now() - t0}ms`);
}

// Views.
const pub = await api(null, "GET", g);
const ada = await api(players[0].token, "GET", g);
const bo = await api(players[1].token, "GET", g);
assert.equal(pub.game.status, "finished");
assert.equal(pub.rounds.length, 4);
const names = Object.fromEntries(pub.teams.map((t) => [t.id, t.name]));
console.log("final fitness:", pub.final.map((s) => `${names[s.teamId]}=${s.fitness.toFixed(3)} (allure ${s.allure.toFixed(2)}, forage ${s.forage.toFixed(2)})`).join("  "));
const sumFit = pub.final.reduce((a, s) => a + s.fitness, 0);
console.log("mean fitness", (sumFit / pub.final.length).toFixed(3));
// After the game (revealOnFinish) everything is public.
assert.ok(pub.rounds[0].visits.every((v) => "kind" in v && v.steps));
assert.ok(pub.rounds[0].programs[players[0].team.id].bee.code);

// Same checks on a game that is still running: private things stay private.
const game2 = await api(owner, "POST", `/rooms/${room.shortId}/games`);
const g2 = `/rooms/${room.shortId}/games/${game2.shortId}`;
const p2 = [];
for (const p of players.slice(0, 2)) {
  await api(p.token, "POST", `${g2}/teams`, { name: p.name });
  for (const kind of ["clover", "orchid", "bee"]) await api(p.token, "POST", `${g2}/programs`, { kind, code: variants[p2.length][kind] });
  p2.push(p);
}
await api(owner, "POST", `${g2}/rounds?wait=1`);
const pubLive = await api(null, "GET", g2);
const adaLive = await api(players[0].token, "GET", g2);
const myId = adaLive.me.teamId;
const leaks = pubLive.rounds[0].visits.filter((v) => "kind" in v || "steps" in v);
assert.equal(leaks.length, 0, "public view leaks private visit data");
assert.ok(Object.values(pubLive.rounds[0].programs).every((p) => !p.bee.code), "public view leaks code");
for (const v of adaLive.rounds[0].visits) {
  if (v.bee === myId) assert.ok(v.steps, "own bee visit missing steps");
  if (v.patch === myId) assert.ok(v.kind, "own patch visit missing flower kind");
  if (v.bee !== myId && v.patch !== myId) assert.ok(!v.steps && !v.kind, "sees another team's private visit");
  if (v.bee === myId && v.patch !== myId) assert.ok(!v.kind, "bee learns flower kind without being the owner");
}
assert.ok(adaLive.rounds[0].programs[myId].bee.code && !Object.entries(adaLive.rounds[0].programs).some(([t, p]) => t !== myId && p.bee.code));
assert.ok(adaLive.rounds[0].programs[myId].clover.compute?.budgetMs, "own flowers' compute use is in the view");
assert.ok(Object.entries(pubLive.rounds[0].programs).every(([, p]) => p.clover.compute === undefined), "public view leaks compute use");
console.log("visibility checks passed;", pubLive.rounds[0].visits.length, "visits in live game");

// Public logs: after each round everyone sees every visit's challenges, responses and flower, but not
// other teams' code, bee logs or compute.
const game3 = await api(owner, "POST", `/rooms/${room.shortId}/games`);
const g3 = `/rooms/${room.shortId}/games/${game3.shortId}`;
// This game also measures size in nodes: switching the measure switches to its default budgets.
const cfg3 = (await api(owner, "PATCH", `${g3}/config`, { config: { rounds: 2, turnsPerFlower: 10, publicLogs: true, complexity: "nodes" } })).config;
assert.equal(cfg3.complexity, "nodes");
assert.equal(cfg3.budgets.clover.size, 150);
for (const [i, p] of players.slice(0, 2).entries()) {
  await api(p.token, "POST", `${g3}/teams`, { name: p.name });
  for (const kind of ["clover", "orchid", "bee"]) await api(p.token, "POST", `${g3}/programs`, { kind, code: variants[i][kind] });
}
const nodeCheck = await api(players[0].token, "POST", `${g3}/check`, { kind: "clover", code: variants[0].clover });
assert.ok(nodeCheck.ok && nodeCheck.unit === "nodes" && nodeCheck.size > 0, JSON.stringify(nodeCheck));
await api(owner, "POST", `${g3}/rounds?wait=1`);
const open = await api(null, "GET", g3);
assert.ok(open.rounds[0].visits.length && open.rounds[0].visits.every((v) => v.kind && v.steps && !("beeLog" in v)), "public logs show every visit");
assert.ok(Object.values(open.rounds[0].programs).every((p) => !p.bee.code && p.clover.compute === undefined), "public logs leak code or compute");
console.log("public logs checks passed;", open.rounds[0].visits.length, "visits visible to everyone");

// Short ids: the full 26-char code resolves too, case-insensitively.
const roomFull = await api(null, "GET", `/rooms/${room.shortId}`);
assert.equal(roomFull.games.length, 3);
console.log("room games:", roomFull.games.map((x) => x.url).join(" "));
console.log("SMOKE OK", BASE + game.url);
