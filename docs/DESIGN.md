# Design notes

## Names

| Thing | Name | Why |
|---|---|---|
| rewarding flower program | **clover** | White clover (*Trifolium repens*) is the archetypal honest nectar plant, the bread and butter of honeybee forage |
| deceptive flower program | **orchid** | The bee orchid (*Ophrys apifera*) is the archetypal deceiver: it offers nothing and looks like something it isn't |
| bee program | **bee** | |
| a team's two flowers | **patch** | Outsiders see the patch, never which flower |
| `feeds[s][o]` | **feed ledger** | times bee *s* fed at patch *o* (clover or orchid) |
| `nectar[s][o]` | **nectar ledger** | nectar bee *s* got from patch *o* |
| Σ√xᵢ | **rootsum** | the diversity-weighted size of an earnings vector |
| rootsum of a patch's feed column | **allure** | how widely a patch gets pollinated |
| rootsum of a bee's nectar row | **forage** | how widely a bee finds real food |
| allure ÷ Σ allure | **allure share** | par 1/N |
| forage ÷ Σ forage | **forage share** | par 1/N |
| N² × allure share × forage share | **fitness** | par 1.0 for any N; "relative fitness" is the population-genetics term, and 1 means holding steady |

Short version for players: *"Fitness = allure × forage, each measured as your share of the garden, scaled so
that average is 1."*

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly patch and a patch can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

## Should a bee ever skip its own clover?

No. A bee meets its own flowers only as often as the shuffled deck deals them (2 of every 2N
visits), so self-dealing is capped by the deck. It earns one rootsum term on each side, with
diminishing returns. It also leaks nothing:

- **The public garden** shows "team A's bee fed at team A's patch and got nectar". Everyone already
  knows every patch has one clover.
- **Challenges are only seen by the flower being asked.** A bee can recognise its own clover with a
  question no outsider can predict: a random challenge, answered by a salted hash only its own team
  knows. That costs no information at all. Outsiders' flower logs show only random numbers.

The real leak is a bee that asks the *same* recognisable question everywhere: every flower owner sees
it in their flower log. Teams that hardcode a fixed fingerprint question get mimicked: an orchid
learns to answer that question the way a known clover does. So rotating questions is a defence, and
the change budget makes fast rotation-chasing costly for both sides.

Teams *do* want outsiders to identify their clover only if outsiders' bees refuse to feed at patches
they can't read, which is the equilibrium question below.

## Honest patch vs. twin patch: a scripted probe

`analysis/bot-zoo.mjs` runs scripted strategies on the real engine (8 teams, 3 rounds, 2 seeds):

- **Patches:**
  - *honest*: the orchid is a different salted hash from the clover, so each flower has its own fingerprint
  - *twin*: the orchid is an exact copy of the clover, so the two are indistinguishable even to the owner
- **Bees:** all bees ask one random question per round, recognise their own clover, and tally nectar per answer.
  - *lax* keeps feeding at answers that paid at least half the time
  - *strict* only feeds where it always paid
  - *blind* feeds everywhere

Mean fitness (honest | twin) by number of honest patches out of 8:

| feedCost | bees | 2/8 | 4/8 | 6/8 |
|---|---|---|---|---|
| 3 | blind | 1.01 \| 1.00 | 0.98 \| 1.02 | 0.99 \| 1.03 |
| 3 | lax | 1.05 \| 0.98 | 1.06 \| 0.94 | 1.03 \| 0.90 |
| 3 | strict | 1.20 \| 0.93 | 1.13 \| 0.87 | 1.06 \| 0.80 |
| 5 | blind | 1.00 \| 1.00 | 1.00 \| 1.00 | 1.00 \| 1.00 |
| 5 | lax | 1.07 \| 0.98 | 1.06 \| 0.94 | 1.04 \| 0.89 |
| 5 | strict | 1.12 \| 0.96 | 1.07 \| 0.93 | 1.04 \| 0.89 |
| 10 | lax | 1.05 \| 0.99 | 1.07 \| 0.94 | 1.04 \| 0.90 |
| 10 | strict | 1.05 \| 0.99 | 1.07 \| 0.94 | 1.04 \| 0.90 |

Readings:

- **Against bees that learn by tasting, honesty slightly beats indistinguishability.** A twin
  patch's shared fingerprint gets cut off whenever a bee happens to taste the orchid first. An
  honest patch's clover keeps a clean 100% reputation, and its orchid still collects one exploratory
  taste per bee. Deception pays only against bees that can't learn within a round (*blind*), and
  there it's a wash.
- **Twin patches suffer most when twins are rare** (6/8 honest: 0.80–0.90). Strict bees punish them hardest.
- **Lax vs. strict bees earn about the same forage** (within ±4% in every mix), so neither bee
  policy is dominant and the bee side stays open.
- This probe only compares *self*-imitation (twin) with honesty. The next section covers imitating
  other teams' clovers.

## Imitate whose clover? Your own vs. a rival's

An orchid gets fed when it answers like a clover bees trust, and every bee it fools trusts that
answer a little less. **Imitating your own clover spends your own clover's reputation. Imitating a
rival's clover spends theirs.** Since fitness is relative (shares of the garden), hurting a rival's
allure is worth almost as much as raising your own.

`analysis/cross-mimic.mjs` tests this with 8 scripted teams on the real engine:

- 2 **cross-mimics**: the orchid is an exact copy of a rival's clover
- 2 **victims**: honest patches whose clovers are being copied
- 2 **twins**: the orchid is a copy of their own clover
- 2 **untouched honest** patches

Bees fingerprint answers to a random question and keep a nectar tally per answer. Mean fitness, with
allure share × N and forage share × N in brackets (3 rounds × 4 seeds):

| feedCost | bees | cross-mimic | victim | twin | untouched honest |
|---|---|---|---|---|---|
| 3 | lax | **1.11** (1.16, 0.96) | 0.85 | 0.94 | 1.09 |
| 3 | strict | **1.13** (1.18, 0.96) | 0.84 | 0.85 | 1.16 |
| 5 | lax | **1.06** (1.08, 0.98) | 0.93 | 0.92 | 1.08 |
| 5 | strict | **1.06** (1.09, 0.97) | 0.92 | 0.91 | 1.11 |
| 10 | lax/strict | 0.95 (1.01, 0.94) | 0.96 | 0.94 | 1.15 |

- At the default and cheaper feed costs, **cross-mimicry beats self-mimicry** (1.06–1.13 vs 0.85–0.94).
  The victim takes about the same damage a twin does to itself.
- The mimic's forage dips slightly, because its own bee is fooled by its own orchid's borrowed
  answer. A smarter mimic bee would exclude it.
- Expensive feeding (10) makes bees picky enough that 50/50 answers stop paying, and mimicry dies.
- This is the *best case* for mimics: they know the victim's function exactly. In play, an orchid can
  only copy what its team learned from its bee's log (challenge → response pairs at clovers it fed
  at). So the defence is a clover whose answers on *unpredictable* questions can't be extrapolated
  from a log: secret, salted, or simply complicated. Meanwhile it must stay recognisable to bees
  that remember answers within a round. Flower logs reveal which questions rival bees ask, so bees
  that reuse fixed questions are the easiest to fool.

**What the LLM arena did early on** (`analysis/orchid-targets.mjs` runs every orchid and clover on the
challenges bees actually asked each round; 98 orchid-rounds, games 1–3 rounds in):

| orchid answers ≥50% like | share |
|---|---|
| a rival's clover only | 1% |
| its own clover only | 24% |
| both (own and rival clovers were identical) | 28% |
| neither | 47% |

The "both" share was an artifact of the original starters: every team got the same starter clover
and an orchid starter that copied it, and 3–4 of 6 teams in the int→int arenas never changed the
starter clover. So a copy of "the starter clover" imitated everyone at once. That priming has been
removed. Starters now use per-team random constants, and the orchid starter is a neutral formula
whose comment names both options (imitate your own clover or another team's).

### A back-of-envelope threshold

Suppose a fraction *h* of patches are readable, so a bee can tell clover from orchid with one ask.
A strict bee that only feeds at readable clovers earns `(h/2) / (1 + h·f/2)` nectar per turn, where
*f* is the feed cost. Feeding at an unreadable patch earns `0.5/f` per extra turn spent. Strict beats
lax once `h > 2/f`: for the default `f = 5`, that's when more than 40% of patches are readable. So
**feed cost is the main knob** for how much honesty the ecosystem can sustain. A higher feed cost
makes bees pickier, which rewards readable clovers. A lower one lets indistinguishable patches free-ride.

## Engine v2: making recognition worth more than novelty

The arena and the research notes ([signal-forensics](research/signal-forensics.md),
[signal-mechanics](research/signal-mechanics.md)) showed that recognising a clover barely paid. With
100 turns and 12 flowers, a bee met each flower about twice per round. Tasting each new answer once
used up most of the round, which capped an ideal learner near 0.68 precision. Orchids mostly earned
their feeds from bees' first tastes, not from imitation. v2 changes the economics:

| Change | Why |
|---|---|
| **100 turns per flower** (`turnsPerFlower`): 1,000 turns with 5 teams | Bees meet each flower 10–20 times a round. A taste is now a small share of the budget, and a bee that recognises clovers can feed at them again and again. Recognition finally compounds. |
| **Bee `MEMORY`**: earlier rounds' top-level data, read-only, indexed by round | Reputation survives between rounds without hardcoding answers into code (which costs change budget) and without asking leaky fixed questions. |
| **Asks after feeding** | A bee can study a flower once it knows the truth (nectar or not), building labelled data about generous flowers and fakes, within and across rounds. |
| **Asymmetric budgets** (orchid = reference): clover ½ complexity, 3× compute; orchid 70% change budget; bee 5× complexity, ½ compute | **Costly signalling**: a clover can spend effort an orchid can't afford on every answer: a bigger, harder instance of its pattern. Orchids answer with more code and faster adaptation (more efficient generators, shallower look-alikes). Bees get room for detector repertoires but little time per decision, so the winning signals are *hard to make, easy to check*. |
| **Fair compute**: at most one program per CPU core; flower process pools | When compute is the signal, a busy machine mustn't make a clover time out. Wall-clock limits with one program per core behave like CPU limits. CPU-time interval timers fire late on this VM's tickless kernel. |
| **`maxNodes`** separate from `maxLen` (default 512) | Room for impressive structures, e.g. graphs where the 0→(x mod 37) path length and the component sizes k·(prime factors of x mod 37) are both signals, and a clover proves effort by finding a large k. |

The expected dynamic is that discernment becomes consequential:
- A team's orchid should now steer clear of its *own* clover. A successful imitation would make discerning bees feed there less.
- Orchids should chase other teams' signals instead.
- Clovers should lean into whichever hard-to-compute, easy-to-check properties prove most discriminating.

## Engine v3: flowers are stateless, not pure

Under v2 a flower was a pure function: a fixed random seed, no clock, one cached answer per challenge
per round. The cohort games showed what that does (arena/REPORT.md §16). A bee asks the same number at
every visit and treats the answer as the flower's face. It tastes each face once and remembers which
faces paid. A clover with a secret hash key then has a face nobody can forge, and it costs nothing to
produce. Recognition came from repetition, not from any signal of effort.

In v3 (`pureFlowers: false`, the default), flowers are still stateless: the whole program runs fresh for
every call, so nothing carries over between questions. But each call gets fresh randomness and the
clock (`time`, `Date.now()`) and can read its own budget as `GAME.ms`. A clover can run an anytime
search, such as a local search for a big clique or an untangling with few crossings, and answer with
the best result it found within 150 ms. An orchid has 50 ms to fake one. Bees then judge how good an
answer is, not whether they have seen it before. The engine no longer caches answers, so every ask runs
the flower again and its compute stats count every call.

What v3 does not prevent: a team can still choose to write a deterministic clover, since nothing forces a
flower to use randomness. Such a clover can still be fingerprinted by repeating a question. Whether the
effort signal outcompetes that is what the v3 games test.
