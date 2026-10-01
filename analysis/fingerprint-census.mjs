// Is fingerprint-and-taste universal? Every arena game (v1 and v2), every bee:
//   - challenge reuse: distinct/asks, repeat share (game), within-round repeat share, share of visits whose
//     FIRST ask is one of the round's top-3 first asks (probe concentration), and how many first asks reuse a
//     challenge from an earlier round (probe persistence)
//   - discrimination on RIVAL patches: clover fed rate, orchid fed rate and their gap; precision rival-only and pooled
//     (pooled counts the bee's own patch, which it can always recognise)
//   - taste behaviour: at a face (answer to the visit's first challenge) never fed before, how often it feeds (taste
//     rate); once a face has been fed, how often the decision follows the verdict (feed iff it paid), within a round
//     and on a face's first encounter in a later round (a verdict carried in MEMORY or code)
//   - model, persona, fitness and the bee-side score (forage share × N)
// Bee class per game: fixed (probe concentration ≥ 0.9 and first asks reused across rounds ≥ 0.8), rotating (≥ 0.9
// but rotated), fresh (< 0.3), mixed.
// Then: per-family summary, first appearances, adopters and where they got it, fitness vs class within model, and
// twin economics (does a team's twin orchid cost its clover feeds from probe bees vs fresh bees?).
//
//   node analysis/fingerprint-census.mjs [arena ...]        (default: every arena)
// Writes arena/runs/fingerprint-census.json.
import fs from "node:fs";
import path from "node:path";
import { arenaGames, entriesOf, teamNames, visitsOf, programsOf, roundsOf, preSteps, key, mean, f2, all, pool } from "./game-data.mjs";
import { ARENA_DIR } from "../arena/lib/db.js";

const only = process.argv.slice(2);
const games = await arenaGames(only.length ? only : null);
const OUT = path.join(ARENA_DIR, "runs", "fingerprint-census.json");

const strip = (c) => (c || "").replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "").replace(/"""[\s\S]*?"""/g, "");
const shingles = (c) => { const t = strip(c).match(/[A-Za-z_]\w*|\d+|[^\s\w]/g) || []; const s = new Set(); for (let i = 0; i + 4 <= t.length; i++) s.add(t.slice(i, i + 4).join(" ")); return s; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

const rows = [];       // one per bee-game
const roundRows = [];  // one per bee-round (for twin economics)
const patchRounds = []; // one per team-round: twin status of the patch
for (const G of games) {
  const ents = await entriesOf(G.agid);
  const names = await teamNames(G.uuid);
  const progs = await programsOf(G.uuid);
  const rounds = await roundsOf(G.uuid);
  const nTeams = G.participants.length;
  const turnsOf = (r) => rounds.find((x) => x.round_no === r).turns;
  const totals = rounds[rounds.length - 1]?.totals || [];
  const bees = new Map();
  const B = (t) => {
    if (!bees.has(t)) bees.set(t, { visits: 0, asks: 0, seen: new Set(), repeats: 0, perRound: new Map(), firstEver: new Set(),
      rcv: 0, rcf: 0, rov: 0, rof: 0, feeds: 0, nectar: 0, rfeeds: 0, rnectar: 0, faces: new Map(),
      untasted: 0, tasted: 0, within: [0, 0], memory: [0, 0], wr: [], conc: [], persist: [] });
    return bees.get(t);
  };
  for (let r = 1; r <= G.rounds; r++) {
    const vs = await visitsOf(G.uuid, r);
    // clover answer book for the round (for twin detection): challenge -> answer -> clover teams
    const book = new Map();
    for (const v of vs) if (v.kind === "clover") for (const s of preSteps(v)) if (s.r != null) {
      const k = key(s.c); if (!book.has(k)) book.set(k, new Map());
      const m = book.get(k), a = key(s.r); if (!m.has(a)) m.set(a, new Set()); m.get(a).add(v.patch);
    }
    const perBeeRound = new Map();
    for (const v of vs) {
      const b = B(v.bee);
      const pr = (perBeeRound.get(v.bee) || perBeeRound.set(v.bee, { asks: 0, distinct: new Set(), first: new Map(), visits: 0, firstReused: 0, faceFirst: new Set(),
        rcv: 0, rcf: 0, rov: 0, rof: 0 }).get(v.bee));
      const pre = preSteps(v);
      b.visits++; pr.visits++;
      for (const s of pre) {
        const k = key(s.c);
        b.asks++; pr.asks++; pr.distinct.add(k);
        if (b.seen.has(k)) b.repeats++; else b.seen.add(k);
      }
      if (pre.length) {
        const fk = key(pre[0].c);
        pr.first.set(fk, (pr.first.get(fk) || 0) + 1);
        if (r > 1 && b.firstEver.has(fk)) pr.firstReused++;
      }
      const fed = v.action === "feed";
      if (fed) { b.feeds++; if (v.nectar) b.nectar++; }
      if (v.bee === v.patch) continue;
      if (fed) { b.rfeeds++; if (v.nectar) b.rnectar++; }
      if (v.kind === "clover") { b.rcv++; pr.rcv++; if (fed) { b.rcf++; pr.rcf++; } } else { b.rov++; pr.rov++; if (fed) { b.rof++; pr.rof++; } }
      // taste behaviour, keyed on the face = (first challenge, its answer)
      if (!pre.length) continue;
      const face = key([pre[0].c, pre[0].r]);
      const f = b.faces.get(face) || { outcomes: [], lastRound: 0 };
      if (!f.outcomes.length) { b.untasted++; if (fed) b.tasted++; }
      else {
        const paid = f.outcomes.filter(Boolean).length, unpaid = f.outcomes.length - paid;
        const good = paid > unpaid || (paid === unpaid && f.outcomes[f.outcomes.length - 1]);
        const firstThisRound = f.lastRound < r && !pr.faceFirst.has(face);
        const slot = firstThisRound && f.lastRound > 0 ? b.memory : b.within;
        slot[1]++; if (fed === good) slot[0]++;
      }
      pr.faceFirst.add(face);
      if (fed) f.outcomes.push(!!v.nectar);
      f.lastRound = r;
      b.faces.set(face, f);
    }
    for (const [t, pr] of perBeeRound) {
      const b = B(t);
      const top3 = [...pr.first.values()].sort((x, y) => y - x).slice(0, 3).reduce((a, c) => a + c, 0);
      const firstAsks = [...pr.first.values()].reduce((a, c) => a + c, 0);
      const conc = firstAsks ? top3 / firstAsks : null;
      const wr = pr.asks ? 1 - pr.distinct.size / pr.asks : null;
      const persist = r > 1 && firstAsks ? pr.firstReused / firstAsks : null;
      b.wr.push(wr); b.conc.push(conc); if (persist != null) b.persist.push(persist);
      for (const fk of pr.first.keys()) b.firstEver.add(fk);
      roundRows.push({ agid: G.agid, arena: G.arena, family: G.family, gen: G.gen, round: r, bee: t, conc, persist, wr,
        cls: conc == null ? null : conc >= 0.9 ? "probe" : conc < 0.3 ? "fresh" : "mixed", rcv: pr.rcv, rcf: pr.rcf, rov: pr.rov, rof: pr.rof });
    }
    // patch twin status this round: share of the orchid's pre-feed answers (to rival bees) that equal its own clover's
    // answer to the same challenge, when known; plus identical code
    const tw = new Map();
    for (const v of vs) if (v.kind === "orchid" && v.bee !== v.patch) for (const s of preSteps(v)) {
      const m = book.get(key(s.c)); if (!m) continue;
      const own = [...m.entries()].find(([, ts]) => ts.has(v.patch));
      if (!own) continue;
      const x = tw.get(v.patch) || [0, 0]; x[1]++; if (own[0] === key(s.r)) x[0]++; tw.set(v.patch, x);
    }
    for (const team of G.participants) {
      const c = progs.get(`${r}|${team}|clover`)?.code, o = progs.get(`${r}|${team}|orchid`)?.code;
      const x = tw.get(team) || [0, 0];
      patchRounds.push({ agid: G.agid, arena: G.arena, family: G.family, gen: G.gen, round: r, team, sameCode: !!c && c === o,
        twinShare: x[1] >= 5 ? x[0] / x[1] : null, twinN: x[1] });
    }
  }
  const lastBee = (t) => progs.get(`${G.rounds}|${t}|bee`)?.code || "";
  for (const [t, b] of bees) {
    const e = ents.get(t) || {};
    const tot = totals.find((x) => x.teamId === t) || {};
    const conc = mean(b.conc), persist = mean(b.persist), wr = mean(b.wr);
    const cls = conc == null ? "none" : conc >= 0.9 ? (G.rounds === 1 || persist == null || persist >= 0.8 ? "fixed" : persist < 0.5 ? "rotating" : "mixed") : conc < 0.3 ? "fresh" : "mixed";
    const code = lastBee(t);
    let turns = 0; for (let r = 1; r <= G.rounds; r++) turns += turnsOf(r);
    rows.push({
      agid: G.agid, arena: G.arena, family: G.family, gen: G.gen, url: G.url, python: G.python, team: t, teamName: names.get(t), slug: e.slug, persona: e.name, model: e.model, card: e.card,
      fitness: e.fitness ?? tot.fitness, rank: e.rank, allureN: tot.allureShare * nTeams, forageN: tot.forageShare * nTeams, n: nTeams,
      visits: b.visits, asks: b.asks, distinct: b.seen.size, repeat: b.asks ? b.repeats / b.asks : null, wr, conc, persist, cls,
      rcv: b.rcv, rcf: b.rcf, rov: b.rov, rof: b.rof, cfr: b.rcv ? b.rcf / b.rcv : null, ofr: b.rov ? b.rof / b.rov : null,
      precPooled: b.feeds ? b.nectar / b.feeds : null, precRival: b.rfeeds ? b.rnectar / b.rfeeds : null, nectarPerTurn: b.nectar / turns,
      tasteRate: b.untasted ? b.tasted / b.untasted : null, faces: b.faces.size,
      followWithin: b.within[1] ? b.within[0] / b.within[1] : null, followWithinN: b.within[1],
      followMemory: b.memory[1] ? b.memory[0] / b.memory[1] : null, followMemoryN: b.memory[1],
      readsMemory: /\bMEMORY\b/.test(strip(code)), hasTasted: /def\s+tasted|function\s+tasted/.test(code),
    });
  }
  process.stderr.write(`${G.arena} g${G.gen} done\n`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ rows, roundRows, patchRounds }, null, 0));

// ---------------------------------------------------------------- per game listing
const gap = (r) => (r.cfr != null && r.ofr != null ? r.cfr - r.ofr : null);
console.log("# Per-bee census (rival patches only unless noted)\n");
console.log("cls: fixed = ≥90% of visits open with one of the round's top-3 challenges and ≥80% of first asks reused across rounds; rotating = concentrated but rotated; fresh = <30%; mixed = the rest");
for (const G of games) {
  const rs = rows.filter((r) => r.agid === G.agid);
  console.log(`\n## ${G.arena} game ${G.gen}  ${G.url}  (${G.family}${G.python ? ", python" : ""})`);
  console.log("bee/persona".padEnd(30), "model ", "cls     ", "distinct/asks".padStart(14), "rep ", "conc", "pers", " cloverFed", "orchidFed", " gap", " precR", "precP", " taste", "follow", "mem  ", " fit", "forN");
  for (const r of rs.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)))
    console.log(`${(r.persona || r.teamName || "?").slice(0, 29).padEnd(30)} ${(r.model || "-").padEnd(6)} ${r.cls.padEnd(8)} ${`${r.distinct}/${r.asks}`.padStart(14)} ${f2(r.repeat)} ${f2(r.conc)} ${f2(r.persist)}  ${f2(r.cfr).padStart(8)} ${f2(r.ofr).padStart(9)} ${f2(gap(r)).padStart(5)} ${f2(r.precRival).padStart(5)} ${f2(r.precPooled).padStart(5)} ${f2(r.tasteRate).padStart(5)} ${f2(r.followWithin).padStart(6)} ${f2(r.followMemory).padStart(5)} ${f2(r.fitness).padStart(5)} ${f2(r.forageN).padStart(4)}`);
}

// ---------------------------------------------------------------- summary by family and class
const FAM = ["v1-int-primed", "v1-int-unprimed", "v1-str", "v1-list", "v1-struct", "v2-arena", "v2-cohort"];
const CLS = ["fixed", "rotating", "mixed", "fresh"];
console.log("\n# Summary by family × bee class: bee-games, mean rival clover fed / orchid fed / gap, rival precision, pooled precision, nectar per turn\n");
console.log("family".padEnd(17), "class".padEnd(9), "  n", "cloverFed", "orchidFed", "  gap", "precRival", "precPooled", "nectar/turn", "follow", "memFollow");
for (const fam of FAM) for (const c of CLS) {
  const rs = rows.filter((r) => r.family === fam && r.cls === c);
  if (!rs.length) continue;
  console.log(fam.padEnd(17), c.padEnd(9), String(rs.length).padStart(3), f2(mean(rs.map((r) => r.cfr))).padStart(9), f2(mean(rs.map((r) => r.ofr))).padStart(9),
    f2(mean(rs.map(gap))).padStart(5), f2(mean(rs.map((r) => r.precRival))).padStart(9), f2(mean(rs.map((r) => r.precPooled))).padStart(10),
    (mean(rs.map((r) => r.nectarPerTurn)) ?? 0).toFixed(3).padStart(11), f2(mean(rs.map((r) => r.followWithin))).padStart(6), f2(mean(rs.map((r) => r.followMemory))).padStart(9));
}

// ---------------------------------------------------------------- chronology
console.log("\n# Chronology: fixed-probe bees per game (start order); * = gap ≥ 0.5 on rival patches\n");
for (const G of games) {
  const rs = rows.filter((r) => r.agid === G.agid);
  const fx = rs.filter((r) => r.cls === "fixed");
  console.log(`${G.arena.padEnd(12)} g${G.gen} ${G.url.padEnd(17)} fixed ${fx.length}/${rs.length}  rotating ${rs.filter((r) => r.cls === "rotating").length}  fresh ${rs.filter((r) => r.cls === "fresh").length}   ` +
    fx.map((r) => `${(r.persona || "?").split(" ")[0]}${gap(r) >= 0.5 ? "*" : ""}`).join(", "));
}

// ---------------------------------------------------------------- adopters: where did a persona's fixed probe come from?
console.log("\n# Adopters: personas whose bee is fixed-probe in game g but was not in game g-1 of the same arena (or fork source)\n");
const byArenaGen = (arena, gen) => rows.filter((r) => r.arena === arena && r.gen === gen);
for (const r of rows.filter((x) => x.cls === "fixed")) {
  let prevRows = byArenaGen(r.arena, r.gen - 1), prevLabel = `${r.arena} g${r.gen - 1}`;
  if (!prevRows.length && r.arena.startsWith("gx-")) { prevRows = byArenaGen("v2-graphs", 1); prevLabel = "v2-graphs g1 (fork)"; }
  if (!prevRows.length) continue;
  const me = prevRows.find((p) => p.slug === r.slug);
  if (me && me.cls === "fixed") continue;
  // compare this bee's round-1 code with every previous-game bee's final code
  const G = games.find((g) => g.agid === r.agid);
  const myCode = (await all("SELECT code FROM round_programs WHERE game_id = $1 AND team_id = $2 AND kind = 'bee' AND round_no = 1", [G.uuid, r.team]))[0]?.code || "";
  const PG = games.find((g) => g.agid === prevRows[0].agid);
  const sims = [];
  for (const p of prevRows) {
    const pc = (await all("SELECT code FROM round_programs WHERE game_id = $1 AND team_id = $2 AND kind = 'bee' AND round_no = $3", [PG.uuid, p.team, PG.rounds]))[0]?.code || "";
    sims.push({ who: (p.persona || "?").split(" ")[0], cls: p.cls, rank: p.rank, s: jaccard(shingles(myCode), shingles(pc)), own: p.slug === r.slug });
  }
  sims.sort((a, b) => b.s - a.s);
  const own = sims.find((s) => s.own);
  const top = sims.filter((s) => !s.own).slice(0, 2).map((s) => `${s.who}(${s.cls}, rank ${s.rank ?? "-"}) ${s.s.toFixed(2)}`).join("; ");
  console.log(`${r.arena} g${r.gen} ${(r.persona || "?").padEnd(22)} ${r.model.padEnd(6)} prev: ${me ? me.cls : "absent"}; vs own prev bee ${own ? own.s.toFixed(2) : "-"}; closest rival bees in ${prevLabel}: ${top}; prev-game fixed bees: ${prevRows.filter((p) => p.cls === "fixed").map((p) => `${(p.persona || "?").split(" ")[0]}(rank ${p.rank ?? "-"})`).join(", ") || "none"}`);
}

// ---------------------------------------------------------------- fitness vs class, within model
function ols(X, y) {
  const k = X[0].length, XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const M = XtX.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; if (Math.abs(d) < 1e-12) return null;
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j]; }
  }
  const inv = M.map((row) => row.slice(k));
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const res = y.map((yi, i) => yi - X[i].reduce((s, v, j) => s + v * beta[j], 0));
  const s2 = res.reduce((s, e) => s + e * e, 0) / Math.max(1, X.length - k);
  return { beta, se: inv.map((row, i) => Math.sqrt(s2 * row[i])) };
}
console.log("\n# Fitness and forage share vs fixed-probe bee, controlling for model and game (OLS with game fixed effects)\n");
for (const [label, fams] of [["v1 (all)", FAM.slice(0, 5)], ["v2 arenas + cohorts", ["v2-arena", "v2-cohort"]], ["v2 cohorts", ["v2-cohort"]]]) {
  const rs = rows.filter((r) => fams.includes(r.family) && r.fitness != null && r.model);
  const models = [...new Set(rs.map((r) => r.model))].sort(), gids = [...new Set(rs.map((r) => r.agid))];
  for (const outcome of ["fitness", "forageN"]) {
    const X = rs.map((r) => [r.cls === "fixed" ? 1 : 0, ...models.slice(1).map((m) => (r.model === m ? 1 : 0)), ...gids.map((g) => (r.agid === g ? 1 : 0))]);
    const fit = ols(X, rs.map((r) => r[outcome]));
    const nfx = rs.filter((r) => r.cls === "fixed").length;
    const within = models.map((m) => { const a = rs.filter((r) => r.model === m && r.cls === "fixed"), b = rs.filter((r) => r.model === m && r.cls !== "fixed"); return `${m} ${f2(mean(a.map((r) => r[outcome])))} (${a.length}) vs ${f2(mean(b.map((r) => r[outcome])))} (${b.length})`; }).join("; ");
    console.log(`${label.padEnd(20)} ${outcome.padEnd(8)} n=${rs.length} fixed=${nfx}  fixed coef ${fit ? `${fit.beta[0] >= 0 ? "+" : ""}${fit.beta[0].toFixed(2)} ± ${fit.se[0].toFixed(2)} (se)` : "n/a"}   raw by model, fixed vs other: ${within}`);
  }
}

// ---------------------------------------------------------------- twin economics
console.log("\n# Twin economics: clover fed rate by rival bees, split by the visiting bee's class that round and by the patch's twin status\n");
console.log("twin = the orchid gave its own clover's answer on ≥ 90% of rival pre-feed asks with a known clover answer (≥ 5), partial = 30–90%, honest < 30%");
const prMap = new Map(patchRounds.map((p) => [`${p.agid}|${p.round}|${p.team}`, p]));
const beeCls = new Map(roundRows.map((r) => [`${r.agid}|${r.round}|${r.bee}`, r.cls]));
for (const fams of [["v2-arena", "v2-cohort"], ["v1-int-primed", "v1-int-unprimed", "v1-str", "v1-list", "v1-struct"]]) {
  const acc = {};
  for (const G of games.filter((g) => fams.includes(g.family))) {
    for (let r = 1; r <= G.rounds; r++) {
      const vs = await all("SELECT bee_team AS bee, patch_team AS patch, kind, action FROM visits WHERE game_id = $1 AND round_no = $2", [G.uuid, r]);
      for (const v of vs) {
        if (v.bee === v.patch) continue;
        const p = prMap.get(`${G.agid}|${r}|${v.patch}`);
        const tws = p?.twinShare == null ? "unknown" : p.twinShare >= 0.9 ? "twin" : p.twinShare >= 0.3 ? "partial" : "honest";
        const bc = beeCls.get(`${G.agid}|${r}|${v.bee}`) || "?";
        const a = (acc[`${tws}|${bc}`] ||= { cv: 0, cf: 0, ov: 0, of: 0, patches: new Set() });
        a.patches.add(`${G.agid}|${r}|${v.patch}`);
        if (v.kind === "clover") { a.cv++; if (v.action === "feed") a.cf++; } else { a.ov++; if (v.action === "feed") a.of++; }
      }
    }
  }
  console.log(`\n${fams.join(", ")}`);
  console.log("patch".padEnd(8), "bee class".padEnd(9), "patch-rounds", "clover visits", "clover fed", "orchid fed", "patch fed/visit");
  for (const tws of ["twin", "partial", "honest", "unknown"]) for (const bc of ["probe", "mixed", "fresh"]) {
    const a = acc[`${tws}|${bc}`]; if (!a) continue;
    console.log(tws.padEnd(8), bc.padEnd(9), String(a.patches.size).padStart(12), String(a.cv).padStart(13), f2(a.cf / a.cv).padStart(10), f2(a.of / a.ov).padStart(10), f2((a.cf + a.of) / (a.cv + a.ov)).padStart(15));
  }
}

// ---------------------------------------------------------------- follow-ups
// (1) effective fingerprint-and-taste: a probe bee (fixed or rotating) that follows its face verdicts (≥ 0.85) and
//     separates rival clovers from orchids (gap ≥ 0.5). First appearances in start order.
console.log("\n# Effective fingerprint-and-taste bees (probe class fixed/rotating, verdict-following ≥ 0.85, rival gap ≥ 0.5), in start order\n");
const eff = (r) => (r.cls === "fixed" || r.cls === "rotating") && r.followWithin >= 0.85 && gap(r) >= 0.5;
for (const G of games) {
  const es = rows.filter((r) => r.agid === G.agid && eff(r));
  if (es.length) console.log(`${G.arena.padEnd(12)} g${G.gen} ${G.url.padEnd(17)} ${es.map((r) => `${(r.persona || "?").split(" ")[0]} (${r.model}, ${r.cls}, gap ${f2(gap(r))})`).join("; ")}`);
}
for (const fam of FAM) {
  const rs = rows.filter((r) => r.family === fam);
  console.log(`  ${fam.padEnd(17)} effective ${rs.filter(eff).length}/${rs.length} bee-games; probe class (fixed or rotating) ${rs.filter((r) => r.cls === "fixed" || r.cls === "rotating").length}/${rs.length}`);
}
// (2) fitness vs probe bee (fixed or rotating) with model dummies and game fixed effects; and vs the rival gap
console.log("\n# Fitness / forage share vs probe bee (fixed or per-round probe) and vs rival gap, OLS with model dummies + game fixed effects\n");
for (const [label, fams] of [["v1 (all)", FAM.slice(0, 5)], ["v2 arenas + cohorts", ["v2-arena", "v2-cohort"]]]) {
  const rs = rows.filter((r) => fams.includes(r.family) && r.fitness != null && r.model && gap(r) != null);
  const models = [...new Set(rs.map((r) => r.model))].sort(), gids = [...new Set(rs.map((r) => r.agid))];
  for (const outcome of ["fitness", "forageN"]) for (const [pname, pf] of [["probe", (r) => (r.cls === "fixed" || r.cls === "rotating" ? 1 : 0)], ["gap", (r) => gap(r)]]) {
    const X = rs.map((r) => [pf(r), ...models.slice(1).map((m) => (r.model === m ? 1 : 0)), ...gids.map((g) => (r.agid === g ? 1 : 0))]);
    const fit = ols(X, rs.map((r) => r[outcome]));
    const within = pname === "probe" ? models.map((m) => { const a = rs.filter((r) => r.model === m && pf(r)), b = rs.filter((r) => r.model === m && !pf(r)); return `${m} ${f2(mean(a.map((r) => r[outcome])))} (${a.length}) vs ${f2(mean(b.map((r) => r[outcome])))} (${b.length})`; }).join("; ") : "";
    console.log(`${label.padEnd(20)} ${outcome.padEnd(8)} ${pname.padEnd(5)} n=${rs.length}  coef ${fit ? `${fit.beta[0] >= 0 ? "+" : ""}${fit.beta[0].toFixed(2)} ± ${fit.se[0].toFixed(2)}` : "n/a"}${within ? `   raw by model, probe vs other: ${within}` : ""}`);
  }
}
// (3) twin patches at team-game level: allure, forage and fitness against honest patches, within model
console.log("\n# Twin patches, team-game level: share of rounds the orchid was a twin (≥ 90% own-clover answers to rival asks)\n");
for (const [label, fams] of [["v1", FAM.slice(0, 5)], ["v2", ["v2-arena", "v2-cohort"]]]) {
  const rs = rows.filter((r) => fams.includes(r.family) && r.model);
  const tw = (r) => { const ps = patchRounds.filter((p) => p.agid === r.agid && p.team === r.team && p.twinShare != null); return ps.length ? ps.filter((p) => p.twinShare >= 0.9).length / ps.length : null; };
  const groups = { "twin ≥ half the rounds": rs.filter((r) => tw(r) >= 0.5), "twin some rounds": rs.filter((r) => tw(r) > 0 && tw(r) < 0.5), "never twin": rs.filter((r) => tw(r) === 0) };
  console.log(label);
  for (const [g, xs] of Object.entries(groups)) {
    const byModel = [...new Set(xs.map((r) => r.model))].sort().map((m) => { const ys = xs.filter((r) => r.model === m); return `${m} ${f2(mean(ys.map((r) => r.fitness)))} (${ys.length})`; }).join(", ");
    console.log(`  ${g.padEnd(24)} n=${String(xs.length).padStart(3)}  allure×N ${f2(mean(xs.map((r) => r.allureN)))}  forage×N ${f2(mean(xs.map((r) => r.forageN)))}  fitness ${f2(mean(xs.map((r) => r.fitness)))}   fitness by model: ${byModel}`);
  }
  const gx = rs.filter((r) => tw(r) != null);
  const models = [...new Set(gx.map((r) => r.model))].sort(), gids = [...new Set(gx.map((r) => r.agid))];
  for (const outcome of ["allureN", "forageN", "fitness"]) {
    const fit = ols(gx.map((r) => [tw(r), ...models.slice(1).map((m) => (r.model === m ? 1 : 0)), ...gids.map((g) => (r.agid === g ? 1 : 0))]), gx.map((r) => r[outcome]));
    console.log(`  OLS ${outcome.padEnd(8)} on twin share (model dummies + game FE): ${fit ? `${fit.beta[0] >= 0 ? "+" : ""}${fit.beta[0].toFixed(2)} ± ${fit.se[0].toFixed(2)}` : "n/a"} (n=${gx.length})`);
  }
}
console.log(`\nwrote ${OUT}`);
await pool.end();
