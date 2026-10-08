# HTTP API (one flower per team)

All endpoints live under `/api` and speak JSON. Errors look like `{ "error": "message" }` with a 4xx/5xx
status. Room and game ids in paths are **short ids**: the shortest Crockford base32 prefix that was
unique when the record was created (any longer prefix, up to the full 26-character code, also works,
and so does lowercase). Pages live at `/room/<roomShortId>/game/<gameShortId>`.

RULES.md has the game itself. In short: each team has one **flower** and one **bee**; every 200 ms round,
ceil(0.25 × N) bees (drawn without replacement, weighted by their bee success B) each take one **turn**:
the engine draws a flower species weighted by its flower success F (own included), the flower answers
`[response, percent]` within its R (at most 50 ms of CPU time; delivered at 150 ms), and the bee decides
`["feed" | "leave", next]` within 50 ms of CPU time; after a feed, the bee's optional `fed(nectar)` runs in
the same program instance. Excess energy E = (flower size cap − flower size) × max(0, R − flower CPU ms) ×
(byte cap − response bytes), in node·ms·bytes, R the call's hidden time budget (1–50 ms by default) and the
byte cap `maxResponseBytes` (1,024 by default); a feed pays nectar = percent/100 × E and pollen = the rest
to the bee, and the bee pays the feed price out of its nectar (net = nectar − price); a turn without a feed
pays nobody (its energy is lost). fitness = N² × p^F × p^B at the final round (see `prevalence` and "Scores"
below); v2 and v3 games keep their time-average of F × B. A game lasts between `minutes` and `endFactor` ×
`minutes` of game time (5 to 10 by default): its end is drawn when it starts and hidden from the teams until
it is over (see "The game's length"). Games from before (no `prevalence` in their config) play every bee
every round with uniform draws and free feeds, and score N² × pollination share × forage share.

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
| GET | `/rooms/:room` | anyone | `{ shortId, url, ownerName, isOwner, games: [{shortId, url, status, clockMs, minMs, maxMs, endMs, teamCount}] }` (`endMs` null while hidden: see "The game's length") |
| GET | `/rooms/:room/events` | anyone | Server-Sent Events `{game, version}` whenever a game in the room changes |
| POST | `/rooms/:room/games` | owner | body `{ config? }` → `{ id, shortId, url }` |
| GET | `/defaults` | anyone | `{ config }` with the default game settings |

## Games

`base = /rooms/:room/games/:game`. `kind` is `flower` or `bee` everywhere.

| Method | Path | Who | Body / query | Returns |
|---|---|---|---|---|
| GET | `base` | anyone | | the **game view** (below), filtered for the viewer |
| GET | `base/actions` | anyone | `?after=<seq>&limit=<n ≤ 5000>`, or `?before=<seq>&limit=<n>`; `&mine=1` (team members) for only turns of your bee or at your flower | `{ actions: [action], lastSeq, clockMs, round, status, prevalence? }` (`prevalence`: the latest prevalence sample, in games that have it): the actions after `after`, oldest first; or the last `limit` before `before`, oldest first (`before = lastSeq + 1` gives the latest) |
| GET | `base/ledger` | anyone | `?after=<seq>&limit=<n ≤ 5000>` | `{ participants, team, entries: [entry], lastSeq, round, status }`: the **team ledger** (below): every finished turn as your team may see it. `team` is your team's index in `participants` (null for a spectator, who gets the public fields only) |
| GET | `base/responses/:seq` | anyone | | the whole response of the turn whose `feed`/`leave` action is `seq`, as its JSON text (`application/json`; responses are public). For responses over 4 KB, which actions, ledger entries, live feeds and query rows show only as a preview, size and hash; **404** if that turn has no response |
| GET | `base/scores` | anyone | | `{ status, clockMs, minMs, maxMs, endMs, round, lastSeq, fitnessBasis, participants, scores, ledgers, prevalence }`: the live scoreboard, ledgers and prevalence (public; `prevalence` as in the game view; `endMs` null while hidden, for everyone); cheap enough to poll every second. `status` turning `"finished"` is how a client learns the game is over (or the `status` on `base/events` messages) |
| GET | `base/prevalence` | anyone | `?after=<round>&limit=<n ≤ 5000>` | `{ prevalence, samples: [sample] }`: the game's prevalence settings (null: a game without) and its samples after round `after`, oldest first (public; see "Prevalence samples") |
| GET | `base/events` | anyone | `?after=<seq>` | Server-Sent Events: `{version}` when the view should be refetched; `{programs: true}` when your own team's programs changed (refetch too); `{actions, lastSeq, clockMs, round, status}` as the garden writes them (from `after`, in order, page after page until caught up); `{lastSeq, clockMs, round, status}` when there is nothing new; either carries `prevalence` (a prevalence sample) whenever there is a new one, about once a second of game time |
| GET (WebSocket) | `base/ws` | anyone | `?after=<seq>` | The same feed as `base/events` over a WebSocket: exactly the same messages, one JSON text frame each, filtered for the viewer the same way (a session cookie or `Authorization: Bearer` token for a team member's private fields). Server to client only; reconnect with `?after=` the last `seq` you got. `ws://`, or `wss://` behind https |
| PATCH | `base/config` | owner, in the lobby | `{ config: {...partial} }` | `{ config, clearedPrograms }` (changing the language or types, or shrinking a size budget, clears the programs written so far) |
| POST | `base/start` | owner, in the lobby | | `{ status: "running", participants }`. Teams with both programs play; at least 2. The game's end is drawn now (not in the reply) |
| POST | `base/status` | owner | `{ action: "pause" \| "resume" \| "finish" }` | `{ status }`. The clock and change budgets stand still while paused |
| POST | `base/teams` | user, in the lobby | `{ name }` | `{ id, name, joinCode }` |
| POST | `base/teams/join` | user | `{ joinCode }` | `{ id, name }` |
| POST | `base/check` | team member | `{ kind, code }` | `{ ok, kind, size, minified, budget, distance, cost, available, errors[] }`. Validates without saving: syntax, the entry points (`flower`; for a bee `first` and `decide`, and optionally `fed`, at the top level), size, and once the game runs the change budget: `distance` is the node edits from the version playing now, `cost` what the change would spend, `available` the budget now (floored) |
| POST | `base/programs` | team member | `{ kind, code }` | same as check plus `submitted: true, version, atMs` (the game time it went live; 0 in the lobby) and `available` after paying. **422** with `errors` if it's too big or can't be afforded yet |
| POST | `base/try` | team member | flower: `{ kind: "flower", code, challenges?, budgetMs? }`; bee: see the reply column | flower: `{ size, results: [{ c, r, rBytes, rHash?, rPreview?, percent, energy, ms, budgetMs, error? }] }` (`budgetMs`: each challenge's R, as in a game: a number, `"random"` (the default: drawn from `minMs`..`ms` per challenge) or a list with one per challenge; it is the call's limit and `GAME.ms`, clamped to `minMs`..`ms`, and each result says its R; `size` is the flower's size, used for `energy`; a response over 4 KB comes as `rPreview`, `rBytes` and `rHash` with `r` null, as in actions). bee: `{ kind: "bee", code, flower?, rounds?, memory? }` → `{ actions, problems, feeds, nectar, pollen, rounds, memory }`: `rounds` (default 300, at most 1000) unpaced rounds in a garden of just your own flower (`flower`, else your latest), with `fed` called after each feed as in a game, the test bee starting with `memory` (default `{}`, a MEMORY within the cap); `memory` in the reply is `{ value, bytes, cap, error }`, what it ended with. This never touches a game bee's memory. In both, the programs run as team 0 of 1 (`GAME.team` 0, `GAME.teams` 1) |

### Config

```json
{
  "language": "python",
  "minutes": 5, "endFactor": 2, "feedCost": 0, "flowerWindowMs": 150, "feedPrice": null,
  "challengeType": "int", "responseType": "int", "maxLen": 64, "maxNodes": 512, "maxResponseBytes": 1024,
  "revealOnFinish": true,
  "grains": "feeder", "pollenGrain": { "exponent": 0.3333333333333333, "scale": 0.1 },
  "scoring": { "alpha": 0.85, "beta": 0.85, "mode": "final" }, "energy": { "bytes": true },
  "prevalence": { "on": true, "halfLifeS": 90, "cDecay": "sech", "cStart": 1, "cHalfS": null, "cap": 4, "slots": 0.25, "prior": null, "pools": true, "endowment": null },
  "budgets": {
    "flower": { "size": 1100,  "perMinute": 60,  "cap": 300,  "ms": 50, "minMs": 1 },
    "bee":    { "size": 11000, "perMinute": 600, "cap": 3000, "ms": 50, "memory": 50 }
  }
}
```

- `minutes`: the shortest the game lasts, in game time (it stops while paused). Fractions are fine (`0.5` =
  30 s; at least 0.1). `endFactor` (1 to 100, default 2): the longest, as a multiple of `minutes`. When the
  game starts, its end is drawn uniformly from [`minutes`, `endFactor` × `minutes`], rounded up to a whole
  round, and hidden until it is over (see "The game's length"). A config stored without `endFactor` (games
  from before) has 1: it ends at `minutes`, as it did.
- **Rounds** last `round_ms = flowerWindowMs + bee.ms` (200 ms) of game time; game time is rounds ×
  `round_ms`. Live games pace rounds to real time. At a round's start the bees that can visit (a challenge
  queued, no call in flight, not sitting out) are the candidates; with `prevalence`, ceil(`slots` × N) of
  them are drawn without replacement, weighted by bee success, and the rest wait (their challenges stay
  queued); without it, every candidate visits. Each visitor's flower is drawn among all N (`arrive`):
  weighted by flower success with `prevalence`, else uniformly. At `flowerWindowMs` its response is
  delivered and the bee has `bee.ms` to decide (`feed` or `leave`, recorded as the turn's end). Turn
  details: RULES.md.
- `flowerWindowMs` (default 150, never less than `budgets.flower.ms`): when every response is delivered.
  A config stored without it is from before: its window is `budgets.flower.ms`. The game view's
  `game.windowMs` is the window the game plays with.
- **Versions are pinned per turn**: a turn keeps the bee's and the flower's versions from its arrival to
  its end. A new bee takes over when its turn in progress is over, dropping the old bee's queued
  challenge (it is asked `first` at once); a bee between turns switches at once.
- `feedCost` (default 0; 20 in games from before): a bee that feeds has no turn for the next `feedCost` rounds.
- `feedPrice` (E's unit, node·ms·bytes by default): what every feed costs the bee, out of its nectar: net
  nectar = nectar − feedPrice (it can be negative). `null` (the default): 0.05 × Emax, where Emax =
  `budgets.flower.size` × `budgets.flower.ms` × `maxResponseBytes` (1,100 × 50 × 1,024 = 56,320,000, so
  2,816,000), following those settings; `0`: free. A config stored without it is from before: free. The
  game view's `game.feedPrice` is the price the game plays with; programs get it as `GAME.feed_price`.
  `fed(nectar)` gets the gross nectar.
- `budgets.flower.size` is also the size cap in the energy formula. Each flower call gets a hidden time
  budget **R**, drawn uniformly at random from `budgets.flower.minMs` to `budgets.flower.ms` (default 50).
  `minMs` defaults to 2% of `ms`, rounded, at least 1 (1 of 50); left out, it follows `ms`, and a value you set
  is kept (never above `ms`). R is the call's hard limit, in CPU time, the flower is told it as `GAME.ms`, and E counts down from
  R, so E = (size cap − size) × max(0, R − CPU ms) × (`maxResponseBytes` − response bytes), in node·ms·bytes
  (the last factor with `energy.bytes`; without it, node·ms). The response is still delivered at
  `flowerWindowMs` (150) whatever R was, so timing hides R. R is the flower team's secret during play
  (`budgetMs` below).
- `budgets.<kind>.size`: size limit in weighted nodes of the minified program (vendor/measure.js).
- `budgets.<kind>.perMinute`, `cap`: change budget earned per minute of game time, and the most that can be
  banked. A team's budget for a program at game time `t` is `min(cap, bank + perMinute × (t − atMs) / 60000)`,
  with `bank` and `atMs` from `teams[i].banks[kind]`. Writing programs in the lobby is free.
- `ms`: the most CPU time per call, in ms. Every limit is CPU time, measured on the call's own thread clock
  (`time.process_time()` in Python, `performance.cpuTime()` in TypeScript, both 0 as the call starts), so a busy
  machine doesn't make a program late; it only stretches rounds in wall time. A flower is stopped once it has
  used its call's R (`minMs`..`ms`) of CPU, and one that used more than R answers null (E = 0). `bee.ms` is a
  deadline, not a cut-off: a bee over it is late, its call runs on (up to 2 s of CPU), its turn is settled as
  not fed, and only a late `["leave", c]` queues `c`. A bee's `fed` is stopped at `bee.ms` of CPU. Sleeping
  earns nothing: Python's `time.sleep` and TypeScript's `Atomics.wait` return at once.
- **Wall-clock backstop and server faults.** A call that isn't computing (or is starved far beyond reason)
  meets a wall-clock backstop: a flower still running after max(400, 2 × `flower.ms`) ms is stopped; a bee's
  `first` or `decide` with no reply after max(250, 4 × `bee.ms`) ms is judged then and stopped after 4 s;
  `fed` is stopped after that 250 ms. A call met by the backstop is late, unless the runner's
  `/proc/<pid>/schedstat` shows it spent at least half that wall time runnable but waiting for a CPU: then it is
  a **server fault** and the turn is **void**: no feed, no energy, the bee's challenge is asked again, and
  nothing counts against the flower or the bee. A void turn is recorded as a `leave` with the reason in
  `flowerError` or `beeError` (starting `server fault:`). Programs run on cores of their own (the
  `dbc-runners` cpuset, cores 2–3 by default, `RUNNER_CPUS`; `RUNNER_CPUSET=off` to skip), and at most
  `CPU_SLOTS` (default 2) run at once across the server.
- `budgets.bee.memory` (default 50, 0 to 1,000,000): the most bytes a bee's `MEMORY` may hold. `MEMORY` is a
  key–value store (string keys; string, number, boolean or null values); its size is Σ over entries of
  (UTF-8 bytes of the key + UTF-8 bytes of the value's JSON text): `{"n": 7, "best": "a7"}` is 2 + 8 = 10.
- `maxLen` bounds the challenge's strings and lists; `maxNodes` its trees and graphs (graphs: ≤ 4 × maxNodes
  edges).
- `maxResponseBytes` (default 1,024; 16 to 16,777,216): the most UTF-8 bytes of a response's JSON text
  (no spaces). Checked by the runner inside the flower's time; over it, the response is null and E = 0.
- `energy`: `{ bytes }` (default `true`): E has a third factor, (`maxResponseBytes` − the response's bytes),
  the bytes counted as for the cap, and is in node·ms·bytes: the whole cap for no bytes, 0 for a response at
  the cap (still an answer, and a bee can feed on it, but there is nothing to give). A game stored without
  `energy` (or with `bytes` false) has the two-factor formula, in node·ms, as games before it did (they had a
  64 KiB cap); the game view's `config.energy` says which. Nectar and pollen are in E's unit.
  `maxLen` and `maxNodes` don't apply to responses; responses nest at most 256 levels.
- `revealOnFinish`: when the game ends, everyone can see all code and every bee's print output (everything
  else is revealed at the end regardless).
- `grains`: who sees a feed's **pollen grain** during play: `"feeder"` (default: the feeding bee's team),
  `"public"` (everyone, as it happens) or `"off"` (no grains). Everyone sees every grain once the game is
  over.
- `pollenGrain`: a grain's length is ⌊`scale` × pollen^`exponent`⌋ characters (defaults 0.1 and 1/3:
  27,000,000 pollen gives 30, about as long as grains were with E in node·ms and scale 1, which games without
  the byte factor keep; `exponent` 0.01 to 1, `scale` 0 to 1,000). It is that many characters of the minified
  code of the flower version that answered, from a uniformly random start, wrapping past the end (the whole
  code if it is no longer than that). No pollen, no grain.
- `scoring`: `{ alpha, beta, mode }`. `alpha` and `beta`, each in (0, 1] (anything else is an error), 0.85 and
  0.85 by default: forage = Σ over flower teams of nectar^`alpha`, pollination = Σ over bee teams of
  pollen^`beta` (see "Scores"). A game stored without `scoring` was created before it existed and is scored
  with √ (0.5 and 0.5), as it was then. `mode` (games with prevalence): `"final"` (the default), fitness = N² ×
  p^F × p^B at the final round; `"timeAverage"`, the time-average of F × B over the rounds played (anything
  else is an error). A config stored without a mode (v2 and v3 games) is `"timeAverage"`, and stays so when
  edited. The game view's `config.scoring` is always the rule the game is scored with.
- `prevalence`: **prevalence on both sides** (server/lib/prevalence.js). With `on`:
  - **Flower side.** D^F_{s,b}: the pollen species s gave bee team b. Each cell starts at `prior` (null: 0.12
    × Emax, 6,758,400 at the defaults; 0 to 10^15) and, as each round begins, is multiplied by 2^(−round_ms /
    1000 / `halfLifeS`) (90 by default, 1 to 86,400; null: cumulative), before that round's pollen is added.
    **F_s** = N × Q^F_s / Σ_k Q^F_k, Q^F_s = Σ_b (D^F_{s,b})^β (β = `scoring.beta`): per-(species, bee) cells,
    so pollen spread across many bee teams counts for more and no flower–bee pair can go singleton.
  - **Bee side (`pools`, the default, v3).** Each bee has one nectar **balance**, not a per-flower tally. It
    starts at the `endowment` (null: 10 × the feed price, 28,160,000 at the defaults; 0 to 10^15); each feed
    adds its net nectar (nectar − feedPrice, which can be negative); and as each round begins it relaxes
    toward the endowment by the same half-life (balance ← endowment + (balance − endowment) × d). A bee whose
    balance is below the feed price can't feed (its feed decision becomes a leave, "too poor to feed"), and it
    recovers over time. **B_b** = N × balance_b / Σ_k max(0, balance_k) (balances floored at 0 for the share).
    With `pools` false (v2): B_b = N × Q^B_b / Σ_k Q^B_k, Q^B_b = max(0, Σ_s sign(D^B_{b,s}) |D^B_{b,s}|^α),
    D^B the per-(bee, species) decayed net nectar (α = `scoring.alpha`).
  - Each of F and B is 1 for everyone when its total is 0, and at most `cap` (4 by default, at least 1; null:
    no cap). Par 1.
  - **c(t)**, by `cDecay`: `"sech"` (new games): c = `cStart` × sech(k × t / `cHalfS`), k = arccosh 2 ≈
    1.31696 and t in seconds of game time, so c(`cHalfS`) = `cStart` / 2, with zero slope at 0, an
    exponential tail and no floor (computed as 2e^(−x) / (1 + e^(−2x)): exactly 0 far out). `cStart` 1 (0 to
    100); `cHalfS` null (the default): 0.2 × `minutes` × 60 (60 s at 5 minutes), or a number of seconds (0.1
    to 864,000). It doesn't depend on the drawn end. `"linear"` (v2, v3: a config stored without `cDecay`):
    from `cStart` at game time 0 to `cEnd` (0.1) at `minutes`, then `cEnd`. A sech config has no `cEnd` and a
    linear one no `cHalfS`. Anything else is an error.
  - Each round, K = ceil(`slots` × N) (`slots` 0.25 by default, 0.01 to 1) distinct bees are drawn, one
    after another without replacement, with weights c + B_b (among the bees that can visit); each draws a
    species with weights c + F_s, with replacement, its own included. Published: p^F_s = (c + F_s) / Σ (c +
    F) and p^B_b = (c + B_b) / Σ (c + B) (the chance of filling a given slot first). A team weighing 0
    (c = 0 and F or B 0) is never drawn while another eligible one weighs more; when every eligible one weighs
    0, the draw is uniform among them.
  - A team's **fitness**, by `scoring.mode`: `"final"`, N² × p^F_s × p^B_s of the latest round (the final
    round's, once the game is over); `"timeAverage"` (v2, v3), the time-average over the rounds played of F_s
    × B_s. Par 1, and 1 before the first round.
  A game stored without `prevalence`, or with the earlier one-sided form (no `slots`), is from before: every
  bee visits every round, species are drawn uniformly, and it is scored with pollination × forage (`on`
  false). A stored v2 config (has `slots`, no `pools`) keeps `pools` false, so its bee formula is unchanged, and
  a stored v2 or v3 config (no `cDecay`) its linear c.
  The game view's `config.prevalence` always has every key. Programs never see prevalence (it is not in `GAME`).

Types: `int`, `float`, `bool`, `str`, `any`, `list[T]`, `tree[T]`, `graph`, `digraph`, `graph[T]`,
`digraph[T]` (RULES.md). Languages: `python`, `typescript`.

## Who sees what

| Field | During play | After finish |
|---|---|---|
| arrivals (`bee` → `flower`), `c`, `r` (and `rBytes`, `rHash`, `rPreview`), fed or not (`action`), `turn`, `round`, `atMs` | everyone, spectators included, as it happens | everyone |
| on a `feed`: `percent`, `energy`, `nectar`, `pollen` | everyone | everyone |
| on a `feed`: `grain`, `grainVersion`, `grainCodeLength` (the pollen grain) | the bee's team (everyone if `grains` is `"public"`) | everyone |
| on a `leave`: `pollen` (always 0) | everyone | everyone |
| on a `leave`: `percent`, `energy` | the flower's team | everyone |
| `ms` (the flower's CPU time), `budgetMs` (the call's time budget R), `flowerError`, `flowerVersion` | the flower's team | everyone |
| `beeMs`, `beeError`, `beeVersion` | the bee's team | everyone |
| `log` (what the bee printed) | the bee's team | everyone if `revealOnFinish` |
| code | own team | everyone if `revealOnFinish` |
| program versions, sizes, costs, change budgets, problems | own team | everyone |
| the bee's `MEMORY` (`teams[i].memory`; query `teams.memory`, `teams.memoryBytes`, `teams.memoryError`) | own team, read only | everyone |
| the scoreboard (every team's totals, shares and fitness) and `ledgers` (feeds, nectar, pollen) | everyone, live | everyone |
| prevalence (every team's F, B, p^F, p^B, fitness and bee nectar balance, about once a second) and every feed's price, net and balance-after | everyone, live | everyone |
| the game's length range (`minMs`, `maxMs`) and the time played (`clockMs`, `round`) | everyone | everyone |
| the game's drawn end (`endMs`; a game with `endFactor` > 1) | nobody (`null`), except `game.drawnEndMs` in the game view of the room's owner when the owner has no team in the game | everyone (`endMs`) |

A field you may not see is **absent** from actions, and **null** in ledger entries and query rows.
Every way of reading actions (pages, `before=`, `mine=1`, the SSE and WebSocket streams) and the team
ledger and history queries apply these rules, so agents reading the API see exactly what the web page shows. Submissions
don't bump the public `game.version`, so other teams can't tell when a team changes its code.

## The game view

```jsonc
{
  "room": { "shortId", "url", "isOwner" },
  "game": { "shortId", "url", "status": "lobby|running|paused|finished", "config",
            "clockMs",        // game time played so far: round × round_ms
            "minMs", "maxMs", // the range the game's end is drawn from: minutes and endFactor × minutes, in ms
            "endMs",          // the game's end: null while hidden (endFactor > 1, until it is finished); a fixed end
                              // (endFactor 1, games from before) all along
            "drawnEndMs",     // only in the view of the room's owner with no team in the game: the drawn end (null
                              // before the start); absent for everyone else
            "fitnessBasis",   // how the scoreboard's fitness is reckoned: "final", "timeAverage" or "shares" (no prevalence)
            "round",          // rounds played so far (counting the one in progress)
            "lastSeq",        // the latest action's seq
            "windowMs",       // the flower window the game plays with (config.flowerWindowMs, or flower.ms in old games)
            "feedPrice",      // the feed price the game plays with (0: free)
            "version", "lastError", "startedAt", "finishedAt", "revealed", "isOwner" },
  "me": { "id", "name", "teamId" } | null,
  "participants": [teamId, ...] | null,   // fixed at the start: team index i in programs and ledgers is participants[i]
  "teams": [{ "id", "name", "color", "members": [names], "participant",
              "index",                    // its index in participants (null if not playing)
              "ready": { "flower": bool, "bee": bool },   // in the lobby
              "programs": { "flower": [version], "bee": [version] } | null,
              "banks": { "flower": { bank, atMs }, "bee": { bank, atMs } } | null,
              "memory": { "value", "bytes", "cap", "version", "error" } | null }],   // the bee's MEMORY: your own
                                          // team's during play, everyone's after finish (version: the bee version it
                                          // belongs to; error: why the last save failed, if it did)
  "myTeam": { "id", "name", "joinCode", "index" } | null,
  "interface": { "flower", "bee", "types": { "challenge", "response", "challengeMeans", "responseMeans", "rules": [..] } },
  "scores": [teamScore] | null,
  "ledgers": { "feeds": [[int]], "nectar": [[number]], "pollen": [[number]] } | null,
  "prevalence": { "on": true, "halfLifeS", "cDecay", "cStart", "cHalfS" /* resolved, sech */ | "cEnd" /* linear */, "cap", "slots", "pools",
                  "prior",                  // resolved: 0.12 × Emax when the config's is null
                  "endowment",              // resolved: 10 × feedPrice when the config's is null (the bee balance's baseline)
                  "feedPrice",              // resolved
                  "sample": sample | null } | null   // the latest sample (below; null before the first);
                                          // null: a game without prevalence
}
```

`version`: `{ version, size, distance, cost, atMs, submittedAt, submittedBy, problem, code? }` (every version,
oldest first; `atMs` = game time it went live, 0 for the lobby; `problem` = the first error it hit).
`programs` and `banks` are your own team's during play (others: null), everyone's after finish; `code`
only where you may see it.

`ledgers` (row = bee team, column = flower team, participants order; whole game so far; public): `feeds[b][f]`
(times b's bee fed at f's flower), `nectar[b][f]` (nectar b's bee got there) and `pollen[b][f]` (what f's
flower kept from b's bee's feeds).

### Prevalence samples

The garden samples every team's prevalence as a round begins, every ⌈1000 / round_ms⌉ rounds (rounds 1, 6,
11, … at 200 ms: once a second of game time). A **sample**, wherever it is published (`prevalence.sample` in
the game view and `base/scores`, `prevalence` on `base/actions` pages and stream messages, `base/prevalence`):

```jsonc
{ "round",     // the round whose draws it gave
  "atMs",      // game time that round began: (round - 1) × round_ms
  "c",         // c(t)
  "slots",     // bees visiting each round: ceil(slots × N)
  "species": [{ "team",            // team id
                "index",           // its index in participants
                "flowerSuccess",   // F_s, par 1 (capped)
                "beeSuccess",      // B_b, par 1 (capped)
                "flowerP",         // p^F_s: the chance a visit is to this species
                "beeP",            // p^B_b: this bee's share of the bee weights
                "fitness",         // its fitness then, by scoring.mode: N² × p^F × p^B of that round ("final"),
                                   // or the time-average of F × B so far ("timeAverage")
                "balance" }] }     // its bee's nectar balance (pools games), else null
```

All public, as it happens. The history queries have every sample as the `prevalence` entity, one row per
team per sample, with the same field names.

## Actions

A turn makes two actions: its **arrival**, written to the stream at once, and its **end** (`feed` or
`leave`), which carries the whole turn.

```jsonc
{ "seq", "atMs", "round",        // order, game time, round. arrive: atMs = (round - 1) × round_ms;
                                 // feed/leave: atMs = (round - 1) × round_ms + the flower window
  "turn",                        // the bee's turn number (1, 2, ...): (bee, turn) identifies a turn
  "bee", "flower",               // team ids: whose bee, whose flower
  "action": "arrive|feed|leave", // feed = the bee fed; leave = it didn't (left, was late, or broke)
  // on feed and leave, public:
  "c", "r",                      // the challenge and the response (null if the flower failed, or over 4 KB)
  "rBytes",                      // the response's size: UTF-8 bytes of its JSON text (null if none)
  "rHash", "rPreview",           // responses over 4 KB only: the SHA-256 (hex) of its JSON text and the
                                 // text's first 4 KB (cut at a whole character). The whole response:
                                 // GET base/responses/:seq
  "pollen",                      // what the flower kept: (1 − percent/100) × E on a feed, 0 on a leave
  "nectar",                      // feed only: what the bee got, percent/100 × E
  "price",                       // feed only: the feed price the bee paid out of it (0 in games without one)
  "net",                         // feed only: nectar − price (can be negative)
  "balance",                     // feed only, pools games: the bee's nectar balance after this feed (else null)
  // on a feed public; on a leave the flower's team only (everyone after finish):
  "percent",                     // 0–100 (null if the flower failed)
  "energy",                      // E, node·ms·bytes (node·ms without the byte factor; 0 if the flower failed)
  // the flower's team (everyone after finish):
  "ms",                          // the flower's CPU time for the call
  "budgetMs",                    // R, the call's hidden time budget (1–50 ms by default): its hard limit, and E's ceiling
  "flowerError",                 // why the response is null (too slow for R, an error, a malformed return)
  "flowerVersion",               // also on arrive
  // the bee's team (everyone after finish):
  "beeMs",                       // the bee's CPU time to decide
  "beeError",                    // e.g. "too slow: no reply within 50 ms", a crash, a bad next challenge,
                                 // a MEMORY over its cap or of the wrong shape (the decision still counts;
                                 // the old memory is kept)
  "beeVersion",                  // also on arrive
  "log",                         // what the bee printed (in decide, and in first and fed since its last turn):
                                 // its own team, or everyone once a finished game is revealed
  // feed only, the bee's team (everyone if config.grains is "public", and after finish):
  "grain",                       // the pollen grain: ⌊pollen^(1/3)⌋ characters of the flower's minified code
                                 // (null when the pollen was 0, or grains are off)
  "grainVersion",                // the flower version it came from (the one that answered)
  "grainCodeLength" }            // that version's minified code's length in characters
```

A queued challenge appears only when its turn ends: nothing shows a bee's next challenge before then.

## Querying history

docs/QUERY.md has the whole query interface: the schema (`turns`, `versions`, `teams`, `pairs`, `prevalence`, `scores`),
the JSON query AST, and the generated Python and TypeScript clients (`/vendor/query/history.py`,
`/vendor/query/history.ts`) for teams, operators and agents. Programs can't query history.

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `base/query` | anyone | a query AST | `{ rows, truncated }`: this game, filtered for the viewer (spectators: the public fields) |
| POST | `/rooms/:room/query` | anyone | a query AST | `{ rows, truncated }`: across the room's **finished** games, fully revealed |
| GET | `/query/schema` | anyone | | the schema |

`limit` defaults to 1,000 rows and is capped at 5,000; `truncated` says more rows matched. A bad query is a
**400** with the reason.

## The team ledger

`GET base/ledger` returns the turn records (the `turns` entity of docs/QUERY.md) as your team may see
them, oldest first by `seq` (the turn's `feed`/`leave` action). Team numbers are indices into
`participants`.

```jsonc
{ "seq": 812, "game": "7", "round": 41, "atMs": 8000, "turn": 12, "bee": 2, "flower": 0,
  "challenge": 17, "response": 52, "fed": true,
  "responseBytes": 2, "responseHash": null,   // a response over 4 KB: response null, its size and SHA-256 here
                                              // (GET base/responses/812 has it)
  "percent": 25, "energy": 123486.0, // public on a feed; on a leave null except at your own flower
  "nectar": 30871.5,                 // on a feed; null on a leave
  "price": 2816000, "net": -2785128.5, // on a feed: the feed price and nectar − price (0 / nectar in games without a price)
  "balance": 25000000,               // on a feed in a pools game: the bee's nectar balance after it (else null)
  "pollen": 92614.5,                 // on a feed; 0 on a leave
  "ms": 2.1, "budgetMs": 92.4, "flowerVersion": 3, "flowerError": null,   // null except at your own flower
  "beeMs": 0.4, "beeVersion": 2, "beeError": null,      // null except for your own bee
  "grain": "def flower(a):\n return(a*3+1)%1000,40",   // ⌊92614.5^(1/3)⌋ = 45 ≥ 37 characters: the whole code
  "grainVersion": 3, "grainCodeLength": 37 }            // your own bee's feeds only (unless grains are public)
```

Once the game is over, every field is filled in for everyone.

## Program interfaces

**Python**

```python
def flower(challenge):
    return response, percent                # percent: 0-100 of this turn's excess energy, if the bee feeds

def first():
    return challenge                        # the challenge for the bee's next turn

def decide(challenge, response):            # response is None if the flower failed
    return "feed", next_challenge           # or "leave", next_challenge

def fed(nectar):                            # optional: after a feed decided in time, same instance as decide
    return None                             # or a next challenge, replacing decide's
```

**TypeScript**

```ts
function flower(challenge: Challenge): [Response, number]
function first(): Challenge
function decide(challenge: Challenge, response: Response | null): ["feed" | "leave", Challenge]
function fed(nectar: number): Challenge | void  // optional: may return the next challenge
```

Programs see only their arguments and `GAME` (`team`, `teams`, `feed_cost`, `feed_price`, `challenge_type`,
`response_type`, `max_len`, `max_nodes`, `max_response_bytes`, `round_ms`, `ms` (its own limit),
`flower_ms` (50, R's most), `flower_window_ms` (150), `flower_size_cap`; a flower's `ms` is this call's hidden budget R (1–50 ms of CPU by default) and `size`
its own; a bee's `ms` is 50 (ms of CPU) and it also gets `memory`, its memory cap): no
history, no round or game time. Every flower call and every bee turn runs a fresh program, and its clock
starts at 0 (Python's `time`, TypeScript's `Date`, `Intl` and `performance` read the time since the call
started, as if it were 1970-01-01; RULES.md "The clock"). A bee also has **`MEMORY`**, a
key–value store (`{}` for a new version) that it changes in place or reassigns; after each `first`,
`decide` or `fed` that returns, the game saves it if it has the right shape and fits `memory` bytes (else
it keeps the old one and records the error: on the turn's `beeError` for `decide`, and in the team's
`memory.error`; the decision still counts). `fed(nectar)`, if defined, runs after a feed decided in time,
in the same program instance as that `decide`, stopped at `bee.ms` of CPU. A valid challenge it returns replaces
the one `decide` queued; `None`/`null`/`undefined` keeps `decide`'s; anything else keeps it too and is
reported to the team as a problem, as is a `fed` that crashes or is stopped (which also keeps the `MEMORY`
saved after `decide`). With `feedCost` 0, a `fed` still running when the bee's next turn starts is too late:
that turn plays `decide`'s challenge. `MEMORY` is the only thing that
carries over from one turn to the next. No endpoint writes it. `interface` in the game view has the
signatures for the game's language and types.


## The game's length

`config.minutes` is the shortest a game lasts and `config.endFactor` × `minutes` the longest (`minMs`, `maxMs`
in the views, public). `POST base/start` draws the end, uniform in that range and rounded up to a whole round,
into `games.end_ms`; the garden stops when the clock reaches it. **Until the game is finished nothing a team
or a spectator can read carries it**: the game view, `base/scores`, the room's game list, actions, the
ledger, the streams, the history queries and `interface` show `endMs: null` with the range; programs get no
clock at all. The room owner's game view carries it as `drawnEndMs`, unless the owner is on a team in the game.
When the game finishes (its end reached, or the owner's `finish`), `status` becomes `"finished"` everywhere
(`base/scores`, the game view, `base/events` and `base/ws` messages, the room's events) and `endMs` is the
drawn end for everyone; `clockMs` is when it actually stopped (earlier if the owner finished it early). A game
with a fixed end (`endFactor` 1, or stored before random ends) shows `endMs` all along.

## Scores

`teamScore`:

```jsonc
{ "teamId",
  "fitness",
  "flowerSuccess", "beeSuccess", "flowerP", "beeP",   // with prevalence: the latest sample's (null before it, and without)
  "pollination", "forage", "pollinationShare", "forageShare",
  "pollen", "feedsReceived", "feedsGiven", "pollinators", "nectarCollected", "nectarGiven", "nectarSources" }
```

The scoreboard is live and public: every team's numbers, for everyone (spectators included), during play
and after.

- With `prevalence`, by `config.scoring.mode` (`fitnessBasis` in the game view and `base/scores` says which):
  - `"final"` (new games): `fitness` = N² × p^F × p^B of the latest round played: live, the value as it stands;
    once the game is over, the final round's, the final score. Each p is that round's draw probability, c
    included and the cap applied, so par is 1.
  - `"timeAverage"` (v2 and v3 games, stored without a mode): `fitness` = the time-average over the rounds
    played of F_s × B_s.
  Both are kept on the game as `{ sum, rounds, last }` (Σ F × B, rounds, and each team's latest N² × p^F ×
  p^B; v3 games stored `{ sum, rounds }`), written with the ledgers; 1 before the first round. The rest is
  information.
- Without it (games from before): `fitness` = N² × pollinationShare × forageShare, as below.

- `pollination` = Σ over bee teams b of pollen[b][me]^β: the pollen your flower kept from each bee team's feeds.
- `forage` = Σ over flower teams f of nectar[me][f]^α: the nectar your bee got at each flower.
- α and β are the game's `config.scoring.alpha` and `beta` (0.85 by default). A game stored without `scoring` is
  from before it existed and is scored with √ (α = β = 0.5); the game view's `config.scoring` says which.
- each share = your value ÷ the sum over all teams (1/N when that sum is 0).
- `fitness` = N² × pollinationShare × forageShare. Par is 1.0.
- Information only: `pollen` (all your flower kept), `feedsReceived` / `feedsGiven`, `pollinators` (bee
  teams that fed at your flower), `nectarCollected`, `nectarGiven` (all your flower paid) and
  `nectarSources` (flower teams that paid your bee).

Every server process connected to the same database runs whichever running games nobody else is running
(docs/DESIGN.md), so servers that share a database share their games.
