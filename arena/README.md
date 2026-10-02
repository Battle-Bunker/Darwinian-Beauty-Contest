# Arena: LLM-agent teams playing Darwinian Beauty Contest

The arena runs populations of LLM-driven teams against each other through the game's HTTP API, to study the ecosystem
the game creates. Every team is run by tool-using Claude Code sessions (`claude -p`, models opus, sonnet and haiku;
never a Fable model) in the team's private workspace. A game is continuous (RULES.md): a lobby where programs are
written for free, then one stretch of play where bees forage nonstop, every action is public at once, and teams change
their programs whenever they like, paying from change budgets that refill with game time. After each game come
metrics, interviews, the teen judges and (unless membership is fixed) selection and breeding.

[REPORT.md](REPORT.md) is the research report of the earlier, round-based arena (the `dbc` database, never modified).

## What's here

| Path | What |
|---|---|
| `run.js` | the runner: creates rooms and games, runs the lobby sessions, starts the game, runs every team's sessions while it plays, stops them when it ends; then metrics, interviews, judges, retirements and breeding |
| `analyze.js` | a Markdown report of the arena schema: spend, each game over time, teams, orchid copying, the change timeline, compute, sessions, storage, the panel, ideas, breeders, the fair-play audit, and games of different durations side by side |
| `server.sh` | (re)starts the arena's own game server on port 4000 (dbc_live, the dev-login secret, `CPU_SLOTS=3`) |
| `schema.sql` | the `arena` Postgres schema in dbc_live, applied on every run |
| `tools/` | the workspace tools copied into every workspace (Python, stdlib only): `submit.py`, `check.py`, `try.py`, `status.py`, `scaffold.py`, `stream.py`, `garden.py` (the scaffold API), and `_runner.py`, their link to the runner |
| `lib/llm.js` | `claude -p` wrapper: concurrency limiter, retries, usage-limit pause, spend guard, cost ledger (`arena.llm_calls`); sessions with live transcripts, a stop control, and estimated costs for sessions stopped mid-way |
| `lib/api.js` | HTTP client for the game API (dev login with the dev secret, Bearer tokens) |
| `lib/team.js` | each team's desk for a game (its broker, which session is running, its scaffold), one session (workspace, live fair-play gate, audit, notebook, cleanup), the lobby with fix sessions, the interview |
| `lib/broker.js` | the runner's end of the tools: request files in `<workspace>/.runner/req/`, answers in `.runner/res/` |
| `lib/scaffold.js`, `lib/scaffold_launch.py` | scaffolds: static audit, launch under limits, CPU share, restarts, logs |
| `lib/stream.js` | the live action stream: the shared public JSONL, the runner's master copy, per-team private details, headline numbers for briefs |
| `lib/workspace.js` | builds workspaces, archives finished games, the fair-play audit, finds and stops what a session left running |
| `lib/prompts.js` | system prompt, lobby and in-game briefs, interview, judge and breeder prompts |
| `lib/metrics.js` | metrics of a finished game (one streaming pass over its actions) |
| `lib/gamecontrol.js` | the game follows the arena's pause file |
| `lib/social.js`, `lib/population.js`, `lib/personas.js` | interviews → judges → idea ledger → social scores; retirement and breeders; founders, judges, breeders |
| `lib/presets.js` | game settings, lineups and session pacing for fresh arenas |
| `examples/v3/` | two example clovers and bee-side checkers (`flower(challenge)`, plain helpers): only for arenas that hand them to every team (`examples` in a preset) |
| `test-*.mjs` | checks without model calls (see "Tests") |
| `runs/` | logs, transcripts, the dev secret, the pause file (gitignored) |

## Running

Needs Postgres with the game's `dbc_live` database, `python3`, and the `claude` CLI logged in.

```
arena/server.sh                                                   # 1. the arena's game server on :4000
ARENA_BUDGET_USD=15 nohup node arena/run.js --arena cont-pilot --preset pilot >> arena/runs/cont-pilot.out 2>&1 &
node arena/analyze.js --arenas cont-pilot > arena/runs/analysis-cont-pilot.md
```

- `--arena ID` (a fresh arena from the preset named ID, or `--preset NAME`), `--arenas a:2,b:3` (several arenas in one
  process; `:n` sets the number of games), `--games N` (default: the preset's `minutesByGame` length, else 1),
  `--budget USD` (a per-arena cap).
- `server.sh` starts the server with `DEV_LOGIN_SECRET` from `arena/runs/.dev-secret` (mode 600, created if missing), so
  dev login needs the secret and an agent can't log in as another team. The runner reads it from there (or
  `ARENA_DEV_SECRET`); it never goes into a workspace or a prompt. The script stops only the server it started itself
  (its pid file), and refuses to restart while an arena game is running unless `FORCE=1` (a restart starts the bees
  afresh).
- The runner refuses the old `dbc` database: arena tables live in `dbc_live` next to the game's.

| Env | Default | |
|---|---|---|
| `ARENA_API` | `http://localhost:4000` | the game API; also the public URL agents may read |
| `ARENA_CONCURRENCY` | `8` | concurrent `claude` processes; `arena/runs/concurrency` changes it live |
| `ARENA_BUDGET_USD` | `300` | spend cap over all of `arena.llm_calls`; no new team session starts once spend + the preset's `reserveUsd` reaches it, so interviews and judges still fit |
| `ARENA_SESSION_LIMITS` | see `lib/team.js` | JSON overrides of per-model session limits (turns, USD) |
| `ARENA_WS_ROOT` | `/home/user/arena-ws` | workspaces (outside the repo: inside a git repo Claude Code would show git status) |
| `ARENA_PAUSE_FILE` | `arena/runs/PAUSED` | the pause file |
| `ARENA_DATABASE_URL` | `postgres://dbc:dbc@localhost:5432/dbc_live` | |
| `ARENA_CLAUDE_BIN` | `claude` | the CLI (tests point it at a stub) |

### Presets (`lib/presets.js`)

| preset | game | teams |
|---|---|---|
| `pilot` | int→int, games of 0.5, 1 and 2 minutes; opus calls (judges, breeders) run on sonnet | Luna (sonnet), Grace (haiku), Tess (sonnet) |
| `graphs` | int→graph[any], 2-minute games | 6 teams, opus/sonnet/haiku |
| `graphs-examples` | as `graphs`, and every team gets `examples/v3` | |

A preset sets `config` (server defaults otherwise: 2-minute games, a feeding bee sits out 10 rounds, change budgets of
one minute's worth), `minutesByGame`, `session` pacing, `limits`, `maxModel`, `reserveUsd`, `noEvolution` and `examples`.

## How a game runs

1. **Setup.** The arena's room owner creates the game with the preset's config (and this game's duration). Every active
   persona logs in and creates its team.
2. **Lobby.** One session per team, all in parallel: write (game 1) or rework (later games: the files start as the
   team's final programs of its previous game) all three programs, check and try them, and submit them with the tools.
   Writing is free. A program file the team wrote but didn't submit is submitted for it if it passes the checks; a team
   still missing a program gets up to 2 short fix sessions, and a team without all three sits the game out.
3. **Play.** The first in-game sessions start `warmupSeconds` before the owner starts the game, so teams are at their
   desks when the clock starts. Each team then has sessions back to back while there's more than `endMarginSeconds` of
   game time left, each capped at `maxMinutes` of real time. The gap between them is `gapSeconds`, doubling after each
   session that submitted nothing (up to `maxIdleGapSeconds`), since agents often just check the score and stop. Sessions of different teams run at
   the same time, within the concurrency limit. When the clock runs out, the runner stops every running session and
   whatever it started. A submission that arrives after the end is refused by the server and reported as "the game is
   over".
4. **After.** Metrics (`lib/metrics.js`, stored in `arena.games.metrics`) and the final standings; interviews ("teach us
   your code", one call each); the four teen judges score understanding, respect, novelty and want-to-team-up and tag
   ideas into the shared ledger (one judge first so tags converge); retirement and breeding as before (social score =
   0.2·understanding + 0.3·respect + 0.2·novelty + 0.3·team-up; never part of fitness).

Games are short (minutes) and an LLM session is slow by comparison, so what reacts during a game is what the team
prepared: programs that adapt by themselves, and above all its **scaffold** (below). Scripts a session starts may run in
the background while that session lasts; the runner stops everything a session started when it ends (processes carrying
the session's `ARENA_SESSION` tag or running inside the workspace), except the team's scaffold.

## Scaffolds

A scaffold is the team's own Python program running outside the engine for the rest of the game, with no LLM in the
loop: it follows the stream and submits changes by itself, within the team's change budget (the server enforces it).
A session starts it, in the lobby or during the game: `python3 tools/scaffold.py start scaffold.py` (also `restart`,
`stop`, `status`, `logs`). `lib/scaffold.js` supervises it:

- **Audit before every start and restart** (`auditScaffold`): the entry file and the workspace modules it imports (not
  `tools/`, which the runner reinstalls first), with the session audit's rules for written code (no paths outside the
  workspace, no database, no logins or credentials, no network except GETs to the game's public API on localhost, no
  writes into `stream/`, no environment) plus: nothing that escapes supervision or the audit (subprocesses, `os.system`,
  fork/exec/spawn, kill, multiprocessing, pty, ctypes, `exec`/`eval`/`compile`, dynamic imports) and no string literal
  that is a path outside the workspace. A refused scaffold doesn't start; the findings go to `arena.violations`
  (`tool = 'scaffold'`). Every start is a row in `arena.scaffolds` with the audited source.
- **Limits**: `nice 15`; RLIMIT_AS 1 GB, RLIMIT_CPU 900 s, RLIMIT_FSIZE 200 MB, 256 open files
  (`lib/scaffold_launch.py`); a CPU share of 0.15 core (`settings.scaffold.cpuShare`), enforced by pausing it
  (SIGSTOP/SIGCONT) whenever it used more over the last 2 s. Its own process group; output to
  `<workspace>/scaffold/scaffold.log` (trimmed past 2 MB).
- **Lifecycle**: it outlives sessions; a crash restarts it after 1, 2, 4, 8, 15, 30 s (re-audited); a clean exit is
  final; the end of the game (or the runner stopping) stops it. After a runner restart, scaffolds that were running are
  started again.
- **Attribution**: its environment carries a token (read by `tools/_runner.py`, never by the team's code), so its
  requests are answered between sessions too and recorded with `source = 'scaffold'` in `arena.requests`. Requests with
  neither a running session nor the token are refused.

`tools/garden.py` is its API: `follow()` / `follow_live()` (the file, or the public SSE), `actions(after)`, `last()`,
`status()` (clock, round, scores, the team's budgets with exact `available`, `perMinute` and `cap`, its versions),
`live(kind)` (the code playing now), `measure(kind, code)` (size and cost, free), `check`, `try_program`, `submit` (a
refusal for budget carries `wait_s`), `wait_for_budget(kind, cost)`, `scores()` and `game_over()` (public API).

## A team's workspace

`/home/user/arena-ws/<arena>/<persona>/`, rebuilt at the start of every session:

| path | what |
|---|---|
| `README.md`, `RULES.md`, `interface.txt`, `config.json` | the file guide, the players' rules, signatures and types, this game's settings (with the public API address) |
| `clover.py`, `orchid.py`, `bee.py` | in play, exactly the versions playing when the session started (unsubmitted edits move to `drafts/`) |
| `history/` | the team's own versions in this game (code and timeline). Other teams' changes are secret until the game ends |
| `status.txt` | what `tools/status.py` said at the start of the session |
| `notebook.md` | the persona's notes, kept across sessions and games |
| `stream/actions.jsonl` | the live public stream: a hard link to the runner's shared copy, appended about once a second |
| `stream/mine.jsonl` | its own bee's and patch's actions as the team sees them (`GET …/actions?mine=1`): with its programs' timings, versions and printouts, private during play |
| `scaffold/scaffold.log` | its scaffold's output |
| `stream/teams.json`, `stream/SCHEMA.md` | names, and the line format with how to read it |
| `tools/` | the tools (below) |
| `previous-games/game-N/` | finished games of the arena, revealed: every team's final code, standings, everyone's change timeline, the panel's feedback, the team's own history |
| `examples/` | only in arenas whose preset sets `examples` |

**Tools.** `python3 tools/status.py [--afford N]` (clock, time left, change budgets now with rate and cap and when N nodes
are affordable, scores for the whole game and the last 5 minutes, versions playing), `tools/check.py <kind> [file]`
(size, cost now, a quick runtime test), `tools/try.py <kind> [file] [challenges…]` (the game's real runner), and
`tools/submit.py <kind> [file] [--force]` (live at once; a quick runtime test first: flowers on a few challenges, a bee
foraging the team's own flowers, or its flower files when none are submitted yet). They write a request file into
`.runner/req/`; the runner's broker does the call with the team's token and writes the answer back. No credential ever
enters the workspace or a prompt. Scripts use the same channel: `from _runner import call; call("submit", kind=…, code=…)`.
`tools/stream.py` reads the stream (`summary`, `tail`, `answers`, `sql` over a local SQLite copy in `cache/`; as a
library, `Stream().actions(since_ms=…)`, `.follow()`, `.mine()`).

**The stream.** One shared copy per game (`<WS_ROOT>/<arena>/.shared/g<N>/actions.jsonl`, exactly what the public
`GET …/actions` returns) is hard-linked into every workspace, so it costs one file however many teams play. The runner
also keeps a private master copy (`.runner/g<N>/`); if a team damages the shared file through its link, it is rewritten
in place from the master (and writing to `stream/` is a fair-play violation). Agents may also read the game's public API
directly (no login): `GET <api>/rooms/<room>/games/<game>/events?after=<seq>` (SSE), `…/actions?after=<seq>&limit=…`,
`…/scores` (clock, round, scores and ledgers; cheap to poll).
Briefs carry only headline numbers (time, fitness and rank, a few counts, budgets), never actions.

## Sessions

```
claude -p --model <m> --tools Bash,Read,Write,Edit,Glob,Grep --permission-mode acceptEdits \
  --allowedTools "Bash(python3:*)" "Bash(python:*)" --max-turns N --max-budget-usd X \
  --output-format stream-json --verbose --no-session-persistence --system-prompt <full system prompt>
```

- **System prompt** (`toolSystem`): the tools, the persona and its situation, how the workspace and the tools work, why
  scripts matter in short games, the fair-play rules, RULES.md in full, and this game's settings (budgets per minute and
  caps).
- **Briefs**: the lobby brief (write or rework, free, submit all three; the game won't wait), the in-game brief (time,
  fitness and rank, a few counts, budgets now, drafts, scripts it might start), the lobby fix brief.
- **Environment**: `{HOME, PATH, LANG, ARENA_SESSION}` only: no database URL, no secret, no token.
- **Limits**: per model (opus 30 turns / $2.50, sonnet 30 / $1.00, haiku 25 / $0.60; presets override), a wall-clock
  cap, and the end of the game. A session the runner stops is recorded with a cost estimated from its transcript's token
  usage (`cost_estimated`, `llm_calls.estimated`).

## Fair play

The system prompt says: only the workspace (not even `/tmp`); nothing written to `stream/`; no database; no network
except reading (GET) the game's public API on localhost; no logins, credentials or other teams' data; no environment
variables. The audit (`audit()` in `lib/workspace.js`) reads the session's stream-json transcript:

- **Live, before every request** a tool makes: a violation so far refuses the request and stops the session at once,
  so nothing submitted after a violation ever reaches the game.
- **After the session**, in full: findings go to `arena.violations` (with the session). A violation in the lobby costs
  the team its sessions in that game; during play it costs the team its next session.

It checks Bash commands (paths outside the workspace, `..` escapes, other workspaces, database and environment access,
auth endpoints, network use: URLs other than the public API on localhost, write methods, credentials, raw sockets;
writes into `stream/`), Read/Glob/Grep paths, and written code. The session's own tool-output spill directory and its
background-task output directory are allowed; `/tmp` is a warning. Every submission is also recorded in
`arena.requests` (the code, the result, the version, the cost, the game time).

## Pause, resume, restart

**Automatic pause on usage limits.** Any `claude -p` failure whose text matches a usage or session limit writes
`arena/runs/PAUSED` (time, then the raw error) and logs `[arena] PAUSED: … Resume: rm arena/runs/PAUSED`. While the file
exists no new model call starts, and the runner **pauses its running game** through the owner API (the clock and the
change budgets stand still); it resumes the game once the file is gone (only a game it paused itself). A lobby call that
came back limit-held is re-issued unchanged on resume; an in-game session isn't (the moment has passed): the team gets a
fresh session with a fresh brief. Calls already in flight finish normally. Low disk (under 4 GB free on the workspace
disk) pauses the same way.

| to | do |
|---|---|
| pause by hand | `echo manual > arena/runs/PAUSED` |
| resume | `rm arena/runs/PAUSED` (the runner never resumes on a timer) |
| stop | `kill <runner pid>`: it pauses its running game, stops its sessions and what they started, and exits |
| restart | the same command again; finished stages are skipped (`created → lobby-done → playing → played → interviewed → judged → done`), a game the runner paused on exit is resumed, and its teams get fresh sessions |

## Metrics (`lib/metrics.js`, `analyze.js`)

From the game's own tables once it is over (every team's versions are visible then), in windows of game time (about
eight per game, at least 10 s):

- actions, rounds, feeds, **precision** (nectar per feed) and **nectar per bee-round** (a bee gets one turn per round
  unless it is feeding)
- **rival clover vs rival orchid fed rates** (share of visits to other teams' flowers that ended in a feed) and the gap
- **fingerprinting**: share of a bee's pre-feed asks that repeat a challenge it asked before; distinct challenges per bee
- **stolen-face / twin** orchid answers (equal to an earlier answer of a rival clover / of its own clover to the same
  challenge)
- **copy latency**: for each answer (c, r) a clover gave, the time until a rival orchid first answered r to c (only if it
  hadn't before), and how many of those came from an orchid version that went live after the clover's answer appeared.
  Only those are copies: other matches are convergence (an orchid running the same rule as a rival clover, e.g. a twin
  of its own clover when two teams chose the same rule) or coincidence in a small answer space
- fitness per window and cumulative; per team: bee precision, fed rates, repeat share, feeds received
- the **change timeline** (every version: game time, size, node edits, cost, the session that submitted it), **flower
  compute against budget** (mean, p90, max, timeouts; bees' compute isn't recorded by the server), sessions (start
  and end in game time, how they ended, cost, requests, submissions), and **storage** (the game's actions in the
  database, the shared stream file, the arena's workspaces with hard links counted once, free disk)

`analyze.js` also lists games by duration side by side. `--recompute` recomputes stored metrics.

## Tests

No model calls (a stub `claude`), no game server:

```
node arena/test-brief.mjs      # system prompt, lobby/in-game/fix briefs, interview and judge prompts
node arena/test-submit.mjs     # the tools through the broker (fake API); a stub session that submits, leaves a process
                               # running and gets it stopped; the live fair-play gate; a session stopped by the game's end
node arena/test-workspace.mjs  # workspace files, the shared stream (hard links, growth, repair), mine.jsonl, tools/stream.py,
                               # the audit (public API reads allowed; logins, writes, other hosts, stream writes not)
node arena/test-metrics.mjs    # metrics on a hand-made stream: windows, precision, fed rates, repeats, copy latency, compute
node arena/test-pause.mjs      # usage-limit detection, pause and resume, in-game sessions on a limit, the game's pause sync
node arena/test-scaffold.mjs   # a stub scaffold: starts, outlives its session, submits by itself, is refused over budget,
                               # restarts after a crash, forbidden scaffolds fail the audit, CPU share, stopped at game end
```

They need the `dbc_live` database (the arena schema, a throwaway arena row, ledger rows they delete).

## Useful queries

```sql
SELECT purpose, model, count(*), round(sum(cost_usd)::numeric, 2) FROM arena.llm_calls GROUP BY 1, 2 ORDER BY 1, 4 DESC;
SELECT p.name, s.no, s.phase, s.clock_start, s.clock_end, s.ended_by, s.cost_usd FROM arena.sessions s JOIN arena.personas p ON p.id = s.persona_id ORDER BY s.id DESC LIMIT 20;
SELECT persona_id, op, kind, ok, refused, version, cost, clock_ms FROM arena.requests WHERE op = 'submit' ORDER BY id DESC LIMIT 20;
SELECT persona_id, session_id, severity, left(detail, 120) FROM arena.violations ORDER BY id DESC LIMIT 20;
SELECT tag, description, first_arena, first_team FROM arena.ideas ORDER BY id;
```

Every arena game replays in the web UI at its `/room/<room>/game/<game>` URL on the arena's server.
