# Arena: LLM-agent teams playing Darwinian Beauty Contest

The arena runs populations of LLM-driven teams against each other through the game's HTTP API, to study the ecosystem
the game creates and hunt for **complexity-collapse** scenarios. Findings are in [REPORT.md](REPORT.md).

Every team turn is a tool-using Claude Code session in the team's private workspace. After each game there are
metrics, interviews and the teen judges, then selection and breeding, unless the arena has fixed membership as
continuations and cohort experiments do.

## What's here

| Path | What |
|---|---|
| `run.js` | the arena runner: creates rooms and games, runs the team sessions before each round, simulates rounds one at a time, then metrics, interviews, judges, retirements and breeding |
| `fork.js` | forks a played game's population into a continuation arena or identical cohorts for an experiment |
| `analyze.js` | prints a Markdown summary of everything in the `arena` schema: spend, leaderboards, metrics, collapses, judges, ideas, breeders, the fair-play audit, cohort experiments and engine-v3 measures |
| `server.sh` | (re)starts the arena's game server on port 4000 with the dev secret and `CPU_SLOTS=3`, only when no round is simulating |
| `test-brief.mjs` | dry-run check of the round briefs: fresh vs forked game 1, round-1 notices, change turns, locked-file notes |
| `test-pause.mjs` | check of usage-limit detection and pause/resume, with a stub `claude` (no real calls) |
| `schema.sql` | the `arena` Postgres schema (same `dbc` database as the game), applied on every run |
| `lib/llm.js` | `claude -p` wrapper: concurrency limiter, retries, rate-limit cool-down, usage-limit pause, spend guard, cost ledger (`arena.llm_calls`) |
| `lib/api.js` | HTTP client for the game API (dev login with the dev secret and Bearer tokens) |
| `lib/team.js` | one team's turn: the session, the fair-play audit, validation (`check` + `try`), submission of the programs whose turn it is, fix sessions; and the post-game interview |
| `lib/workspace.js` | builds each team's private workspace (raw files, no tokens), collects its programs, and audits session transcripts (`arena.violations`) |
| `lib/prompts.js` | team-agent system prompt and round briefs, round-1 notices, interview, judge and breeder prompts |
| `lib/personas.js` | 20 founding personas (10 adult archetypes, 10 twelve-year-olds), 4 teen judges, 3 breeders |
| `lib/presets.js` | settings and founding lineups for fresh arenas |
| `lib/social.js` | interviews → judges → idea ledger → social scores |
| `lib/population.js` | retirement rules and the breeder competition |
| `lib/metrics.js`, `lib/gamemetrics.js` | per-round and per-game metrics and collapse detection, stored after each game |
| `lib/dbview.js` | a fully revealed game view built from the game's tables (metrics and judges when `revealOnFinish` is false) |
| `lib/adoption.js` | cohort experiments: which catalogue ideas each team's code implements, per round (keywords plus a haiku classifier; `arena.adoption`) |
| `lib/cohort.js` | cohort measures for `analyze.js`: answer-shape census, borrowing from the top-2 demo, Python use and idea-file reads |
| `lib/v3.js` | engine-v3 measures for `analyze.js`: discrimination on rival patches, fingerprinting, stolen-face and twin orchids, non-deterministic flowers, compute against budget, example markers |
| `runs/` | logs and session transcripts (gitignored) |

## Running

Needs the game's Postgres (`postgres://dbc:dbc@localhost:5432/dbc` by default), `python3`, and the `claude` CLI logged in.

```
# 1. your own API server on port 4000. With DEV_LOGIN_SECRET set, dev login needs the secret, so a tool-using agent
#    can't log in as another team. The secret lives in arena/runs/.dev-secret (mode 600, gitignored), and the runner
#    reads it from there or from ARENA_DEV_SECRET; it never goes into a workspace or a prompt.
arena/server.sh

# 2. a fresh pilot arena (3 teams, 2 rounds)
node arena/run.js --arena pilot --generations 1

# 3. a continuation forked from a played game, then its games (see "Forks and cohort experiments")
node arena/fork.js --from gx-control --game 3 --cohorts v3-base --experiment v3 --notice v3-rules --generations 2 --seed-base 20261020
ARENA_CONCURRENCY=8 ARENA_BUDGET_USD=540 nohup node arena/run.js --arenas v3-base:2 >> arena/runs/v3.out 2>&1 &
echo 6 > arena/runs/concurrency       # change the concurrency of a running runner (polled every 20 s)

# 4. summary
node arena/analyze.js --arenas v3-base > arena/runs/analysis-v3.md
```

`--arenas a:2,b:3` runs several arenas in one process (":n" sets the number of games). The account's usage limit is
shared with every other session, so keep concurrency modest.

### Pause, resume, restart

**Automatic pause on usage limits.** Any `claude -p` failure whose text matches a usage or session limit pauses the
whole runner. The patterns are "session limit", "usage limit", "limit · resets", "hit your … limit", "resets 3:10am",
429 and rate_limit. When it fires:
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
| check | `cat arena/runs/PAUSED`; `grep -E "PAUSED\|RESUMED" arena/runs/*.out` |
| stop | `kill <pid of node arena/run.js>`, then kill its `claude -p` children (orphans keep running and spending otherwise): `for p in $(pgrep -P <pid>); do kill $p; done` |
| restart | run the same `node arena/run.js --arenas …` command again. If `arena/runs/PAUSED` still exists it starts paused and waits |

**Restarting resumes from the database.** Every game records its stage (`created → playing → played → interviewed →
judged → done`), and the runner skips finished work:
- **rounds**: finished rounds are never replayed; the current round's turns are re-run, except turns whose session was
  already processed
- **adoption classification** (cohorts): an incomplete one is re-run
- **interviews**: only the missing ones are redone
- **judging**: it restarts cleanly, dropping any partial evaluations and ledger entries for that game
- **breeding**: unfilled slots are refilled before the next game

Running more games later just extends an arena. Calls that were in flight when the runner was killed are lost (their
cost isn't in the ledger). Kill the runner, not the API server, mid-round. Restart the API server only when no round is
simulating (`arena/server.sh` checks this).

**One round simulates at a time.** A flower's compute use is a real signal, since a clover can search until its
`GAME["ms"]` budget is nearly spent. So the arenas in one runner process queue their round simulations
(`simulateSerially` in `run.js`), and the server's `CPU_SLOTS` serve one game at a time. Agent sessions still run in
parallel; only the simulation waits. A log line says when an arena waited more than 5 s for another arena's round.

**Quarantine.** Games hurt by an outage carry a reason in `arena.games.contaminated`. `analyze.js`, selection
(retirements) and breeder scores ignore them, and they stay in the database for replay.

| Env | Default | |
|---|---|---|
| `ARENA_API` | `http://localhost:4000` | game API base |
| `ARENA_CONCURRENCY` | `8` | concurrent `claude` processes per runner process; `arena/runs/concurrency` overrides it live |
| `ARENA_BUDGET_USD` | `300` | global spend cap over all of `arena.llm_calls`; arenas stop cleanly when it is reached |
| `ARENA_SESSION_LIMITS` | see below | JSON overrides of the per-model session limits |
| `ARENA_SOCIAL_FLOOR` | `4.0` | mean social score below which a persona is retired |
| `ARENA_WS_ROOT` | `/home/user/arena-ws` | where workspaces live (outside the repo) |
| `ARENA_PAUSE_FILE` | `arena/runs/PAUSED` | the pause file (tests point it elsewhere) |
| `--budget <usd>` | | per-arena cap (stored in the arena's settings) |

## How a game works

1. **Setup.** The arena's room owner creates a game with the arena's config. Every active persona logs in
   (`POST /auth/dev/login` with the secret) and creates its team.
2. **Turns.** Before each round, every team gets one session (see below). In round 1 all three programs are written.
   After that the programs take turns to change, one kind per round (the server's `game.changeable`; RULES.md "Taking
   turns to change").
   - The brief says whose turn it is, the change budget, and when the locked programs' next turns come.
   - Only the open program is validated and submitted.
   - If a team edits a locked file anyway, the runner puts the version that played back and says so in the team's
     next brief. It doesn't trigger a fix session.
   - A program that fails its checks gets up to 2 fix sessions (4 in round 1), with its minified form saved as
     `<kind>.minified.py`, since error messages refer to it.
   - In round 1, a team without all three valid programs **sits the game out**.
3. **Simulation.** The round runs on the server. Cohort arenas send a fixed seed per (game, round), identical in every
   cohort.
4. **Metrics.** They are computed from the game's view (from the DB when the game stays unrevealed) and stored in
   `arena.round_metrics`, `arena.games.metrics` and `arena.collapse_events`.
5. **Interview.** Each agent writes "teach us your code" for 10–14-year-olds (one model call, no tools).
6. **Judges.** Maya 13 (opus), Dev 11 (sonnet), Hana 14 (opus) and Leo 10 (haiku) score every team's final code and
   explanation, and tag its ideas.
   - The four scores are understanding, respect, novelty and want-to-team-up.
   - One judge goes first, and its new tags are shown to the other three so tags converge.
   - The idea ledger (`arena.ideas`) is shared by all arenas; cohorts don't see their sibling cohorts' ideas.
   - Social score = 0.2·understanding + 0.3·respect + 0.2·novelty + 0.3·team-up, averaged over judges (0–10).
   - Judges never see fitness, and social never enters fitness.
7. **Selection and breeding** (arenas without `noEvolution`).
   - **Retirement.** A persona with ≥ 2 games is retired in three cases:
     - it was in the social bottom quartile in 2 of its last 3 games
     - its mean social is below the floor
     - it was in the fitness bottom quartile in 2 of its last 3 games, with a weak combined percentile

     At most ⌈N/3⌉ are retired per game.
   - **Breeding.** Each open slot keeps the retired persona's model. A breeder (Fern/opus, Oak/opus, Moss/sonnet) is
     drawn with probability ∝ exp(4·(score − 0.5)), where score is the mean (fitness percentile + social percentile)/2
     of its spawn. The breeder then writes a new persona prompt.

## Team sessions

```
claude -p --model <m> --tools Bash,Read,Write,Edit,Glob,Grep --permission-mode acceptEdits \
  --allowedTools "Bash(python3:*)" "Bash(python:*)" --max-turns N --max-budget-usd X \
  --output-format stream-json --verbose --no-session-persistence --system-prompt <full system prompt>
```

- **System prompt** (`toolSystem`):
  - the tools; the persona and its situation, which says fixed membership where the arena has it
  - how the workspace works, size and change measured on minified programs, and that programs run minified
  - the fair-play rules, and RULES.md (read fresh)
- **Brief** (`roundBrief`):
  - round 1 of a forked game points at `previous-games/game-0/`, and later round 1s at the previous game
  - later rounds give the scoreboard and the new log files
  - every round says whose turn it is to change
  - round-1 notices are named per arena in `settings.cohort.notices` (`NOTICES`), plus the examples notice in an
    examples treatment
- **Workspace**: `/home/user/arena-ws/<arena>/<persona>/`. It lives outside the repo, because inside a git repo Claude
  Code's system prompt would show git status. Before every round `prepareWorkspace` writes:
  - `README.md`, `RULES.md`, `interface.txt`, `config.json` (with `may_change_before_next_round`) and `notebook.md`
  - the current `clover.py`, `orchid.py`, `bee.py` (exactly what played last round), plus `history/round-N/`
  - its own logs only: `logs/round-N/{round.json, visits.jsonl, my-bee.jsonl, my-patch.jsonl}`, `memory/round-N.txt`
    (what its bee kept) and `logs/game.json`
  - `previous-games/game-K/`: its own logs from earlier games, the standings, the panel's feedback (`panel.md`), and
    either every team's final code (revealed arenas) or only the top 2 (`top2/`; cohort arenas)
  - `examples/` in an examples treatment, restored every round

  There are no tokens or game URLs in the workspace.
- **Environment**: sessions run with `{HOME, PATH, LANG}` only, so there is no `DATABASE_URL`, no dev secret and no API
  token. The full `--system-prompt` replaces Claude Code's default, which mentions the user's memory directory.
- **Limits** per session: opus 30 turns / $2.50, sonnet 30 / $1.00, haiku 25 / $0.60. Fix sessions get a third of
  the budget and at most 15 turns.
- **Fair play**: the system prompt says to use only the workspace (not even `/tmp`) and never to touch the database,
  the network, the game server, other teams' data, logins or environment variables. After every session `audit()`
  reads the transcript:
  - **Bash commands**: paths outside the workspace, `..` escapes, other teams' workspaces, `psql`/DB URLs,
    `env`/`printenv`/`/proc/self`, auth endpoints, network tools in command position, and network libraries in inline
    scripts. The working directory is tracked across calls, since Claude Code's Bash tool keeps it. The `..` check
    skips `echo`/`printf` text and the bodies of data heredocs (`cat > notes.md <<'E' … E`).
  - **Read/Glob/Grep**: their paths
  - **Write/Edit content**: DB access, outside paths, other workspaces, network libraries and environment reads

  The team's own tool-output spill directory (`~/.claude/projects/<workspace path with non-alphanumerics as "-">`) is
  allowed, and `/tmp` is only a warning. Anything else is a **violation**: the team's previous code plays the round,
  or in round 1 it sits the game out. Every finding goes to `arena.violations`. A finding later judged spurious is
  re-labelled `severity = 'false-positive'`, and the row is kept.

  To give a team its turn back, fix the detector and restart the runner before that round simulates. A disqualified
  turn leaves no `agent_turns` row, so the restarted runner plays it again. Once the round has simulated, the
  disqualification stands.

## Forks and cohort experiments (`fork.js`)

```
# a continuation of a played game under new rules (one arena, role "base")
node arena/fork.js --from gx-control --game 3 --cohorts v3-base --experiment v3 --notice v3-rules --generations 2 --seed-base 20261020
# an experiment: the whole treatment cohort gets the example files; control2 gives the noise floor
node arena/fork.js --from v3-base --game 2 --cohorts v3-treat,v3-control,v3-control2 --treat v3-treat \
  --examples arena/examples/v3 --experiment v3x --generations 3 --seed-base 20261030
```

- **What each new arena gets**:
  - its own room and the source game's personas (same prompt, model and team name)
  - each persona's notebook as it stood at the end of the source game
  - a workspace holding that game as `previous-games/game-0/`. If the source arena ended with that game, its logs,
    history and memory come straight from the source workspaces.
  - the team's final programs as starting code, plus the helper scripts it wrote (`*.py` besides its programs)
  - game config: the source game's language, types and rounds, `revealOnFinish: false`, plus `--config` overrides
- **Identical conditions**:
  - Membership is fixed (`noEvolution`).
  - Round r of game g uses the seed `(seedBase + 1009·g + 31·r) mod 2^31` in every cohort, sent with
    `POST …/rounds {seed}`.
- **Information flow**:
  - `revealOnFinish: false`, so no team can pull rivals' code through the API.
  - Between games the only channel is the top-2 teams' final code, plus the standings and the team's own panel
    feedback.
  - The judges' idea ledger excludes sibling cohorts.
  - Metrics and judging read the revealed view from the DB (`lib/dbview.js`).
- **Examples treatment** (`--treat` with `--examples DIR`): the WHOLE treatment cohort gets DIR as `examples/`.
  - Every game's round-1 brief says plainly that every team in the garden received the same example flowers and
    checkers, and names the files.
  - Controls get nothing extra.
- **Measures** in `analyze.js`, from "Cohort experiment" on:
  - paired fitness per persona against the control-vs-control2 noise floor
  - adoption of catalogue ideas (`lib/adoption.js`, per experiment: `gx` = the graph puzzle catalogue, `v3`/`v3x` =
    the example ideas plus anytime search, checkers, faces, hash keys, imitation)
  - session stats from the transcripts, and the answer-shape metagame
  - code borrowed from the top-2 demo
  - the engine-v3 per-round table (`lib/v3.js`):
    - nectar per turn, pooled precision, and the rival clover vs orchid fed rates
    - fingerprinting, stolen-face and twin orchids, and flowers seen answering one challenge two ways
    - clovers using random, time or `GAME["ms"]`, compute against budget, and Paley/Legendre markers
  - treatment − controls by round with the noise floor, then fitness spread and model gap

  Per-bee detail: `node analysis/fingerprint-bees.mjs <arena …>`.
- **After an experiment**: set `revealOnFinish` to true in its games' `config`, so they replay fully in the web UI:
  `UPDATE games SET config = jsonb_set(config, '{revealOnFinish}', 'true') WHERE id = ANY(<uuids>) AND status = 'finished'`.

Stored data from earlier phases is read, not recomputed:
- prompt-mode turns
- orchid targets from re-running pure flowers
- idea cards
- primed vs unprimed conditions

The current engine runs flowers non-purely and measures size and change on minified programs, so old metrics can't be
reproduced. `analyze.js` still reports them from `arena.round_metrics`.

## Useful queries

```sql
SELECT purpose, model, count(*), round(sum(cost_usd)::numeric, 2) FROM arena.llm_calls GROUP BY 1, 2 ORDER BY 1, 4 DESC;
SELECT g.arena_id, g.generation, g.game_url, g.metrics->'collapses' FROM arena.games g ORDER BY 1, 2;
SELECT p.name, e.fitness, e.social, e.social_parts FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = 1;
SELECT tag, description, first_arena, first_team FROM arena.ideas ORDER BY id;
SELECT persona_id, round_no, severity, left(detail, 120) FROM arena.violations ORDER BY id DESC LIMIT 20;
```

Games live in the game's own tables, so every arena game replays in the web UI at its `/room/<room>/game/<game>` URL.
