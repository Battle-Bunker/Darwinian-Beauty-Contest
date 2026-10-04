# Darwinian Beauty Contest

A coding game inspired by the evolutionary arms race between flowers and the bees that judge their
beauty. Teams of humans and AIs ("centaurs") write two programs (this is the **one flower** variant, on
the `claude/one-flower` branch):

- **flower**: answers a bee's challenge with a response and a **percent**: the share of this turn's excess
  energy it gives the bee as nectar if the bee feeds
- **bee**: asks flowers challenges and, after each answer, decides whether to feed

A game is one continuous garden of 200 ms rounds. Every round, each bee that isn't feeding takes a turn at a
flower drawn at random (its own included): the flower has 150 ms, the bee 50 ms. A flower allocates its
energy between **compute**, **nectar** and **pollen**: its **excess energy** is (size cap − its size) ×
(150 ms − the CPU time it used), and a feed splits it into nectar for the bee and pollen the flower keeps;
a turn without a feed pays nobody. Every turn is public as it
happens (who visited whom, the challenge, the response, whether the bee fed, and a feed's percent, energy,
nectar and pollen), and so is the scoreboard; code, timings and the details of unfed turns stay with
their teams until the end. Both programs query the team's history of every finished turn through a typed,
immutable `HISTORY` global, kept up to date between their timed calls; operators and agents run the same
queries over HTTP (docs/QUERY.md). Each program earns a change budget as the game goes on, and a team can spend it at any
moment on a new version. Fitness rewards *diverse* success: energy your flower kept from many teams' bees
(**pollination**) and nectar your bee got from many teams' flowers (**forage**).

**[RULES.md](RULES.md)** has the full rules for players. **[docs/API.md](docs/API.md)** documents the HTTP API.

## Run locally

```
npm install
./scripts/dev-db.sh          # local Postgres with database dbc_one (or set DATABASE_URL)
npm run build                # builds the web app (web/ → web/dist)
npm start                    # http://localhost:3000, runs migrations on boot
npm test                     # unit tests
npm run smoke                # plays two short games through the API, SSE and WebSocket (server must be running)
npm run demo                 # seeds a room with live 6-team games (log in as "Gardener" or "Ada")
```

Needs Node ≥ 22.13 and `python3` on PATH (for Python games).

To work on the web app with hot reload, run the server and then `API=http://localhost:3000 npm run dev:web`
(Vite on :5173, proxying `/api` and `/vendor` to the server).

## Architecture

| Path | What |
|---|---|
| `server/index.js` | Express app: JSON API under `/api`, the web app from `web/dist`, `vendor/` for the browser |
| `server/games.js` | rooms, games, teams, programs and change budgets, start/pause/finish, and the **viewer-filtered views** (actions, team ledger, game view, scoreboard) |
| `server/engine.js` | the garden: lockstep 200 ms rounds, one turn per bee; queued challenges, flowers drawn at random, excess energy from CPU time, responses delivered at 150 ms, 50 ms bee decisions with late replies; the team ledger delivered between turns; versions pinned per turn; actions and ledgers out |
| `server/live.js` | runs each running game's garden in one server process (advisory lock), writing actions, clock and ledgers 4× a second (arrivals at once); adoption restores the team ledgers |
| `server/realtime.js`, `server/sockets.js` | the live game feed for each viewer, over SSE and WebSocket (the same messages), fed by Postgres `LISTEN/NOTIFY` |
| `server/runners/` | program runners. Python flowers fork per call (stateless, CPU-timed, the ledger inherited through the fork); a bee is one process for as long as its version plays. TypeScript flowers run in fresh `vm` contexts and read the ledger from a locked-down realm |
| `server/lib/scoring.js` | rootsum → pollination / forage → shares → fitness (N² × the two shares) |
| `server/lib/shortid.js` | Crockford base32 codes and shortest-unique-prefix allocation |
| `server/auth/` | pluggable login. `dev` = name only. Production adds e.g. Replit Auth in `replit.js` with the same shape |
| `server/db/migrations/` | SQL schema, applied on boot |
| `vendor/measure.js` | how programs are measured (size, change, diff marks); the same file runs in the server and the browser |
| `web/` | the web app: Vite + React + TypeScript, built to `web/dist` |
| `arena/` | LLM-agent tournaments for exploring the game's ecosystem |

**One view, no replay mode.** Every program version, every turn and the score ledgers are stored in
Postgres. `GET /api/rooms/:room/games/:game`, `GET .../actions` and `GET .../ledger` rebuild the game for
whoever is asking: every turn's public part for everyone, and each team's private details (its unfed
turns' percent and energy, its flower's compute time, its bee's timings and prints, its code and budgets)
for that team, or for everyone once the game is over. Loading a game page mid-game or a year later gives
the same viewer the same information. Live clients follow a stream, over a WebSocket (`.../ws`) or
Server-Sent Events (`.../events`), with the same messages either way: it carries new actions as they're
written (each bee's arrival at a flower included, the moment it happens) and tells clients to refetch the
view when anything else changes. It's fed by Postgres `LISTEN/NOTIFY`, so several server instances work.

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
| `DATABASE_URL` | `postgres://dbc:dbc@localhost:5432/dbc_one` |
| `PORT` | `3000` |
| `AUTH_PROVIDER` | `dev` |
| `COOKIE_SECURE` | unset (set `1` behind https) |
| `CPU_SLOTS` | CPU cores: at most this many programs run at once in a server process, so time limits stay fair (rounds take longer in wall time if a round needs more) |
| `DEV_LOGIN_SECRET` | unset. When set, the dev name login also requires `{"secret"}` (for arena servers where AI teams must not sign in as each other) |
