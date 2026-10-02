// Timeline for one bee team across a game: its precision on rival feeds, and for the clovers it fed at with nectar,
// whether any orchid answered its actual questions like those clovers (collision rate on its own questions).
// node timeline.mjs <arena> <team>  (all clean generations)
import { loadAll, evalFlower, label, clean, pct, f2, K } from "./lib.mjs";
const [arena, team] = process.argv.slice(2);
for (const g of (await loadAll()).filter((g) => clean(g) && g.arena === arena)) {
  const b = g.ids.find((t) => g.names[t].includes(team)); if (!b) continue;
  const out = [];
  for (const r of g.rounds) {
    const vs = r.visits.filter((v) => v.bee === b && v.patch !== b);
    const f = vs.filter((v) => v.action === "feed");
    // collisions on this bee's own first questions: share of its rival-orchid visits whose answer equals some clover's answer
    let ov = 0, coll = 0, collOwn = 0;
    for (const v of vs.filter((v) => v.kind === "orchid" && v.steps.length)) {
      const q = v.steps[0].c;
      const a = (await evalFlower(g.config, r.programs[v.patch].orchid.code, "orchid", [q], g.ids.length))[0];
      let hit = false, hitOwn = false;
      for (const t of g.ids) { const c = (await evalFlower(g.config, r.programs[t].clover.code, "clover", [q], g.ids.length))[0]; if (c !== null && c === a) { hit = true; if (t === v.patch) hitOwn = true; } }
      ov++; if (hit) coll++; if (hitOwn) collOwn++;
    }
    out.push(`r${r.no}: prec ${f2(f.filter((v) => v.nectar).length / f.length)} (${f.length}) clover-fed ${pct(vs.filter((v) => v.kind === "clover" && v.action === "feed").length / vs.filter((v) => v.kind === "clover").length)} orchid-fed ${pct(vs.filter((v) => v.kind === "orchid" && v.action === "feed").length / vs.filter((v) => v.kind === "orchid").length)} | orchids answering like a clover ${pct(coll / ov)} (own twin ${pct(collOwn / ov)}) | bee edits ${r.programs[b].bee.distance ?? "-"}`);
  }
  console.log(`== ${label(g)} ${g.url} ${g.names[b]}\n  ` + out.join("\n  "));
}
