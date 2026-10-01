# Darwinian Beauty Contest

A coding game inspired by the evolutionary arms race between flowers and the bees that judge their
beauty. Teams of humans and AIs ("centaurs") write three programs:

- **clover**: a rewarding flower (after white clover, the classic honest nectar plant)
- **orchid**: a deceptive flower (after the bee orchid, *Ophrys apifera*, the classic deceiver)
- **bee**: questions flowers and decides where to feed

Flowers are pure functions from a challenge to a response. Bees remember things within a round. Your
fitness rewards *diverse* success on both sides of the arms race: getting bees from many teams to
feed at your patch (**allure**) and getting real nectar from many teams' patches (**forage**).

**[RULES.md](RULES.md)** has the full rules for players. **[docs/API.md](docs/API.md)** documents the HTTP API.

## Run locally

```
npm install
./scripts/dev-db.sh          # local Postgres (or set DATABASE_URL)
npm start                    # http://localhost:3000, runs migrations on boot
npm test                     # unit tests
npm run smoke                # plays a short game through the API (server must be running)
```

Needs Node ≥ 22.13 and `python3` on PATH (for Python games).

## Architecture

| Path | What |
|---|---|
| `server/index.js` | Express app: JSON API under `/api`, the web app from `web/dist`, `vendor/` for the browser |
| `server/games.js` | rooms, games, teams, submissions, rounds, and the **viewer-filtered game view** |
| `server/engine.js` | the round simulator: programs + config + seed in, visits and ledgers out |
| `server/runners/` | program runners. Python flowers fork per call (stateless); bees keep one process per round. TypeScript uses fresh `vm` contexts |
| `server/lib/scoring.js` | rootsum → allure / forage → shares → fitness |
| `server/lib/shortid.js` | Crockford base32 codes and shortest-unique-prefix allocation |
| `server/auth/` | pluggable login. `dev` = name only. Production adds e.g. Replit Auth in `replit.js` with the same shape |
| `server/db/migrations/` | SQL schema, applied on boot |
| `web/` | the web app |
| `arena/` | LLM-agent tournaments for exploring the game's ecosystem |

**One view, no replay mode.** Every round's programs, every visit and every score are stored in
Postgres. `GET /api/rooms/:room/games/:game` rebuilds the whole game for whoever is asking, filtered to
what they're allowed to know: public garden activity for everyone, private logs and code for your own
team, and everything once a finished game is revealed. Loading a game page mid-game or a year later
gives the same viewer the same information. Live clients listen on an SSE stream (fed by Postgres
`LISTEN/NOTIFY`, so several server instances work) and refetch when the version changes.

**Short ids.** Rooms and games have UUID primary keys and store their Crockford base32 `code` plus a
`prefix_len` fixed at creation: the shortest prefix no earlier record shared. Since later records
always take a longer prefix than anything they collide with, `code LIKE prefix% AND prefix_len <=
length(prefix)` resolves to exactly one record forever. Game ids are unique within their room.

**Auth.** `AUTH_PROVIDER=dev` (the default) shows a name prompt. Every request resolves `req.user`
from a session token (cookie or `Authorization: Bearer`), whatever provider issued it. To add Replit
Auth, implement `server/auth/replit.js` (the file describes the OIDC flow) and set
`AUTH_PROVIDER=replit`. Users are keyed by `(auth_provider, auth_subject)`.

**Not a security sandbox.** Programs run in separate processes with restricted builtins, an import
whitelist, no environment variables, timeouts and memory caps. That stops accidents, but it won't stop
a determined attacker. Production should run the runners inside a real sandbox (container, gVisor,
nsjail, or a WASM interpreter).

## Environment

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgres://dbc:dbc@localhost:5432/dbc` |
| `PORT` | `3000` |
| `AUTH_PROVIDER` | `dev` |
| `COOKIE_SECURE` | unset (set `1` behind https) |
| `MAX_CONCURRENT_ROUNDS` | `4` per server process |
