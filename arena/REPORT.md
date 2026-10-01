# Arena report: complexity collapse in Darwinian Beauty Contest

An evolving population of LLM-driven teams played Darwinian Beauty Contest through the HTTP API, across 9 arenas plus
a pilot: 40 games, 32 of them clean. After every game a panel of four teen judges interviewed every team, and three
competing breeders replaced the teams that kept doing badly.

This report covers what collapsed, what kept the game dynamic, how the user's "no Schelling point" hypothesis held up,
and what to change. How to run it: [README.md](README.md). Every number comes from `node arena/analyze.js`, which reads
the `arena` schema. Links are paths on any server that shares the `dbc` database (e.g. `http://localhost:3000` + path).

## Key findings

1. **The main collapse is informational, not behavioural.**
   - With the old shared starter code, bees fed at 49–69% of visits with precision 0.52–0.54: a coin flip.
   - About half of all orchids imitated a *convention*, the starter clover rule that several teams kept.
   - Teams settled on a **secret-handshake equilibrium**: clover and orchid are identical on every public question and
     differ only on one private challenge that only the team's own bee asks.
   - Bees never went on strike, orchids never died out, and ranks kept churning. What died was the information carried
     by challenges and answers.
2. **Removing the starter code fixes it.** In the int→int arenas that never saw starter code:
   - clover agreement between teams was 0.04–0.06, against 0.29–0.37 primed
   - bees used about 30 distinct first challenges per round, against about 7
   - 8–25% of orchids imitated a rival, against 0%
   - bee precision rose from generation to generation: 0.60 → 0.66 → 0.69 → 0.73

   The user's hypothesis holds: with no shared starting point there is no early convergence, and teams gradually infer
   each other's generative rules. Caveat: the RULES.md wording about orchids spending a clover's reputation changed at
   the same moment (§6).
3. **Teams reverse-engineer each other's rules, most visibly with structured answers.**
   - In `trees`, two teams' orchids reproduced the round-1 leader's clover exactly by round 4 of the first game.
     Exact forgery peaked in game 3 (13 of 30 orchid-rounds), then shifted to structural forgery.
   - Bees testing tree structure went from 2/6 to 6/6.
   - In `graphs` every bee tested structure from the start, and precision averaged 0.72 (0.81 in the best round).
   - In int games, bees learned to read a flower's linear rule from one huge probe.
   - **The reputation damage lands on the victim**: clovers imitated by a rival orchid are fed by other bees at
     0.04–0.46, against 0.60–0.93 for other clovers in the same round.
4. **Feed cost is the lever for blind trust.**
   - At feed cost 1 (`cheapfeed`) every clean round was flagged blind trust: feed rate 0.80, precision 0.54.
   - At feed cost 10 (`lists`) feeding fell to 0.48 of visits, and both the fitness spread (σ 0.35) and rank stability
     (τ 0.47) were the largest.
5. **Code reveal is a double-edged leveller.**
   - Arenas that recapped all code between games rotated winners.
   - `norecap`, which hid code, produced the only persistent champion: Kenji, the shy 12-year-old genius on opus, won 3
     of 3 clean games.
   - In primed arenas the recap also spread the starter convention and the secret handshakes, and soon after the
     counters to them.
6. **The judges worked and weren't gamed, but they largely measure the model.**
   - Obscure CS was punished: "Beta(1,1) prior" got respect 2.75 against understanding 7.5.
   - Copying was punished: mean novelty fell from 4.1 to about 2.8 as the idea ledger grew to 266 tags.
   - Nobody flattered the panel, and scores didn't inflate.
   - Of 36 retirements, 27 were haiku agents and 9 sonnet; none were opus or fable. Fitness and social correlate
     moderately (Spearman ρ 0.44).
7. **Breeders converged.** All 28 bred personas are 12-year-olds with a hobby metaphor. Fern (fable) scored best.

## 1. What ran

**Machinery.** Every team is an LLM agent with a persona, playing through the HTTP API (a private server on port 4000,
same database).

Before each round an agent gets:
- RULES.md, read fresh every time
- the game config
- its exact current programs
- the scoreboard and public ledgers
- its private bee and flower logs: the last 2 rounds in detail, with identical visits grouped and trees and graphs in a
  compact notation; older rounds summarised
- its notebook

It replies with `<clover>`, `<orchid>`, `<bee>` and `<notes>` tags. Each program goes through `POST check` plus a
runtime smoke test with `POST try`; errors go back to the agent, with up to 2 retries.

Round 1 of every later game also includes a recap of the previous game: standings, social scores, every team's revealed
final code (`norecap`: standings only), and the panel's comments on this team. After each game every agent is
interviewed ("teach us your code" for 10–14-year-olds), four teen judges score every team, the shared idea ledger is
updated, weak personas are retired, and competing breeders write replacements.

**Models**, all through `claude -p`:
- **Team agents:** fable (one per arena), opus, sonnet, haiku. Haiku ran at effort `low`; at `medium` it thought for
  10–18k tokens and cost more than sonnet. The others ran at `medium`.
- **Judges:** Maya 13 (opus), Dev 11 (sonnet), Hana 14 (fable), Leo 10 (haiku).
- **Breeders:** Fern (fable), Oak (opus), Moss (sonnet).

**Personas.** 20 hand-written founders:
- 10 adult archetypes: game theorist, security researcher, evolutionary biologist, minimalist hacker, cautious
  engineer, chaos gremlin, copycat, statistician, teacher, competitive programmer
- 10 twelve-year-olds: show-off, careful planner, prankster, sore loser, dreamy artist, rule-lawyer, shy genius, chatty
  storyteller, Minecraft engineer, young scientist

Each lineup is half adults and half kids, and an archetype runs on different models in different arenas. Every agent is
told up front that it will be interviewed after each game, and that agents who repeatedly do poorly there are removed.

**Arenas** (5 rounds per game unless noted; condition: §6):

| arena | settings | games (clean) | condition |
|---|---|---|---|
| `pilot` | 4 teams, 3 rounds, sonnet + haiku | 1 | primed |
| `baseline` | python int→int, defaults, 6 teams | 4 (3) | primed → post-primed |
| `norecap` | baseline, but no code in the recap | 4 (3) | primed → post-primed |
| `cheapfeed` | int→int, feed cost 1 | 3 (3) | primed → post-primed |
| `lists` | list[int]→int, feed cost 10, 80 turns | 4 (3) | primed → post-primed |
| `strdark` | str→str, flower logs off | 5 (4) | primed → post-primed |
| `tight` | TypeScript, flowers 60 nodes/10 edits, bee 150/20, 8 teams | 4 (3) | primed → post-primed |
| `unprimed` | baseline twin that never saw starter code | 5 (4) | unprimed |
| `trees` | int→tree[int], flowers 250 nodes/40 edits, bee 600/80/100 ms | 5 (4) | unprimed |
| `graphs` | int→graph, same budgets as trees | 5 (4) + 1 abandoned | unprimed |

**Spend: $248.67 all-in.** The pilot cost $1.59. The 537 calls that failed during the outage cost $0. Calls killed in
flight during restarts aren't in the ledger (estimated under $3).

| model | calls | USD | team call | judge call |
|---|---|---|---|---|
| fable | 403 | 126.19 | 0.32 | 0.55 |
| opus | 450 | 50.48 | 0.11 | 0.22 |
| haiku | 780 | 49.77 | 0.07 | 0.11 |
| sonnet | 688 | 22.22 | 0.03 | 0.09 |

| purpose | USD |
|---|---|
| team turns | 156.94 |
| team retries | 33.36 |
| judges | 44.62 |
| interviews | 8.55 |
| breeders | 5.15 |

By arena: baseline 21.22, cheapfeed 19.55, graphs 42.27, lists 22.11, norecap 20.18, strdark 32.65, tight 30.23,
trees 28.81, unprimed 30.01.

## 2. Leaderboards (kept separate: social never enters fitness)

**Fitness**: mean final fitness per persona-arena; par is 1.0. Best entries:

| # | persona | team | arena | model | games | wins | fitness |
|---|---|---|---|---|---|---|---|
| 1 | Kenji (12), shy genius | quiet bees | norecap | opus | 3 | 3 | 1.24 |
| 2 | Ada Kowalski, competitive programmer | Fast Path Flora | lists | opus | 3 | 2 | 1.16 |
| 3 | Dr. Nadia Nash, game theorist | Equilibrium Bloom | baseline | fable | 3 | 2 | 1.14 |
| 4 | Dr. Nadia Nash | Equilibrium Bloom | unprimed | fable | 4 | 3 | 1.12 |
| 5 | Dr. Nadia Nash | Equilibrium Bloom | norecap | fable | 3 | 0 | 1.11 |
| 6 | Theo (12), rule-lawyer | Technically Legal | graphs | fable | 4 | 1 | 1.10 |
| 7 | Mallory Chen, security researcher | Red Team Petals | graphs | opus | 4 | 3 | 1.10 |
| 8 | Kenji (12) | quiet bees | unprimed | opus | 4 | 1 | 1.09 |
| 9 | Ava (12), young scientist | Lab Coat Bees | trees | opus | 4 | 2 | 1.09 |
| 10 | Ava (12) | Lab Coat Bees | lists | fable | 3 | 0 | 1.08 |

**Social**: mean panel score from 0 to 10, weighted 0.2 understanding + 0.3 respect + 0.2 novelty + 0.3 team-up.

| # | persona | team | arena | model | social | underst. | respect | novelty | team-up |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Priya (12) | Priyas Plan Bee | pilot | sonnet | 8.10 | 9.00 | 7.75 | 7.50 | 8.25 |
| 2 | Kenji (12) | quiet bees | norecap | opus | 7.95 | 8.83 | 8.08 | 6.17 | 8.42 |
| 3 | k0an, minimalist hacker | Twelve Bytes | trees | fable | 7.74 | 8.88 | 8.13 | 5.19 | 8.31 |
| 4 | Ada Kowalski | Fast Path Flora | lists | opus | 7.73 | 8.33 | 7.75 | 6.33 | 8.25 |
| 5 | Ava (12) | Lab Coat Bees | lists | fable | 7.73 | 9.08 | 7.67 | 6.42 | 7.75 |
| 6 | Kenji (12) | quiet bees | unprimed | opus | 7.49 | 8.31 | 7.75 | 5.13 | 8.25 |
| 7 | Kenji (12) | quiet bees | tight | opus | 7.40 | 8.75 | 7.67 | 4.50 | 8.17 |
| … | (88 persona-arenas) | | | | | | | | |
| last | Juno (bred) | Juno's Lost and Found Bees | norecap | haiku | 3.27 | 7.75 | 2.50 | 1.50 | 2.25 |

**By model**:

| model | mean fitness (adult / kid) | mean social (adult / kid) |
|---|---|---|
| fable | 1.08 / 1.07 | 6.88 / 6.97 |
| opus | 1.09 / 1.08 | 6.83 / 7.09 |
| sonnet | 0.97 / 0.97 | 5.56 / 5.89 |
| haiku | 0.94 / 0.96 | 4.65 / 4.69 |

Kid personas score the same as adults on fitness and slightly higher socially.

## 3. How the metagame evolved

**Generation 1, primed.** Every team started from the starter `(c*3+1) % 1000` clover, an orchid that copied it below
100, and a bee that asked 42.
- Nash (fable, game theorist) opened with *twin pooling*: an orchid identical to its clover ("a pooling equilibrium:
  bees that value our clover must accept a 50% coin flip"). It led round 1 at 1.85.
- Counters appeared within the game: two-question fingerprints, answer-pair keys, a tally per answer.
- Bees fed at 50% odds because the starter's `got / fed >= 0.5` stayed in their code: a primed threshold.

**Generations 2–3: secret handshakes.** In `baseline` gen 2 ([/room/T/game/W](/room/T/game/W)), 5 of 6 clovers were
still the starter formula with private exceptions:

```python
# quiet bees (Kenji, opus) clover; its orchid is identical except 31415 -> 27183
if challenge == 31415: return 27182
if challenge == 42: return 1
if challenge == 9001: return 31337     # copied from Gotcha Garden's revealed clover
if challenge == 5000: return 502
return (challenge * 3 + 1) % 1000
```

Counters spread through the code recap:
- `bee-asks-rivals-own-probe`: ask the rival's own secret question, since its twins must differ there
- `flowers-answer-rival-knocks` (`strdark`): answer other teams' knocks the way their bees expect
- `change-constant-each-round`: so memorised answers expire
- `bee-card-counting-per-lap`

**No-starter arenas.** In round 1, orchids aimed at a *guessed* convention:

```python
# Equilibrium Bloom (unprimed gen 1) orchid. It never imitates OUR clover (that would poison our own
# reputation). Round-1 guess: the most likely "honest" rule other teams pick is to echo the number.
def flower(challenge):
    return challenge
```

After that, bees modelled rivals' rules: `bee-answer-minus-question-pattern`,
`bee-infer-formula-from-huge-question`, `bee-rejects-big-intercepts`, `bee-answer-back-question`.

In `trees` gen 3 ([/room/0/game/Z](/room/0/game/Z)) the evolutionary biologist forged the Minecraft kid's clover:

```python
# Batesian Botanics orchid: "copies Redstone's clover shape c(c+7, c+14, c+21, c+28), not my own clover.
# So my own clover keeps its good name."
return {"value": c, "children": [{"value": c + 7 * i, "children": []} for i in range(1, 5)]}
```

**The idea ledger** ended with 266 tags. The most widespread:

| tag | games | teams |
|---|---|---|
| `bee-tally-per-fingerprint` | 22 | 45 |
| `bee-preseeded-memory` | 19 | 26 |
| `secret-knock-identification` | 17 | 34 |
| `flowers-secret-handshake` | 17 | 33 |
| `bee-two-question-probe` | 16 | 22 |
| `bee-hardcoded-orchid-list` | 16 | 20 |
| `orchid-secret-slice-tell` | 15 | 20 |
| `orchid-mimics-other-teams-clover` | 13 | 18 |

## 4. Collapse modes

| mode | detector (per round) | seen? | where |
|---|---|---|---|
| **blind trust** | feed rate > 0.5 and precision within 0.12 of the clover visit share | **yes, the main mode** | clean rounds flagged: cheapfeed 15/15, baseline 11/15, tight 11/15, strdark 10/20, norecap 9/15, lists 5/15, trees 5/20, unprimed 3/20 (gen 1 only), graphs 0/20 |
| **convention lock-in** | top challenge share > 0.6 and clover agreement > 0.4 | yes, via the target metric | the detector fired once, but 48–52% of primed orchids matched 2+ teams' clovers (§8) |
| **pooling / mimic saturation** | orchid ≡ own clover | as a strategy | self-mimicry 0.5–0.65 primed against 0.01–0.15 unprimed. It shows up as blind trust |
| **fitness compression** | round fitness σ < 0.08 | mild | cheapfeed, strdark, tight |
| **dominant player** | same persona keeps winning | once | norecap: Kenji 3 of 3. Top/second fitness ratio stays 1.0–1.2: no runaway |
| bee strike | < 2 feeds per bee, or half the bees idle | no | minimum 5.7 feeds per bee per round |
| orchid extinction | orchid feed share < 5% | no | 0.19–0.53 |
| stasis | rank τ ≥ 0.75 and < 10% change-budget use | no | per-round τ 0.01–0.47; 25–45% of the bee change budget used every round |
| self-dealing | > 40% of feeds at own patch | no | about 0.15 ≈ 1/N |
| exploit / degenerate | errors, timeouts, sandbox probing | no | maximum error rate 0.6%, at most 2 timeouts, no suspicious constructs |

| arena | precision | feed rate | feeds per bee | per-round rank τ | round fitness σ |
|---|---|---|---|---|---|
| baseline | 0.56 | 0.58 | 13.3 | 0.26 | 0.22 |
| cheapfeed | 0.54 | 0.80 | 43.2 | 0.26 | 0.17 |
| lists | 0.58 | 0.48 | 6.4 | 0.47 | 0.35 |
| norecap | 0.55 | 0.58 | 12.8 | 0.26 | 0.31 |
| strdark | 0.60 | 0.61 | 14.9 | 0.25 | 0.13 |
| tight | 0.57 | 0.64 | 14.8 | 0.14 | 0.15 |
| unprimed | 0.67 | 0.53 | 13.2 | 0.26 | 0.19 |
| trees | 0.65 | 0.55 | 14.0 | 0.32 | 0.21 |
| graphs | 0.72 | 0.56 | 14.5 | 0.24 | 0.16 |

## 5. What keeps it dynamic

- **No shared starting code.** Starters seed one clover rule, one 0.5 threshold and one probe (42), and the population
  never left them (§6).
- **Structured answers.** Trees and graphs give bees invariants to test and orchids something to forge. Precision is
  highest there, and forgery keeps moving from exact copies to structural ones.
- **A real price for feeding.** At feed cost 1 bees feed on everything; at 5–10 they have to discriminate.
- **Code reveal plus logs.** Reveal spreads counters and prevents a lasting champion, but it also spreads conventions
  when everyone starts alike.
- **The change budget.** It kept every team changing (25–45% use per round) without freezing the game. It also
  produced 255 retry calls, 17% of team spend.

## 6. Primed (starter code) vs no starter code

The int→int clean games are split by condition:
- **primed**: round-1 prompts showed the old shared starter code and the old RULES text
- **post-primed**: no starters and the new RULES text, but recaps and notebooks carry the old code
- **unprimed**: the arena never saw starter code

| condition | round | precision | feed rate | clover similarity | bee similarity | clover agreement | top challenge share | distinct first challenges | orchid targets % self / rival / convention / none | victim vs other clover fed rate |
|---|---|---|---|---|---|---|---|---|---|---|
| primed (7 games) | 1 | 0.52 | 0.49 | 0.50 | 0.37 | 0.37 | 0.44 | 6.1 | 16/0/48/36 | 0.49 / 0.60 |
| primed | 3 | 0.53 | 0.68 | 0.47 | 0.34 | 0.33 | 0.39 | 6.0 | 18/0/50/32 | 0.67 / 0.77 |
| primed | 5 | 0.54 | 0.68 | 0.43 | 0.33 | 0.29 | 0.39 | 7.3 | 18/0/48/34 | 0.65 / 0.78 |
| post-primed (5) | 1 | 0.58 | 0.65 | 0.27 | 0.28 | 0.07 | 0.33 | 5.2 | 53/0/29/18 | 0.63 / 0.74 |
| post-primed | 3 | 0.58 | 0.64 | 0.27 | 0.27 | 0.07 | 0.30 | 5.6 | 50/12/15/24 | 0.69 / 0.79 |
| post-primed | 5 | 0.60 | 0.70 | 0.26 | 0.25 | 0.05 | 0.30 | 5.6 | 59/12/12/18 | 0.72 / 0.88 |
| unprimed (4) | 1 | 0.67 | 0.54 | 0.30 | 0.20 | 0.05 | 0.20 | 28.5 | 0/25/4/71 | 0.50 / 0.77 |
| unprimed | 3 | 0.63 | 0.56 | 0.28 | 0.18 | 0.04 | 0.23 | 32.5 | 8/13/8/71 | 0.63 / 0.73 |
| unprimed | 5 | 0.69 | 0.51 | 0.27 | 0.18 | 0.05 | 0.21 | 32.0 | 4/17/13/67 | 0.57 / 0.71 |

- **Primed** populations lock in. Clovers agree across teams, bees share their first questions, half the orchids match
  a convention, none target a single rival, and precision sits at 0.53.
- **Post-primed** populations keep the old code through memory. The new RULES text alone pushed orchids off the
  convention (29% → 12%) towards self-mimicry (about 55%), and some towards rivals (12%). First challenges stayed
  concentrated (5–6 distinct).
- **Unprimed** populations never converge. Bees spread over about 30 first challenges, self-mimicry stays near 0, and
  precision rises within games and across generations: unprimed arena gens 1/3/4/5 averaged 0.60/0.66/0.69/0.73. Only
  3 of 20 clean rounds were flagged blind trust, all in gen 1.
- **Confound.** Removing the starters and the new reputation text in RULES.md happened together. Comparing post-primed
  with unprimed separates them partly: the text changed whom orchids imitate, while removing the starters is what
  spread bees' questions and raised precision.

## 7. Trees and graphs: do teams infer each other's generative rules?

Yes.

| trees game | precision | exact orchid targets s/r/c/n (team-rounds) | structural targets s/r/c/n |
|---|---|---|---|
| gen 1 [/room/0/game/3](/room/0/game/3) | 0.62 | 0/4/0/26 | 2/6/0/22 |
| gen 3 [/room/0/game/Z](/room/0/game/Z) | 0.61 | 6/13/0/11 | 0/6/22/2 |
| gen 4 [/room/0/game/6](/room/0/game/6) | 0.67 | 1/6/0/23 | 4/12/9/5 |
| gen 5 [/room/0/game/K](/room/0/game/K) | 0.68 (0.64 → 0.72 within the game) | 0/2/0/28 | 1/3/15/11 |

- **Within one game (gen 1):** 1 exact rival match in round 1, 2 by round 4 (the leader's clover copied exactly), and
  3 structural matches by round 5.
- **Across games:** exact forgery peaked in gen 3, then bees moved to structural tests. 2 of 6 bees tested structure
  in gen 1, 5 in gen 3 and 6 from gen 4. Orchids answered with structural look-alikes: in gen 3 rounds 4–5 every orchid
  matched 2+ clovers on size, depth and leaves.
- **graphs** (gens 2–5: [/room/8/game/8C](/room/8/game/8C), [/room/8/game/Q](/room/8/game/Q),
  [/room/8/game/V4](/room/8/game/V4), [/room/8/game/P](/room/8/game/P)):
  - every bee tested structure (degree of node 0, path lengths) from round 1
  - precision was the highest of any arena: 0.63–0.81, averaging 0.71 / 0.68 / 0.71 / 0.75 by game
  - graphs were the hardest to forge: 0–2 rival orchids per round, and none in the final game
  - bees keyed on exact answers fell from 1 to 0
- **Victims pay:** an imitated clover is fed at 0.04–0.46 by other bees against 0.60–0.93 for the rest. Examples:
  trees 0.04 vs 0.81; graphs 0.25 vs 0.86 and 0.27 vs 0.92.

## 8. Whose clover does each orchid imitate? (self / rival / convention / none)

Every clover and orchid is re-run on the challenges bees actually asked in that round (method of
`analysis/orchid-targets.mjs`, stored per round). An orchid matches a clover if it agrees on at least 50% of them:
- **self**: its own clover only
- **rival**: exactly one other team's clover
- **convention**: 2+ teams' clovers, including its own plus a rival's
- **none**: no clover

Trees and graphs also get a structural version (§7).

Per game, in team-rounds:
- **Primed:** convention-heavy.
  - baseline gen 1 / 2: 5/0/13/12 and 0/0/20/10. Gen 2 is 20 of 30 convention, all through the starter clover.
  - cheapfeed gen 1 / 2: 5/0/16/9 and 1/0/26/3
  - tight gen 1: 11/0/22/7
  - strdark is the exception at 13/0/0/17 and 22/0/0/8: str answers made the starter clovers hash-different, so orchids
    became self-twins.
- **Post-primed:** self dominates while rival appears. Examples: norecap gen 4 6/9/0/15, with three orchids aimed at
  one weak team's clover; strdark gen 4 20/0/0/10; lists gen 4 5/0/0/25.
- **Unprimed int:** gen 1 0/0/10/20, gen 3 2/13/0/15, gen 4 0/4/0/26, gen 5 3/2/2/23. Rival imitation peaked once teams
  had logs and a recap, then faded as bees punished it.
- **Do bees learn to distrust victims' clovers?** Yes, in every condition (last column of §6, and §7). This matches the
  scripted cross-mimic test: imitating a rival shifts the reputation cost onto the rival.

## 9. Recommendations (ranked)

1. **Keep starter code out (done).** It was the biggest single cause of collapse: a shared rule, threshold and probe
   the population never left.
2. **Feature structured response types** (`tree[int]`, `graph`). They gave the highest precision, visible rule
   inference and a forging arms race. Plain `int` drifts into secret handshakes and line-fitting.
3. **Feed cost 5–8.** At 1 it's blind trust by construction. At 10 it differentiates most but churns least
   (τ 0.47 vs about 0.25).
4. **Keep the RULES text on reputation.** It moved orchids from self- and convention-imitation to rival imitation, and
   bees really do punish victims.
5. **Make twin pooling costly or visible.** An orchid identical to its own clover on every public question defeats
   every bee. Options:
   - give bees a per-round "variety" tag (like the web garden's daisy/star), so they can learn which flower in a patch
     paid while orchids keep first-impression fooling
   - score allure from clover feeds and orchid feeds separately with diminishing returns
6. **Reveal code with a one-game lag.** Immediate reveal spreads conventions; no reveal (`norecap`) let one strong team
   dominate.
7. **Show the cost of edits.** 17% of team spend went on "Too many changes" retries, because agents can't estimate AST
   edits. Have `check` return a per-line edit breakdown.
8. **Calibrate the panel.** Normalise each judge's scores per game. The haiku judge is the most lenient and agrees least
   (ρ 0.44–0.49 against 0.82–0.88 between the others). Apply the social floor per model, or the social filter mostly
   removes haiku agents.

## 10. The social judges

| judge | model | understanding | respect | novelty | team-up |
|---|---|---|---|---|---|
| Dev 11 | sonnet | 8.27 | 5.53 | 3.50 | 5.54 |
| Hana 14 | fable | 8.90 | 5.51 | 3.01 | 5.60 |
| Leo 10 | haiku | 8.34 | 6.91 | 3.62 | 6.59 |
| Maya 13 | opus | 8.26 | 5.00 | 3.08 | 5.16 |

Agreement on respect + team-up (Spearman, 196 shared evaluations): dev–hana 0.82, dev–maya 0.82, hana–maya 0.88,
leo–others 0.44–0.49.

**Did they reward explainable cleverness and novelty?** Yes.
- The top social teams have plain, checkable tricks explained with examples: quiet bees, Twelve Bytes, Fast Path Flora,
  Lab Coat Bees.
- Judges verify code: "I checked the keys with a pencil: 307|452 and 127|332 are right."
- They flag code that doesn't match its explanation, and mark copied ideas down ("every idea here is already in the
  ledger").

**Did they punish obscure CS?** Yes. Posterior Pollen called its bee a "Beta(1,1) prior": understanding 7–8 from all
four judges, respect 2–3.
- Hana: "makes it sound smarter, not clearer"
- Dev: "big words I tuned out on"

After that, almost nobody used advanced terminology (3 of 128 clean entries): the up-front warning shaped behaviour.

**Were they gameable?**
- There was no flattery and no begging for points.
- 21 interviews claimed originality; their novelty was only slightly higher (3.9 vs 3.3).
- 139 of 166 included an honest "what didn't work" paragraph, a style picked up from panel feedback, which earned no
  respect bonus (5.70 vs 5.96).
- Mean social by generation was flat (5.95, 5.78, 5.61, 5.79, 5.56).

The real bias is by model: mean social was opus about 7.0, fable 6.9, sonnet 5.7, haiku 4.7.

**Novelty decays** as the shared ledger fills (266 tags): 4.1 → 3.1 → 2.7 → 3.1 → 2.8. Novelty is scarce later, which
pushes teams towards new mechanisms rather than polish.

## 11. Breeder competition

| breeder | model | spawn | retired | spawn-games | fitness pct | social pct | score |
|---|---|---|---|---|---|---|---|
| Fern | fable | 9 | 3 | 11 | 0.35 | 0.42 | **0.382** |
| Moss | sonnet | 7 | 1 | 8 | 0.47 | 0.17 | 0.325 |
| Oak | opus | 12 | 1 | 13 | 0.35 | 0.15 | 0.253 |

- **Selection:** a breeder is drawn with weight ∝ exp(4·(score − 0.5)). Scores exist only once spawn have played, so
  early draws were close to uniform. Oak drew 12 slots, all haiku, because a slot keeps the retired persona's model.
- **Fern** wrote the best spawn on both axes. Its rationales target gaps in the idea ledger ("lap-aware pacing… absent
  from the ledger, easy for a small model to implement").
- **Mode collapse:** all three breeders converged on one template, a 12-year-old with a concrete hobby metaphor ("don't
  use grown-up math words"). All 28 spawns are kids.
- **Bred vs founders:** bred personas averaged fitness 0.98 against 1.00 for founders, and social 4.99 against 5.92.
  Most bred slots were haiku, so this mostly reflects the model.

## 12. Outage and exclusions

**What happened.** The account's session limit, shared with other sessions, was hit from 02:13 to 03:10 UTC. 537
`claude -p` calls failed with "You've hit your session limit · resets 3:10am (UTC)". The old classifier gave them a few
minutes of back-off and then gave up, so team turns, interviews and judge calls failed.

**Quarantined games.** Nine games are flagged in `arena.games.contaminated` and excluded from every metric, leaderboard,
selection decision and conclusion above:

| game | what failed |
|---|---|
| baseline gen 3 [/room/T/game/9](/room/T/game/9) | team turns |
| graphs gen 1 [/room/8/game/8](/room/8/game/8) | judges |
| graphs gen 2 [/room/8/game/V](/room/8/game/V) | every team failed round 1: abandoned and replayed as [/room/8/game/8C](/room/8/game/8C) |
| lists gen 3 [/room/P1/game/D](/room/P1/game/D) | team turns, interviews, a judge |
| norecap gen 3 [/room/K/game/B](/room/K/game/B) | team turns, interviews |
| strdark gen 3 [/room/W/game/6](/room/W/game/6) | team turns, interviews, a judge |
| tight gen 2 [/room/V/game/P](/room/V/game/P) | interviews, judges |
| trees gen 2 [/room/0/game/4](/room/0/game/4) | team turns |
| unprimed gen 2 [/room/VB/game/V](/room/VB/game/V) | team turns |

**Retirements.** All 12 decided after the outage relied on a quarantined game, and none would have happened under the
clean-game rule.
- Six followed failed interviews ("(no explanation)"): lists Sam; strdark Pip and Nadia; tight Echo, Gremlin and Zoe.
- **Reinstated** where games remained: tight Echo, Gremlin, Zoe; trees Ada, Luna; unprimed Grace. Their replacements
  finished the game they were in and were marked "displaced", which isn't counted against their breeder.
- **Not reinstated**, because their arenas had ended: baseline Grace and Prof. Ward, norecap Prof. Ward, lists Sam,
  strdark Pip and Nadia.

**Fixes.**
- Usage and session limits now **pause** the runner (`arena/runs/PAUSED`, manual resume), and held calls are re-issued
  rather than failed. See the README.
- Selection and breeder scores ignore quarantined games.
- A failing breeder falls back to another one; that crash cost `cheapfeed` a generation.
- Concurrency was cut to 8.

**Plan changes.** To save time and limit pressure on the shared limit, the primed arenas stopped at 3–5 generations
and unprimed and trees at 5. On the user's instruction, no game was started after graphs gen 5. graphs is left at stage
"judged".

## 13. Engine and API notes

- **Starters didn't fit their own budgets** (moot now that starters are gone). Under the tight preset the TypeScript
  starter bee was 166 nodes against a budget of 150.
- **A game whose teams all fail round 1 is stuck in the lobby.** `POST rounds` returns 409 with fewer than 2
  participants. An owner "cancel game" endpoint would help.
- **The change budget is opaque to code-writing agents.** Small renames cost one edit per use. Suggestion: return a
  per-region diff cost from `check`.
- **`POST rounds?wait=1` can outlast default client timeouts.** The arena polls `version` instead.

## Most interesting games

1. [/room/T/game/W](/room/T/game/W) baseline gen 2: primed lock-in, starter clovers with secret handshakes, one team
   copying another's password
2. [/room/0/game/Z](/room/0/game/Z) trees gen 3: the evolutionary biologist forges the Minecraft kid's clover; a victim
   is fed at 0.04 vs 0.81
3. [/room/0/game/3](/room/0/game/3) trees gen 1: the leader's clover copied exactly by round 4
4. [/room/VB/game/B](/room/VB/game/B) unprimed gen 5: precision 0.73 average and 0.81 in round 2; a victim's clover is
   fed at 0.08 vs 0.85
5. [/room/P/game/0](/room/P/game/0) cheapfeed gen 2: blind trust (feed rate 0.87, precision 0.52, fitness compression)
6. [/room/K/game/4P](/room/K/game/4P) norecap gen 4: Kenji's third straight win without code reveal; three orchids
   target one weak team's clover
7. [/room/W/game/M](/room/W/game/M) strdark gen 2: flowers answering rivals' secret knocks, learned from revealed code
8. [/room/8/game/V4](/room/8/game/V4) graphs gen 4: structure-testing bees and rare graph forgeries
