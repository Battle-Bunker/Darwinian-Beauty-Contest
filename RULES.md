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

Your clover and orchid grow together in your team's **patch**. Nobody else can see which of your two
flowers is which. All they see is "a flower from your patch".

## A round

Every bee gets **100 turns** (the owner can change this). The game hands your bee one flower at a
time, picked from a shuffled deck of every flower in the garden. Your own two flowers are in the deck
too, and every flower comes up once before any flower comes up again. At each flower your bee can:

- **ask** a challenge: costs **1 turn**. The flower answers with its response.
- **feed**: costs **5 turns** (the owner can change this). You get 1 nectar if it was a clover and 0 if it was an orchid. The visit ends.
- **leave**: free once you've asked something. The visit ends and the next flower appears.

You must ask at least once before you feed. A bee that leaves without asking anything still loses 1
turn. If your bee crashes, runs out of time or returns something odd, that costs 1 turn and counts as
leaving.

**Bees remember things during a round.** Top-level variables in your bee program last for the whole
round, so your bee can learn as it goes. They reset at the start of every round.

**Flowers remember nothing.** A flower is a *pure function*: the same challenge always gets the same
response. The whole flower program runs fresh for every single question, and `random` always starts
from the same seed. That means a flower can't count visitors or change its mind.

**Nobody knows who's who.** Programs never learn which team a flower or bee belongs to.

## What the challenge and response look like

Each game sets a **challenge type** (what bees ask with) and a **response type** (what flowers
answer with). Those types are all anyone knows at the start. **There is no starter code.** Every team
invents its own flowers and bee from scratch. Round by round, the logs let you work out the rules
other teams' flowers follow.

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

The node numbers give a graph landmarks to measure from, such as how many steps it is from node `0`
to node `1`, or to the last node, or how many neighbours node `0` has.

Strings and lists can be at most 64 long, and trees and graphs at most 64 nodes (graphs at most 256
edges, with no self-loops or repeated edges). The owner can change the 64. A response of the wrong
type or shape, a crash or a timeout reaches the bee as `None`/`null`.

## The programs

Each program is one function (two for the bee). Here are their shapes; what goes inside is up to you.

### Python

```python
# clover and orchid
def flower(challenge):
    ...  # return a value of the game's response type

# bee
def forage(seen, turns_left):
    # seen = [[challenge, response], ...] at the flower in front of you (empty when it arrives)
    ...  # return ["ask", challenge] (1 turn), "feed" (GAME["feed_cost"] turns) or "leave" (free)

def tasted(seen, nectar):   # optional: called right after you feed; nectar is True or False
    ...
```

Top-level variables in the bee program last for the whole round. Use them to remember things.

### TypeScript

```ts
function flower(challenge: Challenge): Response

function forage(seen: [Challenge, Response | null][], turnsLeft: number): ["ask", Challenge] | "feed" | "leave"
function tasted(seen: [Challenge, Response | null][], nectar: boolean): void   // optional
```

In TypeScript, `tree[T]` is `{ value: T; children: Tree<T>[] }` and a graph is
`{ nodes: number; edges: [number, number][] }`.

Every program can read a `GAME` dictionary/object: `turns`, `feed_cost`, `challenge_type`,
`response_type`, `max_len`, and `flowers` (how many flowers are in the garden). It does **not** say
which round it is. Programs change between rounds only when you change them.

Python programs may import `math`, `random`, `hashlib`, `string`, `itertools`, `functools`,
`collections`, `re`, `json`, `bisect`, `heapq`, `statistics`, `fractions`, `decimal`, `operator`,
`typing`, `dataclasses`, `enum`, `zlib`, `struct`, `binascii`, `base64`, `copy`, `numbers`, `array`.
TypeScript programs get the standard JavaScript built-ins except `Date`.

## Budgets

Each of your three programs has three budgets, and the room owner sets them per game:

| Budget | Measures | Default (clover / orchid / bee) |
|---|---|---|
| **complexity** | size of the program in syntax-tree nodes (comments are free) | 150 / 150 / 400 |
| **change** | how many syntax-tree edits you may make between rounds | 30 / 30 / 60 |
| **compute** | milliseconds per call (flowers: the whole program, every question) | 50 / 50 / 50 |

Before round 1 you can write anything within the complexity budget. After that, each round's
program must be within the change budget of the program that played the round before. If you don't
submit a new version, your previous one plays again. Teams need all three programs submitted before
round 1 to take part.

## What you find out, and when

**While a round plays**, everyone watches the garden: which team's bee visits which team's patch, how
many questions it asks, whether it feeds, and whether that feed paid off with nectar. Nobody can see
*which* flower in a patch the bee landed on, or the challenges and responses.

**After each round**, your team also gets private logs:

- **your bee's log**: every flower it visited, whose patch it was, every challenge and response, and
  what each feed gave you. You only learn whether a flower is a clover by feeding at it.
- **your flowers' log**: every bee that visited your patch, whose bee it was, which of your flowers it
  met, and what it asked and heard (unless the owner turns flower logs off).

When the game ends, all code and all logs are revealed to everyone (unless the owner turns that off).

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

Here N is the number of teams. Your own patch and your own bee count like any other team. Rounds add
up: the game score uses the ledgers of all rounds together, and each round also shows its own score.

So you want **lots of different bees to feed at your patch**, including at your orchid, and **your
bee to find nectar at lots of different patches**.

A clover that bees can recognise attracts feeds. An orchid gets fed when it answers like a clover
that bees trust, and every bee it fools learns to trust that kind of answer a little less. If your
orchid imitates **your own** clover, your clover's reputation pays the price. If it imitates
**another team's** clover, theirs does. Bees fight back by remembering exactly which answers paid off,
and by asking questions an orchid can't predict.

## After the game

Top teams get interviewed about their code. They teach the rest of us how it works, and other
players say how much they'd like to team up with them. Code you can explain beats code you can't.
