# Darwinian Beauty Contest: one flower

Real flowers and bees are locked in an arms race. A flower wants a bee to carry its pollen to other
flowers of its species, and pays for the visit with nectar. A bee wants the nectar. Each side would like
to know who it is dealing with, and neither is told until it's too late to matter.

Your team writes **two programs**:

| Program | What it does |
|---|---|
| **flower** | your team's **flower species**. Every turn, a bee meets one flower of some team's species: it answers the bee's challenge, and says how this turn's spare energy is split, if the bee feeds, between nectar for the bee and pollen for it to carry |
| **bee** | asks flowers challenges, and after each answer decides whether to feed |

## The game

A game is one continuous stretch of play, 2 minutes of game time by default (the room owner sets it).

1. **The lobby.** Teams join and write their programs. Writing is free here, within the size limits. A
   team needs both programs to take part, and a game needs at least 2 such teams.
2. **The garden.** The owner starts the game. From then on the bees forage without pause, round after
   round, and every team can change either program at any moment, paying from a change budget that
   refills as the game goes on (see "Changing your programs").
3. **The end.** When the clock runs out the game is over and everything is revealed. The owner can also
   pause the game (the clock and the budgets stand still) or end it early.

### Rounds

The game runs in **rounds** of **200 ms** of game time: a **150 ms flower window**, then a **50 ms
decision window**. A 2-minute game is 600 rounds. Rounds are played in real time; if the server is
short of CPU cores a round takes longer on the wall clock. The round's pacing changes nothing in the game:
every time limit is **CPU time**, the time your program spends computing (see "Time limits are CPU time").

## A turn

Every bee that isn't busy feeding gets **one turn per round**: one challenge, one response, one decision.

1. **0 ms.** Your bee's challenge must already be **queued** (it came with its previous decision, or from
   `first`). A bee with nothing queued as the round starts **loses its turn** this round.
2. The engine draws a flower **uniformly at random from all N flowers**, your own included, independently
   every time. This **arrival** (whose bee, whose flower) is public at once to people watching the game,
   but neither program is told: a turn keeps the versions it started with, so nobody can pass it on.
3. The flower is called: `flower(challenge)`. It has its **hidden time budget R** for this call (3 to 150
   ms, drawn at random every call; see "Energy") and returns
   `[response, percent]`: its answer, and the share (0–100, clamped) of this turn's **excess energy** it
   gives the bee if the bee feeds. A late answer (over R of CPU time), an error, or a malformed
   return (not a pair, a response of the wrong type, a percent that isn't a number) gives a `null` response
   and no energy.
4. **150 ms.** The response is delivered to the bee, always at 150 ms however fast the flower was, so
   timing tells the bee nothing. The bee has **50 ms** of CPU time: `decide(challenge, response)` returns
   `["feed", next_challenge]` or `["leave", next_challenge]`. The next challenge is queued for its next
   turn. **The bee is never told which team's flower it is facing**, and no program sees any history:
   it decides whether to feed from the challenge and the response alone (and its `MEMORY`). A flower's
   reputation can only be carried by what its responses look like, never by who it is.
5. **The turn is settled** (see "Energy: compute, nectar and pollen"). If the bee fed, it sits out the next
   **20 rounds** (`feed_cost`; the owner can change it), then plays again with the challenge it queued.
   If it fed and its program defines `fed`, the engine then calls `fed(nectar)` in the same program
   instance that made the decision. `fed` may return a next challenge, which replaces the one `decide`
   queued (see "After a feed").

**Late replies.** A bee that uses more than 50 ms of CPU time isn't cut off: its call keeps running (up to
2 s of CPU time, when it is stopped), but the turn is settled without it. **A late reply never feeds.** If the late reply is
`["leave", c]`, then `c` is queued for the bee's next turn. Anything else (a late `["feed", c]`, a crash)
gives no next challenge, so the engine at once calls `first()` for one. The bee can't play while
a call is running, so a slow bee also loses turns.

**No next challenge.** A reply in time that gives no usable next challenge (a bare `"feed"` or `"leave"`,
a challenge of the wrong type or size) still counts as a feed or a leave; then, as above, `first` is
called at once (after a feed, once `fed` is done, if it returned no challenge either). A crash or a reply
of any other shape counts as a leave. While replies keep giving no challenge, `first` is called again at
most once a round. A quick answer makes the next round.

**Every call runs fresh.** Each turn your bee meets a different flower of a species, and every flower of
a species is independent of the others: so your flower program runs fresh for every call, and nothing it
does survives to the next call. Your bee runs fresh for every turn too, with two exceptions: **`MEMORY`**,
a tiny store that carries over from call to call (see "Bee memory"), and **`fed`**, which runs in the
same program instance as the feed decision before it (see "After a feed"). Programs see only their
arguments, `GAME` and (the bee) `MEMORY`: no history, no other team's anything. Both can use randomness
(freshly seeded every call) and the clock, which only tells how long the call has been running (see "The
clock").

### The clock

Programs can time their own work, but nothing tells them what time it is, what round it is, or how far
the game has got. **Every call starts at time zero**: for each call (`flower`, `first`, `decide`, `fed`),
the clock reads 0 when the call's time starts, as if it were 1970-01-01 00:00:00 UTC, and then runs at real
speed, in fine steps.

- **Python**: `time.time()`, `time.time_ns()`, `time.monotonic()`, `time.perf_counter()` (and their `_ns`
  forms) and `time.clock_gettime(...)` give the time since the call started (`time.time()` → `0.0123`).
  `time.process_time()` and `time.thread_time()` give this call's CPU time. `time.localtime()`,
  `time.gmtime()`, `time.ctime()`, `time.asctime()` and `time.strftime(fmt)` without a time use that clock
  (`1970-01-01 00:00:00` and a fraction). `time.sleep()` returns at once (see "Time limits are CPU time").
- **TypeScript**: `Date.now()`, `new Date()` and `Date()` without arguments, and `Intl` formatting
  without a date, use the same clock (`Date.now()` → `12`). `performance.now()` gives the time since the
  call started in fractions of a millisecond; `performance.timeOrigin` is 0. `performance.cpuTime()`
  gives this call's CPU time in milliseconds. `Atomics.wait` returns at once.

### Time limits are CPU time

Every limit counts **CPU time**: the time your call spends computing, on its own clock, which starts at 0
with the call (`time.process_time()` in Python, `performance.cpuTime()` in TypeScript). A busy server
makes a call take longer on the wall clock, but not longer in CPU time, so it can't make a program late.
Budget with the CPU clock, not the wall clock.

- **A flower** is stopped when it has used R of CPU time (see "Energy"), and it is late if its CPU time,
  writing the response as JSON included, is over R.
- **A bee's `decide`** is in time if it used at most 50 ms of CPU time; past 2 s of CPU time it is
  stopped. **`first`** is stopped at 2 s, and **`fed`** at 50 ms.
- **Waiting earns nothing.** `time.sleep()` and `Atomics.wait` return at once.
- **A wall-clock backstop** stops a call that isn't computing: a flower still running after 400 ms of wall
  time, and `fed` after 250 ms. A `decide` with no reply after 250 ms of wall time is judged then, and
  `first` and `decide` are stopped after 4 s.
- **If the server is at fault, the turn is void.** A call stopped or judged by the backstop that spent at
  least half its wall time waiting for a CPU (not running, but ready to run) is the server's fault, not your
  program's. Its turn is void: nothing is given, the turn shows as a leave with the reason, nobody is charged
  for it, and the bee asks the same challenge again. Otherwise the call is late.

`GAME` holds the game's settings only: no round, turn or game time. A bee can count its own turns in
`MEMORY`: that is its own experience, not the world's clock.

### After a feed: `fed(nectar)`

`fed` is optional. When your bee's `decide` returns a feed in time, and its program defines `fed`, the
engine calls `fed(nectar)` once the turn is settled, **in the same program instance that made the
decision**: the same process (Python) or context (TypeScript), with every global and everything
`decide` computed still there. `nectar` is the nectar the bee just got (percent/100 × E; 0 if the flower
failed).

- It has **50 ms** of CPU time (`GAME["ms"]`), and that is a hard limit: at 50 ms it is stopped. What it prints shows
  up with your bee's next turn.
- **It may return the next challenge.** The challenge `decide` queued is the default: your bee plays it
  at its next turn unless `fed` returns a challenge of the game's type, within its limits, which replaces
  it. So `decide`'s stays if your bee has no `fed`, or `fed` returns `None` (`null` or `undefined` in
  TypeScript) or nothing, crashes, or is stopped. Anything else it returns keeps `decide`'s too, and the
  error is shown to your team. (With `feed_cost` 0 the next turn can start before a slow `fed` is done:
  that turn plays `decide`'s challenge, and `fed`'s is dropped.)
- After it returns, `MEMORY` is saved (as after `decide`); then the instance is gone. A `fed` that
  crashes or is stopped saves nothing (`MEMORY` stays as saved after `decide`, and `decide`'s challenge
  stays queued) and the error is shown to your team.
- It runs while your bee sits out its feed, so it never costs a turn.
- It is not called after a leave, a late or failed reply, or when a new version of your bee takes over as
  that turn ends.

### Bee memory

`MEMORY` is a global in your bee's program: a small **key–value store**, `{}` (an empty dict / object) to
begin with. Keys are strings; values are strings, numbers, `true`/`false` or `null` (`None`), nothing
nested. Change it in place (`MEMORY["n"] = 3`, `MEMORY.n = 3`, `del MEMORY["n"]`), or assign a new dict /
object to it (in Python inside a function, after `global MEMORY`). After every call of `first`, `decide`
or `fed` that returns, the game saves it, and your bee's next call starts with what was saved. Nothing
else carries over from one turn to the next.

**Its size** is the sum over its entries of the key's length in UTF-8 bytes plus the length of the value
written as JSON (no spaces). It may be at most `GAME["memory"]` bytes: **50** by default.

| `MEMORY` | size |
|---|---|
| `{}` | 0 |
| `{"n": 7}` | 1 + 1 = 2 |
| `{"n": -12}` | 1 + 3 = 4 |
| `{"p": 0.25}` | 1 + 4 = 5 |
| `{"ok": true}` | 2 + 4 = 6 |
| `{"x": null}` | 1 + 4 = 5 |
| `{"best": "a7"}` | 4 + 4 = 8 (a string's JSON includes its quotes) |
| `{"q": "say \"hi\""}` | 1 + 12 = 13 (`"say \"hi\""` is 12 bytes: quotes and backslashes count) |
| `{"é": 1}` | 2 + 1 = 3 (`é` is 2 bytes in UTF-8) |
| `{"n": 7, "best": "a7", "ok": true}` | 2 + 8 + 6 = 16 |

- Numbers are JSON numbers: finite, and an integer must be within ±9,007,199,254,740,991. `2.0` comes
  back as `2`.
- **A memory over the cap, or of the wrong shape, isn't saved**: the old one is kept and the error is shown
  to your team (on the turn, for `decide`). The decision still counts. A call that crashes (or is stopped)
  saves nothing.
- **A late reply's memory is saved** when it arrives, like its `["leave", c]`.
- **A new version of your bee starts with an empty memory** (`{}`), from its first turn. A crash or a
  restart of the server doesn't clear it.
- **Only your bee writes it.** Nobody else, your own team included, can change it. Your team can read it
  during play (its value, size, cap and last error); everyone can once the game is over.

Your program's top-level code runs at the start of every call, so don't assign `MEMORY` there (that would
reset it every call): change it inside `first`, `decide` and `fed`.

## Energy: compute, nectar and pollen

A flower allocates its energy between three things:
- **compute**: the CPU time it spends answering (and its size and the bytes of its answer, which shrink the
  whole budget);
- **nectar**: what it gives a bee that feeds, for the bee to eat;
- **pollen**: what else it gives a bee that feeds, for the bee to carry to other flowers of its species.

The bee wants nectar. The flower wants to give as much pollen as it can: pollen is what it scores on.

Each turn, the energy left after compute is the flower's **excess energy**, in node·ms·bytes:

> **E = (flower size cap − your flower's size) × max(0, R − compute ms) × (byte cap − response bytes)**

- **size** is the size in nodes of the flower version that answered (see "What counts toward size"); the
  cap is 1,100. A smaller flower has more to give.
- **R** is **this call's hidden time budget**: a number of milliseconds of CPU time drawn fresh and
  uniformly at random from 3 to 150 for every flower call, independently. It is this call's time limit:
  when the call has used R of CPU time, counted from its start (when the call's clocks read 0; see "The
  clock"), the flower is stopped. It is also the ceiling the energy counts down from. **Your flower is told
  its R as `GAME["ms"]`** for that call (`GAME["flower_ms"]` stays 150, the most R can be). The bee is never
  told R, and the response still reaches it at the fixed 150 ms, so timing hides R.
- **compute ms** is the **CPU time** your flower used for this call: running the program, calling
  `flower`, and writing its response as JSON. It is the same clock R counts, so a call over R has no
  energy left. Time your flower spends not computing (held up while the server runs other programs)
  counts for neither.
- **response bytes** is the size of the response: the UTF-8 bytes of its JSON as the game writes it (see
  "What the challenge and response look like"). The **byte cap** is the most a response may be: 1,024
  bytes. An answer of 24 bytes multiplies by 1,000; one of exactly 1,024 bytes is still an answer, and a
  bee can feed on it, but E = 0. A 550-node flower with 50 ms of compute and a 24-byte answer, at R = 150,
  has E = 550 × 100 × 1,000 = 55,000,000.
- A late answer (over R of CPU time), an error, a malformed return or a response over the cap: E = 0.

Code nodes, compute milliseconds and response bytes are each free only when you don't use them. (Games
played before the byte factor had E without it, in node·ms, and a 64 KiB cap.)

So a given stretch of real work costs the same energy whatever R is, but you can only *do* t ms of
checkable work, and still have energy left, when R happens to be more than t this turn. Each flower instance has its own hidden reserve for the turn — its R — and the bee
has to judge from the answer alone whether this one is rich and generous.

Then:
- **If the bee feeds:** the flower gives the bee **nectar = percent/100 × E** and **pollen =
  (1 − percent/100) × E**.
- **If it doesn't** (it leaves, it's late, it crashes): the flower gives nothing. That turn's energy is
  lost.

So a flower gives away pollen only when bees feed at it.

### Pollen carries genes

On every feed, after the turn is settled, the bee's team gets a **pollen grain**: a piece of the flower's
code. It is a run of **L = ⌊0.1 × pollen^(1/3)⌋** characters (pollen in node·ms·bytes: 27,000,000 pollen
gives 30 characters; no pollen, no grain; the 0.1 keeps grains about as long as before E was counted in
bytes too) taken from the **minified code of the flower version that answered**,
starting at a position drawn uniformly at random, and wrapping from the end back to the start, so every
character is equally likely to leak. If L is at least the code's length, the grain is the whole code.

- With the grain come the flower's **version** and its code's **length** in characters (the minified code
  your size is measured on), but not where the grain starts.
- **During play, only the feeding bee's team** sees its grains (on its feed actions, in its ledger and in
  its queries). When the game ends, everyone sees every grain. (The owner can make grains public as they
  happen, or switch them off: `grains` in the settings.)
- **Programs never get grains**: `fed` gets the nectar only.

## History is for teams, not programs

No program sees any history: a flower gets its challenge and `GAME`; a bee gets its arguments, `GAME`
and its `MEMORY`. Your **team** can study every finished turn (what your team may see of it) over the API,
with typed query clients for Python and TypeScript (docs/QUERY.md), and change its programs at any time.

## The programs

### Python

```python
# flower: runs fresh for every turn at your flower.
def flower(challenge):
    # challenge: a value of the game's challenge type
    # GAME["team"], GAME["size"], GAME["flower_size_cap"], GAME["flower_ms"], ... (see below)
    return challenge, 50            # (response, percent): your answer, and 0-100% of E if the bee feeds
```

```python
# bee: runs fresh for every turn; only MEMORY carries over (see "Bee memory").
import random

def first():
    # called when your bee needs a challenge and has none queued (it starts, or its last reply gave none)
    return random.randint(0, 9)     # the challenge for its next turn

def decide(challenge, response):
    # challenge: what your bee asked this turn; response: the flower's answer (None if it failed)
    # MEMORY: what your bee saved last time ({} at first); GAME: as for a flower
    return "leave", random.randint(0, 9)    # ("feed" or "leave", the challenge for its next turn)

def fed(nectar):
    # optional: after a feed decided in time, in the same instance as that decide (its globals intact)
    return None                     # or a challenge, played next instead of decide's; MEMORY is saved afterwards
```

### TypeScript

```ts
function flower(challenge: number): [number, number] {
  return [challenge, 50];                           // [response, percent]
}

function first(): number {
  return Math.floor(Math.random() * 10);            // the challenge for the bee's next turn
}

function decide(challenge: number, response: number | null): ["feed" | "leave", number] {
  return ["leave", Math.floor(Math.random() * 10)]; // ["feed" | "leave", next challenge]
}

function fed(nectar: number): number | void {}      // optional, as in Python: may return the next challenge
```

In TypeScript, `tree[T]` is `{ value: T; children: Tree<T>[] }` and a graph is
`{ nodes: number; edges: [number, number][] }`; `MEMORY` is a
`Record<string, string | number | boolean | null>`.

Every program can read a `GAME` dictionary/object: `team` (your team's index), `teams` (N), `feed_cost`,
`challenge_type`, `response_type`, `max_len`, `max_nodes` (limits on challenges), `max_response_bytes`
(the response size cap), `round_ms` (200), `ms` (your program's own time limit for **this call**, in ms of
CPU time: a bee's is always 50; a flower's is this call's hidden budget R, 3–150), `flower_ms` (150, the
most a flower's R can be) and `flower_size_cap` (1,100). A bee also gets `memory`, its `MEMORY` cap in bytes.
A flower also gets `size`, its own size, so E = (`flower_size_cap` − `size`) × max(0, `ms` − compute ms) ×
(`max_response_bytes` − response bytes), with `ms` this call's R. `time.process_time()` (Python) and
`performance.cpuTime()` (TypeScript) measure the CPU time that both the limit and the energy count, from 0
at the start of the call; `time.perf_counter()` and `performance.now()` are wall time (see "The clock").

## What programs can use

So that nothing anchors a program to the real world or the game's progress, the Python side is a little
narrowed (a best effort, not a real sandbox):

- **Imports.** Python programs may import only `math`, `cmath`, `random`, `hashlib`, `string`, `itertools`,
  `functools`, `collections`, `re`, `json`, `bisect`, `heapq`, `statistics`, `fractions`, `decimal`,
  `operator`, `typing`, `dataclasses`, `enum`, `zlib`, `struct`, `binascii`, `base64`, `copy`, `numbers`,
  `array` and `time` (the game's own clock). Each import is a view of the module's public names only, so
  the modules they happen to hold inside (and `os`, `sys`, `datetime`, `uuid`, …) aren't reachable through
  them. TypeScript programs get the standard JavaScript built-ins, with the game's `Date`, `Intl` dates and
  `performance`.
- **No reaching into the interpreter.** Programs may not use dunder attributes (`x.__class__`,
  `f.__globals__`, `.__dict__`, `.__code__`, `.__subclasses__`, …) or the frame, traceback and generator
  internals (`f_back`, `f_globals`, `gi_frame`, …). Defining dunder *methods* on your own classes is fine
  (`__init__`, `__eq__`, `__lt__`, `__iter__`, `super().__init__()`, …), and `__name__` works. `str.format`
  works on a literal format string (use an f-string for anything else). `eval`, `exec`, `compile`,
  `globals`, `locals`, `vars` and `open` aren't available. A program that breaks these is refused when you
  submit it (and when you test it with "try"). In TypeScript the program runs in a fresh sandbox context
  each call with no host objects to climb to.

Everything else is ordinary Python or TypeScript.

## What the challenge and response look like

Each game sets a **challenge type** and a **response type**. There is no starter code.

| Type | Looks like |
|---|---|
| `int` | `42` (whole numbers within ±9007199254740991) |
| `float` | `0.5` |
| `bool` | `true` / `false` (`True` / `False` in Python) |
| `str` | `"hello"` |
| `list[T]` | `[1, 2, 3]` for `list[int]` |
| `tree[T]` | `{"value": 1, "children": [{"value": 2, "children": []}]}` |
| `graph` | `{"nodes": 4, "edges": [[0, 1], [1, 2], [2, 3]]}`: nodes `0` to `nodes - 1`, edges either way round |
| `digraph` | same shape, but `[a, b]` is a one-way edge from `a` to `b` |
| `graph[T]` | a graph with `"labels": [one T per node]` and optional `"edgeLabels"`. `graph[any]` allows any labels |
| `any` | any plain data: numbers, strings, `true`/`false`, `null`, lists and objects |

**Challenges** are small: strings and lists at most 64 long, and trees and graphs at most 512 nodes (graphs
at most 2,048 edges), `any` values at most 32 levels deep. **Responses** are limited by size instead:
at most **1,024 bytes** (`max_response_bytes`; the owner can change it) of JSON as the game writes it
(UTF-8, no spaces), and at most 256 levels deep (a tree at most 256 levels). Graphs never have self-loops
or repeated edges. The owner can change all of these limits.

The size cap is checked inside the flower's time limit R, and writing the response as JSON is part of its
compute. A response over it counts as a failure: a `null` response and no energy. Every byte under it costs
energy too (see "Energy"). A big response reaches the bee already read in, before its 50 ms start.

## Budgets

| Budget | flower | bee |
|---|---|---|
| **size** (nodes, see below) | 1,100 | 11,000 |
| **change** (nodes earned per minute of play; you can bank up to a minute's worth) | 220 | 2,200 |
| **time** per call | R, 3 to 150 ms | 50 ms |
| **memory** (bytes of `MEMORY`, see "Bee memory") | | 50 |

The owner can change all of them. The flower's size cap is also the "size cap" in the energy formula.

### What counts toward size

The game measures your program **after minifying it**, and runs the minified program. Size is the number
of nodes in its syntax tree (roughly one per name, number, operation and statement; keywords, operators
and punctuation add nothing), except that **every literal counts one node per byte** of its text
(`"hello"` is 5, `12345` is 5) and names that keep their spelling count one, plus one per byte beyond 20.

- **Comments, spacing and TypeScript types are free.**
- **Names are free.** Every name your program defines is renamed to a one- or two-letter name. A few keep
  their spelling so the program still works: names defined in a class body, parameters you also pass by
  keyword, names that shadow a builtin, and `flower`, `first`, `decide`, `fed`, `GAME` and `MEMORY`.
- **Everything else counts:** every string and number byte by byte (including `"feed"` and `"leave"`),
  names after a dot, keyword-argument names, and names you use but don't define (`len`, `Math`, `GAME`).

So names can't smuggle data, and error messages refer to the minified program. Don't look your own names
up by string (`globals()["tally"]`).

## Changing your programs

Once the garden runs you can change either program **at any moment**; the new version goes live at once,
but **a turn keeps the versions it started with**. A turn that has begun (its arrival is drawn) finishes
with the bee and the flower as they were. A new flower answers the turns that start after it went live. A
new bee takes over when its current turn is over: the old bee makes that decision (a feed still counts),
whatever it queued is dropped, and the new bee is asked `first` straight away, with an empty `MEMORY`. A
bee between turns switches at once.

A change costs the **node edits** that turn the version playing now into the new one: inserting or
deleting a node costs its size, changing an operator or a name costs 1, and a changed literal costs the
bytes that change (`5` → `7` is 1). Renaming, comments and formatting are free. Each program's **change
budget** starts at zero when the game starts and grows with game time at its rate per minute, up to its
cap. A change you can't afford yet is refused, with how long until you can; one bigger than the cap
never can be: make it in steps.

## What everyone can see

**Public to everyone, as it happens** (including spectators without a team): for every turn of every bee,
the **arrival** (whose bee, whose flower), the **challenge**, the **response** and **whether the bee fed**
(a bee that was late or broke simply didn't). On a **feed**, also the **percent**, the **energy**, and the
**nectar** and **pollen** the flower gave the bee. The game's settings and the scoreboard are public too. So whatever two
programs do together happens in plain view. (If the owner raises the cap, a response over 4 KB is streamed
to the page as its first 4 KB, its size and its hash; the whole response is one click or one request away.)

**Private during play:**

| What | Who sees it during play |
|---|---|
| the **percent** and **energy** of a turn without a feed | the flower's team |
| the flower's **compute time** and its turn's **time budget R**, on every turn, and why a flower failed | the flower's team |
| **code**, what your bee **prints**, program **versions** and **sizes**, change **budgets**, the bee's **decision times** and errors | that team |
| your bee's **`MEMORY`** (its value, size and last error) | that team (read only: nobody can write it but the bee) |
| a feed's **pollen grain** (and the flower's version and code length that come with it) | the feeding bee's team |

**When the game ends, everything is revealed** for a full replay: every percent, energy and timing, every
version and change, every budget, every bee's `MEMORY`, every pollen grain, and (unless the owner turns it
off) all code and printouts.

## Scoring: Darwinian fitness

Two numbers per team, each from the whole game:

| Name | What it is |
|---|---|
| **pollination** | the sum over bee teams of (the pollen your species gave that team's bee)^0.85. How widely your pollen travels |
| **forage** | the sum over flower teams of (the nectar your bee got there)^0.85. How widely your bee eats |

Each becomes a **share**: your value ÷ the sum over all teams (when that sum is 0, every share is 1/N).

> **fitness = N² × pollination share × forage share.** Par is 1.0 however many teams play.

The exponent 0.85 rewards variety. A species that gave 400 pollen to one team's bee has pollination
400^0.85 ≈ 163; one that gave 100 to each of four teams' bees has 4 × 100^0.85 ≈ 200, though both gave 400 in
all. A bee that got 900 nectar from one flower has forage 900^0.85 ≈ 324; 300 from each of three flowers gives
3 × 300^0.85 ≈ 383. Your own team's bee and flower count like any other team's. (The owner can change both
exponents, `scoring` in the settings: each is more than 0 and at most 1. Games played before this rule were
scored with √, an exponent of 0.5.)

**The scoreboard is live and public**: during play everyone, spectators included, sees every team's
pollination, forage, shares and fitness as they change, along with its feed counts, nectar and pollen.

## After the game

Top teams get interviewed about their code. They teach the rest of us how it works, and other players
say how much they'd like to team up with them. Code you can explain beats code you can't.
