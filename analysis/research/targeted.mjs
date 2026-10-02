// Question-targeted flowers: special-cased challenges in flower code (literal compared with the challenge) that another
// team's bee had asked in an earlier round of this game (visible in the flower log), and whether the flower's answer
// there equals some rival clover's answer (copying what that bee trusts).
import { loadAll, evalFlower, label, clean, pct, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const out = {};
for (const g of games) {
  const A = (out[g.arena] ||= { orchidRounds: 0, orchidTargeted: 0, orchidCopy: 0, cloverRounds: 0, cloverTargeted: 0, cloverCopy: 0, examples: [] });
  const askedBy = new Map(); // challengeKey -> Set(bee teams) up to previous round
  for (const r of g.rounds) {
    if (r.no > 1) for (const t of g.ids) for (const kind of ["orchid", "clover"]) {
      const code = r.programs[t][kind].code.replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "");
      const lits = [...code.matchAll(/(?:==|===)\s*(-?\d+|"[^"]*"|'[^']*')|(-?\d+|"[^"]*"|'[^']*')\s*(?:==|===)/g)].map((m) => m[1] ?? m[2]);
      const inLists = [...code.matchAll(/\bin\s*[\[({]([^\])}]*)[\])}]/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
      const cands = [...new Set([...lits, ...inLists])].map((s) => { try { return JSON.parse(s.replace(/^'(.*)'$/, '"$1"')); } catch { return undefined; } }).filter((x) => x !== undefined);
      const targeted = cands.filter((c) => [...(askedBy.get(K(c)) || [])].some((b) => b !== t));
      A[kind + "Rounds"]++;
      if (targeted.length) {
        A[kind + "Targeted"]++;
        let copy = false;
        for (const c of targeted) {
          const mine = (await evalFlower(g.config, r.programs[t][kind].code, kind, [c], g.ids.length))[0];
          for (const x of g.ids) if (x !== t) { const cv = (await evalFlower(g.config, r.programs[x].clover.code, "clover", [c], g.ids.length))[0]; if (cv !== null && cv === mine) copy = true; }
        }
        if (copy) A[kind + "Copy"]++;
        if (A.examples.length < 3 && kind === "orchid" && copy) A.examples.push(`${label(g)} r${r.no} ${g.names[t]} targets ${targeted.slice(0, 4).map((c) => K(c)).join(",")}`);
      }
    }
    for (const v of r.visits) for (const s of v.steps) { const k = K(s.c); if (!askedBy.has(k)) askedBy.set(k, new Set()); askedBy.get(k).add(v.bee); }
  }
}
console.log("| arena | flower logs | orchid-rounds (r>=2) special-casing a question a rival bee asked earlier | ...answering it exactly like a rival clover | clover-rounds special-casing a rival bee's question | ...answering like a rival clover |");
for (const [a, A] of Object.entries(out)) console.log(`| ${a} | ${a === "strdark" ? "off" : "on"} | ${pct(A.orchidTargeted / A.orchidRounds)} | ${pct(A.orchidCopy / A.orchidRounds)} | ${pct(A.cloverTargeted / A.cloverRounds)} | ${pct(A.cloverCopy / A.cloverRounds)} |`);
for (const [a, A] of Object.entries(out)) for (const e of A.examples) console.log("  " + e);
