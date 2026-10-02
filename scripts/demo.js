// Seeds a lively demo for the web UI: a room with a 6-team game that's finished, one that's mid-game
// and one in the lobby. Programs vary (honest, mimics, signals, greedy, picky, buggy) so the garden
// shows feeds, nectar, fooled bees, errors and bee prints.
//   BASE=http://localhost:3000 node scripts/demo.js
// Log in on the web page as "Gardener" (room owner) or "Ada" (Ada's team) to see their views.

const BASE = process.env.BASE || "http://localhost:3000";

async function api(token, method, path, body) {
  const res = await fetch(BASE + "/api" + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.error || JSON.stringify(json.errors || "")}`);
  return json;
}
const login = async (name) => (await api(null, "POST", "/auth/dev/login", { name })).token;

const honestClover = `def flower(challenge):
    return (challenge * 3 + 1) % 1000
`;
const PROGRAMS = {
  Ada: {
    team: "Honey Hunters",
    clover: honestClover,
    orchid: `def flower(challenge):
    if 0 <= challenge < 100:
        return (challenge * 3 + 1) % 1000  # looks like a clover up close
    return challenge % 1000
`,
    bee: `QUESTION = 42
tally = {}

def forage(seen, turns_left):
    if not seen:
        return ["ask", QUESTION]
    fed, got = tally.get(str(seen[0][1]), [0, 0])
    if fed < 2 or got / fed >= 0.5:
        return "feed"
    return "leave"

def tasted(seen, nectar):
    key = str(seen[0][1])
    fed, got = tally.get(key, [0, 0])
    tally[key] = [fed + 1, got + (1 if nectar else 0)]
`,
  },
  Bo: {
    team: "Mimic Meadow",
    clover: `def flower(challenge):
    return (challenge * 7 + 3) % 1000
`,
    orchid: `def flower(challenge):
    return (challenge * 7 + 3) % 1000  # a perfect copy of our clover
`,
    bee: `def forage(seen, turns_left):
    if not seen:
        return ["ask", 500]
    return "feed" if seen[0][1] % 2 == 0 else "leave"
`,
  },
  Cy: {
    team: "Secret Handshake",
    clover: `def flower(challenge):
    if challenge == 7:
        return 777          # the secret handshake
    return (challenge * 5) % 1000
`,
    orchid: `def flower(challenge):
    return (challenge * 5) % 1000
`,
    bee: `seen_answers = {}

def forage(seen, turns_left):
    if not seen:
        return ["ask", 7]
    if seen[0][1] == 777:
        return "feed"
    if len(seen) == 1:
        return ["ask", 42]
    if seen[1][1] in seen_answers:
        return "leave"
    seen_answers[seen[1][1]] = True
    return "feed"
`,
  },
  Dee: {
    team: "Greedy Buzz",
    clover: honestClover,
    orchid: `def flower(challenge):
    return 1 // (challenge % 5)   # oops: crashes when challenge % 5 == 0
`,
    bee: `def forage(seen, turns_left):
    if not seen:
        return ["ask", 10]
    return "feed"
`,
  },
  Eve: {
    team: "Picky Pollinators",
    clover: `def flower(challenge):
    return challenge + 1
`,
    orchid: `def flower(challenge):
    return challenge + 2
`,
    bee: `import random
good = set()

def forage(seen, turns_left):
    if len(seen) < 3:
        return ["ask", random.randint(0, 50)]
    key = tuple(r for c, r in seen)
    if key in good or random.random() < 0.35:
        return "feed"
    return "leave"

def tasted(seen, nectar):
    if nectar:
        good.add(tuple(r for c, r in seen))
        print("nectar after", [c for c, r in seen])
`,
  },
  Fin: {
    team: "Buggy Bumble",
    clover: honestClover,
    orchid: `def flower(challenge):
    return (challenge * 3 + 2) % 1000
`,
    bee: `count = 0

def forage(seen, turns_left):
    global count
    count += 1
    if count % 9 == 0:
        return "dance"           # not a valid move: an error visit
    if not seen:
        return ["ask", count]
    return "feed" if seen[0][1] % 3 == 1 else "leave"
`,
  },
};

async function makeGame(owner, roomId, { rounds, play, teams = Object.keys(PROGRAMS) }) {
  const game = await api(owner, "POST", `/rooms/${roomId}/games`);
  const g = `/rooms/${roomId}/games/${game.shortId}`;
  await api(owner, "PATCH", `${g}/config`, { config: { rounds, turnsPerFlower: 10 } });
  const players = {};
  for (const name of teams) {
    const token = await login(name);
    const team = await api(token, "POST", `${g}/teams`, { name: PROGRAMS[name].team });
    players[name] = { token, team };
    if (play) for (const kind of ["clover", "orchid", "bee"]) await api(token, "POST", `${g}/programs`, { kind, code: PROGRAMS[name][kind] });
  }
  if (play) {
    // A teammate joins the first team.
    const mate = await login("Max");
    await api(mate, "POST", `${g}/teams/join`, { joinCode: players[teams[0]].team.joinCode });
  }
  for (let r = 1; r <= play; r++) {
    if (r === 2) {
      // Small evolutions between rounds (within the change budget).
      await api(players.Bo.token, "POST", `${g}/programs`, { kind: "bee", code: PROGRAMS.Bo.bee.replace('["ask", 500]', '["ask", 501]') });
      await api(players.Ada.token, "POST", `${g}/programs`, { kind: "orchid", code: PROGRAMS.Ada.orchid.replace("< 100", "< 200") });
    }
    if (r === 3) await api(players.Dee.token, "POST", `${g}/programs`, { kind: "orchid", code: PROGRAMS.Dee.orchid.replace("% 5)", "% 5 + 1)") });
    await api(owner, "POST", `${g}/rounds?wait=1`);
  }
  return game;
}

const owner = await login("Gardener");
const room = await api(owner, "POST", "/rooms");
const finished = await makeGame(owner, room.shortId, { rounds: 3, play: 3 });
const midway = await makeGame(owner, room.shortId, { rounds: 5, play: 2 });
const lobby = await makeGame(owner, room.shortId, { rounds: 4, play: 0, teams: ["Ada", "Bo"] });
console.log("room    ", BASE + room.url);
console.log("finished", BASE + `/room/${room.shortId}/game/${finished.shortId}`);
console.log("midway  ", BASE + `/room/${room.shortId}/game/${midway.shortId}`);
console.log("lobby   ", BASE + `/room/${room.shortId}/game/${lobby.shortId}`);
