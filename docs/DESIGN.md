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
| (1 − percent/100) × E, to the flower's team if the bee feeds | **surplus** | a turn without a feed pays nobody |
| `feeds[b][f]`, `nectar[b][f]`, `surplus[b][f]` | **feed / nectar / surplus ledgers** | row = bee team, column = flower team |
| every finished turn, as one team may see it | **team ledger** | what the team's programs and operators get |
| Σ√xᵢ | **rootsum** | the diversity-weighted size of an earnings vector |
| rootsum of a flower's surplus column | **pollination** | how widely, and how profitably, the flower is pollinated |
| rootsum of a bee's nectar row | **forage** | how widely the bee eats |
| value ÷ Σ value over teams (1/N when Σ = 0) | **share** | par 1/N |
| N² × pollination share × forage share | **fitness** | par 1.0 for any N |

## The game in one paragraph

Every 200 ms round, each bee that isn't feeding takes one turn. Its challenge must already be queued. The
engine draws a flower uniformly at random among all N (its own included), calls it, and the flower has
150 ms to return `[response, percent]`. The runner measures the call's CPU time, which gives E. At 150 ms
the response reaches the bee, which has 50 ms to return `["feed" | "leave", next_challenge]`. A feed pays
nectar and surplus and sits the bee out `feedCost` rounds; a leave pays nobody. The bee's next challenge
is queued for its next turn.

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
the bee asked `first(ledger)` at once, outside the round flow (at most one such request in flight per bee,
at most one new one a round).

## The team ledger

Programs used to see only their own visit. Now both programs, and the team's operators, see the same
**team ledger**: every finished turn of every bee, with what the team may see of it (the public part of
every turn; the private details of turns at its own flower). It is how a bee learns which flowers paid,
and how a flower learns which bees feed.

**Delivered between timed calls, incrementally.** At each round boundary, the turns settled in the round
before are sent to every live bee and flower process as one small delta (`{op: "ledger", entries}`),
before that round's calls. A new or respawned process gets the whole ledger in its setup. So:
- A flower's CPU clock starts after the delta is applied (in its own forked child, or around its own vm
  run), and a bee's 50 ms start only once its process has the delta (`proc.synced`). A growing ledger never
  costs a program time or energy; *reading* it does.
- Python flowers fork per call, so the parent holds the ledger and every child inherits it, already
  parsed, at no cost. The parent `gc.freeze()`s after each delta so a child's garbage collector never
  walks (and copy-on-write faults) the ledger.
- TypeScript flowers run in a fresh vm context per call, so the ledger lives, parsed and deep-frozen, in a
  separate **ledger realm**; each call gets a frozen snapshot array (rebuilt only when the ledger grew).
  Objects from another realm can reach that realm's built-ins, so the ledger realm is locked down: every
  reachable built-in is frozen and its function constructors throw, so nothing a flower does to the ledger
  (or to anything it can reach from it) survives the call. Statelessness holds.
- A bee keeps the ledger in its own process or context and gets the same list object each call, so it can
  remember how far it has read (`ledger[done:]`).

**Nobody learns the counterpart of a turn until it is over.** A round's turns reach the programs together,
after the round. While a flower answers it isn't told whose bee asked; while a bee decides it isn't told
whose flower answered, nor the percent, E or the nectar. What either side can *infer* is fair game: a
challenge or response can be a signature, and the ledger shows which bees are sitting out a feed, so with
few teams a flower can sometimes narrow down who is asking.

## What is public

Arrivals, challenges, responses and every feed (with its percent, E, nectar and surplus) are public to
everyone as they happen, spectators included, and so is the scoreboard. That was a deliberate change from
"third-party turns are secret": any self-dealing scheme, such as a handshake between a team's own bee and
flower, has to work in plain view, where every other team can study and copy it.

Private during play: the percent and E of a turn without a feed (the flower's team), the flower's compute
time on every turn and why it failed (the flower's team), and each team's code, prints, versions, sizes,
budgets and bee timings. The secret that remains is the flower's compute time, which can't be read off a
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
| 0 ms | The last round's turns go out to every program's ledger. A crashed bee starts afresh; new code for a bee between turns takes over; a bee with nothing queued is asked `first` (at most once a round). Each bee with a challenge queued, no call in flight and no rounds left to sit out takes its turn: a flower is drawn at random, the arrival is recorded and flushed at once, both versions are pinned, and the flower is called. A bee with nothing queued loses the round. |
| 150 ms | Every response is delivered; each bee with a turn is called: `decide(challenge, response, ledger)`. |
| 200 ms | Each reply is in, or its deadline has passed. Each turn is settled: nectar, surplus and the ledgers; the turn's end (`feed` or `leave`, carrying the whole turn) is recorded; a feed sits the bee out `feedCost` rounds; new code for the bee takes over. |

At most one turn per bee per round: with 6 teams, at most 30 turns (60 actions) a second.

## How it runs

- `server/engine.js`: a `Garden` runs one game's rounds (above). Per bee it keeps the challenge queued for
  its next turn, whether a call is in flight, the turn in progress, rounds left to sit out, and a
  generation number so replies from a replaced or restarted process are ignored. It keeps every finished
  turn (`history`) and how many of them the programs have (`delivered`). `paced: false` runs rounds back to
  back (tests and the "try" tool); a request outside the round flow then makes the next round if it
  answers within the bee's 50 ms.
- `server/runners/`: `proc.js` speaks JSON lines to a runner process, one request at a time, in order;
  `sync(entries)` appends to the program's ledger. `py_runner.py` and `ts_runner.cjs` run flowers (stateless,
  CPU-timed) and bees (stateful).
- `server/live.js`: each running game's garden runs in exactly one server process, whichever holds the
  game's Postgres advisory lock; every process adopts running games nobody holds, so a game survives its
  process dying. Adoption restores the round, clock, ledgers, each bee's turn count, the rounds a bee still
  has to sit out, and the team ledgers (from the stored turn ends), so new processes start with the whole
  ledger. A hard crash loses the round in progress (its arrivals may be stored without their ends); a clean
  shutdown settles it first. Four times a second the garden's new actions, round, clock and ledgers are
  written; arrivals are written at once.
- `server/games.js`: the clock lives in the database (`games.clock_ms`, game time, which stops while
  paused). Budgets as before. The views filter every action, ledger entry and game view for the viewer
  (`actionView`, `ledgerEntry`).
- `server/realtime.js`, `server/sockets.js`: the per-viewer feed over SSE and WebSocket, fed by Postgres
  `LISTEN/NOTIFY`.

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly flower and a flower can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

Pollination is the rootsum of the surplus a flower kept per bee team: one term that rewards both being fed
at (no feed, no surplus) and keeping something when fed, spread over many teams' bees. (An earlier version
had separate allure, from feed counts, and surplus terms; they merged into this one.) Fitness is
N² × pollination share × forage share, so a perfectly even game scores 1 for everyone.

## Budgets

| | flower | bee |
|---|---|---|
| size | 1,100 nodes | 11,000 nodes |
| change | 220 a minute, banking a minute's worth | 2,200 a minute, banking a minute's worth |
| time | 150 ms | 50 ms |

The flower keeps the cosmos's limits: small and slow to change. Its size cap is also the size cap of the
energy formula, so every node of flower code costs energy on every turn. The bee keeps room for detector
repertoires but little time per decision, so the best checks are cheap ones. All of it is configurable.

## Flowers are stateless, not pure

A flower runs fresh for every call, so nothing carries over between calls. But each call gets fresh
randomness and the clock, and can read the team ledger: it can't count visitors itself, but it can read
what the ledger says about past turns (at the cost of the CPU time it spends reading). The engine never
caches answers.

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
- the names the game looks up (`flower`, `first`, `decide`, `GAME`)

**Change** is a weighted Zhang–Shasha tree edit distance between the program playing now and the new one.
Inserting or deleting a node costs its weight. Relabelling a literal costs the byte-level edit distance
between the old and new text; relabelling anything else costs 1. Before comparing, the new version's names
are lined up with the old version's: both are minified with every name blanked out, the two texts are
diffed, and names that fall in matching stretches are paired. So a rename, a comment or reformatting
costs nothing, and a new variable doesn't reshuffle every other name. Writing a program from nothing costs
its whole size. The editor's diff marks show the node operations, and a changed literal is marked byte by
byte.
