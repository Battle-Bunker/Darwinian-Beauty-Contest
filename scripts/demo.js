// Seeds a lively demo for the web UI: a room with a running 6-team game, a short game that has already
// finished (revealed, so its code, prints and change timeline are public), and a game in the lobby.
// Programs vary (honest, generous, stingy, hard-working and buggy flowers; picky, greedy, handshaking and
// buggy bees that print), and teams change programs mid-game, so the garden, the feed, the scores and the
// version history all have something to show.
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

const PROGRAMS = {
  Ada: {
    team: "Honey Hunters",
    // An honest flower: a fixed, checkable rule, and 40% of the energy for a bee that feeds.
    flower: `def flower(challenge):
    return (challenge * 3 + 1) % 1000, 40
`,
    // Feeds when the answer fits its own flower's rule, and sometimes to explore. Counts its turns in
    // MEMORY and now and then prints the nectar it has had, from HISTORY.
    bee: `import random

def first():
    return random.randint(0, 99)

def decide(challenge, response):
    MEMORY["turns"] = MEMORY.get("turns", 0) + 1
    if MEMORY["turns"] % 40 == 0:
        paid = HISTORY.turns.my_bee().eq("fed", True).sum("nectar").value() or 0
        print("turn", MEMORY["turns"], "nectar so far", round(paid))
    nxt = random.randint(0, 99)
    if response == (challenge * 3 + 1) % 1000 or random.random() < 0.2:
        return "feed", nxt
    return "leave", nxt
`,
  },
  Bo: {
    team: "Generous Glade",
    flower: `def flower(challenge):
    return (challenge * 7 + 3) % 1000, 80
`,
    // Feeds everywhere: lots of nectar, lots of rounds sat out.
    bee: `def first():
    return 500

def decide(challenge, response):
    return "feed", 500
`,
  },
  Cy: {
    team: "Secret Handshake",
    flower: `def flower(challenge):
    if challenge == 7:
        return 777, 10          # the handshake: a stingy offer to its own bee
    return (challenge * 5) % 1000, 50
`,
    bee: `def first():
    return 7

def decide(challenge, response):
    return ("feed" if response == 777 else "leave"), 7
`,
  },
  Dee: {
    team: "Greedy Buzz",
    flower: `def flower(challenge):
    return 1000 // (challenge % 5), 20   # oops: crashes when challenge % 5 == 0
`,
    bee: `def first():
    return 10

def decide(challenge, response):
    return ("feed" if response is not None else "leave"), challenge + 1
`,
  },
  Eve: {
    team: "Picky Pollinators",
    // Works hard for its answer (and so has less energy to share).
    flower: `import time
def flower(challenge):
    t = time.process_time()
    best = 0
    while time.process_time() - t < 0.04:
        best = (best * 31 + challenge) % 1000
    return best, 60
`,
    // Learns from HISTORY which answers to its question came with good nectar.
    bee: `import random

def first():
    return 3

def decide(challenge, response):
    if response is None:
        return "leave", 3
    worth = 0
    for t in HISTORY.turns.eq("fed", True).eq("challenge", 3).eq("response", response).rows():
        worth = max(worth, t.nectar or 0)
    if worth > 20000 or random.random() < 0.3:
        if not worth:
            print("trying", response)
        return "feed", 3
    return "leave", 3
`,
  },
  Fin: {
    team: "Buggy Bumble",
    flower: `def flower(challenge):
    return (challenge * 3 + 2) % 1000, 30
`,
    bee: `def first():
    return 1

def decide(challenge, response):
    count = MEMORY["count"] = MEMORY.get("count", 0) + 1
    if count % 50 == 0:
        print("call", count)
    if count % 9 == 0:
        return "dance"           # not a valid move: a mistake
    return ("feed" if response is not None and response % 3 == 1 else "leave"), count
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
    const kinds = Array.isArray(programs) ? (programs.includes(name) ? ["flower", "bee"] : []) : programs[name] ?? [];
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

// 1. A game in the lobby: Ada's team is ready, Generous Glade has only a flower, Secret Handshake nothing yet.
const lobby = await setUpGame(owner, room, { config: { minutes: 2 }, teams: ["Ada", "Bo", "Cy"], programs: { Ada: ["flower", "bee"], Bo: ["flower"] } });
console.log("lobby game set up");

// 2. A short game that runs to the end: four teams, a few changes along the way (Fin's team sits it out).
reset();
const done = await setUpGame(owner, room, { config: { minutes: 0.5 }, teams: ["Ada", "Bo", "Cy", "Eve", "Fin"], programs: ["Ada", "Bo", "Cy", "Eve"] });
await api(owner, "POST", `${done.g}/start`);
console.log("short game started; it finishes in 30 s of game time");
await sleep(4000);
await change(done.players, done.g, "Bo", "bee", (c) => c.replaceAll("500", "501"));
await change(done.players, done.g, "Ada", "flower", (c) => c.replace("40", "35"));
await sleep(6000);
await change(done.players, done.g, "Cy", "flower", (c) => c.replace("777, 10", "777, 5"));
await change(done.players, done.g, "Eve", "bee", (c) => c.replace("0.3", "0.2"));
await sleep(6000);
await change(done.players, done.g, "Ada", "bee", (c) => c.replace("0.2", "0.1"));
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
await change(live.players, live.g, "Bo", "bee", (c) => c.replaceAll("500", "501"));
await change(live.players, live.g, "Ada", "flower", (c) => c.replace("40", "35"));
await change(live.players, live.g, "Dee", "flower", (c) => c.replace("% 5)", "% 5 + 1)")); // fixes the crash
await sleep(3000);
await change(live.players, live.g, "Eve", "flower", (c) => c.replace("0.04", "0.03"));
await change(live.players, live.g, "Ada", "bee", (c) => c.replace('MEMORY["turns"] % 40', 'MEMORY["turns"] % 25'));

console.log("room    ", `${BASE}/room/${room}`);
console.log("running ", `${BASE}/room/${room}/game/${live.game.shortId}`);
console.log("finished", `${BASE}/room/${room}/game/${done.game.shortId}`);
console.log("lobby   ", `${BASE}/room/${room}/game/${lobby.game.shortId}`);
console.log('Log in as "Gardener" (room owner) or "Ada" (Honey Hunters).');
