// Provider-independent sessions: an opaque random token, stored hashed. Sent as an HttpOnly
// cookie for browsers or as `Authorization: Bearer <token>` for scripts and agents.
import crypto from "node:crypto";
import { query } from "../db/pool.js";
import { env } from "../config.js";

export const COOKIE = "dbc_session";
const TTL_DAYS = 30;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

/** Find or create the user for an identity a provider has vouched for. */
export async function upsertUser({ provider, subject, name, profile = {} }) {
  const { rows } = await query(
    `INSERT INTO users (id, name, auth_provider, auth_subject, profile) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (auth_provider, auth_subject) DO UPDATE SET name = EXCLUDED.name, profile = users.profile || EXCLUDED.profile
     RETURNING id, name`,
    [crypto.randomUUID(), name, provider, subject, profile],
  );
  return rows[0];
}

export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${TTL_DAYS} days')`, [hash(token), userId]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.cookieSecure, maxAge: TTL_DAYS * 864e5, path: "/" });
  return token;
}

function tokenFrom(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  const cookie = req.headers.cookie || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Sets req.user to {id, name} or null. */
export async function sessionMiddleware(req, _res, next) {
  req.user = null;
  const token = tokenFrom(req);
  if (token) {
    try {
      const { rows } = await query(
        `SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hash(token)],
      );
      req.user = rows[0] || null;
      req.sessionTokenHash = req.user ? hash(token) : null;
    } catch (e) {
      return next(e);
    }
  }
  next();
}

export async function endSession(req, res) {
  if (req.sessionTokenHash) await query("DELETE FROM sessions WHERE token_hash = $1", [req.sessionTokenHash]);
  res.clearCookie(COOKIE, { path: "/" });
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Log in first" });
  next();
}
