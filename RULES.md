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
short of CPU cores a round takes longer on the wall clock, which changes nothing in the game.

## A turn

Every bee that isn't busy feeding gets **one turn per round**: one challenge, one response, one decision.

1. **0 ms.** Your bee's challenge must already be **queued** (it came with its previous decision, or from
   `first`). A bee with nothing queued as the round starts **loses its turn** this round.
2. The engine draws a flower **uniformly at random from all N flowers**, your own included, independently
   every time. This **arrival** (whose bee, whose flower) is public at once to people watching the game,
   but neither program is told: a turn keeps the versions it started with, so nobody can pass it on.
3. The flower is called: `flower(challenge)`. It has **150 ms** and returns
   `[response, percent]`: its answer, and the share (0–100, clamped) of this turn's **excess energy** it
   gives the bee if the bee feeds. A late answer, an error, or a malformed return (not a pair, a response
   of the wrong type, a percent that isn't a number) gives a `null` response and no energy.
4. **150 ms.** The response is delivered to the bee, always at 150 ms however fast the flower was, so
   timing tells the bee nothing. The bee has **50 ms**: `decide(challenge, response)` returns
   `["feed", next_challenge]` or `["leave", next_challenge]`. The next challenge is queued for its next
   turn. **The bee is never told which team's flower it is facing**: not in the call, not in `GAME`, and
   not in `HISTORY`, which holds only turns that are over. It decides whether to feed from the challenge
   and the response alone (and whatever it remembers). The team numbers in `HISTORY` belong to earlier
   turns, so a flower's reputation can only be carried by what its responses look like, never by who it
   is.
5. **The turn is settled** (see "Energy: compute, nectar and pollen"). If the bee fed, it sits out the next
   **10 rounds** (`feed_cost`; the owner can change it), then plays again with the challenge it queued.

**Late replies.** A bee that takes more than 50 ms isn't cut off: its call keeps running (up to 2 s, when
it is stopped), but the turn is settled without it. **A late reply never feeds.** If the late reply is
`["leave", c]`, then `c` is queued for the bee's next turn. Anything else (a late `["feed", c]`, a crash)
gives no next challenge, so the engine at once calls `first()` for one. The bee can't play while
a call is running, so a slow bee also loses turns.

**No next challenge.** A reply in time that gives no usable next challenge (a bare `"feed"` or `"leave"`,
a challenge of the wrong type or size) still counts as a feed or a leave; then, as above, `first` is
called at once. A crash or a reply of any other shape counts as a leave. While replies keep giving no
challenge, `first` is called again at most once a round. A quick answer makes the next round.

**Every call runs fresh.** Each turn your bee meets a different flower of a species, and every flower of
a species is independent of the others: so your flower program runs fresh for every call, and nothing it
does survives to the next call. Your bee runs fresh for every call too, with one exception: **`MEMORY`**,
a small store that carries over from call to call (see "Bee memory"). Both can use randomness (freshly
seeded every call) and the clock, and both can read `HISTORY`.

### Bee memory

`MEMORY` is a global in your bee's program: a JSON value, `{}` (an empty dict / object) to begin with.
Change it in place (`MEMORY["seen"] = 3`, `MEMORY.seen = 3`), or assign a new value to it (in Python
inside a function, after `global MEMORY`). After every call of `first` or `decide` that returns, the game
saves it, and your bee's next call starts with what was saved. Nothing else carries over.

- **Its size is capped**: at most `GAME["memory"]` bytes (1,024 by default) of JSON as the game writes it,
  with sorted keys and no spaces (`{"a":[1,2]}` is 11 bytes). It must be plain JSON: dicts or objects with
  string keys, lists, numbers, strings, `true`/`false` and `null` (in Python, a tuple is saved as a list
  and a non-string key as a string).
- **A memory over the cap isn't saved**: the old one is kept and the error is shown to your team. The
  decision still counts. A call that crashes (or is stopped at 2 s) saves nothing.
- **A late reply's memory is saved** when it arrives, like its `["leave", c]`.
- **A new version of your bee starts with an empty memory** (`{}`), from its first turn. A crash or a
  restart of the server doesn't clear it.
- **Only your bee writes it.** Nobody else, your own team included, can change it. Your team can read it
  during play (its value, size and cap); everyone can once the game is over.

Your program's top-level code runs at the start of every call, so don't assign `MEMORY` there (that would
reset it every call): change it inside `first` and `decide`. `HISTORY` is not limited by the cap: it holds
every finished turn, for every call.

## Energy: compute, nectar and pollen

A flower allocates its energy between three things:
- **compute**: the CPU time it spends answering (and its size, which shrinks the whole budget);
- **nectar**: what it gives a bee that feeds, for the bee to eat;
- **pollen**: what else it gives a bee that feeds, for the bee to carry to other flowers of its species.

The bee wants nectar. The flower wants to give as much pollen as it can: pollen is what it scores on.

Each turn, the energy left after compute is the flower's **excess energy**, in node·ms:

> **E = (flower size cap − your flower's size) × max(0, 150 − compute ms)**

- **size** is the size in nodes of the flower version that answered (see "What counts toward size"); the
  cap is 1,100. A smaller flower has more to give.
- **compute ms** is the **CPU time** your flower's process used for this call: running the program and
  calling `flower`. It is CPU time, not wall time: a busy server doesn't cost you, and time your flower
  spends not computing isn't counted. `HISTORY` is brought up to date between calls, so it costs
  nothing until you query it.
- A late answer, an error or a malformed return: E = 0.

Then:
- **If the bee feeds:** the flower gives the bee **nectar = percent/100 × E** and **pollen =
  (1 − percent/100) × E**.
- **If it doesn't** (it leaves, it's late, it crashes): the flower gives nothing. That turn's energy is
  lost.

So a flower gives away pollen only when bees feed at it.

## History

Your bee, your flower and your team all see the same history: every finished turn of every bee, oldest
first, with everything your team may see of it. Your programs query it through **`HISTORY`**, a global
like `GAME`; your team queries the same records over the API (docs/QUERY.md). One record per turn:

```python
Turn(game="7", round=41, at_ms=8000, turn=12,
     bee=2, flower=0,                     # team indices: whose bee visited whose flower
     challenge=17, response=52,           # response is None if the flower failed
     fed=True,
     percent=25.0, energy=123486.0,       # on a feed: public. Otherwise: your own flower only
     nectar=30871.5, pollen=92614.5,      # on a feed: the nectar and pollen the flower gave the bee.
                                          #   Otherwise nectar is None and pollen is 0
     ms=2.1, flower_version=3, flower_error=None,   # your own flower only (ms: its compute time)
     bee_ms=0.4, bee_version=2, bee_error=None)     # your own bee only
```

Fields you aren't allowed to see are `None` (`null`). When a flower failed, its `percent` is `None`, its
`energy` 0 and `flower_error` says why. Teams are numbered `0` to `N - 1`; `GAME["team"]` is yours and
`GAME["teams"]` is N. In TypeScript the fields are camelCase (`atMs`, `flowerVersion`, …).

`HISTORY.turns` is a query: chain conditions and run it. Every step returns a new query, and results are
read-only:

```python
HISTORY.turns.rows()                                   # every turn so far: a tuple of Turn
HISTORY.turns.eq("flower", 2).rounds(10, 20).rows()    # conditions: eq ne lt le gt ge in_ between is_null not_null
HISTORY.turns.my_bee().order_by("round", desc=True).limit(5).rows()   # my_bee() my_flower() mine()
HISTORY.turns.offset(100).rows()                       # the turns after the first 100
HISTORY.turns.count().value()                          # aggregates: count sum avg min max
HISTORY.turns.group_by("flower").sum("nectar").rows()  # (Row(flower=0, sum_nectar=...), ...)
```

The same in TypeScript: `HISTORY.turns.eq("flower", 2).rounds(10, 20).rows()`, with `in`, `isNull`,
`notNull`, `myBee`, `orderBy("round", "desc")` and `groupBy`. docs/QUERY.md has the whole interface.

**Nobody learns the counterpart of a turn until it's over.** A round's turns reach `HISTORY` together,
after the round is over and before the next round's flowers are called. So while your flower answers it
isn't told whose bee asked, and while your bee decides it isn't told whose flower answered, nor the
percent, the energy or the nectar it would get. (Whatever either can work out from the challenge, the
response and the history is fair game.)

**History is free to receive, not to query.** It is brought up to date between your programs' timed
calls, so its size costs you nothing until you query it. Running a query is part of your compute (for a
flower, part of the CPU time that costs energy). Neither program can keep anything between calls but the
bee's `MEMORY`.

## The programs

### Python

```python
# flower: runs fresh for every turn at your flower.
def flower(challenge):
    # challenge: a value of the game's challenge type
    # HISTORY, GAME["team"], GAME["size"], GAME["flower_size_cap"], GAME["flower_ms"], ... (see below)
    return challenge, 50            # (response, percent): your answer, and 0-100% of E if the bee feeds
```

```python
# bee: runs fresh for every call; only MEMORY carries over (see "Bee memory").
import random

def first():
    # called when your bee needs a challenge and has none queued (it starts, or its last reply gave none)
    return random.randint(0, 9)     # the challenge for its next turn

def decide(challenge, response):
    # challenge: what your bee asked this turn; response: the flower's answer (None if it failed)
    # MEMORY: what your bee saved last time ({} at first); HISTORY, GAME: as for a flower
    return "leave", random.randint(0, 9)    # ("feed" or "leave", the challenge for its next turn)
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
```

In TypeScript, `tree[T]` is `{ value: T; children: Tree<T>[] }` and a graph is
`{ nodes: number; edges: [number, number][] }`; `HISTORY` is typed (`Turn` records), and `MEMORY` is a
JSON value.

Every program can read a `GAME` dictionary/object: `team` (your team's index), `teams` (N), `feed_cost`,
`challenge_type`, `response_type`, `max_len`, `max_nodes`, `round_ms` (200), `ms` (your program's own time
limit per call: 150 or 50), `flower_ms` (150) and `flower_size_cap` (1,100). A bee also gets `memory`, its
`MEMORY` cap in bytes. A flower also gets `size`, its
own size, so E = (`flower_size_cap` − `size`) × max(0, `flower_ms` − compute ms). In Python,
`time.process_time()` measures the CPU time the engine counts.

Python programs may import `math`, `random`, `hashlib`, `string`, `itertools`, `functools`,
`collections`, `re`, `json`, `bisect`, `heapq`, `statistics`, `fractions`, `decimal`, `operator`,
`typing`, `dataclasses`, `enum`, `zlib`, `struct`, `binascii`, `base64`, `copy`, `numbers`, `array`,
and `time`. TypeScript programs get the standard JavaScript built-ins, including `Date`.

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

Strings and lists can be at most 64 long, and trees and graphs at most 512 nodes (graphs at most 2,048
edges, no self-loops or repeated edges). The owner can change both limits.

## Budgets

| Budget | flower | bee |
|---|---|---|
| **size** (nodes, see below) | 1,100 | 11,000 |
| **change** (nodes earned per minute of play; you can bank up to a minute's worth) | 220 | 2,200 |
| **time** per call | 150 ms | 50 ms |
| **memory** (bytes of `MEMORY`, see "Bee memory") | | 1,024 |

The owner can change all of them. The flower's size cap is also the "size cap" in the energy formula.

### What counts toward size

The game measures your program **after minifying it**, and runs the minified program. Size is the number
of nodes in its syntax tree (roughly one per name, number, operation and statement; keywords, operators
and punctuation add nothing), except that **every literal counts one node per byte** of its text
(`"hello"` is 5, `12345` is 5) and names that keep their spelling count one, plus one per byte beyond 20.

- **Comments, spacing and TypeScript types are free.**
- **Names are free.** Every name your program defines is renamed to a one- or two-letter name. A few keep
  their spelling so the program still works: names defined in a class body, parameters you also pass by
  keyword, names that shadow a builtin, and `flower`, `first`, `decide`, `GAME` and `HISTORY`.
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
programs do together happens in plain view.

**Private during play:**

| What | Who sees it during play |
|---|---|
| the **percent** and **energy** of a turn without a feed | the flower's team |
| the flower's **compute time**, on every turn, and why a flower failed | the flower's team |
| **code**, what your bee **prints**, program **versions** and **sizes**, change **budgets**, the bee's **decision times** and errors | that team |
| your bee's **`MEMORY`** (its value and size) | that team (read only: nobody can write it but the bee) |

Your programs' `HISTORY` holds exactly what your team can see, from turns that are over.

**When the game ends, everything is revealed** for a full replay: every percent, energy and timing, every
version and change, every budget, every bee's `MEMORY`, and (unless the owner turns it off) all code and
printouts.

## Scoring: Darwinian fitness

Two numbers per team, each from the whole game:

| Name | What it is |
|---|---|
| **pollination** | the sum over bee teams of √(the pollen your species gave that team's bee). How widely your pollen travels |
| **forage** | the sum over flower teams of √(the nectar your bee got there). How widely your bee eats |

Each becomes a **share**: your value ÷ the sum over all teams (when that sum is 0, every share is 1/N).

> **fitness = N² × pollination share × forage share.** Par is 1.0 however many teams play.

The square roots reward variety. A species that gave 400 pollen to one team's bee has pollination
√400 = 20; one that gave 100 to each of four teams' bees has 4 × √100 = 40, though both gave 400 in all. A bee
that got 900 nectar from one flower has forage 30; 300 from each of three flowers gives about 52. Your own
team's bee and flower count like any other team's.

**The scoreboard is live and public**: during play everyone, spectators included, sees every team's
pollination, forage, shares and fitness as they change, along with its feed counts, nectar and pollen.

## After the game

Top teams get interviewed about their code. They teach the rest of us how it works, and other players
say how much they'd like to team up with them. Code you can explain beats code you can't.
