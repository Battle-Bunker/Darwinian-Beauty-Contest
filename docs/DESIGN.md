# Design notes

## Names

| Thing | Name | Why |
|---|---|---|
| rewarding flower program | **cosmos** (plural: cosmos) | The garden cosmos (*Cosmos bipinnatus* and its relatives) is an honest, generous flower: widely grown, in pink, white, crimson and magenta (orange and yellow in the sulphur cosmos), with open, daisy-like flowers that give bees real nectar and pollen |
| deceptive flower program | **orchid** | The bee orchid (*Ophrys apifera*) is the archetypal deceiver: it offers nothing and looks like something it isn't |
| bee program | **bee** | |
| a team's two flowers | **patch** | Bees never learn which patch a flower is in, or which of the two it is |
| `feeds[s][o]` | **feed ledger** | times bee *s* fed at patch *o* (cosmos or orchid) |
| `nectar[s][o]` | **nectar ledger** | nectar bee *s* got from patch *o* |
| Σ√xᵢ | **rootsum** | the diversity-weighted size of an earnings vector |
| rootsum of a patch's feed column | **allure** | how widely a patch gets pollinated |
| rootsum of a bee's nectar row | **forage** | how widely a bee finds real food |
| allure ÷ Σ allure | **allure share** | par 1/N |
| forage ÷ Σ forage | **forage share** | par 1/N |
| N² × allure share × forage share | **fitness** | par 1.0 for any N; "relative fitness" is the population-genetics term, and 1 means holding steady |

Short version for players: *"Fitness = allure × forage, each measured as your share of the garden, scaled so
that average is 1."*

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly patch and a patch can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

## One continuous garden

The round-based design (on the `claude/darwinian-beauty-contest-6c3cia` branch; arena/REPORT.md §1–19)
tried to force bees and flowers to be unpredictable by making them take turns to change: bees, then
orchids, then cosmos flowers, so each kind could react while the others stood still. It failed for a simple
reason: **a locked program isn't locked behaviour**. A bee that can tell rounds apart (its per-round
random seed, or how much memory it has) asks a brand-new secret question every round with no code change,
tastes each flower's answer to it once, and remembers which answers paid. The orchids' turn to copy came
too late every time (REPORT.md §19).

So this design drops rounds altogether:
- **One stream.** The bees forage for the whole game (2 minutes by default) in lockstep rounds of 200 ms
  of game time, one action slot per bee per round (see "Lockstep rounds" below); a bee that feeds has no
  slot for the next 10 rounds. A bee is one long-running program; it keeps its state until its team
  replaces it.
- **Behaviour public at once, changes private.** Every ask, answer, feed and error is public the moment it
  happens, with whose bee and whose patch (but not which of the patch's two flowers: see below). Code,
  what bees print, and each team's code changes and change budgets stay secret during play; once the game is over the replay shows every change and budget (and the code, unless the owner
  turns that off). Other teams have to read a change from behaviour, not from a changelog.
- **Change at any time, paid from a budget that refills.** Each program earns change budget per minute of
  game time, up to a cap of one minute's worth, and any change it can afford goes live at once. Over a
  default 2-minute game that's as much change as the round-based design allowed in six rounds (a cosmos or
  bee 40% of a full-size program, an orchid 140%). The rates keep the asymmetry: orchids earn 7× a
  cosmos's rate, so they can chase whatever bees trust; cosmos flowers change slowly. Writing programs in the
  lobby is free.

What this changes, and what it doesn't:
- Information no longer comes in batches. An orchid's team sees a cosmos's answer, and the question a bee
  asked to get it, the moment it's given, and can aim its orchid at it as soon as it can afford the change.
  Reaction speed (of the people or agents, and of the budget) now matters.
- A bee can still rotate a secret question as often as it likes, for free: rotating is behaviour, not a
  code change. What it can't hide any more is the question itself (it's public as soon as it's asked) or
  the answers it learned to trust. Whether that's enough for orchids to catch up depends on how fast they
  can react, which is what the games will show.
- Cosmos flowers still have their costly signal: the whole 150 ms flower window on every answer, against an
  orchid's 100 ms.

### Lockstep rounds: why timing is equalised

An earlier version let the bees take turns as fast as the programs ran, and recorded every flower's answer
time in the public stream. That made time itself a detector: an orchid has less compute than a cosmos, so
an orchid that saves time answers sooner, and a bee (or a team reading the stream) could tell the kinds
apart by the clock rather than by the answers. The game is meant to be about what flowers *say*, so the
timing is now equalised:
- **Rounds are fixed 200 ms slots, every bee in step**: a 150 ms flower window (a cosmos's whole time
  limit) and a 50 ms decision window. Game time is rounds × 200 ms, so it's the same for every bee
  however busy the machine is; live games pace rounds to real time.
- **Every answer is delivered at 150 ms.** A cosmos gets the whole window; an orchid has a shorter limit
  (100 ms by default, public, so an orchid can time an anytime search to finish just before it), but its
  answer still reaches the bee at 150 ms. The bee is only called in the decision window, after every
  flower in the round is done, so the clock inside a bee can't tell a fast answer from a slow one.
- **Measured times are private during play.** Each answer's `ms` and each decision's `beeMs` are their
  own team's until the game is over, so the public stream doesn't leak what the bee can't see.
- **Queued challenges are secret.** A bee's next action is decided a round ahead and queued; nothing about
  a queued challenge is recorded or shown until it is asked. In particular `["leave", c]` (move on and ask
  `c` first at the next flower) publishes the leave at once but not `c`, so nobody can prepare for a
  question before it reaches a flower.
- **A late bee loses a slot, not its say.** 50 ms is a deadline, not an interruption: the call runs on (up
  to 2 s), the round moves on, the bee loses its next slot and its visit ends. A late `["leave", c]` still
  queues `c`; any other late reply (an ask or a feed for the abandoned visit, a plain leave, an error)
  doesn't give a next challenge, so the engine asks again at once, outside the round flow, for the first
  challenge at the next flower. Any reply that gives no next challenge is handled the same way. The 50 ms
  are counted from when the call gets a core of its own, and a late bee keeps its core until it replies, so
  the machine is never oversubscribed and every flower's limit stays fair; slowness only stretches wall
  time.

### Which flower: secret during play

During play the public record names the patch a bee asked at, never which of its two flowers: an
action's `kind` is the patch's own team's until the game is over. What people and programs watching
the game can see is the same either way. Teams can still mine a rival patch's answers knowing they
come from one of that team's two flowers, and a feed still says whether it paid, which gives away
that one visit's flower. But a bee never knows whose patch it is in, so the public record can't hand
it a ready-made label ("this answer is Bo's cosmos's") to match against. A team has to teach its bee
signals that work without knowing which patch, or which flower, it is looking at.

### Flowers are drawn at random, not dealt

Every new visit is at a flower picked uniformly at random from the whole garden, independently of the
last. An earlier version dealt each bee its flowers from a shuffled deck, every flower once per lap.
That was fair, but it leaked: visit numbers are public, so the two visits a bee made to a patch within a
lap were known to be one cosmos and one orchid, and a single feed's nectar labelled the other visit too.
And bees used the deck as a clock: counting visits told a bee where it was in the lap and so what it
still had to meet (once it had recognised every cosmos in a lap, the rest had to be orchids). A
random draw has no laps to count. Over a game every flower still comes up about equally often.

### Each round, in the engine

| Game time | What happens |
|---|---|
| 0 ms | Round boundary: a new bee takes over (its visit ends, its queued action is dropped, and it's asked for its first challenge at once); a crashed one starts afresh. Then every bee with an action queued and not feeding acts: asks go to their flowers (a fresh process run per ask), feeds go in the ledgers. A bee with nothing queued loses the slot. |
| 150 ms | Answers are delivered. Each bee that acted is called: `forage(seen, visit)`, after a feed `tasted` then `forage` in the same call. Leaves and errors are recorded at this time. |
| 200 ms | Each reply is in, or its deadline has passed. The next round starts. |

At most one ask or feed per bee per round: with 6 teams, at most 30 actions a second.

### How it runs

- `server/engine.js`: a `Garden` runs one game's rounds (above). Per bee it keeps the action queued for its
  next slot, whether a call is in flight, which visit the runner's `seen` belongs to (a request with
  `new: true` empties it; the first decision at a new flower only empties it if the bee got there by
  `["leave", c]`), and a generation number so replies from a replaced or restarted process are ignored.
  Re-requests are throttled: at most one in flight per bee, and at most one new one a round. Programs can
  be swapped at any moment: a flower's next ask uses the new code; a bee swaps at the next round boundary.
  Answers are labelled with the version that gave them. `paced: false` runs rounds back to back (tests
  and the "try a bee" tool); a request outside the round flow then makes the next round if it answers
  within the bee's 50 ms.
- `server/live.js`: each running game's garden runs in exactly one server process, whichever holds the
  game's Postgres advisory lock; every process adopts running games nobody holds, so a game survives its
  process dying (its bees start afresh, from the stored round). Four times a second it writes the new
  actions, the round, the clock and the ledgers, and notifies listeners. Submissions, pauses and finishes
  are written by whichever process got the request; the notification brings them to the garden. A pause
  takes effect at the end of the round in progress.
- `server/games.js`: the clock lives in the database (`games.clock_ms`, game time, which stops while
  paused). A team's budget for a program is `min(cap, bank + perMinute × (clock − atMs))`; a submission
  pays its node-edit distance from the version playing now, inside the same transaction that writes the
  version, so two submissions can't spend the same budget.
- Viewers get the actions over Server-Sent Events, or page through them with `GET .../actions`.

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly patch and a patch can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

## Should a bee ever skip its own cosmos?

No. A bee meets its own flowers only as often as the random draw picks them (2 in 2N visits on average,
like any other patch), so self-dealing is capped by the draw, and it earns one rootsum term on each side,
with diminishing returns.

What it does leak now is its question. Everything is public, so a bee that recognises its own cosmos by
asking a secret question shows that question to everyone, along with the answer its patch gave. The answer to
a *new* secret question is still unforgeable if the cosmos answers with a keyed hash, but every orchid
team can see which questions the bee keeps asking and which answers it feeds on.

## Asymmetric budgets and fair compute

| Budget (orchid = reference) | Why |
|---|---|
| **cosmos**: ½ size, the whole 150 ms flower window (1.5× an orchid's time), a seventh of the orchid's change rate | **Costly signalling**: a cosmos can spend effort an orchid can't afford on every answer, such as a bigger, harder instance of its pattern. It changes slowly, so it can't simply out-run imitators. |
| **orchid**: the reference; 7× a cosmos's change rate | Orchids answer with more code and faster adaptation: more efficient generators, shallower look-alikes, re-aimed at whatever bees trust. |
| **bee**: 5× size, 50 ms per decision | Room for detector repertoires but little time per decision, so the winning signals are *hard to make, easy to check*. |

**Fair compute**: the engine runs at most one program per CPU core, across every game in the process, and
keeps a small pool of processes per flower. When compute is the signal, a busy machine mustn't make a
cosmos time out. Wall-clock limits with one program per core behave like CPU limits (CPU-time interval
timers fire late on tickless kernels). Since game time is counted in rounds, a machine with fewer cores
than a round needs only makes rounds take longer in wall time; every program still gets its full time.

## Flowers are stateless, not pure

A flower runs fresh for every call, so nothing carries over between questions. But each call gets fresh
randomness and the clock (`time`, `Date.now()`) and can read its own budget as `GAME.ms`. A cosmos can run
an anytime search, such as a local search for a big clique, and answer with the best result it found
within 150 ms; an orchid has 100 ms to fake one. Bees can then judge how good an answer is, not just whether
they have seen it before. The engine never caches answers, so every ask runs the flower again.

Nothing forces a flower to use randomness: a deterministic cosmos can still be fingerprinted by repeating
a question.

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
- the names the game looks up (`flower`, `forage`, `tasted`, `GAME`)

**Change** is a weighted Zhang–Shasha tree edit distance between the program playing now and the new one.
Inserting or deleting a node costs its weight. Relabelling a literal costs the byte-level edit distance
between the old and new text; relabelling anything else costs 1. Before comparing, the new version's names
are lined up with the old version's: both are minified with every name blanked out, the two texts are
diffed, and names that fall in matching stretches are paired. So a rename, a comment or reformatting
costs nothing, and a new variable doesn't reshuffle every other name. Writing a program from nothing costs
its whole size. The editor's diff marks show the node operations, and a changed literal is marked byte by
byte.
