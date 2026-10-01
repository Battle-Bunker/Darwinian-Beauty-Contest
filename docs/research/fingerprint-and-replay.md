# Fingerprint and replay: how bees recognise flowers, and how orchids steal faces

*Research notes, 2026-10-01. Follows [arena/REPORT.md §16](../../arena/REPORT.md). Scripted simulations only: no LLM
calls, database read-only.*

## Summary

- **Probes are universal; fingerprint-and-taste is not.** 208 of 331 bee-games asked (nearly) every flower the same
  first question, either all game or freshly each round. But only 41 used the answer as a face, tasted it and stuck to
  the verdict well enough to separate rival clovers from orchids by ≥ 0.5: 8 of 245 in v1 and 33 of 86 in v2. v1
  bees had probes (a leftover of the starter bee) but only ~3 visits per flower per round and no MEMORY, so the
  probes mostly served secret own-team handshakes.
- **The best v2 bees rotate their probe every round.** Kenji and Mallory (opus) ask a secret number derived from the
  round. They re-taste each face every round, at about 2% of nectar per turn, and are immune to replay. Only Rosa
  and Grace used one probe for a whole game.
- **What predicts fitness is discrimination, not having a probe.** In v2, with model dummies and game fixed
  effects, a probe bee scores +0.06 ± 0.08 fitness. The rival clover-vs-orchid gap scores +0.56 ± 0.14 per unit.
  Fitness correlates with the gap at 0.69 and with pooled precision at only 0.45.
- **Replay was not hypothetical.** Five deliberate replay attacks hit v2 games 1–2, all by opus teams:
  - Kenji's "stolen password" in [/room/0Y/game/5](/room/0Y/game/5) and [/room/2/game/G](/room/2/game/G)
  - Mallory's "quick-change artist" in [/room/K0/game/C](/room/K0/game/C)
  - Kenji's "password thief", in the same game
  - Fast Path Flora's cracked-clover orchid in [/room/B/game/4](/room/B/game/4)

  The fooled bee fed at 97–100% of those visits. §16's "nobody stole a face" holds only for game 3. Fooled bees
  almost never changed their probe the next round: 1 of 33 cases across all games.
- **Literals were not used as storage.** The longest string in any flower is 29 characters. No flower's constant
  table has more than 26 literals, and no program decodes a packed literal. The largest stored "data" is Kenji's
  128-bit prime bitmap (`0x8002…`) and v1 bees' hard-coded face → verdict tables, up to 1.3 KB.
- **Simulations:**
  - **(a) Replay.** It wrecks a victim whose bees use one probe all game: strict bees cut the victim off, at −0.35
    fitness. Lax bees feed the thief's orchid at 0.98, giving the thief +0.27. Rotating the probe each round
    removes the attack completely.
  - **(b)** See "What breaks identity linkage" below.
  - **(c) Calibration.** No factor star fits int challenges: Pollard rho factors any semiprime below 2^53 in under
    9 ms. Hashcash × 32–64 at ~120 ms and a 256-bit time-lock do separate the clover and orchid budgets: the
    clover answers 97–100% within 150 ms, the orchid 0% within 50 ms, and the bee checks in under 0.1 ms.

## Scripts and data

| script | what | output |
|---|---|---|
| `analysis/game-data.mjs` | shared read-only loaders (arena games, entries, visits, programs) | – |
| `analysis/fingerprint-census.mjs` | Q1 and Q4(d): per-bee census of every arena game, classes, first appearances, regressions, twin economics | `arena/runs/fingerprint-census.json` |
| `analysis/stolen-faces.mjs` | Q2: stolen faces, targeted literals, strdark knock formats, episode effects | `arena/runs/stolen-faces.json` |
| `analysis/literal-census.mjs` | Q3: literal lengths and constant tables in every distinct program | `arena/runs/literal-census.json` |
| `analysis/sim-lib.mjs` | simulation harness: multi-round games on `server/engine.js` with MEMORY chaining | – |
| `analysis/replay-sim.mjs` | Q4(a): face-stealing orchid vs probe regimes | `arena/runs/replay-sim.json` |
| `analysis/identity-rules-sim.mjs` | Q4(b): challenge rules R0–R3 and v3 against clover strategies | `arena/runs/identity-rules-sim.json` |
| `analysis/cert-calibrate.mjs` | Q4(c): certificate timing through the Python runner | `arena/runs/cert-calibrate*.json` |

Text outputs of the runs used here are in `arena/runs/fp/`.

**Definitions** (rival patches only, unless noted):

- **Probe concentration**: the share of a bee's visits whose first ask is one of that round's top 3 first asks.
- **Persistence**: the share of first asks in rounds 2+ that reuse an earlier round's challenge.
- **Bee classes**:
  - *fixed*: concentration ≥ 0.9 and persistence ≥ 0.8
  - *rotating*: concentration ≥ 0.9 but rotated each round
  - *fresh*: concentration < 0.3
  - *mixed*: everything else
- **Gap**: the rival clover fed rate minus the rival orchid fed rate.
- **Verdict-following**: once a face (the answer to the visit's first question) has been fed, how often the bee
  feeds again exactly when the face paid.

## 1. Is fingerprint-and-taste universal?

**All 57 played arena games, 331 bee-games** (`node analysis/fingerprint-census.mjs`).

| family | bee-games | probe (fixed or rotating) | effective* | gap: fixed / rotating / fresh | nectar per turn: fixed / rotating / fresh |
|---|---|---|---|---|---|
| v1 int, primed (pilot, baseline, norecap, cheapfeed, tight) | 102 | 82 | 0 | 0.11 / 0.05 / 0.37 (n=1) | 0.102 / 0.119 / 0.084 |
| v1 int, unprimed | 29 | 25 | 1 | 0.05 / 0.26 / 0.38 | 0.056 / 0.090 / 0.095 |
| v1 str (strdark) | 30 | 29 | 0 | 0.13 / – / – | 0.088 |
| v1 list | 24 | 18 | 0 | 0.08 / – / -0.07 | 0.048 |
| v1 trees + graphs | 60 | 53 | 7 | 0.35 / 0.35 / 0.12 | 0.096 / 0.100 / 0.069 |
| v2 arenas | 32 | 17 | 10 | **0.59 / 0.84 / 0.11** | 0.084 / 0.124 / 0.070 |
| v2 cohorts | 54 | 31 | 23 | **0.38 / 0.82 / 0.06** | 0.065 / 0.118 / 0.064 |

\* Effective: a probe bee with verdict-following ≥ 0.85 and a rival gap ≥ 0.5.

**Where it appeared:**

- **Probes appeared from the very first games.** The pilot's 4 bees and strdark game 1's 6 bees all asked one fixed
  question, the old starter bee's habit.
- **They were used as handshakes.** In v1 they mostly served the secret-handshake equilibrium (REPORT §1) and rule
  checks: verdict-following was 0.60, and in primed int arenas the gap was 0.11.
- **The first effective fingerprinter** was Theo (fable, a per-round probe) in graphs game 1,
  [/room/8/game/8](/room/8/game/8), with a gap of 0.60. Then:
  - k0an (fable), trees game 2
  - Nadia (fable), unprimed game 3
  - Mallory (opus), graphs game 3

  Only 8 of 245 v1 bee-games qualify, all in unprimed or structured arenas.
- **In v2 it was there from game 1:**
  - Mallory's pilot bee, [/room/N5/game/4](/room/N5/game/4), gap 0.98
  - Mallory, Kenji and Rosa in [/room/0Y/game/5](/room/0Y/game/5), gaps 0.96, 0.88 and 0.68
  - Ada and Milo in v2-ints game 1
  - Ava and k0an in v2-trees game 1

  Every opus bee in v2 qualifies.

**How it spread in the cohorts (top-2 demo, idea-level):**

- **The demo carried probe bees.** The fork game's top 2, Mallory and Kenji, are both rotating-probe bees, so the
  demo shown to every cohort team carried the method.
- **Non-opus bees adopted it at the game 1 → 2 boundary**, the same boundary where Python arrived and where §15 saw
  clover borrowing:
  - **Rosa** (sonnet): in gx-control game 2 she switched from fresh challenges to "ask every flower the SAME secret
    number… its answer is its face", with a gap of 0.74. She did the same in gx-treat game 2, with a rotating probe.
  - **Grace** (haiku): in gx-control2 game 2 she switched from a fixed probe with a gap of 0.00 to a rotating probe
    with a gap of 0.74. Her bee reuses Kenji's phrase "the deck is a clock".
- **The adopters rewrote the idea rather than copying code.** Token-shingle similarity to the demo bees stayed at
  0.09–0.17.
- **No adopters where all code was revealed.** In the v2 arenas the bees that fingerprinted in game 2 already did so
  in game 1. The one switch was Tess (v2-ints game 2), from fresh to fixed.

**Fitness, controlling for model.** OLS with model dummies and game fixed effects:

| sample | probe bee → fitness | probe bee → forage share×N | rival gap → fitness | rival gap → forage share×N |
|---|---|---|---|---|
| v1, n=245 | −0.01 ± 0.03 | −0.01 ± 0.02 | +0.32 ± 0.06 | +0.34 ± 0.05 |
| v2, n=86 | +0.06 ± 0.08 | +0.07 ± 0.07 | **+0.56 ± 0.14** | **+0.60 ± 0.12** |

- **Within sonnet in v2**, probe bees scored 0.93 (n=11) against 0.84 for the rest (n=32).
- **Opus is almost all probe bees** (27 of 29), so the model and the method are confounded.
- **What pays is discrimination.** A probe without verdict discipline, like v1's handshakes or Grace's game-1 bees,
  buys nothing.

**Pooled precision misleads.** v2 bees average 0.75 pooled precision against 0.74 rival-only, but the outliers are
bees that eat mostly at home:

| bee | pooled precision | rival-only precision | gap |
|---|---|---|---|
| Rosa, gx-control game 1 ([/room/2/game/8](/room/2/game/8)) | 0.40 | 0.01 | −0.23 |
| Luna, v2-pilot2 | 0.74 | 0.50 | 0.00 |
| Grace, gx-control2 game 1 | 0.63 | 0.50 | 0.00 |

Across v2, fitness correlates 0.69 with the gap and 0.45 with pooled precision.

## 2. Replay and stolen-face history

**Method** (`node analysis/stolen-faces.mjs`):

- **A stolen face** is a visit by a rival bee where every pre-feed answer equals the answer that one specific other
  team's clover gave to the same challenge in the same round, and the flower's own clover did not give it.
  - The clover's answer is known whenever some bee asked that clover the same challenge, which is always the case
    for probe bees.
  - Answers shared by 2+ clovers are counted as convention and excluded.
- **Two kinds:**
  - *Knock*: the face belongs to the visiting bee's own clover, so the bee thinks it is at home.
  - *Rival*: the face belongs to a third team's clover.
- **Classifying an episode** (thief → victim, per fooled bee):
  - the thief's flower and the victim clover are re-run on 16 fresh challenges through the runner: *generator* if
    they match ≥ 50%, *partial* if 10–50%
  - *table* if the thief's code contains the stolen challenge as a literal (≥ 4 digits)
  - otherwise *other*

**Prevalence** (orchid visits by rival bees where the clover answer is known):

| family | known visits | knock (fed) | rival (fed) | share |
|---|---|---|---|---|
| v1 int primed | 5,942 | 25 (14) | 177 (116) | 3.4% |
| v1 str (strdark) | 1,553 | 0 | 0 | 0% exact (see knock formats) |
| v1 list | 634 | 2 (2) | 7 (5) | 1.4% |
| v1 trees + graphs | 3,019 | 86 (58) | 333 (149) | 13.9% |
| v1 int unprimed | 1,302 | 24 (20) | 212 (110) | 18.1% |
| v2 arenas | 12,081 | 138 (102) | 431 (175) | 4.7% |
| v2 cohorts | 21,994 | 64 (63) | 895 (352) | 4.4% (game 3: 0) |

**Most stolen faces were generator copies, not replays.** Of 161 episodes with ≥ 3 visits:

| class | v1 episodes (visits) | v2 episodes (visits) |
|---|---|---|
| generator | 102 (513) | 21 (1,267) |
| verbatim | 3 (10) | – |
| partial | 7 (32) | 3 (62) |
| table | 2 (12) | 3 (99) |
| other | 15 (59) | 5 (98) |

A generator copy is an orchid that reimplements the rival's clover rule, as in REPORT §7–8.

**Deliberate replays.** Read from the code, not from the classifier:

| game | thief → victim's face, for whose probe | how | visits, fed | effect |
|---|---|---|---|---|
| [/room/0Y/game/5](/room/0Y/game/5) r4–5 | Kenji → Rosa's own clover, Rosa's probes 7 and 123457 (knock) | `if challenge in (7, 123457)`: "the stolen password… my spy bee asked rosa's clover those same two numbers" | 37, fed 37 | Rosa's fitness 1.07 → 0.89 / 0.91; Kenji's allure×N 1.07 → 1.04 / 1.12. Rosa's clover was unaffected (rival fed rate 0.36 → 0.46 / 0.38) |
| [/room/2/game/G](/room/2/game/G) r5 | Kenji → Rosa, probe 48271936 (knock) | "rosa's bee asks 48271936 every single round (a password!)… my bee spied it in r3 and r4" | 29, fed 29 | Rosa's fitness 1.18 → 1.07; Kenji's allure×N 1.06 → 1.15 |
| [/room/K0/game/C](/room/K0/game/C) r3–5 | Mallory → Theo's clover, Luna's probe range 1000–1099 | "the quick-change artist": a costume chosen by which bee's questions arrive | 33, fed 32 | Mallory's allure×N 0.97 → 1.28 / 1.07 / 1.25 |
| same game, r4 | Kenji, Mallory → Grace's own clover, Grace's probes (0, 52, …) (knock) | "the password thief"; r3 attempt failed because Grace changed her clover and probes; r4 caught up | 17 + 18, fed 34 | about 170 of Grace's ~1,200 turns wasted in r4 |
| [/room/B/game/4](/room/B/game/4) r5 | Fast Path (Ada) → Equilibrium's clover, all challenges (generator from one probe) | "Cracked Equilibrium's clover from ONE number" | Equilibrium's own bee 25/25 (knock), Tess 16/16, Gremlin 1/24 | Fast Path's allure×N 1.09 → 1.40. Equilibrium still won (1.53) |
| same game, r1–3 | Equilibrium → Fast Path's game-1 clover (from revealed code) | Collatz copy | Tess 25/28, Ada's own bee 17/18, Gremlin 1/59 | Equilibrium's allure×N 1.23 / 1.27 / 1.21 |

**Summary of the effects** (episodes with ≥ 3 visits; v2 means):

- **Knock replays fool completely.** The fooled bee fed at 98–100% of stolen-face visits: it trusts "its own" face
  on sight. The victim clover's reputation is not touched; the cost is the fooled bee's wasted feeds, and the thief
  gains allure (×N 0.99 → 1.12 in table cases).
- **Rival generator copies** (21 episodes):
  - fooled bees fed at the stolen face 0.38 of the time
  - their fed rate at the victim's clover fell 0.91 → 0.53 during the theft and recovered to 0.69 afterwards
  - the victim's clover went from 0.28 above other clovers to 0.12 below them
  - the thief's allure×N rose 0.97 → 1.18
- **Victims did not respond by rotating probes.** A bee whose probe had been fixed until the theft changed it the
  next round in 1 of 33 cases (all games). The responses that did happen:
  - Grace changed clover and probes within gx-control2 game 1.
  - Mallory, after strdark game 2, switched to a new exact-match knock.
  - Rosa used new numbers each game, but kept each one all game.
- **Replays from revealed code mostly went stale.** Fast Path's game-2 "costume" table for Entropy's game-1 answers
  matched nothing, because Entropy had changed its clover.
- **Most targeted literals in v1 were common magic numbers, not attacks.** 9001, 4242 and 7777 were used as
  handshakes by several teams at once.

**strdark's "secret knocks"** (REPORT §7, [/room/W/game/M](/room/W/game/M)):

- **The knocks were prefix checks, not exact faces.** Red Team's bee (Mallory) fed at any answer to "rtp-secret" that
  starts with "ok-", so exact-face matching finds nothing.
- **Matching the prefix instead:** Technically Legal's and Batesian Botanics' flowers answered Mallory's knock with
  "ok-…" in all 5 rounds. That was **40 visits, 34 fed: 18 of 21 at orchids, 16 of 19 at clovers.** Both teams had
  read her game-1 code.
- **No other strdark game had a successful knock.** In game 3 Mallory used an exact-match knock ("mallory-vault-9");
  rival visits passing a knock: 0 in games 1 and 3–5, apart from game 1's 3 visits to Echo's "clover:" answer for
  Priya.

## 3. Literal storage

**2,447 distinct programs** in `round_programs` (2,345 from arena games). Parsed with the game's tree-sitter grammars
(`node analysis/literal-census.mjs`).

| kind | programs | string literal length, p50 / p99 / max | integer literal digits, p50 / p99 / max | largest constant table (literal leaves), p90 / max | share of code inside literals, p50 / p90 |
|---|---|---|---|---|---|
| clover | 500 | 5 / 20 / 29 | 1 / 9 / 32 | 2 / 26 | 0.13 / 0.27 |
| orchid | 755 | 5 / 19 / 25 | 1 / 9 / 32 | 2 / 26 | 0.12 / 0.30 |
| bee | 1,090 | 5 / 23 / 189 | 1 / 7 / 16 | 7 / 101 | 0.12 / 0.21 |

**The largest cases:**

- **Longest string**: 189 characters, in Technically Legal's bee in graphs game 4. It stores a serialized graph face
  as a key in a hard-coded verdict table ("12-spoke wheel…": [1, 0]). That table, 1,316 characters, is also the
  largest constant table by size.
- **Longest integer**: Kenji's `0x800228a20208828828208a20a08a28ac`, 32 hex digits (128 bits). It is a prime bitmap
  used by his prime-necklace clover and orchid in gx-control. It is the only literal anyone used as packed data.
- **Largest constant table in a flower**: Priya's Lemonade Stand ([/room/T/game/A](/room/T/game/A)), whose clover and
  orchid both carry `{7919: 31337, 42: 1, 5555: 666, 424242: 7, …}`, 26 literals: v1 knock → password answers.
  Fast Path's v2-ints orchid carried `{0: 17273, 1: 50887, 13: 3076147}`, a (stale) replay table.
- **Largest table overall**: Redstone Pollinators' bee in trees game 5, 101 literals (expected tree shapes).
- **No program decodes a packed literal.** There is no base64, zlib, `fromhex` or `int(…, 16)` on a long literal.
  No flower string is ≥ 30 characters, and the longest flower program is 3,999 characters (the limit is 100,000).

**Conclusion:** the free-literal loophole (REPORT §16) was never exploited. Literals carried handshakes, salts,
probes and small replay or verdict tables. The tables were in bees, which could have used MEMORY instead.

## 4. Simulations (no LLMs; `server/engine.js`, Python bots)

### (a) A face-stealing orchid against probe bees

`node analysis/replay-sim.mjs 3`:

- **Garden**: 6 teams, int → int, 5 rounds, MEMORY on, 3 seeds per cell. All clovers are keyed hashes.
- **The thief**: from round 2, its orchid hard-codes the victim clover's answer to every challenge rival bees asked
  at the thief's patch last round, which is what its flower log shows.
- **The control**: the same garden with an honest thief orchid.
- **Measures**: the 4 bystander bees' fed rates.

| probe regime | tally | victim clover fed, r1 → r2–5 | thief orchid fed, r2–5 | victim fitness Δ | thief fitness Δ | bystander nectar/turn (control) | bystander gap (control) |
|---|---|---|---|---|---|---|---|
| fixed all game | strict | 0.99 → 0.00–0.02 | 0.00–0.03 | **−0.35** | +0.16 | 0.136 (0.142) | 0.82 (0.98) |
| fixed all game | lax (feed while ≥ ½ paid) | 0.99 → 0.98–0.99 | **0.98–0.99** | −0.05 | **+0.27** | 0.130 (0.142) | 0.82 (0.98) |
| fixed all game | split (second probe on a mixed face) | 0.99, 0.99 → 0.00–0.02 from r3 | 0.00–0.07 | −0.24 | +0.14 | 0.132 (0.142) | 0.85 (0.98) |
| new probe each round | any | 0.98–0.99 (= control) | 0.04 (= control) | 0.00 | 0.00 | 0.139 (0.139) | 0.95 (0.95) |
| fresh random each visit | – | 0.96–0.99 | 0.97–0.99 (no face to steal; bees taste everything) | 0.00 | 0.00 | 0.089 | 0.00 |

- **With a fixed probe, the bee's tally policy decides who pays.**
  - Strict bees blacklist the shared face, which is pure sabotage of the victim: the thief gains only 1 feed per bee.
  - Lax bees keep feeding both flowers, which hands the thief allure at the bees' expense.
  - A second probe only buys one round, because the thief reads that probe from its log too.
- **Rotation is a complete defence.** The orchid is frozen for the round, so it always holds last round's probes.
- **Rotation costs bees about 2% of nectar per turn** (0.139 against 0.142), because they re-taste every face each
  round.
- **Fresh challenges are immune but blind**: 0.089 nectar per turn and no discrimination.

### (b) What breaks identity linkage

`analysis/identity-rules-sim.mjs` (the full design is in its header):

- **Garden**: 8 teams, int → list[int], one clover strategy each.
- **Clover strategies**:
  - HASH: a keyed hash of the challenge
  - TWIN: HASH, with the orchid an exact copy of the clover
  - COARSE: a keyed hash of `c // 2^24`
  - SALT: a header that is fresh every round
  - STYLE: a header fixed all game
  - CHAIN: a hash-chain header, one link revealed per round. A bee that trusted s_{r−1} can verify s_r; nobody can
    compute s_r from s_{r−1}.
  - CERT: a checkable certificate. It is cheap here; (c) calibrates real costly ones.
  - MIMIC: from round 2 its orchid wears last round's STYLE, SALT and CHAIN headers.
- **Bees**: identical in every team and compliant with the rule. They:
  - recognise their own flowers
  - check certificates
  - key a tally on the answer or its header
  - follow chains
  - feed while ≥ 75% paid
  - taste unknown keys
- **Rules**:
  - R0: none (bees use a per-round probe plus last round's probe as a link)
  - R1: no challenge twice per game
  - R2: the engine draws challenges uniformly
  - R3: R2, and bees are stateless within a round
- **v3 conditions**: randomized clovers, and bees with or without a quality check.

**Only R0 finished** (2 seeds × 4 rounds). The run was stopped on instruction before R2, R3 and v3, and R1 is suspect
(see below).

R0, no rule. Fed rates by rival bees over the game (last round in brackets):

| clover strategy | clover fed | orchid fed | fitness |
|---|---|---|---|
| HASH | 0.99 (0.99) | 0.02 (0.00) | 1.09 |
| TWIN | **0.01 (0.00)** | 0.02 (0.00) | **0.33** |
| COARSE | 0.99 (1.00) | 0.02 (0.00) | 1.08 |
| SALT | 0.99 (1.00) | 0.03 (0.03) | 1.09 |
| STYLE | 0.85 (**0.69**) | 0.01 (0.00) | 1.02 |
| CHAIN | 0.99 (0.99) | 0.02 (0.00) | 1.09 |
| CERT | 0.99 (1.00) | 0.00 (0.00) | 1.05 |
| MIMIC (clover HASH; orchid in costumes) | 0.99 (0.99) | **0.27 (0.43)** | **1.22** |

Across the 8 teams: bees' rival gap 0.81, rival precision 0.95, nectar per turn 0.131; fitness SD 0.26.

**Readings for R0:**

- **Without a rule, every deterministic clover except the twin keeps its identity at zero compute cost.** A keyed
  hash is as good as a chain or a certificate against bees that probe.
- **The one copyable feature is a static style.** The mimic's style costume makes STYLE's header mixed (0.69 in the
  last round), and the mimic does best (1.22).
- **Stale per-round salts and stale chain links cost bees only a feed or two.** Chain bees mark an element stale
  once its successor has appeared.
- **Twins collapse** (0.33) against bees that need 75% to keep feeding.

**Partial evidence for the other rules** (to be re-run before anyone relies on it):

- **R3, from a 1-seed, 2-round smoke test:**
  - Stateless bees can't link within a round, so HASH, TWIN, COARSE and SALT all sank to exploration rates (clover
    and orchid ≈ 0.5 / 0.5).
  - STYLE and CHAIN (1.00 / 0.00 in round 2) and CERT (0.99 / 0.00) stayed recognisable.
  - The mimic's stale costumes were fed at **0.91** in round 2, because a stateless bee can't learn mid-round that a
    header went stale. That favours the hash chain, whose stale links a bee can recognise from MEMORY by round 3.
- **R1, finished but suspect.** In it:
  - CERT stayed at 0.99 / 0.01, and COARSE (0.74 / 0.02) and CHAIN (0.73 / 0.01) stayed linkable.
  - HASH and TWIN fell to 0.54 / 0.53–0.54, the unknown-taste rate, as expected: no exact repeats means no hash
    face.
  - But SALT and STYLE also show 0.54 for the clover, against 0.01–0.03 for the orchid. By construction they should
    be linkable within a round, so this looks like a bug in the R1 bee path, probably the unknown-taste gate. I
    could not debug it after the stop.

**What the design predicts, unverified for R1–R3 and v3:**

- **R1 or the per-round rule** kills exact-challenge hashes. It leaves coarsened keys, per-round salts, static
  styles, chains and certificates.
- **R2** also kills coarsening, unless the bucket is so wide that the answer is effectively a static style. Per-round
  salt still works within a round.
- **R3** kills per-round salt and turns stale costumes into a real attack. Only hash chains (zero cost) and
  certificates survive as unforgeable identity.
- **v3 non-pure flowers change nothing for a deterministic keyed clover.** A randomized certificate clover shows no
  face, so it pays only against bees that check quality.

### (c) Calibrating a costly-but-checkable certificate

`node analysis/cert-calibrate.mjs 40` (hashcash re-run with 100 challenges):

- **Setup**: the Python runner, one call per challenge through `server/runners/proc.js` with the engine's flower
  setup, CPU_SLOTS=1. Times include the runner's fork (~2 ms).
- **Budget columns**: the share answered validly through `tryFlower` at the real budgets.
- **Bee checks**: timed in-process.

| certificate | challenge → response | median / p99 solve, ms | valid within clover 150 ms | valid within orchid 50 ms | bee check |
|---|---|---|---|---|---|
| factor star, Pollard–Brent rho, 12–26-bit factors | int → graph[any] | 2.3–4.3 / ≤ 8.3 | 100% | **100%** | 0.02 ms |
| factor star, trial division, 20-bit factors | int → graph[any] | 35 / 65 | 100% | 98% | 0.02 ms |
| factor star, trial division, 22-bit factors | int → graph[any] | 115 / 207 | 88% | 0% | 0.02 ms |
| hashcash k=8, d=14 (mean ≈ 125 ms) | int → list[int] | 105 / 216 | 92% | 4% | 0.006 ms |
| hashcash k=32, d=12 (mean ≈ 125 ms) | int → list[int] | 104 / 169 | 97% | 0% | 0.025 ms |
| hashcash k=64, d=11 (mean ≈ 125 ms) | int → list[int] | 101 / 149 | **99%** | **0%** | 0.05 ms |
| hashcash k=64, d=10 (mean ≈ 62 ms) | int → list[int] | 57 / 83 | 100% | 50% | 0.05 ms |
| time-lock, 256-bit N, t = 243,090 squarings | str (64 hex) → str | 87 / 111 | **100%** | **0%** | 0.08 ms |
| time-lock, 256-bit N, t = 303,863 | str → str | 112 / 142 | 100% | 0% | 0.08 ms |
| time-lock, N < 2^53, t = 1.34 M, done honestly | int → int | 105 / 179 | 98% | 0% | – |
| time-lock, N < 2^53, via a rho factoring shortcut | int → int | 4 / 9 | 100% | **100%** | – |

**Readings:**

- **The factor star cannot be a costly signal with int challenges.** Challenges stop at 2^53, so factors are at most
  26 bits, and an orchid with Pollard rho (~40 lines, well inside its budget) factors any of them in under 10 ms.
  The window at 22-bit factors exists only against an orchid that uses trial division. The star is checkable
  (0.02 ms) but not costly; REPORT §15 already saw that imitators "are stopped by the check, not by the work".
- **Trapdoor puzzles fail for the same reason.** The time-lock is ideal on paper (deterministic cost, tight spread,
  p99/median 1.27), but a bee-built N below 2^53 is factored in 4 ms, which hands the orchid the shortcut. With a
  str or list challenge (a 256-bit N in 64 hex characters), 243k squarings give a clover median of 87 ms (p99 111),
  0% for the orchid, and a 0.08 ms check for the bee, which knows φ(N).
- **Hashcash × k** needs no trapdoor and works for any challenge type. The sum of k geometric searches concentrates
  the cost: with k = 64 and d = 11, the clover answers 99% within 150 ms and the orchid 0% within 50 ms. It needs a
  response that holds k numbers: list[int] up to 64, or graph labels.
- **Calibrate per machine.** This box does 1.05–1.11 M sha256 tries/s and 3.0 M 256-bit squarings/s. Aim the
  clover's median at about 2× the orchid's budget (~100 ms) and re-measure on the server.
- **Any certificate is replayable if the challenge repeats.** A valid certificate for a fixed probe can be copied
  from the logs. Certificates need fresh challenges, which is the opposite of what fingerprinting needs.
- **Paley cliques** are being calibrated by another agent for v3, so they are not done here.

### (d) Twin economics in real games

**Twin**: an orchid that gave its own clover's answer on ≥ 90% of rival pre-feed asks where that answer is known
(`fingerprint-census.mjs`, last sections).

**Per visit**, fed rates by rival bees, split by the visiting bee's class that round:

| | probe bees: clover / orchid / whole patch | fresh bees: clover / orchid / whole patch |
|---|---|---|
| v2 twin patches (39 patch-rounds) | 0.69 / 0.46 / 0.58 | 0.54 / 0.53 / 0.54 |
| v2 partial twins (54) | 0.74 / 0.18 / 0.46 | 0.35 / 0.36 / 0.36 |
| v2 honest patches (329) | 0.90 / 0.09 / 0.50 | 0.43 / 0.33 / 0.38 |
| v1 twin patches (351) | 0.61 / 0.65 / 0.63 | 0.65 / 0.70 / 0.67 |
| v1 honest patches (676) | 0.76 / 0.45 / 0.60 | 0.65 / 0.36 / 0.50 |

**Team-game level**, OLS on the share of rounds the team ran a twin, with model dummies and game fixed effects:

- **v1 (n=244)**: allure −0.04 ± 0.01, fitness +0.00 ± 0.03.
- **v2 (n=85)**: allure −0.12 ± 0.06, forage −0.23 ± 0.15, fitness −0.33 ± 0.17.
- **Raw v2 fitness**:
  - teams that were twins in ≥ half their rounds: 1.04 (n=6, 4 of them opus)
  - twins in some rounds: 1.21 (n=11)
  - never a twin: 0.98 (n=68)

**Readings:**

- **Probe bees cost the twin's clover feeds:** 0.69 against 0.90 for honest clovers.
- **They pay for it at the orchid:** 0.46 against 0.09. A lax tally keeps feeding a 50% face, so the twin patch draws
  more feeds per probe-bee visit than an honest patch (0.58 against 0.50).
- **Fresh-challenge bees can't tell twins apart at all.**
- **Team-level allure doesn't bear it out.** Twin allure was flat to negative (−0.12 ± 0.06 per unit twin share in
  v2), so the per-visit gain did not show up in allure share. With 17 v2 twin team-games, mostly opus partial twins
  that differ on one rival's probe (REPORT §16), this is inconclusive.
- **The simulation (b) is unambiguous:** against bees that taste once and need 75% to keep feeding, twins collapse.

## Not finished (stopped on instruction)

- **4(b)**:
  - R2, R3 (beyond the smoke test) and the v3 conditions were never run.
  - R1 finished, but its SALT and STYLE numbers point to a bee-logic bug that I haven't fixed.
  - Re-run with `node analysis/identity-rules-sim.mjs 2 4 R1,R2,R3,V3-fp,V3-q` after fixing it, under the new rules:
    non-pure flowers, alternating-round flower changes and character budgets.
- **Paley-clique calibration** was left to the agent designing the v3 example flowers.
- **The rules have since changed**: flowers always non-pure, complexity in minified characters, clovers and orchids
  changing code in alternating rounds, a character-diff change budget. Nothing here models alternation. Under
  alternation an orchid could lag two rounds instead of one, which strengthens the rotation result in (a).

## Caveats

- **Censuses**:
  - The census uses each bee's own answers and challenges, so the faces of fresh-challenge bees are mostly unknown
    to the stolen-face detector: about 35% of v2 orchid visits have no known clover answer. Generator copies seen by
    those bees appear only in REPORT §8's re-run match rates.
  - Bee classes are behavioural thresholds, and "effective" is my definition.
  - The OLS standard errors ignore clustering by persona.
- **Simulation (a)** gives the thief perfect knowledge of the victim clover's answers. That is the best case for the
  thief: in play it needs its bee to ask the probe at the victim's clover first, which Kenji did ("my spy bee").
- **Calibration**: wall-clock timings on a shared 4-core VM, where another agent was running tests. The 100-trial
  hashcash re-run moved the k=8 and k=16 rows by a few points. Thresholds must be re-measured on the game server.
- **Engine change**: these runs straddle the engine v3 change ("flowers stateless but not pure"; `pureFlowers` is
  being removed). Every scripted flower in (a) and in R0–R3 is deterministic, so it behaves as a v2 pure flower.
  Only caching and compute accounting differ.
- **Historical budgets**: complexity is now measured in minified characters, not AST nodes. The node numbers in the
  REPORT and in §3 here describe the games as played.
