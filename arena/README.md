# Arena: evolving LLM-agent populations

The arena pits a diverse, evolving population of LLM-driven teams against each other through the game's HTTP API,
to study the ecosystem the game creates and hunt for **complexity-collapse** scenarios. Findings are in
[REPORT.md](REPORT.md).

## What's here

| Path | What |
|---|---|
| `run.js` | the arena runner: creates rooms and games, runs team agents each round, interviews, judges, retirements, breeding |
| `analyze.js` | prints a Markdown summary of everything in the `arena` schema (spend, leaderboards, metrics, conditions, orchid targets, collapses, judges, ideas, breeders) |
| `backfill.js` | recomputes and stores metrics (incl. orchid targets) for every played game; safe to re-run |
| `schema.sql` | the `arena` Postgres schema (same `dbc` database as the game), applied on every run |
| `lib/llm.js` | `claude -p` wrapper: concurrency limiter, retries, rate-limit cool-down, spend guard, cost ledger (`arena.llm_calls`) |
| `lib/api.js` | HTTP client for the game API (dev login with Bearer tokens) |
| `lib/team.js` | one team-agent turn: prompt from its own filtered game view, parse, `check` + `try` validation, up to 2 retries, submit; and the post-game interview |
| `lib/logs.js` | compact scoreboard / ledgers / private bee and flower logs (last 2 rounds detailed, older rounds summarised, identical visits grouped) |
| `lib/prompts.js` | system and user prompts for team agents, judges and breeders |
| `lib/personas.js` | 20 founding personas (10 adult archetypes, 10 twelve-year-olds), 4 teen judges, 3 breeders |
| `lib/social.js` | interviews → judges → idea ledger → social scores |
| `lib/metrics.js` | per-round and per-game metrics and collapse detection |
| `lib/targets.js` | whose clover each orchid imitates (self / rival / convention / none), exact and structural (trees, graphs); victims' clover fed rates; bees' structural tests |
| `lib/gamemetrics.js` | computes and stores all metrics of a finished game (used by `run.js` and `backfill.js`) |
| `lib/population.js` | retirement rules and the breeder competition |
| `lib/presets.js` | arena settings and founding lineups |
| `runs/` | logs (gitignored) |

## Running

Needs the game's Postgres (`postgres://dbc:dbc@localhost:5432/dbc` by default), `python3`, and the `claude` CLI logged in.

```
# 1. your own API server (any port; the arena talks to it over HTTP)
PORT=4000 MAX_CONCURRENT_ROUNDS=8 nohup node server/index.js > arena/runs/server4000.log 2>&1 &

# 2. a pilot: 4 teams, 3 rounds, sonnet + haiku
node arena/run.js --arena pilot --preset pilot --generations 1

# 3. several arenas concurrently (arena id = preset name; a suffix like "-2" reuses the preset;
#    ":n" after an id sets that arena's number of generations)
ARENA_CONCURRENCY=20 ARENA_BUDGET_USD=370 nohup node arena/run.js \
  --arenas baseline:5,strdark:5,lists:5,tight:5,cheapfeed:5,norecap:5,unprimed:6,trees:6,graphs:6 >> arena/runs/main.out 2>&1 &
echo 16 > arena/runs/concurrency      # change the concurrency of a running runner (polled every 20 s)

# 4. summary
node arena/analyze.js > arena/runs/analysis.md
```

Re-running the same command **resumes**: every game records its stage (`created → playing → played → interviewed →
judged → done`) and the runner skips finished work, including team turns whose reply was already processed, and
judging restarts cleanly. Running more generations later just extends the arena. Kill the runner, not the API server,
mid-round; restart the server only when no round is simulating (`SELECT count(*) FROM games WHERE running_round IS NOT NULL`).

| Env | Default | |
|---|---|---|
| `ARENA_API` | `http://localhost:4000` | game API base |
| `ARENA_CONCURRENCY` | `8` | concurrent `claude` processes (per runner process); `arena/runs/concurrency` overrides it live |
| `ARENA_BUDGET_USD` | `300` | global spend cap over all of `arena.llm_calls`; arenas stop cleanly when reached |
| `ARENA_TEAM_EFFORT` | `{}` | JSON overrides of per-model effort for team turns (default haiku low, others medium) |
| `ARENA_SOCIAL_FLOOR` | `4.0` | mean social score below which a persona is retired |
| `--budget <usd>` | | per-arena cap (stored in the arena's settings) |

## How a generation works

1. **Game**: the arena's room owner creates a game with the preset's config; every active persona logs in
   (`POST /auth/dev/login`) and creates its team.
2. **Rounds**: before each round every team agent gets (system prompt) its persona, the arena frame (interview warning,
   reply format) and RULES.md (read fresh for every prompt); (user prompt) the settings, its notebook, its exact current
   programs, the scoreboard, the public ledgers, and its private logs from its own filtered view (trees and graphs are shown
   in a compact notation). **There is no starter code**: round 1 shows only `view.interface` (function signatures and the
   game's types). In round 1 of games after the first it also gets a recap of the previous game: standings, social scores,
   every team's revealed final code (`norecap`: standings only), and what the panel said about it. It replies with
   `<clover>`, `<orchid>`, `<bee>`, `<notes>` tags (a JSON object with the same keys also works; tags avoid code-in-JSON
   escaping errors). Each program is validated with `POST base/check` plus a runtime smoke test with `POST base/try`
   (flowers on edge-case challenges, the bee foraging its own new flowers). Errors go back to the agent (max 2 retries).
   After round 1 a program that never passes carries over; in round 1 a team without all three valid programs **sits the
   game out** (no placeholder code, which would itself be a Schelling point) and that counts as last place for selection.
3. **Metrics** from the revealed game view: `arena.round_metrics`, `arena.games.metrics`, `arena.collapse_events`,
   including orchid targets (every clover and orchid re-run on the challenges bees actually asked that round). Each game
   is labelled `primed` (its round-1 prompts showed the old shared starter code), `post-primed` (no starters, but the arena
   started primed) or `unprimed` (`arena.games.condition`).
4. **Interview**: each agent writes "teach us your code" for 10–14-year-olds.
5. **Judges**: Maya 13 (opus), Dev 11 (sonnet), Hana 14 (fable), Leo 10 (haiku) each score every team's final code +
   explanation on understanding, respect, novelty and want-to-team-up, and tag its ideas. One judge goes first; its new
   tags are shown to the other three so tags converge. The idea ledger (`arena.ideas`) is shared by all arenas.
   Social score = 0.2·understanding + 0.3·respect + 0.2·novelty + 0.3·team-up, averaged over judges (0–10). Judges never
   see fitness, and social never enters fitness.
6. **Selection**: a persona with ≥ 2 games is retired if it was in the social bottom quartile in 2 of its last 3 games,
   or its mean social is below the floor (mandatory social filter); or if it was in the fitness bottom quartile in 2 of
   its last 3 games with a weak combined percentile. If nobody qualifies, the weakest overall is retired when its
   combined fitness+social percentile is below 0.30. At most ⌈N/3⌉ per generation.
7. **Breeding**: each open slot keeps the retired persona's model; a breeder (Fern/fable, Oak/opus, Moss/sonnet) is drawn
   with probability ∝ exp(4·(score − 0.5)), where score = mean (fitness percentile + social percentile)/2 of its spawn
   across all arenas. The breeder sees the population, all spawn records, the idea ledger and the top teams' persona prompts,
   and writes a new persona prompt.

## Useful queries

```sql
SELECT purpose, model, count(*), round(sum(cost_usd)::numeric, 2) FROM arena.llm_calls GROUP BY 1, 2 ORDER BY 1, 4 DESC;
SELECT g.arena_id, g.generation, g.game_url, g.metrics->'collapses' FROM arena.games g ORDER BY 1, 2;
SELECT p.name, e.fitness, e.social, e.social_parts FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = 1;
SELECT tag, description, first_arena, first_team FROM arena.ideas ORDER BY id;
```

Games live in the game's own tables, so every arena game replays in the web UI at its `/room/<room>/game/<game>` URL.
