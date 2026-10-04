# HTTP API (one flower per team)

All endpoints live under `/api` and speak JSON. Errors look like `{ "error": "message" }` with a 4xx/5xx
status. Room and game ids in paths are **short ids**: the shortest Crockford base32 prefix that was
unique when the record was created (any longer prefix, up to the full 26-character code, also works,
and so does lowercase). Pages live at `/room/<roomShortId>/game/<gameShortId>`.

RULES.md has the game itself. In short: each team has one **flower** and one **bee**; every 200 ms round,
each bee that isn't feeding takes one **turn**: the engine draws a flower at random (own included), the
flower answers `[response, percent]` within 150 ms, and the bee decides `["feed" | "leave", next]` within
50 ms. Excess energy E = (flower size cap − flower size) × max(0, 150 − flower CPU ms); a feed pays
nectar = percent/100 × E to the bee and the rest to the flower team's surplus; a turn without a feed pays
nobody (its energy is lost). fitness = N² × pollination share × forage share, where pollination is the
rootsum of the surplus a flower kept per bee team and forage the rootsum of the nectar a bee got per flower team.

## Auth

Sessions are provider-independent. Browsers get an HttpOnly cookie, and scripts send `Authorization: Bearer <token>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me` | | `{ user: {id, name} \| null, auth: {provider, kind, loginUrl} }` |
| GET | `/auth/provider` | | `{ provider: "dev", kind: "name-form", loginUrl }`. For `kind: "redirect"`, send the browser to `loginUrl` |
| POST | `/auth/dev/login` | `{ name }` | `{ user, token }` and sets the cookie. Same name means same user (dev only) |
| POST | `/auth/logout` | | `{ ok }` |

## Rooms

| Method | Path | Who | Returns |
|---|---|---|---|
| POST | `/rooms` | any user | `{ id, shortId, url, isOwner }`. One click; the creator owns the room |
| GET | `/my/rooms` | any user | `{ rooms: [{shortId, url, isOwner, ownerName, gameCount, createdAt, lastActivity}] }` |
| GET | `/rooms/:room` | anyone | `{ shortId, url, ownerName, isOwner, games: [{shortId, url, status, clockMs, endMs, teamCount}] }` |
| GET | `/rooms/:room/events` | anyone | Server-Sent Events `{game, version}` whenever a game in the room changes |
| POST | `/rooms/:room/games` | owner | body `{ config? }` → `{ id, shortId, url }` |
| GET | `/defaults` | anyone | `{ config }` with the default game settings |

## Games

`base = /rooms/:room/games/:game`. `kind` is `flower` or `bee` everywhere.

| Method | Path | Who | Body / query | Returns |
|---|---|---|---|---|
| GET | `base` | anyone | | the **game view** (below), filtered for the viewer |
| GET | `base/actions` | anyone | `?after=<seq>&limit=<n ≤ 5000>`, or `?before=<seq>&limit=<n>`; `&mine=1` (team members) for only turns of your bee or at your flower | `{ actions: [action], lastSeq, clockMs, round, status }`: the actions after `after`, oldest first; or the last `limit` before `before`, oldest first (`before = lastSeq + 1` gives the latest) |
| GET | `base/ledger` | anyone | `?after=<seq>&limit=<n ≤ 5000>` | `{ participants, team, entries: [entry], lastSeq, round, status }`: the **team ledger**, exactly what your programs get (below). `team` is your team's index in `participants` (null for a spectator, who gets the public fields only) |
| GET | `base/scores` | anyone | | `{ status, clockMs, endMs, round, lastSeq, participants, scores, ledgers }`: the live scoreboard and ledgers (public); cheap enough to poll every second |
| GET | `base/events` | anyone | `?after=<seq>` | Server-Sent Events: `{version}` when the view should be refetched; `{programs: true}` when your own team's programs changed (refetch too); `{actions, lastSeq, clockMs, round, status}` as the garden writes them (from `after`, in order, page after page until caught up); `{lastSeq, clockMs, round, status}` when there is nothing new |
| GET (WebSocket) | `base/ws` | anyone | `?after=<seq>` | The same feed as `base/events` over a WebSocket: exactly the same messages, one JSON text frame each, filtered for the viewer the same way (a session cookie or `Authorization: Bearer` token for a team member's private fields). Server to client only; reconnect with `?after=` the last `seq` you got. `ws://`, or `wss://` behind https |
| PATCH | `base/config` | owner, in the lobby | `{ config: {...partial} }` | `{ config, clearedPrograms }` (changing the language or types, or shrinking a size budget, clears the programs written so far) |
| POST | `base/start` | owner, in the lobby | | `{ status: "running", participants }`. Teams with both programs play; at least 2 |
| POST | `base/status` | owner | `{ action: "pause" \| "resume" \| "finish" }` | `{ status }`. The clock and change budgets stand still while paused |
| POST | `base/teams` | user, in the lobby | `{ name }` | `{ id, name, joinCode }` |
| POST | `base/teams/join` | user | `{ joinCode }` | `{ id, name }` |
| POST | `base/check` | team member | `{ kind, code }` | `{ ok, kind, size, minified, budget, distance, cost, available, errors[] }`. Validates without saving: syntax, the entry points (`flower`; for a bee `first` and `decide`, at the top level), size, and once the game runs the change budget: `distance` is the node edits from the version playing now, `cost` what the change would spend, `available` the budget now (floored) |
| POST | `base/programs` | team member | `{ kind, code }` | same as check plus `submitted: true, version, atMs` (the game time it went live; 0 in the lobby) and `available` after paying. **422** with `errors` if it's too big or can't be afforded yet |
| POST | `base/try` | team member | flower: `{ kind: "flower", code, challenges?, ledger? }`; bee: `{ kind: "bee", code, flower?, rounds? }` | flower: `{ size, results: [{ c, r, percent, energy, ms, error? }] }` (`ledger`: turn records for its `HISTORY.turns`, default none; `size` is the flower's size, used for `energy`). bee: `{ actions, problems, feeds, nectar, surplus, rounds }`: `rounds` (default 300, at most 1000) unpaced rounds in a garden of just your own flower (`flower`, else your latest). In both, the programs run as team 0 of 1 (`GAME.team` 0, `GAME.teams` 1) |

### Config

```json
{
  "language": "python",
  "minutes": 2, "feedCost": 10,
  "challengeType": "int", "responseType": "int", "maxLen": 64, "maxNodes": 512,
  "revealOnFinish": true,
  "budgets": {
    "flower": { "size": 1100,  "perMinute": 220,  "cap": 220,  "ms": 150 },
    "bee":    { "size": 11000, "perMinute": 2200, "cap": 2200, "ms": 50 }
  }
}
```

- `minutes`: game time the garden runs for (it stops while paused). Fractions are fine (`0.5` = 30 s).
- **Rounds** last `round_ms = flower.ms + bee.ms` (200 ms) of game time; game time is rounds × `round_ms`.
  Live games pace rounds to real time. At a round's start each bee with a challenge queued and not
  feeding takes a turn (a bee with nothing queued loses it): a flower is drawn uniformly at random among
  all N (`arrive`), and called with the challenge. At `flower.ms` its response is delivered and the bee has
  `bee.ms` to decide (`feed` or `leave`, recorded as the turn's end). Turn details: RULES.md.
- **Versions are pinned per turn**: a turn keeps the bee's and the flower's versions from its arrival to
  its end. A new bee takes over when its turn in progress is over, dropping the old bee's queued
  challenge (it is asked `first` at once); a bee between turns switches at once.
- `feedCost`: a bee that feeds has no turn for the next `feedCost` rounds.
- `budgets.flower.size` is also the size cap in the energy formula, and `budgets.flower.ms` its 150.
- `budgets.<kind>.size`: size limit in weighted nodes of the minified program (vendor/measure.js).
- `budgets.<kind>.perMinute`, `cap`: change budget earned per minute of game time, and the most that can be
  banked. A team's budget for a program at game time `t` is `min(cap, bank + perMinute × (t − atMs) / 60000)`,
  with `bank` and `atMs` from `teams[i].banks[kind]`. Writing programs in the lobby is free.
- `ms`: time per call (wall clock; the engine runs at most one program per CPU core). A flower that isn't
  done in `flower.ms` answers null (E = 0). `bee.ms` is a deadline, not a cut-off: a late bee's call runs on
  (up to 2 s), its turn is settled as not fed, and only a late `["leave", c]` queues `c`.
- `maxLen` bounds strings and lists. `maxNodes` bounds trees and graphs (graphs: ≤ 4 × maxNodes edges).
- `revealOnFinish`: when the game ends, everyone can see all code and every bee's print output (everything
  else is revealed at the end regardless).

Types: `int`, `float`, `bool`, `str`, `any`, `list[T]`, `tree[T]`, `graph`, `digraph`, `graph[T]`,
`digraph[T]` (RULES.md). Languages: `python`, `typescript`.

## Who sees what

| Field | During play | After finish |
|---|---|---|
| arrivals (`bee` → `flower`), `c`, `r`, fed or not (`action`), `turn`, `round`, `atMs` | everyone, spectators included, as it happens | everyone |
| on a `feed`: `percent`, `energy`, `nectar`, `surplus` | everyone | everyone |
| on a `leave`: `surplus` (always 0) | everyone | everyone |
| on a `leave`: `percent`, `energy` | the flower's team | everyone |
| `ms` (the flower's CPU time), `flowerError`, `flowerVersion` | the flower's team | everyone |
| `beeMs`, `beeError`, `beeVersion` | the bee's team | everyone |
| `log` (what the bee printed) | the bee's team | everyone if `revealOnFinish` |
| code | own team | everyone if `revealOnFinish` |
| program versions, sizes, costs, change budgets, problems | own team | everyone |
| the scoreboard (every team's totals, shares and fitness) and `ledgers` (feeds, nectar, surplus) | everyone, live | everyone |

A field you may not see is **absent** from actions, and **null** in ledger entries and query rows.
Every way of reading actions (pages, `before=`, `mine=1`, the SSE and WebSocket streams) and the team
ledger and history queries apply these rules, so programs reading the API see exactly what the web page shows. Submissions
don't bump the public `game.version`, so other teams can't tell when a team changes its code.

## The game view

```jsonc
{
  "room": { "shortId", "url", "isOwner" },
  "game": { "shortId", "url", "status": "lobby|running|paused|finished", "config",
            "clockMs",        // game time played so far: round × round_ms
            "endMs",          // config.minutes in ms
            "round",          // rounds played so far (counting the one in progress)
            "lastSeq",        // the latest action's seq
            "version", "lastError", "startedAt", "finishedAt", "revealed", "isOwner" },
  "me": { "id", "name", "teamId" } | null,
  "participants": [teamId, ...] | null,   // fixed at the start: team index i in programs and ledgers is participants[i]
  "teams": [{ "id", "name", "color", "members": [names], "participant",
              "index",                    // its index in participants (null if not playing)
              "ready": { "flower": bool, "bee": bool },   // in the lobby
              "programs": { "flower": [version], "bee": [version] } | null,
              "banks": { "flower": { bank, atMs }, "bee": { bank, atMs } } | null }],
  "myTeam": { "id", "name", "joinCode", "index" } | null,
  "interface": { "flower", "bee", "types": { "challenge", "response", "challengeMeans", "responseMeans", "rules": [..] } },
  "scores": [teamScore] | null,
  "ledgers": { "feeds": [[int]], "nectar": [[number]], "surplus": [[number]] } | null
}
```

`version`: `{ version, size, distance, cost, atMs, submittedAt, submittedBy, problem, code? }` (every version,
oldest first; `atMs` = game time it went live, 0 for the lobby; `problem` = the first error it hit).
`programs` and `banks` are your own team's during play (others: null), everyone's after finish; `code`
only where you may see it.

`ledgers` (row = bee team, column = flower team, participants order; whole game so far; public): `feeds[b][f]`
(times b's bee fed at f's flower), `nectar[b][f]` (nectar b's bee got there) and `surplus[b][f]` (what f's
flower kept from b's bee's feeds).

## Actions

A turn makes two actions: its **arrival**, written to the stream at once, and its **end** (`feed` or
`leave`), which carries the whole turn.

```jsonc
{ "seq", "atMs", "round",        // order, game time, round. arrive: atMs = (round - 1) × round_ms;
                                 // feed/leave: atMs = (round - 1) × round_ms + flower.ms
  "turn",                        // the bee's turn number (1, 2, ...): (bee, turn) identifies a turn
  "bee", "flower",               // team ids: whose bee, whose flower
  "action": "arrive|feed|leave", // feed = the bee fed; leave = it didn't (left, was late, or broke)
  // on feed and leave, public:
  "c", "r",                      // the challenge and the response (null if the flower failed)
  "surplus",                     // what the turn added to the flower team's surplus: (1 − percent/100) × E on
                                 // a feed, 0 on a leave
  "nectar",                      // feed only: what the bee got, percent/100 × E
  // on a feed public; on a leave the flower's team only (everyone after finish):
  "percent",                     // 0–100 (null if the flower failed)
  "energy",                      // E, node·ms (0 if the flower failed)
  // the flower's team (everyone after finish):
  "ms",                          // the flower's CPU time for the call
  "flowerError",                 // why the response is null (a timeout, an error, a malformed return)
  "flowerVersion",               // also on arrive
  // the bee's team (everyone after finish):
  "beeMs",                       // how long the bee took to decide
  "beeError",                    // e.g. "too slow: no reply within 50 ms", a crash, a bad next challenge
  "beeVersion",                  // also on arrive
  "log" }                        // what the bee printed (in decide, and in first since its last turn):
                                 // its own team, or everyone once a finished game is revealed
```

A queued challenge appears only when its turn ends: nothing shows a bee's next challenge before then.

## Querying history

docs/QUERY.md has the whole query interface: the schema (`turns`, `versions`, `teams`, `pairs`, `scores`),
the JSON query AST, and the generated Python and TypeScript clients (`/vendor/query/history.py`,
`/vendor/query/history.ts`), which build the same queries programs run on `HISTORY`.

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `base/query` | anyone | a query AST | `{ rows, truncated }`: this game, filtered for the viewer (spectators: the public fields) |
| POST | `/rooms/:room/query` | anyone | a query AST | `{ rows, truncated }`: across the room's **finished** games, fully revealed |
| GET | `/query/schema` | anyone | | the schema |

`limit` defaults to 1,000 rows and is capped at 5,000; `truncated` says more rows matched. A bad query is a
**400** with the reason.

## The team ledger

`GET base/ledger` returns the turn records the team's programs see in `HISTORY.turns` (the `turns` entity
of docs/QUERY.md), oldest first by `seq` (the turn's `feed`/`leave` action), plus that `seq` for paging.
Team numbers are indices into `participants`.

```jsonc
{ "seq": 812, "game": "7", "round": 41, "atMs": 8000, "turn": 12, "bee": 2, "flower": 0,
  "challenge": 17, "response": 52, "fed": true,
  "percent": 25, "energy": 123486.0, // public on a feed; on a leave null except at your own flower
  "nectar": 30871.5,                 // on a feed; null on a leave
  "surplus": 92614.5,                // on a feed; 0 on a leave
  "ms": 2.1, "flowerVersion": 3, "flowerError": null,   // null except at your own flower
  "beeMs": 0.4, "beeVersion": 2, "beeError": null }     // null except for your own bee
```

Once the game is over, every field is filled in for everyone. A round's turns reach the programs after the
round is over, before the next round's flowers are called, brought up to date between timed calls.

## Program interfaces

**Python**

```python
def flower(challenge):
    return response, percent                # percent: 0-100 of this turn's excess energy, if the bee feeds

def first():
    return challenge                        # the challenge for the bee's next turn

def decide(challenge, response):            # response is None if the flower failed
    return "feed", next_challenge           # or "leave", next_challenge
```

**TypeScript**

```ts
function flower(challenge: Challenge): [Response, number]
function first(): Challenge
function decide(challenge: Challenge, response: Response | null): ["feed" | "leave", Challenge]
```

Every program reads two globals: `GAME` (`team`, `teams`, `feed_cost`, `challenge_type`, `response_type`,
`max_len`, `max_nodes`, `round_ms`, `ms` (its own limit), `flower_ms`, `flower_size_cap`; a flower also
`size`, its own) and `HISTORY` (`HISTORY.turns`: the team's history, a query builder; docs/QUERY.md).
`interface` in the game view has the signatures for the game's language and types.

## Scores

`teamScore`:

```jsonc
{ "teamId",
  "pollination", "forage",
  "pollinationShare", "forageShare", "fitness",
  "surplus", "feedsReceived", "feedsGiven", "pollinators", "nectarCollected", "nectarGiven", "nectarSources" }
```

The scoreboard is live and public: every team's numbers, for everyone (spectators included), during play
and after.

- `pollination` = Σ over bee teams b of √surplus[b][me]: the surplus your flower kept from each bee team's feeds.
- `forage` = Σ over flower teams f of √nectar[me][f]: the nectar your bee got at each flower.
- each share = your value ÷ the sum over all teams (1/N when that sum is 0).
- `fitness` = N² × pollinationShare × forageShare. Par is 1.0.
- Information only: `surplus` (all your flower kept), `feedsReceived` / `feedsGiven`, `pollinators` (bee
  teams that fed at your flower), `nectarCollected`, `nectarGiven` (all your flower paid) and
  `nectarSources` (flower teams that paid your bee).

Every server process connected to the same database runs whichever running games nobody else is running
(docs/DESIGN.md), so servers that share a database share their games.
