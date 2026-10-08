// Runs the prevalence variants and writes results/<group>.txt and .json.
//
//   nice -n 19 node analysis/prevalence/run.mjs <group> [seeds]
//
// groups: main (basis × memory × floor + uniform), null (identical species, blind bees: pure sampling noise),
//         damp (exponents 0.5 / 0.85 / 1), mix (bee populations), early (start-up noise mitigations),
//         sticky (veterans keep their opening percents), alt (pollination vs feed-count basis, with a prior),
//         tune (half-life sweep of the adopted formula), mimic (slow mimics: can boom-bust appear?),
//         stress (the monopoly case against a higher floor or a cap), final (the summary table)
import { writeFileSync, mkdirSync } from "node:fs";
import { simulate, experimentPopulation, nullPopulation, ROUND_S } from "./sim.mjs";

const group = process.argv[2] || "main";
const SEEDS = Number(process.argv[3] || 20);
const OUT = new URL("./results/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const pv = (basis, halfLifeS, floor, extra = {}) => ({ basis, halfLifeS, floor, ...extra });
const name = (p) => (p ? `${p.basis} ${p.halfLifeS ? `ema${p.halfLifeS}` : "cum"} f${p.floor}${p.warmupS ? ` warm${p.warmupS}` : ""}${p.c0 && p.c0 !== 1 ? ` c0=${p.c0}` : ""}${p.capP ? ` cap${p.capP}` : ""}${p.prior ? (p.prior >= 1e3 ? ` prior${p.prior / 1e6}M` : ` prior${p.prior}`) : ""}` : "uniform");

function variants(g) {
  const V = [];
  if (g === "main") {
    V.push({ label: "uniform", prevalence: null });
    for (const basis of ["poll", "fit"]) for (const h of [null, 30, 60, 120]) for (const floor of [0, 0.1]) V.push({ label: name(pv(basis, h, floor)), prevalence: pv(basis, h, floor) });
  }
  if (g === "null") {
    const o = { population: nullPopulation, adapt: false, evade: 0 };
    V.push({ label: "uniform", prevalence: null, ...o });
    for (const h of [null, 15, 30, 60, 120]) for (const floor of [0, 0.1]) V.push({ label: name(pv("poll", h, floor)), prevalence: pv("poll", h, floor), ...o });
  }
  if (g === "damp") {
    for (const [a, b] of [[0.5, 0.5], [0.85, 0.85], [1, 0.85], [0.85, 1], [1, 1]]) {
      V.push({ label: `uniform a${a} b${b}`, prevalence: null, alpha: a, beta: b });
      for (const h of [60, null]) V.push({ label: `${name(pv("poll", h, 0.1))} a${a} b${b}`, prevalence: pv("poll", h, 0.1), alpha: a, beta: b });
    }
  }
  if (g === "sticky") {
    // veterans keep their opening percents (5-40%); only cooperators adapt
    const o = { adaptKinds: ["coop"] };
    V.push({ label: "sticky uniform", prevalence: null, ...o });
    for (const h of [null, 30, 60, 120]) V.push({ label: `sticky ${name(pv("poll", h, 0.1))}`, prevalence: pv("poll", h, 0.1), ...o });
    V.push({ label: `sticky ${name(pv("fit", 60, 0.1))}`, prevalence: pv("fit", 60, 0.1), ...o });
  }
  if (g === "alt") {
    // the recommended pollination variant (60 s, floor 0.1, a decaying prior) against an alternative basis:
    // decayed FEED COUNTS (how often bees choose a species) instead of pollen
    for (const [tag, o] of [["", {}], ["bees 0/7/7 ", { popOpts: { beeMix: [0, 7, 7] } }], ["sticky ", { adaptKinds: ["coop"] }]]) {
      V.push({ label: `${tag}uniform`, prevalence: null, ...o });
      for (const h of [60, 120]) {
        V.push({ label: `${tag}${name(pv("poll", h, 0.1, { prior: 20e6 }))}`, prevalence: pv("poll", h, 0.1, { prior: 20e6 }), ...o });
        V.push({ label: `${tag}${name(pv("feeds", h, 0.1, { prior: 0.25 }))}`, prevalence: pv("feeds", h, 0.1, { prior: 0.25 }), ...o });
      }
    }
  }
  if (g === "tune") {
    // the adopted formula (pollination, recent, c 1 -> 0.1) with a decaying prior: half-life sweep
    for (const [tag, o] of [["", {}], ["bees 0/7/7 ", { popOpts: { beeMix: [0, 7, 7] } }], ["null ", { population: nullPopulation, adapt: false, evade: 0 }]]) {
      if (tag) V.push({ label: `${tag}uniform`, prevalence: null, ...o });
      for (const h of [30, 45, 60, 90, 120, 180]) V.push({ label: `${tag}${name(pv("poll", h, 0.1, { prior: 20e6 }))}`, prevalence: pv("poll", h, 0.1, { prior: 20e6 }), ...o });
    }
  }
  if (g === "mimic") {
    // can prevalence produce Batesian boom-bust? Slow mimics (retarget every 3 min), models that don't evade
    for (const [tag, o] of [["slow mimic, no evasion ", { defEvery: 3, evade: 0 }], ["slow mimic, no evasion, bees 0/7/7 ", { defEvery: 3, evade: 0, popOpts: { beeMix: [0, 7, 7] } }], ["fast mimic, no evasion ", { evade: 0 }]]) {
      V.push({ label: `${tag}uniform`, prevalence: null, ...o });
      for (const h of [30, 60, 90, 120]) V.push({ label: `${tag}${name(pv("poll", h, 0.1, { prior: 20e6 }))}`, prevalence: pv("poll", h, 0.1, { prior: 20e6 }), ...o });
      for (const h of [60, 90]) V.push({ label: `${tag}${name(pv("feeds", h, 0.1, { prior: 0.25 }))}`, prevalence: pv("feeds", h, 0.1, { prior: 0.25 }), ...o });
    }
  }
  if (g === "stress") {
    // the monopoly case (all bees discerning, slow mimics, no evasion): do a higher floor or a cap on P contain it?
    const o = { defEvery: 3, evade: 0, popOpts: { beeMix: [0, 7, 7] } };
    for (const h of [60, 90]) for (const x of [{ floor: 0.1 }, { floor: 0.25 }, { floor: 0.1, capP: 4 }]) {
      const p = pv("poll", h, x.floor, { prior: 20e6, ...(x.capP ? { capP: x.capP } : {}) });
      V.push({ label: `stress ${name(p)}`, prevalence: p, ...o });
    }
  }
  if (g === "final") {
    // the summary: adopted formula, recommended settings, alternatives; default population and the stress case
    const P = [
      ["uniform", null],
      ["adopted: poll ema60 f0.1", pv("poll", 60, 0.1)],
      ["recommended: poll ema90 f0.1 prior20M cap4", pv("poll", 90, 0.1, { prior: 20e6, capP: 4 })],
      ["poll ema60 f0.1 prior20M cap4", pv("poll", 60, 0.1, { prior: 20e6, capP: 4 })],
      ["poll cum f0.1", pv("poll", null, 0.1)],
      ["poll ema30 f0.1", pv("poll", 30, 0.1)],
      ["poll ema60 f0 (literal 1->0)", pv("poll", 60, 0)],
      ["fit ema60 f0.1", pv("fit", 60, 0.1)],
      ["alt: feeds ema90 f0.1 prior0.25 cap4", pv("feeds", 90, 0.1, { prior: 0.25, capP: 4 })],
    ];
    for (const [tag, o] of [["", {}], ["stress ", { defEvery: 3, evade: 0, popOpts: { beeMix: [0, 7, 7] } }]]) for (const [l, p] of P) V.push({ label: tag + l, prevalence: p, ...o });
  }
  if (g === "mix") {
    for (const mix of [[14, 0, 0], [5, 5, 4], [2, 6, 6], [0, 7, 7]]) {
      for (const p of [null, pv("poll", 60, 0.1), pv("poll", 60, 0), pv("poll", null, 0.1), pv("fit", 60, 0.1)]) V.push({ label: `bees ${mix.join("/")} ${name(p)}`, prevalence: p, popOpts: { beeMix: mix } });
    }
  }
  if (g === "early") {
    for (const h of [30, 60, 120]) {
      V.push({ label: name(pv("poll", h, 0.1)), prevalence: pv("poll", h, 0.1) });
      V.push({ label: name(pv("poll", h, 0.1, { warmupS: 30 })), prevalence: pv("poll", h, 0.1, { warmupS: 30 }) });
      V.push({ label: name(pv("poll", h, 0.1, { warmupS: 60 })), prevalence: pv("poll", h, 0.1, { warmupS: 60 }) });
      V.push({ label: name(pv("poll", h, 0.1, { capP: 3 })), prevalence: pv("poll", h, 0.1, { capP: 3 }) });
      V.push({ label: name(pv("poll", h, 0.25)), prevalence: pv("poll", h, 0.25) });
      V.push({ label: name(pv("poll", h, 0.1, { prior: 20e6 })), prevalence: pv("poll", h, 0.1, { prior: 20e6 }) });
      V.push({ label: name(pv("poll", h, 0.1, { prior: 50e6 })), prevalence: pv("poll", h, 0.1, { prior: 50e6 }) });
    }
  }
  return V;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const se = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length); };
function spearman(x, y) {
  const rank = (v) => { const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]); const r = new Array(v.length); idx.forEach((i, k) => (r[i] = k)); return r; };
  const rx = rank(x), ry = rank(y), n = x.length, mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Everything reported for one game. */
function metrics(o, pcfg) {
  const { N, prevSeries: S, nSamples: M, sampleEvery } = o;
  const dt = sampleEvery * ROUND_S;                 // seconds per sample (1 s)
  const at = (k, s) => S[k * N + s] * N;            // prevalence relative to uniform (1 = uniform)
  const m = {};
  // concentration
  const hhi = [];
  let takeover = null, takeover30 = null, peakTop = 0;
  for (let k = 0; k < M; k++) {
    let h = 0, top = 0;
    for (let s = 0; s < N; s++) { const p = S[k * N + s]; h += p * p; if (p > top) top = p; }
    hhi.push(h);
    if (top > peakTop) peakTop = top;
    if (takeover === null && top >= 0.5) takeover = k * dt;
    if (takeover30 === null && top >= 0.3) takeover30 = k * dt;
  }
  const lastMin = Math.round(60 / dt);
  m.neffMean = mean(hhi.map((h) => 1 / h));
  m.neffEnd = 1 / mean(hhi.slice(M - lastMin));
  m.peakTop = peakTop;
  m.takeover50 = takeover; m.takeover30 = takeover30;
  // early noise and lock-in
  let earlyPeak = 0;
  for (let k = 0; k < Math.round(30 / dt); k++) for (let s = 0; s < N; s++) earlyPeak = Math.max(earlyPeak, at(k, s));
  m.earlyPeak = earlyPeak;
  const avgWin = (a, b) => Array.from({ length: N }, (_, s) => { let x = 0; for (let k = a; k < b; k++) x += at(k, s); return x / (b - a); });
  const early = avgWin(Math.round(30 / dt), Math.round(60 / dt)), late = avgWin(M - lastMin, M);
  m.lockIn = pcfg ? spearman(early, late) : NaN;
  // extinctions, on the EARNED term P_s (prevalence above the c floor): N p_s (c + ramp) - c = ramp × P_s
  const T = M * dt;
  const earned = (k, s) => {
    if (!pcfg) return 1;
    const t = k * dt, c0 = pcfg.c0 ?? 1, c = c0 + (pcfg.floor - c0) * Math.min(1, t / T);
    const ramp = pcfg.warmupS ? Math.min(1, t / pcfg.warmupS) : 1;
    return at(k, s) * (c + ramp) - c;
  };
  m.starved = 0; m.dead = 0; m.recovered = 0; m.starvedAtEnd = 0; m.starvedS = 0;
  for (let s = 0; s < N; s++) {
    let run = 0, deadRun = 0, wasStarved = false, wasDead = false, upRun = 0, rec = false;
    for (let k = Math.round(30 / dt); k < M; k++) {
      const P = earned(k, s);
      run = P < 0.1 ? run + 1 : 0;
      if (P < 0.1) m.starvedS += dt;
      deadRun = at(k, s) < 0.01 ? deadRun + 1 : 0;
      if (run >= 30 / dt) wasStarved = true;
      if (deadRun >= 30 / dt) wasDead = true;
      if (wasStarved) { upRun = P >= 0.5 ? upRun + 1 : 0; if (upRun >= 10 / dt) rec = true; }
    }
    m.starved += wasStarved; m.dead += wasDead; m.recovered += rec; m.starvedAtEnd += earned(M - 1, s) < 0.1;
  }
  // by kind
  const kinds = ["vet", "coop", "def"];
  for (const kd of kinds) {
    const ids = o.species.map((f, s) => (f.kind === kd ? s : -1)).filter((s) => s >= 0);
    m[`fit_${kd}`] = mean(ids.map((s) => o.scores[s].fitness));
    m[`pS_${kd}`] = mean(ids.map((s) => o.scores[s].pollinationShare * N));
    let x = 0; for (let k = 0; k < M; k++) for (const s of ids) x += at(k, s);
    m[`prev_${kd}`] = x / M / ids.length;
    let y = 0; for (let k = M - lastMin; k < M; k++) for (const s of ids) y += at(k, s);
    m[`prevEnd_${kd}`] = y / lastMin / ids.length;
  }
  // defector booms: 5-s moving average crosses 1.5 then falls below 0.75
  let cycles = 0, nd = 0;
  for (let s = 0; s < N; s++) {
    if (o.species[s].kind !== "def") continue;
    nd++;
    let high = false, ma = 1;
    for (let k = 0; k < M; k++) {
      ma += (at(k, s) - ma) / 5;
      if (!high && ma >= 1.5) high = true;
      else if (high && ma <= 0.75) { high = false; cycles++; }
    }
  }
  m.defCycles = cycles / nd;
  // bees
  for (const bt of ["blind", "style", "reader"]) {
    const ids = o.bees.map((t, b) => (t === bt ? b : -1)).filter((b) => b >= 0);
    m[`fS_${bt}`] = ids.length ? mean(ids.map((b) => o.scores[b].forageShare * N)) : NaN;
  }
  // mixing: species fed per bee (count and inverse Simpson)
  const distinct = [], eff = [];
  for (let b = 0; b < N; b++) {
    const f = o.feeds[b], tot = f.reduce((a, c) => a + c, 0);
    distinct.push(f.filter((x) => x > 0).length);
    eff.push(tot ? (tot * tot) / f.reduce((a, c) => a + c * c, 0) : 0);
  }
  m.mixDistinct = mean(distinct); m.mixEff = mean(eff);
  m.feedsPerBee = mean(o.feeds.map((r) => r.reduce((a, c) => a + c, 0)));
  // percents: final minute (pctSeries row 9) and adaptation by prevalence
  const rows = o.pctSeries.length / N;
  for (const kd of ["vet", "coop"]) {
    const ids = o.species.map((f, s) => (f.kind === kd ? s : -1)).filter((s) => s >= 0);
    m[`pctEnd_${kd}`] = mean(ids.map((s) => o.pctSeries[(rows - 1) * N + s]));
    m[`pctStart_${kd}`] = mean(ids.map((s) => o.sp0[s].pct));
  }
  const ev = o.events.filter((e) => e.kind !== "def");
  m.dPctHigh = ev.filter((e) => e.relPrev >= 1.5).map((e) => e.to - e.from);
  m.dPctMid = ev.filter((e) => e.relPrev < 1.5 && e.relPrev > 0.75).map((e) => e.to - e.from);
  m.dPctLow = ev.filter((e) => e.relPrev <= 0.75).map((e) => e.to - e.from);
  m.events = ev.map((e) => [Math.log(e.relPrev), e.to - e.from, e.kind === "vet" ? 1 : 0]);
  return m;
}

function slope(pairs) {
  // OLS of Δpct on log(relPrev) with a vet/coop dummy
  const n = pairs.length; if (n < 10) return NaN;
  // two regressors + intercept: solve normal equations 3x3
  const X = pairs.map(([x, , d]) => [1, x, d]), y = pairs.map(([, v]) => v);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < 3; k++) A[j][k] += X[i][j] * X[i][k]; }
  // Gaussian elimination
  for (let c = 0; c < 3; c++) { const piv = A[c][c]; if (!piv) return NaN; for (let r = c + 1; r < 3; r++) { const f = A[r][c] / piv; for (let k = c; k < 3; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
  const beta = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < 3; k++) s -= A[r][k] * beta[k]; beta[r] = s / A[r][r]; }
  return beta[1];
}

const rows = [];
const t0 = Date.now();
for (const v of variants(group)) {
  const ms = [];
  for (let seed = 1; seed <= SEEDS; seed++) ms.push(metrics(simulate({ seed, ...v }), v.prevalence));
  const agg = { label: v.label, seeds: SEEDS };
  for (const k of Object.keys(ms[0])) {
    if (k === "events") continue;
    if (k.startsWith("dPct")) { const all = ms.flatMap((m) => m[k]); agg[k] = mean(all); agg[k + "_n"] = all.length; continue; }
    if (k.startsWith("takeover")) { const hit = ms.map((m) => m[k]).filter((x) => x !== null); agg[k + "_frac"] = hit.length / SEEDS; agg[k + "_medS"] = hit.length ? hit.sort((a, b) => a - b)[Math.floor(hit.length / 2)] : null; continue; }
    const xs = ms.map((m) => m[k]).filter((x) => Number.isFinite(x));
    agg[k] = mean(xs); agg[k + "_se"] = se(xs);
  }
  agg.dPctSlope = slope(ms.flatMap((m) => m.events));
  rows.push(agg);
  process.stderr.write(`${v.label}  ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
const lines = [];
lines.push(`# group ${group}, ${SEEDS} seeds per variant, 3000 rounds (10 min), N = 14`);
lines.push("Prevalence figures are relative to uniform (1 = 1/N of draws). neff = 1/HHI of prevalence (14 = uniform).");
lines.push("starved: species whose earned term P_s stayed < 0.1 for 30 s (after the first 30 s); at end: P_s < 0.1 in the last round; dead: p_s < 0.01/N for 30 s; recovered: starved, later P_s >= 0.5 for 10 s. Counts per game (of 14).");
lines.push("");
lines.push("| variant | neff mean / end | peak top share | top≥0.5 (frac, med s) | early peak (≤30 s) | lock-in ρ | starved / at end / dead / recovered | prev vet / coop / def (game) | prev end vet / coop / def | fit vet / coop / def | def boom-bust per def | forage share style/blind, reader/blind | Δpct high / mid / low prev, slope | pct end vet / coop | mix distinct / eff |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  lines.push(`| ${r.label} | ${f(r.neffMean, 1)} / ${f(r.neffEnd, 1)} | ${f(r.peakTop)} | ${f(r.takeover50_frac)}, ${f(r.takeover50_medS, 0)} | ${f(r.earlyPeak, 1)} | ${f(r.lockIn)} | ${f(r.starved, 1)} / ${f(r.starvedAtEnd, 1)} / ${f(r.dead, 1)} / ${f(r.recovered, 1)} | ${f(r.prev_vet)} / ${f(r.prev_coop)} / ${f(r.prev_def)} | ${f(r.prevEnd_vet)} / ${f(r.prevEnd_coop)} / ${f(r.prevEnd_def)} | ${f(r.fit_vet)} / ${f(r.fit_coop)} / ${f(r.fit_def)} | ${f(r.defCycles)} | ${f(r.fS_style / r.fS_blind)}, ${f(r.fS_reader / r.fS_blind)} | ${f(r.dPctHigh, 1)} / ${f(r.dPctMid, 1)} / ${f(r.dPctLow, 1)}, ${f(r.dPctSlope, 1)} | ${f(r.pctEnd_vet, 0)} / ${f(r.pctEnd_coop, 0)} | ${f(r.mixDistinct, 1)} / ${f(r.mixEff, 1)} |`);
}
lines.push("");
lines.push(`standard errors (fit coop, prev def, neff mean): ` + rows.map((r) => `${r.label}: ${f(r.fit_coop_se, 3)}, ${f(r.prev_def_se, 3)}, ${f(r.neffMean_se, 2)}`).join("; "));
writeFileSync(new URL(`${group}.txt`, OUT), lines.join("\n") + "\n");
writeFileSync(new URL(`${group}.json`, OUT), JSON.stringify(rows, null, 1));
console.log(lines.join("\n"));
