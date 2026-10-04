# Graph signal ideas for the one-flower garden

**Every team in this garden received this same document, and every team was told that every other team
has it.** It holds ideas and principles, not rules, recommendations or predictions. Use them, combine them,
change them or ignore them. Code fragments are sketches, not programs.

## What a response can do

- **Show wealth, this turn.** Each flower call has its own time budget R, between 50 and 150 ms, known to
  that call and to nobody else (RULES.md says how a call reads it).
  - E = (1100 − size) × max(0, R − CPU ms).
  - Responses always arrive at 150 ms, so only the response itself can show anything about R.
  - Work worth t ms fits only in a call with R ≥ t.
  - To speak about *this* turn, the work must depend on the bee's fresh challenge, so it can't be prepared in
    advance or reused.
- **Carry a reputation, across turns.** A bee never learns which species answered until the turn is over.
  A recognisable style lets a bee, or its operators' code, attach what past feeds taught to the response in
  front of it.
- **Work spends what it proves.** t ms of work leaves R − t for nectar and pollen. A flower that spends a
  fixed share of R shows a level that grows with what's left; one that spends all of R shows the most and
  has nothing left.
- **What a bee has:**
  - 50 ms a call, 11,000 nodes, and no history.
  - A `MEMORY` of at most 50 bytes: `{"f":17,"k":9,"n":31}` is 8.
  - `fed(nectar)` after a feed, in the same instance that still holds what `decide` parsed.
  - Operators who see every public turn, with its species, and can put recognisers and tables into the bee's
    code. Each code change empties `MEMORY`.
- **What leaks:**
  - Every response is public after its turn, with its species.
  - Every feed hands the feeding team a pollen grain: ⌊pollen^(1/3)⌋ characters of the flower's minified
    code (27,000 pollen gives 30 characters). The more a flower is fed, the more of its recipe its
    pollinators see.
- **The shape of a response.** It is `graph[any]`: any nodes, edges, and JSON labels on both, within 1 MB.
  Writing the JSON is part of the flower's compute.
  - Flower and bee can build the same instance from the challenge with the same seeded generator, so the
    response needs to carry only the answer: `G = random_graph(Random(c), n, p)`.
  - A call's clock starts at 0, so a flower can pace its work against R, but no response can carry the time
    of day.

## Wealth: certificates for problems seeded by the challenge

The pattern: build an instance from c, search for as long as the budget allows, return a certificate, and
let the bee rebuild the instance and grade the certificate.

| problem | certificate in the response | bee's check | how the level grows with effort |
|---|---|---|---|
| clique or independent set in G(c) | k node ids | k² edge lookups | slowly: each extra node costs far more search, and luck varies |
| colouring of G(c) with few colours, or one that avoids seeded forbidden pairs | a colour label per node | one pass over the edges | conflicts or colours fall with time |
| long simple path or cycle under constraints (nodes in label order, alternating colours, knight's moves on a board sized by c) | a node order | one pass | its length grows with search |
| matching or packing under constraints (avoid a seeded edge set, pack triangles) | an edge list | one pass | plain matchings are cheap to find; the constraints make it hard |
| embedding a seeded pattern H(c) in a seeded host | a node mapping | H's edges | steep on hard instances |
| labellings of a seeded tree (graceful, harmonious, distance-constrained) | a number per node | one pass | search |
| layouts: coordinates as labels with few crossings or target edge lengths | coordinates | segment pairs, or a sample of them | anytime |

- **Anytime optimisation.** Cut weight, tour length through seeded points, bandwidth or crossing count give
  a *score*, not a yes or no. The bee computes the score and compares it with what that score usually costs.
  Quality-for-time curves belong to a solver: a better algorithm reaches the same level in less time.
- **Fitting the check into 50 ms.** Rebuilding the instance costs the bee time too. Size the instance so
  rebuilding and checking fit, or spot-check a random sample of constraints when the certificate is large.
- **Remembering.** A threshold per family, and what feeds paid at each level: `{"t":9,"n9":31}`. Operators
  can measure solver curves offline and from the public record, and push thresholds as code.
- **Counter-moves to expect:**
  - The same work from a flower that offers little nectar: any flower with R ≥ t can do it, so work shows
    wealth, not generosity.
  - Corners cut to just above a bee's threshold, and luck on an easy instance.
  - A faster or smaller solver, re-implemented from public responses or from pollen grains.
  - Precomputing whatever doesn't depend on c, and reusing a certificate when a bee repeats a challenge.
  - Responses built to be slow to read or check, so a bee's checker runs out of time.

## Reputation: recognisable styles

- **Motif families.** Each species builds its responses from a family with its own parameters:
  - circulant rings with chord steps (s₁, s₂, s₃)
  - grids with a twist, or trees with a branching rule
  - a small gadget repeated
  - labels that follow `label(v) = (a·v + b) mod m`

  The challenge picks the instance; the family and its parameters stay the species'.
  - *Check:* an invariant in one pass, such as the degree histogram, chord steps, label differences or a
    triangle count.
  - *Energy:* a few dozen nodes and almost no CPU.
  - *Remember:* the parameters are a few bytes. `{"s":"3.7.11","g":2}` is 11 bytes, so three or four styles
    fit.
  - *Counter-moves:* a style visible in the public record can be inferred and re-implemented, often in less
    code. Pollen grains give pieces of the generator to every team that feeds. A flower that offers little can
    wear a generous species' style; the bee sees only the style at decision time, though operators see that
    two species share it.
- **Labels that carry structure.** Labels can hold numbers, strings, lists or objects:
  - coordinates, colours or ranks
  - parts of a certificate
  - a claimed level, or a mark of style

  A response can describe itself ("a 9-clique on nodes 3, 17, …"), but only what the bee checks counts.
  Claims cost nothing to copy.
- **Style and work together.** The style chooses the variant: which pattern to embed, which constraint set,
  which generator. The certificate is then laid out in the species' motif.
  - An imitator has to know the variant *and* do the work.
  - A bee recognises the variant and grades the work in one pass.
  - Every move of the variant also resets the bees' recognisers.
- **Moving styles.** Changing a parameter costs a flower a few nodes of its 220-a-minute change budget, while
  inferring a new style costs an imitator time. Each move resets every recogniser, including those of the
  species' own pollinators. Operators who see species after each turn can relink a moved style quickly.
- **Bee-side learning.** `fed(nectar)` runs in the instance that parsed the response, so it can store a style,
  a level and what they paid in a few bytes. A leave teaches nothing. Operators can build tables from every
  public feed and push them as code.
  ```
  def decide(c, r):   global s, k;  s, k = style(r), level(r, c)
                      return ("feed" if worth(s, k) else "leave"), fresh_challenge()
  def fed(nectar):    MEMORY[s] = round(nectar / 1000)      # s is still here: same instance
  ```
  - *Counter-moves:* flowers that change style too often for any record to form; flowers that copy whichever
    style pays best; flowers that tell bees apart by their challenges. Bees can answer with fresh
    challenges, exact checks rather than looks, thresholds that move, and operators who watch for one style
    shown by two species.

These combine: a motif that hides which puzzle variant was solved, a level that only one style's solver
reaches cheaply, or labels that tie a certificate to a species' rule.
