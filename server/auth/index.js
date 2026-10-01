import express from "express";
import { env } from "../config.js";
import * as dev from "./dev.js";
import * as replit from "./replit.js";
import { endSession, requireUser, sessionMiddleware } from "./sessions.js";

const PROVIDERS = { dev, replit };
export const provider = PROVIDERS[env.authProvider];
if (!provider) throw new Error(`Unknown AUTH_PROVIDER "${env.authProvider}"`);

export { requireUser, sessionMiddleware };

export function authRouter() {
  const r = express.Router();
  r.get("/provider", (_req, res) => res.json(provider.describe()));
  r.use(provider.router());
  r.post("/logout", async (req, res, next) => {
    try { await endSession(req, res); res.json({ ok: true }); } catch (e) { next(e); }
  });
  return r;
}
