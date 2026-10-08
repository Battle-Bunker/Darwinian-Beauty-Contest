# Prevalence: an abstract model, not evidence about the game

The code here is an **abstract agent-based model**. It was built only to compare candidate formulas for the proposed
species-prevalence mechanic (pollination or fitness basis, cumulative or decayed memory, floor, prior, cap) against
each other, under one fixed set of stand-in behaviours. **It is not evidence about how the game or its metagame
behaves**, and its numbers (who gains prevalence, the value of discernment, whether cooperators or defectors do well,
whether monopolies or boom-bust cycles appear) should not be quoted as predictions for real games.

Even the comparison between formulas only holds inside the model's own dynamics. Those dynamics differ from the
real rules (RULES.md) in ways that bear directly on the questions it was meant to answer.

## Where it departs from the rules

- **Free, instant style changes and copying.** A defector copies another species' response style in one step, at no
  cost, and a copied species switches to a fresh style the same way (`updateFlower` in `sim.mjs`). In the game,
  every program change costs node edits from a change budget that accrues slowly (220 flower nodes a minute), so
  mimicry and evasion are slow and expensive.
- **Once-a-minute operator jumps.** Each team's "operator" acts once a minute, staggered: it recomputes its percent,
  its bee's acceptance table and its copy target all at once. This reintroduces the discrete phase changes that the
  game's continuous design removed. Real teams change programs at any moment, within their budgets.
- **Pinned blind bees.** The default population fixes 5 of the 14 bees as blind (they feed at everything, all game).
  Many results, above all defectors' gain under the pollination basis, depend on that fixed share of uncritical bees.
- **A 5-bin R signal.** A cooperator's costly signal is reduced to five noisy bins of R (3–10, 10–20, 20–30, 30–40,
  40–150 ms), read right 60% of the time, and a cheap copy always reads as low R. Real signals are programs whose
  readability, cost and forgeability are whatever teams build (see analysis/fingerprints/).

Other simplifications:
- **Bees with perfect pooled information.** Discerning bees value styles from complete public data, refreshed by
  their operator. They have no `MEMORY` limit, no `fed` learning, no handshakes and no self-feeding.
- **Idealised operators.** Each operator is a myopic best response using every bee's true acceptance rule, plus noise.
- **Simplified energy.** Each species' energy is a fixed function of R. Nothing ever fails, runs late or runs short
  on CPU, and the cooperators' percent is clamped to 20–80.

## Files

- `sim.mjs`: the model; it implements the prevalence formula as specified (decayed D_{s,b}, Q_s = Σ_b D^0.85,
  p_s = (c + P_s) / N(c + 1)).
- `run.mjs`: variant sweeps, `node analysis/prevalence/run.mjs <group>`.
- `lever.mjs`: a static calculation of how much prevalence lowers the percent a rate-maximising bee accepts.
- `results/`: outputs, with the same caveats.
