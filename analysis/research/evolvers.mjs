// Clovers that kept changing (>=2 changed rounds in r2-5) vs static ones: were they imitated, and were they fed?
import { loadAll, evalFlower, label, clean, mean, pct, f2, K } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const evolving = [], statics = [];
for (const g of games) {
  const st = Object.fromEntries(g.ids.map((t) => [t, []]));
  for (const r of g.rounds) {
    const w = new Map(); for (const v of r.visits) if (v.steps.length) { const k = K(v.steps[0].c); w.set(k, (w.get(k) || 0) + 1); }
    const qs = [...w.keys()].map((k) => JSON.parse(k)), wt = [...w.values()], tot = wt.reduce((a, b) => a + b, 0);
    const ans = {}; for (const t of g.ids) for (const kind of ["clover", "orchid"]) ans[t + kind] = await evalFlower(g.config, r.programs[t][kind].code, kind, qs, g.ids.length);
    const m = (a, b) => a.reduce((s, x, i) => s + (x !== null && x === b[i] ? wt[i] : 0), 0) / tot;
    for (const x of g.ids) {
      const vs = r.visits.filter((v) => v.patch === x && v.kind === "clover" && v.bee !== x);
      st[x].push({ fed: vs.filter((v) => v.action === "feed").length / vs.length, imit: Math.max(...g.ids.filter((y) => y !== x).map((y) => m(ans[y + "orchid"], ans[x + "clover"]))), self: m(ans[x + "orchid"], ans[x + "clover"]), d: r.programs[x].clover.distance ?? 0 });
    }
  }
  for (const x of g.ids) {
    const s = st[x], changes = s.slice(1).filter((y) => y.d > 0).length;
    const firstChange = s.findIndex((y, i) => i > 0 && y.d > 0);
    const row = { g: label(g), url: g.url, team: g.names[x], changes, fed: s.map((y) => y.fed), imit: s.map((y) => y.imit), self: s.map((y) => y.self), d: s.map((y) => y.d) };
    if (changes >= 2) { row.after = s.slice(firstChange); evolving.push(row); } else if (changes === 0) statics.push(row);
  }
}
const ok = (r) => mean(r.after.map((y) => y.fed)) >= 0.7 && Math.max(...r.after.map((y) => y.imit)) < 0.5;
console.log("clovers with >=2 changed rounds:", evolving.length, "| stayed un-imitated (<50% match) and fed >=70% after the first change:", evolving.filter(ok).length);
for (const r of evolving) console.log(`${ok(r) ? "*" : " "} ${r.g.padEnd(13)} ${r.url.padEnd(17)} ${r.team.slice(0, 26).padEnd(26)} edits ${r.d.slice(1).join(",")} | fed ${r.fed.map(f2).join(" ")} | best rival-orchid match ${r.imit.map(f2).join(" ")} | own orchid ${r.self.map(f2).join(" ")}`);
const neverImit = statics.filter((r) => Math.max(...r.imit) < 0.5);
console.log(`\nstatic clovers (no change r2-5): ${statics.length}; never rival-imitated: ${neverImit.length}; of those with own orchid <50% match: ${neverImit.filter((r) => Math.max(...r.self) < 0.5).length}; mean fed (never imitated, not twinned): ${f2(mean(neverImit.filter((r) => Math.max(...r.self) < 0.5).flatMap((r) => r.fed)))}; static ever imitated: ${statics.length - neverImit.length}, mean fed ${f2(mean(statics.filter((r) => Math.max(...r.imit) >= 0.5).flatMap((r) => r.fed)))}`);
for (const r of neverImit.filter((r) => Math.max(...r.self) < 0.5 && mean(r.fed) >= 0.85)) console.log(`  ${r.g.padEnd(13)} ${r.url.padEnd(17)} ${r.team.slice(0, 26).padEnd(26)} fed ${r.fed.map(f2).join(" ")}`);
