// Thin client for the game's HTTP API (see docs/API.md). Everything the arena does to games goes through here.
const BASE = process.env.ARENA_API || "http://localhost:4000";

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(token, method, path, body, { okStatuses = [422], retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res, json;
    try {
      res = await fetch(BASE + "/api" + path, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      throw new ApiError(0, `${method} ${path}: ${e.message}`);
    }
    if (res.ok || okStatuses.includes(res.status)) return json;
    if (res.status >= 500 && attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
    throw new ApiError(res.status, `${method} ${path} -> ${res.status} ${json.error || ""}`, json);
  }
}

const tokens = new Map();
export async function login(name) {
  if (!tokens.has(name)) tokens.set(name, (await api(null, "POST", "/auth/dev/login", { name })).token);
  return tokens.get(name);
}

export const gamePath = (room, game) => `/rooms/${room}/games/${game}`;

export const Api = {
  createRoom: (tok) => api(tok, "POST", "/rooms"),
  room: (room) => api(null, "GET", `/rooms/${room}`),
  createGame: (tok, room, config) => api(tok, "POST", `/rooms/${room}/games`, { config }),
  patchConfig: (tok, g, config) => api(tok, "PATCH", `${g}/config`, { config }),
  createTeam: (tok, g, name) => api(tok, "POST", `${g}/teams`, { name }),
  check: (tok, g, kind, code) => api(tok, "POST", `${g}/check`, { kind, code }),
  submit: (tok, g, kind, code) => api(tok, "POST", `${g}/programs`, { kind, code }),
  try: (tok, g, kind, code, challenges) => api(tok, "POST", `${g}/try`, { kind, code, challenges }),
  view: (tok, g) => api(tok, "GET", g),
  version: (g) => api(null, "GET", `${g}/version`),
  /** Start the next round and poll until it has been stored (avoids long-held HTTP requests). */
  async runRound(tok, g) {
    const before = await api(null, "GET", `${g}/version`);
    const { round } = await api(tok, "POST", `${g}/rounds`, undefined, { retries: 0 });
    for (;;) {
      await sleep(1500);
      const v = await api(null, "GET", `${g}/version`);
      if (v.roundsPlayed >= round) return { round };
      if (!v.runningRound && v.roundsPlayed === before.roundsPlayed) {
        const view = await api(tok, "GET", g);
        if (!view.game.runningRound && view.game.roundsPlayed < round) throw new ApiError(500, `round ${round} failed: ${view.game.lastError}`);
      }
    }
  },
};

export const WEB_BASE = process.env.ARENA_WEB || BASE;
