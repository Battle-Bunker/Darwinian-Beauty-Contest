// The game feed over WebSockets (server/sockets.js, sharing realtime.js's gameFeed with SSE): the same
// messages, filtered per viewer, resumable with ?after=, and nothing left subscribed once a socket closes.
// The database is stood in for by a resolver over a real garden's actions, filtered by the real actionView.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { attachGameSockets } from "../server/sockets.js";
import { bus } from "../server/realtime.js";
import { actionView } from "../server/games.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { starters } from "./fixtures/programs.js";
import { play } from "./fixtures/garden.js";

const GAME = "game-1", TEAMS = ["A", "B"], PAGE = 10;
let rows = [], shown = 0, server, port, wss;

// Actions as the database stores them (live.js), so actionView filters them exactly as for a real viewer.
const toRow = (a) => ({
  seq: a.seq, at_ms: a.atMs, round: a.round, bee_team: TEAMS[a.bee], visit: a.visit, patch_team: TEAMS[a.patch], kind: a.kind,
  action: a.action, c: a.c, r: a.r, after: a.after, nectar: a.nectar, ms: a.ms, bee_ms: a.beeMs, error: a.error, error_by: a.by,
  log: a.log, bee_version: a.beeVersion, flower_version: a.flowerVersion,
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
      return {
        actions: live.filter((r) => r.seq > after).slice(0, PAGE).map((r) => actionView(r, teamId, false, false)),
        lastSeq: live.at(-1)?.seq ?? 0, clockMs: 0, round: live.at(-1)?.round ?? 0, status: "running",
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

before(async () => {
  const config = normalizeConfig({ feedCost: 1 });
  const s = starters(config);
  const out = await play(config, [s, s], 12);
  rows = out.actions.map(toRow);
  assert.ok(rows.length > 3 * PAGE, `${rows.length} actions`);
  server = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
  wss = attachGameSockets(server, resolve);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => {
  for (const ws of wss.clients) ws.terminate();
  return new Promise((r) => server.close(r));
});

test("a socket gets the game's version, then every action in order, arrivals before asks, live as they're written", async () => {
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
  const visits = new Map();
  for (const a of got) { const k = `${a.bee}:${a.visit}`; if (!visits.has(k)) visits.set(k, []); visits.get(k).push(a); }
  for (const acts of visits.values()) {
    assert.equal(acts[0].action, "arrive");
    if (acts[1]) assert.equal(acts[1].action, "ask");
  }
  assert.ok(got.some((a) => a.action === "arrive") && got.some((a) => a.action === "ask"));
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

test("a team member sees their own timings; a spectator and other teams don't", async () => {
  shown = rows.length;
  const last = rows.at(-1).seq;
  const [spectator, a, b] = [connect("/api/rooms/R/games/G/ws?after=0"), connect("/api/rooms/R/games/G/ws?after=0", { authorization: "Bearer team-A" }), connect("/api/rooms/R/games/G/ws?after=0", { authorization: "Bearer team-B" })];
  await Promise.all([spectator, a, b].map((c) => c.until(caughtUp(last))));
  const asks = (c) => c.actions().filter((x) => x.action === "ask");
  assert.ok(asks(spectator).every((x) => !("ms" in x) && !("beeMs" in x)), "a spectator sees no timings");
  assert.ok(asks(spectator).every((x) => x.kind === "cosmos" || x.kind === "orchid"), "but which flower, yes");
  for (const [c, me] of [[a, "A"], [b, "B"]]) {
    assert.ok(asks(c).every((x) => ("ms" in x) === (x.patch === me)), `${me}: answer times at its own patch only`);
    assert.ok(asks(c).every((x) => ("beeMs" in x) === (x.bee === me)), `${me}: decision times of its own bee only`);
    assert.ok(asks(c).some((x) => typeof x.beeMs === "number") && asks(c).some((x) => typeof x.ms === "number"));
  }
  await Promise.all([spectator, a, b].map(close));
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
  assert.equal(bus.listenerCount("change"), baseline + 3);
  await Promise.all(clients.map(close));
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
