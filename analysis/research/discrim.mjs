// Where does bee discrimination come from? At rival flowers, split visits into
//   first encounters: the bee had not fed at that exact (question->answer) earlier this round, so only prior knowledge
//                     hardcoded from earlier logs/recaps, or a general rule (formula/structure), can discriminate
//   repeat encounters: the bee had already fed there this round (within-round tasting can discriminate)
// Discrimination = P(feed | clover) - P(feed | orchid) (Youden J).
import { loadAll, label, clean, mean, pct, f2, K, PRIMED } from "./lib.mjs";
const games = (await loadAll()).filter(clean);
const agg = {}; const perBee = [];
for (const g of games) for (const r of g.rounds) for (const b of g.ids) {
  const seen = new Map(); const s = { fc: [0, 0], fo: [0, 0], rc: [0, 0], ro: [0, 0] };
  for (const v of r.visits.filter((v) => v.bee === b)) {
    if (!v.steps.length) continue;
    const key = K(v.steps[0].c) + "→" + K(v.steps[0].r);
    if (v.patch !== b) {
      const rep = seen.has(key);
      const cell = s[(rep ? "r" : "f") + (v.kind === "clover" ? "c" : "o")];
      cell[1]++; if (v.action === "feed") cell[0]++;
    }
    if (v.action === "feed") seen.set(key, v.nectar);
  }
  const a = (agg[g.arena] ||= { fc: [0, 0], fo: [0, 0], rc: [0, 0], ro: [0, 0] });
  for (const k of Object.keys(s)) { a[k][0] += s[k][0]; a[k][1] += s[k][1]; }
  const J = (c, o) => (c[1] && o[1] ? c[0] / c[1] - o[0] / o[1] : NaN);
  perBee.push({ g: label(g), arena: g.arena, round: r.no, team: g.names[b], firstJ: J(s.fc, s.fo), repJ: J(s.rc, s.ro), s });
}
const rate = (x) => (x[1] ? x[0] / x[1] : NaN);
console.log("| arena | first-encounter visits | fed at rival clovers | fed at rival orchids | J (prior knowledge) | repeat visits | fed at clovers | fed at orchids | J (within-round) |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [ar, a] of Object.entries(agg)) console.log(`| ${ar} | ${a.fc[1] + a.fo[1]} | ${pct(rate(a.fc))} | ${pct(rate(a.fo))} | ${f2(rate(a.fc) - rate(a.fo))} | ${a.rc[1] + a.ro[1]} | ${pct(rate(a.rc))} | ${pct(rate(a.ro))} | ${f2(rate(a.rc) - rate(a.ro))} |`);
const strong = perBee.filter((x) => x.firstJ >= 0.5);
console.log("\nbee-rounds with first-encounter J >= 0.5:", strong.length, "of", perBee.length, pct(strong.length / perBee.length));
const by = {}; for (const x of strong) (by[x.team] ||= []).push(`${x.g} r${x.round}`);
for (const [t, xs] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${t}: ${xs.length}  ${xs.slice(0, 6).join(", ")}`);
