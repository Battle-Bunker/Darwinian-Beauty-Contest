# Signal mechanics: letting rewarders stay ahead of imitators

Design note: theory and back-of-envelope arithmetic only (no simulations were run). Companion to
[signal-forensics.md](signal-forensics.md).

## Summary

- **Clovers can't out-design their copiers.** Every team writes a bee *and* an orchid, flowers are pure functions, and
  logs are symmetric, so anything a bee can learn about a clover, a rival orchid can be built from. The fix must change
  *who pays*: price the bee's check, make the copier pay, or make copied feeds worth less.
- **Today's binding constraint is tasting cost, not imitation.** In-round tasting caps precision at about 0.68 with
  6 teams and 0.57 with 8. That is where bees sit, even though most orchids copy nobody (forensics §2–3).
- **Engine-enforced honesty marks are all-or-nothing.** They are either useless or they kill the orchid, and a dead
  orchid means everyone ties: *more* compression. Good mechanics are bounded, with a knob that sizes the orchid's niche.
- **Top 3, all small:**
  - **Sip:** a 2-turn check that reveals nectar but doesn't pollinate.
  - **Patch-mates:** bees see a per-round patch letter.
  - **Pollen follows nectar:** a bee's feeds carry pollen in proportion to the nectar it found.

  Test Pollen first: it only needs the stored ledgers re-scored.

## 1. The asymmetry, precisely

Rewarders stay ahead when a bee can classify a flower for well under the cost of a wrong feed (*f* = 5 turns), and a
fooling earns an orchid's team less than it spends on edits, inference and delay. Bees have two ways to detect today:

1. **Remembered looks** (1 ask). Cheap, but copyable a round later by anyone whose bee saw the look. *Anything my bee
   can learn, my orchid can use.*
2. **Tasting** (1+*f* turns). Can't be faked: a copy answers identically (`flower.cache`), and only nectar
   (`visit.nectar`) tells them apart. But tasting is expensive.
   - The deck deals every flower once per lap (`draw()` in `server/engine.js`), so the exploration ratio
     ρ = turns / (2N(1+f)) is **1.39 at N=6** and **1.04 at N=8**.
   - A bee that tastes each unknown answer once and then exploits spends two-thirds of its round exploring. At N=6 it
     gets ≈10.7 nectar from ≈15.7 feeds (precision 0.68); at N=8 its precision is 0.57.
   - Knowing every clover would give 14.3 nectar.

**Cheap detection is copyable; uncopyable detection is expensive.** Detection beats imitation only if (a) a check costs
between 1 and 1+*f* turns, (b) copying costs the copier something, or (c) copies arrive late.

**Recognition must also pay, and it barely does.** In the lead's table, allure share×N rises only from 0.71 to 1.06,
from the least- to the most-fed clovers. Four dampers hold it down:
1. the deck allows only about 2.1 meetings per round;
2. bee memory resets every round;
3. rootsum discounts repeat feeds from one bee;
4. patch pooling: the orchid's fed rate rises from 0.32 to 0.55 as twins borrow the clover's name.

**The tension.** Rootsum per bee team pays for recognition by *many* bees. That needs a publicly learnable look, which
is exactly what a copier needs. Rootsum *forage* shields illegible patches as well. A bee wants nectar from every patch,
so it tastes unrecognised patches rather than skipping them, and their orchids pocket the tastes (+23–34% allure,
forensics §4). Skipping unknowns beats tasting only once a bee recognises **5 of 6** clovers. With plain-nectar forage
the threshold would be **3 of 6**. Today clovers have no gradient to climb.

| Source | Today | Assessment |
|---|---|---|
| Information | Equal between teams. At runtime, bees see nectar and pick questions after flowers are fixed | Strongest lever. Engine secrets are all-or-nothing; *structure* (who shares a patch) is bounded |
| Time | Bees learn in-round, orchids between rounds | Real, but capped by ρ. An orchid lag would give a bounded Red Queen lead |
| Resources | Equal budgets | Weak: learnable rules are short, and it rewards code volume |
| Cost (Zahavi) | Nectar is free to clovers | Honest flowers hold no extra currency to pay with. Price the *receiver's* check instead |
| Verification vs generation | Latent: a str→str clover can already RSA-sign with 3-argument `pow`, and nobody does, because it wouldn't pay | Works too well (the orchid dies) and favours specialist CS |
| Interaction | Multi-ask visits are legal | Catches answer tables, not rule copies. As in interactive proofs, soundness needs a secret or a cost |
| Scoring | An orchid feed counts like a clover feed | The cheapest lever. Fix the proxy (Goodhart): allure counts visits, but we meant pollination |

## 2. Candidates

| Mechanic (rule) | Why rewarders stay ahead | Fightback | Collapse risk | Age 12 | Code |
|---|---|---|---|---|---|
| **Nectar password**: each clover gets a per-round engine key, revealed by nectar | Barely: still one taste per clover per round. Only twins die | none | A garden-wide key means orchids die (MAC collapse) | medium | small |
| **Seasons**: clovers and bees see this round's season, orchids last round's | Season-using rules verify in 1 ask | Guess the season | Perfect, so orchid dies | medium | small |
| **Budget asymmetry**: orchids get ⅓ the nodes | Big rules can't be copied | Store only the answers bees ask | Bees can't learn big rules. Rewards volume | easy | config |
| **Proof-of-work**: a hash puzzle only clovers have the compute to solve | Easy to check, hard to make | Better solvers | Orchids die; AI-favoured | hard | medium |
| **Hive memory**: bee variables persist across rounds | Recognition survives without spending change budget | Copy looks | A neutral amplifier; less log-reading | easy | small |
| **Waggle board**: every feed's (question, answer, nectar) is shown to all bees | Tasting is pooled N ways | none | Orchids die; volunteer's dilemma | medium | large |
| **Late-blooming orchids**: orchid edits take effect a round later | A new clover look gets one round where bees know it and nobody has copied it | Predict the next look | Twins are unaffected; needs recognition to pay | medium | medium |
| **Side by side**: two flowers dealt at once; feed at one | Trusted clovers win pairings, so clovers finally *compete* | Copy the most-trusted look | Batesian cycles hurt victims | easy | large |
| **Bring nectar home**: forage = total nectar | Skipping unknowns pays at 3/6 recognised, not 5/6, so legibility pays | Copy legible looks | Victims hurt | very easy | tiny |
| **Provenance**: persistent patch letters or code-age stamps | Originals are older than copies | none | Clovers freeze | easy | small |
| ★ **Sip** | An uncopyable check for 3 turns, not 6 | Copy looks that bees eat *without* sipping | Orchids starve if no look is trusted | easy | small |
| ★ **Patch-mates** | Deduction halves tasting. Faking a pair costs the faker its own clover | Bluff; fog | "Distinct hashes" roulette | very easy | small |
| ★ **Pollen follows nectar** | Fooled bees carry little pollen. Deception moves pollen; it doesn't create it | Fool the *picky* bees | Deception too cheap to bother with | easy | tiny |

**Separate clover and orchid allure makes pooling worse.** √a + √b ≥ √(a+b), so a split ledger rewards getting *both*
flowers fed, which is what a twin does. Weight the *bee*, not the flower; that is what Pollen does.

Making repeat feeds linear per bee would also reward discerning bees, but it pays self-dealing and alliances.
Müllerian rings fail because mimics join them for free.

## 3. Shortlist

**Shared bot zoo.** Python on the real engine; 100 turns, *f* = 5, 3 rounds × 8 seeds per cell.

| Role | Strategy |
|---|---|
| Clovers | C-f (legible formula), C-h (salted hash) |
| Orchids | O-h (distinct hash), O-t (twin of its own clover plus a handshake), O-x (exact copy of the most-fed legible rival clover) |
| Bees | B-t (taster: fresh random question each round, tastes unknown answers once, remembers); B-r (recogniser: knows last round's legible formulas from an oracle) |

**Replicator dynamics.** Run 30 generations from an LLM-like mix (80% C-f, 50% O-t, B-t and B-r). Each generation,
each team re-picks each role with probability 0.25, by logit on last generation's fitness.

**Metrics.**
- Nectar per turn.
- Orchid feed share.
- Victim penalty: victim minus untouched-honest fitness (0.07–0.16 today).
- Fitness std.
- Lock-in: any strategy above 90% of its role for 5 generations.

### 3.1 Sip: price the check, not the signal

**Rules text**

> At a flower your bee can also **sip**: it costs **2 turns** (the owner can change this). Your bee finds out whether
> this flower has nectar, but it doesn't drink: no nectar, and a sip doesn't pollinate (it isn't a feed). The visit
> carries on, so your bee can ask, feed or leave next. You must ask before you sip. `forage` may return `"sip"`; the
> optional `sipped(seen, nectar)` is called right after. The garden shows sips.
>
> Only feeds pollinate. An orchid gets pollinated only when a bee feeds without checking.

**For a 12-year-old.** Sipping is opening the fridge to see if there's food. Feeding is eating it. A fake flower only
wins when a bee eats without looking.

**Why it works.** Answers are cheap talk, and Sip lets the bee buy verification.
- A bee should sip a look when more than *s*/*f* = 2/5 of the flowers showing it are fakes. So mimics profit only
  while they're rare: textbook Batesian frequency dependence, with *s* as the knob.
- Exploratory tastes stop pollinating; in no-starter arenas they are 69–77% of orchid feeds today. A pure sipper gets ≈11.4 nectar at N=6
  (a taster gets 10.7), and orchids get none of its feeds.
- Victims of mimicry still get fed after a sip; the bee pays, not the victim.

**Trajectory.** At first, the few bees that sip starve hash orchids and honest orchids. By rounds 2–4, orchids copy the
looks that rival bees eat *without* sipping, which they can read from the garden and from flower logs. Sippers then
track a fake rate for each look, mimics hop from one trusted look to the next, and across games the fake rate hovers
near *s*/*f*.

**Fixes.** It fixes precision, but measure nectar per turn, because nectar/feed becomes partly true by construction
(Goodhart). It fixes rival imitation and eases compression a little. It doesn't fix clover stasis: clovers needn't move
when bees can check.

**Could collapse.** If no look is trusted, there's nothing to copy and orchids die. That's likely under rootsum forage,
so pair Sip with *Bring nectar home*. At *s* ≤ 1, every bee sips everything.

**Code.** A new action in the `runBee` loop, a `sipped` op in both runners, a `sipCost` setting, and a sip mark in the
replay.

**Experiment** (N=8).
- **Bees:** add B-s, which sips unknown looks and any recognised look whose estimated fake rate is above *s*/*f*.
- **Grid:** *s* ∈ {1, 2, 3} × forage ∈ {rootsum, plain} × O-x copies of one model ∈ {0, 1, 2, 4}.
- **Validate if all of these hold:**
  - O-x payoff falls as copies are added, and crosses the honest orchid's payoff at a fake rate of *s*/*f* ± 0.1.
  - The victim penalty is under 0.03.
  - Orchid share stays between 10% and 30%.
  - B-s beats B-t by at least 5% nectar.
  - At least one cell avoids lock-in.
- **Kill if** orchid share is under 5% in every cell.

### 3.2 Patch-mates: the pair is the signal

**Rules text**

> Each round every patch gets a letter (A, B, C, …), shuffled fresh every round. Your bee is told the letter of the
> patch each flower grows in: `forage(seen, turns_left, patch)`. Both flowers in a patch share its letter, and every
> patch has exactly one clover and one orchid. Letters change every round, so they never tell you which team is which.

**For a 12-year-old.** Knights and knaves: every patch has one honest flower and one liar. Catch the liar and you know
the other one is honest. A faker can't pretend to be another team's patch, because its own honest flower is standing
right next to it.

**Why it works.**
- **Deduction.** One taste resolves a whole patch.

  | | Nectar | Precision |
  |---|---|---|
  | Taster, N=6 | 10.7 | 0.68 |
  | With letters, N=6 | ≈12.5 | ≈0.83 |
  | Taster, N=8 | 9.3 | 0.57 |
  | With letters, N=8 | ≈11.8 | 0.77 |

- **It resolves the tension.** Recognition stays public, but a pair is costly to fake. Faking team A's pair
  {clover look R, orchid look S} means showing R *and* S under one letter, so the faker must dress its own clover as
  A's orchid, which bees skip.
- **Bluffs are bounded.** Copying R alone only fools bees that haven't yet met A's real patch this round.
- **Twins show as fog.** Both flowers give one answer under one letter.

**Trajectory.**
1. The bees that deduce jump in precision.
2. Twins are exposed as fog. Strict bees skip them; rootsum bees still feed there 50/50.
3. Bluffs appear, and bees answer with pair tables learned from logs.
4. Patches answer with an **anchor**: a stable, obvious orchid that lets bees find the clover by elimination, so the
   clover can change its look freely.
5. The mix of bluff, anchor and fog shifts with frequency.

**Fixes.** Precision and rival imitation (strongly), clover stasis in part (anchors make changing a clover free), and
compression a little.

**Could collapse.** Into "distinct hashes plus deduction": orchids earn a fixed ½ taste per bee per round whatever
they do. Watch for this under plain forage. With Sip on top as well, orchids die.

**Code.** A seeded per-round permutation in `simulateRound`, plus `patch` in the `forage` call. Runners pass it as a
third argument when the function accepts one.

**Experiment** (N ∈ {6, 8}).
- **Bees:** B-t; B-d, which is B-t plus one-clover-per-letter deduction; and B-p, which is B-d plus a table of last
  round's look pairs.
- **Patches:** C-f+O-h, C-h+O-h, fog (O-t), bluff (C-h plus an orchid copying the most-trusted rival look), and anchor
  (C-f re-constanted every round, plus a frozen, legible O-h).
- **Validate if** B-d beats B-t by at least 12% nectar at N=8, the victim penalty halves, and at least 2 patch
  strategies each hold 15% or more at generation 30.
- **Kill if** the deduction gain is under 8%, or both forage rules lock into one patch strategy with fitness std under
  0.05.

### 3.3 Pollen follows nectar: weight the bee, not the flower

**Rules text** (replaces the allure row)

> **Pollen.** Each round, a bee spreads as much pollen as the nectar it found, shared among the patches it fed at in
> proportion to its feeds there. A bee that found 6 nectar in 10 feeds leaves 0.6 pollen per feed; a bee that found
> nothing leaves none.
>
> | **allure** | rootsum of the pollen your patch received, counted per bee team |
>
> A feed from a picky bee is worth more than a feed from a bee that feeds anywhere. Fooling a bee doesn't make new
> pollen: it takes some of the pollen that bee would have brought to honest flowers.

**For a 12-year-old.** A bee only carries pollen from flowers it really ate at. Trick a bee and it goes hungry and
carries less pollen for everybody. Fooling a careless bee earns you almost nothing; a careful bee's visit is the prize.

**Why it works.**
- **Clover feeds create pollen; orchid feeds only move it.** A bee's pollen sums to its nectar. Each fooling moves about
  *p*, the fooled bee's precision (0.6–0.8), from that bee's other patches to the deceiver.
- **It answers the lead's question.** Discerning bees now reward a clover more, and breadth still counts. As in real
  meadows, pollination depends on pollinator constancy, not visits.
- **It addresses two dampers.** Twins fed by lax bees (*p* ≈ 0.5) earn about what an honest clover earns from one
  discerning bee (damper 4). Rootsum's √ discount now applies to quality-weighted feeds (damper 3).

**Trajectory.** The first game plays the same, but the leaderboard changes: twins and broad deceivers drop. After that,
orchids either aim at careful bees, which takes real craft, or settle for small exploratory income. Teams invest in bee
precision, which raises their forage *and* the pollen they hand everyone. Across games, being legible to the best bees
becomes the clover's job.

**Fixes.** Compression and pooling. Rival imitation still pays, but at a discount. Precision improves only indirectly.
Clover stasis is untouched.

**Could collapse.** If everyone goes honest, pollen ≈ nectar and teams tie again. Fooled bees keep *p* ≥ 0.5, so theft
keeps at least half its value.

**Code.** A per-round pollen ledger in `scoring.js`, summed across rounds in `games.js`.

**Experiment.**
- **Step 1 (zero cost):** re-score every finished game from the stored `rounds.feeds` and `rounds.nectar`. Compare
  rank τ against current fitness, fitness std, twin vs honest patch fitness, and the lead's fed-rate buckets.
- **Step 2:** re-run `analysis/bot-zoo.mjs` and `analysis/cross-mimic.mjs` under pollen scoring, plus the replicator.
- **Validate if** the twin and cross-mimic edges shrink by at least half (cross-mimic is 1.06–1.13 today), fitness std
  rises at least 20%, and the bucket gradient steepens.
- **Kill if** τ > 0.9, or the best orchid strategy gets under 5% of total pollen in every mix.

### How they combine

- Pollen combines safely with either of the other two.
- Sip + Patch-mates overshoots: orchids die.
- None of the three makes clovers compete with each other. I don't think stasis is the disease: a clover bees can verify
  needn't move. If you want clovers to fight for bees, add **Side by side** or **Bring nectar home**. Then add
  **Late-blooming orchids** so that the clover, not the copier, leads the Red Queen.

## 4. Simplifications

- **Bring nectar home** (forage = total nectar). Recommended.
  - It's simpler to say, and it removes rootsum's shield over illegible patches.
  - It decompresses the bee side. Today 1.5× the nectar gives only 1.22× the forage, so bees above 0.9 precision reach
    only 1.09 forage share×N (forensics §4).
  - It's safe, because the deck already stops a bee farming one patch. Keep rootsum for allure.
- **Scale turns with the garden** (turns ≈ 15 × flowers, so ρ ≈ 2.5). In-round learning then pays at every N.
- **Not recommended:**
  - **Patch visits** (land on a patch, feed one of its flowers): an orchid could only replace its own clover's feed, so
    deception would become sabotage.
  - **One flower program with a nectar flag:** twins would become the default.
  - **Single-question visits:** these remove the verification that Sip and Patch-mates need.

## 5. Junior coders vs pure delegation

The generic AI pattern already sits at the tasting ceiling: salted hash, tally bee, and a twin orchid with a handshake
(30 games). So the scripted "insight" team was only par: there was no headroom for an idea. A mechanic widens the gap
only if it raises the ceiling *and* reaching it needs a game-specific idea a kid can say in one sentence.

**Mechanics that widen the gap**, with the one-sentence idea each one rewards:
- **Patch-mates:**
  - "If this one's empty, that one's full."
  - "An obvious orchid is your clover's bodyguard." This is counter-intuitive, because LLMs default to twins.
- **Sip:**
  - "Sip a look only if more than 2 in 5 were fakes."
  - "Copy what rival bees eat *without* sipping." You get this from reading the garden.
- **Pollen:** "Fooling sloppy bees is worth almost nothing."
- **All three:** "100 turns, 12 flowers, 6 turns a taste: you can't taste everything twice."

**Mechanics that narrow it:**
- Proof-of-work and seasons.
- Anything where `hashlib` is the answer.
- Budget asymmetry and the waggle board, which reward volume.
- Long `str` responses, because they can carry RSA signatures. Junior events should keep `int` responses, where a
  53-bit key factors in moments.

Small change budgets help juniors, because every edit must carry an idea.
