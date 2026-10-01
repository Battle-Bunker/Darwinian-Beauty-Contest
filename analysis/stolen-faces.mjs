// Replay and stolen-face history, every arena game (v1 and v2).
//
// A visit shows a STOLEN FACE when every pre-feed answer the flower gave equals the answer that one specific RIVAL
// clover gave to the same challenge in the same round (known whenever some bee asked that clover that challenge),
// and the flower's own team clover did not give that answer. Kinds:
//   knock   the face belongs to the visiting bee's OWN clover (the flower answers the bee's secret own-team question
//           the way the bee's clover does: "answering rivals' secret knocks")
//   rival   the face belongs to a third team's clover
//   shared  the answer is shared by 2+ clovers (a convention, e.g. a common rule): not counted as theft
// Orchid visits steal a reputation and waste the bee's feed; clover visits steal allure (the bee still gets nectar).
//
// Episodes (game, thief team, flower kind, victim team, fooled bee) are then classified from round_programs:
//   table      the thief's code contains the stolen challenge as a literal (hard-coded answer for that probe)
//   generator  the thief's flower answers like the victim clover on fresh challenges too (≥ 50% of 16)
//   other      neither (e.g. a rule that happens to coincide on that probe)
// and measured: the fooled bee's fed rate at the victim clover and at the thief's flower by round, every rival bee's
// fed rate at the victim clover against other clovers, the thief's per-round allure share and fitness, and whether
// the fooled bee changed its probe (top first challenge) the round after.
//
//   node analysis/stolen-faces.mjs [arena ...]     (default: every arena)
// Writes arena/runs/stolen-faces.json.
import fs from "node:fs";
import path from "node:path";
import { arenaGames, teamNames, entriesOf, visitsOf, programsOf, roundsOf, preSteps, key, mean, f2, pool } from "./game-data.mjs";
import { ARENA_DIR } from "../arena/lib/db.js";
import { tryFlower } from "../server/engine.js";
import { mulberry32 } from "../server/engine.js";

process.env.CPU_SLOTS ||= "2";
const only = process.argv.slice(2);
const games = await arenaGames(only.length ? only : null);
const OUT = path.join(ARENA_DIR, "runs", "stolen-faces.json");

function freshChallenges(type, n, seed) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (type === "int") out.push(i % 2 ? Math.floor(rnd() * 1e6) : Math.floor(rnd() * 9e15));
    else if (type === "str") out.push(Math.floor(rnd() * 1e9).toString(36) + " " + Math.floor(rnd() * 1e9).toString(36));
    else if (type.startsWith("list")) out.push(Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => Math.floor(rnd() * 1000)));
    else out.push(Math.floor(rnd() * 1e6));
  }
  return out;
}
const literalIn = (code, c) => {
  if (c == null) return false;
  const strip = code.replace(/#.*$/gm, "");
  if (typeof c === "number") return new RegExp(`(^|[^0-9])${String(c)}([^0-9]|$)`).test(strip);
  if (typeof c === "string") return c.length >= 3 && strip.includes(c);
  if (Array.isArray(c)) return c.length > 0 && strip.replace(/\s/g, "").includes(JSON.stringify(c).replace(/\s/g, ""));
  return false;
};

const allEpisodes = [];
const perGame = [];
for (const G of games) {
  const names = await teamNames(G.uuid);
  const ents = await entriesOf(G.agid);
  const progs = await programsOf(G.uuid);
  const rounds = await roundsOf(G.uuid);
  const nm = (t) => (ents.get(t)?.name || names.get(t) || "?").split(" ")[0];
  const episodes = new Map();
  const targeted = { visits: 0, knockMatch: 0, knockMatchFed: 0, rivalMatch: 0, rivalMatchFed: 0, noMatch: 0, noMatchFed: 0, byKind: { clover: 0, orchid: 0 }, examples: new Map() };
  const fmt = { visits: 0, fed: 0, orchid: 0, orchidFed: 0, clover: 0, cloverFed: 0, pairs: new Map(), ownKnocks: 0 };
  const counts = { orchidVisits: 0, rivalOrchidVisitsKnown: 0, knock: 0, rival: 0, shared: 0, knockFed: 0, rivalFed: 0, cloverKnock: 0, cloverRival: 0, cloverKnockFed: 0, cloverRivalFed: 0 };
  const byRound = [];
  for (let r = 1; r <= G.rounds; r++) {
    const vs = await visitsOf(G.uuid, r);
    const book = new Map(); // challenge -> answer -> Set(clover teams)
    for (const v of vs) if (v.kind === "clover") for (const s of v.steps || []) if (s.r != null) {
      const ck = key(s.c); if (!book.has(ck)) book.set(ck, new Map());
      const m = book.get(ck), a = key(s.r); if (!m.has(a)) m.set(a, new Set()); m.get(a).add(v.patch);
    }
    // per-bee top first challenge this round (its probe)
    const firsts = new Map();
    for (const v of vs) { const p = preSteps(v)[0]; if (!p) continue; const m = firsts.get(v.bee) || new Map(); m.set(key(p.c), (m.get(key(p.c)) || 0) + 1); firsts.set(v.bee, m); }
    const probeOf = new Map([...firsts].map(([b, m]) => [b, [...m.entries()].sort((x, y) => y[1] - x[1])[0][0]]));
    // fed rates by (bee, patch, kind)
    const fr = new Map();
    for (const v of vs) { const k = `${v.bee}|${v.patch}|${v.kind}`; const x = fr.get(k) || [0, 0]; x[1]++; if (v.action === "feed") x[0]++; fr.set(k, x); }
    byRound.push({ r, probeOf, fr, vs: null });
    // str games: knock FORMAT matches. A bee's knock = a challenge where its own clover's answer has a different
    // non-hex prefix from its own orchid's answer (e.g. "ok-…" vs "no-…"). A rival flower answering that knock with
    // the clover's prefix passes a bee that checks the prefix.
    if (G.config.responseType === "str") {
      const prefix = (x) => (typeof x === "string" ? x.replace(/[0-9a-f]{6,}$/, "") : null);
      const ownAns = new Map(); // bee|c -> {clover, orchid}
      for (const v of vs) if (v.bee === v.patch) for (const st of v.steps || []) if (st.r != null) {
        const k = `${v.bee}|${key(st.c)}`; const o = ownAns.get(k) || {}; o[v.kind] = prefix(st.r); ownAns.set(k, o);
      }
      for (const [k, o] of ownAns) if (o.clover && o.orchid && o.clover !== o.orchid && r === 1) fmt.ownKnocks++;
      for (const v of vs) {
        if (v.bee === v.patch) continue;
        const st = preSteps(v).find((x) => { const o = ownAns.get(`${v.bee}|${key(x.c)}`); return o && o.clover && o.orchid && o.clover !== o.orchid; });
        if (!st || st.r == null) continue;
        const o = ownAns.get(`${v.bee}|${key(st.c)}`);
        if (prefix(st.r) !== o.clover) continue;
        const fed = v.action === "feed";
        fmt.visits++; if (fed) fmt.fed++; fmt[v.kind]++; if (fed) fmt[v.kind + "Fed"]++;
        const pk = `${nm(v.patch)} ${v.kind} → ${nm(v.bee)}'s knock ${JSON.stringify(st.c).slice(0, 24)} ("${o.clover}")`;
        const x = fmt.pairs.get(pk) || [0, 0, new Set()]; x[0]++; if (fed) x[1]++; x[2].add(r); fmt.pairs.set(pk, x);
      }
    }
    // targeted answers: a distinctive challenge asked by a rival bee appears as a literal in the visited flower's code
    for (const v of vs) {
      if (v.bee === v.patch) continue;
      const code = progs.get(`${r}|${v.patch}|${v.kind}`)?.code || "";
      for (const st of preSteps(v)) {
        const c = st.c;
        const dist = typeof c === "number" ? Math.abs(c) >= 1000 : typeof c === "string" ? c.length >= 4 : false;
        if (!dist || st.r == null || !literalIn(code, c)) continue;
        targeted.visits++; targeted.byKind[v.kind]++;
        const owners = book.get(key(c))?.get(key(st.r));
        const fed = v.action === "feed";
        const tag = owners?.has(v.bee) && !owners.has(v.patch) ? "knockMatch" : owners && [...owners].some((t) => t !== v.patch) && !owners.has(v.patch) ? "rivalMatch" : "noMatch";
        targeted[tag]++; if (fed) targeted[tag + "Fed"]++;
        const ex = `${nm(v.patch)} ${v.kind} answers ${nm(v.bee)}'s ${JSON.stringify(c).slice(0, 30)}`;
        const x = targeted.examples.get(ex) || { n: 0, tag: {}, fed: 0 }; x.n++; x.tag[tag] = (x.tag[tag] || 0) + 1; if (fed) x.fed++; targeted.examples.set(ex, x);
        break;
      }
    }
    for (const v of vs) {
      if (v.bee === v.patch) continue;
      const pre = preSteps(v).filter((s) => s.r != null);
      if (v.kind === "orchid") counts.orchidVisits++;
      if (!pre.length) continue;
      let cand = null, known = true, ownShares = false, shared = false;
      for (const s of pre) {
        const m = book.get(key(s.c));
        const owners = m?.get(key(s.r));
        if (!m) { known = false; break; }
        if (!owners) { cand = new Set(); break; }
        if (owners.has(v.patch)) ownShares = true;
        const rivals = new Set([...owners].filter((t) => t !== v.patch));
        if (owners.size >= 2) shared = true;
        cand = cand ? new Set([...cand].filter((t) => rivals.has(t))) : rivals;
      }
      if (!known) continue;
      if (v.kind === "orchid") counts.rivalOrchidVisitsKnown++;
      if (!cand || !cand.size || ownShares) continue;
      if (shared || cand.size > 1) { if (v.kind === "orchid") counts.shared++; continue; }
      const victim = [...cand][0];
      const type = victim === v.bee ? "knock" : "rival";
      const fed = v.action === "feed";
      if (v.kind === "orchid") { counts[type]++; if (fed) counts[type + "Fed"]++; }
      else { counts["clover" + type[0].toUpperCase() + type.slice(1)]++; if (fed) counts["clover" + type[0].toUpperCase() + type.slice(1) + "Fed"]++; }
      const ek = `${v.patch}|${v.kind}|${victim}|${v.bee}`;
      const e = episodes.get(ek) || { thief: v.patch, kind: v.kind, victim, bee: v.bee, type, rounds: new Map(), challenges: new Map() };
      const er = e.rounds.get(r) || { visits: 0, fed: 0 };
      er.visits++; if (fed) er.fed++;
      e.rounds.set(r, er);
      for (const s of pre) e.challenges.set(key(s.c), { c: s.c, r: s.r, round: r });
      episodes.set(ek, e);
    }
  }
  // ---- classify and measure episodes
  const sc = (r, t) => rounds.find((x) => x.round_no === r)?.scores.find((s) => s.teamId === t);
  const n = G.participants.length;
  const out = [];
  for (const e of episodes.values()) {
    const firstR = Math.min(...e.rounds.keys());
    const code = progs.get(`${firstR}|${e.thief}|${e.kind}`)?.code || "";
    const victimCode = progs.get(`${firstR}|${e.victim}|clover`)?.code || "";
    const chal = [...e.challenges.values()];
    const distinctive = (c) => (typeof c === "number" ? Math.abs(c) >= 1000 : typeof c === "string" ? c.length >= 4 : Array.isArray(c));
    const tableHit = chal.some((x) => distinctive(x.c) && literalIn(code, x.c));
    let genMatch = null;
    if (code && victimCode) {
      const cs = freshChallenges(G.config.challengeType, 16, 1234 + firstR);
      const [a, b] = await Promise.all([
        tryFlower({ config: G.config, code, kind: e.kind, challenges: cs, nTeams: n }),
        tryFlower({ config: G.config, code: victimCode, kind: "clover", challenges: cs, nTeams: n })]);
      const ra = (a.results || []).map((x) => key(x.r)), rb = (b.results || []).map((x) => key(x.r));
      genMatch = ra.length ? ra.filter((x, i) => x !== "null" && x === rb[i]).length / ra.length : 0;
    }
    const cls = code === victimCode ? "verbatim" : genMatch != null && genMatch >= 0.5 ? "generator" : tableHit ? "table" : genMatch != null && genMatch >= 0.1 ? "partial" : "other";
    const timeline = [];
    for (let r = 1; r <= G.rounds; r++) {
      const BR = byRound[r - 1];
      const beeVictim = BR.fr.get(`${e.bee}|${e.victim}|clover`) || [0, 0];
      const beeThief = BR.fr.get(`${e.bee}|${e.thief}|${e.kind}`) || [0, 0];
      // every rival bee (not the victim's own, not the thief's) at the victim clover vs at other clovers
      let vc = [0, 0], oc = [0, 0];
      for (const [k, x] of BR.fr) {
        const [b, p, kind] = k.split("|");
        if (kind !== "clover" || b === p || b === e.thief) continue;
        if (p === e.victim) { vc[0] += x[0]; vc[1] += x[1]; } else if (p !== e.thief) { oc[0] += x[0]; oc[1] += x[1]; }
      }
      const s = sc(r, e.thief), sv = sc(r, e.victim);
      timeline.push({ r, stolenVisits: e.rounds.get(r)?.visits || 0, stolenFed: e.rounds.get(r)?.fed || 0,
        beeAtVictim: beeVictim[1] ? beeVictim[0] / beeVictim[1] : null, beeAtThief: beeThief[1] ? beeThief[0] / beeThief[1] : null,
        victimFedAll: vc[1] ? vc[0] / vc[1] : null, otherCloversFed: oc[1] ? oc[0] / oc[1] : null,
        thiefAllureN: s ? s.allureShare * n : null, thiefFitness: s?.fitness ?? null, victimAllureN: sv ? sv.allureShare * n : null, victimFitness: sv?.fitness ?? null,
        beeProbe: BR.probeOf.get(e.bee) ?? null, victimCloverChanged: r > 1 ? progs.get(`${r}|${e.victim}|clover`)?.code !== progs.get(`${r - 1}|${e.victim}|clover`)?.code : null });
    }
    // the fooled bee's response: did a bee whose probe had been fixed so far change it the round after the first theft?
    const fixedBefore = firstR >= 2 && timeline.slice(0, firstR).every((t) => t.beeProbe === timeline[0].beeProbe);
    const probeChangedAfter = fixedBefore && firstR < G.rounds ? timeline[firstR].beeProbe !== timeline[firstR - 1].beeProbe : null;
    const visits = [...e.rounds.values()].reduce((a, x) => a + x.visits, 0), fed = [...e.rounds.values()].reduce((a, x) => a + x.fed, 0);
    out.push({ game: `${G.arena} g${G.gen}`, url: G.url, family: G.family, flowerLogs: G.config.flowerLogs, thief: nm(e.thief), thiefModel: ents.get(e.thief)?.model, victim: nm(e.victim), bee: nm(e.bee),
      kind: e.kind, type: e.type, cls, genMatch, rounds: [...e.rounds.keys()], visits, fed, challenges: chal.slice(0, 3).map((x) => JSON.stringify(x.c).slice(0, 40)),
      probeChangedAfter, timeline });
  }
  out.sort((a, b) => b.visits - a.visits);
  perGame.push({ game: `${G.arena} g${G.gen}`, url: G.url, family: G.family, counts, fmt: { ...fmt, pairs: [...fmt.pairs].map(([k, x]) => [k, x[0], x[1], [...x[2]]]).sort((a, b) => b[1] - a[1]) }, targeted: { ...targeted, examples: [...targeted.examples].sort((a, b) => b[1].n - a[1].n).slice(0, 8) } });
  allEpisodes.push(...out);
  process.stderr.write(`${G.arena} g${G.gen}: ${out.length} episodes\n`);
}
fs.writeFileSync(OUT, JSON.stringify({ perGame, episodes: allEpisodes }, null, 0));

// ---------------------------------------------------------------- report
console.log("# Stolen faces per game (visits by rival bees; orchid = reputation theft, clover = allure theft)\n");
console.log("game".padEnd(15), "url".padEnd(18), "orchid visits", "known", "knock (fed)", "rival (fed)", "shared", "| clover knock (fed)", "clover rival (fed)");
for (const g of perGame) {
  const c = g.counts;
  if (!(c.knock + c.rival + c.cloverKnock + c.cloverRival)) continue;
  console.log(g.game.padEnd(15), g.url.padEnd(18), String(c.orchidVisits).padStart(13), String(c.rivalOrchidVisitsKnown).padStart(5),
    `${c.knock} (${c.knockFed})`.padStart(11), `${c.rival} (${c.rivalFed})`.padStart(11), String(c.shared).padStart(6), `| ${c.cloverKnock} (${c.cloverKnockFed})`.padStart(19), `${c.cloverRival} (${c.cloverRivalFed})`.padStart(18));
}
const fams = [...new Set(perGame.map((g) => g.family))];
console.log("\n# Totals by family: share of rival-bee orchid visits (with known clover answers) showing a stolen face, and the fed rate there\n");
for (const f of fams) {
  const cs = perGame.filter((g) => g.family === f).map((g) => g.counts);
  const S = (k) => cs.reduce((a, c) => a + c[k], 0);
  console.log(`${f.padEnd(17)} orchid visits ${S("orchidVisits")}, known ${S("rivalOrchidVisitsKnown")}: knock ${S("knock")} (${(100 * S("knock") / Math.max(1, S("rivalOrchidVisitsKnown"))).toFixed(1)}%, fed ${f2(S("knockFed") / S("knock"))}), rival ${S("rival")} (${(100 * S("rival") / Math.max(1, S("rivalOrchidVisitsKnown"))).toFixed(1)}%, fed ${f2(S("rivalFed") / S("rival"))}); clover knock ${S("cloverKnock")} (fed ${f2(S("cloverKnockFed") / S("cloverKnock"))}), clover rival ${S("cloverRival")} (fed ${f2(S("cloverRivalFed") / S("cloverRival"))})`);
}
console.log("\n# Episodes with ≥ 3 stolen-face visits (thief flower → victim clover's face, shown to bee)\n");
for (const e of allEpisodes.filter((x) => x.visits >= 3)) {
  console.log(`${e.game.padEnd(14)} ${e.url.padEnd(17)} ${e.kind.padEnd(6)} ${e.type.padEnd(5)} ${e.thief}→${e.victim} (bee ${e.bee}) rounds ${e.rounds.join(",")} visits ${e.visits} fed ${e.fed}  ${e.cls}${e.genMatch != null ? ` (fresh match ${f2(e.genMatch)})` : ""}  probe ${e.challenges.join(" ")}  fixed-probe bee changed probe next round: ${e.probeChangedAfter ?? "-"}`);
  console.log("     r  stolen(fed)  bee@victim  bee@thief  all@victim  other clovers  thief allure×N  thief fit  victim fit");
  for (const t of e.timeline) console.log(`     ${t.r}  ${`${t.stolenVisits}(${t.stolenFed})`.padStart(10)}  ${f2(t.beeAtVictim).padStart(10)}  ${f2(t.beeAtThief).padStart(9)}  ${f2(t.victimFedAll).padStart(10)}  ${f2(t.otherCloversFed).padStart(13)}  ${f2(t.thiefAllureN).padStart(14)}  ${f2(t.thiefFitness).padStart(9)}  ${f2(t.victimFitness).padStart(10)}`);
}
// ---------------------------------------------------------------- str games: knock format matches (strdark)
console.log("\n# str games: rival flowers answering a bee's knock with its own clover's prefix (the bee's own clover and orchid differ in prefix there)\n");
for (const g of perGame.filter((x) => x.fmt.visits || x.fmt.ownKnocks)) {
  const f = g.fmt;
  console.log(`${g.game.padEnd(15)} ${g.url.padEnd(18)} bee-knock pairs ${f.ownKnocks}; rival visits passing a knock ${f.visits} (fed ${f.fed}): at orchids ${f.orchid} (fed ${f.orchidFed}), at clovers ${f.clover} (fed ${f.cloverFed})`);
  for (const [k, n, fed, rs] of f.pairs.slice(0, 6)) console.log(`     ${k}: ${n} visits, fed ${fed}, rounds ${rs.join(",")}`);
}

// ---------------------------------------------------------------- targeted literals (e.g. strdark's knocks learned from revealed code)
console.log("\n# Targeted answers: rival-bee visits where an asked distinctive challenge is a literal in the visited flower's code");
console.log("knock = the answer equals the asking bee's OWN clover's answer that round; rival = another clover's; none = neither (stale or decoy)\n");
for (const g of perGame) {
  const t = g.targeted;
  if (!t.visits) continue;
  console.log(`${g.game.padEnd(15)} ${g.url.padEnd(18)} visits ${String(t.visits).padStart(4)} (clover ${t.byKind.clover}, orchid ${t.byKind.orchid})  knock ${t.knockMatch} (fed ${t.knockMatchFed})  rival ${t.rivalMatch} (fed ${t.rivalMatchFed})  none ${t.noMatch} (fed ${t.noMatchFed})`);
  for (const [ex, x] of t.examples.slice(0, 4)) console.log(`     ${ex}: ${x.n} visits, ${Object.entries(x.tag).map(([k, v]) => `${k} ${v}`).join(", ")}, fed ${x.fed}`);
}

// ---------------------------------------------------------------- effects, by episode class
// before = rounds before the episode's first theft round; during = theft rounds; after = rounds after the last one
console.log("\n# Effects of stolen faces, episodes with ≥ 3 visits, by family group × type × class (means over episodes)\n");
console.log("victim gap = (rival bees' fed rate at the victim clover) − (at other clovers), same rounds; thief allure×N and fooled bee's fed rate at the victim clover");
console.log("group     type  class      eps  visits  fed@stolen | bee@victim before→during→after | victim gap before→during | thief allure×N before→during | fixed-probe bee changed probe next round");
const phase = (e, f) => {
  const rs = e.timeline, first = Math.min(...e.rounds), last = Math.max(...e.rounds);
  const pick = (which) => rs.filter((t) => (which === "before" ? t.r < first : which === "during" ? e.rounds.includes(t.r) : t.r > last));
  return { before: mean(pick("before").map(f)), during: mean(pick("during").map(f)), after: mean(pick("after").map(f)) };
};
for (const grp of [["v1", (e) => e.family.startsWith("v1")], ["v2", (e) => e.family.startsWith("v2")]]) {
  for (const type of ["knock", "rival"]) for (const cls of ["verbatim", "generator", "table", "partial", "other"]) {
    const es = allEpisodes.filter((e) => grp[1](e) && e.type === type && e.cls === cls && e.visits >= 3 && e.kind === "orchid");
    if (!es.length) continue;
    const bv = es.map((e) => phase(e, (t) => t.beeAtVictim)), vg = es.map((e) => phase(e, (t) => (t.victimFedAll != null && t.otherCloversFed != null ? t.victimFedAll - t.otherCloversFed : null)));
    const ta = es.map((e) => phase(e, (t) => t.thiefAllureN));
    const pc = es.filter((e) => e.probeChangedAfter != null);
    const visits = es.reduce((a, e) => a + e.visits, 0), fed = es.reduce((a, e) => a + e.fed, 0);
    console.log(`${grp[0].padEnd(9)} ${type.padEnd(5)} ${cls.padEnd(9)} ${String(es.length).padStart(4)} ${String(visits).padStart(7)} ${f2(fed / visits).padStart(11)} | ${f2(mean(bv.map((x) => x.before)))} → ${f2(mean(bv.map((x) => x.during)))} → ${f2(mean(bv.map((x) => x.after)))}`.padEnd(80) +
      ` | ${f2(mean(vg.map((x) => x.before)))} → ${f2(mean(vg.map((x) => x.during)))}`.padEnd(18) + ` | ${f2(mean(ta.map((x) => x.before)))} → ${f2(mean(ta.map((x) => x.during)))}`.padEnd(18) +
      ` | ${pc.filter((e) => e.probeChangedAfter).length}/${pc.length}`);
  }
}
console.log(`\nwrote ${OUT}`);
await pool.end();
