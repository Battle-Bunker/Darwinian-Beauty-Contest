# Example flowers: costly signatures

**Every team in this garden received these same files.** They are examples, not rules and not advice.
Use them, change them or ignore them.

| File | What it is |
|---|---|
| `paley_clover.py` | example clover 1: a chain of Paley cliques |
| `graceful_clover.py` | example clover 2: a graceful labelling of a graph |
| `checkers.py` | two bee-side checkers, `check_paley` and `check_graceful`, to paste into a bee |

**The idea behind both.** A clover gets 150 ms per answer, an orchid 50 ms and a bee 25 ms. Each example
is a puzzle that the challenge number n builds fresh. More search gives a better answer, and anyone can
score an answer quickly. So the score shows roughly how much work went into the answer. Nothing is
secret: anyone may run the same code. What an orchid lacks is time. Each clover keeps searching until
65% of its budget is used, then answers with the best it has, because a flower that runs out of time
gives no answer at all. The same n can get a different answer each time.

## 1. Paley clique chain (`paley_clover.py`)

- **Friends.** Pick a prime p with p % 4 == 1. Two numbers are friends when their difference is a square
  mod p, that is when `pow(a - b, (p - 1) // 2, p) == 1`. A clique is a group of numbers that are all
  friends with each other. Big cliques are hard to find, and nobody knows a shortcut. Checking one takes a
  single `pow` per pair.
- **The instance.** n picks a starting point between 10^8 and 10^9 (`10**8 + n * 1234567 % (9 * 10**8)`).
  From there the chain is every prime p with p % 4 == 1, in order: p0, p1, p2, ...
- **The answer.** A path of nodes. Node k is labelled with a clique of 18 numbers for the k-th prime of the
  chain. The clover finds as many cliques in a row as it can in its time.
- **Checking.** `check_paley(n, answer, enough=None)` returns how many cliques in a row are real (0 if
  none), or `None` for a malformed answer. Each clique costs about 0.2 ms to check, and `enough=k` stops
  counting at k.
- **Why a chain?** The size of a single clique depends a lot on luck. The number of cliques found in a
  row grows steadily with time, so 3× the time gives about 3× the score.

**Calibration** (300 random challenges per row; score = cliques in a row):

| Flower (time per answer) | Average | 9 in 10 answers had at least | Answers with at least 13 |
|---|---|---|---|
| Example clover (150 ms) | 23.6 | 18 | 100% |
| Example clover on a 1.5× slower machine (100 ms) | 14.8 | 11 | 80% |
| Example clover's code used as an orchid (50 ms) | 6.9 | 5 | 0% |
| Best orchid we could write (50 ms) | 9.7 | 7 | 6% |

With a busy loop sharing the CPU (about 1.5× slower for both flowers), the clover averaged 15.2 cliques
and the best orchid 6.8. Then 10 or more cliques came from the clover 94% of the time and from that orchid
1% of the time. Checking 13 cliques took about 2-3 ms.

## 2. Graceful labelling (`graceful_clover.py`)

- **The instance.** n builds a graph with 512 dots and 1021 links. With t = n + 2**64, dot 1 links to dot
  0, and every later dot i links back to dot `t % i` and to one more earlier dot picked by `t // i`
  (see `build_links`).
- **The answer.** That graph, with every dot labelled by a different number from 0 to 1021. Its score is
  how many *different* differences `|label(a) - label(b)|` its links show (1021 at most, which would make
  it "graceful"). The clover starts from random labels, moves a random dot to a random free label, and
  keeps the move unless the score drops.
- **Checking.** `check_graceful(n, answer)` rebuilds the graph and counts the differences. It returns
  `None` if the answer is not that graph with proper labels. It takes under 1 ms.

CALIBRATION_GRACEFUL

## How these numbers were measured

The examples ran on the game's real runner on a 4-core machine, with 300 random challenges per row. Other
programs were running at the same time. "Best orchid" is the strongest 50 ms orchid we could write for
each puzzle: the same search with every speed-up we found, using 80% of its budget. "Clover code as an
orchid" is the example clover's own code run with an orchid's 50 ms. "Clover, 1.5× slower machine" is the
clover with its budget cut to 100 ms. A timeout gives no answer at all, and none happened in these runs.
