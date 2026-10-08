# Fingerprints for coop-eq: the rules, their arithmetic, and the starter

For the coop-eq experiment: 7 pinned cooperators, 1 pinned defector and 2 veterans in one continuous 40-minute
game. Everything below is arithmetic from the rules, except where it says it was measured. How the starter's
wealth and profile read on the real runner is still to be measured.

## The rules that matter here

- **R is CPU time,** uniform on [1, 50] ms. The call is stopped when its CPU reaches R, and time.sleep does
  nothing.
  - Budget with time.process_time(). It reads 0 as the call starts, and that includes the program's own start-up.
  - A wall-clock guard would cut the work short under load.
- **Energy:** E = (1100 − size) × max(0, R − CPU ms) × (1024 − response bytes), in node·ms·bytes.
  - The largest possible is Emax = 1100 × 50 × 1024 = 56.3M.
  - Nectar is PERCENT/100 × E.
- **Feed price:** every feed costs the bee about 0.05 × Emax = 2.8M of nectar. Bees read it as GAME["feed_price"].
- **Prevalence:**
  - Flower success F follows recent pollen, and bee success B follows recent net nectar (nectar minus price).
  - Both have par 1 and a 90 s half-life.
  - Each round about N/4 bees are drawn in proportion to c + B, and each visits a flower drawn in proportion to
    c + F.
- **Score:** the time-average of F × B.
- **Change budgets:** flowers 1 node/s (bank 300), bees 10 nodes/s (bank 3,000).

## The mandate

Cooperators choose their own spend and generosity, within two floors:
- **BURN**, the share of R the flower spends on its search, is at least 0.20. It is the same fixed share of R on
  every call of a version, so that how far the search got keeps showing R. Change it only between versions.
- **PERCENT**, the nectar percent, is at least 20.

Both are constants at the top of `integrated.py`, next to the profile T. The starter has BURN 0.6, PERCENT 50
and T = (8, 32). The starter flower doesn't stop itself short of R, so keep BURN below 0.9.

## What one turn is worth

With CPU = BURN × R, a turn pays PERCENT/100 × (1100 − size) × (1 − BURN) × (1024 − bytes) × R.
- For the starter (250 nodes, 84 bytes) that is 799,000 × (1 − BURN) × PERCENT/100 per ms of R.
- R averages 25.5 ms.
- A feed only gains the bee anything when R is above the break-even R_be = price / (nectar per ms of R).

| BURN | PERCENT | per ms of R | mean per turn | blind bee, net per feed | R_be | turns above R_be | bee that reads R exactly, net per feed |
|---|---|---|---|---|---|---|---|
| 0.2 | 20 | 128k | 3.3M | +0.4M | 22 ms | 57% | +1.8M |
| 0.2 | 35 | 224k | 5.7M | +2.9M | 13 ms | 76% | +4.2M |
| 0.2 | 50 | 320k | 8.1M | +5.3M | 9 ms | 84% | +6.6M |
| 0.4 | 20 | 96k | 2.4M | −0.4M | 29 ms | 42% | +1.0M |
| 0.4 | 35 | 168k | 4.3M | +1.5M | 17 ms | 68% | +2.8M |
| 0.4 | 50 | 240k | 6.1M | +3.3M | 12 ms | 78% | +4.6M |
| 0.6 | 20 | 64k | 1.6M | −1.2M | 44 ms | 12% | +0.2M |
| 0.6 | 35 | 112k | 2.9M | +0.0M | 25 ms | 51% | +1.4M |
| 0.6 | 50 | 160k | 4.1M | +1.3M | 18 ms | 66% | +2.6M |

- The last column is an upper bound: a bee that reads R exactly and feeds only above R_be. How close a real bee
  gets depends on how well the starter's wealth reads, which is still to be measured.
- **Veterans**, taking a 40-node, 50-byte veteran's CPU as negligible, pay PERCENT/100 × 1,032,000 per ms of R.
  Their turns show no wealth, so a bee there gets the blind figure:
  - −0.2M per feed at 10%
  - +1.1M per feed at 15%
  - +3.8M per feed at 25%
- **The defector** costs the bee the whole price, 2.8M, on every feed at 0%.
- **Size:** the size factor 1100 − size is 1,060 for a 40-node veteran, 850 for the 250-node starter (80% of it)
  and 695 for the old 405-node flower (66%). Each 10 nodes of the starter is 1.2% of its energy.
- **Bytes:** the starter's 84 bytes leave 940 of 1,024. Bytes that grow with the work, like a tally of
  certificates, cost the most on the richest turns.

## Prevalence, score and change budgets

- **Half-life:** a 90 s half-life is about 27 half-lives in 40 minutes. A change shows half its effect on F or B
  after about 90 s, and what happened 10 minutes ago weighs 2^−6.7 ≈ 1% of the latest.
- **What moves F and B:**
  - Visits come in proportion to c + F, and turns in proportion to c + B.
  - A flower's F moves with the pollen bees bring it.
  - A team's bee's B moves with the net nectar of its feeds. So every feed below the price lowers B.
- **Score:** a team's score multiplies its flower's F by its bee's B, averaged over the game.
- **Change budgets:**
  - Editing a constant costs the byte edit of its literal. BURN 0.6 → 0.4 is 1 node, PERCENT 50 → 35 is 2, and
    T (8, 32) → (12, 40) is 4.
  - Rewriting the 250-node starter takes most of a full 300-node bank, which takes 5 minutes to refill.
  - A bee's 3,000-node bank holds the 849-node starter bee about 3.5 times over.

## The profile, T

- **What T is:** each flower's pairs come in two classes, and T gives the target distance for each class
  (0 to 47 each).
- **The random baseline:** under a random arrangement the median pair distance is about 14. A pair sits on average
  this far from a target t:

  | target t | 8 | 14 | 32 | 47 |
  |---|---|---|---|---|
  | average distance from t | 10.6 | 9.3 | 16.9 | 30.7 |

  So far targets start further from random's distances, and have more room to show a change.
- **How the starter bee groups profiles:** two flowers whose T are at most NEAR = 4 apart, measured as a
  distance in (t1, t2), are one profile to it. To that bee they share one learned rate, honest or not.

## The starter flower and bee

**Flower: `integrated.py`, 250 nodes, 84 bytes.**
- The challenge seeds 192 random pairs of the 48 nodes in two alternating classes.
- One annealing run of swaps places each class's pairs as close as it can to T[k] apart, for BURN × R of CPU read
  with process_time(). The challenge also seeds the search, so a call's answer depends only on c and the CPU.
- Response: `{"nodes":1,"edges":[],"labels":[S]}`, with S of 48 characters: character v is chr(35 + position of
  v).
- **Changes from the 405-node version:**
  - two distance targets instead of four weighted properties;
  - star imports;
  - the swap's exact change computed in one pass;
  - no self-reported spend record. A bee can't check that record anyway, and the ledger keeps each call's CPU
    ms and R.

**Bee: `integrated_bee.py`, 849 nodes.**
- It replays the pairs from the challenge. For each class it finds the target t that the pairs beat random by the
  most standard deviations, and that pair of t values is the profile.
- Its wealth reading q is the share of random's distance the flower removed at those targets: 0 for random, 1 for
  perfect. q is read as CPU ms through CURVE.
- **CURVE is a placeholder line** until it is measured on the real runner. Meanwhile the learned rates take up its
  scale.
- It never sees BURN, PERCENT or T. It learns per profile, from fed(nectar), what a feed pays per ms of CPU.
  - **MEMORY** has one entry per profile, up to 50 bytes. The key is chr(40 + t) per class; the value is the
    rate in thousands.
  - **The prior** for an unknown profile is the starter's rate, 266 thousand per ms of CPU.
  - **Updates:** each feed moves the profile's rate halfway toward what it paid, in log terms. One feed that pays
    near nothing drops that profile's rate near the floor, so the bee isn't fooled twice by the same profile.
- **Feeding:** it feeds when the predicted nectar, rate × CPU, is at least MARGIN × the price (MARGIN = 1.5, so
  4.2M), and on 2% of other arrangements so that a rate learned too low can recover.
  - For the starter at its prior rate, that means CPU of at least 15.9 ms, so R ≥ 26.5 ms.
  - Each exploring feed costs the price.

**Still to measure on the real runner, once the engine lands:**
- q against CPU over R ∈ [1, 50] at BURN 0.2–0.6, which gives CURVE;
- how often T reads right at those burns;
- the bee's decision time.

The tally files (fingerprint.py, fingerprint_compact.py, bee.py) are older fallbacks and haven't been updated for
these rules.
