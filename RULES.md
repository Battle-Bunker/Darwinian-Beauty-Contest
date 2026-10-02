# Darwinian Beauty Contest: the rules

Real flowers and bees are locked in an arms race. Some flowers pay bees with nectar. Others, like the
**bee orchid** (*Ophrys apifera*), pay nothing: they just *look* like a good deal. Bees that can tell
the difference eat well. Flowers that fool bees still get pollinated for free.

In this game your team writes **three programs**:

| Program | Named after | What it is |
|---|---|---|
| **clover** | white clover (*Trifolium repens*), the classic honest nectar flower | a rewarding flower: bees that feed here get **1 nectar** |
| **orchid** | the bee orchid (*Ophrys apifera*), the classic deceiver | a deceptive flower: bees that feed here get **nothing** |
| **bee** | the honeybee | visits flowers, asks them questions, and decides whether to feed |

Your clover and orchid grow together in your team's **patch**. Bees never learn which patch a flower
is in, or which of its two flowers it is. All a bee sees is a flower and its answers.

## The garden never stops

A game is one continuous stretch of play, 2 minutes by default (the room owner sets it).

1. **The lobby.** Teams join and write their programs. Writing is free here: anything within the size
   budgets. A team needs all three programs to take part.
2. **The garden.** The owner starts the game and the clock starts. From then on the bees forage without
   pause, and every team can change any of its programs at any moment, paying for each change from a
   budget that refills as the game goes on (see "Changing your programs").
3. **The end.** When the clock runs out the game is over. The owner can also pause it (the clock and
   the budgets stand still) or end it early.

### Bees take turns, in rounds

The bees take turns round robin, as fast as the programs run. A **round** is one turn for every bee:
every bee that isn't busy feeding takes its turn, then the next round starts. Each bee is shown one
flower at a time, from its own shuffled deck of every flower in the garden. Your own two flowers are
in the deck too, and every flower comes up once before any comes up again.

At each flower your bee can:

- **ask** a challenge: that's its turn this round. The flower answers with its response.
- **feed**: you get 1 nectar if it was a clover and 0 if it was an orchid, and your bee is busy
  feeding: it's **out of the round robin for the next 10 rounds** (the owner can change the 10) while
  the other bees carry on. You can feed **once** per visit.
- **leave**: free once you've asked something. The next flower appears straight away, in the same turn.

You must ask at least once before you feed. **After feeding you can keep asking the same flower**:
that's how you study a flower you now know is generous (or know is a fake). Once you've fed, anything
other than another ask moves on to the next flower.

A bee that leaves without asking anything still uses up its turn. If your bee crashes, runs out of time
or returns something odd, that uses up its turn and ends the visit.

**Bees remember things.** Your bee is one running program: its variables last from call to call for as
long as that version of it plays, so it can learn as it goes. Submitting a new bee starts the new one
afresh, with nothing remembered, and so does a crash that kills it. If you want a new bee to know
something, write it into its code (and pay for it: see "What counts toward size").

**Flowers remember nothing, but they don't have to repeat themselves.** The whole flower program runs
fresh for every single question, so nothing survives from one call to the next: a flower can't count
visitors or change its mind. Within one call, though, a flower can use `random` (freshly seeded every
call) and the clock (`import time`; in TypeScript `Math.random()` and `Date.now()`). So it can run a
search or an optimisation until its compute budget is nearly spent and answer with the best result it
found. The same challenge can get a different answer every time. `GAME["ms"]` (TypeScript: `GAME.ms`)
is your program's own budget per call in milliseconds. The clock starts when your program starts, so
stop with a margin to spare: a flower that runs out of time gives no answer at all.

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
# clover and orchid
def flower(challenge):
    ...  # return a value of the game's response type

# bee
def forage(seen, visit):
    # seen  = [[challenge, response], ...] at the flower in front of you (empty when it arrives)
    # visit = {"fed": True/False, "nectar": True/False/None, "flowers": how many flowers are in the garden}
    ...  # return ["ask", challenge] (this round's turn), "feed" (then sit out GAME["feed_cost"] rounds) or "leave" (free)

def tasted(seen, nectar):   # optional: called right after you feed; nectar is True or False
    ...
```

`visit` is optional: `def forage(seen)` works too.

### TypeScript

```ts
function flower(challenge: Challenge): Response

function forage(seen: [Challenge, Response | null][],
                visit: { fed: boolean; nectar: boolean | null; flowers: number }): ["ask", Challenge] | "feed" | "leave"
function tasted(seen: [Challenge, Response | null][], nectar: boolean): void   // optional
```

In TypeScript, `tree[T]` is `{ value: T; children: Tree<T>[] }` and a graph is
`{ nodes: number; edges: [number, number][] }`.

Every program can read a `GAME` dictionary/object: `feed_cost` (rounds a feeding bee sits out),
`challenge_type`, `response_type`, `max_len`, `max_nodes` and `ms` (your program's own time limit per
call, in milliseconds). It doesn't
say what time it is in the game.

Python programs may import `math`, `random`, `hashlib`, `string`, `itertools`, `functools`,
`collections`, `re`, `json`, `bisect`, `heapq`, `statistics`, `fractions`, `decimal`, `operator`,
`typing`, `dataclasses`, `enum`, `zlib`, `struct`, `binascii`, `base64`, `copy`, `numbers`, `array`,
and `time`. TypeScript programs get the standard JavaScript built-ins, including `Date`. A bee's
`random` is freshly seeded when it starts.

## Budgets

Each of your three programs has three budgets, and the room owner sets them per game. The three
programs get **different** budgets on purpose, measured against the orchid:

| Budget | Measures | clover | orchid | bee |
|---|---|---|---|---|
| **size** | your program's size in nodes (see below) | 1,100 (half an orchid's) | 2,200 | 11,000 (5× an orchid's) |
| **change** | nodes of change you earn per minute of play, and the most you can bank (a minute's worth) | 220 a minute, up to 220 | 1,540 a minute, up to 1,540 (7× a clover's) | 2,200 a minute, up to 2,200 |
| **compute** | milliseconds per call (flowers: the whole program, every question) | 150 (3× an orchid's) | 50 | 25 (half an orchid's) |

Why it's lopsided:
- **Clovers** are small but powerful: they can spend 3× an orchid's compute on every answer. That
  makes effort a signal. An answer that takes real work to produce, like a big graph that fits a
  tricky rule, is hard for an orchid to fake in a third of the time. With randomness and a clock, a
  clover can search for as long as its budget allows and return the best it found, so how good its
  answers are shows how hard it worked. But clovers change slowly.
- **Orchids** get more code and change fast. They make up for less compute with cleverness: a faster
  way to produce the same kind of answer, or a shallower look-alike, re-aimed whenever they see what
  the bees trust.
- **Bees** get lots of code for a whole kit of detectors, but only a little time per decision. So the
  best signals are ones that are **hard to make but easy to check**.

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
**goes live at once**: a flower's next answer comes from the new code, and a bee switches at its next
turn (leaving the flower it was at, and starting afresh).

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

**Everything the bees do, as it happens.** Every bee's every action is public the moment it happens:
whose bee, at whose patch, at which of its flowers (clover or orchid), every challenge and response,
every feed and whether it paid, every error, and how long each flower took to answer.

**Secret during play:** your code, what your bee prints, and your **code changes**: when you change a
program, how big the change was, what it cost, and how much change budget you have left. Other teams
only see what your programs *do*. (Your team sees all of its own.)

**When the game ends**, everyone can replay it with all of that revealed: every team's code changes
(when, how big, what they cost), their change budgets over time, which version of each program played
every turn, and (unless the owner turns it off) all code and all printouts.

## Scoring: Darwinian fitness

Two ledgers are kept, with one row per bee team and one column per patch team:

- the **feed ledger** counts how many times each bee fed at each patch (clover *or* orchid)
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

A clover that bees can recognise attracts feeds. An orchid gets fed when it answers like a clover
that bees trust, and every bee it fools learns to trust that kind of answer a little less. If your
orchid imitates **your own** clover, your clover's reputation pays the price. If it imitates
**another team's** clover, theirs does. Everyone sees every answer the moment it's given, so whatever
a clover does to be recognised, the orchids are watching too.

## After the game

Top teams get interviewed about their code. They teach the rest of us how it works, and other
players say how much they'd like to team up with them. Code you can explain beats code you can't.
