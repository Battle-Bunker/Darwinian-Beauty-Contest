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
| GET | `base` | anyone | | the **game view** (below), filtered for the viewer |
| GET | `base/version` | anyone | | `{ version, status, runningRound, roundsPlayed }` |
| GET | `base/events` | anyone | | SSE: `data: {"game", "version"}` on every change. Refetch the view when it arrives |
| PATCH | `base/config` | owner, before round 1 | `{ config: {...partial} }` | `{ config, clearedSubmissions }` |
| POST | `base/teams` | user, before round 1 | `{ name }` | `{ id, name, joinCode }` |
| POST | `base/teams/join` | user | `{ joinCode }` | `{ id, name }` |
| POST | `base/check` | team member | `{ kind, code }` | `{ ok, nodes, distance, errors[], budget }`. Validates without saving |
| POST | `base/programs` | team member | `{ kind, code }` | same as check plus `submitted: true`; **422** with `errors` if over budget |
| POST | `base/try` | team member | `{ kind, code, challenges?, flowers?: {clover, orchid} }` | flower: `{ results: [{c, r, error?}] }`. bee: forages your own patch (the `flowers` you pass, else your submissions, else last round's): `{ visits, problems, feeds, nectar }` |
| POST | `base/rounds` | owner | | **202** `{ round }`. Runs in the background; add `?wait=1` to block until done |

`kind` is `clover`, `orchid` or `bee`.

### Config

```json
{
  "language": "python",
  "rounds": 5, "turns": 100, "feedCost": 5,
  "challengeType": "int", "responseType": "int", "maxLen": 64,
  "flowerLogs": true, "revealOnFinish": true,
  "budgets": {
    "clover": { "nodes": 150, "changes": 30, "ms": 50 },
    "orchid": { "nodes": 150, "changes": 30, "ms": 50 },
    "bee":    { "nodes": 400, "changes": 60, "ms": 50 }
  }
}
```

Types: `int`, `float`, `bool`, `str`, `list[T]`, `tree[T]` (`{"value", "children"}`), `graph` and `digraph`
(`{"nodes": n, "edges": [[a, b], ...]}` on nodes `0..n-1`). Languages: `python`, `typescript`.

### The game view

There is no separate replay mode. This one document *is* the game, and loading it at any time
returns everything that has happened so far, filtered to what this viewer is allowed to know.

```jsonc
{
  "room": { "shortId", "url", "isOwner" },
  "game": { "shortId", "url", "status": "lobby|running|finished", "config", "roundsPlayed",
            "runningRound": null | n, "lastError", "version", "revealed", "isOwner" },
  "me": { "id", "name", "teamId" } | null,
  "participants": [teamId, ...] | null,   // fixed when round 1 runs; ledger row/column order
  "teams": [{ "id", "name", "color", "members": [names], "participant",
              "submitted": { "clover": bool, "orchid": bool, "bee": bool } }],
  "myTeam": { "id", "name", "joinCode",
              "drafts":   { kind: { code, nodes, distance, submittedAt, submittedBy } },   // pending for next round
              "previous": { kind: code } } | null,                                       // what played last round
  "interface": { "flower", "bee", "types": { "challenge", "response", "challengeMeans", "responseMeans", "rules": [..] } },
                                                  // signatures + type rules only: no starter code, no example values
  "rounds": [{
    "no", "startedAt", "finishedAt",
    "feeds":  [[...]],  "nectar": [[...]],        // ledgers: row = bee team, column = patch team (participants order)
    "scores": [teamScore], "totals": [teamScore],  // this round alone / all rounds so far
    "programs": { teamId: { kind: { nodes, distance, carriedOver, code?, problem? } } },  // code: own team or revealed
    "visits": [visit]
  }],
  "final": [teamScore] | null
}
```

`teamScore`: `{ teamId, allure, forage, allureShare, forageShare, fitness, feedsReceived, feedsGiven,
nectarCollected, pollinators, nectarSources }`.

`visit`: everyone sees `{ bee, patch, seq, start, end, asks, action: "feed"|"leave"|"error", nectar }`
(`bee` and `patch` are team ids; `start`/`end` are turn numbers, so all bees move in parallel from
turn 0 to `config.turns`; `nectar` is non-null only for feeds). Extra fields by viewer:

- **the bee's team**: `steps: [{c, r, challengeError?}]`, `beeError?`, `beeLog?` (what the bee printed), `note?`
- **the patch owner**: `kind: "clover"|"orchid"`, plus `steps: [{c, r, flowerError?}]` if `flowerLogs`, and `flowerError?`
- **everyone, once revealed** (finished game with `revealOnFinish`): all of the above

The public view never says which flower in a patch a bee visited unless the bee fed and got nectar.
In that case it was the clover, and everyone can see that from the nectar.
