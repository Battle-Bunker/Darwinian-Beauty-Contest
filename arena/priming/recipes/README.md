# Example flowers: costly signatures

**Every team in this garden received these same files, and every team was told that every other team has
them.** They are examples, not rules and not advice. Use them, change them or ignore them.

| File | What it is |
|---|---|
| `paley_cosmos.py` | example cosmos 1: a chain of Paley cliques |
| `graceful_cosmos.py` | example cosmos 2: a graceful labelling of a graph |
| `checkers.py` | two bee-side checkers, `check_paley` and `check_graceful`, to paste into a bee |

**The idea behind both.** A cosmos gets 150 ms per answer. An orchid gets 100 ms by default (the room
owner sets it, never more than a cosmos's). A bee gets 50 ms per decision. Each example is a puzzle that
the challenge number n builds fresh. More search gives a better answer, and anyone can score an answer
quickly, so the score shows roughly how much work went into it. Nothing is secret: anyone may run the same
code. What an orchid lacks is time. Each cosmos keeps searching until 65% of its time limit is used, then
answers with the best it has, because a flower that runs out of time gives no answer at all. The same n
can get a different answer each time.

## 1. Paley clique chain (`paley_cosmos.py`)

- **Friends.** Pick a prime p with p % 4 == 1. Two numbers are friends when their difference is a square
  mod p, that is when `pow(a - b, (p - 1) // 2, p) == 1`. A clique is a group of numbers that are all
  friends with each other. Big cliques are hard to find, and nobody knows a shortcut. Checking one takes a
  single `pow` per pair.
- **The instance.** n picks a starting point between 10^8 and 10^9 (`10**8 + n * 1234567 % (9 * 10**8)`).
  From there the chain is every prime p with p % 4 == 1, in order: p0, p1, p2, ...
- **The answer.** A path of nodes. Node k is labelled with a clique of 18 numbers for the k-th prime of the
  chain. The cosmos finds as many cliques in a row as it can in its time.
- **Checking.** `check_paley(n, answer, enough=None)` returns how many cliques in a row are real (0 if
  none), or `None` for a malformed answer. Each clique costs about 0.2 ms to check, and `enough=k` stops
  counting at k.
- **Why a chain?** The size of a single clique depends a lot on luck. The number of cliques found in a
  row grows steadily with time.

## 2. Graceful labelling (`graceful_cosmos.py`)

- **The instance.** n builds a graph with 512 dots and 1021 links. With t = n + 2**64, dot 1 links to dot
  0, and every later dot i links back to dot `t % i` and to one more earlier dot picked by `t // i`
  (see `build_links`).
- **The answer.** That graph, with every dot labelled by a different number from 0 to 1021. Its score is
  how many *different* differences `|label(a) - label(b)|` its links show (1021 at most, which would make
  it "graceful"). The cosmos starts from random labels, moves a random dot to a random free label, and
  keeps the move unless the score drops.
- **Checking.** `check_graceful(n, answer)` rebuilds the graph and counts the differences. It returns
  `None` if the answer is not that graph with proper labels. It takes under 1 ms.

## Calibration

Measured on the game's own runner, 200 random challenges per row: the example code run as a 150 ms
cosmos, and the very same code run as a 100 ms orchid (the default orchid limit). No answer timed out.

| Flower | Paley: average cliques | Paley: 9 in 10 had at least | Graceful: average score | Graceful: 9 in 10 had at least |
|---|---|---|---|---|
| Example cosmos (150 ms) | 22.9 | 19 | 918.3 | 910 |
| Same code as an orchid (100 ms) | 15.1 | 13 | 905.9 | 898 |

How often each reached a few thresholds:

| Threshold | cosmos (150 ms) | same code at 100 ms |
|---|---|---|
| Paley, 16 or more | 95% | 52% |
| Paley, 18 or more | 92% | 0% |
| Paley, 20 or more | 88% | 0% |
| Graceful, 906 or more | 94% | 54% |
| Graceful, 910 or more | 90% | 28% |
| Graceful, 914 or more | 78% | 12% |

The same code is not the best an orchid can do: a search written for speed, or using more of its 100 ms,
scores higher. In an earlier measurement (with an older 50 ms orchid limit), the best orchid we could
write scored about 40% more Paley cliques than the example code at the same time limit, and about 12 more
graceful points. A busy machine slows every flower down too, and how much varies from answer to answer.
