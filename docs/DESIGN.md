# Design notes: one flower per team

This branch (`claude/one-flower`) is a variant of the continuous garden (`claude/continuous-garden`). Each
team writes **one flower and one bee**; the cosmos/orchid split, its patches and its fixed nectar are gone.
A flower now *chooses* how much to pay, out of energy it can only have by being small and fast.

## Names

| Thing | Name | Why |
|---|---|---|
| a team's answering program | **flower** | |
| a team's asking program | **bee** | |
| one bee's challenge, one flower's response, one decision | **turn** | at most one per bee per round |
| (flower size cap − size) × max(0, 150 − CPU ms) | **excess energy** E (node·ms) | what a flower saved this turn by being small and quick |
| the share of E a flower offers | **percent** | 0–100, clamped |
| percent/100 × E, to the bee if it feeds | **nectar** | |
| (1 − percent/100) × E, kept by the flower if the bee feeds | **pollen** | a turn without a feed pays nobody. A flower allocates its energy between compute, nectar and pollen |
| `feeds[b][f]`, `nectar[b][f]`, `pollen[b][f]` | **feed / nectar / pollen ledgers** | row = bee team, column = flower team |
| every finished turn, as one team may see it | **HISTORY** | a typed, read-only query object every program gets; operators query the same records over HTTP |
| a bee's only state between calls | **MEMORY** | a JSON value the engine keeps, capped in bytes |
| Σ√xᵢ | **rootsum** | the diversity-weighted size of an earnings vector |
| rootsum of a flower's pollen column | **pollination** | how widely, and how profitably, the flower is pollinated |
| rootsum of a bee's nectar row | **forage** | how widely the bee eats |
| value ÷ Σ value over teams (1/N when Σ = 0) | **share** | par 1/N |
| N² × pollination share × forage share | **fitness** | par 1.0 for any N |

## The game in one paragraph

Each team has one flower species and one bee. Every 200 ms round, each bee that isn't feeding takes one
turn. Its challenge must already be queued. The engine draws a flower uniformly at random among all N
species (its own included), calls `flower(challenge)`, and the flower has 150 ms to return
`[response, percent]`. The runner measures the call's CPU time, which gives E. At 150 ms the response
reaches the bee, `decide(challenge, response)`, which has 50 ms to return `["feed" | "leave", next]`. On a
feed the flower gives the bee nectar and pollen and the bee sits out `feedCost` rounds; a leave pays
nobody. The bee's next challenge is queued for its next turn. Every call runs fresh; the bee's MEMORY is
the only thing that carries over.

## Why energy, and why CPU time

The cosmos/orchid design made "effort" a signal through a time asymmetry: a cosmos had more time than an
orchid. Here every flower has the same 150 ms, but effort is *paid for*: every millisecond of CPU a flower
spends, and every node of code it carries, comes out of E, the pie it shares with a bee that feeds. A
flower that makes its answers hard to fake spends energy doing it, and has less to offer. A flower that
answers cheaply has more to offer, or to keep.

E is measured in **CPU time**, inside the runner, around exactly the flower's own work:
- Python: the forked child's `time.process_time()` from just after the fork to just after `flower()`
  returns (the program's module code included).
- TypeScript: `process.cpuUsage()` around running the program in its fresh context and calling `flower`
  (creating the context, which costs every flower the same, is left out).

Wall time would charge a flower for the machine being busy, and would let a flower game E by sleeping in
another's slot. CPU time charges for work done. The time *limit* is still wall-clock (150 ms, enforced in
the runner); since the engine runs at most one program per core, the two stay close.

## Lockstep rounds: why timing is equalised

As in the continuous garden, every response is delivered at 150 ms however fast its flower was, and the bee
is only called in the decision window, after every flower in the round is done. So the clock inside a bee
can't tell a fast flower from a slow one, and a flower's compute time stays private to its team (it is
public only through E on a feed, mixed with the flower's private size).

A bee's next challenge is decided a round ahead and queued; it is never shown before its turn ends. A bee
with nothing queued as a round starts loses its turn. A late bee loses its turn's say, never its next
challenge: its call runs on (up to 2 s), the turn is settled without it (never as a feed), and a late
`["leave", c]` still queues `c`. Any other late reply, and any reply with no usable next challenge, gets
the bee asked `first()` at once, outside the round flow (at most one such request in flight per bee,
at most one new one a round).

## HISTORY: what the programs know

Programs used to see only their own visit. Now both of a team's programs get **HISTORY**, an immutable
global holding every finished turn of every bee, with what the team may see of it (the public part of every
turn; the private details of turns at its own flower or by its own bee). It is how a bee learns which
flowers paid, and how a flower learns which bees feed. Operators query the same records over HTTP; see
[QUERY.md](QUERY.md).

HISTORY is a typed query object, not a list: `HISTORY.turns.my_bee().eq("fed", True).group_by("flower")
.sum("nectar").rows()` (Python) or `HISTORY.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar")
.rows()` (TypeScript). Both clients are generated from one schema (`server/query/schema.js`) by
`scripts/gen-query/`, along with the SQL the server compiles the same queries to, so the three give the
same rows. The schema says, for every field, who may see it; the engine masks each record for the team
with it (`entryFor`) and the SQL masks it for the viewer before filtering, sorting or aggregating.

**Delivered between timed calls, incrementally, indexed.** At each round boundary, the turns settled in the
round before are sent to every live program process as one small delta (`{op: "ledger", entries}`),
before that round's calls; the runner appends them to its HISTORY, which keeps its indexes (by round, bee,
flower, pair and fed) and per-pair running sums up to date as it goes. A new or respawned process gets the
whole history in its setup. So:
- A flower's CPU clock starts after the delta is applied (in its own forked child, or around its own vm
  run), and a bee's 50 ms start only once its process has the delta (`proc.synced`). A growing history
  never costs a program time or energy; *querying* it does, and typical queries take microseconds.
- Python programs fork per call, so the runner's parent holds HISTORY and every child inherits it, already
  indexed, at no cost. The parent `gc.freeze()`s after each delta so a child's garbage collector never
  walks (and copy-on-write faults) it.
- TypeScript programs run in a fresh vm context per call, so HISTORY lives in a separate **history realm**
  (the generated client, run there), and every call gets the same read-only object. Objects from another
  realm can reach that realm's built-ins, so the history realm is locked down: every reachable built-in is
  frozen and its function constructors throw, so nothing a program does to HISTORY (or to anything it can
  reach from it) survives the call.

**Nobody learns the counterpart of a turn until it is over.** A round's turns reach the programs together,
after the round. While a flower answers it isn't told whose bee asked; while a bee decides it isn't told
whose flower answered, nor the percent, E or the nectar. What either side can *infer* is fair game: a
challenge or response can be a signature, and HISTORY shows which bees are sitting out a feed, so with
few teams a flower can sometimes narrow down who is asking.

## Every call runs fresh; a bee has MEMORY

Flowers and bees alike are stateless: each call runs the program from the top in a fresh process (Python,
forked from the runner) or a fresh vm context (TypeScript), so no global, cache or thread survives a call.
The one exception is a bee's **MEMORY**, a JSON value the engine keeps for it:
- Every bee call gets the saved MEMORY (`{}` to start); when `first()` or `decide()` returns normally, the
  runner sends MEMORY back and the engine saves it, measured as canonical JSON (sorted keys, no spaces), if
  it is at most `budgets.bee.memory` bytes (1024 by default). Over the cap, the old MEMORY is kept and the
  error is recorded on the turn, but the decision still counts. A call that crashes saves nothing.
- A new bee version starts with `{}`. A crash, a restarted runner, or the game moving to another server
  process keeps it: MEMORY is written with the game's live state (`bee_memories`, four times a second)
  and restored on adoption.
- Only the bee writes its MEMORY: no route, view or operator tool can. The bee's team can read it during
  play (the game view, and the `teams` query entity); everyone can after the game ends. The "try" tool can
  start a local test bee from a MEMORY you give it, which never touches a game's.

Statelessness is what makes the cap mean something: a bee can't keep a lookup table in a global, and it
can't remember more than its MEMORY holds, except what it can query from HISTORY.

## No user code runs after the clock stops

A program could buy free compute by doing its work while the runner encodes its reply: a `toJSON` method, a
getter, a Proxy, or (in Python) a `dict`, `str` or `int` subclass whose hooks run during `json.dumps`. So:
- TypeScript: the reply (and a bee's MEMORY) is encoded with `JSON.stringify` inside the program's context,
  under its timeout and inside the CPU measurement; only a string crosses back.
- Python: before the timer stops, the reply (and MEMORY) is copied into plain `dict`, `list`, `str`,
  `int`, `float`, `bool` and `None` by exact type; anything else, subclasses included, is refused as not
  plain data. Encoding happens after, on objects with no user code left in them.
- Each runner is its own process group and is killed as one, and a forked Python call dies with its runner
  (`PR_SET_PDEATHSIG`), so a call that outlives its deadline can't keep computing.

## What is public

Arrivals, challenges, responses and every feed (with its percent, E, nectar and pollen) are public to
everyone as they happen, spectators included, and so is the scoreboard. That was a deliberate change from
"third-party turns are secret": any self-dealing scheme, such as a handshake between a team's own bee and
flower, has to work in plain view, where every other team can study and copy it.

Private during play: the percent and E of a turn without a feed (the flower's team), the flower's compute
time on every turn and why it failed (the flower's team), and each team's code, prints, versions, sizes,
budgets, bee timings and bee MEMORY. The secret that remains is the flower's compute time, which can't be read off a
public E without the flower's size, which stays private with its code. Everything is revealed at the end.

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
| 0 ms | The last round's turns go out to every program's HISTORY. A crashed bee's runner is restarted (its MEMORY kept); new code for a bee between turns takes over (with an empty MEMORY); a bee with nothing queued is asked `first` (at most once a round). Each bee with a challenge queued, no call in flight and no rounds left to sit out takes its turn: a flower is drawn at random, the arrival is recorded and flushed at once, both versions are pinned, and the flower is called. A bee with nothing queued loses the round. |
| 150 ms | Every response is delivered; each bee with a turn is called: `decide(challenge, response)`, with its MEMORY. |
| 200 ms | Each reply is in, or its deadline has passed. Each bee's MEMORY is saved if it fits. Each turn is settled: nectar, pollen and the ledgers; the turn's end (`feed` or `leave`, carrying the whole turn) is recorded and joins the history; a feed sits the bee out `feedCost` rounds; new code for the bee takes over. |

At most one turn per bee per round: with 6 teams, at most 30 turns (60 actions) a second.

## How it runs

- `server/engine.js`: a `Garden` runs one game's rounds (above). Per bee it keeps the challenge queued for
  its next turn, whether a call is in flight, the turn in progress, rounds left to sit out, and a
  generation number so replies from a replaced or restarted process are ignored, and its MEMORY. It keeps
  every finished turn (`history`, as `turns` records) and how many of them the programs have
  (`delivered`). `paced: false` runs rounds back to
  back (tests and the "try" tool); a request outside the round flow then makes the next round if it
  answers within the bee's 50 ms.
- `server/runners/`: `proc.js` speaks JSON lines to a runner process (its own process group), one request
  at a time, in order; `sync(entries)` appends to the program's HISTORY. `py_runner.py` and `ts_runner.cjs`
  run every call fresh: flowers CPU-timed, bees with their MEMORY passed in and sent back. Both load the
  generated query client (`vendor/query/history.py`, `history.js`) for HISTORY.
- `server/live.js`: each running game's garden runs in exactly one server process, whichever holds the
  game's Postgres advisory lock; every process adopts running games nobody holds, so a game survives its
  process dying. Adoption restores the round, clock, ledgers, each bee's turn count, the rounds a bee still
  has to sit out, the history (from the stored turn ends) and each bee's MEMORY, so new processes start with
  the whole history. A hard crash loses the round in progress (its arrivals may be stored without their
  ends); a clean shutdown settles it first. Four times a second the garden's new actions, round, clock,
  ledgers and changed MEMORY are written; arrivals are written at once.
- `server/games.js`: the clock lives in the database (`games.clock_ms`, game time, which stops while
  paused). Budgets as before. The views filter every action, history record and game view for the viewer
  (`actionView`, the schema's `mask`). Queries (`POST …/query`) go to `server/query/sql.js`.
- `server/query/`: the schema (`schema.js`: entities, types, indexes, visibility), the mask for in-memory
  records (`mask.js`), and the SQL compiler (`sql.js`): parameterised SQL with each field masked for the
  viewer before WHERE, GROUP BY and ORDER BY, a statement timeout and a row cap.
- `scripts/gen-query/`: generates the typed clients in `vendor/query/` (records, an immutable builder, an
  in-memory executor with indexes, and a remote executor) from the schema. See [QUERY.md](QUERY.md).
- `server/realtime.js`, `server/sockets.js`: the per-viewer feed over SSE and WebSocket, fed by Postgres
  `LISTEN/NOTIFY`.

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly flower and a flower can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

Pollination is the rootsum of the pollen a flower kept per bee team: one term that rewards both being fed
at (no feed, no pollen) and keeping something when fed, spread over many teams' bees. (An earlier version
had separate allure (from feed counts) and surplus terms; they merged into this one, and surplus was renamed pollen.) Fitness is
N² × pollination share × forage share, so a perfectly even game scores 1 for everyone.

## Budgets

| | flower | bee |
|---|---|---|
| size | 1,100 nodes | 11,000 nodes |
| change | 220 a minute, banking a minute's worth | 2,200 a minute, banking a minute's worth |
| time | 150 ms | 50 ms |
| memory | none | 1,024 bytes of canonical JSON |

The flower keeps the cosmos's limits: small and slow to change. Its size cap is also the size cap of the
energy formula, so every node of flower code costs energy on every turn. The bee keeps room for detector
repertoires but little time per decision, so the best checks are cheap ones. All of it is configurable.

## Flowers are stateless, not pure

A flower runs fresh for every call, so nothing carries over between calls. But each call gets fresh
randomness and the clock, and can query HISTORY: it can't count visitors itself, but it can read what
HISTORY says about past turns (at the cost of the CPU time it spends querying). The engine never caches
answers.

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
- the names the game looks up (`flower`, `first`, `decide`, `GAME`, `HISTORY`, `MEMORY`)

**Change** is a weighted Zhang–Shasha tree edit distance between the program playing now and the new one.
Inserting or deleting a node costs its weight. Relabelling a literal costs the byte-level edit distance
between the old and new text; relabelling anything else costs 1. Before comparing, the new version's names
are lined up with the old version's: both are minified with every name blanked out, the two texts are
diffed, and names that fall in matching stretches are paired. So a rename, a comment or reformatting
costs nothing, and a new variable doesn't reshuffle every other name. Writing a program from nothing costs
its whole size. The editor's diff marks show the node operations, and a changed literal is marked byte by
byte.
