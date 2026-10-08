# Fingerprints under the three-part energy rule: theory and starter

For the honest-specialist experiment (adapt-hi). Measured on the game machine (idle, Python, the game's real
runner).

## The mandate

Cooperators explore their own spend and generosity, within two floors:
- **BURN**, the share of R the flower spends on its search: at least 0.20. It must be the same fixed share of R on
  every call of a version, so that how far the search got keeps showing R. Change it only between versions.
- **PERCENT**, the nectar percent: at least 20.

Both are constants at the top of `integrated.py`. The starter has BURN = 0.6 and PERCENT = 50.

## The rule, and what one unit of each resource costs

E = (1100 − size) × max(0, R − CPU ms) × (1024 − response bytes), in node·ms·bytes. A response over 1,024 bytes is
refused.

**R is CPU time.** The call is stopped when its CPU reaches R (with a modest wall-clock backstop), and time.sleep
does nothing. Budget with time.process_time(), which reads 0 as the call starts, the program's own start-up
included. Don't guard with the wall clock: under load wall time runs ahead of CPU, so a wall guard would cut the
work short and could push a cooperator below its BURN floor.

Bytes are counted as compact JSON, UTF-8, with non-ASCII characters written raw.
- **Integers** are exact only up to 2^53, because the engine parses JSON numbers as doubles, so big numbers have to
  travel as strings.
- **The densest encoding** is printable ASCII without `"` and `\`: 93 symbols, 6.54 bits per byte. Non-ASCII
  characters carry fewer bits per byte.
- **The cheapest response** is one string label: `{"nodes":1,"edges":[],"labels":["…"]}` costs 36 bytes plus the
  string.

Marginal cost, as a share of E, for the cooperator flower (`integrated.py`: 405 nodes, 85 bytes):

| one more | costs |
|---|---|
| node of code | 0.14% |
| byte of response | 0.11% |
| ms of CPU | 1 / ((1 − BURN) R): at BURN 0.6, 1.7% at R = 150 and 12.5% at R = 20 |

So a byte costs about as much as a node, and both are cheap next to CPU. Bytes matter when they grow with the
work, as a tally of certificates does.

## How bytes should be split between work and identity

- **Identity should cost no extra bytes.** In the integrated arrangement the profile, the direction of the four
  property levels, is read from the same object as the work. Bytes spent on a separate identity proof, such as a
  second object or extra labels, buy nothing an imitator can't also buy for the same bytes.
- **Wealth should cost a fixed number of bytes, not bytes in proportion to wealth.**
  - A tally pays k characters per unit, so a rich turn pays the most: 90 cliques of 6 nodes is about 540 bytes,
    which leaves 47% of E.
  - The richer the flower, the less of its wealth reaches the bee. That works against the one thing the honest
    flower has to offer: rich turns a bee can recognise.
  - Under this rule a tally can only be a handful of units.
- **Resolution, check time and imitation resistance hardly depend on bytes.**
  - Resolution comes from how the level grows with CPU and how much it varies.
  - The bee's check costs about 1 ms whatever the encoding.
  - An imitator pays the same bytes for the same format.
  - Bytes add one new leak: the response size is public and constant per format, so the format itself becomes a
    fingerprint.

## Compact encodings

| encoding of the 48-node arrangement | response bytes | byte factor (1024 − bytes) | extra flower code |
|---|---|---|---|
| list of 48 numbers plus f (old) | 187 | 837 | none |
| **one character per node: chr(35 + position)** | **85** | **939** | about 5 nodes |
| Lehmer code in base 91 (log2 48! ≈ 203 bits) | 70 | 954 | about 20 nodes (that costs more than the 14 bytes it saves) |
| a seed the bee replays | about 45 | 979 | the bee would have to redo the flower's search, up to 90 ms of it: impossible in 50 ms |

The spend record f, the share of BURN × R actually spent, fits in one more character, chr(35 + round(50 f)), for
1 byte. Conformance can also be read from the flower team's own ledger, which records each call's CPU ms and R.

## Wealth resolution per byte

| proof of work | bytes | how its level relates to work | spread at fixed work | notes |
|---|---|---|---|---|
| quality of the arrangement itself (integrated) | 0 extra | concave: fast gains, then nearly flat beyond about 25 ms of CPU | about 1 in U | its identity comes free; a better annealer reaches the same U with about a third of the CPU |
| one witness on a ladder of growing instances | about 10 | logarithmic | high: an instance's solve time varies 1.3 to 2.3 times its mean | one check; coarse |
| tally of certified instances | 8 to 9 per unit | linear | count varies about 40% | over the 1,024-byte cap from about R = 20 in the list format; at 9 bytes a unit, still about 500 bytes at R = 150 |

**Measured: the arrangement's level against CPU** (equal weights, one fresh challenge per call). U depends on the
CPU the search got, BURN × R:

| CPU (ms) | 1.8 | 6 | 12 | 25 | 46 | 90 |
|---|---|---|---|---|---|---|
| R at BURN 0.6 | 3 | 10 | 20 | 42 | 76 | 150 |
| U, mean ± spread | 8.6 ± 1.7 | 13.4 ± 1.3 | 15.5 ± 1.6 | 17.3 ± 1.1 | 17.9 ± 1.4 | 18.4 ± 0.9 |
| profile read right (11 weightings) | 42% | 74% | 81% | 86% | 88% | 84% |

- U separates poor turns from the rest well. Above about 25 ms of CPU it is nearly flat, so at BURN 0.6 one response
  can't tell R = 76 from R = 150.
- Reading R back from U has a median error of 22–50% between R = 10 and 42 at BURN 0.6, and more above.
- A bigger arrangement (90 nodes, 127 bytes) only moves the flattening to about 25 ms of CPU.

## What BURN and PERCENT do

Measured over R uniform on 3–150 ms with the 410-node, 85-byte flower. For comparison, blind feeding at a 40-node
veteran pays per feed: 11.8M at 15% and 50 bytes, 10.3M at 15% and 170 bytes, 19.6M at 25% and 50 bytes, 17.2M at
25% and 170 bytes.

Two formulas follow from the rule with CPU = BURN × R, so they hold at any setting:
- **A turn pays** PERCENT/100 × (1100 − size) × 939 × (1 − BURN) × R. For the 405-node starter, on average that is
  about 50M × (1 − BURN) × PERCENT/100 per feed, which is what a blind bee gets.
- **A turn beats blind feeding at a veteran paying V per feed** when R > R* = V / (652,600 × (1 − BURN) ×
  PERCENT/100), again for the 405-node starter. (The grid's 410 nodes differ from it by under 1%.)

**Attractiveness to bees**, in node·ms·bytes per feed. The selective bee knows the setting (its BURN's curve and
its PERCENT), reads R from U, and feeds only above R*. The table shows what it gets per feed and the share of turns
it feeds.

| BURN | PERCENT | blind bee | vs a 15%, 50-byte veteran: R*, selective bee | vs a 25%, 50-byte veteran: R*, selective bee |
|---|---|---|---|---|
| 0.30 | 50 | 17.5M | 52 ms, 21.8M at 70% | 87 ms, 24.6M at 39% |
| 0.30 | 65 | 22.8M | 41 ms, 27.2M at 78% | 68 ms, 31.1M at 55% |
| 0.30 | 80 | 28.0M | 33 ms, 32.7M at 82% | 55 ms, 35.6M at 67% |
| 0.45 | 50 | 13.8M | 66 ms, 18.0M at 53% | 110 ms, 19.8M at 33% |
| 0.45 | 65 | 17.9M | 51 ms, 22.0M at 71% | 85 ms, 25.1M at 38% |
| 0.45 | 80 | 22.0M | 43 ms, 26.2M at 78% | 69 ms, 29.3M at 47% |
| 0.60 | 50 | 10.0M | 91 ms, 13.4M at 36% | never (R* > 150) |
| 0.60 | 65 | 13.0M | 70 ms, 17.2M at 46% | 117 ms, 18.0M at 30% |
| 0.60 | 80 | 16.0M | 57 ms, 20.4M at 58% | 95 ms, 21.6M at 34% |

**Readability.** PERCENT doesn't change the response; BURN does.

| BURN | U at R = 3 / 20 / 76 / 150 | profile read right (5 weightings) at R = 3 / 20 / 76 / 150 | median error reading R back at R = 20 / 76 |
|---|---|---|---|
| 0.30 | 2.1 / 13.6 / 17.1 / 18.1 | 37% / 72% / 91% / 85% | 16% / 30% |
| 0.45 | 6.5 / 14.9 / 18.1 / 18.7 | 47% / 85% / 89% / 95% | 8% / 41% |
| 0.60 | 8.5 / 15.9 / 18.3 / 19.1 | 60% / 89% / 88% / 87% | 18% / 26% |

What the grid shows:
- **Blind bees** see only (1 − BURN) × PERCENT, so lowering BURN and raising PERCENT move them the same way.
- **Selective bees** see the same product through R*. A lower R* means more of a cooperator's turns beat a veteran
  and a bee can feed more often, and the grid's selective bee gets more per feed.
- **Readability** depends on BURN. A lower BURN leaves the search less CPU at every R, so U is lower, mostly on poor
  turns. At R = 3, U is 2.1 at 0.30 against 8.5 at 0.60, and the profile reads right 37% of the time against 60%.
  From R = 20 up, all three burns read the profile right 72–95% of the time. Reading R back shows no clear trend
  across burns.
- **BURN 0.2 is unmeasured.** The formulas still hold: about 20.0M per feed to a blind bee at PERCENT 50, and 8.0M
  at 20. Readability is where to extrapolate with care. At R = 3 the search would get 0.6 ms, and 0.30 already reads
  only U = 2.1 there, so poor turns at 0.2 would likely read close to chance. How rich turns read at 0.2 is not
  known.
- **PERCENT 20, at any BURN,** is also outside the grid. By the formulas, blind feeding gets 4.0M (BURN 0.6) to 8.0M
  (BURN 0.2), and R* against the 15%, 50-byte veteran is 113 ms or more.
- **Changing BURN or PERCENT between versions** changes what a profile pays. A bee that learned the old rate
  re-learns it over its next few feeds.

## The starter flower and bee

- **Flower: `integrated.py`, 405 nodes.**
  - One annealing run over the 48-node arrangement, weighted by W, for BURN × R of CPU, read with
    time.process_time() (and never past R − 0.5 ms). It returns PERCENT.
  - Response: `{"nodes":1,"edges":[],"labels":[S]}`, where S has 49 characters: character v is chr(35 + position
    of node v), and the last is chr(35 + round(50 f)).
  - That's 85 bytes.
- **Bee: `integrated_bee.py`.**
  - Decode positions as ord(S[v]) − 35, and check they form an arrangement of 0..47.
  - Score the four properties as exact z-scores against a random arrangement (about 1 ms).
  - The profile is the direction of z. U = Σz is read through the reference curve (CURVE, the table above) as the
    CPU ms the search got.
  - It never sees BURN or PERCENT. Instead it learns, per profile, what a feed pays per ms of CPU, from fed(nectar).
  - **MEMORY:** one entry per profile, as many as fit in 50 bytes. The key is the profile in tenths, one letter per
    property; the value is the rate in thousands.
  - **Updates:** a reading within 3.5 tenths of a key counts as that profile. Each feed moves the profile's rate
    halfway toward what the feed paid, in log terms.
  - **The prior:** an unknown profile starts at the starter flower's rate (218 thousand per ms of CPU).
  - So the curve fixes only the shape, and the learned rates take up the scale. Other burns, other percents, and
    profiles whose U runs below the equal-weights curve are learned, not assumed.
  - It feeds when the predicted nectar, the rate times the CPU read from U, reaches NEED = 5M (the starter flower at
    about R = 40), and on 5% of other arrangements, so a rate learned too low can recover.
  - In a quick simulation with five cooperators at different settings, its predictions came within about 12% of
    what its feeds paid (median per profile), and it fed the more generous profiles more often.
  - On the real runner (measured before R became CPU time) a whole decision, including the program's start-up,
    takes 4.4 ms at the median and 8.4 ms at most, well inside 50 ms.
- **The levers that help most,** in order:
  1. a smaller flower (each 10 nodes is 1.4% of E)
  2. a sharper wealth read-back on rich turns
  3. bytes, which are already near their floor
- **The hybrid tally is out,** because its bytes grow with wealth.
- **Fallbacks for wealth are weak under this rule.** A tally exceeds the byte cap on rich turns, and a one-witness
  ladder is coarse and noisy. The arrangement alone remains the method. The tally files (fingerprint.py,
  fingerprint_compact.py, bee.py) are kept only as a fallback.
