// Could a bee have told clovers from orchids with information it legitimately had?
// A. collisions: at each real visit, does the flower's answer to the bee's actual first question equal the answer of a
//    flower of the other kind (any team) to the same question? (If not, exact-answer memory could separate them.)
// B. between-round memory: the bee team's own bee log from earlier rounds of this game gives (question, answer, nectar)
//    triples. B1: at each real visit in round r, is the (first question, answer) pair already in that memory, and is the
//    remembered outcome right? B2: an ideal one-question bee that re-asks the remembered question with the most paying
//    answers: what share of the round's rival clovers / orchids does it recognise as known-good?
// C. within-round tasting: at each real visit, had this bee already fed this round at the same (question, answer)?
import { loadAll, evalFlower, label, clean, mean, pct, f2, K } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const rows = {};
for (const g of games) {
  const A = (rows[g.arena] ||= { visO: 0, colO: 0, colOself: 0, visC: 0, colC: 0, b1Known: 0, b1Right: 0, b1Wrong: 0, b1N: 0, b2Ccov: [], b2Ofp: [], cHit: 0, cRight: 0, cWrong: 0, cN: 0, fedRepeat: 0 });
  const mem = {}; // bee team -> Map(question -> Map(answer -> [nectar, empty]))
  for (const r of g.rounds) {
    const ans = {}; // team|kind -> Map(challengeKey -> answerKey)
    const qs = [...new Map(g.rounds.flatMap((rr) => rr.visits.flatMap((v) => v.steps.map((s) => [K(s.c), s.c])))).values()];
    for (const t of g.ids) for (const kind of ["clover", "orchid"]) {
      const p = r.programs[t]?.[kind]; if (!p) continue;
      const a = await evalFlower(g.config, p.code, kind, qs, g.ids.length);
      ans[t + "|" + kind] = new Map(qs.map((q, i) => [K(q), a[i]]));
    }
    const at = (t, kind, ck) => ans[t + "|" + kind]?.get(ck) ?? null;
    // A
    for (const v of r.visits) {
      if (!v.steps.length) continue;
      const ck = K(v.steps[0].c), a = at(v.patch, v.kind, ck);
      if (a === null) continue;
      const other = v.kind === "clover" ? "orchid" : "clover";
      const coll = g.ids.some((t) => at(t, other, ck) === a);
      if (v.kind === "orchid") { A.visO++; if (coll) A.colO++; if (at(v.patch, "clover", ck) === a) A.colOself++; }
      else { A.visC++; if (coll) A.colC++; }
    }
    // B1 + C along each bee's real trajectory
    for (const b of g.ids) {
      const M = mem[b] || new Map();
      const within = new Map();
      for (const v of r.visits.filter((v) => v.bee === b)) {
        if (!v.steps.length || v.patch === b) continue; // own patch is known exactly anyway
        const ck = K(v.steps[0].c), a = at(v.patch, v.kind, ck);
        if (a === null) continue;
        A.b1N++;
        const rec = M.get(ck)?.get(a);
        if (rec) {
          const callGood = rec[0] > 0 && rec[0] >= rec[1];
          A.b1Known++; if (callGood === (v.kind === "clover")) A.b1Right++; else A.b1Wrong++;
        }
        A.cN++;
        const w = within.get(ck + "→" + a);
        if (w) { A.cHit++; const callGood = w[0] >= w[1]; if (callGood === (v.kind === "clover")) A.cRight++; else A.cWrong++; }
        if (v.action === "feed") { const x = within.get(ck + "→" + a) || [0, 0]; x[v.nectar ? 0 : 1]++; within.set(ck + "→" + a, x); }
      }
      // B2: ideal re-ask of the best remembered question
      if (M.size) {
        let best = null, bestN = -1;
        for (const [ck, m] of M) { const n = [...m.values()].filter((x) => x[0] > 0).length; if (n > bestN) { bestN = n; best = ck; } }
        const good = new Set([...M.get(best)].filter(([, x]) => x[0] > 0 && x[0] >= x[1]).map(([a]) => a));
        const rivals = g.ids.filter((t) => t !== b);
        A.b2Ccov.push(mean(rivals.map((t) => (good.has(at(t, "clover", best)) ? 1 : 0))));
        A.b2Ofp.push(mean(rivals.map((t) => (good.has(at(t, "orchid", best)) ? 1 : 0))));
      }
      // update memory with this round's log
      for (const v of r.visits.filter((v) => v.bee === b && v.action === "feed" && v.steps.length)) {
        const ck = K(v.steps[0].c), a = v.steps[0].r === null || v.steps[0].r === undefined ? null : K(v.steps[0].r);
        if (a === null) continue;
        if (!M.has(ck)) M.set(ck, new Map());
        const x = M.get(ck).get(a) || [0, 0]; x[v.nectar ? 0 : 1]++; M.get(ck).set(a, x);
      }
      mem[b] = M;
    }
  }
}
console.log("| arena | orchid visits whose answer equals some clover's answer to the same question | ...equals its own team's clover | clover visits whose answer equals some orchid's | B1: rival visits where (question, answer) was already in the bee's earlier-round log | B1 accuracy when known | B2: rival clovers recognised by best remembered question | B2: rival orchids passing as known-good | C: rival visits where this bee had already fed at that exact answer this round | C accuracy |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [a, A] of Object.entries(rows)) console.log(`| ${a} | ${pct(A.colO / A.visO)} | ${pct(A.colOself / A.visO)} | ${pct(A.colC / A.visC)} | ${pct(A.b1Known / A.b1N)} | ${pct(A.b1Right / A.b1Known)} | ${pct(mean(A.b2Ccov))} | ${pct(mean(A.b2Ofp))} | ${pct(A.cHit / A.cN)} | ${pct(A.cRight / A.cHit)} |`);
