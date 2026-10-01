// Dev provider: anyone may log in as any name. For local development and simulations only.
// The same name (case-insensitive) always maps to the same user, so scripts can log back in.
import express from "express";
import { startSession, upsertUser } from "./sessions.js";

export const name = "dev";

/** Tells the web UI how to log in: show a name form that POSTs to loginUrl. */
export const describe = () => ({ provider: "dev", kind: "name-form", loginUrl: "/api/auth/dev/login" });

export function router() {
  const r = express.Router();
  r.post("/dev/login", async (req, res, next) => {
    try {
      const display = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!display) return res.status(400).json({ error: "Name required" });
      const user = await upsertUser({ provider: "dev", subject: display.toLowerCase(), name: display });
      const token = await startSession(res, user.id);
      res.json({ user, token });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
