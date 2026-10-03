# Costly signals: a page of ideas

**Every team in this garden received this same document, and every team was told that every other team
has it.** It describes ideas, not rules, and it doesn't recommend any of them. Use them, change them or
ignore them. It contains no code.

## The principle

A bee can't see whose flower it is at. All it has is the answers. One way for an honest flower to stand
out is a **signal that is costly to produce and cheap to check**: an answer that takes real work to make,
which a bee can verify quickly.

- **Tie the work to the fresh challenge.** If the work depends on the challenge just asked, it can't be
  done in advance, and an answer seen earlier can't be replayed for a new challenge.
- **Scale the difficulty to the time limits.** A cosmos has 150 ms per answer. An orchid has less: 100 ms
  by default (config.json says what this garden uses). A puzzle where more time reliably buys a better
  answer lets a cosmos reach a level that an orchid usually can't. On the same machine the difference is at
  most the ratio of the two time limits. How cleanly the two can be told apart depends on how much the
  amount of work found varies from answer to answer: luck, and a busy machine, both add noise.
- **Bees verify cheaply.** A bee has 50 ms per decision, so checking has to be much cheaper than producing.
  A bee can count how much verified work an answer contains and compare it with a threshold.
- **The threshold sets the orchid's niche.** Set too low, orchids pass. Set too high, real cosmos answers
  fail. Bees can set a threshold, raise it, or learn it from what they see.

## Families of mechanisms

- **Hash proof of work.** Find inputs whose hash has a rare property tied to the challenge: a partial
  preimage, or a hashcash-style nonce whose hash starts with some number of zero bits. The answer can carry
  many nonces, or a chain where each link depends on the one before. Checking takes one hash per nonce.
- **Search puzzles with checkable certificates.** The challenge builds an instance of a hard search
  problem, and the answer contains a solution that is quick to check: a clique, a colouring, a labelling
  with some property, a factorisation. A graph answer can hold the certificate in its nodes, edges and
  labels.
- **Sequential work with cheap checkpoints.** Work that can't be split up, such as many steps of a
  function each feeding the next, with intermediate values in the answer so a bee can spot-check some steps
  instead of redoing all of them.
- **Anytime optimisation.** A search whose answer keeps improving with time, scored by a measure a bee can
  compute quickly. The bee grades quality instead of checking a yes-or-no proof.
- **Combining and adapting.** Several kinds of work in one answer, or a difficulty that changes with the
  challenge or over the game.

## The counter-moves to expect

- **Orchids** can cut corners: a faster search, approximate work, or a lucky partial result that clears a
  low threshold. They can precompute anything that doesn't depend on the challenge. And they can copy a
  rule they have cracked: if a cosmos's answer can be rebuilt without the costly part, so can an orchid's.
- **Bees** can randomise their challenges so nothing can be prepared, verify exactly instead of trusting
  how an answer looks, and track the levels they see over time to move their threshold.
- **Everyone** can read the public stream: every answer, and which kind of flower gave it. Whatever a
  cosmos shows, its rivals see too.
