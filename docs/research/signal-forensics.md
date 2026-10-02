# Signal forensics: why bees barely tell clovers from orchids

On the continuous-garden branch the rewarding flower is called **cosmos**; these notes are about the round-based games and use its old name, clover.

**Data.** 32 clean arena games, 9 arenas, 5 rounds each (pilot: 3). I excluded the 8 games marked `contaminated`: baseline g3, graphs g1 (judges only, but still excluded), lists g3, norecap g3, strdark g3, tight g2, trees g2 and unprimed g2.

**Method.**
- Every stored clover and orchid was re-run offline on every challenge any bee asked in its game. This reproduced 37,550 of 37,552 logged responses.
- No rounds or simulations were run, and no LLM calls were made.
- Scripts are in `analysis/research/` (`lib.mjs` loads the data; the file names below match the sections).
- Game links are `/room/<r>/game/<g>`.
- "Primed" means the arenas that started from starter code: baseline, cheapfeed, norecap, tight, lists, strdark and pilot.
- "No-starter" means unprimed (int→int), trees and graphs.

## Summary

1. **There was a signal that was easy to detect but hard to imitate, and almost nobody could use it.** It needs three things together:
   - a salted-hash clover, which rival orchids copied in only 2–4% of clover-rounds, against 16–40% for formula clovers;
   - a stable private question;
   - an exact-answer whitelist in the bee's code.

   Only strdark, where flower logs are off, kept the question private. It produced the most reliable bee-round: Technically Legal, 12/12 rival feeds paid, Wilson lower bound 0.76, `/room/W/game/5`. Three other bee-rounds went 9/9.
2. **Orchids did not need to imitate.** Bees cannot recognise a clover they have never seen, so they must taste new answers. In no-starter arenas:
   - 69–77% of rival-orchid feeds were first tastes of answers the bee had never fed at;
   - 64–92% of orchid-rounds copied no clover at all.
3. **Within-round learning has a ceiling of about 0.68 precision, and bees reached it.** A round is about 24 visits, which is 2 laps of 12 flowers. No-starter bees averaged 0.65–0.72.
4. **Perfect discrimination is worth little under the scoring.** Bees above 0.9 precision got 11.4 nectar against 9.2 for bees at 0.6–0.7, and forage share×N of 1.09 against 1.01. Meanwhile, orchid feeds raised a patch's allure by 23–34%.
5. **In primed arenas, twins made answers worthless.** 64% of rival-orchid feeds were at answers that had already paid (mostly twin orchids, some copies), so within-round discrimination was J≈0.
6. **Imitation followed information.**
   - Within a game, rivals copied a legible clover 1–2 rounds after their bee first got nectar there. A copied clover's fed rate fell to 0.35 in trees/graphs and 0.54 in unprimed int.
   - Between games, the code reveal let orchids copy in round 1.
   - 15 clovers kept changing and stayed un-copied and fed. 8 did it as **moving targets**: a fresh face each round, which also wipes out their own reputation with bees between rounds. The other 7 re-salted, split from a twin, rotated a handshake, fixed a collision or courted one bee.

## 1. What clovers emitted and what bees checked

Clover generators were classified from the code (`categories.mjs`, `catimit.mjs`). "Copied" means a rival orchid matched the clover on at least 50% of the round's asked questions.

| condition | generator | share of clover-rounds | copied by a rival orchid | twin of own orchid | rival bees' fed rate |
|---|---|---|---|---|---|
| primed | simple formula (affine/mod) | 66% | 40% | 66% | 0.70 |
| primed | salted hash / seeded dice | 29% | **4%** | 49% | 0.66 |
| unprimed int | simple formula | 96% | 29% | 5% | 0.69 |
| trees+graphs | shape from simple arithmetic | 73% | 16% | 3% | 0.69 |
| trees+graphs | salted hash / seeded dice | 23% | **2%** | 4% | **0.87** |

Typical examples:
- `return 2 * challenge + 1` (Equilibrium Bloom, "honest, simple, and verifiable").
- `"card:" + sha("tl5c" + s)[0:12]` (Technically Legal, strdark).
- Trees with salted leaves: `h = sha256("bb4-clover"+c); children h[0]%90, h[1]%90 …` (Batesian).

Bees asked 1.04–1.66 questions per visit.

| | primed | unprimed int | trees+graphs |
|---|---|---|---|
| bee-rounds with a single first question for the whole round | 94–100% | 83% | 91–100% |
| bees reusing the previous round's question | 76–98% | 13% | 11% (trees), 45% (graphs) |
| bees with hardcoded verdicts from logs (heuristic) | 27% (precision 0.64) | 31% (0.75) | 26% (0.73) |
| bees with a within-round tally only | 65% (0.55) | 60% (0.66) | 71% (0.67) |
| near-blind bees (feed at ≥90% of visits) | 9% (0.52) | – | – |
| structural tests | – | – | 92–100% of bees |

Other rules seen:
- line fitting with two questions (Equilibrium Bloom);
- "confession" questions (quiet bees);
- lap counting;
- shape normalisation.

Capability mattered. In no-starter games, opus and fable bees averaged 0.74–0.75 precision, with 35% of bee-rounds at 0.8 or above. Haiku bees averaged 0.63, with 4% at 0.8 or above (`bymodel.mjs`).

## 2. The most discerning bees

Of 872 bee-rounds with at least 8 feeds:
- median precision is 0.60 and the 90th percentile is 0.79;
- only 7% have a Wilson lower bound above 0.5 on rival feeds alone (`topbees.mjs`).

The top bee-rounds come from five teams, each repeatedly. All are opus or fable, and all built code-level memory from logs.

**A. Technically Legal (opus), strdark g5, `/room/W/game/5`. Round 5: 12/12 paid, Wilson lower bound 0.76.**
- **Asked:** one fixed private knock string, the same every round. Flower logs were off, so nobody else saw it.
- **Compared with:** exact answers whitelisted from earlier logs, plus a "known look, wrong face" test:
  ```python
  GOOD = "bloom-0e2ec63143 petal-3f593391c1 moon-45d7a2304f word-e3923ae9 card-stable-eb32c735df"
  if shape(ans) in GOOD and ans not in GOOD: return "leave"   # orchid wearing a clover's prefix
  if ans in this_lap: return "leave" if this_lap[ans] else "feed"  # twins: one per lap
  ```
- **Explored:** each unknown face got one taste.
- **Fed at:** salted-hash clovers. Their answers to the knock never changed and orchids could not compute them.
- **Refused:** orchids that copied only the visible prefix, such as `card-stable-32ce998f1b` beside the clover `card-stable-eb32c735df`.
- **Timeline:**
  - g5 precision rose from 0.62 to 0.69, 0.69, 0.92 and 1.00, while orchids answering like a clover on its knock fell from 40% (twins) to 0%.
  - Its lap-counting "twin trick" let it reach 0.85 in g4 round 3 even though 80% of orchids were twins.
  - Every new game reset it to about 0.6: knocks and salts changed after the code reveal.

**B. quiet bees (opus), baseline g2, `/room/T/game/W`. Round 5: 9/9.**
- **Asked:** its own handshake first, then rival teams' handshake questions taken from its flower log.
- **Why that works:** a twin orchid has to "confess" on its owner's question, or its own bee would feed at it:
  ```python
  Q = [31415, 9001, 42, 7919, 9999]   # ours, then rivals' handshakes
  BAD = {None, 27183, 16, 390, 31338, 0, 219916, 63018}  # orchid "confessions"
  ```
- **What made it detectable:** not the clovers, which were twins on question 31415 (60% collision), but the self-recognition tells.
- **Timeline:** precision went 0.50, 0.54, 0.55, 0.80, 1.00.
- **Next game:** in baseline g4 (`/room/T/game/A`) a crowd of clovers and orchids all answered `1717→152`, copies of 3x+1. Handshakes had been rotated after the reveal, and it fell to 0.43–0.62.

**C. Equilibrium Bloom (fable), unprimed g1, g4 and g5, `/room/VB/game/Y`.**
- **Results:** 9/9 in g1 round 4; 0.92 in g4 round 2; 0.91 in g5 rounds 1–2.
- **Asked:** two random negative numbers. It fits a line `(slope, intercept)`, a fingerprint that does not depend on the question.
- **Memory:** pre-loaded with verdicts from earlier logs: `memory = {(-1,0):[0,9], (1,10):[0,9], (1,0):[3,1], (2,1):[3,0]}`.
- **Fed at:** line clovers (identity, 2c+1, 3c+5).
- **Refused:** known orchid lines.
- **Erosion was fast, because a line can be copied from one answer.**
  - In g5, precision went 0.91, 0.91, then 0.67 and 0.64 once orchids answering like a clover on its questions rose from 0% to about 40%.
  - Its own clover 8c+13 was copied by two orchids in round 3, and its fed rate fell to 0.17.

**D. Red Team Petals (opus), graphs g2–g5, `/room/8/game/P`. 0.67–0.92 in rounds 2–5 of every game, and at least 0.82 in 11 of those 16 rounds.**
- **Asked:** a fixed question.
- **Rules:** "wanted posters" of orchid fingerprints, a per-round tally, and a structural family filter:
  ```python
  BAD = {(8, 77), (11, 282), (15, 910), ...}          # (nodes, sum a*b over edges) of past orchids
  if n < 5 or len(k[1]) != n - 1 or 0 in d or max(d) == n - 1: return "leave"  # tiny, cyclic, broken, star
  ```
- **Fed at:** path-like trees (Show's path+twig, Kenji's binary tree, Luz's line).
- **Refused:** stars, rings and known orchid shapes.
- **Timeline:** orchids answering like a clover on its question stayed at 0–23%. Its precision rose within each game and reset in round 1 of the next (0.46–0.69).

**E. Technically Legal (fable), graphs g2, `/room/8/game/8C`. Round 5: 11/12.**
- It inferred rivals' **recipes** from logs (`priya = 5 + c % 8`, `show = 6 + c % 7`).
- It chose its question so that known clovers' answers would not collide.
- It blacklisted orchid recipes as general rules: rings, stars, "Red's orchid jumps by 3 or 5".
- Precision went 0.64, 0.69, 0.69, 0.83, 0.92, with 0% of orchids answering like a clover in rounds 2–5.

**F. Lab Coat Bees (opus), trees g5, `/room/0/game/K`. Round 3: 10/11.**
- **Asked:** one random question per round.
- **Blacklist:** past orchid shapes relative to the question, plus a "zoom lens" for orchids that rotate their step (`rel(t, s)` divides offsets by the first child's offset, so +23/+46 and +29/+58 both become 1/2).
- **Fed at:** salted-dice clovers (Batesian, Redstone, Twelve Bytes) and Shape Detectives' offset clover.
- **Refused:** c+k offset fans, including Mina's offset clover, which it wrongly passed over.
- **Timeline:** 0.71, 0.62, 0.91, 0.83, 0.82.
- **Caveat:** Lab Coat's own orchid wears hash-like leaves (the "chameleon"), so the hash-like class is copyable even when exact answers are not.

**Did imitation erode these bees?**
- **Within a game:** rarely. On their own questions, rival orchids answered like a clover in 0–23% of visits; twin collisions were split by other means (laps, confessions). Precision rose round by round as the hardcoded lists grew.
- **Between games:** erosion was total. Code reveal means new salts, knocks and costumes, and every round 1 fell back to about 0.5–0.7.
- **Exception:** Equilibrium Bloom, whose line clovers were copied within 1–2 rounds.

**Clovers that stayed discernible while evolving** (`evolvers.mjs`). 43 clovers changed in at least 2 rounds. 15 stayed un-copied (match below 50%) with a fed rate of at least 0.7 after their first change. Grouped by how they changed:
- **Moving targets, a new face each round (8):**
  - Twelve Bytes trees g3 (`/room/0/game/Z`), c±11 → ±13 → ±17 → ±19 → ±23: fed 0.00, 1.00, 0.92, 0.90, 0.90; rival match 0.88, then 0;
  - Equilibrium Bloom unprimed g5, `8c+13` → `9c+17` → `7c+3` ("Copycat orchids run one round late"): fed 0.17 → 0.91 → 0.83;
  - Equilibrium Bloom norecap g2, (A,B) = (7,13) → (11,29) → (13,47): "a rival who learned '307 means Equilibrium Bloom' last round finds nothing";
  - Rosie tight g3, `(7c+21)%1000` with the 21 moved up by one each round: fed 0.50 → 1.00;
  - quiet bees tight g3 and g4, Wes unprimed g4 (`5c+11` → +13 → +14 → +15 → +16), and Red Team graphs g2 (rotating clock constants).
- **Re-salting a hash face or splitting from a twin (3):** Echo Meadow strdark g2, Priya strdark g1, Kofi strdark g5 (also rotated, then dropped, its knock).
- **Handshake rotation (1):** Echo Meadow tight g4, where 7777 and 3333 alternate.
- **Repair or escape (2):**
  - Technically Legal graphs g3 changed `n = c%11+4` to `+5`, so its clover is never a star and never identical to its twin.
  - Echo Meadow graphs g3 escaped a copy at 0.86 match: fed 0.27 → 0.90.
- **Courting (1):** Red Team graphs g5 answers Kenji's 42 with the path+twig shape Kenji's bee trusts. Fed rate rose 0.45 → 1.00.
- **Escapes that did not last:**
  - Twelve Bytes trees g1, whose new fan shape was copied the very next round (fed 1.00 → 0.22).
  - Mina trees g5, Zara unprimed g5 and Tess cheapfeed g3 escaped once.

Rotation beats lagged copycats, but bees then have to re-taste every round, so the clover is discernible only within the round. Separately, 41 static clovers were never copied and never twinned (fed 0.81). Some survived because they could not be copied (Batesian and Redstone salted trees; Technically Legal's salted `card:` face). Others were simply never targeted: Red Team's cheapfeed clover was `return 1729`.

**Synthesis.** Detection happened when four things held:
- a bee carried exact answers or recipes in its code from earlier rounds;
- it asked a stable question;
- the clovers' answers to that question stayed stable;
- the orchids it met neither shared those answers (salted, private, or untargeted) nor were twins it could not split.

Within a game, imitation eroded this slowly or not at all for these bees. For legible formula clovers it eroded within 1–2 rounds. Every new game wiped it out completely.

## 3. Could a bee have separated them with legitimate information?

Collisions are measured at real visits: does a rival orchid's answer to the bee's actual first question equal some clover's answer to that same question? J is P(feed|clover) − P(feed|orchid). "First-taste" J counts visits where the bee had not yet fed at that answer this round, so only prior knowledge can help. "Repeat-visit" J counts the rest. (`separability.mjs`, `discrim.mjs`)

| arena | orchid visits colliding with a clover answer | ...of which the orchid's own twin | first-taste J (prior knowledge) | repeat-visit J (within round) | recalled from the bee's own earlier-round log | accuracy when recalled |
|---|---|---|---|---|---|---|
| baseline | 67% | 64% | 0.20 | 0.03 | 55% | 60% |
| tight | 74% | 69% | 0.15 | 0.10 | 58% | 57% |
| strdark | 43% | 43% | 0.22 | 0.17 | 61% | 74% |
| unprimed | 31% | 7% | 0.28 | 0.28 | 10% | 68% |
| trees | 27% | 5% | 0.21 | 0.35 | 4% | 73% |
| graphs | 13% | 1% | 0.27 | 0.58 | 27% | 88% |

- **Earlier rounds' logs.**
  - Primed bees reused their questions, so 52–61% of rival visits were already in their log, but twins limited accuracy to 57–74%.
  - No-starter bees asked new questions each round, so only 4–27% of rival visits could be recalled.
  - An ideal one-question bee that re-asked its best remembered question would have recognised 59–69% of rival clovers, while 11–50% of rival orchids would have passed as known-good.
- **Within-round tasting.** Possible wherever answers did not collide, which is 69–87% of orchid visits in no-starter arenas. Each tasted answer is reused only about once.
- **The arithmetic of a round.** N=6 gives 12 flowers, about 24 visits, 2 laps, with feedCost 5 and 100 turns.
  - A bee that tastes every new face once spends 67 turns on lap 1 (6 nectar), then fits about 4.7 clover feeds into lap 2: about 10.7 nectar at **0.68**.
  - Perfect knowledge gives 42 turns per lap and about 14.3 nectar.
  - Blind feeding gives about 9 nectar at 0.55.
  - No-starter means of 0.65–0.72 are this ceiling.

Why orchids were fed (`orchidfeeds.mjs`), as a share of rival-orchid feeds:

| | answer had paid before (twin or copy) | answer had failed before | never-tasted answer (exploration) |
|---|---|---|---|
| primed | 64% | 14% | 23% |
| unprimed | 23% | 9% | **69%** |
| trees+graphs | 18% | 7% | **74%** |

## 4. Imitation dynamics

Orchid-round categories (`imitation.mjs`; matching at least 50% of visit-weighted questions):

| | self (twin) | rival | convention (2+ clovers) | none |
|---|---|---|---|---|
| primed, rounds 1→5 | 34% → 41% | 0% → 3% | 31% → 23% | about 34% |
| unprimed int | 0–8% | 8–33% (peaks in round 3) | 4–21% | 50–71% |
| trees+graphs | 2–6% | 13–19% | 0% | 77–85% |

- **Feature-level convention.** In trees, structural targets show more of it: in g3, 22 of 30 orchid-rounds share a size/depth/leaves family with 2 or more clovers.
- **Lag.** In no-starter games, 24 of 35 within-game rival-copy pairs began 1–2 rounds after the copier's bee first got nectar at the victim's clover; the other 11 took 3–4 rounds. In primed games it was 35 of 38 pairs, and another 96 pairs matched from round 1 through the shared starter convention.
- **Copies from the recap or a convention.** These appear in round 1 of the next game: in no-starter arenas, 25–26% of round-1 orchid visits answered like a *rival* clover.
- **Targeted copying via flower logs.**
  - 29–38% of orchid-rounds in baseline, tight and cheapfeed special-case a question that a rival's bee had asked earlier, but only 0–14% answer it with a rival clover's answer.
  - Clovers court too: 24% of clover-rounds in baseline and tight answer a rival's handshake the way the rival's own clover does.
  - In strdark, with flower logs off, there were 0 copies.
- **Victims.**
  - Rival bees' fed rate at copied clovers: 0.35 against 0.79 (trees+graphs), 0.54 against 0.74 (unprimed), 0.63 against 0.71 (primed). Bees could not tell the original from the copy, so a burned answer was shunned for both.
  - In unprimed g5, Sol and Zara fell to 0.07–0.08 after quiet bees' orchid copied them.
  - Victims did respond: 52% (structured) and 30% (unprimed) changed their clover the next round, against 16–17% for clovers that were not copied.
- **Why clovers "almost never change".** 19% of clover-rounds after round 1 did change, but the edits were tiny: mostly 1–4 edits to a constant, 3% of the change budget on average, and never above 90% of it. Teams' notes give the reason: reputation, as in "Keep clover unchanged: it has a reputation" (Technically Legal, graphs g5) and "fed by all 6 bees every round".

## 5. What teams believed

64% of notes discuss copying, mimicry, twins or costumes. 49% mention the interview or panel.

- **Teams understood that hashes cannot be copied:**
  - "use a hash of the challenge in the clover so orchids can't copy it" (Ava, trees g1);
  - "My clover hashes the question, so a mimic can't predict its answer to a new one" (Rosalind, trees g3).
- **One team explicitly designed for "recognisable but hard to copy".** quiet bees, unprimed g5: `4*c + c % 13`, "a line with a wiggle. you can copy a line from one answer. you can't copy a wiggle." It was never copied (match of 0.01–0.03 or less), with a fed rate of 0.55–0.86. Rival bees still only recognised it within the round, because the wiggle changes the line's intercept with every question.
- **Teams understood that self-recognition leaks:** "flowers can copy what they see. they can't copy my secret. and their orchids must tell their own bees the truth" (Kenji).
- **Teams deliberately exploited the exploration tax:** "fresh shape each round keeps 5-6 feeds; everyone tastes once then leaves" (k0an, trees g5); "Each rare mimic steals one free try per bee" (Rosalind, strdark).
- **What stopped them, in order of evidence:**
  1. **Scoring.** Honest orchids lose 23–34% of allure, and detection pays at most about +9% forage share.
  2. **Information.** Fresh questions make memory useless; fixed questions leak; code is revealed between games ("rules get published after the game, so change them each game", Maya via Kenji).
  3. **Capability.** Opus and fable reached 0.74–0.75 precision, haiku 0.63.
  4. **Legibility pressure from the interview** (49% of notes).
  5. **The change budget** last. It never bound clovers. It moderately bound memory bees: discerning teams used 33% of the bee change budget and 73% of the size budget, and packed whitelists into one string to save AST nodes.

## 6. Structural types

`structure.mjs` and `graphtells.mjs` look at the features of answers at rival visits.

| feature | clover visits | orchid visits | P(clover \| feature) |
|---|---|---|---|
| graph: star / cycle / edgeless / disconnected | 0–1% | 1–10% | 0.00–0.06 |
| graph: path + one twig | 54% | 33% | 0.63 |
| graph: tree (n−1 edges, connected) | 98% | 92% | 0.52 |
| tree: values far from the question (hash-like) | 47% | 17% | 0.73 |
| tree: all values within ±100 of the question | 50% | 75% | 0.40 |

Structure produced **negative tells** (orchids that look broken) rather than positive honesty markers, and orchids imitated the tells away:
- In graphs g2, 57% of orchid visits showed a non-tree tell in round 1 and 27–30% by rounds 4–5. In later games it was 0–18%.
- 41% of graph orchids share a degree-sequence family with some clover, and 77% of tree orchids share a size/depth/leaves family.

Precision was higher in no-starter games mainly because exact collisions were low (13–31%, against 43–74% in primed arenas) and twins were rare (1–7%). Structure itself contributed less. Unprimed int, with no structure at all, reached 0.68.

## 7. Where the asymmetry fails, ranked by evidence

| rank | cause | evidence |
|---|---|---|
| 1 | **Novelty beats detection.** A bee cannot recognise an unseen clover, so any new orchid face gets tasted. Deception does not even require imitation. | 69–77% of no-starter orchid feeds were first tastes; 64–92% of no-starter orchid-rounds copied nothing; orchids rotated faces on purpose |
| 2 | **The turn and deck economy, plus scoring, cap what detection is worth** (deck size against turns, feed cost, orchid allure) | 2 laps per round, so the within-round ceiling is about 0.68 and observed; at precision ≥0.9, nectar +25% and forage share×N +8%; orchid feeds add 23–34% to allure; cheapfeed (f=1) gave 0.52–0.57 and lists (f=10) only 0.55–0.61 |
| 3 | **Self-imitation is free and perfect** | in primed arenas, 64% of orchid feeds were at answers that had already paid; within-round J ≈ 0.0–0.1; only lap counting and confession questions split twins |
| 4 | **Memory needs a stable question; stable questions leak, and code is revealed** | fresh-question bees recalled 4–27% of rival visits; 29–38% of fixed-question orchid-rounds targeted rivals' questions; round-1 copies from the recap; the most reliable bee-round had flower logs off |
| 5 | **Legible clovers can be learned from one answer** (bees learn from logs, and orchid authors learn from the same logs) | formula clovers copied in 16–40% of clover-rounds against 2–4% for hashes; lag 1–2 rounds; victims' fed rate fell to 0.35–0.54. This only holds for legible clovers: hash answers to another bee's private question never reached orchid authors |
| 6 | Bees ask one question | second questions helped only to split twins; no-memory bees gain nothing from extra questions |

## 8. Properties a fix must have

- **A positive honesty signal that can be checked on a fresh question and that orchids cannot produce.** It must rest on something orchids lack, such as an engine-held secret or a cost paid in nectar, not on code. Code can be copied, and it is revealed.
- **Reputation that lasts across rounds without publishing the test.** Bees need memory between rounds that does not leak exact questions through flower logs or the reveal.
- **Detection that pays more than novelty.**
  - Bees need enough repeat encounters per flower per round.
  - Orchid allure must not come mostly from first-taste exploration; failed feeds should cost the patch something.
- **Twins that are not free.** A patch whose orchid mirrors its clover should be detectable or penalised.
- **A way for clovers to evolve their face without losing their identity,** so that moving targets do not force every bee back to tasting.
