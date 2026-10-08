# Design notes: one flower per team

This branch (`claude/one-flower`) is a variant of the continuous garden (`claude/continuous-garden`). Each
team writes **one flower and one bee**; the cosmos/orchid split, its patches and its fixed nectar are gone.
A flower now *chooses* how much to pay, out of energy it can only have by being small and fast.

## Names

| Thing | Name | Why |
|---|---|---|
| a team's answering program | **flower** | |
| a team's asking program | **bee** | |
| one bee's challenge, one flower's response, one decision | **turn** | at most one per bee per round; ceil(slots × N) bees a round |
| each flower call's time budget, uniform in 1–50 ms of CPU time | **R** | hidden from the bee: this flower instance's reserve this turn |
| (flower size cap − size) × max(0, R − CPU ms) × (byte cap − response bytes) | **excess energy** E (node·ms·bytes) | what a flower saved this turn by being small, quick and brief |
| the share of E a flower offers | **percent** | 0–100, clamped |
| percent/100 × E, to the bee if it feeds | **nectar** | |
| (1 − percent/100) × E, kept by the flower if the bee feeds | **pollen** | a turn without a feed pays nobody. A flower allocates its energy between compute, nectar and pollen |
| what every feed costs the bee, out of its nectar (0.05 × Emax) | **feed price** | net nectar = nectar − price, can be negative |
| size cap × R's cap × byte cap (56,320,000) | **Emax** | the most E can be; the price and the prior are shares of it |
| N × a species' share of Σ_b (decayed pollen it gave bee b)^β, capped | **flower success** F | par 1; weights the species draw with c(t); per-bee cells, so spread pollen counts for more |
| N × a bee's share of its decayed nectar balance (pools), capped | **bee success** B | par 1; weights the bee draw with c(t) |
| a bee's single running nectar balance (pools) | **balance** | starts at the endowment, +net nectar a feed, relaxes to the endowment; below the price a bee can't feed |
| N² × p^F × p^B at the final round, p the draw probabilities (c included) | **fitness** (new games, `scoring.mode` "final") | par 1; v2/v3 games: the time-average of F × B ("timeAverage") |
| cStart × sech(k t / cHalfS), k = arccosh 2 | **c(t)** | the weight everyone has whatever its success: flat at first, half at cHalfS (0.2 × the shortest length), toward 0; v2/v3: linear 1 → 0.1 |
| drawn uniformly from [minutes, endFactor × minutes] at the start | **the game's end** | hidden from the teams until it's over |
| `feeds[b][f]`, `nectar[b][f]`, `pollen[b][f]` | **feed / nectar / pollen ledgers** | row = bee team, column = flower team |
| every finished turn, as one team may see it | **history** | for teams and agents, over HTTP and the generated query clients; programs get none |
| a bee's only state from one turn to the next | **MEMORY** | a key-value store the engine keeps, 50 bytes by default |
| a bee's call after an in-time feed, in the instance that decided | **fed(nectar)** | the bee keeps what it worked out that turn long enough to store some of it, and can choose its next challenge knowing the nectar |
| ⌊0.1 × pollen^(1/3)⌋ characters of the answering flower's minified code, to the feeding bee's team | **pollen grain** | pollen carries genes |
| each call's clock, reading 0 as the call's time starts | **the game's clock** | programs can time themselves, not the world |
| Σ xᵢ^p, 0 < p ≤ 1 | **power sum** | the diversity-weighted size of an earnings vector (p = 0.5: Σ√xᵢ, the old **rootsum**) |
| power sum of a flower's pollen column, p = β | **pollination** | how widely, and how profitably, the flower is pollinated |
| power sum of a bee's nectar row, p = α | **forage** | how widely the bee eats |
| value ÷ Σ value over teams (1/N when Σ = 0) | **share** | par 1/N; fitness in games from before is N² × pollination share × forage share |
| N² × pollination share × forage share | **fitness** | par 1.0 for any N |

## The game in one paragraph

Each team has one flower species and one bee. Every 200 ms round, a quarter of the bees (drawn by bee
success; see "Prevalence on both sides") each take one turn; the others' challenges wait. A visiting bee's
challenge must already be queued. The engine draws a flower among all N species (its own included),
weighted by flower success, calls `flower(challenge)`, and the flower has its hidden budget R (1–50 ms of CPU
time, drawn per call) to return `[response, percent]`. The runner measures the call's CPU time, which gives E.
At 150 ms (the end of the flower window) the response reaches the bee, `decide(challenge, response)`, which
has 50 ms of CPU time to return `["feed" | "leave", next]`. On a feed the flower gives the bee nectar and
pollen, the bee pays the feed price out of its nectar, and its optional `fed(nectar)` runs in the same program
instance that decided; a leave pays nobody. The bee's next challenge
is queued for its next turn (a challenge `fed` returns replaces it). Every flower call and every bee turn runs a fresh program; the bee's 50-byte
MEMORY is the only thing that carries over. No program sees any history.

## A hidden budget per call: R

Every flower call gets its own time budget **R**, drawn uniformly from `budgets.flower.minMs` (1) to
`budgets.flower.ms` (50), independently each time (3 to 150 in games from before). `minMs` is 2% of `ms` by
default (at least 1 ms; a set value is kept), so R ranges 50-fold: a poor instance has almost nothing to give. R is the call's hard limit, in CPU time (the runner stops the flower once it has used R,
as it stopped it at 150 ms of wall time before) and the ceiling its energy counts down from: E = (cap − size) × max(0, R −
CPU ms) × (B − bytes) (B the byte cap; see "Bytes cost too"). The flower is told R as `GAME.ms`; the bee never is, and the response still reaches it at the end of the
fixed 150 ms flower window (`flowerWindowMs`, decoupled from R's cap), so timing tells it nothing about R.

So compute costs the same energy whatever R is, but a flower can only show t ms of checkable work (and
still have energy to give) when R ≥ t. Each flower instance has its own hidden reserve this turn, and work
is an honest signal of it: the bee has to judge from the answer alone whether this flower is rich and
generous. R is the flower's team's during play (`budgetMs` on its actions and turn records, like its CPU
time) and everyone's after the game. The engine draws R as each turn starts (`drawBudget`), sends it with
the call, and the runners use it as both the timeout and `GAME.ms` (`try` can fix it per challenge).

## Why energy, and why CPU time

The cosmos/orchid design made "effort" a signal through a time asymmetry: a cosmos had more time than an
orchid. Here every flower has the same window, but effort is *paid for*: every millisecond of CPU a flower
spends, and every node of code it carries, comes out of E, the pie it shares with a bee that feeds. A
flower that makes its answers hard to fake spends energy doing it, and has less to offer. A flower that
answers cheaply has more to offer, or to keep.

E is measured in **CPU time**, inside the runner, around exactly the flower's own work:
- Python: the forked child's thread CPU clock (`CLOCK_THREAD_CPUTIME_ID`, exact) from just after the fork
  until its response is written as JSON (the program's module code included).
- TypeScript: the main thread's CPU clock (exact, through a small native addon, `runners/native/cpuclock.c`,
  built with the system's compiler on first use) around running the program in its fresh context, calling
  `flower` and encoding its reply (creating the context, which costs every flower the same, is left out).

Wall time would charge a flower for the machine being busy, and would let a flower game E by sleeping in
another's slot. CPU time charges for work done.

## Limits are CPU time too

Every *limit* is CPU time as well (docs/research/compute-budgets/REPORT.md): a flower is stopped once it has
used R of CPU and is late iff it used more than R; a bee's `decide` is in time iff it used at most 50 ms of
CPU (stopped at 2 s), `fed` is stopped at 50 ms. A busy machine stretches rounds in wall time but can't make
a program late. Measured on the real runner, a flower burning 0.9 R pinned to a core shared with a spinner
went from 99% (Python) and 100% (TypeScript) late with wall-clock R to 0% with CPU R.

- **Python** (`py_runner.py`): the graceful stop is an `ITIMER_REAL` (an hrtimer) re-armed against the
  call's remaining thread CPU: when it fires the handler reads the thread clock and either raises `Timeout`
  or re-arms for what's left (to 20 µs). A long C call (`sum(range(10**9))`) or a program that swallows
  `Timeout` meets the hard stop, a POSIX timer on the child's own thread CPU clock (`timer_create`, its ctypes
  resolved before the fork) that sends SIGKILL at R + 5 ms. No `ITIMER_PROF`, `ITIMER_VIRTUAL` or process-clock
  timers: they would make `process_time()` tick-stale. An endless loop is stopped 0.1–0.3 ms past R.
- **TypeScript** (`ts_runner.cjs`): each call is one `runInContext` with `breakOnSigint`; a watchdog
  `Worker` reads the main thread's CPU clock exactly and sends one SIGINT when the call has used its budget
  (a shared-memory handshake makes sure the SIGINT only lands while a call is running, and a SIGINT
  listener keeps a stray one from killing the process). An endless loop is stopped 0.4–4 ms past R.
- **Sleeping is useless**: Python's `time.sleep` and TypeScript's `Atomics.wait` return at once.
- **Placement**: runners join the `dbc-runners` cpuset (cores 2–3; `RUNNER_CPUS`, or `RUNNER_CPUSET=off`)
  after setup, so the server and Postgres keep cores 0–1; if it can't be created the server logs once and
  carries on. At most `CPU_SLOTS` (2) programs run at once, one per runner core. No real-time scheduling.
- **Wall-clock backstop** (`wallLimits` in server/lib/gameConfig.js) for calls that aren't computing: a
  flower still going at 400 ms (or 2 × `flower.ms`) is stopped; a bee's `first`/`decide` with no reply at
  250 ms (or 4 × `bee.ms`) is judged then and stopped at 4 s; `fed` is stopped at 250 ms. A call the
  backstop meets is attributed with `/proc/<pid>/schedstat`: if it spent at least half its wall time runnable
  but waiting for a CPU (and less than its budget computing), it is a **server fault** and its turn is
  **void**: no feed, no energy, nobody's problem, the bee asks the same challenge again, and the turn is
  recorded as a `leave` whose `flowerError` or `beeError` starts `server fault:`. Otherwise the call is late.
  With CPU limits and two cores to themselves, a program has to be starved more than 2× for 400 ms before
  this fires: rare, and a sign that the server is overloaded, so nobody is charged for it.
- Old games: the CPU limits apply to every game the engine runs from now on, old configs included (none of
  them needed a wall-clock limit to score).

**Bytes cost too.** With `energy.bytes` (the default), E has a third factor: E = (cap − size) × max(0, R −
CPU ms) × (B − bytes), in node·ms·bytes, where B is `maxResponseBytes` (1,024 by default) and bytes the
response's JSON size as the cap counts it. So code nodes, compute milliseconds and output bytes are each free
only when unused: a flower can show work in CPU time or in what it writes, and either costs it. E is not
divided by B, so a game with bigger limits makes bigger numbers, which gives players a feel for the scale of
compute (scores use shares, so they don't care). A response of exactly B bytes is still an answer, with E = 0.
Grains are ⌊0.1 × pollen^(1/3)⌋ characters by default (0.1 ≈ 1,024^(−1/3)), so they stay about as long as
they were in node·ms. A game stored without `energy` keeps the two-factor formula in node·ms, its stored cap
(65,536 for the games before it) and its grain scale (1); old and new energies aren't comparable.

## Lockstep rounds: why timing is equalised

As in the continuous garden, every response is delivered at 150 ms however fast its flower was, and the bee
is only called in the decision window, after every flower in the round is done. So the clock inside a bee
can't tell a fast flower from a slow one, and a flower's compute time stays private to its team (it is
public only through E on a feed, mixed with the flower's private size).

A bee's next challenge is decided a round ahead and queued; it is never shown before its turn ends. A bee
with nothing queued as a round starts loses its turn. A late bee loses its turn's say, never its next
challenge: its call runs on (up to 2 s of CPU), the turn is settled without it (never as a feed), and a late
`["leave", c]` still queues `c`. Any other late reply, and any reply with no usable next challenge, gets
the bee asked `first()` at once, outside the round flow (at most one such request in flight per bee,
at most one new one a round).

## Programs see no history; teams do

Programs get only their arguments and `GAME` (and the bee its MEMORY). An earlier version gave every
program a typed `HISTORY` of every finished turn; it is gone, so a bee can't look up which flowers paid
and a flower can't look up which bees feed: whatever a bee knows about the flowers it meets, it must carry
in 50 bytes of MEMORY or work out from the challenge and the response in front of it. A flower's
reputation has to live in what its responses look like.

**Teams** still see every finished turn (what they may see of it): the ledger and the query endpoints, and
the generated query clients (`vendor/query/`, docs/QUERY.md) for agents and operators. They change their
programs with what they learn, paying change budget, at human or agent speed rather than per turn.

**Nobody learns the counterpart of a turn while it runs.** While a flower answers it isn't told whose bee
asked; while a bee decides it isn't told whose flower answered, nor the percent, E or the nectar. A team
sees its turns' counterparts once they're over. What a program can *infer* is fair game: a challenge or a
response can be a signature.

## Every turn runs fresh; a bee has MEMORY and fed()

Flowers and bees alike are stateless: each flower call and each bee turn runs the program from the top in
a fresh process (Python, forked from the runner) or a fresh vm context (TypeScript), so no global, cache or
thread survives. The exceptions are a bee's **MEMORY** and its **fed** call:
- MEMORY is a key-value store: string keys; string, number, boolean or null values; nothing nested. Its
  size is Σ over entries of (the key's UTF-8 bytes + the value's JSON bytes), at most `budgets.bee.memory`
  (50 by default). A bee gets the saved MEMORY with every call (`{}` to start); after `first`, `decide` or
  `fed` returns, the runner sends it back and the engine saves it if it has that shape and fits. Otherwise
  the old one is kept and the error is recorded (on the turn for `decide`, and as the MEMORY's error). A
  call that crashes saves nothing.
- `fed(nectar)`: after an in-time feed, the runner keeps the instance that decided (Python: the forked
  child, waiting on a pipe; TypeScript: the context) and the engine calls `fed` in it as the turn is
  settled, hard-stopped at `bee.ms`. Then MEMORY is saved again and the instance is dropped. Any other
  request to the bee drops a kept instance first, and every request waits for a `fed` in flight (and its
  MEMORY). It never makes the bee busy, so it never costs a turn.
- `fed` may return a next challenge: a valid one replaces the one `decide` queued, so the bee can choose
  what to ask next knowing what it just earned (still never the percent). `None` keeps `decide`'s; an
  invalid one keeps it too and is reported; a crash or a stop keeps both `decide`'s challenge and the MEMORY
  saved after `decide`. `first` is asked only once `fed` is done, if neither gave a challenge. With
  `feedCost` 0 the next turn can start before a slow `fed` ends (a live game doesn't wait; an unpaced one
  does): that turn plays `decide`'s challenge and `fed`'s is dropped, with a problem for the team.
- A new bee version starts with `{}`. A crash, a restarted runner, or the game moving to another server
  process keeps it: MEMORY is written with the game's live state (`bee_memories`, four times a second)
  and restored on adoption.
- Only the bee writes its MEMORY: no route, view or operator tool can. The bee's team can read it during
  play (the game view, and the `teams` query entity); everyone can after the game ends. The "try" tool can
  start a local test bee from a MEMORY you give it, which never touches a game's.

Statelessness is what makes the cap mean something: a bee can't keep a lookup table in a global, and it
can't remember more than its 50 bytes. `fed` exists because the nectar of a feed is only known once the bee
has decided: without it, a bee could only remember what it guessed, not what it got.

## The game's clock: every call starts at the epoch

Flowers shouldn't know what round it is, and bees shouldn't either: no program gets an anchor to the
world's time or the game's progress. So every call's clock (flower, `first`, `decide`, `fed`) reads 0 as
the call's time starts, as if at 1970-01-01 00:00:00 UTC, and runs at real speed in fine steps. A program
can time its own work as precisely as before; every call looks the same in absolute time.

- Python: an import of `time` gives the game's `time` module (`game_clock` in the runner): `time`,
  `monotonic`, `perf_counter` (and `_ns`) and `clock_gettime` read the time since the call started;
  `process_time` and `thread_time` the call's own CPU time; `gmtime`, `localtime`, `ctime`, `asctime` and
  `strftime` use that clock, in UTC. `monotonic` was the machine's uptime, a real clock, and is now the
  call's. Every other allowed module is a **view**: its public names only. That drops the modules some
  of them carry (`random._os`, `statistics.sys`, `dataclasses.builtins`, `enum.sys`, …), which led
  straight to `os`, `sys` and the real clock. `os`, `sys`, `datetime` and `uuid` stay disallowed.
- TypeScript: the prelude replaces `Date` (with the real constructor out of reach: `Date.prototype.
  constructor` is the game's), makes `Intl` date formatting without a date use the game's clock, and adds
  `performance` (`now()` from 0, in fractions of a millisecond, `timeOrigin` 0). The clock's source is the
  host's `performance.now`, held in the prelude's closure, where the program can't reach it.
- The runners run with `TZ=UTC`, so no time zone leaks either. `GAME` holds the game's settings only (no
  round, turn or clock); a bee that counts its turns in MEMORY is counting its own experience.

The Python runner is still not a security sandbox (README): a program that digs into the interpreter's
internals (`__globals__`, frames, `__subclasses__`) can reach the real clock, just as it can reach `os`.
Everything a program can reach through the documented interface reads the game's clock.

## No user code runs after the clock stops

A program could buy free compute by doing its work while the runner encodes its reply: a `toJSON` method, a
getter, a Proxy, or (in Python) a `dict`, `str` or `int` subclass whose hooks run during `json.dumps`. So:
- TypeScript: the reply (and a bee's MEMORY) is encoded with `JSON.stringify` inside the program's context,
  under its timeout and inside the CPU measurement; only a string crosses back. Printed output is kept as
  one string and read back with intrinsics captured before the program ran. `FinalizationRegistry` is
  removed, since its callbacks would run between calls (a kept context could otherwise compute for its
  `fed` off the clock).
- Python: before the timer stops, the reply (and MEMORY) is copied into plain `dict`, `list`, `str`,
  `int`, `float`, `bool` and `None` by exact type; anything else, subclasses included, is refused as not
  plain data. A flower's response is also written as JSON before the timer stops (that is its compute,
  and its size is checked against the cap). A kept bee instance waits for `fed` blocked on a pipe, with no
  thread or signal of its own to run.
- Each runner is its own process group and is killed as one, and a forked Python call dies with its runner
  (`PR_SET_PDEATHSIG`), so a call that outlives its deadline can't keep computing.

## Big responses

A response may be up to `maxResponseBytes` (1,024 by default; 65,536 before the byte factor) of JSON;
`maxLen` and `maxNodes` now limit only challenges, and responses only nest 256 levels deep. The runner checks
the size inside the flower's timed window, so a big response costs the flower the CPU time to build and write
it, its bytes cost energy too (see "Why energy"), and one over the cap is a failure (null, E = 0). With the
1,024-byte default no response reaches the 4 KB preview size below; that applies when the owner raises the cap.

**Delivery to the bee.** As soon as a flower answers, its response goes to the bee's runner ("stage"): the
Python runner parses it in its parent (so the forked call inherits it parsed), the TypeScript runner parses
it into the next call's fresh context. Both happen before the bee's 50 ms start.

**Storage and live feeds.** Every response is public and must stay fetchable. A response over 4 KB of JSON
(`INLINE_BYTES`) is stored apart, in `responses` (its JSON text, compressed by Postgres with lz4); its
action keeps `r = null`, its size, its SHA-256 and its first 4 KB, which is what pages, the ledger, the
query endpoints and the live feeds (SSE, WebSocket) carry. `GET …/responses/:seq` serves the whole text.

**Measured** at a 1 MB cap (the default was then 65,536 bytes, so these are 16× the worst case such a game
allowed, and 1,000× today's 1,024-byte default), on this machine (4 cores, Postgres 16), a live game of 6 teams whose flowers all answer every turn
with about 1 MB and whose bees never feed (30 turns a second, the most 6 bees can take), 20 s of game time
each:

| response | flower CPU per answer (Python) | stored per response (lz4) | stored per game-second | live feed per viewer | server CPU (node) |
|---|---|---|---|---|---|
| 150,000 ints (0.94 MB) | 35 ms | 0.62 MB (1.5×) | 18 MB | 115 KB/s (4.5 KB a turn) | 55% of a core |
| 1 MB of random hex | 13 ms | 1.0 MB (1.0×) | 30 MB | 115 KB/s | 56% |
| 1 MB of one letter | 4 ms | 4 KB (254×) | 0.1 MB | 120 KB/s | 48% |

Rounds ran 15% long in wall time (23 s for 20 s of game time: the machine's 4 cores were busy), the bees'
decisions took 4 ms, and nothing failed. Without previews each viewer would have needed 30 MB/s. The cost
that remains is storage: up to about 30 MB per game-second of incompressible 1 MB responses (3.6 GB for a
2-minute game at that worst rate; Postgres writes about as much again to its WAL). At a 64 KiB cap that
worst case is about 2 MB per game-second, and at the 1,024-byte default about 30 KB. The TypeScript runner writes 0.94 MB of ints in 13 ms of
CPU.


## Pollen carries genes

On every feed, after the turn is settled, the engine cuts a **pollen grain** from the minified code of the
flower version that answered (the version pinned to the turn): ⌊scale × pollen^exponent⌋ characters
(`pollenGrain`, by default scale 1 and exponent 1/3: 27,000 pollen gives 30 characters, 150,000 gives 53),
from a start drawn uniformly at random, wrapping from the end back to the start so every character is as
likely to leak (`grainOf`). A grain at least as long as the code is the whole code. The grain goes with
the flower's version and its code's length in characters, but not its start: teams line grains up by
their overlaps.

During play a grain is the feeding bee's team's (`grains: "feeder"`; `"public"` shows it to everyone, `"off"`
cuts none); after the game everyone's. It is a field of the feed action (`grain`, `grainVersion`,
`grainCodeLength`) and of the `turns` record, masked with a `grain` visibility rule in the views, the ledger
and SQL. Programs never get one (`fed` gets the nectar only).

So the more pollen a flower gives away, the more of its code travels with it. In the smoke and demo games
(pollen mostly 30,000–170,000 node·ms) grains were 25 to 53 characters (median 37), and the demo's flowers
were 37 to 119 characters minified: about a third of the grains were whole flowers. The version that comes
with a grain also tells the feeding team which version of that flower answered, which is otherwise the
flower's team's business during play.

## Prevalence on both sides, the feed price, and fitness

A species or a bee that does well becomes more common, as in an ecosystem (server/lib/prevalence.js; RULES.md
"Prevalence"). Each round ceil(slots × N) bees (a quarter by default) are drawn without replacement with
weights c(t) + B_b, and each visits a species drawn with weights c(t) + F_s; the bees not drawn keep their
challenges for later.

**Flower success** F_s is N × the species' share of Σ_b (decayed pollen it gave bee b)^β. The pollen is kept
per bee team and raised to the 0.85 power, so the same total pollen spread over many bee teams counts for
more than a lump to one: a flower can't make itself common by pollinating a single partner bee, which keeps
one team's flower and bee from becoming a self-dealing singleton pair. Each pollen cell starts at a prior of
0.12 × Emax and halves every 90 s of game time (rounds, so a pause doesn't decay).

**Bee success** B_b (v3, `pools`, the default) is N × the bee's share of its single nectar **balance**,
floored at 0 for the share. Unlike the per-flower pollen, nectar is one running balance per bee: it starts at
the endowment (10 × the feed price), each feed adds its net nectar (nectar − price), and each round it relaxes
toward the endowment on the same half-life — spending above the endowment like metabolism, recovering toward
it from below. A bee whose balance is below the price **can't feed** (its feed becomes a leave, "too poor to
feed") and recovers over time. This is linear, so a crash can rebuild it exactly from the feeds. The older v2
bee success (N × share of max(0, Σ_s signed (decayed net nectar)^α), per flower) stays under `pools` false,
so an in-flight v2 game stays reproducible.

Both F and B are capped at 4, par 1. c(t) = cStart × sech(k t / cHalfS), k = arccosh 2 (`cDecay` "sech"): flat
at the start, half at cHalfS (0.2 × the shortest length, 60 s at the defaults), then an exponential tail to 0
with no floor. So early on everyone is seen and late on success is nearly all that matters; a team weighing 0
is never drawn while anyone eligible weighs more (all 0: uniform). The curve is set in seconds of game time,
not as a share of the game, because the game's length is hidden. v2 and v3 games keep their linear c (1 →
0.1 over `minutes`, `cDecay` "linear").

**The end is hidden.** A game lasts at least `minutes` (5 by default) and at most `endFactor` × `minutes` (2
×). The start draws the end uniformly from that range, rounded up to a whole round, into `games.end_ms`
(server/db/migrations/010_hidden_end.sql); the garden stops there. Nothing a team or a spectator can read has
it until the game is over: the views and `GET .../scores` give `minMs`, `maxMs` and `endMs: null`; programs
have no clock beyond their own call's; c doesn't depend on it. The room owner's view has `drawnEndMs` (unless
the owner plays). With the end unknowable, there's no last-round play to plan for and no point at which the
score stops mattering: hence a final-instant score.

**The feed price** (0.05 × Emax, 2,816,000 at the defaults) is taken out of every feed's nectar: net = nectar −
price. It replaces the 20-round sit-out as the cost of feeding, and makes feeding at a stingy or a 0% flower
a loss that shows in B. fed(nectar) still gets the gross nectar.

**Fitness** (`scoring.mode` "final", new games) is N² × p^F_s × p^B_s at the final round: the team's species'
draw probability times its bee's, as the sample publishes them (c included, the cap applied), par 1 since each
p is 1/N for an average team. The scoreboard shows it live as it stands; whatever it is when the hidden end
comes is the final score. v2 and v3 games ("timeAverage", configs stored without a mode) keep the
time-average over the rounds played of F_s × B_s. Either way it is built from prevalence, which is why the
flower's success is measured in pollen: generosity (nectar) costs the flower F, and the bee's success is
measured net of the price. The old score (N² × pollination share × forage share) stays for games without
prevalence, so games from before keep their numbers.

**Slow change.** R's cap is 50 ms (in a 150 ms window, so rounds are still 200 ms and timing still hides R),
and change budgets are 60 nodes a minute for a flower (bank 300) and 600 for a bee (bank 3,000): learning or
imitating a strategy is meant to be hard work. All of it is per-game config; a config stored before these
rules (no `prevalence`, `feedPrice` or `flowerWindowMs`) plays as it did.

The engine keeps the decayed ledgers (per-bee pollen cells, and each bee's nectar balance) in the garden. As
each round begins they decay — pollen by d = 2^(−round_s / halfLifeS) toward 0, the balance toward its
endowment by the same d (the endowment is the relaxation's fixed point) — and it adds the round's F × B to
each team's fitness sum and keeps its N² × p^F × p^B as the latest instant. The ledgers are not stored: a garden adopted after a crash rebuilds them exactly
from the game's feed actions (pollen = prior × d^R + Σ pollen × d^(R − round); balance = endowment + Σ net ×
d^(R − round); the price and the balance stored on each feed). The fitness sums are on the game
(`games.fitness`, `{ sum, rounds, last }`, written with the ledgers; v3 games stored `{ sum, rounds }`). Every ⌈1000 / round_ms⌉ rounds, as a round
begins, the garden samples every team's F, B, p^F, p^B, fitness and nectar balance with c and the slots: the
latest goes on the game row (`games.prevalence`), every sample into the `prevalence` table
(server/db/migrations/007_prevalence.sql, 008_metagame.sql, 009_pools.sql), written with the actions. The
view, the scoreboard, the action stream (a message carries a new sample once), `GET .../prevalence` and the
`prevalence` query entity publish them. Programs never see them: nothing about prevalence (not the balance
either) is in `GAME`.

## What is public

**Private play** (`visibility: "private"`, the default since metagame v4) turns that around: until the game is
over a team sees only what its own programs see (its flower's visits without the visiting bee or the decision,
its bee's turns without the species that answered), its own grains bare, and everyone's prevalence in coarse
snapshots (every `prevalenceEveryS` seconds of game time, rounded to 2 decimals); spectators only the snapshots.
Imitation then has to go through genes (pollen grains), not watching. It is enforced where data leaves the
server (server/games.js restrictedFor, privateActionViews, snapshotView; server/query/mask.js privateTurns;
server/query/sql.js for the history queries), so every surface, the streams included, gives the same restricted
view; the room's owner with no team in the game keeps the public view, to run and analyse the game. A
snapshot is a scheduled sample (the garden's own once-a-second ones), so no derived number is published.

Public play, as games before it: arrivals, challenges, responses and every feed (with its percent, E, nectar and pollen) are public to
everyone as they happen, spectators included, and so are the scoreboard and prevalence. That was a deliberate change from
"third-party turns are secret": any self-dealing scheme, such as a handshake between a team's own bee and
flower, has to work in plain view, where every other team can study and copy it.

Private during play: the percent and E of a turn without a feed (the flower's team), the flower's compute
time on every turn and why it failed (the flower's team), and each team's code, prints, versions, sizes,
budgets, bee timings, bee MEMORY and pollen grains (the feeding team's). The secret that remains is the flower's compute time, which can't be read off a
public E without the flower's size, which stays private with its code. Everything is revealed at the end.

When the garden stops it publishes the sample of the last round played (unless the schedule just did), with
p^F and p^B unrounded, so a final-instant score can be recomputed exactly from published data; in private play
it is no snapshot, so it shows only once the game is over.

## Versions are pinned per turn

A turn keeps the bee's and the flower's program versions from its arrival to its settlement. A new flower
answers turns that start after it went live (the old version's processes are kept, reference-counted,
until no turn uses them). A new bee takes over when its turn in progress is settled: the old bee makes that
decision (a feed still counts, and its rounds are still sat out), whatever it queued is dropped, and the
new bee is asked `first` at once. A bee between turns switches at once. A team watching its bee arrive
can't steer that turn.

## Each round, in the engine

| Game time | What happens |
|---|---|
| 0 ms | A crashed bee's runner is restarted (its MEMORY kept); new code for a bee between turns takes over (with an empty MEMORY); a bee with nothing queued is asked `first` (at most once a round). Each bee with a challenge queued, no call in flight and no rounds left to sit out takes its turn if it is drawn among the round's ceil(slots × N) visitors (by bee success; prevalence decays, is tallied into fitness and sampled as the round begins): a flower is drawn (by flower success), the arrival is recorded and flushed at once, both versions are pinned, and the flower is called. Each response goes to its bee's runner as soon as it is in. A bee with nothing queued loses the round. |
| 150 ms (the flower window) | Every response is delivered; each bee with a turn is called: `decide(challenge, response)`, with its MEMORY. |
| 200 ms | Each reply is in, or its deadline has passed. Each bee's MEMORY is saved if it fits. Each turn is settled: nectar, pollen, the feed price and the ledgers (and the prevalence ledgers); the turn's end (`feed` or `leave`, carrying the whole turn) is recorded; a feed sits the bee out `feedCost` rounds (0 by default) and calls its `fed(nectar)` in the instance that decided (a challenge it returns replaces the queued one); new code for the bee takes over. |

At most one turn per bee per round: with 6 teams, at most 30 turns (60 actions) a second.

## How it runs

- `server/engine.js`: a `Garden` runs one game's rounds (above). Per bee it keeps the challenge queued for
  its next turn, whether a call is in flight, the turn in progress, rounds left to sit out, and a
  generation number so replies from a replaced or restarted process are ignored, its MEMORY and any `fed`
  in flight. `paced: false` runs rounds back to back (tests and the "try" tool); a request outside the
  round flow then makes the next round if it answers within the bee's 50 ms. `keepHistory` keeps every
  finished turn's record (tests).
- `server/runners/`: `proc.js` speaks JSON lines to a runner process (its own process group, `TZ=UTC`), one
  request at a time, in order. Programs get the game's clock and (Python) module views. `py_runner.py` and `ts_runner.cjs` run every call fresh, stopped and judged on its own thread's CPU clock (see "Limits are CPU time too"): flowers CPU-timed with
  their response's size checked, bees with their MEMORY passed in and sent back, the next decision's
  response staged ahead of its call, and a feed decision's instance kept for `fed`.
- `server/live.js`: each running game's garden runs in exactly one server process, whichever holds the
  game's Postgres advisory lock; every process adopts running games nobody holds, so a game survives its
  process dying. Adoption restores the round, clock, ledgers, each bee's turn count, the rounds a bee still
  has to sit out (from its last feed) and each bee's MEMORY. A hard crash loses the round in progress (its
  arrivals may be stored without their ends); a clean shutdown settles it first. Four times a second the
  garden's new actions (big responses into `responses`), round, clock, ledgers and changed MEMORY are
  written; arrivals are written at once.
- `server/games.js`: the clock lives in the database (`games.clock_ms`, game time, which stops while
  paused). Budgets as before. The views filter every action, history record and game view for the viewer
  (`actionView`, the schema's `mask`). Queries (`POST …/query`) go to `server/query/sql.js`; whole
  responses come from `viewResponse`.
- `server/query/`: the schema (`schema.js`: entities, types, indexes, visibility), the mask for in-memory
  records (`mask.js`), and the SQL compiler (`sql.js`): parameterised SQL with each field masked for the
  viewer before WHERE, GROUP BY and ORDER BY, a statement timeout and a row cap.
- `scripts/gen-query/`: generates the typed clients in `vendor/query/` (records, an immutable builder, an
  in-memory executor with indexes, and a remote executor) from the schema. See [QUERY.md](QUERY.md).
- `server/realtime.js`, `server/sockets.js`: the per-viewer feed over SSE and WebSocket, fed by Postgres
  `LISTEN/NOTIFY`.

## Why a power sum

A vector of earnings `v` from N sources has power sum `Σ vᵢ^p`, with 0 < p ≤ 1. For p < 1 and a fixed total
`T`, it is largest when earnings are spread evenly (`N^(1−p) · T^p`) and smallest when they all come from one
source (`T^p`). Diminishing returns per source (`d(k^p)/dk = p·k^(p−1)`) mean the k-th feed from the same team
is worth less and less, so a bee can't farm one friendly flower and a flower can't rely on one loyal bee.
Own-team entries count like any other source: a team can always earn from itself, but only as one of N columns.

The exponents are per game: forage takes α (`scoring.alpha`) and pollination β (`scoring.beta`), both 0.85 by
default. Games used to be scored with √ (p = 0.5): there, four sources are worth twice one source of the same
total; at 0.85, about 1.23 times, so how much a source pays counts for more against how many sources there
are. A game whose stored config has no `scoring` is from before the exponents and is still scored with √
(`scoringOf` in server/lib/scoring.js), so its scores, replays and analyses don't change.

Pollination is the power sum of the pollen a flower kept per bee team: one term that rewards both being fed
at (no feed, no pollen) and keeping something when fed, spread over many teams' bees. (An earlier version
had separate allure (from feed counts) and surplus terms; they merged into this one, and surplus was renamed pollen.) Fitness is
N² × pollination share × forage share, so a perfectly even game scores 1 for everyone.

## Budgets

| | flower | bee |
|---|---|---|
| size | 1,100 nodes | 11,000 nodes |
| change | 60 a minute (1 a second), banking 300 | 600 a minute (10 a second), banking 3,000 |
| time | R: 1–50 ms of CPU, drawn per call (`minMs`..`ms`), in a 150 ms window | 50 ms of CPU |
| memory | none | 50 bytes (Σ key bytes + value JSON bytes) |

The flower keeps the cosmos's limits: small and slow to change (slower still since prevalence: learning
or imitating a strategy is meant to be hard work; games from before had 220 and 2,200 a minute, a minute's
worth banked, and R from 3 to 150 ms). Its size cap is also the size cap of the
energy formula, so every node of flower code costs energy on every turn. The bee keeps room for detector
repertoires but little time per decision, so the best checks are cheap ones. All of it is configurable.

## Flowers are stateless, not pure

A flower runs fresh for every call, so nothing carries over between calls, and it sees no history. But
each call gets fresh randomness and the clock. The engine never caches answers.

## Programs are measured on, and run as, their minified form

Size and change are both measured on the program after the game minifies it (vendor/measure.js, the
same file in the server and the editor), and the minified program is what runs:
- It drops comments, blank lines and spacing.
- It renames every name the program defines to the shortest free name, most-used first.
- It strips TypeScript types.

**Size** counts the syntax-tree nodes of what's left:
- comments, types and redundant parentheses aren't nodes
- a literal weighs one per byte of its text, so a long string or number can't hide a lookup table
- a name that minifying must keep (attribute and keyword names, class attributes) weighs one, plus one
  per byte beyond 20, because those names exist when the program runs

Writing readable code costs nothing, so nobody gains by minifying by hand. Running the minified text means
names don't exist at runtime, so they can't hide data either. That needs renaming to be exactly safe, so
names keep their spelling where renaming could change behaviour:
- names bound in a class body (they're attributes)
- parameters also passed by keyword somewhere
- names that shadow a builtin
- the first part of a dotted import
- the names the game looks up (`flower`, `first`, `decide`, `fed`, `GAME`, `MEMORY`)

**Change** is a weighted Zhang–Shasha tree edit distance between the program playing now and the new one.
Inserting or deleting a node costs its weight. Relabelling a literal costs the byte-level edit distance
between the old and new text; relabelling anything else costs 1. Before comparing, the new version's names
are lined up with the old version's: both are minified with every name blanked out, the two texts are
diffed, and names that fall in matching stretches are paired. So a rename, a comment or reformatting
costs nothing, and a new variable doesn't reshuffle every other name. Writing a program from nothing costs
its whole size. The editor's diff marks show the node operations, and a changed literal is marked byte by
byte.
