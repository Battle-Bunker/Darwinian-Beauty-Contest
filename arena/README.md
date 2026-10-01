# Arena: evolving LLM-agent populations

The arena pits a diverse, evolving population of LLM-driven teams against each other through the game's HTTP API,
to study the ecosystem the game creates and hunt for **complexity-collapse** scenarios. Findings are in
[REPORT.md](REPORT.md).

## What's here

| Path | What |
|---|---|
| `run.js` | the arena runner: creates rooms and games, runs team agents each round, interviews, judges, retirements, breeding |
| `fork.js` | forks a played game's population into identical cohorts for a controlled experiment (see "Cohort experiments") |
| `analyze.js` | prints a Markdown summary of everything in the `arena` schema (spend, leaderboards, metrics, conditions, orchid targets, collapses, judges, ideas, breeders; engine-v2 behaviour, hinted vs unhinted teams, the fair-play audit; the cohort experiment's paired comparisons and adoption) |
| `backfill.js` | recomputes and stores metrics (incl. orchid targets) for every played game; safe to re-run |
| `test-pause.mjs` | self-contained check of usage-limit detection and pause/resume, with a stub `claude` (no real calls) |
| `schema.sql` | the `arena` Postgres schema (same `dbc` database as the game), applied on every run |
| `lib/llm.js` | `claude -p` wrapper: concurrency limiter, retries, rate-limit cool-down, spend guard, cost ledger (`arena.llm_calls`) |
| `lib/api.js` | HTTP client for the game API (dev login with Bearer tokens) |
| `lib/team.js` | one team-agent turn. Phase-1 mode: prompt from its own filtered game view, parse, `check` + `try` validation, up to 2 retries, submit. Tools mode (`playTurnTools`): a tool-using session in the team's workspace, audit, validation, fix sessions, submit. Also the post-game interview |
| `lib/workspace.js` | tools mode: builds each team's private workspace (raw files, no tools, no tokens), collects its programs, and audits session transcripts for fair play (`arena.violations`) |
| `lib/dbview.js` | a fully revealed game view built from the game's tables (for metrics and judges when `revealOnFinish` is false) |
| `lib/cohort.js` | cohort-experiment measures for `analyze.js`: answer-shape census, borrowing from the top-2 demo, Python use and idea-file reads from session transcripts |
| `lib/adoption.js` | cohort experiment: which catalogue ideas each team's code implements, per round (keywords + a haiku classifier; `arena.adoption`) |
| `lib/logs.js` | compact scoreboard / ledgers / private bee and flower logs (last 2 rounds detailed, older rounds summarised, identical visits grouped) |
| `lib/prompts.js` | system and user prompts for team agents, judges and breeders |
| `lib/personas.js` | 20 founding personas (10 adult archetypes, 10 twelve-year-olds), 4 teen judges, 3 breeders, idea cards A/B and the cohort cards G1–G3 |
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
# 1. your own API server (any port; the arena talks to it over HTTP). With DEV_LOGIN_SECRET set, dev login needs the
#    secret, so a tool-using agent can't log in as another team. The runner reads it from ARENA_DEV_SECRET or from
#    arena/runs/.dev-secret (mode 600, gitignored); it is never written to a workspace or a prompt.
umask 077; [ -f arena/runs/.dev-secret ] || openssl rand -hex 24 > arena/runs/.dev-secret
DEV_LOGIN_SECRET=$(cat arena/runs/.dev-secret) PORT=4000 MAX_CONCURRENT_ROUNDS=8 nohup node server/index.js > arena/runs/server4000.log 2>&1 &

# 2. a pilot: 4 teams, 3 rounds, sonnet + haiku
node arena/run.js --arena pilot --preset pilot --generations 1

# 3. several arenas concurrently (arena id = preset name; a suffix like "-2" reuses the preset;
#    ":n" after an id sets that arena's number of generations). Keep concurrency modest: the account's
#    usage limit is shared with every other session.
ARENA_CONCURRENCY=8 ARENA_BUDGET_USD=370 nohup node arena/run.js \
  --arenas baseline:4,strdark:5,lists:4,tight:4,cheapfeed:3,norecap:4,unprimed:5,trees:5,graphs:6 >> arena/runs/main.out 2>&1 &
echo 6 > arena/runs/concurrency       # change the concurrency of a running runner (polled every 20 s)

# 4. summary (also: node arena/backfill.js recomputes stored metrics for every played game)
node arena/analyze.js > arena/runs/analysis.md
```

### Pause, resume, restart

**Automatic pause on usage limits.** Any `claude -p` failure whose text matches a usage or session limit pauses the
whole runner. That means "session limit", "usage limit", "limit · resets", "hit your … limit", "resets 3:10am", 429 or
rate_limit. When it fires:
- it writes `arena/runs/PAUSED` (the time, then the raw error text, including the "resets …" time)
- it logs `[arena] PAUSED: usage limit hit (<msg>). Resume: rm arena/runs/PAUSED`
- it starts no new model calls and doesn't advance any game: no new round, no new game
- calls that come back limit-failed are **held**: they don't count as attempts, don't fail a team, an interview or a
  judge, and are re-issued unchanged on resume

Calls already in flight finish normally.

| to | do |
|---|---|
| pause by hand | `echo manual > arena/runs/PAUSED` (in-flight calls finish; nothing new starts) |
| resume | `rm arena/runs/PAUSED`. The runner polls every 30 s and carries on. It never resumes on a timer: delete the file once the platform says usage is available again |
| check | `cat arena/runs/PAUSED`; `grep -E "PAUSED\|RESUMED" arena/runs/main.out` |
| stop | `kill <pid of node arena/run.js>`, then kill its `claude -p` children (orphans keep running and spending otherwise): `for p in $(pgrep -f "claude -p --model"); do [ "$(head -c 9 /proc/$p/cmdline \| tr '\0' ' ')" = "claude -p" ] && kill $p; done` |
| restart | run the same `node arena/run.js --arenas …` command again. If `arena/runs/PAUSED` still exists it starts paused and waits |

**Restarting resumes from the database.** Every game records its stage (`created → playing → played → interviewed →
judged → done`), and the runner skips finished work:
- **rounds**: finished rounds are never replayed; the current round's turns are re-run, except turns whose reply was
  already processed
- **interviews**: only the missing ones are redone
- **judging**: it restarts cleanly, dropping any partial evaluations and ledger entries for that game
- **breeding**: unfilled slots are refilled before the next game

Running more generations later just extends an arena. Calls that were in flight when the runner was killed are lost
(their cost isn't in the ledger). Kill the runner, not the API server, mid-round. Restart the API server only when no
round is simulating: `SELECT count(*) FROM games WHERE running_round IS NOT NULL` returns 0.

**Quarantine.** Games hurt by an outage carry a reason in `arena.games.contaminated`. `analyze.js`, selection
(retirements) and breeder scores ignore them, and they stay in the database for replay.

| Env | Default | |
|---|---|---|
| `ARENA_API` | `http://localhost:4000` | game API base |
| `ARENA_CONCURRENCY` | `8` | concurrent `claude` processes (per runner process); `arena/runs/concurrency` overrides it live |
| `ARENA_BUDGET_USD` | `300` | global spend cap over all of `arena.llm_calls`; arenas stop cleanly when reached |
| `ARENA_TEAM_EFFORT` | `{}` | JSON overrides of per-model effort for team turns (default haiku low, others medium) |
| `ARENA_SOCIAL_FLOOR` | `4.0` | mean social score below which a persona is retired |
| `ARENA_PAUSE_FILE` | `arena/runs/PAUSED` | the pause file (tests point it elsewhere) |
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
5. **Judges**: Maya 13 (opus), Dev 11 (sonnet), Hana 14 (opus; fable until phase 1 ended), Leo 10 (haiku) each score every team's final code +
   explanation on understanding, respect, novelty and want-to-team-up, and tag its ideas. One judge goes first; its new
   tags are shown to the other three so tags converge. The idea ledger (`arena.ideas`) is shared by all arenas.
   Social score = 0.2·understanding + 0.3·respect + 0.2·novelty + 0.3·team-up, averaged over judges (0–10). Judges never
   see fitness, and social never enters fitness.
6. **Selection**: a persona with ≥ 2 games is retired if it was in the social bottom quartile in 2 of its last 3 games,
   or its mean social is below the floor (mandatory social filter); or if it was in the fitness bottom quartile in 2 of
   its last 3 games with a weak combined percentile. If nobody qualifies, the weakest overall is retired when its
   combined fitness+social percentile is below 0.30. At most ⌈N/3⌉ per generation.
7. **Breeding**: each open slot keeps the retired persona's model; a breeder (Fern/opus, Oak/opus, Moss/sonnet; Fern was fable in phase 1) is drawn
   with probability ∝ exp(4·(score − 0.5)), where score = mean (fitness percentile + social percentile)/2 of its spawn
   across all arenas. The breeder sees the population, all spawn records, the idea ledger and the top teams' persona prompts,
   and writes a new persona prompt.

## Engine v2: tool-using team sessions (`mode: "tools"`)

Arenas whose settings say `mode: "tools"` (the `v2-*` presets and the cohort arenas) don't prompt for code. Each team
turn is a headless Claude Code session working on raw files:

```
claude -p --model <m> --tools Bash,Read,Write,Edit,Glob,Grep --permission-mode acceptEdits \
  [--allowedTools "Bash(python3:*)" "Bash(python:*)"] --max-turns N --max-budget-usd X \
  --output-format stream-json --verbose --no-session-persistence --system-prompt <full system prompt>
```

- **Workspace**: `/home/user/arena-ws/<arena>/<persona>/` (outside the repo; `ARENA_WS_ROOT`). Before every round
  `prepareWorkspace` writes:
  - `README.md`, `RULES.md` (fresh), `interface.txt`, `config.json`, `notebook.md` and the idea card if the team has one
  - the team's current `clover.py`, `orchid.py`, `bee.py`, plus `history/round-N/` with earlier versions
  - its own logs only: `logs/round-N/{round.json, visits.jsonl, my-bee.jsonl, my-patch.jsonl}`, `memory/round-N.txt`
    (its bee's MEMORY) and `logs/game.json`
  - `previous-games/game-K/`: its own logs from earlier games, the standings, the panel's feedback (`panel.md`) and,
    depending on the arena's recap mode, every team's final code or only the top 2 (`top2/`)

  There are no tools, tokens or game URLs in the workspace. The runner submits the programs the session leaves behind.
- **Environment**: sessions run with `{HOME, PATH, LANG}` only, so there is no `DATABASE_URL`, no dev secret and no API
  token. The full `--system-prompt` replaces Claude Code's default, which mentions the user's memory directory.
- **Limits** per session: opus 30 turns / $2.50, sonnet 30 / $1.00, haiku 25 / $0.60 (`ARENA_SESSION_LIMITS` overrides
  them as JSON). Fix sessions get a third of the budget and at most 15 turns. Round 1 gets up to 4 fix sessions, later
  rounds 2. Validation is the same `check` + `try` as phase 1.
- **Python**: with `--allowedTools Bash(python3:*)` sessions can run their programs locally. It is on by default. A
  cohort arena with `settings.pythonFromGame = k` turns it on from game k, so every cohort switches at the same game
  boundary. `arena.games.python` records which games had it. Without it, `python3 …` commands are denied by the CLI and
  the session must reason about its code by reading it.
- **Fair play**: the system prompt says to use only the workspace (not even `/tmp`) and never to touch the database, the
  network, the game server, other teams' data, logins or environment variables. After every session `audit()` reads the
  transcript:
  - **Bash commands**: paths outside the workspace, `..` escapes, other teams' workspaces, `psql`/DB URLs,
    `env`/`printenv`/`/proc/self`, auth endpoints, network tools in command position, and network libraries in inline
    scripts. The working directory is tracked across calls, because Claude Code's Bash tool keeps it. The `..` check
    skips `echo`/`printf` text and the bodies of data heredocs (`cat > notes.md <<'E' … E`).
  - **Read/Glob/Grep**: their paths
  - **Write/Edit content**: DB access, outside paths, other workspaces, network libraries (`socket`, `urllib`, `requests`,
    `http.client`, `curl`, …) and environment reads (`os.environ`, `getenv`)

  The team's own tool-output spill directory (`~/.claude/projects/<workspace path with non-alphanumerics as "-">`) is
  allowed, and `/tmp` is only a warning. Anything else is a **violation**: the team's previous code is resubmitted
  unchanged, or in round 1 it sits the game out. Every finding goes to `arena.violations`. A finding later judged
  spurious is re-labelled `severity = 'false-positive'` and the row is kept.

  To give a team its turn back, fix the detector and restart the runner before that round simulates. A disqualified
  turn leaves no `agent_turns` row, so the restarted runner plays it again. Once the round has simulated, the
  disqualification stands.
- **Idea cards**: `personas.idea_card` A or B (v2 arenas) adds a short card of game-specific ideas to the workspace, so
  `analyze.js` can compare hinted and unhinted teams.

## Cohort experiments (`fork.js`)

A controlled experiment forks one played game's population into identical arenas, then plays the same games in each:

```
node arena/fork.js --from v2-graphs --game 1 --cohorts gx-control,gx-treat,gx-control2 --treat gx-treat --generations 3
psql … -c "UPDATE arena.arenas SET settings = settings || '{\"pythonFromGame\": 2}' WHERE id LIKE 'gx-%'"   # optional
ARENA_CONCURRENCY=8 ARENA_BUDGET_USD=<cap> nohup node arena/run.js --arenas gx-control:3,gx-treat:3,gx-control2:3 >> arena/runs/v2main.out 2>&1 &
```

- **Cohort setup**: each cohort gets its own room and copies of the source game's personas, with the same prompt, model
  and team name. It also gets each persona's notebook as it stood at the end of the source game, and a workspace
  holding that game as `previous-games/game-0/`. The team's final programs become its starting code.
- **Treatment**: in the treatment cohort, 3 teams (the first team of each model, in slug order) get different slices of
  `docs/research/asymmetric-graph-games.md` as `ideas.md` (cards G1–G3). The rule and the holders are stored in
  `settings.cohort`.
- **Identical conditions**: membership is fixed (`noEvolution`: no retirement, no breeding). Seeds are identical
  across cohorts: round r of game g uses `(seedBase + 1009·g + 31·r) mod 2^31`, sent with `POST …/rounds {seed}`.
- **Information flow**:
  - The game config has `revealOnFinish: false`, so no team can pull rivals' code through the API.
  - The only diffusion channel between games is the top-2 teams' final code, plus standings and panel feedback, in
    `previous-games/`.
  - The idea ledger the judges see is scoped to the cohort, excluding its sibling cohorts.
  - Metrics and judging read the revealed view straight from the DB (`lib/dbview.js`).
- **Adoption**: after each game, `lib/adoption.js` records per team and round which catalogue ideas its code (and
  notebook) shows. It uses keywords plus a haiku classifier (purpose `classifier`), which is re-run only when the code
  changed. A restart during classification re-runs it on resume. `analyze.js` prints:
  - the paired cohort comparisons and the noise floor (control vs control2)
  - adoption over time
  - a manipulation check: who opened `ideas.md`, and Python use, from the transcripts
  - the answer-shape metagame
  - code borrowed from the top-2 demo
- **After the experiment**: set `revealOnFinish` to true in those games' `config`, so they replay fully in the web UI.
  For example: `UPDATE games SET config = jsonb_set(config, '{revealOnFinish}', 'true') WHERE id = ANY(<the cohort
  games' uuids>) AND status = 'finished'`. Then `node arena/backfill.js --arena <cohort>` can recompute their metrics
  from the API.

## Useful queries

```sql
SELECT purpose, model, count(*), round(sum(cost_usd)::numeric, 2) FROM arena.llm_calls GROUP BY 1, 2 ORDER BY 1, 4 DESC;
SELECT g.arena_id, g.generation, g.game_url, g.metrics->'collapses' FROM arena.games g ORDER BY 1, 2;
SELECT p.name, e.fitness, e.social, e.social_parts FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = 1;
SELECT tag, description, first_arena, first_team FROM arena.ideas ORDER BY id;
```

Games live in the game's own tables, so every arena game replays in the web UI at its `/room/<room>/game/<game>` URL.
