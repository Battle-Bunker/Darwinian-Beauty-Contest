// Share of rival-orchid visits whose answer equals some clover's answer to the same first question, by condition x round
import { loadAll, evalFlower, clean, pct, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const t = {};
for (const g of games) {
  const cond = PRIMED.has(g.arena) ? "primed" : /trees|graphs/.test(g.arena) ? "structured" : "unprimed-int";
  for (const r of g.rounds) {
    const x = ((t[cond] ||= {})[r.no] ||= [0, 0, 0]);
    for (const v of r.visits) {
      if (v.kind !== "orchid" || v.bee === v.patch || !v.steps.length) continue;
      const q = v.steps[0].c;
      const a = (await evalFlower(g.config, r.programs[v.patch].orchid.code, "orchid", [q], g.ids.length))[0];
      let hit = false, own = false;
      for (const u of g.ids) { const c = (await evalFlower(g.config, r.programs[u].clover.code, "clover", [q], g.ids.length))[0]; if (c !== null && c === a) { hit = true; if (u === v.patch) own = true; } }
      x[0]++; if (hit) x[1]++; if (hit && !own) x[2]++;
    }
  }
}
for (const [c, R] of Object.entries(t)) console.log(c.padEnd(13), Object.entries(R).map(([r, x]) => `r${r} ${pct(x[1] / x[0])} (rival-only ${pct(x[2] / x[0])})`).join(" | "));
