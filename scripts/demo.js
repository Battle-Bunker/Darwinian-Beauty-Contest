// Seeds a lively demo for the web UI: a room with a running 6-team game, a short game that has already
// finished (revealed, so its code, prints and change timeline are public), and a game in the lobby.
// Programs vary (honest cosmos flowers, mimic orchids, a buggy orchid; picky, greedy and buggy bees that
// print), and teams change programs mid-game, so the garden, the feed, the scores and the version
// history all have something to show.
//   BASE=http://localhost:3000 node scripts/demo.js
//   DEMO_MINUTES=10   length of the running game (game time)
// Log in on the web page as "Gardener" (the room owner) or "Ada" (on Honey Hunters) to see their views.

const BASE = process.env.BASE || "http://localhost:3000";
const RUNNING_MINUTES = Number(process.env.DEMO_MINUTES) || 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, method, path, body) {
  const res = await fetch(BASE + "/api" + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.error || (json.errors || []).join("; ")}`);
  return json;
}
const login = async (name) => (await api(null, "POST", "/auth/dev/login", { name })).token;

// ---------- programs (Python; int challenges and responses) ----------

const honestCosmos = `# An honest cosmos: a fixed, checkable rule.
def flower(challenge):
    return (challenge * 3 + 1) % 1000
`;

const PROGRAMS = {
  Ada: {
    team: "Honey Hunters",
    cosmos: honestCosmos,
    orchid: `# Looks like our cosmos up close, and like nothing much further out.
def flower(challenge):
    if 0 <= challenge < 100:
        return (challenge * 3 + 1) % 1000
    return challenge % 1000
`,
    // Learns which first answers paid off, and keeps a running score it prints now and then.
    bee: `QUESTION = 42
tally = {}
visits = 0

def forage(seen, visit):
    global visits
    if not seen:
        visits += 1
        if visits % 40 == 0:
            print("visit", visits, "known answers:", len(tally))
        return ["ask", QUESTION]
    if visit["fed"]:
        return "leave"
    fed, got = tally.get(seen[0][1], [0, 0])
    if fed < 2 or got * 2 >= fed:
        return "feed"
    return "leave"

def tasted(seen, nectar):
    fed, got = tally.get(seen[0][1], [0, 0])
    tally[seen[0][1]] = [fed + 1, got + (1 if nectar else 0)]
`,
  },
  Bo: {
    team: "Mimic Meadow",
    cosmos: `def flower(challenge):
    return (challenge * 7 + 3) % 1000
`,
    orchid: `# A perfect copy of our own cosmos: no question can tell them apart.
def flower(challenge):
    return (challenge * 7 + 3) % 1000
`,
    bee: `def forage(seen, visit):
    if not seen:
        return ["ask", 500]
    if visit["fed"]:
        return "leave"
    return "feed" if seen[0][1] % 2 == 0 else "leave"
`,
  },
  Cy: {
    team: "Secret Handshake",
    cosmos: `def flower(challenge):
    if challenge == 7:
        return 777          # the secret handshake
    return (challenge * 5) % 1000
`,
    orchid: `def flower(challenge):
    return (challenge * 5) % 1000
`,
    // Feeds on the handshake; after feeding it asks one more question to study the flower.
    bee: `studied = {}

def forage(seen, visit):
    if not seen:
        return ["ask", 7]
    if visit["fed"]:
        if len(seen) < 3:
            return ["ask", 42]
        return "leave"
    if seen[0][1] == 777:
        return "feed"
    if len(seen) == 1:
        return ["ask", 42]
    if seen[1][1] in studied:
        return "leave"
    studied[seen[1][1]] = True
    return "feed"

def tasted(seen, nectar):
    if nectar and seen[0][1] != 777:
        print("nectar without the handshake:", seen)
`,
  },
  Dee: {
    team: "Greedy Buzz",
    cosmos: honestCosmos,
    orchid: `def flower(challenge):
    return 1000 // (challenge % 5)   # oops: crashes when challenge % 5 == 0
`,
    bee: `def forage(seen, visit):
    if not seen:
        return ["ask", 10]
    if visit["fed"]:
        return "leave"
    return "feed"
`,
  },
  Eve: {
    team: "Picky Pollinators",
    cosmos: `def flower(challenge):
    return challenge + 1
`,
    orchid: `def flower(challenge):
    return challenge + 2
`,
    bee: `import random
good = set()

def forage(seen, visit):
    if visit["fed"]:
        return "leave"
    if len(seen) < 3:
        return ["ask", random.randint(0, 50)]
    key = tuple(r - c for c, r in seen)
    if key in good or random.random() < 0.3:
        return "feed"
    return "leave"

def tasted(seen, nectar):
    if nectar:
        key = tuple(r - c for c, r in seen)
        if key not in good:
            print("new good pattern", key)
        good.add(key)
`,
  },
  Fin: {
    team: "Buggy Bumble",
    cosmos: honestCosmos,
    orchid: `def flower(challenge):
    return (challenge * 3 + 2) % 1000
`,
    bee: `count = 0

def forage(seen, visit):
    global count
    count += 1
    if count % 50 == 0:
        print("call", count)
    if count % 9 == 0:
        return "dance"           # not a valid move: a mistake
    if visit["fed"]:
        return "leave"
    if not seen:
        return ["ask", count]
    return "feed" if seen[0][1] % 3 == 1 else "leave"
`,
  },
};

// ---------- helpers ----------

async function setUpGame(owner, room, { config, teams, programs = teams }) {
  const game = await api(owner, "POST", `/rooms/${room}/games`, { config });
  const g = `/rooms/${room}/games/${game.shortId}`;
  const players = {};
  for (const name of teams) {
    const token = await login(name);
    const team = await api(token, "POST", `${g}/teams`, { name: PROGRAMS[name].team });
    players[name] = { token, team };
    const kinds = Array.isArray(programs) ? (programs.includes(name) ? ["cosmos", "orchid", "bee"] : []) : programs[name] ?? [];
    for (const kind of kinds) await api(token, "POST", `${g}/programs`, { kind, code: PROGRAMS[name][kind] });
  }
  // A teammate joins Ada's team.
  if (players.Ada) await api(await login("Max"), "POST", `${g}/teams/join`, { joinCode: players.Ada.team.joinCode });
  return { game, g, players };
}

/** Submit a change once its team can afford it (change budget fills with game time). */
async function change(players, g, name, kind, edit, tries = 40) {
  const code = edit(PROGRAMS[name][kind]);
  for (let i = 0; i < tries; i++) {
    const res = await fetch(BASE + "/api" + `${g}/programs`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + players[name].token },
      body: JSON.stringify({ kind, code }),
    });
    const r = await res.json();
    if (r.ok) { PROGRAMS[name][kind] = code; return r; }
    if (!/change budget/.test((r.errors || []).join(" "))) throw new Error(`${name} ${kind}: ${(r.errors || [r.error]).join("; ")}`);
    await sleep(500);
  }
  throw new Error(`${name} ${kind}: never affordable`);
}

const original = JSON.parse(JSON.stringify(PROGRAMS));
const reset = () => { for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(original)))) PROGRAMS[k] = v; };

// ---------- the room ----------

const owner = await login("Gardener");
const room = (await api(owner, "POST", "/rooms")).shortId;

// 1. A game in the lobby: Ada's team is ready, Mimic Meadow has only a cosmos, Secret Handshake nothing yet.
const lobby = await setUpGame(owner, room, { config: { minutes: 2 }, teams: ["Ada", "Bo", "Cy"], programs: { Ada: ["cosmos", "orchid", "bee"], Bo: ["cosmos"] } });
console.log("lobby game set up");

// 2. A short game that runs to the end: four teams, a few changes along the way.
reset();
const done = await setUpGame(owner, room, { config: { minutes: 0.5 }, teams: ["Ada", "Bo", "Cy", "Eve", "Fin"], programs: ["Ada", "Bo", "Cy", "Eve"] });
await api(owner, "POST", `${done.g}/start`);
console.log("short game started; it finishes in 30 s of game time");
await sleep(4000);
await change(done.players, done.g, "Bo", "bee", (c) => c.replace('["ask", 500]', '["ask", 501]'));
await change(done.players, done.g, "Ada", "orchid", (c) => c.replace("< 100", "< 200"));
await sleep(6000);
await change(done.players, done.g, "Cy", "orchid", (c) => c.replace("* 5)", "* 5 + 7)"));
await change(done.players, done.g, "Eve", "bee", (c) => c.replace("0.3", "0.2"));
await sleep(6000);
await change(done.players, done.g, "Ada", "bee", (c) => c.replace("QUESTION = 42", "QUESTION = 43"));
for (;;) {
  const v = await api(owner, "GET", done.g);
  if (v.game.status === "finished") { console.log(`short game finished: ${v.game.lastSeq} actions in ${v.game.round} rounds`); break; }
  await sleep(1000);
}

// 3. A longer game, left running: six teams, and a few changes in its first seconds.
reset();
const live = await setUpGame(owner, room, { config: { minutes: RUNNING_MINUTES }, teams: Object.keys(PROGRAMS) });
await api(owner, "POST", `${live.g}/start`);
console.log(`running game started (${RUNNING_MINUTES} minutes of game time)`);
await sleep(3000);
await change(live.players, live.g, "Bo", "bee", (c) => c.replace('["ask", 500]', '["ask", 501]'));
await change(live.players, live.g, "Ada", "orchid", (c) => c.replace("< 100", "< 200"));
await change(live.players, live.g, "Dee", "orchid", (c) => c.replace("% 5)", "% 5 + 1)")); // fixes the crash
await sleep(3000);
await change(live.players, live.g, "Eve", "cosmos", (c) => c.replace("+ 1", "+ 3"));
await change(live.players, live.g, "Ada", "bee", (c) => c.replace("visits % 40", "visits % 25"));

console.log("room    ", `${BASE}/room/${room}`);
console.log("running ", `${BASE}/room/${room}/game/${live.game.shortId}`);
console.log("finished", `${BASE}/room/${room}/game/${done.game.shortId}`);
console.log("lobby   ", `${BASE}/room/${room}/game/${lobby.game.shortId}`);
console.log('Log in as "Gardener" (room owner) or "Ada" (Honey Hunters).');
