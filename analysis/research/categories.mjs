// Categorise clover generators and bee decision rules (code heuristics + behaviour), and relate them to outcomes.
import { loadAll, label, clean, mean, pct, f2, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const strip = (code) => code.replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
function cloverCat(code, rt) {
  const c = strip(code);
  const hash = /hashlib|sha\d|md5|random\.Random\(|crc32|\bhash\(|Random\(|seed\(/i.test(c);
  const scramble = /\d{6,}/.test(c) && /%/.test(c);
  const handshake = /(challenge|\bc\b|\bx\b|\bq\b|s)\s*===?\s*-?["'\d]/.test(c);
  let base;
  if (hash) base = "salted hash / seeded dice";
  else if (scramble) base = "big-constant scramble";
  else if (/tree|graph/.test(rt)) base = "structural recipe (shape from simple arithmetic)";
  else if (rt === "str") base = "string recipe (prefix/transform)";
  else base = "simple formula (affine/poly/mod)";
  return { base, handshake };
}
function beeFeat(code) {
  const c = strip(code);
  const tastedBody = (c.split(/def tasted|function tasted/)[1] || "");
  const tally = /\[|\.add\(|\+=|\+\s*1|push\(|set\(/.test(tastedBody) && tastedBody.trim().length > 20 && !/^\s*\(.*\):\s*\n\s*pass/.test(tastedBody);
  // hardcoded verdicts: a literal collection (>=3 literal items) named like a list of answers, or a preloaded memory dict
  const lit = [...c.matchAll(/^(?:const |let |var )?([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?:new (?:Set|Map)\()?([\[{"'(][^\n]*(?:\n[ \t]+[^\n]*)*)/gm)].filter(([, , v]) => (v.match(/-?\d+|"[^"]+"|'[^']+'/g) || []).length >= 3);
  const hard = lit.some(([, name]) => /bad|good|known|trust|black|white|list|orchid|clover|fake|liar|memory|mem|prior|seed|crib|poster|wanted|skip|avoid|safe|paid|cheat|book|map|tags?$/i.test(name));
  const struct = /children|edges|nodes|degree/.test(c);
  const linefit = /Fraction|slope|intercept|\(r2\s*-\s*r1\)|differen/i.test(c);
  const answerLits = (c.match(/(?:\b(?:r|a|ans|answer|resp|response|res|v|val|x|first|r0|r1)\b|\]\[1\])\s*(?:===?|in)\s*(?:-?\d{2,}|["'][^"']{3,}["']|[\[({])/g) || []).length;
  return { tally, hard: hard || answerLits >= 2, struct, linefit, hardNames: lit.map((l) => l[1]).join(',') };
}
const cl = {}, bees = [];
for (const g of games) {
  const rt = g.config.responseType, cond = PRIMED.has(g.arena) ? "primed" : /trees|graphs/.test(g.arena) ? "structured" : "unprimed-int";
  for (const r of g.rounds) {
    for (const t of g.ids) {
      const { base, handshake } = cloverCat(r.programs[t].clover.code, rt);
      const vs = r.visits.filter((v) => v.patch === t && v.kind === "clover" && v.bee !== t);
      const ovs = r.visits.filter((v) => v.patch === t && v.kind === "orchid" && v.bee !== t);
      const k = cond + "|" + base;
      const x = (cl[k] ||= { n: 0, fed: [], ofed: [], hs: 0 });
      x.n++; if (handshake) x.hs++;
      if (vs.length) x.fed.push(vs.filter((v) => v.action === "feed").length / vs.length);
      if (ovs.length) x.ofed.push(ovs.filter((v) => v.action === "feed").length / ovs.length);
      // bee
      const bv = r.visits.filter((v) => v.bee === t), feeds = bv.filter((v) => v.action === "feed");
      const prevQ = r.no > 1 ? new Set(g.rounds[r.no - 2].visits.filter((v) => v.bee === t && v.steps.length).map((v) => K(v.steps[0].c))) : null;
      const q = new Set(bv.filter((v) => v.steps.length).map((v) => K(v.steps[0].c)));
      bees.push({ cond, arena: g.arena, ...beeFeat(r.programs[t].bee.code), feedRate: feeds.length / bv.length, prec: feeds.length ? feeds.filter((v) => v.nectar).length / feeds.length : NaN, feeds: feeds.length, nectar: feeds.filter((v) => v.nectar).length,
        fixedQ: prevQ ? [...q].some((x) => prevQ.has(x)) : null, oneQ: q.size === 1, asks: mean(bv.map((v) => v.steps.length)), round: r.no });
    }
  }
}
console.log("CLOVERS: | condition | generator | team-rounds | share | with a special-cased question (handshake) | rival bees' fed rate at the clover | ...at the same team's orchid |");
const tot = {}; for (const [k, x] of Object.entries(cl)) tot[k.split("|")[0]] = (tot[k.split("|")[0]] || 0) + x.n;
for (const [k, x] of Object.entries(cl).sort()) { const [cond, base] = k.split("|"); console.log(`| ${cond} | ${base} | ${x.n} | ${pct(x.n / tot[cond])} | ${pct(x.hs / x.n)} | ${f2(mean(x.fed))} | ${f2(mean(x.ofed))} |`); }
const typ = (b) => (b.feedRate >= 0.9 ? "near-blind (feeds >=90% of visits)" : b.hard ? "hardcoded verdicts from logs (+ tally)" : b.tally ? "within-round tally only" : "fixed rule, no memory");
console.log("\nBEES: | condition | decision rule | bee-rounds | share | mean precision | mean nectar/round | asks fixed question reused from previous round | structural tests | multi-question formula fit |");
for (const cond of ["primed", "unprimed-int", "structured"]) {
  const B = bees.filter((b) => b.cond === cond);
  const groups = {}; for (const b of B) (groups[typ(b)] ||= []).push(b);
  for (const [k, xs] of Object.entries(groups).sort()) console.log(`| ${cond} | ${k} | ${xs.length} | ${pct(xs.length / B.length)} | ${f2(mean(xs.map((x) => x.prec).filter(Number.isFinite)))} | ${f2(mean(xs.map((x) => x.nectar)))} | ${pct(xs.filter((x) => x.fixedQ).length / xs.filter((x) => x.fixedQ !== null).length)} | ${pct(xs.filter((x) => x.struct).length / xs.length)} | ${pct(xs.filter((x) => x.linefit).length / xs.length)} |`);
}
if (process.argv[2]) { const B = bees.filter((b) => b.cond === process.argv[2] && typ(b) === process.argv[3]); for (const b of B.slice(0, 400)) if (Math.random() < 0.08) console.log(b.arena, b.round, b.hardNames, f2(b.prec)); }
console.log("\nfixed (reused) question vs fresh, rounds 2-5, by condition: mean precision");
for (const cond of ["primed", "unprimed-int", "structured"]) { const B = bees.filter((b) => b.cond === cond && b.fixedQ !== null); const a = B.filter((b) => b.fixedQ), c = B.filter((b) => !b.fixedQ); console.log(cond, "reused", a.length, f2(mean(a.map((x) => x.prec).filter(Number.isFinite))), "fresh", c.length, f2(mean(c.map((x) => x.prec).filter(Number.isFinite)))); }
