# HTTP API

All endpoints live under `/api` and speak JSON. Errors look like `{ "error": "message" }` with a 4xx/5xx
status. Room and game ids in paths are **short ids**: the shortest Crockford base32 prefix that was
unique when the record was created (any longer prefix, up to the full 26-character code, also works,
and so does lowercase). Pages live at `/room/<roomShortId>/game/<gameShortId>`.

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
| GET | `/my/rooms` | any user | `{ rooms: [{shortId, url, isOwner, ownerName, gameCount, createdAt, lastActivity}] }`: rooms I own or have a team in, most recently active first |
| GET | `/rooms/:room` | anyone | `{ shortId, url, ownerName, isOwner, games: [{shortId, url, status, roundsPlayed, rounds, teamCount}] }` |
| GET | `/rooms/:room/events` | anyone | Server-Sent Events whenever any game in the room changes |
| POST | `/rooms/:room/games` | owner | body `{ config? }` → `{ id, shortId, url }` |
| GET | `/defaults` | anyone | `{ config }` with the default game settings |

## Games

`base = /rooms/:room/games/:game`

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `base` | anyone | | the **game view** (below), filtered for the viewer. `?visits=none` or `?visits=last` leaves out older rounds' visits, which can be thousands per round |
| GET | `base/rounds/:no` | anyone | | one round, in the same shape as an entry of `rounds` (with its visits), filtered for the viewer |
| GET | `base/memory/:no` | team member | | `{ round, teamId, language, snapshot, bytes, note }`: what your bee kept at the end of round `no` (any team's once revealed, via `?team=`) |
| GET | `base/version` | anyone | | `{ version, status, runningRound, roundsPlayed }` |
| GET | `base/events` | anyone | | SSE: `data: {"game", "version"}` on every change. Refetch the view when it arrives |
| PATCH | `base/config` | owner, before round 1 | `{ config: {...partial} }` | `{ config, clearedSubmissions }` |
| POST | `base/teams` | user, before round 1 | `{ name }` | `{ id, name, joinCode }` |
| POST | `base/teams/join` | user | `{ joinCode }` | `{ id, name }` |
| POST | `base/check` | team member | `{ kind, code }` | `{ ok, chars, minified, distance, errors[], budget }`. Validates without saving. `chars` is the size: the length of `minified`, the program as the game counts it (comments, spacing, defined names' lengths and TypeScript types are free; see RULES.md). `distance` is the change since last round: characters of edit between the minified versions, with names lined up. A program outside its turn must have distance 0 |
| POST | `base/programs` | team member | `{ kind, code }` | same as check plus `submitted: true`; **422** with `errors` if over budget |
| POST | `base/try` | team member | `{ kind, code, challenges?, flowers?: {clover, orchid} }` | flower: `{ results: [{c, r, error?}] }`. bee: forages your own patch (the `flowers` you pass, else your submissions, else last round's) with your real `MEMORY`: `{ visits, problems, feeds, nectar, turns, memory }` |
| POST | `base/rounds` | owner | `{ seed? }` | **202** `{ round }`. Runs in the background; add `?wait=1` to block until done. `seed` (0…2³¹−1) fixes the deck order and bee randomness, e.g. to replay identical games with two cohorts; omitted = random |

`kind` is `clover`, `orchid` or `bee`.

### Config

```json
{
  "language": "python",
  "rounds": 5, "turnsPerFlower": 100, "feedCost": 5,
  "challengeType": "int", "responseType": "int", "maxLen": 64, "maxNodes": 512, "beeMemoryKb": 256,
  "flowerLogs": true, "publicLogs": false, "revealOnFinish": true,
  "budgets": {
    "clover": { "chars": 350,  "changes": 30,  "ms": 150 },
    "orchid": { "chars": 700,  "changes": 210, "ms": 50 },
    "bee":    { "chars": 3500, "changes": 300, "ms": 25 }
  }
}
```

- `turnsPerFlower`: each bee gets `turnsPerFlower × flowers` turns per round (`flowers` = 2 × teams).
- `publicLogs`: after each round everyone sees every visit's flower kind, challenges and responses (not
  code, bee logs, flower errors, compute or memory, which wait for `revealOnFinish`).
- `maxLen` bounds strings and lists. `maxNodes` bounds trees and graphs (graphs: ≤ 4 × maxNodes edges).
- `beeMemoryKb`: how much of a bee's top-level data is kept each round for `MEMORY`. 0 turns memory off.
- `budgets.<kind>.chars`: size, in characters of the automatically minified program (vendor/measure.js;
  RULES.md explains it to players). `changes`: characters of the minified program that may change in a
  round the program may change. One kind may change before each round, in rotation: bees (rounds
  2, 5, 8, …), orchids (3, 6, 9, …), clovers (4, 7, 10, …). Games have 6 rounds by default.
- Flowers are stateless (a fresh process or context per call) but get fresh randomness every call and
  the clock, so every ask runs the flower again. Every program can read `GAME.ms`, its own compute
  budget per call.
- `ms` is wall-clock time per call. The engine runs at most one program per CPU core, so this is
  effectively CPU time.

Types: `int`, `float`, `bool`, `str`, `any` (any plain JSON), `list[T]`, `tree[T]` (`{"value", "children"}`),
`graph` and `digraph` (`{"nodes": n, "edges": [[a, b], ...]}` on nodes `0..n-1`), and labelled
`graph[T]` / `digraph[T]` (plus `"labels": [one T per node]` and optional `"edgeLabels": [one T per edge]`;
`graph[any]` = arbitrary labels). Languages: `python`, `typescript`.

### The game view

There is no separate replay mode. This one document *is* the game, and loading it at any time
returns everything that has happened so far, filtered to what this viewer is allowed to know.

```jsonc
{
  "room": { "shortId", "url", "isOwner" },
  "game": { "shortId", "url", "status": "lobby|running|finished", "config", "roundsPlayed",
            "runningRound": null | n, "lastError", "version", "revealed", "isOwner",
            "turns",                       // turns per bee in the next round
            "changeable": ["bee"] },        // programs that may change for the next round (server/lib/schedule.js)
  "me": { "id", "name", "teamId" } | null,
  "participants": [teamId, ...] | null,   // fixed when round 1 runs; ledger row/column order
  "teams": [{ "id", "name", "color", "members": [names], "participant",
              "submitted": { "clover": bool, "orchid": bool, "bee": bool } }],
  "myTeam": { "id", "name", "joinCode",
              "drafts":   { kind: { code, chars, distance, submittedAt, submittedBy } },   // pending for next round
              "previous": { kind: code } } | null,                                       // what played last round
  "interface": { "flower", "bee", "types": { "challenge", "response", "challengeMeans", "responseMeans", "rules": [..] } },
                                                  // signatures + type rules only: no starter code, no example values
  "rounds": [{
    "no", "startedAt", "finishedAt", "turns",    // turns each bee had this round
    "feeds":  [[...]],  "nectar": [[...]],        // ledgers: row = bee team, column = patch team (participants order)
    "scores": [teamScore], "totals": [teamScore],  // this round alone / all rounds so far
    "programs": { teamId: { kind: { chars, distance, carriedOver, code?, problem?, compute? } } },  // code: own team or revealed
                                                  // chars: complexity under the current rule
                                                  // compute (flowers): { calls, meanMs, p90Ms, budgetMs }
    "memory": { teamId: { bytes, note } },        // what each bee kept for later rounds: own team or revealed
    "visits": [visit]
  }],
  "final": [teamScore] | null
}
```

`teamScore`: `{ teamId, allure, forage, allureShare, forageShare, fitness, feedsReceived, feedsGiven,
nectarCollected, pollinators, nectarSources }`.

`visit`: everyone sees `{ bee, patch, seq, start, end, asks, asksBeforeFeed, action: "feed"|"leave"|"error", nectar }`
(`bee` and `patch` are team ids; `start`/`end` are turn numbers, so all bees move in parallel from
turn 0 to the round's `turns`; `nectar` is non-null only for feeds). A visit runs `asksBeforeFeed`
asks, then the feed (`feedCost` turns) if there was one, then any remaining asks: bees may keep
questioning a flower after feeding. In `steps`, those later asks carry `after: true`. Extra fields by viewer:

- **the bee's team**: `steps: [{c, r, challengeError?}]`, `beeError?`, `beeLog?` (what the bee printed), `note?`
- **the patch owner**: `kind: "clover"|"orchid"`, plus `steps: [{c, r, flowerError?}]` if `flowerLogs`, and `flowerError?`
- **everyone, once revealed** (finished game with `revealOnFinish`): all of the above

The public view never says which flower in a patch a bee visited unless the bee fed and got nectar.
In that case it was the clover, and everyone can see that from the nectar.
