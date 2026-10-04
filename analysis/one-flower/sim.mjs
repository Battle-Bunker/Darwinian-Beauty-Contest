// Offline model of the one-flower garden, for equilibrium questions that need thousands of games.
//
// Faithful to the engine (server/engine.js) and the score (server/lib/scoring.js at 4ab3eaf) where it matters:
//   - rounds; every bee not sitting out takes one turn; its flower is drawn uniformly from all N (own included)
//   - a feed pays nectar = p/100 × E to the bee and pollen = (1 − p/100) × E to the flower; a leave pays nobody
//   - a bee that feeds sits out the next feedCost rounds; decisions see only turns from earlier rounds
//   - fitness = N² × pollination share × forage share, pollination_f = Σ_b √pollen[b][f],
//     forage_b = Σ_f √nectar[b][f], share = value / Σ (1/N when Σ = 0). Cross-checked against the real score().
// Abstracted: programs are policies; E per flower is a constant (measured on the real runner by energy.mjs);
// a response is a SIGNAL LABEL. A bee never knows whose flower it faces: it sees the label, and from public
// history it knows which flowers have shown that label and what percent each paid on its feeds, so it values a
// label by averaging over the flowers that show it. A unique unforgeable label (a signature) therefore pins the
// flower down; a shared label (a mimic, or no signal at all) pools them. A team's handshake is a private label
// only its own bee and flower can produce and check (a keyed MAC): exact self-recognition, both ways.
export const E_MIN = 162721;  // minimal Python flower (11 nodes, 0.6 ms): energy.mjs
export const E_MAC = 156299;  // with a keyed sha256 handshake (53 nodes)
export const E_POW = 24474;   // proof of work to 85% of 150 ms (90 nodes)

// The real score() (from DBC_ROOT if set, else this checkout) checks fitnessAll() on the first game of every batch.
let realScore = null;
try {
  const root = process.env.DBC_ROOT ? `file://${process.env.DBC_ROOT.replace(/\/?$/, "/")}` : new URL("../../", import.meta.url).href;
  realScore = (await import(new URL("server/lib/scoring.js", root).href)).score;
} catch { realScore = null; }

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The score as RULES.md states it (pollination × forage). */
export function fitnessAll(nectar, pollen) {
  const N = nectar.length;
  const P = [...Array(N).keys()].map((f) => nectar.reduce((s, row, b) => s + Math.sqrt(pollen[b][f]), 0));
  const F = nectar.map((row) => row.reduce((s, x) => s + Math.sqrt(x), 0));
  const tP = P.reduce((a, b) => a + b, 0), tF = F.reduce((a, b) => a + b, 0);
  return P.map((_, i) => {
    const pS = tP > 0 ? P[i] / tP : 1 / N, fS = tF > 0 ? F[i] / tF : 1 / N;
    return { pollination: P[i], forage: F[i], pollinationShare: pS, forageShare: fS, fitness: N * N * pS * fS };
  });
}

/**
 * teams[i] = {
 *   E                         energy per turn of its flower (a constant)
 *   handshake                 its bee and flower recognise each other exactly (keyed MAC both ways)
 *   pOwn                      percent its flower gives its own bee when it recognises it
 *   pRival                    percent it gives every other bee (and its own bee without a handshake)
 *   label                     the signal it shows every bee but its own (with a handshake): "sig3" (its own,
 *                             unforgeable), "anon" (everyone's: no signal), or another team's label (a mimic)
 *   labelAt?: (r) => label    optional: the label as a function of the round (rotation, mimics with a lag)
 *   bee                       "naive" (feeds always) | "selfOnly" | "never" | "thresh" (feeds at its own flower,
 *                             and at a label whose expected percent is >= theta) | "greedy" (see below)
 *   theta                     thresh: the percent cut-off
 *   noSelf                    the bee never feeds at a flower it knows is its own
 * }
 * "greedy": a myopic optimiser. For each label it can meet it computes Δ = the change in its team's fitness
 * if it fed there now (averaged over the flowers that show that label, at each one's last public percent,
 * a prior for flowers never seen paying), then accepts the set of labels that maximises the renewal reward
 * rate Σπ·Δ / (1 + feedCost·Σπ), and feeds iff the label in front of it is in that set.
 */
// constancy: the user's proposed variant. Pollen counts toward pollination only when the bee's NEXT feed is at
// another instance of the same species (the same team's flower); pollen carried to any other flower is lost.
// constancy = "reward": the same, and the pollen a bee delivers also counts toward its own forage (in the
// cell of the species it delivered to), so a bee is paid for being constant.
// selfSterile: pollen a flower gives its own team's bee never counts toward its pollination (self-incompatibility).
export function simulate({ teams, R = 600, feedCost = 10, seed = 1, prior = 30, check = false, constancy = false, selfSterile = false }) {
  const N = teams.length;
  const rand = rng(seed);
  const z = () => Array.from({ length: N }, () => new Array(N).fill(0));
  const feeds = z(), nectar = z(), pollen = z(), visits = z();
  const P = new Array(N).fill(0), F = new Array(N).fill(0);
  let tP = 0, tF = 0;
  const sitOut = new Array(N).fill(0);
  const carried = new Array(N).fill(null);   // constancy: { g, y } pollen the bee carries from its last feed
  const given = z();                          // constancy: all pollen given (delivered or not)
  const lastP = new Array(N).fill(null);   // last public percent each flower paid a bee it didn't recognise as its own
  const labelOf = (g, b, r) => (b === g && teams[g].handshake ? `hs${g}` : teams[g].labelAt ? teams[g].labelAt(r) : teams[g].label);

  const fitNow = (i) => N * N * (tP > 0 ? P[i] / tP : 1 / N) * (tF > 0 ? F[i] / tF : 1 / N);
  function fitAfter(i, b, g, x, y0) {
    const y = selfSterile && b === g ? 0 : y0;
    const dP = Math.sqrt(pollen[b][g] + y) - Math.sqrt(pollen[b][g]);
    const dF = Math.sqrt(nectar[b][g] + x) - Math.sqrt(nectar[b][g]);
    const Pi = P[i] + (i === g ? dP : 0), Fi = F[i] + (i === b ? dF : 0);
    const sh = (v, t) => (t > 0 ? v / t : 1 / N);
    return N * N * sh(Pi, tP + dP) * sh(Fi, tF + dF);
  }
  const pExpected = (g, b) => (b === g && teams[g].handshake ? teams[g].pOwn : lastP[g] ?? prior);
  // Fitness change of team i if only the pollen cell (b, g) grew by y.
  const fitPollen = (i, b, g, y0) => {
    const y = selfSterile && b === g ? 0 : y0;
    const dP = Math.sqrt(pollen[b][g] + y) - Math.sqrt(pollen[b][g]);
    const sh = (v, t) => (t > 0 ? v / t : 1 / N);
    return N * N * sh(P[i] + (i === g ? dP : 0), tP + dP) * sh(F[i], tF) - fitNow(i);
  };
  const delta = (b, g) => {
    const p = pExpected(g, b) / 100, E = teams[g].E;
    if (!constancy) return fitAfter(b, b, g, p * E, (1 - p) * E) - fitNow(b);
    // Myopic under constancy: the nectar now; the carried pollen is delivered if g is the species it came from
    // (good for the bee's team only if that is its own flower); new pollen from its own flower is counted as if
    // it will deliver it (it can choose to); its own carried pollen is lost by feeding elsewhere.
    const c = carried[b];
    const bonus = constancy === "reward" && c && c.g === g ? c.y : 0;
    const dN = fitAfter(b, b, g, p * E + bonus, 0) - fitNow(b);
    const deliver = c && c.g === g ? fitPollen(b, b, g, c.y) : 0;
    const keepOwn = g === b ? fitPollen(b, b, b, (1 - p) * E) : 0;
    const loseOwn = c && c.g === b && g !== b ? fitPollen(b, b, b, c.y) : 0;
    return dN + deliver + keepOwn - loseOwn;
  };

  function acceptCut(classes) {
    const cs = classes.filter((c) => c.d > 0).sort((a, b) => b.d - a.d);
    let best = -Infinity, cut = Infinity, sp = 0, sv = 0;
    for (const c of cs) {
      sp += c.pi; sv += c.pi * c.d;
      const rate = sv / (1 + feedCost * sp);
      if (rate > best) { best = rate; cut = c.d; }
    }
    return cut;
  }

  // What public history has taught every bee: which flowers have shown each label (identities are known only
  // for finished turns). A label never seen before is unknown: it could be any rival flower, at the prior.
  const seen = new Map();
  const learn = (l, g) => { if (!seen.has(l)) seen.set(l, new Set()); seen.get(l).add(g); };
  function valueOf(b, l) {
    // A bee with a handshake knows its own flower would have shown it the handshake, so it isn't this one.
    const s = [...(seen.get(l) || [])].filter((h) => !(h === b && teams[b].handshake && l !== `hs${b}`));
    if (s.length) return s.reduce((sum, h) => sum + delta(b, h), 0) / s.length;
    let sum = 0;
    for (let h = 0; h < N; h++) if (h !== b) { const E = teams[h].E, p = prior / 100; sum += fitAfter(b, b, h, p * E, (1 - p) * E) - fitNow(b); }
    return sum / (N - 1);
  }
  const expectedP = (b, l) => {
    const s = [...(seen.get(l) || [])].filter((h) => !(h === b && teams[b].handshake && l !== `hs${b}`));
    if (!s.length) return prior;
    return s.map((h) => pExpected(h, b)).reduce((a, c) => a + c, 0) / s.length;
  };

  function decide(b, g, r) {
    const t = teams[b];
    const here = labelOf(g, b, r);
    const knowsOwn = here === `hs${b}`;
    switch (t.bee) {
      case "naive": return true;
      case "never": return false;
      case "selfOnly": return knowsOwn;
      case "thresh": return knowsOwn ? !t.noSelf : expectedP(b, here) >= t.theta;
      case "greedy": {
        // The labels it can meet this round (their frequencies), valued by what it has learned.
        const freq = new Map();
        for (let h = 0; h < N; h++) { const l = labelOf(h, b, r); freq.set(l, (freq.get(l) || 0) + 1 / N); }
        const classes = [];
        let dHere = -Infinity;
        for (const [l, pi] of freq) {
          if (t.noSelf && l === `hs${b}`) continue;
          const d = valueOf(b, l);
          classes.push({ pi, d });
          if (l === here) dHere = d;
        }
        return dHere > 0 && dHere >= acceptCut(classes);
      }
    }
    throw new Error("unknown bee " + t.bee);
  }

  for (let r = 1; r <= R; r++) {
    const turns = [];
    for (let b = 0; b < N; b++) {
      if (sitOut[b] > 0) { sitOut[b]--; continue; }
      turns.push([b, Math.floor(rand() * N)]);
    }
    const decisions = turns.map(([b, g]) => decide(b, g, r));
    turns.forEach(([b, g], j) => {
      visits[b][g]++;
      learn(labelOf(g, b, r), g);
      if (!decisions[j]) return;
      const own = b === g && teams[g].handshake;
      const p = own ? teams[g].pOwn : teams[g].pRival, E = teams[g].E;
      const x = (p / 100) * E, y = E - x;
      const bonus = constancy === "reward" && carried[b] && carried[b].g === g ? carried[b].y : 0;
      const dF = Math.sqrt(nectar[b][g] + x + bonus) - Math.sqrt(nectar[b][g]);
      F[b] += dF; tF += dF;
      feeds[b][g]++; nectar[b][g] += x + bonus; given[b][g] += y;
      // Pollen that counts: all of it, or (constancy) what the bee carried here from the same species.
      let [cb, cg, cy] = !constancy ? [b, g, y] : carried[b] && carried[b].g === g ? [b, g, carried[b].y] : [b, g, 0];
      if (constancy) carried[b] = { g, y };
      if (selfSterile && cb === cg) cy = 0;
      const dP = Math.sqrt(pollen[cb][cg] + cy) - Math.sqrt(pollen[cb][cg]);
      P[cg] += dP; tP += dP; pollen[cb][cg] += cy;
      if (!own) lastP[g] = p;
      sitOut[b] = feedCost;
    });
  }
  const scores = fitnessAll(nectar, pollen);
  if (check && realScore) {
    const real = realScore(teams.map((_, i) => i), feeds, nectar, pollen);
    real.forEach((x, i) => { if (Math.abs(x.fitness - scores[i].fitness) > 1e-9 * Math.max(1, x.fitness)) throw new Error(`score mismatch team ${i}: ${x.fitness} vs ${scores[i].fitness}`); });
  }
  return { scores, feeds, nectar, pollen, given, visits };
}

/** Each team's mean results over `seeds` games. */
export function meanScores(teams, { R = 600, seeds = 20, feedCost = 10, seed0 = 1, prior = 30, constancy = false, selfSterile = false } = {}) {
  const N = teams.length;
  const acc = Array.from({ length: N }, () => ({ fitness: 0, pollinationShare: 0, forageShare: 0, feeds: 0, selfFeeds: 0, rivalFeedRate: 0, fedByRivals: 0, nectar: 0, pollen: 0, delivered: 0, rivalDelivered: 0 }));
  for (let s = 0; s < seeds; s++) {
    const out = simulate({ teams, R, feedCost, seed: seed0 + s, prior, check: s === 0 && !selfSterile && !constancy, constancy, selfSterile });
    out.scores.forEach((x, i) => {
      const a = acc[i];
      a.fitness += x.fitness / seeds; a.pollinationShare += x.pollinationShare / seeds; a.forageShare += x.forageShare / seeds;
      a.feeds += out.feeds[i].reduce((p, c) => p + c, 0) / seeds;
      a.selfFeeds += out.feeds[i][i] / seeds;
      a.nectar += out.nectar[i].reduce((p, c) => p + c, 0) / seeds;
      a.pollen += out.pollen.reduce((p, row) => p + row[i], 0) / seeds;
      const gv = out.given.reduce((p, row) => p + row[i], 0), dl = out.pollen.reduce((p, row) => p + row[i], 0);
      const gvR = out.given.reduce((p, row, b) => p + (b !== i ? row[i] : 0), 0), dlR = out.pollen.reduce((p, row, b) => p + (b !== i ? row[i] : 0), 0);
      a.delivered += (gv ? dl / gv : 0) / seeds;
      a.rivalDelivered += (gvR ? dlR / gvR : 0) / seeds;
      let rv = 0, rf = 0, fr = 0;
      for (let g = 0; g < N; g++) if (g !== i) { rv += out.visits[i][g]; rf += out.feeds[i][g]; fr += out.feeds[g][i]; }
      a.rivalFeedRate += (rv ? rf / rv : 0) / seeds;
      a.fedByRivals += fr / seeds;
    });
  }
  return acc;
}

export const team = (o = {}) => ({ E: E_MAC, handshake: true, pOwn: 50, pRival: 30, bee: "greedy", ...o });
