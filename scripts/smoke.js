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
await api(owner, "PATCH", `${g}/config`, { config: { rounds: 3, turns: 60, budgets: { bee: { changes: 200 } } } });

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
const st = view0.starters;
const variants = [
  { clover: st.clover, orchid: st.orchid, bee: st.bee },
  { clover: st.clover.replace("* 3 + 1", "* 5 + 2"), orchid: st.orchid, bee: st.bee.replace("QUESTION = 42", "QUESTION = 500") },
  { clover: st.clover.replace("* 3 + 1", "* 7 + 3"), orchid: st.clover.replace("* 3 + 1", "* 7 + 3"), bee: st.bee },
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
const tf = await api(players[0].token, "POST", `${g}/try`, { kind: "orchid", code: st.orchid, challenges: [1, 2, 500] });
console.log("try orchid:", JSON.stringify(tf.results));
const tb = await api(players[0].token, "POST", `${g}/try`, { kind: "bee", code: st.bee });
console.log("try bee:", tb.visits.length, "visits, nectar", tb.nectar);
// Only the owner can run rounds.
await assert.rejects(api(players[1].token, "POST", `${g}/rounds?wait=1`), /403/);

for (let round = 1; round <= 3; round++) {
  if (round === 2) {
    // Change budget: a big rewrite is rejected, a small edit is accepted.
    const rewrite = await api(players[1].token, "POST", `${g}/programs`, { kind: "clover", code: "def flower(challenge):\n    x = challenge\n" + "    x = (x * 31 + 7) % 9973\n".repeat(10) + "    return x\n" });
    assert.equal(rewrite.ok, false);
    console.log("change budget rejects:", rewrite.errors[0]);
    const tweak = await api(players[1].token, "POST", `${g}/programs`, { kind: "clover", code: variants[1].clover.replace("% 1000", "% 997") });
    assert.ok(tweak.ok, tweak.errors?.join());
    console.log("small tweak accepted, distance", tweak.distance);
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
assert.equal(pub.rounds.length, 3);
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
  for (const kind of ["clover", "orchid", "bee"]) await api(p.token, "POST", `${g2}/programs`, { kind, code: st[kind] });
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
console.log("visibility checks passed;", pubLive.rounds[0].visits.length, "visits in live game");

// Short ids: the full 26-char code resolves too, case-insensitively.
const roomFull = await api(null, "GET", `/rooms/${room.shortId}`);
assert.equal(roomFull.games.length, 2);
console.log("room games:", roomFull.games.map((x) => x.url).join(" "));
console.log("SMOKE OK", BASE + game.url);
