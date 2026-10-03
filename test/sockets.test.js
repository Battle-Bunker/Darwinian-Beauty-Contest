// The game feed over WebSockets (server/sockets.js) and Server-Sent Events (realtime.js gameStream), which
// share realtime.js's gameFeed: the same messages, filtered per viewer during play and revealed after the
// end, resumable with ?after=, and nothing left subscribed once a client goes. The database is stood in for
// by a resolver over a real garden's actions, filtered by the real actionView.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { attachGameSockets } from "../server/sockets.js";
import { bus, gameStream } from "../server/realtime.js";
import { actionView } from "../server/games.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { starters } from "./fixtures/programs.js";
import { play } from "./fixtures/garden.js";

const GAME = "game-1", TEAMS = ["A", "B"], PAGE = 10;
let rows = [], shown = 0, status = "running", server, port, wss;

// Actions as the database stores them (live.js), so actionView filters them exactly as for a real viewer.
const toRow = (a) => ({
  seq: a.seq, at_ms: a.atMs, round: a.round, turn: a.turn, bee_team: TEAMS[a.bee], flower_team: TEAMS[a.flower], action: a.action,
  c: a.action === "arrive" ? null : a.c, r: a.action === "arrive" ? null : a.r, percent: a.percent, energy: a.energy, cpu_ms: a.ms,
  surplus: a.surplus, flower_error: a.flowerError, nectar: a.nectar, bee_ms: a.beeMs, bee_error: a.beeError, log: a.log,
  bee_version: a.beeVersion, flower_version: a.flowerVersion,
});

/** Like routes/api.js gameSocketFeed: "Bearer team-A" stands in for a session of a member of team A. */
async function resolve(req, room, game, url) {
  if (room !== "R" || game !== "G") throw Object.assign(new Error("Game not found"), { status: 404 });
  const auth = req.headers.authorization || "";
  const teamId = auth.startsWith("Bearer team-") ? auth.slice(12) : null;
  return {
    gameId: GAME, teamId, version: 7, after: Number(url.searchParams.get("after") ?? 0) || 0,
    fetchActions: async (after) => {
      const live = rows.slice(0, shown);
      const over = status === "finished";
      return {
        actions: live.filter((r) => r.seq > after).slice(0, PAGE).map((r) => actionView(r, teamId, over, over)),
        lastSeq: live.at(-1)?.seq ?? 0, clockMs: 0, round: live.at(-1)?.round ?? 0, status,
      };
    },
  };
}

/** A client that collects every message; until(pred) waits for the messages so far to satisfy pred. */
function connect(path, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  const messages = [];
  const waiters = new Set();
  ws.on("message", (data) => {
    messages.push(JSON.parse(String(data)));
    for (const w of waiters) w();
  });
  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const check = () => { if (pred(messages)) { waiters.delete(check); clearTimeout(t); resolve(messages); } };
    const t = setTimeout(() => { waiters.delete(check); reject(new Error(`timed out; got ${JSON.stringify(messages).slice(0, 300)}`)); }, ms);
    waiters.add(check);
    check();
  });
  const opened = new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("unexpected-response", (_req, res) => reject(Object.assign(new Error("refused"), { status: res.statusCode }))); ws.once("error", reject); });
  return { ws, messages, until, opened, actions: () => messages.flatMap((m) => m.actions || []) };
}
const caughtUp = (seq) => (msgs) => msgs.some((m) => m.actions?.some((a) => a.seq === seq));
const close = (c) => new Promise((resolve) => { if (c.ws.readyState === WebSocket.CLOSED) resolve(); else { c.ws.once("close", resolve); c.ws.close(); } });

/** An SSE client: the same messages as a socket, parsed from `data:` lines. */
function listen(path, headers = {}) {
  const messages = [];
  const ctl = new AbortController();
  const waiters = new Set();
  const done = (async () => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers, signal: ctl.signal });
    let buf = "";
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.startsWith("data: ")) messages.push(JSON.parse(block.slice(6)));
      }
      for (const w of waiters) w();
    }
  })().catch(() => {});
  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const check = () => { if (pred(messages)) { waiters.delete(check); clearTimeout(t); resolve(messages); } };
    const t = setTimeout(() => { waiters.delete(check); reject(new Error("sse timed out")); }, ms);
    waiters.add(check);
    check();
  });
  return { messages, until, close: () => { ctl.abort(); return done; }, actions: () => messages.flatMap((m) => m.actions || []) };
}

before(async () => {
  const config = normalizeConfig({ feedCost: 1 });
  const out = await play(config, [starters(config, "A"), starters(config, "B")], 16);
  rows = out.actions.map(toRow);
  assert.ok(rows.length > 3 * PAGE, `${rows.length} actions`);
  assert.ok(rows.some((r) => r.action === "feed") && rows.some((r) => r.action === "leave"));
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const m = url.pathname.match(/^\/api\/rooms\/([^/]+)\/games\/([^/]+)\/events$/);
    if (!m) { res.statusCode = 404; res.end(); return; }
    resolve(req, m[1], m[2], url).then((opts) => gameStream(req, res, opts), () => { res.statusCode = 404; res.end(); });
  });
  wss = attachGameSockets(server, resolve);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => {
  for (const ws of wss.clients) ws.terminate();
  return new Promise((r) => server.close(r));
});

test("a socket gets the game's version, then every action in order, each turn's arrival before its end, live as they're written", async () => {
  shown = Math.floor(rows.length / 2);
  const c = connect("/api/rooms/R/games/G/ws?after=0");
  await c.opened;
  await c.until(caughtUp(rows[shown - 1].seq));
  assert.deepEqual(c.messages[0], { version: 7 });
  // The rest of the game is written; the garden announces it the way live.js does.
  shown = rows.length;
  bus.emit("change", { game: GAME, seq: rows.at(-1).seq, clockMs: 0 });
  await c.until(caughtUp(rows.at(-1).seq));
  const got = c.actions();
  assert.deepEqual(got.map((a) => a.seq), rows.map((r) => r.seq), "every action once, in order, page after page");
  assert.ok(c.messages.filter((m) => m.actions).every((m) => m.actions.length <= PAGE && typeof m.lastSeq === "number" && m.status === "running"));
  const turns = new Map();
  for (const a of got) { const k = `${a.bee}:${a.turn}`; if (!turns.has(k)) turns.set(k, []); turns.get(k).push(a); }
  for (const acts of turns.values()) {
    assert.deepEqual(acts.map((a) => a.action === "arrive"), [true, false]);
    assert.equal(acts[1].flower, acts[0].flower);
  }
  assert.ok(got.some((a) => a.action === "arrive") && got.some((a) => a.action === "feed"));
  // Other news: a public change, and a team's own program change (to that team's members only).
  const member = connect("/api/rooms/R/games/G/ws?after=0", { authorization: "Bearer team-A" });
  await member.opened;
  bus.emit("change", { game: GAME, version: 8 });
  bus.emit("change", { game: GAME, team: "A", programs: true });
  bus.emit("change", { game: "another-game", version: 99 });
  await member.until((m) => m.some((x) => x.programs));
  await c.until((m) => m.some((x) => x.version === 8));
  assert.ok(!c.messages.some((m) => m.programs), "a spectator isn't told about a team's programs");
  assert.ok(![...c.messages, ...member.messages].some((m) => m.version === 99));
  await close(c);
  await close(member);
});

const SOCKET = "/api/rooms/R/games/G/ws?after=0", STREAM = "/api/rooms/R/games/G/events?after=0";
const asTeam = (t) => (t ? { authorization: `Bearer team-${t}` } : {});

test("during play each viewer's feed is filtered, over WebSocket and SSE alike: public turns, private details", async () => {
  shown = rows.length;
  status = "running";
  const last = rows.at(-1).seq;
  for (const team of [null, "A", "B"]) {
    const socket = connect(SOCKET, asTeam(team));
    const stream = listen(STREAM, asTeam(team));
    await socket.until(caughtUp(last));
    await stream.until(caughtUp(last));
    assert.deepEqual(stream.actions(), socket.actions(), `${team ?? "spectator"}: SSE and WebSocket carry the same actions`);
    const got = socket.actions();
    assert.equal(got.length, rows.length, "every turn of every bee, to everyone");
    for (const a of got) {
      const mineF = a.flower === team, mineB = a.bee === team;
      if (a.action === "arrive") continue;
      assert.ok("c" in a && "r" in a && "surplus" in a, "challenge, response and surplus are public");
      if (a.action === "feed") assert.ok(["percent", "energy", "nectar"].every((k) => k in a), "a feed is public in full");
      else {
        assert.equal(a.surplus, 0);
        assert.ok(!("nectar" in a));
        assert.equal("percent" in a, mineF, "an unfed turn's percent: the flower's team only");
        assert.equal("energy" in a, mineF);
      }
      assert.equal("ms" in a, mineF, "the flower's CPU time: its own team only");
      assert.equal("beeMs" in a, mineB, "the bee's decision time: its own team only");
      assert.equal("log" in a, mineB && a.log !== undefined);
    }
    if (team) {
      assert.ok(got.some((a) => a.flower === team && typeof a.ms === "number"));
      assert.ok(got.some((a) => a.bee === team && typeof a.beeMs === "number"));
    }
    await close(socket);
    await stream.close();
  }
});

test("after the game, every feed reveals everything to everyone", async () => {
  shown = rows.length;
  status = "finished";
  try {
    const last = rows.at(-1).seq;
    for (const team of [null, "A"]) {
      const socket = connect(SOCKET, asTeam(team));
      const stream = listen(STREAM, asTeam(team));
      await socket.until(caughtUp(last));
      await stream.until(caughtUp(last));
      assert.deepEqual(stream.actions(), socket.actions());
      for (const a of socket.actions()) {
        assert.ok("beeVersion" in a && "flowerVersion" in a);
        if (a.action === "arrive") continue;
        assert.ok(["percent", "energy", "ms", "beeMs", "surplus", "flowerError", "beeError"].every((k) => k in a), JSON.stringify(a));
      }
      await close(socket);
      await stream.close();
    }
  } finally {
    status = "running";
  }
});

test("?after= resumes without gaps or repeats", async () => {
  // The first socket sees part of the game, then drops; more is written; the second resumes after the
  // last action the first one got.
  shown = 2 * PAGE + 3;
  const first = connect("/api/rooms/R/games/G/ws?after=0");
  await first.until(caughtUp(rows[shown - 1].seq));
  await close(first);
  shown = rows.length;
  const seen = first.actions().map((a) => a.seq);
  const from = seen.at(-1);
  assert.equal(from, rows[2 * PAGE + 2].seq);
  const second = connect(`/api/rooms/R/games/G/ws?after=${from}`);
  await second.until(caughtUp(rows.at(-1).seq));
  await close(second);
  const rest = second.actions().map((a) => a.seq);
  assert.equal(rest[0], from + 1);
  assert.deepEqual([...seen, ...rest], rows.map((r) => r.seq));
});

test("closing a socket unsubscribes it; unknown games and paths are refused", async () => {
  shown = rows.length;
  const baseline = bus.listenerCount("change");
  const clients = [0, 1, 2].map(() => connect("/api/rooms/R/games/G/ws?after=0"));
  await Promise.all(clients.map((c) => c.opened));
  const stream = listen(STREAM);
  await stream.until((m) => m.length > 0);
  assert.equal(bus.listenerCount("change"), baseline + 4);
  await Promise.all(clients.map(close));
  await stream.close();
  for (let i = 0; i < 50 && bus.listenerCount("change") !== baseline; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(bus.listenerCount("change"), baseline, "no listeners left behind");
  // A socket dropped without a closing handshake is cleaned up too.
  const rude = connect("/api/rooms/R/games/G/ws?after=0");
  await rude.opened;
  rude.ws.terminate();
  for (let i = 0; i < 50 && bus.listenerCount("change") !== baseline; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(bus.listenerCount("change"), baseline);
  for (const path of ["/api/rooms/R/games/nope/ws", "/api/rooms/R/games/G/elsewhere"]) {
    await assert.rejects(connect(path).opened, (e) => e.status === 404, path);
  }
});
