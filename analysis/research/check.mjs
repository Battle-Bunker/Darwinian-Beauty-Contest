import { loadAll, evalFlower, K } from "./lib.mjs";
const games = await loadAll();
let ok = 0, bad = 0; const ex = [];
for (const g of games) for (const r of g.rounds) {
  const byFlower = {};
  for (const v of r.visits) for (const s of v.steps) (byFlower[v.patch + "|" + v.kind] ||= []).push(s);
  for (const [f, steps] of Object.entries(byFlower)) {
    const [t, kind] = f.split("|");
    const ans = await evalFlower(g.config, r.programs[t][kind].code, kind, steps.map((s) => s.c), g.ids.length);
    steps.forEach((s, i) => { const want = s.r === null || s.r === undefined ? null : K(s.r); if (want === ans[i]) ok++; else { bad++; if (ex.length < 5) ex.push([g.arena, g.gen, r.no, kind, K(s.c).slice(0, 40), want?.slice(0, 40), ans[i]?.slice(0, 40)]); } });
  }
}
console.log({ ok, bad }); console.log(ex);
