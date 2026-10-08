import express from "express";
import { authRouter, provider, requireUser, sessionMiddleware } from "../auth/index.js";
import * as G from "../games.js";
import { gameStream, roomStream } from "../realtime.js";

const wrap = (fn) => (req, res, next, ...rest) => Promise.resolve(fn(req, res, next, ...rest)).catch(next);

/**
 * The game feed for a WebSocket upgrade at /api/rooms/:room/games/:game/ws?after=<seq> (server/sockets.js):
 * the same viewer, game and filtering as the SSE route below. The session comes from the cookie or an
 * `Authorization: Bearer` token, as for every request; spectators need neither.
 */
export async function gameSocketFeed(req, roomId, gameId, url) {
  await new Promise((resolve, reject) => sessionMiddleware(req, null, (e) => (e ? reject(e) : resolve())));
  const room = await G.findRoom(roomId);
  const game = await G.findGame(room, gameId);
  return {
    gameId: game.id, teamId: await G.myTeamId(game, req.user), version: game.version,
    after: Number(url.searchParams.get("after") ?? game.last_seq) || 0,
    fetchActions: (after) => G.viewActions(game, req.user, { after, limit: 1000 }),
  };
}

export function apiRouter() {
  const r = express.Router();

  r.get("/health", (_req, res) => res.json({ ok: true }));
  r.use("/auth", authRouter());
  r.get("/me", (req, res) => res.json({ user: req.user, auth: provider.describe() }));
  r.get("/defaults", (_req, res) => res.json({ config: G.DEFAULT_CONFIG }));

  // Rooms: creation is one click; the creator owns the room.
  r.post("/rooms", requireUser, wrap(async (req, res) => res.status(201).json(await G.createRoom(req.user))));
  r.get("/my/rooms", requireUser, wrap(async (req, res) => res.json(await G.myRooms(req.user))));
  r.param("room", wrap(async (req, _res, next, id) => { req.room = await G.findRoom(id); next(); }));
  r.param("game", wrap(async (req, _res, next, id) => { req.game = await G.findGame(req.room, id); next(); }));
  r.get("/rooms/:room", wrap(async (req, res) => res.json(await G.viewRoom(req.room, req.user))));
  r.get("/rooms/:room/events", (req, res) => roomStream(req, res, req.room.id));
  r.post("/rooms/:room/games", requireUser, wrap(async (req, res) => res.status(201).json(await G.createGame(req.room, req.user, req.body?.config))));

  // Games: one view for everyone, filtered to what this viewer may know.
  const base = "/rooms/:room/games/:game";
  r.get(base, wrap(async (req, res) => res.json(await G.viewGame(req.room, req.game, req.user))));
  r.get(`${base}/actions`, wrap(async (req, res) => res.json(await G.viewActions(req.game, req.user, { after: req.query.after, before: req.query.before, limit: req.query.limit, mine: req.query.mine }))));
  r.post(`${base}/query`, wrap(async (req, res) => res.json(await G.queryGame(req.game, req.user, req.body))));
  r.post("/rooms/:room/query", wrap(async (req, res) => res.json(await G.queryRoom(req.room, req.user, req.body))));
  r.get("/query/schema", (_req, res) => res.json(G.querySchema()));
  r.get(`${base}/ledger`, wrap(async (req, res) => res.json(await G.viewLedger(req.game, req.user, { after: req.query.after, limit: req.query.limit }))));
  r.get(`${base}/responses/:seq`, wrap(async (req, res) => {
    const body = await G.viewResponse(req.game, req.params.seq);
    if (body === null) return res.status(404).json({ error: "That turn has no response" });
    res.type("application/json").set("Cache-Control", "public, max-age=31536000, immutable").send(body);
  }));
  r.get(`${base}/scores`, wrap(async (req, res) => res.json(await G.viewScores(req.game))));
  r.get(`${base}/prevalence`, wrap(async (req, res) => res.json(await G.viewPrevalence(req.game, { after: req.query.after, limit: req.query.limit }))));
  r.get(`${base}/events`, wrap(async (req, res) => gameStream(req, res, {
    gameId: req.game.id, teamId: await G.myTeamId(req.game, req.user), version: req.game.version,
    after: Number(req.query.after ?? req.game.last_seq) || 0,
    fetchActions: (after) => G.viewActions(req.game, req.user, { after, limit: 1000 }),
  })));
  r.patch(`${base}/config`, requireUser, wrap(async (req, res) => res.json(await G.updateConfig(req.room, req.game, req.user, req.body?.config ?? req.body))));
  r.post(`${base}/start`, requireUser, wrap(async (req, res) => res.json(await G.startGame(req.room, req.game, req.user))));
  r.post(`${base}/status`, requireUser, wrap(async (req, res) => res.json(await G.setStatus(req.room, req.game, req.user, req.body?.action))));
  r.post(`${base}/teams`, requireUser, wrap(async (req, res) => res.status(201).json(await G.createTeam(req.game, req.user, req.body?.name))));
  r.post(`${base}/teams/join`, requireUser, wrap(async (req, res) => res.json(await G.joinTeam(req.game, req.user, req.body?.joinCode))));
  r.post(`${base}/check`, requireUser, wrap(async (req, res) => res.json(await G.checkProgram(req.game, req.user, req.body?.kind, req.body?.code))));
  r.post(`${base}/programs`, requireUser, wrap(async (req, res) => {
    const out = await G.submitProgram(req.game, req.user, req.body?.kind, req.body?.code);
    res.status(out.ok ? 200 : 422).json(out);
  }));
  r.post(`${base}/try`, requireUser, wrap(async (req, res) => res.json(await G.tryProgram(req.game, req.user, req.body || {}))));

  r.use((err, _req, res, _next) => {
    if (!(err instanceof G.HttpError)) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error: " + err.message });
  });
  return r;
}
