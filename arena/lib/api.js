// Thin client for the game's HTTP API (docs/API.md). Everything the arena does to games goes through here; the team
// tokens and the dev-login secret live only in this process (never in a workspace or a prompt).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = process.env.ARENA_API || "http://localhost:4000";

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(token, method, path_, body, { okStatuses = [422], retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res, json;
    try {
      res = await fetch(BASE + "/api" + path_, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      throw new ApiError(0, `${method} ${path_}: ${e.message}`);
    }
    if (res.ok || okStatuses.includes(res.status)) return json;
    if (res.status >= 500 && attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
    throw new ApiError(res.status, `${method} ${path_} -> ${res.status} ${json.error || ""}`, json);
  }
}

// Servers started with DEV_LOGIN_SECRET require it at dev login (so agents can't log in as rival teams).
// The runner reads it from its env or arena/runs/.dev-secret; it never goes into workspaces or prompts.
const SECRET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runs", ".dev-secret");
const devSecret = () => process.env.ARENA_DEV_SECRET || (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, "utf8").trim() : undefined);
const tokens = new Map();
export async function login(name) {
  if (!tokens.has(name)) tokens.set(name, (await api(null, "POST", "/auth/dev/login", { name, secret: devSecret() })).token);
  return tokens.get(name);
}

export const gamePath = (room, game) => `/rooms/${room}/games/${game}`;
/** The public (credential-free) URL of a game's API, as agents may read it: GET only. */
export const publicGameUrl = (room, game) => `${BASE}/api${gamePath(room, game)}`;

export const Api = {
  createRoom: (tok) => api(tok, "POST", "/rooms"),
  room: (room) => api(null, "GET", `/rooms/${room}`),
  createGame: (tok, room, config) => api(tok, "POST", `/rooms/${room}/games`, { config }),
  patchConfig: (tok, g, config) => api(tok, "PATCH", `${g}/config`, { config }),
  createTeam: (tok, g, name) => api(tok, "POST", `${g}/teams`, { name }),
  check: (tok, g, kind, code) => api(tok, "POST", `${g}/check`, { kind, code }),
  // A 422 (too big, can't afford it yet, game over) comes back as a body with ok: false and errors.
  submit: (tok, g, kind, code) => api(tok, "POST", `${g}/programs`, { kind, code }, { retries: 1 }),
  try: (tok, g, kind, code, challenges, flowers) => api(tok, "POST", `${g}/try`, { kind, code, challenges, flowers }),
  view: (tok, g) => api(tok, "GET", g),
  /** mine: only the actions of the team's bee and at its patch, as the team sees them (its token). */
  actions: (tok, g, after = 0, limit = 5000, { mine = false } = {}) => api(tok, "GET", `${g}/actions?after=${after}&limit=${limit}${mine ? "&mine=1" : ""}`),
  scores: (g) => api(null, "GET", `${g}/scores`),
  start: (tok, g) => api(tok, "POST", `${g}/start`),
  /** action: pause | resume | finish (the room owner). */
  status: (tok, g, action) => api(tok, "POST", `${g}/status`, { action }, { okStatuses: [409] }),
};
