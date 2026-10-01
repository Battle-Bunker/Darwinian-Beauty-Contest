import express from "express";
import { authRouter, provider, requireUser } from "../auth/index.js";
import * as G from "../games.js";
import { sse } from "../realtime.js";

const wrap = (fn) => (req, res, next, ...rest) => Promise.resolve(fn(req, res, next, ...rest)).catch(next);

export function apiRouter() {
  const r = express.Router();

  r.get("/health", (_req, res) => res.json({ ok: true }));
  r.use("/auth", authRouter());
  r.get("/me", (req, res) => res.json({ user: req.user, auth: provider.describe() }));
  r.get("/defaults", (_req, res) => res.json({ config: G.DEFAULT_CONFIG }));

  // Rooms: creation is one click; the creator owns the room.
  r.post("/rooms", requireUser, wrap(async (req, res) => res.status(201).json(await G.createRoom(req.user))));
  r.param("room", wrap(async (req, _res, next, id) => { req.room = await G.findRoom(id); next(); }));
  r.param("game", wrap(async (req, _res, next, id) => { req.game = await G.findGame(req.room, id); next(); }));
  r.get("/rooms/:room", wrap(async (req, res) => res.json(await G.viewRoom(req.room, req.user))));
  r.get("/rooms/:room/events", (req, res) => sse(req, res, { room: req.room.id }, { room: req.room.id }));
  r.post("/rooms/:room/games", requireUser, wrap(async (req, res) => res.status(201).json(await G.createGame(req.room, req.user, req.body?.config))));

  // Games: one view for everyone, filtered to what this viewer may know.
  const base = "/rooms/:room/games/:game";
  r.get(base, wrap(async (req, res) => res.json(await G.viewGame(req.room, req.game, req.user))));
  r.get(`${base}/version`, (req, res) => res.json({ version: req.game.version, status: req.game.status, runningRound: req.game.running_round, roundsPlayed: req.game.rounds_played }));
  r.get(`${base}/events`, (req, res) => sse(req, res, { game: req.game.id }, { game: req.game.id, version: req.game.version }));
  r.patch(`${base}/config`, requireUser, wrap(async (req, res) => res.json(await G.updateConfig(req.room, req.game, req.user, req.body?.config ?? req.body))));
  r.post(`${base}/teams`, requireUser, wrap(async (req, res) => res.status(201).json(await G.createTeam(req.game, req.user, req.body?.name))));
  r.post(`${base}/teams/join`, requireUser, wrap(async (req, res) => res.json(await G.joinTeam(req.game, req.user, req.body?.joinCode))));
  r.post(`${base}/check`, requireUser, wrap(async (req, res) => {
    const view = await G.viewGame(req.room, req.game, req.user);
    if (!view.myTeam) return res.status(403).json({ error: "Join a team first" });
    res.json(await G.checkProgram(req.game, view.myTeam, req.body?.kind, req.body?.code));
  }));
  r.post(`${base}/programs`, requireUser, wrap(async (req, res) => {
    const out = await G.submitProgram(req.game, req.user, req.body?.kind, req.body?.code);
    res.status(out.ok ? 200 : 422).json(out);
  }));
  r.post(`${base}/try`, requireUser, wrap(async (req, res) => res.json(await G.tryProgram(req.game, req.user, req.body?.kind, req.body?.code, req.body?.challenges))));
  r.post(`${base}/rounds`, requireUser, wrap(async (req, res) => {
    const { round, done } = await G.startRound(req.room, req.game, req.user);
    if (req.query.wait) {
      try { await done; } catch (e) { return res.status(500).json({ error: `Round ${round} failed: ${e.message}` }); }
      return res.json({ round, finished: true });
    }
    done.catch(() => {});
    res.status(202).json({ round, finished: false });
  }));

  r.use((err, _req, res, _next) => {
    if (!(err instanceof G.HttpError)) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error: " + err.message });
  });
  return r;
}
