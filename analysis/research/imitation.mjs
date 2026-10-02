// Imitation dynamics. For every orchid in every round: on the first questions bees actually asked that round (weighted by
// how often each was asked), what share of answers equal its own clover's / each rival clover's answer?
// Categories (>= 50%): self, rival (one rival), convention (2+ clovers incl. own), none.
// Lags: for each (orchid team Y, victim clover X) pair that ever reaches >= 50% rival match, the first round Y's bee had
// fed at X's clover with nectar (Y's own information), vs the first round of the match.
// Victims: does the victim's clover change afterwards, and does its fed rate (by other bees) fall?
import { loadAll, evalFlower, label, clean, mean, pct, f2, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const cats = {}; const lags = []; const victimRows = [];
const byRound = {}; // cond -> round -> counts
for (const g of games) {
  const cond = PRIMED.has(g.arena) ? "primed" : /trees|graphs/.test(g.arena) ? "structured" : "unprimed-int";
  const firstFed = {}; // Y|X -> first round Y's bee got nectar at X
  const everMatch = {};
  const prevClover = {};
  for (const r of g.rounds) {
    const w = new Map();
    for (const v of r.visits) if (v.steps.length) { const k = K(v.steps[0].c); w.set(k, (w.get(k) || 0) + 1); }
    const qs = [...w.keys()].map((k) => JSON.parse(k)), wt = [...w.values()], tot = wt.reduce((a, b) => a + b, 0);
    const ans = {};
    for (const t of g.ids) for (const kind of ["clover", "orchid"]) { const p = r.programs[t]?.[kind]; if (p) ans[t + kind] = await evalFlower(g.config, p.code, kind, qs, g.ids.length); }
    const m = (a, b) => (a && b ? a.reduce((s, x, i) => s + (x !== null && x === b[i] ? wt[i] : 0), 0) / tot : 0);
    for (const y of g.ids) {
      const o = ans[y + "orchid"]; if (!o) continue;
      const own = m(o, ans[y + "clover"]);
      const hits = g.ids.filter((x) => x !== y && m(o, ans[x + "clover"]) >= 0.5);
      const cat = (own >= 0.5 && hits.length) || hits.length >= 2 ? "convention" : own >= 0.5 ? "self" : hits.length ? "rival" : "none";
      ((byRound[cond] ||= {})[r.no] ||= { self: 0, rival: 0, convention: 0, none: 0 })[cat]++;
      ((cats[g.arena] ||= { self: 0, rival: 0, convention: 0, none: 0 }))[cat]++;
      for (const x of hits) { const key = y + "|" + x; if (!everMatch[key]) everMatch[key] = r.no; }
    }
    // victims this round
    for (const x of g.ids) {
      const imitators = g.ids.filter((y) => y !== x && m(ans[y + "orchid"], ans[x + "clover"]) >= 0.5);
      const vs = r.visits.filter((v) => v.patch === x && v.kind === "clover" && v.bee !== x);
      const fed = vs.length ? vs.filter((v) => v.action === "feed").length / vs.length : NaN;
      victimRows.push({ g: label(g), cond, round: r.no, x, imitated: imitators.length > 0, fed, changedNext: null, gref: g });
    }
    // info: Y's bee got nectar at X's clover
    for (const v of r.visits) if (v.action === "feed" && v.nectar && v.bee !== v.patch) { const key = v.bee + "|" + v.patch; if (!firstFed[key]) firstFed[key] = r.no; }
  }
  for (const [key, rm] of Object.entries(everMatch)) {
    const [y, x] = key.split("|");
    lags.push({ g: label(g), cond, y: g.names[y], x: g.names[x], matchRound: rm, infoRound: firstFed[x === y ? "" : y + "|" + x] ?? null });
  }
  // clover changes after being imitated
  for (const vr of victimRows.filter((v) => v.gref === g)) { const nxt = g.rounds[vr.round]; vr.changedNext = nxt ? (nxt.programs[vr.x]?.clover?.distance ?? 0) > 0 : null; }
}
console.log("orchid-round categories by arena (self/rival/convention/none):");
for (const [a, c] of Object.entries(cats)) { const n = c.self + c.rival + c.convention + c.none; console.log(`| ${a} | ${n} | ${pct(c.self / n)} | ${pct(c.rival / n)} | ${pct(c.convention / n)} | ${pct(c.none / n)} |`); }
console.log("\nby condition and round:");
for (const [cond, R] of Object.entries(byRound)) for (const [rn, c] of Object.entries(R)) { const n = c.self + c.rival + c.convention + c.none; console.log(`${cond.padEnd(13)} r${rn} n=${n} self ${pct(c.self / n)} rival ${pct(c.rival / n)} conv ${pct(c.convention / n)} none ${pct(c.none / n)}`); }
console.log("\nrival-imitation pairs: first round matched vs first round imitator's bee had nectar from the victim's clover");
const lagHist = {};
for (const l of lags.filter((l) => l.y !== l.x)) { const k = l.infoRound == null ? "no own-log info" : l.matchRound <= l.infoRound ? "matched before/same round as own info (r1 = from recap or convention)" : `lag ${l.matchRound - l.infoRound}`; (lagHist[l.cond + " " + k] ||= []).push(`${l.g} ${l.y}->${l.x} r${l.matchRound}`); }
for (const [k, v] of Object.entries(lagHist).sort()) console.log(k.padEnd(80), v.length, v.slice(0, 4).join("; "));
console.log("\nvictims: other bees' fed rate at imitated vs non-imitated clovers; share changing their clover next round");
for (const cond of ["primed", "unprimed-int", "structured"]) {
  const V = victimRows.filter((v) => v.cond === cond);
  const a = V.filter((v) => v.imitated), b = V.filter((v) => !v.imitated);
  console.log(cond.padEnd(13), "imitated", a.length, "fed", f2(mean(a.map((v) => v.fed).filter(Number.isFinite))), "changed next", pct(a.filter((v) => v.changedNext).length / a.filter((v) => v.changedNext !== null).length), "| not imitated", b.length, "fed", f2(mean(b.map((v) => v.fed).filter(Number.isFinite))), "changed next", pct(b.filter((v) => v.changedNext).length / b.filter((v) => v.changedNext !== null).length));
}
