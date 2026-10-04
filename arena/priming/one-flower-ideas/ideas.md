# Signalling ideas for the one-flower garden

**Every team in this garden received this same document, and every team was told that every other team
has it.** It holds ideas and principles, not rules or recommendations, and doesn't say which will work. The
code fragments are sketches, not programs.

## What shapes a signal here

- **A bee decides on the signal alone.** It sees the challenge and the response; the species and its percent
  come only after the turn. So a reputation must attach to something visible in the response.
- **Feeds and species are public after each turn.** `HISTORY` shows everyone each turn's species, challenge,
  response and whether the bee fed, and on a feed its percent, energy, nectar and pollen. Every bee can learn
  what a signal paid from every bee's feeds.
- **Anything a bee can learn, a flower can learn.** A signal recognisable from public data can be reproduced
  by another species, unless reproducing it needs something that never appears in public.
- **Energy is the budget.** E = (1100 − size) × (150 − CPU ms). A node of flower code costs about 0.09% of the
  maximum E on every turn (literals cost a node per byte, so a key's digits count). A ms of CPU costs about
  0.67%. Compute shrinks nectar and pollen alike.
- **Cost alone doesn't show generosity.** Every species has the same 150 ms and 1,100 nodes, and a flower gives
  energy only when the bee feeds. A flower that gives little nectar can do any work a generous one does. Work
  can bind a response to a fresh challenge, or make a signal hard to produce for those who don't know how.
- **Bees run fresh every call:** 50 ms, 11,000 nodes, all of `HISTORY`, and about 1 KB of `MEMORY` (emptied by
  a new bee version). What a bee learns must fit in `MEMORY` or be recomputed within the call.
- **Responses are `graph[any]`:** up to 512 nodes with JSON labels (strings ≤ 64 characters, lists ≤ 64 items).
  Integers above 2^53 lose precision, so big numbers travel as strings: 64 hex characters (256 bits) a label.
- **Code is revealed when a game ends,** so secrets and keys last one game. Lobby code is free; in play a
  change costs node edits from 220 a minute (a changed literal costs its changed bytes).

## Families of ideas (in no particular order)

### Unique, hard-to-infer signals

- **What.** A rule from a large family with secret parameters, such as a labelling or graph structure fixed
  by the challenge and a secret. Bees recognise a species' rule from its samples in `HISTORY`.
- **Hard to copy, cheap to check.** Recognising and copying both need the rule inferred from public pairs, so
  protection lasts as long as that takes. A pure keyed hash, `sha256(secret + challenge)`, can't be inferred,
  but nobody without the secret can check it either.
- **Energy.** Tens of nodes and well under 1 ms: a few percent of E.
- **Counter-moves.** Inferring the rule; a flower that reads `HISTORY` in play and answers with a well-paying
  species' rule; replaying a recorded response to a repeated challenge. Changing the rule (by hand, or from a
  secret and the round number) resets everyone's learning, bees' included.
- **Bee check.** Fit the rule from that species' rows in `HISTORY`, ask fresh challenges, check the fit.

### Public-key signatures and key rotation

- **What.** The flower signs the bee's fresh challenge and puts the signature and its public key in the
  labels. Reputation attaches to the key.
  ```
  flower:  s = pow(h(c), d, n)                  # labels: hex(s), hex(n), in 64-character chunks
  bee:     valid = pow(s, 65537, n) == h(c) % n # then look up n's record
  ```
- **Hard to copy, cheap to check.** A check is one modular power, well under 1 ms; forging needs the private
  key, which means factoring n.
- **Energy and cracking.** Signing takes 1–4 ms (1–3% of E); the key's digits are literals (hex or base64 are
  denser). A key derived from a short seed would cost CPU every call, since flowers keep nothing.

  | modulus | nodes, one simple signer | share of max E | factoring time |
  |---|---|---|---|
  | 64-bit | | | under a second, pure Python |
  | 128-bit | ~200 | ~18% | tens of minutes in pure Python; seconds with factoring software |
  | 256-bit | ~230 | ~21% | minutes to hours with factoring software |
  | 512-bit | ~310 | ~28% | far out of reach within a game |
  | 1024-bit | ~460 | ~42% | far out of reach within a game |

- **Counter-moves.** Factoring a small key; replaying a signature to a repeated challenge; signing under a
  fresh key (a new key has no record: bees choose what an unknown key is worth); a key that only looks
  similar (compare whole keys or long fingerprints).
- **Rotation.** Each game needs new keys. Within a game an old key can sign its successor so the record
  carries over; swapping a key literal costs about a node per changed byte.
- **Bee check.** Verify, then look up the percents paid on feeds under that key, in `HISTORY` or a fingerprint
  table in `MEMORY` (8 hex characters a key: dozens fit in 1 KB).

### Proof of work, and puzzles with checkable certificates

- **What.** Work tied to the fresh challenge: hashcash nonces, sequential steps with checkpoints, a hard
  search instance built from the challenge with a quick-to-check solution in the graph (a colouring, a clique,
  a labelling, a factorisation), or an anytime search a bee can grade.
- **Hard to copy, cheap to check.** It can't be precomputed or replayed for a fresh challenge, and checking a
  certificate is far faster than finding it.
- **Energy.** About 0.67% of the maximum E per ms: 15 ms is 10%, 75 ms is 50%.
- **What it shows.** That *some* flower worked on this challenge, not which species or how much nectar comes
  with it: any species can do the same work in 150 ms. It can carry something else, such as a puzzle fast
  only with a secret method, or work bound into a signature.
- **Counter-moves.** The same work from a species that pays less; corners cut to just above a threshold;
  precomputing whatever isn't tied to the challenge; replaying solutions to repeated challenges.
- **Bee check.** Verify the certificate, grade the work, and learn from `HISTORY` which levels came with which
  percents.

### Commitment and reveal across turns

- **What.** A response commits to something and a later one reveals it, so a promise is checkable afterwards.
  - **Hash-chain identity.** Round r's link is `sha256` applied K − r times to a secret seed, carried in each
    response. Hashing a link j times gives the link from j rounds earlier; nobody can compute the next link.
  - **Committed offers.** Each response carries `sha256(percent, salt)`, with salts from a key revealed later.
    Then anyone can check the offer on every turn, including turns without a feed, whose percent is
    otherwise private.
- **Hard to copy, cheap to check.** Nobody can compute a hash's preimage; a check is a few hashes.
- **Energy.** A seed literal, tens of nodes. A stateless flower recomputes its chain position every call, at
  about 1 µs a hash: a few ms for a whole-game chain, less with one short chain per epoch.
- **Counter-moves.** Never revealing; committing to something vague; starting a fresh chain (a new identity
  with no record).
- **Bee check.** Keep each chain's latest verified link in `MEMORY`; match reveals to commitments in
  `HISTORY`.

### Endorsement and attestation between species

- **What.** One species vouches for another's key with a signature over it, carried in either species'
  responses (copied from `HISTORY` if need be). An old key can endorse its successor; a signed statement can
  revoke a key.
- **Hard to copy, cheap to check.** An endorsement names its key, so a copy helps only that key's holder; a
  bee checks it with the endorser's public key.
- **Energy.** One more signature: about 1 ms in play, or its hex characters as literal nodes.
- **Counter-moves.** Endorsement rings among species that pay little; endorsing, then changing behaviour;
  endorsements never withdrawn.
- **Bee check.** Rate endorsers by how the keys they endorsed went on to pay; give an unknown key its
  endorser's record.

### Bee-side learning from public feeds

- **What.** Bees turn `HISTORY` into a table from response features (a key, a rule, a structure, a level of
  work) to the percents and nectar paid on feeds. Every bee's feed teaches every bee, so none has to test an
  unknown signal itself. Query only what's new and keep the table compact:
  ```
  new = HISTORY.turns.gt("round", MEMORY.get("r", 0)).eq("fed", True).rows()
  for t in new: update(MEMORY["tbl"], feature(t.response), t.percent)
  ```
- **What to look for.** One feature shown by two species (a copy, or a shared rule); a payoff that changes;
  how many visits a new feature takes to get a record.
- **Counter-moves.** Flowers that build the same table and show whichever feature pays best; features changed
  too often to get a record; flowers that tell bees apart by challenge style (random challenges keep a bee
  anonymous) or by which bees sit out after a feed.
- **Cost.** Queries and scans count toward the 50 ms, and a full rescan grows every minute.

These combine: a signature over work, an endorsed hash chain, a learned rule with a committed offer.
