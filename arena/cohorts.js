#!/usr/bin/env node
// Cohort analysis (one flower per team): per cohort (an arena) and game, what the flowers and bees do (keyword evidence,
// or a haiku code classifier cached by program skeleton), what a flower's signal costs it in energy and how it sets its
// percent, whether bees feed more where the offer is generous, self-feeding and handshakes, copies, and how the cohorts of
// an experiment compare game for game. Read-only on the games; it writes only the classifier cache in arena/runs/.
//   node arena/cohorts.js --experiment NAME [--classify] [--upto N] > arena/runs/analysis-NAME.md
//   node arena/cohorts.js --arenas a,b [--classify]
//   node arena/cohorts.js --experiment NAME --count    how many programs --classify would label (no model calls)
// --classify  label every distinct program skeleton with haiku (cached in runs/mechanisms-cache.json; a few cents per team
//             and game). It spends money: run it only with the go-ahead. Without it: cached labels, else keyword evidence.
// Env: ARENA_BUDGET_USD caps the classifier's spend together with the whole ledger, as for the runner. Never a Fable model.
import { all, one, pool } from "./lib/db.js";
import { Api, gamePath } from "./lib/api.js";
import { callModel } from "./lib/llm.js";
import { BASE_LEVEL, classifyPrograms, keywordBee, keywordFlower, levelOf, unlabelled } from "./lib/mechanisms.js";
import { computeGameMetrics } from "./lib/metrics.js";
import { EXPERIMENTS } from "./lib/presets.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const out = [];
const p = (s = "") => out.push(s);
const cell = (x) => String(x ?? "-").replace(/\|/g, "/").replace(/\n/g, " ");
const table = (head, rows) => { if (!rows.length) { p("(none)"); p(); return; } p(`| ${head.join(" | ")} |`); p(`|${head.map(() => "---").join("|")}|`); for (const r of rows) p(`| ${r.map(cell).join(" | ")} |`); p(); };
const pct = (x) => (x == null || Number.isNaN(x) ? "-" : `${Math.round(100 * x)}%`);
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(2));
const big = (x) => { if (x == null || Number.isNaN(x)) return "-"; const a = Math.abs(x); return a >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(x / 1e3).toFixed(1)}k` : Number(x).toFixed(a < 10 ? 2 : 0); };
const median = (xs) => { const a = xs.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const sum = (xs) => xs.reduce((s, x) => s + (x || 0), 0);
const mix = (xs) => Object.entries(xs.reduce((acc, x) => ((acc[x] = (acc[x] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
const COSTLY = new Set(["hash-pow", "sequential", "certificate", "anytime"]);
const VERIFYING = new Set(["exact-rule", "work-count", "certificate-check", "mixed"]);
const PLAYED = ["played", "interviewed", "judged", "done"];

// ---------------------------------------------------------------- loading

async function loadGame(arena, row) {
  const gPath = gamePath(arena.room_short_id, row.game_short_id);
  const view = await Api.view(null, gPath); // after the finish: every team's versions, with code when revealed
  const m = row.metrics || await computeGameMetrics(gPath); // in memory only: this script doesn't write to the games
  const ents = await all(`SELECT e.*, p.name AS persona_name, p.model, p.breeder_id FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1`, [row.id]);
  const ids = view.participants || [];
  const teams = ents.filter((e) => !e.sat_out && ids.includes(e.team_id)).map((e) => ({ teamId: e.team_id, name: e.team_name, persona: e.persona_id, model: e.model,
    bred: !!e.breeder_id, fitness: e.fitness, rank: e.fitness_rank }));
  const programs = [];
  for (const t of view.teams || []) for (const kind of ["flower", "bee"]) for (const v of t.programs?.[kind] || []) {
    if (teams.some((x) => x.teamId === t.id)) programs.push({ team: t.id, kind, version: v.version, code: v.code ?? null, size: v.size, atMs: Number(v.atMs) || 0 });
  }
  const ideas = await one("SELECT count(DISTINCT idea_id) FILTER (WHERE new_in_game)::int AS new FROM arena.idea_sightings WHERE game_id = $1", [row.id]);
  return { arena, row, gen: row.generation, config: view.game.config, teams, programs, metrics: m, newIdeas: ideas?.new || 0 };
}

// ---------------------------------------------------------------- labels

async function labelGame(G) {
  G.labels = new Map(); // `${teamId}:${kind}:${version}` -> label
  const versions = G.programs.filter((v) => v.code);
  G.hidden = G.programs.length - versions.length;
  if (args.count) { G.unlabelled = unlabelled(versions); return; }
  const label = await classifyPrograms(versions, { callModel: args.classify ? callModel : null, model: "haiku",
    ctx: { arenaId: `analysis:${G.arena.id}`, gameId: G.row.id }, log: (m) => console.error(`[${G.arena.id} g${G.gen}]${m}`) });
  for (const v of versions) {
    const l = label(v);
    G.labels.set(`${v.team}:${v.kind}:${v.version}`, v.kind === "bee"
      ? { checks: l.checks ?? (l.kw.checks.find((c) => c !== "learns" && c !== "random-challenges") || (l.kw.checks.includes("learns") ? "shape-stats" : "none")),
        feeds: l.feeds ?? "?", threshold: l.threshold ?? (l.kw.threshold ? "fixed" : "none"), tags: l.tags ?? l.kw.checks, summary: l.summary || "", llm: l.llm }
      : { mechanism: l.mechanism ?? l.kw.mechanism, percentPolicy: l.percentPolicy ?? l.kw.percent, percent: l.percent ?? null, tags: l.tags ?? l.kw.tags,
        difficulty: l.difficulty || "", summary: l.summary || "", llm: l.llm });
  }
  for (const v of G.programs.filter((x) => !x.code)) G.labels.set(`${v.team}:${v.kind}:${v.version}`, v.kind === "bee" ? { checks: "?", feeds: "?", tags: [] } : { mechanism: "?", percentPolicy: "?", tags: [] });
}

// ---------------------------------------------------------------- per game

function gameSummary(G, seen) {
  const m = G.metrics;
  const lastVersion = (teamId, kind) => Math.max(0, ...G.programs.filter((x) => x.team === teamId && x.kind === kind).map((x) => x.version));
  const vm = new Map((m.versions || []).map((v) => [`${v.teamId}:${v.version}`, v]));
  const flowers = G.programs.filter((x) => x.kind === "flower").map((pr) => {
    const t = G.teams.find((x) => x.teamId === pr.team);
    const l = G.labels.get(`${pr.team}:flower:${pr.version}`) || { mechanism: pr.code ? keywordFlower(pr.code).mechanism : "?", tags: [] };
    const s = vm.get(`${pr.team}:${pr.version}`) || {};
    return { team: t, version: pr.version, last: pr.version === lastVersion(pr.team, "flower"), label: l, level: levelOf(l), size: pr.size, turns: s.turns || 0, feeds: s.feeds || 0,
      feedRate: s.feedRate, meanMs: s.meanMs, meanEnergy: s.meanEnergy, meanPercent: s.meanPercent, nectarPerFeed: s.nectarPerFeed, surplus: s.surplus, failures: s.failures || 0 };
  });
  const bees = G.teams.map((t) => {
    const v = lastVersion(t.teamId, "bee");
    const code = G.programs.find((x) => x.team === t.teamId && x.kind === "bee" && x.version === v)?.code;
    const l = G.labels.get(`${t.teamId}:bee:${v}`) || { checks: code ? keywordBee(code).checks[0] || "none" : "?", feeds: "?" };
    const mt = m.teams?.[t.teamId] || {}, d = m.discrimination?.perBee?.[t.teamId] || {};
    return { team: t, version: v, label: l, p90: mt.bee?.decisionMs?.p90, feedRate: mt.bee?.feedRate, nectar: mt.bee?.nectar, tooSlow: mt.bee?.tooSlow, offerFed: d.offerWhenFed, offerLeft: d.offerWhenLeft };
  });
  const finals = flowers.filter((f) => f.last);
  const feeds = sum(flowers.map((f) => f.feeds));
  const byMech = {};
  for (const f of flowers) { const b = (byMech[f.label.mechanism] ||= { feeds: 0, turns: 0 }); b.feeds += f.feeds; b.turns += f.turns; }
  const dominant = Object.entries(byMech).sort((a, b) => b[1].feeds - a[1].feeds)[0];
  const winner = [...G.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const winnerFlower = finals.find((f) => f.team?.teamId === winner?.teamId);
  // New in this cohort this game: mechanisms, percent policies and notable tags.
  const marks = new Set();
  for (const f of flowers) {
    marks.add(`mechanism:${f.label.mechanism}`);
    marks.add(`percent:${f.label.percentPolicy}`);
    for (const tg of f.label.tags || []) if (/^(adaptive|combined|own-bee-handshake|puzzle:)/.test(tg)) marks.add(tg);
  }
  for (const b of bees) marks.add(`bee:${b.label.checks}/${b.label.feeds}`);
  const fresh = [...marks].filter((x) => !seen.marks.has(x) && !/[?]/.test(x));
  for (const x of marks) seen.marks.add(x);
  const fitness = G.teams.map((t) => t.fitness).filter((x) => x != null);
  const teams = Object.values(m.teams || {});
  const D = m.discrimination || {};
  return {
    G, flowers, bees, byMech, winner, winnerLabel: winnerFlower?.label,
    dominant: dominant ? { mechanism: dominant[0], share: feeds ? dominant[1].feeds / feeds : null } : null,
    mechMix: mix(finals.map((f) => f.label.mechanism)), percentMix: mix(finals.map((f) => f.label.percentPolicy)),
    meanLevel: finals.length ? sum(finals.map((f) => f.level)) / finals.length : null,
    feedLevel: feeds ? sum(flowers.map((f) => (f.level || 0) * f.feeds)) / feeds : null,
    maxLevel: Math.max(0, ...flowers.map((f) => f.level || 0)),
    costly: finals.filter((f) => COSTLY.has(f.label.mechanism)).length,
    size: median(finals.map((f) => f.size)), compute: median(teams.map((t) => t.flower?.computeShare)), percent: m.distributions?.percent?.p50,
    lost: m.totals?.energy ? m.totals.energyLost / m.totals.energy : null, feedRate: m.totals?.feedRate,
    lowHigh: [D.byOffer?.low?.feedRate, D.byOffer?.high?.feedRate],
    verifying: bees.filter((b) => VERIFYING.has(b.label.checks)).length, beeP90: median(bees.map((b) => b.p90)),
    selfShare: m.totals?.feeds ? m.totals.selfFeeds / m.totals.feeds : null, handshakes: teams.filter((t) => t.handshake?.flag).length, mutual: (m.handshakes?.mutual || []).map((x) => x.join("↔")),
    copies: m.copies?.copies ?? 0, copyLatency: m.copies?.medianLatencyMs,
    spread: fitness.length ? Math.max(...fitness) - Math.min(...fitness) : null,
    sessionChanges: (m.changes || []).filter((c) => c.atMs > 0 && c.source === "session").length, scaffoldChanges: (m.changes || []).filter((c) => c.atMs > 0 && c.source === "scaffold").length,
    tooSlow: sum(teams.map((t) => t.bee?.tooSlow)), noResponse: m.turns ? (m.totals?.failures || 0) / m.turns : null,
    fresh, newIdeas: G.newIdeas,
  };
}

// ---------------------------------------------------------------- report

function tenure(seq) {
  const runs = [];
  for (const x of seq) { if (runs.length && runs[runs.length - 1].m === x) runs[runs.length - 1].n++; else runs.push({ m: x, n: 1 }); }
  return runs.map((r) => `${r.m ?? "-"} ×${r.n}`).join(" → ");
}

function trajectoryWord(levels) {
  const xs = levels.filter((x) => x != null);
  if (xs.length < 3) return "too few games";
  const half = Math.floor(xs.length / 2);
  const a = sum(xs.slice(0, half)) / half, b = sum(xs.slice(-half)) / half;
  if (b - a >= 0.5) return "ratchets up";
  if (a - b >= 0.5) return "falls back";
  return Math.max(...xs) >= 2 ? "holds at a costly level" : "holds at a cheap level";
}

const gamesOf = async (arenaId) => (await all("SELECT * FROM arena.games WHERE arena_id = $1 AND game_short_id IS NOT NULL AND contaminated IS NULL ORDER BY generation", [arenaId]))
  .filter((r) => PLAYED.includes(r.stage) && r.generation <= Number(args.upto || 99));

async function cohortReport(arenaId) {
  const arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [arenaId]);
  if (!arena) { p(`(no arena ${arenaId})`); return null; }
  const rows = await gamesOf(arenaId);
  const s = arena.settings || {};
  p(`## ${arenaId}${s.experiment ? ` (arm: ${s.experiment.arm})` : ""}`);
  p(`${s.description || arena.preset}. Common knowledge: ${s.common ? `\`${s.common.dir}\`` : "none"}. ${rows.length} game(s) played.`);
  p();
  const seen = { marks: new Set() };
  const sums = [];
  for (const row of rows) {
    const G = await loadGame(arena, row);
    await labelGame(G);
    sums.push(gameSummary(G, seen));
  }
  if (!sums.length) return { arenaId, arena, sums };
  table(["game", "teams (bred)", "flower mechanisms at the end", "percent policies at the end", "level: mean / feed-weighted / max", "costly flowers", "median size", "median compute share",
    "median percent", "feed rate", "energy lost", "feed rate at low / high offers", "bees that verify", "bee p90 ms", "self-feeds of feeds", "own-bee handshakes", "mutual pairs",
    "copies (median latency)", "fitness spread", "changes: sessions / scaffolds", "dominant mechanism (share of feeds)", "winner's flower", "new this game", "new ideas (judges)", "too slow / no response"],
  sums.map((x) => [x.G.gen, `${x.G.teams.length} (${x.G.teams.filter((t) => t.bred).length})`, x.mechMix || "-", x.percentMix || "-", `${f2(x.meanLevel)} / ${f2(x.feedLevel)} / ${x.maxLevel}`,
    `${x.costly}/${x.G.teams.length}`, x.size ?? "-", pct(x.compute), f2(x.percent), pct(x.feedRate), pct(x.lost), `${pct(x.lowHigh[0])} / ${pct(x.lowHigh[1])}`,
    `${x.verifying}/${x.G.teams.length}`, f2(x.beeP90), pct(x.selfShare), x.handshakes, x.mutual.join(", ") || "-", `${x.copies} (${x.copyLatency != null ? `${(x.copyLatency / 1000).toFixed(1)} s` : "-"})`,
    f2(x.spread), `${x.sessionChanges} / ${x.scaffoldChanges}`, x.dominant ? `${x.dominant.mechanism} (${pct(x.dominant.share)})` : "-",
    x.winnerLabel ? `${x.winner.name}: ${x.winnerLabel.mechanism}, ${x.winnerLabel.percentPolicy}` : "-", x.fresh.join(", ") || "-", x.newIdeas, `${x.tooSlow} / ${pct(x.noResponse)}`]));
  const hidden = sum(sums.map((x) => x.G.hidden));
  if (hidden) p(`(${hidden} program versions had no code to read: the games didn't reveal it.)\n`);

  p("Flower versions (energy = mean excess energy per turn; percent = mean percent offered):");
  table(["game", "team", "v", "mechanism", "percent policy (typical)", "tags", "difficulty / summary", "level", "size", "mean ms", "energy", "percent", "turns", "feed rate", "nectar/feed", "surplus", "label from"],
    sums.flatMap((x) => x.flowers.map((f) => [x.G.gen, f.team?.name, f.version, f.label.mechanism, `${f.label.percentPolicy}${f.label.percent != null ? ` (${f.label.percent})` : ""}`, (f.label.tags || []).join(" "),
      (f.label.difficulty || f.label.summary || "").slice(0, 110), f.level ?? "-", f.size ?? "-", f2(f.meanMs), big(f.meanEnergy), f2(f.meanPercent), f.turns, pct(f.feedRate), big(f.nectarPerFeed), big(f.surplus),
      f.label.llm ? "haiku" : "keywords"])));

  p("Bees (final version of each game; offer = percent × energy, the nectar a feed would have paid):");
  table(["game", "team", "model", "checks", "feeds", "threshold", "summary", "p90 decision ms", "too slow", "feed rate", "nectar", "mean offer when it fed / left"],
    sums.flatMap((x) => x.bees.map((b) => [x.G.gen, b.team.name, b.team.model, b.label.checks, b.label.feeds, b.label.threshold || "-", (b.label.summary || "").slice(0, 110), f2(b.p90), b.tooSlow ?? "-",
      pct(b.feedRate), big(b.nectar), `${big(b.offerFed)} / ${big(b.offerLeft)}`])));

  // Pooled over games: by mechanism and by percent policy.
  const pool_ = (keyOf) => {
    const acc = {};
    for (const x of sums) for (const f of x.flowers) {
      const q = (acc[keyOf(f)] ||= { versions: 0, turns: 0, feeds: 0, energy: 0, surplus: 0, percent: 0, pn: 0 });
      q.versions++; q.turns += f.turns; q.feeds += f.feeds; q.energy += (f.meanEnergy || 0) * f.turns; q.surplus += f.surplus || 0;
      if (f.meanPercent != null) { q.percent += f.meanPercent * f.turns; q.pn += f.turns; }
    }
    return Object.entries(acc).map(([k, q]) => [k, q.versions, q.turns, pct(q.turns ? q.feeds / q.turns : null), big(q.turns ? q.energy / q.turns : null), f2(q.pn ? q.percent / q.pn : null), big(q.turns ? q.surplus / q.turns : null)]);
  };
  p("By flower mechanism, pooled over games:");
  table(["mechanism (level)", "versions", "turns", "feed rate", "energy per turn", "mean percent", "surplus per turn"],
    pool_((f) => `${f.label.mechanism} (${BASE_LEVEL[f.label.mechanism] ?? "-"})`).sort((a, b) => b[2] - a[2]));
  p("By percent policy, pooled over games:");
  table(["percent policy", "versions", "turns", "feed rate", "energy per turn", "mean percent", "surplus per turn"], pool_((f) => f.label.percentPolicy).sort((a, b) => b[2] - a[2]));
  p(`Dominant mechanism by game (most feeds): ${tenure(sums.map((x) => x.dominant?.mechanism))}. Sophistication (feed-weighted level) by game: ${sums.map((x) => f2(x.feedLevel)).join(", ")}: ${trajectoryWord(sums.map((x) => x.feedLevel))}.`);
  p();
  return { arenaId, arena, sums };
}

async function main() {
  if (args.experiment && !EXPERIMENTS[args.experiment]) throw new Error(`unknown experiment ${args.experiment} (${Object.keys(EXPERIMENTS).join(", ") || "none defined"})`);
  const ids = args.experiment ? EXPERIMENTS[args.experiment].cohorts.map((c) => c.id) : String(args.arenas || "").split(",").filter(Boolean);
  if (!ids.length) throw new Error("--experiment NAME or --arenas a,b");
  if (args.count) {
    const n = { flower: 0, bee: 0 };
    let chars = 0;
    for (const id of ids) {
      const arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
      if (!arena) continue;
      for (const row of await gamesOf(id)) {
        const G = await loadGame(arena, row);
        await labelGame(G);
        for (const v of G.unlabelled) { n[v.kind]++; chars += Math.min(v.code.length, v.kind === "bee" ? 14000 : 9000); }
      }
    }
    console.log(`to classify: ${JSON.stringify(n)}, ${chars} characters of code`);
    return;
  }
  p(`# Cohort analysis: ${ids.join(", ")}`);
  p();
  p("Flower levels: 0 a cheap rule or badge, 1 work a bee can't check, 2 hash proof of work, 3 a checkable puzzle, sequential work or graded anytime optimisation, " +
    `+1 for adaptive difficulty or combined proofs (at most 4). Labels: ${args.classify ? "haiku classifier (cached), keyword evidence where it had no reply" : "cached classifier labels where present, else keyword evidence"}.`);
  p();
  const reports = [];
  for (const id of ids) reports.push(await cohortReport(id));
  const ok = reports.filter((r) => r?.sums?.length);
  if (ok.length > 1) {
    p("## Cohorts side by side");
    const per = (fn) => ok.map((r) => r.sums.map(fn).join(", "));
    table(["measure", ...ok.map((r) => `${r.arenaId}${r.arena.settings?.experiment ? ` (${r.arena.settings.experiment.arm})` : ""}`)], [
      ["feed-weighted level by game", ...per((x) => f2(x.feedLevel))],
      ["max level by game", ...per((x) => x.maxLevel)],
      ["costly flowers by game", ...per((x) => `${x.costly}/${x.G.teams.length}`)],
      ["dominant mechanism (tenure)", ...ok.map((r) => tenure(r.sums.map((x) => x.dominant?.mechanism)))],
      ["percent policies at the end", ...per((x) => x.percentMix || "-")],
      ["median percent by game", ...per((x) => f2(x.percent))],
      ["median flower size by game", ...per((x) => x.size ?? "-")],
      ["feed rate by game", ...per((x) => pct(x.feedRate))],
      ["energy lost by game", ...per((x) => pct(x.lost))],
      ["feed rate at low / high offers by game", ...per((x) => `${pct(x.lowHigh[0])}/${pct(x.lowHigh[1])}`)],
      ["bees that verify by game", ...per((x) => `${x.verifying}/${x.G.teams.length}`)],
      ["self-feeds of feeds by game", ...per((x) => pct(x.selfShare))],
      ["own-bee handshakes by game", ...per((x) => x.handshakes)],
      ["copies by game", ...per((x) => x.copies)],
      ["new mechanisms, policies or tags by game", ...per((x) => x.fresh.length)],
      ["new ideas (judges) by game", ...per((x) => x.newIdeas)],
      ["fitness spread by game", ...per((x) => f2(x.spread))],
      ["trajectory", ...ok.map((r) => trajectoryWord(r.sums.map((x) => x.feedLevel)))],
    ]);
  }
  console.log(out.join("\n"));
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
