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
| GET | `base/actions` | anyone | `?after=<seq>&limit=<n ≤ 5000>` or `?before=<seq>&limit=<n>`; add `&mine=1` (team members) for only your bee's actions and those at your patch | `{ actions: [action], lastSeq, clockMs, round, status }`: the actions after `after`, oldest first; or the last `limit` before `before`, oldest first (`before = lastSeq + 1` gives the latest) |
| GET | `base/scores` | anyone | | `{ status, clockMs, endMs, round, lastSeq, participants, scores, recent, ledgers }`: the live numbers, cheap enough to poll every second |
| GET | `base/events` | anyone | `?after=<seq>` | Server-Sent Events: `{version}` when the view should be refetched; `{programs: true}` when your own team's programs changed (refetch too); `{actions, lastSeq, clockMs, round, status}` as the garden writes them (from `after`, in order, page after page until caught up); `{lastSeq, clockMs, round, status}` when there is nothing new |
| PATCH | `base/config` | owner, in the lobby | `{ config: {...partial} }` | `{ config, clearedPrograms }` (changing the language or types, or shrinking a size budget, clears the programs written so far) |
| POST | `base/start` | owner, in the lobby | | `{ status: "running", participants }`. Teams with all three programs play; at least 2 |
| POST | `base/status` | owner | `{ action: "pause" \| "resume" \| "finish" }` | `{ status }`. The clock and change budgets stand still while paused; `finish` ends the game early |
| POST | `base/teams` | user, in the lobby | `{ name }` | `{ id, name, joinCode }` |
| POST | `base/teams/join` | user | `{ joinCode }` | `{ id, name }` |
| POST | `base/check` | team member | `{ kind, code }` | `{ ok, kind, size, minified, budget, distance, cost, available, errors[] }`. Validates without saving: syntax, the entry point (`flower`, or `forage` for a bee, defined at the top level), size, and the change budget. `size` is weighted nodes of the minified program; `minified` is the text the game runs. Once the game runs, `distance` is the node edits from the version playing now (renames, comments and formatting are free), `cost` what the change would spend and `available` the change budget now (floored) |
| POST | `base/programs` | team member | `{ kind, code }` | same as check plus `submitted: true, version, atMs` (the game time it went live; 0 in the lobby), and `available` after paying; the new version goes live at once. **422** with `errors` if it's too big or can't be afforded yet (the error says how long until it can) |
| POST | `base/try` | team member | `{ kind, code, challenges?, flowers?: {cosmos, orchid} }` | flower: `{ results: [{c, r, error?, ms}] }`. bee: 300 rounds in a garden of just your own two flowers (the `flowers` you pass, else your latest), run back to back rather than in real time: `{ actions, problems, feeds, nectar, rounds }` |

`kind` is `cosmos`, `orchid` or `bee`.

### Config

```json
{
  "language": "python",
  "minutes": 2, "feedCost": 10,
  "challengeType": "int", "responseType": "int", "maxLen": 64, "maxNodes": 512,
  "revealOnFinish": true,
  "budgets": {
    "cosmos": { "size": 1100,  "perMinute": 220,  "cap": 220,  "ms": 150 },
    "orchid": { "size": 2200,  "perMinute": 1540, "cap": 1540, "ms": 100 },
    "bee":    { "size": 11000, "perMinute": 2200, "cap": 2200, "ms": 50 }
  }
}
```

- `minutes`: game time the garden runs for (it stops while paused). Fractions are fine (`0.5` = 30 s).
- **Rounds.** The garden runs in lockstep rounds of `round_ms = cosmos.ms + bee.ms` (150 + 50 = 200 ms)
  of game time, one action slot per bee: game time is rounds × `round_ms`, and a 2-minute game is 600
  rounds. Live games pace rounds to real time (at least `round_ms` of wall time each, longer if the
  server is short of cores; game time stays rounds × `round_ms`). As a round starts, each bee's queued
  action runs (an ask goes to its flower, or the bee feeds); a bee with nothing queued loses the slot.
  At `cosmos.ms` the answers are delivered (null if a flower wasn't done within its own `ms`), and each
  bee that acted has `bee.ms` to return its next action, queued for its next slot. RULES.md has the
  details: queued challenges, late replies and re-requests, `["leave", c]`.
- **Visits.** Every new visit is at a flower picked uniformly at random among all the flowers in the
  garden, independently for each visit: no deck, no laps, and the same flower can come up twice in a
  row. A bee between visits (loaded, not feeding) is assigned its next flower as a round starts, which
  is recorded as an `arrive` action and written to the stream at once; its first ask there comes in
  the same round if it has a challenge queued. An action's `visit` is the bee's visit count.
- **Versions are pinned per visit.** A visit keeps the bee's and the flower's program versions from its
  arrival to its end. A new flower version answers visits that start after it went live (the old
  version keeps answering the visits already at it, then goes). A new bee takes over when the bee's
  current visit ends, dropping the old bee's queued challenge; a bee between visits switches at once.
- `feedCost`: a bee that feeds has no slot for the next `feedCost` rounds.
- `budgets.<kind>.size`: size budget in weighted nodes (vendor/measure.js; RULES.md explains it to players).
- `budgets.<kind>.perMinute`, `cap`: change budget earned per minute of game time, and the most that can
  be banked. A team's budget for a program at game time `t` is `min(cap, bank + perMinute × (t − atMs) / 60000)`,
  with `bank` and `atMs` from the view's `teams[i].banks[kind]`. Writing programs in the lobby is free.
- `ms`: wall-clock time per call. The engine runs at most one program per CPU core, so this is
  effectively CPU time. Every program can read its own as `GAME.ms`, and the round length as
  `GAME.round_ms`.
  - `cosmos.ms` is also the flower window: every answer is delivered this long into the round, however
    fast it came.
  - `orchid.ms` is the orchid's own, shorter limit (100 by default), clamped to at most `cosmos.ms`.
  - `bee.ms` is the bees' decision window. It is a deadline, not a cut-off: a bee that misses it loses
    its next slot and its visit, but its call runs on (up to a hard limit of 2 s) and a late
    `["leave", c]` still queues `c`. Any other late reply, and any reply that gives no next challenge,
    gets the bee asked again at once for the first challenge at its next flower.
- `maxLen` bounds strings and lists. `maxNodes` bounds trees and graphs (graphs: ≤ 4 × maxNodes edges).
- `revealOnFinish`: when the game ends, everyone can see all code and every bee's print output.

Types: `int`, `float`, `bool`, `str`, `any` (any plain JSON), `list[T]`, `tree[T]` (`{"value", "children"}`),
`graph` and `digraph` (`{"nodes": n, "edges": [[a, b], ...]}` on nodes `0..n-1`), and labelled
`graph[T]` / `digraph[T]` (plus `"labels": [one T per node]` and optional `"edgeLabels": [one T per edge]`;
`graph[any]` = arbitrary labels). Languages: `python`, `typescript`.

### The game view

There is no separate replay mode. The view plus the actions *are* the game: loading them at any time
returns everything that has happened so far, filtered to what this viewer is allowed to know:
- What the bees do is public as it happens: whose bee asked at whose patch, at which flower (`kind`),
  in which round, the challenge and the response, every feed and whether it paid. So is the config
  (every time limit included).
- A team's code changes (versions, their size, cost and timing, which version played each action), its
  change budgets, and how long its programs actually took (`ms`, `beeMs` on actions) are its own until
  the game is over, then everyone's.
- Code, and what bees print, is your own team's, or everyone's once a finished game is revealed
  (`revealOnFinish`).

```jsonc
{
  "room": { "shortId", "url", "isOwner" },
  "game": { "shortId", "url", "status": "lobby|running|paused|finished", "config",
            "clockMs",        // game time played so far: round × round_ms (updated a few times a second while running)
            "endMs",          // config.minutes in ms: the game ends when clockMs reaches it
            "round",          // rounds played so far (counting the one in progress)
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
  "recent": { "fromMs", "toMs", "scores": [teamScore] } | null,  // the last five minutes of game time
  "ledgers": { "feeds": [[...]], "nectar": [[...]] } | null      // whole game; row = bee team, column = patch team (participants order)
}
```

`teamScore`: `{ teamId, allure, forage, allureShare, forageShare, fitness, feedsReceived, feedsGiven,
nectarCollected, pollinators, nectarSources }`.

`action`: one thing a bee did, public the moment it happens:

```jsonc
{ "seq", "atMs", "round",        // order, game time, and the round it happened in. An arrival, an ask or a feed
                                 // happens as its round starts (atMs = (round - 1) × round_ms); a leave or an
                                 // error when the bee decided, cosmos.ms later
  "bee", "patch",                // team ids: whose bee, at whose patch
  "visit",                       // the bee's visit number: one visit is several actions
  "kind": "cosmos|orchid",       // which flower of the patch (public)
  "action": "arrive|ask|feed|leave|error", // arrive: the bee was assigned this flower; every visit opens with one
  "beeVersion", "flowerVersion", // which versions played (the ones in effect when the visit began): your own
                                 // programs' during play, all once it's over
  "c", "r", "after",             // ask: challenge, response (null if it failed), asked after feeding
  "ms",                          // ask: how long the flower took. Your own patch's during play, all once it's over
  "beeMs",                       // how long the bee took to decide this action (after a feed, tasted is part of
                                 // the same call). Your own bee's during play, all once it's over
  "nectar",                      // feed: true at a cosmos
  "error", "by",                 // what went wrong, and whose fault: bee | challenge | flower | engine
                                 // (engine: shown to the bee's team during play, to all once it's over)
  "log" }                        // what the bee printed: its own team, or everyone once revealed
```

A queued challenge appears only when it is asked: a leave never shows the challenge the bee queued for
its next flower. A bee that missed its decision deadline gets an `error` with `by: "bee"` ("too slow:
no reply within 50 ms"), which ends its visit. An `engine` leave ends a visit the bee didn't finish
because it crashed and restarted (with new code, if its team sent some meanwhile). Submissions don't bump the public
`game.version`, so other teams can't tell when a team changes its code.

Every way of reading actions (pages, `before=`, `mine=1`, the event stream) applies the same rules, so
programs reading the API see exactly what the web page shows. Bees see none of it: `forage` gets only
its own challenges and the answers (`seen`) and `visit = {fed, nectar, flowers}`, never whose patch or
which flower.

The measured times (`ms`, `beeMs`) are private during play because every answer reaches the bee at the
end of the flower window precisely so that timing can't tell flowers apart; a public stream of answer
times would give that away to every team reading it.

Every server process connected to the same database runs whichever running games nobody else is running
(see docs/DESIGN.md), so test servers and arena servers that share a database share their games.
