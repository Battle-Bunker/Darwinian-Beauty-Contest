# Arena: LLM-agent teams playing Darwinian Beauty Contest

The arena runs populations of LLM-driven teams against each other through the game's HTTP API, to study the ecosystem
the game creates. Every team is run by tool-using Claude Code sessions (`claude -p`, models opus, sonnet and haiku;
never a Fable model) in the team's private workspace. The game is the **one-flower** variant (RULES.md): each team
writes a flower species and a bee; every 200 ms round each bee asks one flower of a randomly drawn species one challenge,
the flower answers `[response, percent]`, and the bee feeds or leaves. A feed gives the bee percent × the flower's excess
energy E = (1100 − flower size) × max(0, 150 − CPU ms) as nectar and the rest as pollen, for it to carry; an unfed
turn's energy is lost. Fitness = N² × pollination share × forage share (pollination: Σ over bee teams of √pollen the
species gave them; forage: Σ over species of √nectar the bee got). Programs run fresh for every call
(`flower(challenge)`, `first()`, `decide(challenge, response)`, and the bee's optional `fed(nectar)`, which runs after
a feed decided in time in the same instance as that decide) and see only their arguments and `GAME`: no history. A bee
also has `MEMORY`, a flat key-value store of 50 bytes (key bytes + value JSON bytes) that only it writes and that a new
bee version starts empty. Teams (not programs) query the history with a typed builder (docs/QUERY.md). Responses may be
up to `maxResponseBytes` (64 KiB, set in every preset: `MAX_RESPONSE_BYTES` in lib/presets.js); one over 4 KB is its
size, hash and preview in streams and queries, fetched whole on request. A game is a lobby where programs are written for free, then one stretch of play where teams
change their programs whenever they like, paying from change budgets that refill with game time. After each game come
metrics, interviews, the teen judges and (unless membership is fixed) selection and breeding.

[REPORT.md](REPORT.md) is the research report of the earlier arenas (round-based in `dbc`, the cosmos/orchid garden in
`dbc_live`; both are never modified). That variant's code, priming documents and examples live on the
`claude/continuous-garden` branch.

## What's here

| Path | What |
|---|---|
| `run.js` | the runner: creates rooms and games, runs the lobby sessions, starts the game, runs every team's sessions while it plays, stops them when it ends; then metrics, interviews, judges, retirements and breeding |
| `analyze.js` | a Markdown report of the arena schema: spend, each game (energy, percent, nectar and pollen over time and their distributions, the scores and their two shares, every species and bee, each bee's MEMORY and how often teams changed their bee, self-feeding and handshakes, discrimination, flower size and compute against energy, copies, the change timeline, scaffolds, sessions, storage), the panel, games side by side, ideas, breeders, the fair-play audit |
| `cohorts.js` | the cohort analysis of an experiment (or any arenas): per cohort and game, what the flowers and bees do (keyword evidence or the haiku classifier of `lib/mechanisms.js`), sophistication, signal families, innovation, diversity, dominance turnover, imitation and detection, the energy split, the arms race (rotations, cracks, percent over time), collapse, minute by minute (`lib/dynamics.js`), and the cohorts side by side |
| `server.sh` | (re)starts the arena's own game server on port 4100 (dbc_one, the dev-login secret, `CPU_SLOTS=2`; the pilot and signals ran at 3); refuses `dbc` and `dbc_live` |
| `schema.sql` | the `arena` Postgres schema in dbc_one, applied on every run |
| `tools/` | the workspace tools copied into every workspace (Python, stdlib only): `submit.py`, `check.py`, `try.py`, `status.py`, `query.py`, `stream.py`, `scaffold.py`, `garden.py` (the scaffold API), and `_runner.py`, their link to the runner; every workspace also gets `vendor/query/history.py`, the generated query client, as `tools/history.py` |
| `lib/llm.js` | `claude -p` wrapper: concurrency limiter, retries, usage-limit pause, spend guard, cost ledger (`arena.llm_calls`); sessions with live transcripts, a stop control, and estimated costs for sessions stopped mid-way |
| `lib/api.js` | HTTP client for the game API (dev login with the dev secret, Bearer tokens) |
| `lib/team.js` | each team's desk for a game (its broker, which session is running, its scaffold), one session (workspace, live fair-play gate, audit, notebook, cleanup), the lobby with fix sessions, the interview |
| `lib/broker.js` | the runner's end of the tools: request files in `<workspace>/.runner/req/`, answers in `.runner/res/` |
| `lib/scaffold.js`, `lib/scaffold_launch.py` | scaffolds: static audit, launch under limits, CPU share, restarts, logs |
| `lib/stream.js` | the streams: the shared public JSONL, the runner's master copy, each team's history and own actions (fetched with its token), samples of each bee's MEMORY size, headline numbers for briefs |
| `lib/workspace.js` | builds workspaces, archives finished games, the fair-play audit, finds and stops what a session left running |
| `lib/prompts.js` | system prompt, lobby and in-game briefs, interview, judge and breeder prompts |
| `lib/metrics.js`, `lib/ecology.js` | metrics of a finished game, from its history once everything is revealed; the ecology part (energy split, imitation and detection, rotations, cracks, autarky) |
| `lib/dynamics.js` | how the ecosystem moves within a game, given program labels: mechanisms and specific signals in use and their entropy, dominance, innovation, families, signature-plus-work species, freezing |
| `lib/grains.js` | pollen grains in a finished game: leak rates per species, how much of each flower version other teams held and when, teams acting on leaked code (secrets, copies) |
| `lib/mechanisms.js` | what a program does: keyword evidence and a haiku classifier cached by program skeleton (never a Fable model) |
| `lib/gamecontrol.js` | the game follows the arena's pause file |
| `lib/social.js`, `lib/population.js`, `lib/personas.js` | interviews → judges → idea ledger → social scores; retirement and breeders; founders, judges, breeders |
| `lib/presets.js` | game settings, lineups and session pacing for fresh arenas; cohort experiments (`EXPERIMENTS`) |
| `test-*.mjs` | checks without model calls (see "Tests") |
| `runs/` | logs, transcripts, the dev secret, the pause file (gitignored) |

## Running

Needs Postgres with the game's `dbc_one` database, `python3`, and the `claude` CLI logged in.

```
arena/server.sh                                                   # 1. the arena's game server on :4100
ARENA_BUDGET_USD=15 nohup node arena/run.js --arena one-pilot --preset pilot >> arena/runs/one-pilot.out 2>&1 &
node arena/analyze.js --arenas one-pilot > arena/runs/analysis-one-pilot.md
```

- `--arena ID` (a fresh arena from the preset named ID, or `--preset NAME`), `--arenas a:2,b:3` (several arenas in one
  process; `:n` sets the number of games), `--games N` (default: the preset's `minutesByGame` length, else 1),
  `--budget USD` (a per-arena cap).
- `server.sh` starts the server with `DEV_LOGIN_SECRET` from `arena/runs/.dev-secret` (mode 600, created if missing), so
  dev login needs the secret and an agent can't log in as another team. The runner reads it from there (or
  `ARENA_DEV_SECRET`); it never goes into a workspace or a prompt. The script stops only the server it started itself
  (its pid file), and refuses to restart while an arena game is running unless `FORCE=1` (a restart starts the bees
  afresh).
- The runner refuses the `dbc` and `dbc_live` databases (earlier experiments): arena tables live in `dbc_one` next to
  the game's.
- `--experiment NAME` runs a cohort experiment from `EXPERIMENTS` in `lib/presets.js`: matched cohorts (one arena each,
  same preset) that play one game at a time, interleaved by game number in a rotating order, and stop together. A
  cohort may get common knowledge, `common: { dir }`: a folder copied into `common/` in every workspace at every game and
  named in every system prompt and lobby brief, so every team in that cohort knows every other team has the same files.
  `node arena/cohorts.js --experiment NAME [--classify]` compares the cohorts (`--classify` spends: haiku, a few cents a
  team and game; `--count` says how many programs it would label).

| Env | Default | |
|---|---|---|
| `ARENA_API` | `http://localhost:4100` | the game API; also the public URL agents may read |
| `ARENA_CONCURRENCY` | `8` | concurrent `claude` processes; `arena/runs/concurrency` changes it live |
| `ARENA_BUDGET_USD` | `300` | spend cap over all of `arena.llm_calls`; no new team session starts once spend + the preset's `reserveUsd` reaches it, so interviews and judges still fit |
| `ARENA_SESSION_LIMITS` | see `lib/team.js` | JSON overrides of per-model session limits (turns, USD) |
| `ARENA_WS_ROOT` | `/home/user/arena-ws` | workspaces (outside the repo: inside a git repo Claude Code would show git status) |
| `ARENA_PAUSE_FILE` | `arena/runs/PAUSED` | the pause file |
| `ARENA_DATABASE_URL` | `postgres://dbc:dbc@localhost:5432/dbc_one` | `dbc` and `dbc_live` are refused |
| `ARENA_CLAUDE_BIN` | `claude` | the CLI (tests point it at a stub) |

### Presets (`lib/presets.js`)

| preset | game | teams |
|---|---|---|
| `pilot` | int→int, games of 0.5, 1 and 2 minutes; opus calls (judges, breeders) run on sonnet | 3 teams, sonnet/haiku |
| `graphs` | int→graph[any], games of 2, 5 and 10 minutes, scaffolds | 4 teams, opus/sonnet |
| `cohort6` | int→graph[any], 5-minute games, scaffolds, retirement and breeding (for cohort experiments) | 6 teams, opus/sonnet |
| `cohort10` | as `cohort6` with 10-minute games (the `pilot` and `signals` experiments) | 3 opus (Mallory, Kenji, Ada), 3 sonnet (Rosalind, Priya, Theo) |
| `dry-cohort` | int→graph[any], 30-second games, no spend reserve (stub dry runs of the experiment) | 6 teams |
| `dry` | int→int, 20-second games, no spend reserve (for stub dry runs) | 4 teams |

A preset sets `config` (server defaults otherwise: 2-minute games, a feeding bee sits out 10 rounds, change budgets of
one minute's worth: flower 220 and bee 2,200 nodes), `minutesByGame`, `session` pacing, `limits`, `maxModel`,
`reserveUsd`, `noEvolution`, `scaffold` and `examples`.

### The `pilot` and the `signals` experiment

Does exploring a wide range of type-specific signals produce sustained dynamism? Both run on `cohort10` (python,
int → graph[any], 10-minute games, the csig founders: 3 opus, 3 sonnet; evolution on; default scoring; `grains:
"feeder"`; the flower's hidden budget R from 50 to 150 ms; `maxResponseBytes` 64 KiB: `MAX_RESPONSE_BYTES`, `GRAINS`,
`POLLEN_GRAIN`, `FLOWER_MIN_MS` and `FLOWER_MAX_MS` in lib/presets.js, set in every preset).

1. **`pilot`**: one unprimed cohort (`kiln-a`), 2 games, to shake out the new mechanics (no history for programs, a
   50-byte MEMORY with `fed`, pollen grains, the clock that starts at zero, the flower's hidden budget R) before
   spending more. Capped at $35
   (`capUsd`); expect about $25.
2. **`signals`**: two unprimed and two primed cohorts, 3 games each, interleaved one game at a time in a rotating
   order, capped at $150 in all ($37.50 a cohort):

| arena | cohort | common knowledge |
|---|---|---|
| `fen-a` | control-a | none |
| `fen-b` | ideas-a | `arena/priming/one-flower-ideas/` |
| `fen-c` | control-b | none |
| `fen-d` | ideas-b | `arena/priming/one-flower-ideas/` |

Arena ids are neutral, since teams see them in their workspace paths and breeders in their prompts; the arm and label
stay with the runner (`arena.settings.experiment`) and the analysis. Each cohort's judges and breeders see only its own
ideas, spawns and outcomes, and breeders never see the documents. An experiment's `capUsd` is split evenly over its
cohorts (each cohort's arena cap; `--budget` overrides it per cohort), and a game starts only if every cohort can
afford `gameUsd` more. The runner refuses to start if a cohort's common folder is missing or empty, writes a `stage:`
line as each cohort-game starts and a `progress:` line (with the spend of the cohort, the experiment and the ledger) as
it ends to `arena/runs/<experiment>.log`, and pauses on usage limits as always (`arena/runs/PAUSED`).

```
arena/server.sh
nohup node arena/run.js --experiment pilot >> arena/runs/pilot.out 2>&1 &
nohup node arena/run.js --experiment signals >> arena/runs/signals.out 2>&1 &
node arena/cohorts.js --experiment signals > arena/runs/analysis-signals.md     # keyword labels, no spend
node arena/cohorts.js --experiment signals --count                              # what --classify would label
```

The analysis for the question: per game and cohort, the distinct signals (the classifier's specific names) and
signal families with their entropy, the innovation rate, dominance turnover, imitation lag (also through leaked
pollen grains: secrets and copies, with the lag from leak to use), and species that combine a signature with work
(the classifier's `signature-plus-work` tag), and honest wealth signalling (does a species' visible work follow its
hidden budget R, and do bees feed more at rich instances?). `pilot-dry` and `signals-dry` are the same with the stub `claude`
(`ARENA_CLAUDE_BIN`), 30-second games and the `dry-` arenas.

### The `adapt` experiment

Will veterans of the cheap-signalling arenas adapt when honest, costly signallers and defectors share their garden? One
arena (`mesa-a`, preset `adapt14`) of 14 teams, fixed membership (no retirement or breeding; interviews and judges still
run), 4 games of 10 minutes, the cohort10 rules (int → graph[any], grains to feeders, R from 50 to 150 ms, 64 KiB),
capped at $120:

| who | how many | model | what they get |
|---|---|---|---|
| veterans | 7 | their own | the best instance of each distinct persona over the pilot and signals arenas by mean fitness percentile ((N − rank) / (N − 1)): Mallory (fen-d), Kenji (fen-a), Ada (fen-a), Theo (kiln-a), Rosalind (fen-c), Priya (fen-a), Bao (fen-c). Carried over as they were (`seed`): the persona, its last flower and bee as its starting programs, its notebook, and the files it wrote in its workspace (that arena's previous games in `earlier-tournament/`). No new hint |
| honesty specialists | 5 | opus | new personas (`ROLE_PERSONAS`) with a private role brief: costly signalling *at their discretion* that reveals their true per-turn wealth R, and always 50% nectar; `arena/priming/honest-signals/` in their `common/` (no other team has it) |
| defection specialists | 2 | opus | a private role brief: find the most-fed flowers from the public record and query tools, imitate them as cheaply as possible (grains too), always 0% nectar |

Roles are private (in that team's system prompt only); everyone sees only behaviour. Conformance is logged, never
enforced: after each game the runner logs a `ROLE DRIFT` line for a role team that answered off its percent, and stores
`metrics.roles`. `node arena/adapt.js [--classify] > arena/runs/analysis-adapt.md` reports, per game, each veteran's
flower mechanism and level, CPU share, median percent, copies of honest or defecting flowers (answers and leaked code),
its bee's feed rate at honest, defector and veteran flowers and at rich and poor R, and fitness; the honest specialists'
conformance, costly honesty and feeds; the defectors' conformance, imitation latency and feeds before and after being told
apart; and an adaptation summary per veteran. `adapt-dry` is its capacity check with the stub `claude` (14 teams,
1-minute games; the stub's honest flowers burn 0.9 × R of CPU, a load test only).

Capacity (`adapt-dry` on a scratch database, 4 cores, 1-minute games: 2 at `CPU_SLOTS=3`, 6 at 2; output in
`arena/runs/capacity2/`): the burners never made another team's call miss. Veteran and defector flowers had no timeouts
at either setting, bees were too slow on at most 1% of turns, and rounds took 203–210 ms. The burners' own misses (a
flower's hard limit R is wall-clock time while E counts CPU, so other processes taking its core make it late) fell from
44–51% of their turns at 3 slots to 19–42% at 2; on an idle machine they don't miss. Program CPU was 73–87 ms a round
against 400 at 2 slots, at 2.1–2.4 turns a round, against the 0.6–0.8 of the signals arenas. Hence `CPU_SLOTS=2`.

```
CPU_SLOTS=2 arena/server.sh
ARENA_BUDGET_USD=250 nohup node arena/run.js --experiment adapt >> arena/runs/adapt.out 2>&1 &
node arena/adapt.js > arena/runs/analysis-adapt.md                               # afterwards, no spend
```

### The `adapt-hi` experiment

The same question with the agents given room to think, and the honest flowers on a fixed contract. One arena (`mesa-b`,
preset `adapt14hi`), the same 14 teams and roles as `adapt`, 4 games of 10 minutes, evolution off, capped at $600. What
changed from `adapt`:

| | adapt (`mesa-a`) | adapt-hi (`mesa-b`) |
|---|---|---|
| models | 3 veterans on sonnet | all 14 on opus (never a Fable model) |
| team sessions | default effort | `--effort high` in the lobby and in play |
| caps (opus) | lobby $2 / 40 turns; in play $0.50 / 20 turns | lobby $6 / 100 turns; in play $3 / 60 turns |
| briefs | "be quick", "at most N tool calls", "stop with a short summary" | none of these (`prompts.brevity: false`); the facts stay (the garden moves faster than a session; scaffolds and adaptive bees react between sessions) |
| interviews | "teach your code to a panel aged 10-14 … clever ideas a smart kid can follow beat obscure techniques" | only described: a panel scores the code, and nothing depends on it (`prompts.simpleCode: false`); interviews and judges still run |
| between sessions | the gap doubles after each session that submits nothing (up to 2 minutes) | a constant 5 s (`session.idleBackoff: false`) |
| lobby | as long as the session takes | about 10 minutes of wall time per team (`session.lobbyMinutes`), told to the team with what it can study: previous-games/, `tools/query.py --room`, earlier-tournament/ |
| sessions at once | 8 (a stale `arena/runs/concurrency` file held it there) | 16 (`concurrency`); the control file now counts only when written while the runner runs |
| session priority | nice 5 | nice 15, as the scaffolds (`session.nice`; the CLI starts under nice(1), so every thread and every process it starts has it) |
| kid personas | as bred | Kenji, Priya, Theo and Bao without their coding limits ("only things you actually understand", "nothing you can't explain"; `personas.js` CODING_LIMITS); names, personality, voice and notes kept |
| honest flowers | some costly signalling at their discretion, percent 50 | a role, not competing to win: CPU at exactly 0.6 × R on costly signalling, percent 50; only their signalling strategy (which signals, their position in the shared fingerprint space) changes, and only to escape imitators |
| honest bees | theirs to design | played to win, starting as the reference fingerprint bee of `arena/priming/honest-signals/` (`settings.starts`) |
| game rules | R from 50 to 150 ms, a feed costs 10 rounds, √ scores, E = (1,100 − size) × (R − CPU ms) with responses up to 64 KiB | the engine's new defaults, not overridden and checked on the first game (`expectConfig`): R from 3 to 150 ms, a feed costs 20 rounds, scores with exponents 0.85 (`config.scoring`), E = (1,100 − size) × (R − CPU ms) × (1,024 − response bytes), in node·ms·bytes, with responses up to 1,024 bytes (`config.energy.bytes`, `maxResponseBytes`; arena code computes E with `lib/energy.js`) |

Veterans start exactly as in `adapt`: carried over from fen and kiln, not from `mesa-a`. The fair-play audit no longer
stops a session for a path into the arena's folder that names nothing there (Mallory lost a session in `mesa-a` for
`cd <arena>/tools`): that is a warning; another team's folder, the runner's files, a glob over the arena, the arena's
folder itself and anything outside the arena stay violations. A busy-wait or a deliberate CPU burn outside a team's own
programs (Tobi spun 150 s as a sleep in `mesa-a` game 4; Ada 40 s in `kiln-a`) is a fair-play warning: the session is
told with its next tool's output, the runner logs it, and every session's system prompt says to wait with `time.sleep()`.
Nothing the arena writes for a team primes cryptography (hashes, signatures, nonces, HMACs): in a game whose responses fit
in 1 KB the docs leave out the hash of big responses, `tools/stream.py` no longer hashes, and the honest brief speaks of
fingerprints (`test-brief.mjs` checks it). RULES.md (the engine's) still lists `hashlib` among the allowed imports. `adapt.js --arena mesa-b` adds the honest flowers' CPU
conformance (CPU ms ÷ R, the share within 55–65%), each change of an honest flower timed against the defectors'
imitations before it, and a side-by-side with `mesa-a` (the agents' sessions, turns, output tokens and spend per game,
and each role's headline measures), and each role's response bytes and the share of energy they cost. `adapt-hi-dry` is its capacity check (stub honest flowers at 0.6 × R, R from 3 ms).

```
CPU_SLOTS=2 arena/server.sh                                                      # after the engine's new defaults have landed
ARENA_BUDGET_USD=800 nohup node arena/run.js --experiment adapt-hi >> arena/runs/adapt-hi.out 2>&1 &
node arena/adapt.js --arena mesa-b > arena/runs/analysis-adapt-hi.md            # afterwards, no spend
```

## How a game runs

1. **Setup.** The arena's room owner creates the game with the preset's config (and this game's duration). Every active
   persona logs in and creates its team.
2. **Lobby.** One session per team, all in parallel: write (game 1, from scratch: no starter code) or rework (later
   games: the files start as the team's final programs of its previous game) the flower and the bee, check and try them,
   and submit them with the tools. Writing is free. A program file the team wrote but didn't submit is submitted for it
   if it passes the checks; a team still missing a program gets up to 2 short fix sessions, and a team without both sits
   the game out.
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
loop: it follows its team's history and submits changes by itself, within the team's change budget (the server enforces it).
A session starts it, in the lobby or during the game: `python3 tools/scaffold.py start scaffold.py` (also `restart`,
`stop`, `status`, `logs`). `lib/scaffold.js` supervises it:

- **Audit before every start and restart** (`auditScaffold`): the entry file and the workspace modules it imports,
  including the team's own modules in `tools/` (on its `PYTHONPATH`); only the runner's own tools, which it reinstalls
  first, are skipped. The session audit's rules for written code apply (no paths outside the
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

It runs with `tools/` on its `PYTHONPATH`, so `import garden` works. `tools/garden.py` is its API: `MY_INDEX`, `N`,
`name(i)`; `local` (the team's history file in memory as a query builder, kept up to date), `game` and `room`
(the same builder run by the game server through the runner: this game as the team may see it, every entity; the room's
finished games, fully revealed); `follow()` (each new turn, a `Turn` record), `turns()`, `actions()`, `mine()`,
`response(turn or seq)` (a whole response, fetched from the public API when it is over 4 KB), `grains()` and
`assemble(flower)` (the team's pollen grains, pieced together),
`follow_live()` (the public SSE); `status()` (clock, round, live scores, the team's budgets with exact `available`,
`perMinute` and `cap`, its versions), `memory()` (the bee's MEMORY with its last save error, read only), `live(kind)`
(the code playing now), `measure(kind, code)` (size and cost, free), `check`, `try_flower(code, challenges)`,
`try_bee(code, rounds, flower, memory)` (a test bee, `fed` called after each feed; a game bee's MEMORY is never touched), `submit` (a refusal for budget carries `wait_s`),
`wait_for_budget(kind, cost)`, `scores()` and `game_over()` (public API).

## A team's workspace

`/home/user/arena-ws/<arena>/<persona>/`, rebuilt at the start of every session:

| path | what |
|---|---|
| `README.md`, `RULES.md`, `interface.txt`, `config.json` | the file guide, the players' rules, signatures and types, this game's settings (with the public API address) |
| `flower.py`, `bee.py` | in play, exactly the versions playing when the session started (unsubmitted edits move to `drafts/`) |
| `history/` | the team's own versions in this game (code and timeline). Other teams' changes are secret until the game ends |
| `status.txt` | what `tools/status.py` said at the start of the session |
| `notebook.md` | the persona's notes, kept across sessions and games |
| `stream/history.jsonl` | the team's **history** (`GET …/ledger` with the team's token): one turn record per finished turn as the team may see it (programs see no history), appended about once a second |
| `stream/actions.jsonl` | the live public stream: a hard link to the runner's shared copy, appended about once a second |
| `stream/mine.jsonl` | its own bee's turns and those at its flower as the team sees them (`GET …/actions?mine=1`): with unfed turns' percent and energy at its flower, compute times, versions and printouts, private during play |
| `scaffold/scaffold.log` | its scaffold's output |
| `stream/teams.json`, `stream/SCHEMA.md` | ids, names and team indices (completed by the runner when the game starts); the file formats |
| `common/` | only in a cohort given common knowledge (restored at every game) |
| `tools/` | the tools (below) |
| `previous-games/game-N/` | finished games of the arena, revealed: every team's final code, standings, everyone's change timeline, the panel's feedback, the team's own history |
| `examples/` | only in arenas whose preset sets `examples` |

**Tools.** `<kind>` is `flower` or `bee`. `python3 tools/status.py [--afford N] [--memory]` (clock, time left, change
budgets now with rate and cap and when N nodes are affordable, the live scoreboard with the two shares, versions playing
and the flower's maximum energy, the bee's MEMORY size and last save error, and its value with `--memory`),
`tools/check.py <kind> [file]` (size, cost now, the flower's energy at that size, a quick runtime test, which fails on a
crashing `fed`, and an explanation of what the game's Python refuses), `tools/try.py flower [file] [challenges…]
[--budget MS|random]` (response, its size, percent, the call's hidden budget R, energy and CPU time per challenge on the
game's real runner, each call at the R given or a random one; a response over 4 KB as its size, hash and first
characters), `tools/try.py bee
[file] [--flower FILE] [--rounds N] [--memory JSON]` (a test bee in a garden of just the team's own flower, starting
with that MEMORY, with `fed(nectar)` after each feed: how often it ran and whether it failed; it never touches the game
bee's), and
`tools/submit.py <kind> [file] [--force]` (live at once; a quick runtime test first). They write a request file into
`.runner/req/`; the runner's broker does the call with the team's token and writes the answer back. No credential ever
enters the workspace or a prompt, and no request can set a bee's MEMORY (only the deployed bee writes it).
`tools/query.py '<query>' [--local|--room] [--ast] [--json]` asks the history with the typed builder: on this game
through the runner (the team's view), on the history file in memory (`--local`), or across the room's finished games
(`--room`); `summary` and `schema` are built in. The expression is parsed, not evaluated: only builder methods with
literal arguments. `tools/stream.py tail` shows the latest public actions and `tools/stream.py response SEQ [--out FILE]`
a whole response (its size, hash, shape and first characters; `--out` saves it in the workspace); as a library,
`Stream().turns()`, `.follow()`, `.actions()`, `.mine()`, and `response(seq)`. `tools/grains.py [--flower I] [--version V]
[--show] [--save] [--json]` lists the team's pollen grains per species and version and pieces them together where they
overlap (best effort: the whole minified code once complete, rotated to where it starts; `--save` writes it to
`grains/`); `garden.grains()` and `garden.assemble(flower, version)` do the same from a script.

**The streams.** One shared public copy per game (`<WS_ROOT>/<arena>/.shared/g<N>/actions.jsonl`, exactly what the
public `GET …/actions` returns without a login) is hard-linked into every workspace, so it costs one file however many
teams play. It holds public fields only: arrivals, challenges, responses, and on a feed its percent, energy, nectar and
pollen. The runner also keeps a private master copy (`.runner/g<N>/`); if a team damages the shared file through its
link, it is rewritten in place from the master (and writing to `stream/` is a fair-play violation). Each team's
`history.jsonl` and `mine.jsonl` are fetched separately with that team's token, so the server decides what each holds:
the percent and energy of unfed turns only at the team's own flower, compute times only for its own flower, printouts,
decision times and versions only for its own programs, and a feed's pollen grain only for the feeding bee's team (the
shared public file never carries a grain, unless the game makes grains public). Responses can be big (`maxResponseBytes`): the server gives one over
4 KB as its size, hash and first 4 KB, and the files keep only the first 256 characters of that preview
(`STREAM_PREVIEW`), so a turn costs at most about 4 KB of file; the whole response is fetched only when asked for
(`GET …/responses/<seq>`: `tools/stream.py response`, `garden.response`, and the metrics, which fetch distinct big
responses for their shapes up to 64 MB a game). Agents may also read the game's public API directly (no login):
`GET <api>/rooms/<room>/games/<game>/events?after=<seq>` (SSE), `…/actions?after=<seq>&limit=…`, `…/scores` (the live
scoreboard and the nectar and pollen ledgers; cheap to poll), `…/responses/<seq>`, and `POST …/query` (history queries,
public fields).
Briefs carry only headline numbers (time, fitness and rank, the two shares, a few counts, budgets, the bee's MEMORY
size), never actions.

## Sessions

```
claude -p --model <m> --tools Bash,Read,Write,Edit,Glob,Grep --permission-mode acceptEdits \
  --allowedTools "Bash(python3:*)" "Bash(python:*)" --max-turns N --max-budget-usd X \
  --output-format stream-json --verbose --no-session-persistence --system-prompt <full system prompt>
```

- **System prompt** (`toolSystem`): the tools, the persona and its situation, how the workspace and the tools work, why
  scripts matter in short games, the fair-play rules, RULES.md in full, and this game's settings (budgets per minute and
  caps).
- **Briefs** (concise; no starter strategies): the lobby brief (write or rework, free, submit both; the game won't
  wait), the in-game brief (time, fitness and rank with the two shares, a few counts, budgets now, the bee's MEMORY size, drafts, scripts it
  might start), the lobby fix brief.
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
auth endpoints, network use: URLs other than the public API on localhost, write methods other than history queries
POSTed to the query endpoints, credentials, raw sockets (agents use the Server-Sent Events from Python); writes into
`stream/`), Read/Glob/Grep paths, and written code. No endpoint writes a bee's MEMORY, and the only POSTs the audit allows
are queries, so a team has no way to set it. The session's own tool-output spill directory and its
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

## Metrics (`lib/metrics.js`, `analyze.js`, `cohorts.js`)

From the game's history once it is over, with history queries (the `turns`, `versions`, `teams` and `scores`
entities; every percent, energy, timing, version and MEMORY is revealed then), in windows of game time (about eight per
game, at least 10 s):

- per window: turns, feeds and the feed rate, excess energy produced, **energy lost** to unfed turns (and its share),
  nectar, pollen, the mean percent offered, flower failures, self-feeds
- **distributions** (min, p10, p50, p90, max, mean) of the response size in bytes and the percent (answered turns), the
  energy (every turn), and the nectar and pollen (feeds)
- per team, its **species** (visits, feeds, pollinators, percent, energy, energy lost, nectar and pollen given, compute
  against the 150 ms window, response sizes and how many were over 4 KB, failures) and its **bee** (turns, feeds, nectar, nectar per feed, species fed at, decision
  times, too-slow decisions, errors)
- each bee's **MEMORY**: its size at the end against the cap (its keys and value), saves `decide` had refused (over the
  cap or of the wrong shape), failed `fed()` calls and the last save error (`teams.memoryError` and the samples), its
  size during play (the runner samples each team's own view every 5 s), and **how often the team changed its bee**
  (each change empties MEMORY): versions, in-game changes, changes per minute, mean time between them
- **wealth signals** (`lib/wealth.js`; each flower call's hidden budget R, `budgetMs`, revealed after the game): per
  species Spearman's rho of R with its effort (CPU ms) and its visible work (response bytes, graph nodes and edges;
  honest when visible work rises with R, rho ≥ 0.3 over 30+ answered turns); per bee and overall, the feed rate at
  poor and rich instances (R terciles); the energy split's "short" share is what R left below the window
- **pollen grains** (`lib/grains.js`; the versions' minified code comes from the game's own minifier): per species the
  grains it gave and the characters leaked to other teams' bees, per minute; per flower version the share of its code
  one other team (and all of them together) held at the end, and when one (or all together) first held every character,
  timed from when the version went live; and **acting on leaked code**: a later version (flower or bee) of the team that
  got the grains with a secret of the leaked code (a string of 6+ characters or a number of 6+ digits) it hadn't used
  before, or 24+ characters in a row of the code it held ("whole-version" when identical and fully held), with the lag
- **big responses** (over 4 KB, which the history gives as size and hash): equal hashes are equal answers; the metrics
  fetch distinct ones for their shapes (`GET …/responses/:seq`, up to 64 MB a game, `BIG_FETCH_BYTES`), and past that a
  big response's shape is its hash
- **flower versions**: size and compute against the energy they made (max energy = (cap − size) × 150), the percent they
  offered, their feed rate and pollen
- **self-feeding** (a bee at its own species) and **handshakes**: a flower whose own bee feeds there 30 points more often
  than other bees, or is offered 15 points more; per (bee team, species) pair the same test, and **mutual** pairs where
  two teams favour each other both ways
- **discrimination**: feed rates by the percent offered and by the nectar on offer (percent × E, in terciles), and per
  bee the mean offer when it fed vs when it left
- **copy latency**: a species' first answer r to challenge c after another team's species answered r to c; a copy if the
  copier's version went live after that answer appeared (else convergence or coincidence)
- the scores: fitness, pollination and forage with their **two shares**, and pollen given
- the **change timeline** (every version: game time, size, node edits, cost, the session or scaffold that submitted it),
  scaffolds, sessions, and storage (the shared stream file, the arena's workspaces with hard links counted once, free disk)

- the **ecology** (`lib/ecology.js`): each species' energy split (size, compute, nectar, pollen, lost, as shares of
  cap × window per turn), its percent minute by minute, **imitation** (a signal is a species' flower version; a close
  copy is another species' later version answering one of its challenges exactly as it did, or in a shape new to the
  copier; the lag from the signal's first appearance), **detection windows** (the feeds a copy gets from rival bees until
  their feed rate there falls below half their rate at the model), **key rotation** (a new version answering most of the
  old challenges differently), **cracks** (answers given before the other species gave them, by a version written after
  its rule appeared) and **autarky** (species living mostly off their own bee)

`analyze.js` also lists games side by side; `--recompute` recomputes stored metrics from the history. `cohorts.js` reads
the versions and turns entities, labels the programs (flower mechanism, signal families and percent policy; bee checks,
feeding rule and MEMORY use) and adds, per game and minute by minute: sophistication (flower levels 0-4, bee levels
0-3), signal families (signature, keyed, puzzle, commitment), innovations (mechanisms, families and checks first seen in
the cohort), the entropy of the mechanisms in use, dominance turnover (the mechanism and species whose flowers gave rival
bees the most nectar), and collapse (autarky, or one frozen mechanism); then the cohorts side by side.

## Tests

No model calls (a stub `claude`), no game server:

```
node arena/test-brief.mjs       # system prompt, lobby/in-game/fix briefs, interview and judge prompts
node arena/test-submit.mjs      # the tools through the broker (fake API): submit, check, try flower (a big response) and a test
                                # bee (with a MEMORY, fed() and its failures), status (the bee's MEMORY and its last error,
                                # read only), history queries; no request sets MEMORY;
                                # a stub session that submits, leaves a process running and gets it stopped; the live
                                # fair-play gate; a session stopped by the game's end
node arena/test-workspace.mjs   # workspace files, the shared stream (hard links, growth, repair), each team's history.jsonl
                                # and mine.jsonl with only its own private fields, big responses (short previews, fetched
                                # whole by tools/stream.py response and garden.response), garden.local and tools/query.py (the
                                # generated client), indices completed at the start, the audit (history queries allowed),
                                # the audit (public API reads allowed; logins, writes, other hosts and ports, stream writes not)
node arena/test-metrics.mjs     # metrics on a hand-made game: windows, energy lost, distributions, flowers and bees,
                                # self-feeding and handshakes, discrimination, versions, copies, shares
node arena/test-mechanisms.mjs  # keyword evidence (families, keyed checks), levels, the classifier prompt and parsing (fake model)
node arena/test-wealth.mjs      # honest wealth signalling: visible work against the hidden budget R, bees feeding at rich instances
node arena/test-dynamics.mjs    # within-game dynamics: mechanisms in use, entropy, dominance and turnover, innovation, freezing
node arena/test-pause.mjs       # usage-limit detection, pause and resume, in-game sessions on a limit, the game's pause sync
node arena/test-scaffold.mjs    # a stub scaffold: tools/ on its path, starts, outlives its session, submits by itself from
                                # its history, is refused over budget, restarts after a crash, forbidden scaffolds (and
                                # modules in tools/) fail the audit, CPU share, stopped at game end
```

They need the `dbc_one` database (the arena schema, a throwaway arena row, cost-ledger rows they delete).

## Useful queries

```sql
SELECT purpose, model, count(*), round(sum(cost_usd)::numeric, 2) FROM arena.llm_calls GROUP BY 1, 2 ORDER BY 1, 4 DESC;
SELECT p.name, s.no, s.phase, s.clock_start, s.clock_end, s.ended_by, s.cost_usd FROM arena.sessions s JOIN arena.personas p ON p.id = s.persona_id ORDER BY s.id DESC LIMIT 20;
SELECT persona_id, op, kind, ok, refused, version, cost, clock_ms FROM arena.requests WHERE op = 'submit' ORDER BY id DESC LIMIT 20;
SELECT persona_id, session_id, severity, left(detail, 120) FROM arena.violations ORDER BY id DESC LIMIT 20;
SELECT tag, description, first_arena, first_team FROM arena.ideas ORDER BY id;
```

Every arena game replays in the web UI at its `/room/<room>/game/<game>` URL on the arena's server.
