# Design notes

## Names

| Thing | Name | Why |
|---|---|---|
| rewarding flower program | **clover** | White clover (*Trifolium repens*) is the archetypal honest nectar plant, the bread and butter of honeybee forage |
| deceptive flower program | **orchid** | The bee orchid (*Ophrys apifera*) is the archetypal deceiver: it offers nothing and looks like something it isn't |
| bee program | **bee** | |
| a team's two flowers | **patch** | Bees never learn which patch a flower is in, or which of the two it is |
| `feeds[s][o]` | **feed ledger** | times bee *s* fed at patch *o* (clover or orchid) |
| `nectar[s][o]` | **nectar ledger** | nectar bee *s* got from patch *o* |
| Σ√xᵢ | **rootsum** | the diversity-weighted size of an earnings vector |
| rootsum of a patch's feed column | **allure** | how widely a patch gets pollinated |
| rootsum of a bee's nectar row | **forage** | how widely a bee finds real food |
| allure ÷ Σ allure | **allure share** | par 1/N |
| forage ÷ Σ forage | **forage share** | par 1/N |
| N² × allure share × forage share | **fitness** | par 1.0 for any N; "relative fitness" is the population-genetics term, and 1 means holding steady |

Short version for players: *"Fitness = allure × forage, each measured as your share of the garden, scaled so
that average is 1."*

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly patch and a patch can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

## One continuous garden

The round-based design (on the `claude/darwinian-beauty-contest-6c3cia` branch; arena/REPORT.md §1–19)
tried to force bees and flowers to be unpredictable by making them take turns to change: bees, then
orchids, then clovers, so each kind could react while the others stood still. It failed for a simple
reason: **a locked program isn't locked behaviour**. A bee that can tell rounds apart (its per-round
random seed, or how much memory it has) asks a brand-new secret question every round with no code change,
tastes each flower's answer to it once, and remembers which answers paid. The orchids' turn to copy came
too late every time (REPORT.md §19).

So this design drops rounds altogether:
- **One stream.** Bees take turns round robin, as fast as the programs run, for the whole game (2 minutes
  by default). A **round** is one turn for every bee; a bee that feeds is out of the round robin for the
  next 10 rounds. A bee is one long-running program; it keeps its state until its team replaces it.
- **Behaviour public at once, changes private.** Every ask, answer, feed and error is public the moment it
  happens. Code, what bees print, and each team's code changes and change budgets stay secret during
  play; once the game is over the replay shows every change and budget (and the code, unless the owner
  turns that off). Other teams have to read a change from behaviour, not from a changelog.
- **Change at any time, paid from a budget that refills.** Each program earns change budget per minute of
  game time, up to a cap of one minute's worth, and any change it can afford goes live at once. Over a
  default 2-minute game that's as much change as the round-based design allowed in six rounds (a clover or
  bee 40% of a full-size program, an orchid 140%). The rates keep the asymmetry: orchids earn 7× a
  clover's rate, so they can chase whatever bees trust; clovers change slowly. Writing programs in the
  lobby is free.

What this changes, and what it doesn't:
- Information no longer comes in batches. An orchid's team sees a clover's answer, and the question a bee
  asked to get it, the moment it's given, and can aim its orchid at it as soon as it can afford the change.
  Reaction speed (of the people or agents, and of the budget) now matters.
- A bee can still rotate a secret question as often as it likes, for free: rotating is behaviour, not a
  code change. What it can't hide any more is the question itself (it's public as soon as it's asked) or
  the answers it learned to trust. Whether that's enough for orchids to catch up depends on how fast they
  can react, which is what the games will show.
- Clovers still have their costly signal: 3× an orchid's compute on every answer.

### How it runs

- `server/engine.js`: a `Garden` runs one game's loop. Each round every bee that isn't feeding takes one
  turn, all at once (a feed takes a bee out of the round robin for the next `feedCost` rounds). Programs can be swapped at any moment: a
  flower's next ask uses the new code; a bee swaps at its next turn, abandoning its visit. Answers are
  labelled with the version that gave them.
- `server/live.js`: each running game's garden runs in exactly one server process, whichever holds the
  game's Postgres advisory lock; every process adopts running games nobody holds, so a game survives its
  process dying (its bees start afresh). Four times a second it writes the new actions, the clock and the
  ledgers, and notifies listeners. Submissions, pauses and finishes are written by whichever process got
  the request; the notification brings them to the garden.
- `server/games.js`: the clock lives in the database (`games.clock_ms`, game time, which stops while
  paused). A team's budget for a program is `min(cap, bank + perMinute × (clock − atMs))`; a submission
  pays its node-edit distance from the version playing now, inside the same transaction that writes the
  version, so two submissions can't spend the same budget.
- Viewers get the actions over Server-Sent Events, or page through them with `GET .../actions`.

How fast the garden runs depends on the programs: with trivial programs it does over a thousand actions a
second; flowers that use their compute budget slow every round down to their pace.

## Why rootsum

A vector of earnings `v` from N sources has rootsum `Σ√vᵢ`. For a fixed total `T`, rootsum is largest
when earnings are spread evenly (`√(N·T)`) and smallest when they all come from one source (`√T`).
Diminishing returns per source (`d√k/dk = 1/(2√k)`) mean the k-th feed from the same team is worth
less and less, so a bee can't farm one friendly patch and a patch can't rely on one loyal bee. Own-team
entries count like any other source: a team can always earn from itself, but only as one of N columns.

## Should a bee ever skip its own clover?

No. A bee meets its own flowers only as often as the shuffled deck deals them (2 of every 2N visits), so
self-dealing is capped by the deck, and it earns one rootsum term on each side, with diminishing returns.

What it does leak now is its question. Everything is public, so a bee that recognises its own clover by
asking a secret question shows that question to everyone, along with its clover's answer. The answer to
a *new* secret question is still unforgeable if the clover answers with a keyed hash, but every orchid
team can see which questions the bee keeps asking and which answers it feeds on.

## Asymmetric budgets and fair compute

| Budget (orchid = reference) | Why |
|---|---|
| **clover**: ½ size, 3× compute, a seventh of the orchid's change rate | **Costly signalling**: a clover can spend effort an orchid can't afford on every answer, such as a bigger, harder instance of its pattern. It changes slowly, so it can't simply out-run imitators. |
| **orchid**: the reference; 7× a clover's change rate | Orchids answer with more code and faster adaptation: more efficient generators, shallower look-alikes, re-aimed at whatever bees trust. |
| **bee**: 5× size, ½ compute | Room for detector repertoires but little time per decision, so the winning signals are *hard to make, easy to check*. |

**Fair compute**: the engine runs at most one program per CPU core, across every game in the process, and
keeps a small pool of processes per flower. When compute is the signal, a busy machine mustn't make a
clover time out. Wall-clock limits with one program per core behave like CPU limits (CPU-time interval
timers fire late on tickless kernels).

## Flowers are stateless, not pure

A flower runs fresh for every call, so nothing carries over between questions. But each call gets fresh
randomness and the clock (`time`, `Date.now()`) and can read its own budget as `GAME.ms`. A clover can run
an anytime search, such as a local search for a big clique, and answer with the best result it found
within 150 ms; an orchid has 50 ms to fake one. Bees can then judge how good an answer is, not just whether
they have seen it before. The engine never caches answers, so every ask runs the flower again.

Nothing forces a flower to use randomness: a deterministic clover can still be fingerprinted by repeating
a question.

## Programs are measured on, and run as, their minified form

Size and change are both measured on the program after the game minifies it (vendor/measure.js, the
same file in the server and the editor), and the minified program is what runs:
- It drops comments, blank lines and spacing.
- It renames every name the program defines to the shortest free name, most-used first.
- It strips TypeScript types.

**Size** counts the syntax-tree nodes of what's left:
- comments, types and redundant parentheses aren't nodes
- a literal weighs one per byte of its text, so a long string or number can't hide a lookup table
- a name that minifying must keep (attribute and keyword names, class attributes) weighs one, plus one
  per byte beyond 20, because those names exist when the program runs

Writing readable code costs nothing, so nobody gains by minifying by hand. Running the minified text means
names don't exist at runtime, so they can't hide data either. That needs renaming to be exactly safe, so
names keep their spelling where renaming could change behaviour:
- names bound in a class body (they're attributes)
- parameters also passed by keyword somewhere
- names that shadow a builtin
- the first part of a dotted import
- the names the game looks up (`flower`, `forage`, `tasted`, `GAME`)

**Change** is a weighted Zhang–Shasha tree edit distance between the program playing now and the new one.
Inserting or deleting a node costs its weight. Relabelling a literal costs the byte-level edit distance
between the old and new text; relabelling anything else costs 1. Before comparing, the new version's names
are lined up with the old version's: both are minified with every name blanked out, the two texts are
diffed, and names that fall in matching stretches are paired. So a rename, a comment or reformatting
costs nothing, and a new variable doesn't reshuffle every other name. Writing a program from nothing costs
its whole size. The editor's diff marks show the node operations, and a changed literal is marked byte by
byte.
