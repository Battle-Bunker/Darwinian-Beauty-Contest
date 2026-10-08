# Fingerprints under the three-part energy rule: theory and proposal

Draft for the next honest-specialist experiment (adapt-hi). The numbers here are arithmetic and quick single
checks. Measurements will follow on an idle machine.

## The rule, and what one unit of each resource costs

E = (1100 − size) × max(0, R − CPU ms) × (1024 − response bytes) / 1024. A response over 1,024 bytes is refused.

Bytes are counted as compact JSON, UTF-8, with non-ASCII characters written raw.
- **Integers** are exact only up to 2^53, because the engine parses JSON numbers as doubles, so big numbers have to
  travel as strings.
- **The densest encoding** is printable ASCII without `"` and `\`: 93 symbols, 6.54 bits per byte. Non-ASCII
  characters carry fewer bits per byte.
- **The cheapest response** is one string label: `{"nodes":1,"edges":[],"labels":["…"]}` costs 36 bytes plus the
  string.

Marginal cost, as a share of E, for a cooperator at about 434 nodes and 84 bytes that spends 0.6 R:

| one more | costs |
|---|---|
| node of code | 0.15% |
| byte of response | 0.11% |
| ms of CPU | 1.7% at R = 150, 12.5% at R = 20 |

So a byte costs about as much as a node, and both are cheap next to CPU. Bytes matter when they grow with the
work, as a tally of certificates does.

## How bytes should be split between work and identity

- **Identity should cost no extra bytes.** In the integrated arrangement the signature, the direction of the four
  property levels, is read from the same object as the work. Bytes spent on separate identity proofs, such as
  tags or second objects, buy nothing an imitator can't also buy for the same bytes.
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

| encoding of the 48-node arrangement | response bytes | E kept (× bytes) | extra flower code |
|---|---|---|---|
| list of 48 numbers plus f (current) | 187 | 0.817 | none |
| **one character per node: chr(35 + position)** | **84** | **0.918** | about 5 nodes |
| Lehmer code in base 91 (log2 48! ≈ 203 bits) | 70 | 0.932 | about 20 nodes (that costs more than the 14 bytes it saves) |
| a seed the bee replays | about 45 | 0.956 | the bee would have to redo the flower's search, up to 90 ms of it: impossible in 50 ms |

The spend record f fits in one more character, chr(35 + round(50 f)), for 1 byte instead of about 6.
Conformance can also be read from the flower team's own ledger, which records each call's CPU ms and R.

## Wealth resolution per byte

| proof of work | bytes | how its level relates to work | spread at fixed work | notes |
|---|---|---|---|---|
| quality of the arrangement itself (integrated) | 0 extra | concave: fast gains, then slower | to measure | its identity comes free; at risk from a better optimiser (headroom test) |
| clique tally | about 6 per ms of work | linear | about 10% at R = 150 | bytes grow with wealth: unusable beyond a few units |
| one witness on a ladder of growing instances | about 10 | logarithmic (one rung about doubles the work) | high (luck) | one check; coarse |
| **hash, flagged:** the j lowest-hashing nonces of sha256(c, nonce) | about 8 per nonce | linear: work ≈ j / smallest hash | 1/√j (j = 4: 32 bytes, 50%; j = 16: 128 bytes, 25%) | needs your sign-off |

**The hash entry, flagged.**
- **What it is:** a partial-preimage proof of work that uses `hashlib`, which is importable in the game's
  Python. It is none of the excluded things: no key, no secret, no MAC, no chain, no signature. The bee checks it
  with j hashes.
- **What it gives:** the most wealth resolution per byte of anything here, with a linear reading. That's exactly
  where the arrangement may be weak.
- **Against it:**
  - It carries no identity.
  - It is the generic hash proof of work that the earlier priming documents avoided, and in the priming
    experiment (REPORT §22) it froze a cohort's innovation.
- I haven't used it anywhere.

## Proposal for the pinned cooperators

- **Flower: `integrated.py` refitted.**
  - One annealing run over the 48-node arrangement, weighted by W, for 0.6 R.
  - Response: `{"nodes":1,"edges":[],"labels":[S]}`, where S has 49 characters: character v is chr(35 + position
    of node v), and the last is chr(35 + round(50 f)).
  - That's 85 bytes.
- **Bee: `integrated_bee.py`.**
  - Decode positions as ord(S[v]) − 35, and check they form an arrangement of 0..47.
  - Score the four properties as exact z-scores against a random arrangement (about 1 ms).
  - The signature is the direction of z, and wealth is U = Σz read through the calibrated curve.
  - Feed when the weighted score passes the threshold, and learn per-property adjustments in `fed()`.
- **Per feed at equal R, in nectar per ms of R:**

  | flower | nectar per feed per ms of R |
  |---|---|
  | cooperator (`integrated.py`: 453 nodes, 85 bytes), 0.4 R left, 50% | 118 |
  | 40-node veteran, 15%, 50–170 bytes | 151–133 |
  | 40-node veteran, 25%, 50–170 bytes | 252–221 |

- **The case for a bee, then, is selectivity.**
  - A veteran's R is unknown, so blind feeding there pays its average: about 151 × 76.5 ≈ 11,600 per feed at 15%.
  - A cooperator's U shows its R, so a bee can feed only on rich turns. A cooperator turn beats a 15% veteran when
    R exceeds about 97 ms, roughly the top third of its turns.
  - Against 25% veterans it almost never wins: it would need R over about 140 ms.
  - `integrated_curve.py` will measure this with the real wealth read-back.
- **The levers that help most,** in order:
  1. a smaller flower (each 10 nodes is 1.5% of E)
  2. a sharper wealth read-back on rich turns
  3. bytes, which are already near their floor
- **The hybrid tally is out,** because its bytes grow with wealth.
- **If the arrangement's concavity or optimiser headroom is too large,** the fallback options for wealth are, in
  order: a one-witness ladder (about 10 bytes, logarithmic and coarse), or, with sign-off, j = 4 hash nonces
  (32 bytes, linear, 50% spread).

## To measure in the idle window

1. Concavity, spread and the read-back of R, for the refitted integrated flower.
2. Headroom: CPU saved by a stronger annealer at R = 20, 76 and 150, and the same for the exact tally search.
3. The selective-feeding numbers against veterans.
4. If needed, the ladder witness's resolution, and the hash nonces' resolution if you sign off.
