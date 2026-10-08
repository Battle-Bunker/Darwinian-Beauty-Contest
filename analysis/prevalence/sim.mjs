// Agent-based model of the proposed SPECIES PREVALENCE mechanic for the one-flower game.
//
// Rules modelled (RULES.md, one-flower): N teams, one flower species and one bee each; 200 ms rounds; every bee not
// sitting out visits one flower per round; a feed pays nectar = pct/100 × E and pollen = (1 − pct/100) × E, then
// the bee sits out feedCost = 20 rounds; E = (1100 − size) × max(0, R − CPU ms) × (1024 − bytes), R ~ U[3, 150];
// fitness = N² × pollination share × forage share, pollination_s = Σ_b pollen[b][s]^β, forage_b = Σ_s nectar[b][s]^α,
// α = β = 0.85, own cells count.
//
// The mechanic: a visit draws species s with probability p_s = (c(t) + P_s) / (N (c(t) + 1)), where
//   D_{s,b}  pollen from s to bee team b, decayed each round by 2^(−0.2 / halfLifeS) before adding the round's pollen
//            (halfLife null = cumulative: the scoreboard's own ledger);
//   Q_s      Σ_b D_{s,b}^β                 (basis "poll");  or the team's fitness from decayed ledgers (basis "fit");
//   P_s      N × Q_s / Σ_k Q_k, or 1 for all when Σ Q = 0;
//   c(t)     falls linearly from c0 = 1 at the start to `floor` at the end.
// Decay is implemented as growth: a feed in round r is added with weight g^r, g = 2^(0.2 / halfLifeS). Every cell is
// then D × g^r for the same r, so Q is scaled by one common factor and the shares are exactly the engine's.
//
// Abstractions (programs are policies; operators are a rule run once a minute per team, staggered):
//   flowers  vet   ~40 nodes, 50 bytes, CPU 0.6 ms, no signal
//            coop  410 nodes, 85 bytes, burns `burn` × R of CPU; its response is a costly signal an R-reader reads
//                  as one of 5 bins of R (3-10, 10-20, 20-30, 30-40, 40-150), right 60% of the time, else a
//                  neighbouring bin: readable only below ~40 ms
//            def   60 nodes, pct 0; once a minute copies the response STYLE of the species most fed in the last
//                  minute (public data). A copy is indistinguishable by style, but a cheap copy of a coop's costly
//                  signal reads as R < 10 (bin 0, sometimes 1)
//   bees     blind  always feeds
//            style  per-style value from public data (pooled over all species showing the style, weighted by
//                   prevalence), refreshed by its operator once a minute; accepts the style set that maximises its
//                   renewal rate Σπv / (1 + feedCost Σπ), so a style is fed iff its value ≥ feedCost × best rate
//            reader as style, but a coop style is split into 5 options by the R it reads
//            Values are the bee's marginal forage, (n_bs + x)^α − n_bs^α, so a bee prefers new sources.
//   operators (flowers) once a minute, pick the percent among p ± {0, 5, 10, 15} that maximises predicted
//            pollination over the next minute, given current prevalence and every bee's re-optimised acceptance,
//            then add N(0, noiseSd) noise; with probability `explore` a random candidate instead. A species whose
//            style a defector shows changes to a fresh style with probability `evade`.

export const ROUND_S = 0.2;
const BIN_MID = [6.5, 15, 25, 35, 95];
const BIN_LO = [3, 10, 20, 30, 40];
const BIN_P = [7, 10, 10, 10, 110].map((w) => w / 147);
const Q = [0, 1, 2, 3, 4].map((k) => {
  const row = [0, 0, 0, 0, 0];
  if (k === 0) { row[0] = 0.8; row[1] = 0.2; } else if (k === 4) { row[4] = 0.8; row[3] = 0.2; } else { row[k] = 0.6; row[k - 1] = 0.2; row[k + 1] = 0.2; }
  return row;
});
const HONEST_READ = [0, 1, 2, 3, 4].map((j) => BIN_P.reduce((s, p, k) => s + p * Q[k][j], 0));
const HONEST_RPOST = [0, 1, 2, 3, 4].map((j) => BIN_P.reduce((s, p, k) => s + p * Q[k][j] * BIN_MID[k], 0) / HONEST_READ[j]);
const COPY_READ = Q[0];
const binOf = (R) => (R < 10 ? 0 : R < 20 ? 1 : R < 30 ? 2 : R < 40 ? 3 : 4);
function readBin(k, u) {
  const row = Q[k];
  let acc = 0;
  for (let j = 0; j < 5; j++) { acc += row[j]; if (u < acc) return j; }
  return 4;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** The experiment-like population: 7 cheap veterans, 5 cooperators, 2 defectors; bees 5 blind, 5 style, 4 reader. */
export function experimentPopulation(rand, { beeMix = [5, 5, 4] } = {}) {
  const species = [];
  for (let i = 0; i < 7; i++) species.push({ kind: "vet", size: 40, bytes: 50, cpu: 0.6, pct: Math.round(5 + 35 * rand()) });
  for (let i = 0; i < 5; i++) species.push({ kind: "coop", size: 410, bytes: 85, burn: 0.2 + 0.4 * rand(), pct: Math.round(20 + 60 * rand()) });
  for (let i = 0; i < 2; i++) species.push({ kind: "def", size: 60, bytes: 50, cpu: 0.6, pct: 0 });
  const types = [...Array(beeMix[0]).fill("blind"), ...Array(beeMix[1]).fill("style"), ...Array(beeMix[2]).fill("reader")];
  for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
  return { species, bees: types };
}

/** Null test: 14 identical veterans at 20%, all bees blind, no adaptation. Any prevalence spread is sampling noise. */
export function nullPopulation() {
  return { species: Array.from({ length: 14 }, () => ({ kind: "vet", size: 40, bytes: 50, cpu: 0.6, pct: 20 })), bees: Array(14).fill("blind") };
}

export function simulate({
  seed = 1, rounds = 3000, feedCost = 20, population = experimentPopulation, popOpts = {},
  prevalence = null,          // null: uniform draws. { basis: "poll"|"fit", halfLifeS: null|number, floor, c0 = 1, warmupS = 0, capP = Infinity }
  alpha = 0.85, beta = 0.85,
  adapt = true, evade = 0.5, explore = 0.15, noiseSd = 3, steps = [-15, -10, -5, 0, 5, 10, 15],
  sampleEvery = 5,
} = {}) {
  const rand = rng(seed * 7919 + 13);
  const { species: sp0, bees } = population(rand, popOpts);
  const N = sp0.length;
  const sp = sp0.map((s) => ({ ...s }));
  const T = rounds * ROUND_S;

  // energy model
  const meanE = new Float64Array(N), Ebin = sp.map(() => new Float64Array(5));
  function refreshE(s) {
    const f = sp[s];
    if (f.kind === "coop") {
      const k = (1100 - f.size) * (1 - f.burn) * (1024 - f.bytes);
      meanE[s] = k * 76.5;
      for (let j = 0; j < 5; j++) Ebin[s][j] = k * HONEST_RPOST[j];
    } else {
      meanE[s] = (1100 - f.size) * (76.5 - f.cpu) * (1024 - f.bytes);
      for (let j = 0; j < 5; j++) Ebin[s][j] = meanE[s];
    }
  }
  for (let s = 0; s < N; s++) refreshE(s);
  const energy = (s, R) => {
    const f = sp[s];
    const cpu = f.kind === "coop" ? f.burn * R : f.cpu;
    return (1100 - f.size) * Math.max(0, R - cpu) * (1024 - f.bytes);
  };

  // styles: each species starts with its own; styleOwner[st] = the species that created it
  const styleOf = sp.map((_, s) => s), styleOwner = sp.map((_, s) => s);
  const newStyle = (s) => { styleOwner.push(s); return styleOwner.length - 1; };
  const isSignal = (st) => sp[styleOwner[st]].kind === "coop";

  // ledgers
  const z = () => Array.from({ length: N }, () => new Float64Array(N));
  const nec = z(), pol = z(), feeds = z(), visits = z();   // [bee][species], cumulative (the score's)
  const necD = z(), polD = z();                            // prevalence ledgers (growth frame), [bee][species]
  const colPow = new Float64Array(N), rowPow = new Float64Array(N);
  const P = prevalence;
  const g = P && P.halfLifeS ? Math.pow(2, ROUND_S / P.halfLifeS) : 1;
  let gr = 1;                                              // g^r

  const prev = new Float64Array(N).fill(1 / N);
  const cum = new Float64Array(N);
  function computePrev(r) {
    if (!P) { prev.fill(1 / N); return; }
    const t = r * ROUND_S;
    const c = (P.c0 ?? 1) + (P.floor - (P.c0 ?? 1)) * Math.min(1, t / T);
    const ramp = P.warmupS ? Math.min(1, t / P.warmupS) : 1;
    let tot = 0;
    const share = new Float64Array(N);
    if (P.basis === "poll") {
      for (let s = 0; s < N; s++) tot += colPow[s];
      for (let s = 0; s < N; s++) share[s] = tot > 0 ? colPow[s] / tot : 1 / N;
    } else {
      let tP = 0, tF = 0;
      for (let s = 0; s < N; s++) { tP += colPow[s]; tF += rowPow[s]; }
      for (let s = 0; s < N; s++) { share[s] = (tP > 0 ? colPow[s] / tP : 1 / N) * (tF > 0 ? rowPow[s] / tF : 1 / N); tot += share[s]; }
      for (let s = 0; s < N; s++) share[s] = tot > 0 ? share[s] / tot : 1 / N;
    }
    let sw = 0;
    for (let s = 0; s < N; s++) { prev[s] = c + ramp * Math.min(P.capP ?? Infinity, N * share[s]); sw += prev[s]; }
    for (let s = 0; s < N; s++) prev[s] /= sw;
  }
  function recomputePow() {
    colPow.fill(0); rowPow.fill(0);
    for (let b = 0; b < N; b++) for (let s = 0; s < N; s++) {
      if (polD[b][s] > 0) colPow[s] += Math.pow(polD[b][s], beta);
      if (necD[b][s] > 0) rowPow[b] += Math.pow(necD[b][s], alpha);
    }
  }

  // public data for operators
  const lastPct = sp.map((f) => f.pct);   // percent on the latest public feed (initially: known from earlier games)
  const feedSec = Array.from({ length: 60 }, () => new Float64Array(N)), visitSec = Array.from({ length: 60 }, () => new Float64Array(N));
  let curSec = -1;
  const sumWin = (ring, i) => { let x = 0; for (let k = 0; k < 60; k++) x += ring[k][i]; return x; };

  // bees' acceptance
  const marg = (b, s, x) => (x <= 0 ? 0 : Math.pow(nec[b][s] + x, alpha) - Math.pow(nec[b][s], alpha));
  function buildOptions(b, pctOf) {
    const reader = bees[b] === "reader";
    const byStyle = new Map();
    for (let s = 0; s < N; s++) { const st = styleOf[s]; if (!byStyle.has(st)) byStyle.set(st, []); byStyle.get(st).push(s); }
    const opts = [];
    for (const [st, list] of byStyle) {
      if (reader && isSignal(st)) {
        for (let j = 0; j < 5; j++) {
          let pi = 0, v = 0;
          for (const s of list) {
            const honest = sp[s].kind === "coop";
            const pr = prev[s] * (honest ? HONEST_READ[j] : COPY_READ[j]);
            pi += pr; v += pr * marg(b, s, (pctOf(s) / 100) * (honest ? Ebin[s][j] : meanE[s]));
          }
          opts.push({ st, bin: j, pi, v: pi > 0 ? v / pi : 0, list });
        }
      } else {
        let pi = 0, v = 0;
        for (const s of list) { pi += prev[s]; v += prev[s] * marg(b, s, (pctOf(s) / 100) * meanE[s]); }
        opts.push({ st, bin: -1, pi, v: pi > 0 ? v / pi : 0, list });
      }
    }
    return opts;
  }
  function solveCut(opts) {
    const sorted = opts.filter((o) => o.pi > 0 && o.v > 0).sort((a, b) => b.v - a.v);
    let best = 0, sp_ = 0, sv = 0;
    for (const o of sorted) { sp_ += o.pi; sv += o.pi * o.v; const rate = sv / (1 + feedCost * sp_); if (rate > best) best = rate; }
    return feedCost * best;
  }
  const tables = bees.map(() => ({ map: new Map(), unknown: true, kappa: 0 }));
  function updateBee(b) {
    if (bees[b] === "blind") return;
    const opts = buildOptions(b, (s) => lastPct[s]);
    const kappa = solveCut(opts);
    const map = new Map();
    let prior = 0;
    for (const o of opts) {
      const ok = o.v > 0 && o.v >= kappa;
      prior += o.pi * o.v;
      if (o.bin < 0) map.set(o.st, ok);
      else { if (!map.has(o.st)) map.set(o.st, [false, false, false, false, false]); map.get(o.st)[o.bin] = ok; }
    }
    tables[b] = { map, unknown: prior >= kappa, kappa };
  }

  // flower operators
  const events = [];   // { t, s, kind, relPrev, from, to }
  function visitsPerMin(b, r) {
    const secs = Math.min(60, Math.max(1, Math.floor(r * ROUND_S)));
    return (sumWin(visitSec, b) * 60) / secs;
  }
  function updateFlower(s, r) {
    const f = sp[s];
    if (f.kind === "def") {
      let best = -1, bestN = -1;
      for (let t = 0; t < N; t++) {
        if (sp[t].kind === "def") continue;
        const n = sumWin(feedSec, t) + rand() * 1e-3;
        if (n > bestN) { bestN = n; best = t; }
      }
      if (best >= 0 && styleOf[s] !== styleOf[best]) { styleOf[s] = styleOf[best]; f.bytes = sp[best].bytes; refreshE(s); }
      return;
    }
    if (evade > 0 && sp.some((d, k) => k !== s && d.kind === "def" && styleOf[k] === styleOf[s]) && rand() < evade) styleOf[s] = newStyle(s);
    if (!adapt) return;
    const cands = [...new Set(steps.map((d) => Math.max(0, Math.min(100, f.pct + d))))];
    const vpm = bees.map((_, b) => visitsPerMin(b, r));
    const scoreOf = (q) => {
      let Pq = 0;
      for (let b = 0; b < N; b++) {
        let gain = 0;
        if (bees[b] === "blind") gain = (1 - q / 100) * meanE[s];
        else {
          const opts = buildOptions(b, (k) => (k === s ? q : lastPct[k]));
          const kappa = solveCut(opts);
          for (const o of opts) {
            if (!o.list.includes(s) || !(o.v > 0 && o.v >= kappa)) continue;
            if (o.bin < 0) gain += (1 - q / 100) * meanE[s];
            else gain += HONEST_READ[o.bin] * (1 - q / 100) * Ebin[s][o.bin];
          }
        }
        const d = vpm[b] * prev[s] * gain;
        Pq += Math.pow(pol[b][s] + d, beta);
      }
      return Pq;
    };
    let pick;
    if (rand() < explore) pick = cands[Math.floor(rand() * cands.length)];
    else { let best = -Infinity; for (const q of cands) { const v = scoreOf(q); if (v > best) { best = v; pick = q; } } }
    const to = Math.max(0, Math.min(100, Math.round(pick + noiseSd * gauss(rand))));
    events.push({ t: r * ROUND_S, s, kind: f.kind, relPrev: prev[s] * N, from: f.pct, to });
    f.pct = to;
  }
  const offset = sp.map((_, i) => 150 + Math.round((i * 300) / N));

  // recording
  const nSamples = Math.floor(rounds / sampleEvery);
  const prevSeries = new Float32Array(nSamples * N);
  const pctSeries = new Float32Array(Math.ceil(rounds / 300) * N);
  const sitOut = new Int32Array(N);

  for (let b = 0; b < N; b++) updateBee(b);   // bees start knowing the opening percents (earlier games)
  computePrev(0);
  for (let r = 0; r < rounds; r++) {
    const sec = Math.floor(r * ROUND_S);
    if (sec !== curSec) { curSec = sec; feedSec[sec % 60].fill(0); visitSec[sec % 60].fill(0); }
    // operators (between rounds)
    for (let i = 0; i < N; i++) if (r >= offset[i] && (r - offset[i]) % 300 === 0) { updateFlower(i, r); updateBee(i); }
    // draws
    let acc = 0;
    for (let s = 0; s < N; s++) { acc += prev[s]; cum[s] = acc; }
    if (g !== 1) gr *= g;
    let fed = false;
    for (let b = 0; b < N; b++) {
      if (sitOut[b] > 0) { sitOut[b]--; continue; }
      const u = rand() * acc;
      let s = 0;
      while (s < N - 1 && cum[s] <= u) s++;
      visits[b][s]++; visitSec[sec % 60][b]++;
      const R = 3 + 147 * rand();
      const st = styleOf[s];
      let feed;
      if (bees[b] === "blind") feed = true;
      else {
        const e = tables[b].map.get(st);
        if (e === undefined) feed = tables[b].unknown;
        else if (Array.isArray(e)) {
          const k = sp[s].kind === "coop" ? binOf(R) : 0;
          feed = e[readBin(k, rand())];
        } else feed = e;
      }
      if (!feed) continue;
      const E = energy(s, R), x = (sp[s].pct / 100) * E, y = E - x;
      nec[b][s] += x; pol[b][s] += y; feeds[b][s]++;
      feedSec[sec % 60][s]++;
      lastPct[s] = sp[s].pct;
      sitOut[b] = feedCost;
      if (P) {
        const w = P.halfLifeS ? gr : 1;
        const op = polD[b][s], on = necD[b][s];
        polD[b][s] += y * w; necD[b][s] += x * w;
        colPow[s] += Math.pow(polD[b][s], beta) - (op > 0 ? Math.pow(op, beta) : 0);
        if (P.basis === "fit") rowPow[b] += Math.pow(necD[b][s], alpha) - (on > 0 ? Math.pow(on, alpha) : 0);
        fed = true;
      }
    }
    if (P && r % 300 === 299) recomputePow();
    if (P && (fed || true)) computePrev(r + 1);
    if (r % sampleEvery === 0) prevSeries.set(prev, (r / sampleEvery) * N);
    if (r % 300 === 299) pctSeries.set(sp.map((f) => f.pct), ((r + 1) / 300 - 1) * N);
  }

  // the score
  const Pn = Array.from({ length: N }, (_, s) => nec.reduce((a, row, b) => a + Math.pow(pol[b][s], beta), 0));
  const Fn = nec.map((row) => row.reduce((a, x) => a + Math.pow(x, alpha), 0));
  const tP = Pn.reduce((a, b) => a + b, 0), tF = Fn.reduce((a, b) => a + b, 0);
  const scores = Pn.map((_, i) => {
    const pS = tP > 0 ? Pn[i] / tP : 1 / N, fS = tF > 0 ? Fn[i] / tF : 1 / N;
    return { pollinationShare: pS, forageShare: fS, fitness: N * N * pS * fS };
  });
  return { N, species: sp, sp0, bees, scores, feeds, nec, pol, visits, prevSeries, pctSeries, events, nSamples, sampleEvery, styles: styleOwner.length };
}
