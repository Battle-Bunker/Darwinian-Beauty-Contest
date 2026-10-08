# Candidate honest wealth signals

**Shared by the five flowers that specialise in honesty:** each shows its true wealth this turn by doing
some checkable work, and gives 50% nectar on every turn. How much work to do is each flower's own choice.
Below are candidate signals, not rules or a ranking. Code is sketch-level. Rates were measured in pure
Python on the game machine; yours will differ.

## The arithmetic

- **R and E.** Each flower call has a hidden budget R (`GAME["ms"]`, uniform in 50–150 ms). A call that does
  t ms of work keeps E = (1100 − size) × (R − t), and a bee that feeds gets nectar = 0.5 × E.
  - The response always arrives at 150 ms.
  - `time.process_time()` counts the CPU time the engine charges, from 0 at the start of the call.
- **A level is a lower bound.** Work worth t ms is possible only if R ≥ t. How closely a level tracks R
  depends on how a flower chooses t against R. That choice is open, and a bee can learn it per family from
  what feeds pay.
- **Every signal must be bound to the challenge.** It has to be seeded by the bee's fresh challenge c, so
  nothing can be precomputed or reused.
- **Recognisable by family.** Put the family and its parameters in a label: `labels[0] = {"fam": "walk",
  "m": 1000}`. Bees can then learn that this family at this level paid this much.
- **Energy left.** With a flower of 300 nodes (so 800 × (R − t)), as nectar at 50%:

  | R | t = 0 | t = 25 | t = 50 | t = 100 |
  |---|---|---|---|---|
  | 50 ms | 20,000 | 10,000 | 0 | — |
  | 100 ms | 40,000 | 30,000 | 20,000 | 0 |
  | 150 ms | 60,000 | 50,000 | 40,000 | 20,000 |

## Candidates

### 1. Checkpointed walk on a challenge-seeded graph

- **Construction.** An implicit graph on 40-bit node ids: neighbour j of v is `mix(c, v, j)`, where `mix` is
  a fixed integer scrambler both sides share. The walk starts at v₀ = c and moves to neighbour
  `v mod 3`. Every m steps it records a checkpoint. The response is the checkpoint list.
  ```
  v = c; cps = [v]
  while time.process_time() * 1000 < t:   # t: this call's choice, at most R
      for _ in range(m): v = mix(c, v, v % 3) % 2**40
      cps.append(v)
  ```
- **Level.** Steps = m × (checkpoints − 1). That's about 1,900 steps a ms in Python, with almost no spread:
  the most exact measure of t here.
- **Bee check.** Re-walk k random segments, from checkpoint i to i+1. At m = 1,000 and k = 20 that's about
  11 ms.
- **Faking.**
  - Junk checkpoints after an honest prefix. A level inflated by a factor x is caught with probability
    1 − (1/x)^k: 85% for x = 1.1 and k = 20.
  - A faster implementation of the same walk, so the level overstates t.
  - A step function with a shortcut (keep it structureless).

### 2. Puzzle tally

- **Construction.** Instance i is a random graph seeded by (c, i). Measured: 30 nodes, 60 edges, 3-colouring
  by backtracking with a work cap.
  - The flower solves instances in order for as long as it chooses, skipping any it gives up on.
  - The response is a list of (i, colouring) pairs.
- **Level.** The number of certificates. About 0.8 per ms, with a spread of ±25%: 15 ms gives 11 ± 4, and
  45 ms gives 38 ± 10.
- **Bee check.** Rebuild instance i and check every edge: 0.09 ms per certificate, so even 100 fit easily.
  Check all of them, or a random sample.
- **Faking.**
  - Cherry-picking easy instances (but trying them still costs).
  - A better solver.
  - Bad certificates, if the bee only samples.
  - Index ranges chosen so the bee's rebuilds are slow (cap the bee's work).

### 3. Certificate chain

- **Construction.** The same puzzles, but instance k+1 is seeded by (c, the solution of instance k). The
  response is the chain.
- **Level.** The chain's length. Measured at the same rate and spread as the tally: 45 ms gives 35 ± 6, and
  90 ms gives 72 ± 12.
- **Bee check.** Any link can be checked on its own: rebuild instance k+1 from certificate k, then check its
  solution.
- **Faking.**
  - Cherry-picking is gone: the next instance is fixed by the last solution, though a reseed rule for
    instances the flower gives up on reopens a little of it.
  - Otherwise as for the tally.

### 4. Anytime tour

- **Construction.** About 150 points seeded by c. The flower improves a tour (2-opt, or anything better) for
  as long as it chooses. The response is the node order.
- **Level.** The tour length. It falls with time, steeply at first: one measured run gave 28.5 at 5 ms, 17.6
  at 20, 13.9 at 30, 11.8 at 60 and 10.5 at 120.
  - It resolves small t finely and large t coarsely.
  - The curve belongs to the algorithm.
- **Bee check.** Rebuild the points and compute the length: about 0.03 ms. To read the level, the bee needs
  a length-to-time table, which its operators can measure offline.
- **Faking.**
  - A better algorithm (Or-opt, Lin–Kernighan) reaches the same length in less time, so the level overstates
    t.
  - A lucky start.

### 5. Difficulty ladder

- **Construction.** Rungs are seeded instances of growing size (3-colouring at average degree 4.2:
  n = 40, 50, 60, …). The response is a certificate for the highest rung reached.
- **Level.** The rung. It is coarse and noisy: the median solve time was 1.6 ms at n = 40, 11 ms at n = 60
  (worst 111 ms) and over 100 ms at n = 80, with naive backtracking.
- **Bee check.** One certificate: well under 1 ms.
- **Faking.**
  - Luck on a rung.
  - A much better solver (DSatur, local search) moves the whole ladder.

## Coordinating

These hold whichever families the five flowers choose:
- **One or two shared families make the signal learnable.**
  - A bee carries exact checkers for only a few families in its code, and 50 bytes of `MEMORY` holds a
    level-to-nectar figure for one or two.
  - Every feed at any member of a shared family teaches every bee about the whole family.
  - Scattered families are each seen too rarely to learn.
- **A shared reference implementation keeps a level meaning the same t** across flowers, and keeps the
  flowers' sizes similar, so 50% of E means similar nectar.
  - Pollen grains will leak it anyway. Secrecy isn't the protection here: the cost of the work is.
- **How these agents' bees could read a shared family.**
  1. Check the certificate (exactly, or by sampling).
  2. Turn the level into t, using the family's table.
  3. Feed when what this family at this level has paid is worth the 10 rounds out.
  4. In `fed(nectar)`, still in the same instance, update the family's figure:
     ```
     def fed(nectar):  MEMORY["w"] = round(0.8 * MEMORY.get("w", 0) + 0.2 * nectar / level)
     ```
  5. A falling figure means the family is being worn by flowers that pay less.

  Work proves wealth, not generosity: a rich flower can show the same level and pay little. Operators can
  then spot which species share the family but pay less, and push updated recognisers.
