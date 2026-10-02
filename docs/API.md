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
| GET | `/rooms/:room` | anyone | `{ shortId, url, ownerName, isOwner, games: [{shortId, url, status, clockMs, endMs, teamCount}] }` |
| GET | `/rooms/:room/events` | anyone | Server-Sent Events `{game, version}` whenever a game in the room changes |
| POST | `/rooms/:room/games` | owner | body `{ config? }` → `{ id, shortId, url }` |
| GET | `/defaults` | anyone | `{ config }` with the default game settings |

## Games

`base = /rooms/:room/games/:game`

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `base` | anyone | | the **game view** (below), filtered for the viewer |
| GET | `base/actions` | anyone | `?after=<seq>&limit=<n ≤ 5000>` | `{ actions: [action], lastSeq, clockMs, status }`: the actions after `after`, oldest first |
| GET | `base/events` | anyone | `?after=<seq>` | Server-Sent Events: `{version}` when the view should be refetched; `{programs: true}` when your own team's programs changed (refetch too); `{actions, lastSeq, clockMs}` as the garden writes them (from `after`, in order, page after page until caught up); `{clockMs, lastSeq}` when there is nothing new |
| PATCH | `base/config` | owner, in the lobby | `{ config: {...partial} }` | `{ config, clearedPrograms }` (changing the language or types, or shrinking a size budget, clears the programs written so far) |
| POST | `base/start` | owner, in the lobby | | `{ status: "running", participants }`. Teams with all three programs play; at least 2 |
| POST | `base/status` | owner | `{ action: "pause" \| "resume" \| "finish" }` | `{ status }`. The clock and change budgets stand still while paused; `finish` ends the game early |
| POST | `base/teams` | user, in the lobby | `{ name }` | `{ id, name, joinCode }` |
| POST | `base/teams/join` | user | `{ joinCode }` | `{ id, name }` |
| POST | `base/check` | team member | `{ kind, code }` | `{ ok, kind, size, minified, budget, distance, cost, available, errors[] }`. Validates without saving. `size` is weighted nodes of the minified program; `minified` is the text the game runs. Once the game runs, `distance` is the node edits from the version playing now (renames, comments and formatting are free), `cost` what the change would spend and `available` the change budget now (floored) |
| POST | `base/programs` | team member | `{ kind, code }` | same as check plus `submitted: true, version`, and `available` after paying; the new version goes live at once. **422** with `errors` if it's too big or can't be afforded yet (the error says how long until it can) |
| POST | `base/try` | team member | `{ kind, code, challenges?, flowers?: {clover, orchid} }` | flower: `{ results: [{c, r, error?, ms}] }`. bee: 300 rounds in a garden of just your own two flowers (the `flowers` you pass, else your latest): `{ actions, problems, feeds, nectar, rounds }` |

`kind` is `clover`, `orchid` or `bee`.

### Config

```json
{
  "language": "python",
  "minutes": 2, "feedCost": 10,
  "challengeType": "int", "responseType": "int", "maxLen": 64, "maxNodes": 512,
  "revealOnFinish": true,
  "budgets": {
    "clover": { "size": 1100,  "perMinute": 220,  "cap": 220,  "ms": 150 },
    "orchid": { "size": 2200,  "perMinute": 1540, "cap": 1540, "ms": 50 },
    "bee":    { "size": 11000, "perMinute": 2200, "cap": 2200, "ms": 25 }
  }
}
```

- `minutes`: game time the garden runs for (it stops while paused). Fractions are fine (`0.5` = 30 s).
- `feedCost`: a **round** is one turn for every bee that isn't feeding; a bee that feeds sits out the
  next `feedCost` rounds.
- `budgets.<kind>.size`: size budget in weighted nodes (vendor/measure.js; RULES.md explains it to players).
- `budgets.<kind>.perMinute`, `cap`: change budget earned per minute of game time, and the most that can
  be banked. A team's budget for a program at game time `t` is `min(cap, bank + perMinute × (t − atMs) / 60000)`,
  with `bank` and `atMs` from the view's `teams[i].banks[kind]`. Writing programs in the lobby is free.
- `ms`: wall-clock time per call. The engine runs at most one program per CPU core, so this is
  effectively CPU time. Every program can read `GAME.ms`.
- `maxLen` bounds strings and lists. `maxNodes` bounds trees and graphs (graphs: ≤ 4 × maxNodes edges).
- `revealOnFinish`: when the game ends, everyone can see all code and every bee's print output.

Types: `int`, `float`, `bool`, `str`, `any` (any plain JSON), `list[T]`, `tree[T]` (`{"value", "children"}`),
`graph` and `digraph` (`{"nodes": n, "edges": [[a, b], ...]}` on nodes `0..n-1`), and labelled
`graph[T]` / `digraph[T]` (plus `"labels": [one T per node]` and optional `"edgeLabels": [one T per edge]`;
`graph[any]` = arbitrary labels). Languages: `python`, `typescript`.

### The game view

There is no separate replay mode. The view plus the actions *are* the game: loading them at any time
returns everything that has happened so far, filtered to what this viewer is allowed to know:
- What the bees do is public as it happens.
- A team's code changes (versions, their size, cost and timing, which version played each action) and
  its change budgets are its own until the game is over, then everyone's.
- Code, and what bees print, is your own team's, or everyone's once a finished game is revealed
  (`revealOnFinish`).

```jsonc
{
  "room": { "shortId", "url", "isOwner" },
  "game": { "shortId", "url", "status": "lobby|running|paused|finished", "config",
            "clockMs",        // game time played so far (updated a few times a second while running)
            "endMs",          // config.minutes in ms: the game ends when clockMs reaches it
            "round",          // rounds played so far
            "lastSeq",        // the latest action's seq
            "version", "lastError", "startedAt", "finishedAt", "revealed", "isOwner" },
  "me": { "id", "name", "teamId" } | null,
  "participants": [teamId, ...] | null,   // fixed at the start; ledger row/column order
  "teams": [{ "id", "name", "color", "members": [names], "participant",
              "ready": { kind: bool },    // in the lobby: which programs the team has written (it plays if all three)
              "programs": { kind: [{ version, size, distance, cost, atMs, submittedAt, submittedBy, problem, code? }] } | null,
                                          // every version, oldest first; atMs = game time it went live (0: the lobby).
                                          // Your own team's during play, everyone's once the game is over
              "banks": { kind: { bank, atMs } } | null }],   // change budget (see Config): same visibility
  "myTeam": { "id", "name", "joinCode" } | null,
  "interface": { "flower", "bee", "types": { "challenge", "response", "challengeMeans", "responseMeans", "rules": [..] } },
                                          // signatures + type rules only: no starter code
  "scores": [teamScore] | null,           // the whole game so far
  "recent": { "fromMs", "toMs", "scores": [teamScore] } | null   // the last five minutes of game time
}
```

`teamScore`: `{ teamId, allure, forage, allureShare, forageShare, fitness, feedsReceived, feedsGiven,
nectarCollected, pollinators, nectarSources }`.

`action`: one turn's worth of what a bee did, public the moment it happens:

```jsonc
{ "seq", "atMs", "round",        // order, game time, and the round it happened in
  "bee", "patch",                // team ids: whose bee, at whose patch
  "visit",                       // the bee's visit number: one visit is several actions
  "kind": "clover|orchid",       // which flower of the patch
  "action": "ask|feed|leave|error",
  "beeVersion", "flowerVersion", // which versions played: your own programs' during play, all once it's over
  "c", "r", "ms", "after",       // ask: challenge, response (null if it failed), the flower's time, asked after feeding
  "nectar",                      // feed: true at a clover
  "error", "by",                 // what went wrong, and whose fault: bee | challenge | flower | engine
                                 // (engine: shown to the bee's team during play, to all once it's over)
  "log" }                        // what the bee printed: its own team, or everyone once revealed
```

An `engine` leave ends a visit the bee didn't finish because its team replaced it (or it crashed and
restarted). Submissions don't bump the public `game.version`, so other teams can't tell when a team
changes its code.
