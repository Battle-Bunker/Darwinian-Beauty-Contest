// Placeholder for production auth via Replit Auth (OpenID Connect). Not implemented yet.
//
// To implement (e.g. with `openid-client`), keep this module's shape:
//   describe() -> { provider: "replit", kind: "redirect", loginUrl: "/api/auth/replit/login" }
//   router()   -> express.Router with
//       GET /replit/login     redirect to Replit's authorization endpoint
//       GET /replit/callback  verify the code, then:
//           const user = await upsertUser({ provider: "replit", subject: claims.sub,
//                                           name: claims.first_name || claims.username, profile: claims });
//           await startSession(res, user.id); res.redirect(returnTo || "/");
// Everything else (sessions, req.user, permissions) is provider-independent and needs no change.
// Agents and scripts keep using `Authorization: Bearer <token>`; a production deployment may want
// an endpoint for logged-in users to mint such tokens.
import express from "express";

export const name = "replit";
export const describe = () => ({ provider: "replit", kind: "redirect", loginUrl: "/api/auth/replit/login" });
export function router() {
  const r = express.Router();
  r.get("/replit/login", (_req, res) => res.status(501).send("Replit Auth is not configured yet (see server/auth/replit.js)."));
  return r;
}
