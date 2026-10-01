// Rival imitation (>=50% exact answer match on the round's asked first questions) by clover generator category.
import { loadAll, evalFlower, clean, mean, pct, f2, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const strip = (code) => code.replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "");
const cat = (code, rt) => { const c = strip(code); if (/hashlib|sha\d|md5|random\.Random\(|crc32|\bhash\(|Random\(|seed\(/i.test(c)) return "salted hash / seeded dice"; if (/\d{6,}/.test(c) && /%/.test(c)) return "big-constant scramble"; if (/tree|graph/.test(rt)) return "structural recipe"; if (rt === "str") return "string recipe"; return "simple formula"; };
const agg = {};
for (const g of games) {
  const cond = PRIMED.has(g.arena) ? "primed" : /trees|graphs/.test(g.arena) ? "structured" : "unprimed-int";
  for (const r of g.rounds) {
    const w = new Map(); for (const v of r.visits) if (v.steps.length) { const k = K(v.steps[0].c); w.set(k, (w.get(k) || 0) + 1); }
    const qs = [...w.keys()].map((k) => JSON.parse(k)), wt = [...w.values()], tot = wt.reduce((a, b) => a + b, 0);
    const ans = {}; for (const t of g.ids) for (const kind of ["clover", "orchid"]) ans[t + kind] = await evalFlower(g.config, r.programs[t][kind].code, kind, qs, g.ids.length);
    const m = (a, b) => a.reduce((s, x, i) => s + (x !== null && x === b[i] ? wt[i] : 0), 0) / tot;
    for (const x of g.ids) {
      const k = cond + " | " + cat(r.programs[x].clover.code, g.config.responseType);
      const a = (agg[k] ||= { n: 0, rival: 0, self: 0, fed: [] });
      a.n++;
      if (g.ids.some((y) => y !== x && m(ans[y + "orchid"], ans[x + "clover"]) >= 0.5)) a.rival++;
      if (m(ans[x + "orchid"], ans[x + "clover"]) >= 0.5) a.self++;
      const vs = r.visits.filter((v) => v.patch === x && v.kind === "clover" && v.bee !== x);
      if (vs.length) a.fed.push(vs.filter((v) => v.action === "feed").length / vs.length);
    }
  }
}
console.log("| condition / clover generator | clover-rounds | copied by a rival orchid | copied by own orchid (twin) | rival bees' fed rate |");
for (const [k, a] of Object.entries(agg).sort()) console.log(`| ${k} | ${a.n} | ${pct(a.rival / a.n)} | ${pct(a.self / a.n)} | ${f2(mean(a.fed))} |`);
