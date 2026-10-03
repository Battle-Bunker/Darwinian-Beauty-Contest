# Darwinian Beauty Contest: one flower

Real flowers and bees are locked in an arms race. A flower pays for pollination with nectar, and every
drop it gives away is energy it doesn't keep. A bee wants the most nectar for the fewest visits. Each
side would like to know who it is dealing with, and neither is told until it's too late to matter.

Your team writes **two programs**:

| Program | What it does |
|---|---|
| **flower** | answers a bee's challenge, and says what share of this turn's spare energy it gives the bee as nectar if the bee feeds |
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
   every time. This **arrival** (whose bee, whose flower) is public at once.
3. The flower is called: `flower(challenge, ledger)`. It has **150 ms** and returns
   `[response, percent]`: its answer, and the share (0–100, clamped) of this turn's **excess energy** it
   gives the bee if the bee feeds. A late answer, an error, or a malformed return (not a pair, a response
   of the wrong type, a percent that isn't a number) gives a `null` response and no energy.
4. **150 ms.** The response is delivered to the bee, always at 150 ms however fast the flower was, so
   timing tells the bee nothing. The bee has **50 ms**: `decide(challenge, response, ledger)` returns
   `["feed", next_challenge]` or `["leave", next_challenge]`. The next challenge is queued for its next
   turn.
5. **The turn is settled** (see "Energy, nectar and surplus"). If the bee fed, it sits out the next
   **10 rounds** (`feed_cost`; the owner can change it), then plays again with the challenge it queued.

**Late replies.** A bee that takes more than 50 ms isn't cut off: its call keeps running (up to 2 s, when
it is stopped), but the turn is settled without it. **A late reply never feeds.** If the late reply is
`["leave", c]`, then `c` is queued for the bee's next turn. Anything else (a late `["feed", c]`, a crash)
gives no next challenge, so the engine at once calls `first(ledger)` for one. The bee can't play while
a call is running, so a slow bee also loses turns.

**No next challenge.** A reply in time that gives no usable next challenge (a bare `"feed"` or `"leave"`,
a challenge of the wrong type or size) still counts as a feed or a leave; then, as above, `first` is
called at once. A crash or a reply of any other shape counts as a leave. While replies keep giving no
challenge, `first` is called again at most once a round. A quick answer makes the next round.

**Bees remember; flowers don't.** Your bee is one running program: its variables last from call to call
for as long as that version plays. A new version (or a crash) starts afresh. A flower runs fresh for
every call: nothing it does survives to the next call. It can use randomness (freshly seeded every
call) and the clock, and it can read the ledger.

## Energy, nectar and surplus

A flower's **excess energy** for a turn, in node·ms, is

> **E = (flower size cap − your flower's size) × max(0, 150 − compute ms)**

- **size** is the size in nodes of the flower version that answered (see "What counts toward size"); the
  cap is 1,100. A smaller flower has more to give.
- **compute ms** is the **CPU time** your flower's process used for this call: running the program and
  calling `flower`. It is CPU time, not wall time, so a busy server doesn't cost you, and sleeping
  doesn't help. The ledger is delivered between calls, so it costs nothing until you read it.
- A late answer, an error or a malformed return: E = 0.

Then:
- **If the bee feeds:** it gets **nectar = percent/100 × E**, and the flower's team **surplus** gets the
  rest, (1 − percent/100) × E.
- **If it doesn't** (it leaves, it's late, it crashes): the flower's surplus gets all of E.

## The ledger

Your bee, your flower and your team all see the same **team ledger**: every turn of every bee so far,
oldest first, plus your team's private details. One entry per turn:

```python
{"round": 41, "bee": 2, "flower": 0,         # team indices: whose bee visited whose flower
 "challenge": 17, "response": 52,            # response is None if the flower failed
 "fed": True,
 "nectar": 30871.5,                          # your turns only: your bee fed, or a bee fed at your flower
 "percent": 25, "energy": 123486.0,          # visits to your own flower only
 "ms": 2.1, "surplus": 92614.5}              #   (ms: your flower's compute time)
```

Fields you aren't allowed to see are `None` (`null`): `nectar` unless your bee fed or a bee fed at your
flower; `percent`, `energy`, `ms` and `surplus` except at your own flower. Teams are numbered `0` to
`N - 1`; `GAME["team"]` is yours and `GAME["teams"]` is N.

**Nobody learns the counterpart of a turn until it's over.** A round's entries reach the programs together,
after the round is over and before the next round's flowers are called. So while your flower answers it
isn't told whose bee asked, and while your bee decides it isn't told whose flower answered, nor the
percent, the energy or the nectar it would get. (Whatever either can work out from the challenge, the
answer and the ledger is fair game.)

**The ledger is free to receive, not to read.** It is delivered to your programs as it grows, outside
their timed calls, so its size costs you nothing until you read it. Reading it is part of your compute.
Your bee keeps its variables between calls; a flower can't remember anything between calls. Treat the
ledger as read-only.

## The programs

### Python

```python
# flower: runs fresh for every turn at your flower. The ledger argument is optional: def flower(challenge).
def flower(challenge, ledger):
    # challenge: a value of the game's challenge type
    # ledger:    the team ledger (list of entries, oldest first; see "The ledger")
    # GAME["team"], GAME["size"], GAME["flower_size_cap"], GAME["flower_ms"], ... (see below)
    return challenge, 50            # (response, percent): your answer, and 0-100% of E if the bee feeds
```

```python
# bee: one long-running program. first and decide may also leave out the ledger argument.
import random

def first(ledger):
    # called when your bee needs a challenge and has none queued (it starts, or its last reply gave none)
    return random.randint(0, 9)     # the challenge for its next turn

def decide(challenge, response, ledger):
    # challenge: what your bee asked this turn; response: the flower's answer (None if it failed)
    # ledger:    the team ledger, up to the end of the last round
    return "leave", random.randint(0, 9)    # ("feed" or "leave", the challenge for its next turn)
```

### TypeScript

```ts
type Entry = {
  round: number; bee: number; flower: number;       // team indices
  challenge: Challenge; response: Response | null; fed: boolean;
  nectar: number | null;                            // your turns only
  percent: number | null; energy: number | null;    // your own flower only
  ms: number | null; surplus: number | null;        // your own flower only
};

function flower(challenge: number, ledger: readonly Entry[]): [number, number] {
  return [challenge, 50];                           // [response, percent]
}

function first(ledger: readonly Entry[]): number {
  return Math.floor(Math.random() * 10);            // the challenge for the bee's next turn
}

function decide(challenge: number, response: number | null, ledger: readonly Entry[]): ["feed" | "leave", number] {
  return ["leave", Math.floor(Math.random() * 10)]; // ["feed" | "leave", next challenge]
}
```

In TypeScript, `tree[T]` is `{ value: T; children: Tree<T>[] }` and a graph is
`{ nodes: number; edges: [number, number][] }`. A TypeScript flower's ledger is frozen.

Every program can read a `GAME` dictionary/object: `team` (your team's index), `teams` (N), `feed_cost`,
`challenge_type`, `response_type`, `max_len`, `max_nodes`, `round_ms` (200), `ms` (your program's own time
limit per call: 150 or 50), `flower_ms` (150) and `flower_size_cap` (1,100). A flower also gets `size`, its
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

The owner can change all of them. The flower's size cap is also the "size cap" in the energy formula.

### What counts toward size

The game measures your program **after minifying it**, and runs the minified program. Size is the number
of nodes in its syntax tree (roughly one per name, number, operation and statement; keywords, operators
and punctuation add nothing), except that **every literal counts one node per byte** of its text
(`"hello"` is 5, `12345` is 5) and names that keep their spelling count one, plus one per byte beyond 20.

- **Comments, spacing and TypeScript types are free.**
- **Names are free.** Every name your program defines is renamed to a one- or two-letter name. A few keep
  their spelling so the program still works: names defined in a class body, parameters you also pass by
  keyword, names that shadow a builtin, and `flower`, `first`, `decide` and `GAME`.
- **Everything else counts:** every string and number byte by byte (including `"feed"` and `"leave"`),
  names after a dot, keyword-argument names, and names you use but don't define (`len`, `Math`, `GAME`).

So names can't smuggle data, and error messages refer to the minified program. Don't look your own names
up by string (`globals()["tally"]`).

## Changing your programs

Once the garden runs you can change either program **at any moment**; the new version goes live at once,
but **a turn keeps the versions it started with**. A turn that has begun (its arrival is drawn) finishes
with the bee and the flower as they were. A new flower answers the turns that start after it went live. A
new bee takes over when its current turn is over: the old bee makes that decision (a feed still counts),
whatever it queued is dropped, and the new bee is asked `first` straight away. A bee between turns
switches at once.

A change costs the **node edits** that turn the version playing now into the new one: inserting or
deleting a node costs its size, changing an operator or a name costs 1, and a changed literal costs the
bytes that change (`5` → `7` is 1). Renaming, comments and formatting are free. Each program's **change
budget** starts at zero when the game starts and grows with game time at its rate per minute, up to its
cap. A change you can't afford yet is refused, with how long until you can; one bigger than the cap
never can be: make it in steps.

## What everyone can see

**Public to everyone, as it happens** (including spectators without a team): for every turn of every bee,
the **arrival** (whose bee, whose flower), the **challenge**, the **response** and **whether the bee fed**.
The game's settings are public too. So whatever two programs do together happens in plain view.

**Private during play:**

| What | Who sees it during play |
|---|---|
| a turn's **percent**, **energy** and the flower's **compute time** | the flower's team |
| a feed's **nectar** | the bee's team and the flower's team |
| a team's **surplus** | that team |
| **code**, what your bee **prints**, program **versions**, change **budgets**, the bee's **decision times**, errors | that team |

Your bee's and flower's ledger holds exactly what your team can see, from turns that are over.

**When the game ends, everything is revealed** for a full replay: every percent, energy, nectar, surplus
and timing, every version and change, every budget, and (unless the owner turns it off) all code and
printouts.

## Scoring: Darwinian fitness

Three numbers per team, each from the whole game:

| Name | What it is |
|---|---|
| **allure** | the sum over bee teams of √(times that team's bee fed at your flower). How widely you're pollinated |
| **forage** | the sum over flower teams of √(nectar your bee got there). How widely your bee eats |
| **surplus** | the energy your flower kept |

Each becomes a **share**: your value ÷ the sum over all teams (when that sum is 0, every share is 1/N).

> **fitness = N³ × allure share × forage share × surplus share.** Par is 1.0 however many teams play.

The square roots reward variety: 4 feeds from one bee team give allure 2, one from each of four teams
gives 4. Your own team's bee and flower count like any other team's.

During play everyone sees every team's allure and the feed counts (feeds are public); your team also
sees its own forage, surplus and nectar. Shares and fitness are revealed when the game ends.

## After the game

Top teams get interviewed about their code. They teach the rest of us how it works, and other players
say how much they'd like to team up with them. Code you can explain beats code you can't.
