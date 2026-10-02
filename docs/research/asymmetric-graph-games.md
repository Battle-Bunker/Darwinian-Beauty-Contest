# Asymmetric Graph Games Without Hashes

*Design notes, 2026-10-01*

A catalogue of optimisation puzzles where a challenge number **n** creates a fresh instance. Finding a good solution is expensive, but checking how good a submitted solution is stays cheap. The solution is shown as a graph. No hashes and no player IDs are used.

---

## 1. Goals

1. **Fresh instances.** The challenge n cues a unique instance. No useful work can start before n is known.
2. **Graded solutions.** There is no single answer to the challenge. Many solutions are valid, and each has a score.
3. **Cheap measurement.** The verifier can quickly confirm the solution is valid and compute its score.
4. **Asymmetry.** Reaching a high score costs much more than checking it.
5. **A graph certificate.** The proof of work takes the form of a graph: a vertex set, a drawing, a labelling, a colouring or a cycle.
6. **Teachable.** Many ideas from basic computer science can be used, and a bright high schooler can understand the rules.

---

## 2. Generating principles

### 2.1 The skeleton

| Part | Role |
|---|---|
| Challenge n | Drawn unpredictably from a huge range. |
| Instance | Mathematics expands n into a large instance. |
| Certificate | The graph the solver submits. |
| Verifier | Checks validity and computes the score with short nested loops. |
| Calibration | Reference solvers on many instances give a score-to-effort curve. |

### 2.2 Randomness comes from n; mathematics does the expansion

Without hashes, n must itself be unpredictable: the challenger picks it at random from a range too large to precompute. Mathematics then turns that short number into a large, irregular instance. Some ways it can do this:

- **Primes:** where they fall, and which sums are prime.
- **Squares mod p:** quadratic residues, which give the Paley graph.
- **Modular multiplication:** the times table on a circle.
- **Codes:** a Prüfer code reads n as a tree, and binary digits read n as a ban list.
- **Coefficients:** n chooses which equation applies.

### 2.3 Recipe A: a quasi-random object indexed by n, plus a classic hard optimisation

Take a mathematical object that is deterministic but looks random, and that changes when n changes. Then pose a well-known NP-hard task on it, such as clique, crossing minimisation or a Hamiltonian cycle.
*Examples: Paley clique hunt, times-table untangling, prime necklace.*

### 2.4 Recipe B: a famous extremal problem, plus constraints written by n

Start from an extremal combinatorics problem where near-optimal objects are notoriously hard to find. Let n impose constraints, such as banned distances, the equation to avoid, or the shape of the structure to label. Without the constraints, solutions are fixed public objects anyone can look up. With them, a solution prepared in advance almost certainly breaks one of n's constraints.
*Examples: Golomb ruler with forbidden distances, Schur colouring with n's equation, graceful labelling of the tree n.*

### 2.5 Scoring: "how far can you get"

The score is the length of the longest valid prefix or the size of the largest valid object: colour 1…L, place m marks, find a clique of size s. This scoring has three good properties:
- The score rises one step at a time.
- Each step tends to get steeply harder near the limit.
- Checking stays a short nested loop.

### 2.6 The cleverness-vs-work tension

- **Craft problems.** Good algorithms keep paying off, so the score measures skill and effort together.
- **Wall problems.** Cleverness pays off up to a known barrier. Past it nobody knows a shortcut, so high scores mainly measure effort.

The best problems have a **cleverness zone followed by a brute-force wall**. Without a lottery, the effort in a solution is read off the calibration curve, so it measures effort and skill combined.

### 2.7 Pitfalls

- **Problems solvable in polynomial time** (spanning trees, shortest paths, matching) have no work gradient, because the optimum is cheap. They are still useful as building blocks and baselines.
- **Problems with no input** (for example, the party problem at a fixed size) have fixed answers that can be reused. Recipe B's constraints from n are the fix.
- **Flattening near the top.** Some problems, such as TSP, let strong heuristics get close to optimal quickly. That makes them measure craft, not effort.
- **Nearby n gives similar instances.** Prüfer codes and bitmasks don't scramble anything, so n and n+1 can give near-identical instances. This is harmless only while n is unpredictable.
- **Shared instances.** The same n gives the same instance for everyone, so players could copy each other. If that matters, the game server can give each player a different n, which needs no player IDs.

---

## 3. The catalogue

### 3.1 Paley clique hunt (Recipe A, strong wall)

- **Instance:** p is the first prime ≥ n with p ≡ 1 (mod 4). Two numbers in 0…p−1 are friends if their difference is a perfect square mod p.
- **Task:** find the largest group of mutual friends.
- **Certificate:** a vertex set, which is a clique.
- **Verify and score:** the score is the group size. For each pair, one modular power checks that the difference is a square.
- **Why it's hard:** Paley graphs look random but are not. Their clique numbers are an open research problem, known only for small primes by exhaustive search.
- **Nice property:** the graph has p vertices but is never written down. Only the vertices in the clique are ever touched.
- **CS ideas:** greedy search, backtracking, branch and bound, modular arithmetic, exploiting symmetry.

### 3.2 Untangle the times table (Recipe A, craft contest)

- **Instance:** N dots on a circle. Each dot is joined to its neighbour, and dot i is joined to dot (n·i mod N). This is the "times tables on a circle" picture.
- **Task:** move the dots anywhere to redraw the graph with the fewest edge crossings.
- **Certificate:** coordinates for every dot, which is a drawing of the graph.
- **Verify and score:** the score is the number of crossings, counted by testing every pair of segments.
- **Why it's hard:** crossing minimisation is NP-hard. Good heuristics exist, so this rewards skill more than it imposes a wall.
- **Nice property:** the certificate is literally a picture, and its quality is visible to the eye.
- **CS ideas:** segment intersection tests, force-directed layout, local search, simulated annealing.

### 3.3 Gracefully label the tree that *is* n (Recipe B, hardness uncertain)

- **Instance:** write n in base N. Its N−2 digits are a Prüfer code, which corresponds to exactly one labelled tree on N vertices. Every number is a tree.
- **Task:** label the vertices 0…N−1 so that the edge differences |a−b| are all different.
- **Certificate:** a labelled tree.
- **Verify and score:** the score is the number of distinct edge differences, with N−1 a perfect score.
- **Why it's hard:** the Graceful Tree Conjecture (that every tree has such a labelling) is open and has only been checked by computer for small trees. How hard large random trees are for heuristics is unknown, so this needs testing.
- **CS ideas:** Prüfer decoding, tree traversal, backtracking, local search.

### 3.4 Golomb ruler with forbidden distances (Recipe B, strong wall)

- **Instance:** write n in binary. If bit d is 1, distance d is banned.
- **Task:** place as many marks as possible on a stick of length L. All pairwise distances must be different, and none may be banned.
- **Certificate:** the mark positions. As a graph, this is the complete graph on the marks with all edge lengths distinct.
- **Verify and score:** the score is the number of marks. The verifier checks every pair.
- **Why it's hard:** each new optimal Golomb ruler took distributed.net volunteers years to find. A ruler prepared in advance almost certainly uses a banned distance.
- **CS ideas:** bitmasks, sets for distinctness, backtracking with pruning.

### 3.5 Schur colouring with n's equation (Recipe B, strong wall)

- **Instance:** n picks the coefficients of an equation, such as a·x + b·y = z.
- **Task:** colour 1, 2, 3, … with k colours so that no solution of the equation is all one colour, and get as far as possible.
- **Certificate:** a colouring of the numbers. As a graph, this is a colouring of the hypergraph of the equation's solutions.
- **Verify and score:** the score is how far the colouring reaches. The verifier checks every pair.
- **Why it's hard:** for the plain x + y = z version with 5 colours, the limit of 160 took a supercomputer proof of about 2 petabytes.
- **Caveat:** a few equation families have known formulas for 2 colours. Filter those out, or use 4 or more colours.
- **CS ideas:** greedy colouring, backtracking, SAT encoding, constraint propagation.

### 3.6 Prime necklace (Recipe A, hardness unknown)

- **Instance:** the numbers n+1 … n+N.
- **Task:** arrange them in a circle so as many neighbouring pairs as possible add up to a prime.
- **Certificate:** a cycle through all the numbers.
- **Verify and score:** the score is the number of prime-sum neighbours, checked with N primality tests.
- **Why it's hard:** primes act as nature's randomness here, and N and n together set how many partners each number has. Search methods for this kind of cycle are good, though, so it may turn out easy. It needs testing.
- **CS ideas:** primality testing, parity (only odd + even sums can be prime), Hamiltonian cycle search.

### 3.7 Summary

| Idea | Recipe | How n sets the instance | Hardness |
|---|---|---|---|
| Paley clique hunt | A | next prime ≥ n | Strong wall |
| Untangle the times table | A | multiplier n | Craft |
| Graceful tree | B | Prüfer code of n | Uncertain |
| Golomb ruler | B | banned distances from n's bits | Strong wall |
| Schur colouring | B | equation chosen by n | Strong wall |
| Prime necklace | A | the numbers n+1…n+N | Unknown |

---

## 4. Earlier designs (superseded)

These came up earlier in the discussion. They relied on hashes or player IDs, both now out of scope, and are kept here as a record.

- **Hash-seeded party problem (lottery mode).** Each seed is hashed into a red/blue colouring of the lines between n people. The solver tries seeds until no k people are all one colour. Work is exactly 1 ÷ the pass rate, measured by simulation. Hashing stops solvers steering toward a solution.
- **Hash-expanded random instances (craft mode).** The instance was Hash(challenge, player ID) expanded into random data: max clique or independent set in a random network, colouring, tournament ranking, TSP and max cut. The hardness notes still apply if a non-hash instance generator replaces the hash.
- **Score-weighted lottery (unexamined extension).** Each valid certificate was also a lottery ticket, with an easier target for better scores.

---

## 5. Open questions

- Do 3.3 (graceful tree) and 3.6 (prime necklace) have a real wall, or do they collapse to easy heuristics? Test by simulation.
- Calibration curves (score against reference effort) still need measuring for every idea.
