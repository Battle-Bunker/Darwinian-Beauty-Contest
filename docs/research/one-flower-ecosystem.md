# The one-flower ecosystem: score, equilibria, collapse risks, fixes

Analysis of the one-flower variant **as built** (branch `claude/one-flower`), with the rules as of 2661f14 and the
later decisions: surplus is now *pollen* (given to the bee to carry); pollination replaces allure and surplus; a bee
never learns whose species it faces until the turn is over; a bee keeps only ~1 KB of MEMORY between calls.

Evidence comes from cheap experiments only: no LLM calls, no server, no database.
- **Real engine:** `server/engine.js` `Garden` (snapshot of 2661f14, the real Python runner, CPU-timed flowers,
  50 ms bee deadlines), driven in-process with scripted bots.
- **Offline model:** `sim.mjs`, the same round structure and the same score (cross-checked against `score()`
  game by game), for equilibria that need thousands of games.

Scripts are in `analysis/one-flower/`, and raw tables in `analysis/one-flower/results/`.

## Conclusions

1. **Costly signalling can't work under these rules, by construction.** There are two reasons.
   - A signal's cost is paid only on a feed: E is lost when nobody feeds anyway.
   - A stingy flower values each feed *more* than a generous one: it gives more pollen per feed and less
     forage to a rival.

   So anything a generous flower can afford to show, a stingy one can afford and wants more. Expense only shrinks
   the pie of whoever pays.
   - Proof of work at 85% of the CPU: fitness 0.47 on the engine (G1) and 0.22 in the model (E6).
   - An expensive 400-node cooperator signal copied by a 40-node imitator: cooperator 0.63, imitator 0.93 (E10).
2. **What carries reputation is a signal that is unique, not one that is costly.** Every visit's species, response
   and (on a feed) percent is public, so bees learn collectively and in one round which species shows which signal
   and what it pays.
   - An *exact* copy can never be separated at decision time; bees can only pool it. Rival feeds at a mimic stay
     flat for the whole game (G6).
   - A 209-node flower that reads history and copies the best-paying rule at runtime lifts a 5% flower from 0.99
     to 1.16, and cuts the 60% flowers by about 12% (G3b).
   - Rotating the rule every 1–4 s doesn't shake it (G7).
3. **The user's moving-target dynamic exists, but only where recognising a signal is cheaper than generating it.**
   Moving pays when imitators need ≥ 30 s to copy and bees recognise the new signal at once: cooperator 1.14 with
   the move against 0.84 without (E10).
   - When rival bees must infer a new signal as slowly as imitators, a moving cooperator is just a *newcomer*,
     priced at the bees' prior for unknown signals.
   - Stingy whitewashers exploit that same prior: 1.61 at a 30% prior, while at a 15% prior moving starves the
     cooperator (0.54) (E10b).
4. **Public-key signatures end the race.** A 512-bit RSA signature costs 309 nodes (72% of a minimal flower's E;
   G-sig), can't be forged within a game, and turns the game into a static percent market at ~50–60% (E3).
   - Plain `int` responses (53 bits) can't carry one: Pollard rho breaks 64 bits in 0.024 s.
5. **Without unique signals the garden collapses into selfing autarky.**
   - **Pooled signals:** a commons; the percent to rivals falls to 0–15% and nobody gains by feeding at rivals (E3, E7).
   - **At N ≤ 3:** rational bees stop feeding at rivals altogether, with rival feed rates of 0.00–0.02 (E2).
6. **Selfing is a large, dull, universal component.** Greedy bees make ~42% of their feeds at their own species,
   which is only 1/6 of visits; never self-feeding costs 32% of fitness (E1). The best percent to one's own bee is
   ~50–60% (E4).
   - Excluding own cells works only with smoothed shares; otherwise the zero-total rule locks everyone at par (E12).
7. **Flower constancy as proposed weakens the dynamic.** A bee decides only whether to feed, and a rational one
   never carries a rival's pollen home. Rival pollen that counts falls to 0%, the own bee becomes a captive
   pollinator, and the best percent to rivals is 0 (E8).
8. **Two engine bugs let a flower compute for free:**
   - **TypeScript:** work done in `toJSON` isn't counted (140 ms of work charged 0.6 ms).
   - **Python:** for dict-shaped responses (`graph`, `tree`, `any`), work in a dict subclass's `items()` runs while
     the reply is encoded, uncounted and past the 150 ms limit (300 ms of work accepted, charged 0.8 ms).

## 1. The score function

| Quantity | Definition |
|---|---|
| excess energy E (per turn) | (1100 − flower size) × max(0, 150 − flower CPU ms); 0 if the flower is late, errs or returns a malformed pair |
| on a feed at percent p | nectar = p/100 × E to the bee's team; pollen = (1 − p/100) × E, given to the bee, credited to the flower's species |
| on a leave | nothing to anyone |
| pollination_f | Σ over bee teams b of √(pollen[b][f]) |
| forage_b | Σ over flower species f of √(nectar[b][f]) |
| share | value ÷ Σ over teams; **1/N if that Σ is 0** |
| **fitness** | **N² × pollination share × forage share** (par 1); own-team cells count like any other |

**Worked example** (N = 3; checked with `server/lib/scoring.js`).

The flowers' energies:

| Flower | Size | CPU | E per turn |
|---|---|---|---|
| A | 100 nodes | 0.5 ms | 149,500 |
| B | 300 nodes | 20 ms | 104,000 |
| C | 50 nodes | 1 ms | 156,450 |

The feeds, and the scores they produce:

| team | its bee's feeds | nectar row (A, B, C) | pollen column (from bees A, B, C) | pollination | forage | shares | fitness |
|---|---|---|---|---|---|---|---|
| A | 2× at A (50%), 1× at B (40%) | 149,500 / 41,600 / 0 | 149,500 / 104,650 / 0 | 386.7 + 323.5 = **710.1** | 386.7 + 204.0 = **590.6** | 0.352 × 0.637 | **2.015** |
| B | 1× at A (30%), 1× at C (10%) | 44,850 / 0 / 15,645 | 62,400 / 0 / 0 | **249.8** | 211.8 + 125.1 = **336.9** | 0.124 × 0.363 | **0.404** |
| C | 3× at C (0%: pure selfing) | 0 / 0 / 0 | 0 / 140,805 / 469,350 | 375.2 + 685.1 = **1,060.3** | **0** | 0.525 × 0 | **0** |

C has the most pollination and scores 0: a zero in either term is fatal.

## 2. The ecosystem to expect

| | Expected play | Evidence |
|---|---|---|
| **Flower size and CPU** | Minimal. Each 11 nodes is ~1% of E, and CPU is charged linearly. | An 11-node flower gets 98.6% of max E; a keyed handshake 94.7%; proof of work at 125 ms 14.8% (energy.txt) |
| **Percent to rival bees** | Set by how exactly the signal carries reputation:<br>• unique, unforgeable: 50–60%<br>• pooled: 0–15%<br>• naive bees: 0 | E3; G4 on the engine: the best response to 30% is 50% (1.06), while 5% gets 0.41 |
| **Percent to its own bee** (handshake) | ~50–60%; 0% costs 20% of fitness | E4, E12 |
| **Flower signal** | A cheap unique rule. A stingy flower copies the best-paying rule, at runtime from history (209 nodes, once) or in code (4 nodes per constant). | G3b, sig.md |
| **Bee** | Always feeds at its own species (exactly, via a handshake or its own rule) and feeds at rivals selectively: 28% of rival visits at N = 6. It values a shared signal as the average of the species that show it, and rebuilds all of this from HISTORY on every call. | E1; G5: 6.7 ms p99 after 10 minutes, so the 1 KB MEMORY doesn't bind |
| **Equilibria** | (a) Signatures: a static market at 50–60%.<br>(b) Learnable rules: a mimicry-polluted market in which cooperators lose 12–30%.<br>(c) No unique signals, or N ≤ 3: selfing autarky at par. | E3, E5, E7, E10, G3b |

**Reputation dynamics.** Percent is public on every feed, and species is public on every visit. So the whole
population learns (species, signal, percent) one round after the first visit or feed. Detection is collective and
instant, but it only *attributes*: while the copy is exact, a bee facing the signal can't tell model from imitator,
so the signal's value becomes the mixture.

**How stingy flowers still get fed.** All rows are fitness of a 5% flower.

| Tactic | Fitness, or effect | Source |
|---|---|---|
| Own signal (it gets found out) | 0.40 | E5 |
| Exact copy of a 50% flower's signal | 0.97; the model drops from 1.18 to 0.84 | E5 |
| Runtime history mimic (engine) | 1.16 (from 0.99) | G3b |
| No flower has a signal (pooled) | 1.21 | E5 |
| A fresh signal every round, with bees' prior at 30% | 1.57 | E5 |
| Partial defection: wearing the model's signal and paying 20–40% | 1.12–1.13; best | E11 |
| Naive bees | They feed at 5% flowers as at any other (17–30 rival feeds a game) | G3a |
| The √ in forage | The first nectar from any species is worth a lot, however small the percent | (structural) |

**Selfing, handshakes, collusion.**
- **Keyed handshake.** A MAC, in both directions, is exact even with `int`. Copying it gives nobody anything. It
  costs 86 nodes (23 s of budget) and ~8% of E.
- **Without a handshake** a bee still recognises its own species by its own rule, so the handshake adds little:
  G2 gives 1.10 with a handshake against 1.07–1.11 without.
- **Collusion** between species needs a shared secret, which can only be agreed in public (e.g. a Diffie–Hellman
  exchange through challenges). It's possible but unlikely.
- **Spite.** Spite against the leader is cheap because the scoreboard is public. Rational bees already avoid rivals
  at N ≤ 3.

**Role of challenge and response.** In order of importance:
1. a species fingerprint for rival bees
2. the selfing handshake
3. bee identity, which leaks through the bee's challenge style and through who is sitting out, so flowers *could*
   price-discriminate between bees

Costly work has no role.

**Where LLM complexity will go:**
- bees that mine HISTORY for ID cards, and classifiers pushed in by scaffolds (bee MEMORY is 1 KB, so learning moves
  to the operators)
- runtime mimics
- handshakes
- percent tuning against the public scoreboard
- signatures, where the response type allows them

Proof of work will appear only if it is primed, and it will lose visibly, since nectar per feed is public.

## 3. The user's theory, tested

> Committing code complexity to costly signalling specialises in cooperation; staying lean specialises in
> defection by imitation; rewarders keep moving, and cheaper signals that stay just ahead win.

| # | Hypothesis | Verdict | Numbers |
|---|---|---|---|
| H1 | Expense doesn't deter imitation; inference difficulty does, and a lean imitator may find a cheaper implementation | **Confirmed.** Cost only shrinks the payer's pie, and the stingy type values feeds more. | A 400-node cooperator signal copied in 40 nodes: cooperator 0.63, imitator 0.93 (E10)<br>A proof-of-work signal at 50%: 0.24, against 1.05 for a cheap signature<br>A stingy understudy doing the same work: 0.13 (E6)<br>Moving pays only when the imitator's lag (30 s) exceeds the bees' lag: 1.14 against 0.84 (E10) |
| H2 | Detection is collective and fast; an all-pollen imitator is exposed on its first feed; partial defection may beat all-pollen | **Detection: confirmed, but it doesn't separate. Partial defection: confirmed.** | **Detection window:** one visit (species) plus one feed (percent), learned by every bee by the next round. A history-rebuilding bee needs 6.7 ms p99 of its 50 ms at 10 minutes, and its state needs no MEMORY (G5).<br>**Separation window:** never, while the copy is exact. Rival feeds at the mimic stay flat across the game, 13 / 12 / 14 per third (G6).<br>**Imitator's best percent:** model 1.13 at 30%, 0.99 at 5%, 0.73 at 0%. The √ makes the first percent points the most valuable (E11). The engine with half the bees naive is flatter: 1.12–1.15 from 0% to 30% (G6). |
| H3 | Imitation lag comes from reverse-engineering, the 220-node/min budget, and free but secret lobby code | **Confirmed. The decisive lag is inference, not budget.** | **Budget per copy:** a parametric copy (new constant) costs 4 nodes, 1 s. The runtime mimic costs 209 nodes once (57 s), then follows every parametric move within one visit (G7).<br>**Structural copies:** S/220 minutes; a 400-node copy needs 2 steps, at least 1.8 min.<br>**Bees lag the same way:** rival bees need the same inference as imitators. With inference I for both, the cooperator's exclusive window per move is about S/220 min.<br>**Cycles per game:** S = 100 and I = 30 s give ~4 in 5 min and ~9 in 10 min. S = 400 and I = 60 s give 1–2 and ~3, at a 36% loss of E for both sides.<br>**Lobby:** lobby code is the free first move. §21 found no in-play copy of a novel rule; every exact copy came from the previous game's revealed code. |
| H4 | Signatures end the race | **Confirmed.** A static equilibrium; the race moves to percent and whitewashing. | **Cost of the key** (int → graph[any], key as decimal primes):<br>• RSA-128: 195 nodes, 0.83 of a minimal flower's E<br>• RSA-256: 233 nodes, 0.80<br>• RSA-512: 309 nodes, 0.72<br>• RSA-1024: 464 nodes, 0.57<br>Base64 literals would cut the key's nodes by ~45%.<br>**Factoring:** pure-Python rho needs ~27 min for RSA-128 and is hopeless for RSA-256. Real sieves break RSA-256 in minutes, so RSA-512 is the safe one-game key.<br>**Keys:** revealed at the finish, so each game needs a new one: 121 nodes of edits, free in the lobby.<br>**Outcome:** percent rises to 50–60% (E3), then nothing new. `int` can't carry a signature. |
| H5 | Selfing at 0% nectar is dominant and dull, and compresses differences | **Partly.**<br>• Selfing is dominant (42% of feeds) and dull.<br>• 0% to the own bee is *not* optimal (0.80): the own forage cell matters, and 50–60% is best.<br>• It compresses the spread a little. | Spread (max − min) in a mixed population (E12):<br>• counted: 0.42<br>• excluded, smoothed: 0.48<br>• self-pollination ×0.25, smoothed: 0.44<br>Excluded or discounted *without* smoothing, the zero-total rule locks rational bees out of pollinating rivals: rival feed rate 0.00. |
| H6 | Flower constancy strengthens the dynamic | **Refuted as proposed.** It weakens it. | **Constancy alone** (greedy bees; E8): rival pollen that counts is 0%, self-feeds are 33 of 39, the rival feed rate is 0.04, and the best percent to rivals is 0. A mimic barely matters (1.06 / 0.97).<br>**With self-incompatibility:** a zero-total lock (E9).<br>**What it would need:** delivery in the bee's own interest, self-pollen not counting, and smoothed shares. |

## 4. Design bugs and collapse risks, ranked

| # | Risk | Mechanism | Severity | Evidence |
|---|---|---|---|---|
| 1 | Costly signals can't separate | E counts only on feeds, and a stingy flower values each feed more (more pollen, less nectar to a rival), so the single-crossing condition is reversed | Critical for the goal | G1 (0.47), E6 (0.22, 0.13), E10 (0.63 against 0.93) |
| 2 | Exact mimicry is cheap and permanent | Bees can only pool identical signals. A history-reading mimic follows any parametric signal within one visit. | Critical | G3b (+17% to the mimic, −12% to cooperators), G6 (no separation over time), G7 (rotation useless) |
| 3 | Autarky collapse | Pooled signals are a commons, so percent falls to 0–15%. Rival feeding stops at N ≤ 3. | High | E3, E7, E2 |
| 4 | Newcomer prior | A fresh signal is free at runtime, so whitewashers profit from any generous prior, and moving cooperators starve under a stingy one | High | E5 (1.57), E10b (1.61; 0.54) |
| 5 | Free compute (engine bug) | TypeScript `toJSON` runs after the CPU clock stops. In Python, a dict subclass's `items()` runs in `json.dumps` after the timer and the clock stop, so 300 ms is accepted past the 150 ms limit. | High (easy fix) | energy.txt: 140 ms of work charged 0.6 ms; 300 ms charged 0.8 ms |
| 6 | Selfing | Self-feeds triple-count: both own cells plus a perfect handshake | Medium | E1 (42% of feeds; −32% without), E12 |
| 7 | Zero cliffs | Shares fall back to 1/N on zero totals. The first rival pollen then hands that rival a share of 1, and pollen at 100% or a bee that never feeds score 0. This is latent today, because selfing seeds every total. | Medium, and grows with any rule that removes selfing | E9, E12, E1 |
| 8 | Signature capacity | `int` can't carry one; `graph[any]`, `str` and `list` can, and that ends the race | Medium (a choice) | sig.md |
| 9 | CPU noise and timeouts | E's coefficient of variation is ≤ 0.5%, but flowers near 150 ms time out under load (E = 0) | Low | energy.txt; G1 (125 ms proof of work timed out in 3 of 6 games) |

## 5. Improvements, ranked by the ongoing costly-signalling innovation they should produce

| # | Change | Why it should create ongoing innovation | How to implement |
|---|---|---|---|
| 1 | **Re-raised (you declined it): gate compute by percent** | It is the only lever here that reverses the single-crossing condition. A flower can only show T ms of bee-checkable work if it offered ≥ T/150 × 100%. So expense *proves* generosity, imitators can't fake the percent, and the race moves to the most checkable work per ms (puzzle families, sequential work, verification), where §22 showed LLM teams innovate. Every result in risks 1 and 2 argues for it. | In `readAnswer`: if `ms > percent/100 × flower.ms + slack`, the response is null and E = 0. It's post hoc and needs no runner change. A softer form is a floor, e.g. `max(15, percent × 1.5)` ms. |
| 2 | **Fix the free-compute bugs** | It keeps E an honest price; a prerequisite for any cost-based signal | TypeScript: stop the clock after `JSON.stringify`, or reject any value with `toJSON` or accessors. Python: keep the timer through encoding, and reject non-exact `dict`, `list`, `str` and `int` types. |
| 3 | **Make recognising cheaper than generating, but breakable on a game's time scale** | Bounded crypto gives a sustained race: key rotation against cracking, and endorsing a new key with the old one (a natural innovation path that keeps reputation across moves). | Size the response so a 96–128-bit modulus fits and a 512-bit one doesn't (e.g. `str` with `maxLen` 16–24). RSA-128 lasts ~27 min against pure-Python rho, and seconds against a sieve. Tune on dbc_one runs. |
| 4 | **Smooth the shares, then (re-raised, you declined it) exclude own cells** | It removes the zero cliffs and the dull selfing component, and differences widen (0.42 → 0.48). | `share = (x + ε) / (Σ + N·ε)`, with ε ≈ one feed's √pollen (300). Exclude cell (i, i) from both rootsums. Don't exclude without smoothing (E12). |
| 5 | **Rotate the environment between games** | It resets signal families and stops lock-in (§22, levers 2 and 4) | Per-game challenge and response types, primitive bans, and a shared checker library |
| 6 | **Play with N ≥ 6** | Rational bees stop pollinating rivals at N ≤ 3 | A room default and guidance |
| 7 | **Flower constancy, only if redesigned** | As proposed, it makes recognition worthless (H6) | It would need smoothing, self-incompatibility, and a flower told whether the visiting bee carries its pollen, so it can pay for delivery. Untested in full. |

## 6. Experiment tables

**Energy on the real runner** (`energy.mjs`, 100 calls each; E max 165,000):

| flower | size | CPU ms p50 | E p50 | share of max |
|---|---|---|---|---|
| minimal (echo) | 11 | 0.57 | 162,727 | 0.986 |
| keyed sha256 handshake | 53 | 0.72 | 156,292 | 0.947 |
| reads 3,600 history entries per call | 49 | 0.99 | 156,605 | 0.949 |
| hashcash, 12 bits | 52 | 3.33 | 153,756 | 0.932 |
| proof of work to 125 ms | 90 | 125.78 | 24,469 | 0.148 |
| TypeScript, 60 ms in `flower()` | 52 | 61.03 | 93,242 | 0.565 |
| **TypeScript, 140 ms in `toJSON`** | 59 | **0.57** | 155,555 | 0.943 |
| **Python graph, 300 ms in `dict.items()`** | 111 | **0.81** | 147,557 | 0.894 |

**Scripted games on the engine** (`games.mjs`; N = 6 unless noted; 600 rounds; mean of 4–6 games).

| game | setup | result |
|---|---|---|
| G1 | N = 4, naive bees, four flowers at 30% | fitness by flower: rule 1.33; with handshake code 1.23; proof of work 60 ms 0.97; proof of work 125 ms 0.47 |
| G2 | selfing | handshake + greedy 1.10; handshake + self-only 0.59; handshake + naive 0.94; no handshake + greedy 1.07–1.11; no handshake + naive 1.05 |
| G3a | flowers at 60, 60, 30, 30, 5 and 5%, greedy and naive bees | nectar per rival feed, greedy against naive: 74k vs 41k, 87k vs 52k, 79k vs 58k<br>5% flowers: 0.99 with a greedy bee, 0.70 with a naive one |
| G3b | G3a with team 4 as a runtime mimic | mimic 0.99 → 1.16; the 60% teams 1.03 → 0.90 and 0.98 → 0.85 |
| G4 | team 0's percent to rivals, against 30% | 5%: 0.41; 15%: 0.78; 30%: 1.01; **50%: 1.06**; 70%: 1.00 |
| G5 | 10 minutes, bees rebuilding from history every call | bee decision time 2.3 ms p50, ≤ 6.7 ms p99; 0 too slow |
| G6 | the mimic's percent | mimic fitness 1.12 / 1.14 / 1.15 / 1.14 / 1.01 at 0 / 5 / 15 / 30 / 45%<br>rival feeds at the mimic flat across thirds of the game |
| G7 | 60% flowers rotate their rule every 4 s or 1 s | the mimic still gets 1.08–1.13 (1.16 against static rules) |

**Model tables** (`sim-experiments.mjs`, 40 seeds) are all in `results/sim.md`:

| Table | What it tests |
|---|---|
| E1 | bee strategies |
| E2 | the number of teams |
| E3 | percent equilibria |
| E4 | percent to the own bee |
| E5 | mimicry and whitewashing |
| E6 | proof of work |
| E7 | autarky stability |
| E8, E9 | constancy and self-incompatibility |
| E10, E10b | the moving-target dynamic |
| E11 | partial defection |
| E12 | selfing variants |

## 7. The earlier hypotheses, revisited

| # | Earlier hypothesis | Now |
|---|---|---|
| 1 | Flowers shrink; proof of work loses ~85% of E | Confirmed: 85.2% of E lost; fitness 0.47 (G1) |
| 2 | Generosity is a free dial; only reputation separates | Confirmed and sharpened: the single-crossing condition is *reversed* (conclusion 1) |
| 3 | The game becomes reputation and bandit learning by identity | Corrected: reputation rides on *signals*. Species are known only after a turn, so exact copies pool. |
| 4 | Feed cost makes bees choosy | Consistent: greedy bees feed at 28% of rival visits with feedCost 10 (not re-tested) |
| 5 | CPU-time noise | Negligible (E's coefficient of variation ≤ 0.5%), except for timeouts near 150 ms |
| 6 | Zeros in the product | Two hard zeros, plus the zero-total cliff (E9, E12) |
| 7 | Self-dealing | Large and universal (42% of feeds); autarky at N ≤ 3 |
| 8 | Compute leaks through nectar | Moot: E is public on feeds but mixes size with CPU. The real leak is uncounted encode-time compute (bug 5). |

## Reproduce

```sh
git archive 2661f14 server vendor package.json | tar -x -C /tmp/snap && ln -s $PWD/node_modules /tmp/snap/
DBC_ROOT=/tmp/snap node analysis/one-flower/energy.mjs          # results/energy.txt
node analysis/one-flower/sim-experiments.mjs --seeds 40         # results/sim.md (about 30 s)
DBC_ROOT=/tmp/snap node analysis/one-flower/games.mjs --reps 6  # results/games.md (G1–G5, about 2.5 min)
DBC_ROOT=/tmp/snap node analysis/one-flower/games.mjs --reps 4 --only g6,g7
DBC_ROOT=/tmp/snap node analysis/one-flower/sig.mjs             # results/sig.md
```

The bots use the ledger argument of 2661f14. The `HISTORY` global that replaces it carries the same records.
