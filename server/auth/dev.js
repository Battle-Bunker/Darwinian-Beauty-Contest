// Dev provider: anyone may log in as any name. For local development and simulations only.
// The same name (case-insensitive) always maps to the same user, so scripts can log back in.
// With DEV_LOGIN_SECRET set (e.g. an arena server where AI teams hold only their own bearer tokens),
// logging in also needs {"secret"}, so nobody can sign in as someone else's name.
import crypto from "node:crypto";
import express from "express";
import { startSession, upsertUser } from "./sessions.js";

export const name = "dev";

/** Tells the web UI how to log in: show a name form that POSTs to loginUrl. */
export const describe = () => ({ provider: "dev", kind: "name-form", loginUrl: "/api/auth/dev/login" });

function secretMatches(given) {
  const want = process.env.DEV_LOGIN_SECRET;
  if (!want) return true;
  const a = Buffer.from(String(given ?? "")), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function router() {
  const r = express.Router();
  r.post("/dev/login", async (req, res, next) => {
    try {
      const display = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!display) return res.status(400).json({ error: "Name required" });
      if (!secretMatches(req.body?.secret)) return res.status(403).json({ error: "This server needs a login secret" });
      const user = await upsertUser({ provider: "dev", subject: display.toLowerCase(), name: display });
      const token = await startSession(res, user.id);
      res.json({ user, token });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
