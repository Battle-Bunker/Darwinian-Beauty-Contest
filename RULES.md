# Darwinian Beauty Contest: the rules

Real flowers and bees are locked in an arms race. Some flowers pay bees with nectar. Others, like the
**bee orchid** (*Ophrys apifera*), pay nothing: they just *look* like a good deal. Bees that can tell
the difference eat well. Flowers that fool bees still get pollinated for free.

In this game your team writes **three programs**:

| Program | Named after | What it is |
|---|---|---|
| **cosmos** | the garden cosmos (*Cosmos bipinnatus*), the honest, many-coloured nectar flower | a rewarding flower: bees that feed here get **1 nectar** |
| **orchid** | the bee orchid (*Ophrys apifera*), the classic deceiver | a deceptive flower: bees that feed here get **nothing** |
| **bee** | the honeybee | visits flowers, asks them questions, and decides whether to feed |

Your cosmos and orchid grow together in your team's **patch**. Bees never learn which patch a flower
is in, or which of its two flowers it is. All a bee sees is a flower and its answers.

## The garden never stops

A game is one continuous stretch of play, 2 minutes by default (the room owner sets it).

1. **The lobby.** Teams join and write their programs. Writing is free here: anything within the size
   budgets. A team needs all three programs to take part.
2. **The garden.** The owner starts the game and the clock starts. From then on the bees forage without
   pause, one round after another, and every team can change any of its programs at any moment, paying
   for each change from a budget that refills as the game goes on (see "Changing your programs").
3. **The end.** When the clock runs out the game is over. The owner can also pause it (the clock and
   the budgets stand still) or end it early.

### Rounds: 200 ms, every bee in step

The game runs in **rounds** of exactly **200 ms** of game time. A round is one action slot for every
bee, all at the same moment: a **150 ms flower window**, then a **50 ms decision window**. The game
clock is rounds × 200 ms (a 2-minute game is 600 rounds), and it is played in real time: a round lasts
at least 200 ms on the wall clock too (longer if the server is short of CPU cores, which changes
nothing in the game: every program still gets its full time on a core of its own).

Each bee is shown one flower at a time, from its own shuffled deck of every flower in the garden. Your
own two flowers are in the deck too, and every flower comes up once before any comes up again.

**What a bee does next is always decided a round ahead.** Your bee's `forage` returns its *next* action,
which is **queued** for its next round:

- `["ask", challenge]`: ask this challenge at the same flower next round.
- `"feed"`: feed next round. You get 1 nectar if it's a cosmos and 0 if it's an orchid, and your bee is
  then busy feeding for the next **10 rounds** (the owner can change the 10): no slot for it while the
  other bees carry on. You can feed **once** per visit, after asking at least once.
- `["leave", challenge]`: move on, and ask this challenge first at the next flower, next round.
- `"leave"`: move on with nothing queued (see below).

**The round, step by step:**

1. **0 ms.** Every bee's queued action runs at once: each queued challenge goes to its flower, or the
   bee feeds. A bee with nothing queued as the round starts **loses its slot** for that round.
2. **150 ms.** The flowers' answers are delivered. A cosmos has the whole 150 ms to answer; an orchid
   has a shorter time limit, **100 ms** by default (the room owner sets it, never more than a cosmos's).
   A flower that isn't done within its own limit gives no answer (`None`/`null`). Either way the answer
   reaches the bee at 150 ms, however fast the flower was, so how long an answer took tells a bee
   nothing.
3. **150–200 ms.** Every bee that acted is shown the answer (after a feed: whether it got nectar) and
   has **50 ms** to return its next action. The 50 ms are counted from when its call starts on a CPU
   core of its own.

**Queued challenges are secret.** Nobody sees a challenge until it is asked. When your bee leaves with
`["leave", challenge]`, the leave is public at once, but its next challenge only when it's asked.

**Late replies.** A bee that takes more than 50 ms isn't cut off: its call keeps running (for up to 2 s,
when it is stopped) and the game keeps listening, but the round moves on without it. The bee **loses
its next slot** and its visit ends. When the late reply arrives, a `["leave", challenge]` still counts:
that challenge is asked first at the next flower. Anything else (an `ask` or `feed` meant for the visit
it was too slow for, a plain `"leave"`, an error) doesn't give the bee a challenge to start its next
flower with, so the game at once calls `forage` again with `seen` empty and `visit["fed"]` false,
asking for the first challenge at its next flower.

**A reply that gives no next challenge** works the same way, late or not: a plain `"leave"`, a second
`"feed"` in one visit (it means leave), a challenge of the wrong type or size, a crash or anything
else odd ends the visit, and `forage` is called again at once with `seen` empty. The bee plays again
as soon as it has a challenge queued when a round starts: a quick answer (in before the round ends)
makes the next round; a slower one costs a round or more. (`["leave", challenge]` never costs a
slot.) While answers keep giving no challenge, the game asks again at most once a round.

**After feeding you can keep asking the same flower**: that's how you study a flower you now know is
generous (or know is a fake). The call after a feed first calls your `tasted(seen, nectar)` (if you
wrote one) and then `forage`, in one call with one 50 ms deadline.

**Bees remember things.** Your bee is one running program: its variables last from call to call for as
long as that version of it plays, so it can learn as it goes. Submitting a new bee starts the new one
afresh, with nothing remembered, and so does a crash that kills it. If you want a new bee to know
something, write it into its code (and pay for it: see "What counts toward size").

**Flowers remember nothing, but they don't have to repeat themselves.** The whole flower program runs
fresh for every single question, so nothing survives from one call to the next: a flower can't count
visitors or change its mind. Within one call, though, a flower can use `random` (freshly seeded every
call) and the clock (`import time`; in TypeScript `Math.random()` and `Date.now()`). So it can run a
search or an optimisation until its time is nearly up and answer with the best result it found. The
same challenge can get a different answer every time. `GAME["ms"]` (TypeScript: `GAME.ms`) is your
flower's own time limit per call in milliseconds: 150 for a cosmos, and the orchid's own limit (100 by
default) for an orchid, so an orchid can time its work to finish just before its limit. The clock
starts when your program starts, so stop with a margin to spare: a flower that runs out of time gives
no answer at all.

**Nobody knows who's who.** Programs never learn which team a flower or bee belongs to.

## What the challenge and response look like

Each game sets a **challenge type** (what bees ask with) and a **response type** (what flowers
answer with). Those types are all anyone knows at the start. **There is no starter code.** Every team
invents its own flowers and bee from scratch. As the game goes on, the public record lets you work out
the rules other teams' flowers follow.

| Type | Looks like |
|---|---|
| `int` | `42` (whole numbers within ±9007199254740991) |
| `float` | `0.5` |
| `bool` | `true` / `false` (`True` / `False` in Python) |
| `str` | `"hello"` |
| `list[T]` | `[1, 2, 3]` for `list[int]` |
| `tree[T]` | `{"value": 1, "children": [{"value": 2, "children": []}]}`: every node has a value and a list of children |
| `graph` | `{"nodes": 4, "edges": [[0, 1], [1, 2], [2, 3]]}`: nodes are numbered `0` to `nodes - 1`; edges join two nodes, either way round |
| `digraph` | same shape as `graph`, but `[a, b]` is a one-way edge from `a` to `b` |
| `graph[T]` | a graph whose nodes carry labels: `{"nodes": 3, "edges": [[0, 1], [1, 2]], "labels": [17, 4, 9]}`. `labels[i]` belongs to node `i`; optional `"edgeLabels"` has one label per edge. `graph[any]` allows any labels |
| `any` | any plain data: numbers, strings, `true`/`false`, `null`, lists and objects |

The node numbers give a graph landmarks to measure from, such as how many steps it is from node `0`
to node `1`, or to the last node, or how many neighbours node `0` has. Labels let a graph carry more:
numbers, positions, colours. For example, a group of numbers that all get along with each other under
some rule, with an edge between every pair to show it.

Strings and lists can be at most 64 long, and trees and graphs at most 512 nodes (graphs at most
2,048 edges, with no self-loops or repeated edges). The owner can change both limits. A response of the
wrong type or shape, a crash or a timeout reaches the bee as `None`/`null`.

## The programs

Each program is one function (two for the bee). Here are their shapes; what goes inside is up to you.

### Python

```python
# cosmos and orchid
def flower(challenge):
    ...  # return a value of the game's response type

# bee
def forage(seen, visit):
    # seen  = [[challenge, response], ...] at the flower in front of you
    #         (empty when the game asks for the first challenge at your next flower)
    # visit = {"fed": True/False, "nectar": True/False/None, "flowers": how many flowers are in the garden}
    ...  # return your NEXT action, queued for your next round:
         #   ["ask", challenge]   ask it here
         #   "feed"               feed here (then sit out GAME["feed_cost"] rounds)
         #   ["leave", challenge] move on, and ask it first at the next flower
         #   "leave"              move on (the game then asks you for a first challenge)

def tasted(seen, nectar):   # optional: after you feed, called just before forage; nectar is True or False
    ...
```

`visit` is optional: `def forage(seen)` works too.

### TypeScript

```ts
function flower(challenge: Challenge): Response

function forage(seen: [Challenge, Response | null][],
                visit: { fed: boolean; nectar: boolean | null; flowers: number }):
  ["ask", Challenge] | "feed" | ["leave", Challenge] | "leave"
function tasted(seen: [Challenge, Response | null][], nectar: boolean): void   // optional
```

In TypeScript, `tree[T]` is `{ value: T; children: Tree<T>[] }` and a graph is
`{ nodes: number; edges: [number, number][] }`.

Every program can read a `GAME` dictionary/object: `feed_cost` (rounds a feeding bee sits out),
`challenge_type`, `response_type`, `max_len`, `max_nodes`, `round_ms` (200: the length of a round) and
`ms` (your program's own time limit per call, in milliseconds: a cosmos's, an orchid's, or a bee's 50).
It doesn't say what time it is in the game.

Python programs may import `math`, `random`, `hashlib`, `string`, `itertools`, `functools`,
`collections`, `re`, `json`, `bisect`, `heapq`, `statistics`, `fractions`, `decimal`, `operator`,
`typing`, `dataclasses`, `enum`, `zlib`, `struct`, `binascii`, `base64`, `copy`, `numbers`, `array`,
and `time`. TypeScript programs get the standard JavaScript built-ins, including `Date`. A bee's
`random` is freshly seeded when it starts.

## Budgets

Each of your three programs has three budgets, and the room owner sets them per game. The three
programs get **different** budgets on purpose, measured against the orchid:

| Budget | Measures | cosmos | orchid | bee |
|---|---|---|---|---|
| **size** | your program's size in nodes (see below) | 1,100 (half an orchid's) | 2,200 | 11,000 (5× an orchid's) |
| **change** | nodes of change you earn per minute of play, and the most you can bank (a minute's worth) | 220 a minute, up to 220 | 1,540 a minute, up to 1,540 (7× a cosmos's) | 2,200 a minute, up to 2,200 |
| **time** | milliseconds per call (flowers: the whole program, every question) | 150: the whole flower window | 100 (the owner sets it; at most a cosmos's) | 50: the decision window |

Why it's lopsided:
- **Cosmos flowers** are small but powerful: they get the whole 150 ms flower window for every answer, half
  as much again as an orchid's 100. That makes effort a signal. An answer that takes real work to
  produce, like a big graph that fits a tricky rule, is hard for an orchid to fake in two thirds of
  the time. With randomness and a clock, a cosmos can search for as long as its time allows and
  return the best it found, so how good its answers are shows how hard it worked. Every answer is
  delivered at 150 ms, so an orchid can't be caught out by answering early, only by how good its
  answers are. But cosmos flowers change slowly.
- **Orchids** get more code and change fast. They make up for less time with cleverness: a faster
  way to produce the same kind of answer, or a shallower look-alike, re-aimed whenever they see what
  the bees trust.
- **Bees** get lots of code for a whole kit of detectors, but only 50 ms per decision. So the best
  signals are ones that are **hard to make but easy to check**.

### What counts toward size

The game measures your program **after minifying it**, so writing readable code costs nothing. Size is
the number of nodes in the minified program's syntax tree (roughly one per name, number, operation and
statement; keywords, operators and punctuation add nothing), except that:

- **every literal counts one node per byte** of its text: `"hello"` is 5, `12345` is 5, `"é"` is 2
- names that keep their spelling (see below) count one node, plus one per byte beyond 20

Minifying works like this:

- **Comments, blank lines and spacing are free.**
- **Names are free.** Every name your program defines (variables, functions, parameters, imports) is
  renamed to a one- or two-letter name, so `best_clique_size` costs the same as `b`. A few names keep
  their spelling so the program still works: names defined in a class body (they're attributes),
  parameters you also pass by keyword (`f(size=3)`), names that shadow a builtin (`max = 3`), and
  `flower`, `forage`, `tasted` and `GAME`.
- **TypeScript types are free**, because they're removed before your program runs.
- **Everything else counts:** every string (including docstrings and your bee's `"ask"`, `"feed"` and
  `"leave"`) and number byte by byte, names after a dot (`random.randint`), keyword-argument names
  (`dict(nodes=n)`), and names you use but don't define (`len`, `Math`, `GAME`).

**The game runs the minified program**, exactly what gets counted, and the editor shows it to you.
So names can't smuggle data (a function's `__name__` is one letter), and error messages refer to the
minified program. Don't look your own names up by string (`globals()["tally"]`): they won't be there.
Strings and numbers count in full because otherwise a single long string or number could hide a whole
lookup table.

## Changing your programs

Once the garden is running, you can change any of your programs **at any moment**, and the new version
**goes live at once**: a flower's next answer comes from the new code, and a bee switches at the start
of the next round (leaving the flower it was at, dropping whatever it had queued, and starting afresh:
the game asks the new bee for its first challenge straight away).

A change costs the **node edits** that turn the program playing now into the new one: inserting or
deleting a node costs its size, changing an operator or a name costs 1, and a changed literal costs the
bytes that change in it (`5` → `7` is 1, `"hello"` → `"help"` is 2). Renaming a variable, editing
comments or reformatting costs nothing.

Each program has its own **change budget**. It starts at zero when the game starts and grows steadily
with game time, at its rate per minute, until it reaches its cap. A change you can afford is paid from
it on the spot. A change you can't afford yet is refused, with how long until you can. A change bigger
than the cap can never be afforded: make it in steps. The clock and the budgets stop while the game is
paused.

## What everyone can see

**Public, as it happens:** which team's bee asked at which team's patch, and in which round; every
challenge as it is asked and every response; every feed and whether it paid; every leave and every
error. The game's settings, every time limit included, are public too. People and programs watching
the game get exactly the same information: the web page shows what the API streams.

**Secret during play:**
- **which of a patch's two flowers was asked**: everyone sees that Ada's bee asked at Bo's patch, but
  only Bo's team sees whether it was Bo's cosmos or Bo's orchid. (A feed still says whether it paid,
  and nectar only comes from a cosmos, so a feed gives away the flower of that one visit.)
- **how long anything took**: each flower's answer time and each bee's decision time. Every answer
  arrives at the same moment of the round anyway.
- **code**: your programs, and what your bee prints.
- a challenge your bee has queued but not yet asked.
- your **code changes**: when you change a program, how big the change was, what it cost, and how much
  change budget you have left.

Other teams only see what your programs *do*. (Your team sees all of its own.)

**When the game ends**, everyone can replay it with all of that revealed: which flower every visit was
at, every team's code changes (when, how big, what they cost), their change budgets over time, which
version of each program played every action, how long every answer and decision took, and (unless the
owner turns it off) all code and all printouts.

## Scoring: Darwinian fitness

Two ledgers are kept, with one row per bee team and one column per patch team:

- the **feed ledger** counts how many times each bee fed at each patch (cosmos *or* orchid)
- the **nectar ledger** counts how much nectar each bee collected from each patch

A team's score combines two numbers that both reward **variety**, built from a **rootsum**: add up
the square root of each entry.

> rootsum([4, 0, 0, 0]) = 2, but rootsum([1, 1, 1, 1]) = 4.
> Earning from many different teams beats earning the same amount from one.

| Name | What it is |
|---|---|
| **allure** | rootsum of the feeds your patch received, counted per bee team. How widely your flowers get pollinated. |
| **forage** | rootsum of the nectar your bee collected, counted per patch team. How widely your bee finds real food. |
| **allure share** | your allure ÷ everyone's allure added up. Par is 1/N. |
| **forage share** | your forage ÷ everyone's forage added up. Par is 1/N. |
| **fitness** | N² × allure share × forage share. **Par is 1.0** however many teams play. |

Here N is the number of teams. Your own patch and your own bee count like any other team. The game
score uses the ledgers of the whole game; the scoreboard also shows the last five minutes on their own.

So you want **lots of different bees to feed at your patch**, including at your orchid, and **your
bee to find nectar at lots of different patches**.

A cosmos that bees can recognise attracts feeds. An orchid gets fed when it answers like a cosmos
that bees trust, and every bee it fools learns to trust that kind of answer a little less. If your
orchid imitates **your own** cosmos, your cosmos's reputation pays the price. If it imitates
**another team's** cosmos, theirs does. Everyone sees every answer the moment it's given, and whose
patch gave it (if not which of its two flowers), so whatever a cosmos does to be recognised, the
orchids are watching too.

## After the game

Top teams get interviewed about their code. They teach the rest of us how it works, and other
players say how much they'd like to team up with them. Code you can explain beats code you can't.
