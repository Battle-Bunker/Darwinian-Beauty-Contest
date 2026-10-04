// Thin client for the game's HTTP API (docs/API.md). Everything the arena does to games goes through here; the team
// tokens and the dev-login secret live only in this process (never in a workspace or a prompt).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = process.env.ARENA_API || "http://localhost:4100";

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
  /** A flower on challenges (`history`: turn records for its HISTORY.turns, default none); a bee for `rounds` rounds in a
   * garden of just its own flower (`flower`: that code, else the team's latest flower). */
  tryFlower: (tok, g, code, challenges, history) => api(tok, "POST", `${g}/try`, { kind: "flower", code, challenges, ledger: history }),
  /** memory: what the test bee starts with (default {}); a try never touches the game bee's MEMORY. */
  tryBee: (tok, g, code, { flower, rounds, memory } = {}) => api(tok, "POST", `${g}/try`, { kind: "bee", code, flower, rounds, memory }),
  view: (tok, g) => api(tok, "GET", g),
  /** mine: only the turns of the team's bee and at its flower, as the team sees them (its token). Without a token: the
   * public fields only. */
  actions: (tok, g, after = 0, limit = 5000, { mine = false } = {}) => api(tok, "GET", `${g}/actions?after=${after}&limit=${limit}${mine ? "&mine=1" : ""}`),
  /** The team ledger: exactly what the team's programs get (its token); a spectator gets the public fields. */
  ledger: (tok, g, after = 0, limit = 5000) => api(tok, "GET", `${g}/ledger?after=${after}&limit=${limit}`),
  scores: (tok, g) => api(tok, "GET", `${g}/scores`),
  /** A history query (docs/QUERY.md): one game as the viewer may see it (its token; none: the public fields). */
  query: (tok, g, ast) => api(tok, "POST", `${g}/query`, ast, { okStatuses: [] }),
  /** A history query across a room's finished games (fully revealed). */
  roomQuery: (tok, room, ast) => api(tok, "POST", `/rooms/${room}/query`, ast, { okStatuses: [] }),
  start: (tok, g) => api(tok, "POST", `${g}/start`),
  /** action: pause | resume | finish (the room owner). */
  status: (tok, g, action) => api(tok, "POST", `${g}/status`, { action }, { okStatuses: [409] }),
};
