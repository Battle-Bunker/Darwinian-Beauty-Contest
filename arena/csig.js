#!/usr/bin/env node
// Costly-signalling analysis (REPORT §22): per cohort and game, which signalling mechanisms the cosmos flowers use (a code
// classifier), what they cost and earn, what orchids do against them and how often that fools bees, whether bees verify,
// what's new, and how long a dominant mechanism lasts. Read-only on the games; it writes only its caches in arena/runs/.
//   node arena/csig.js --experiment csig [--classify] [--replay] > arena/runs/analysis-csig.md
//   node arena/csig.js --arenas cont-graphs --classify --replay
// --classify  label every distinct program skeleton with haiku (cached in runs/mechanisms-cache.json; a few cents per
//             team and game). Without it: cached labels, else keyword evidence only.
// --replay    run every orchid version on challenges each rival cosmos version answered (this game and the one before), on
//             the game's own runner, to find exact copies and the nearest imitation (cached in runs/csig-replay.json).
//             Skipped while any game on the server is running: it would take CPU from that garden.
// Env: ARENA_BUDGET_USD caps the classifier's spend together with the whole ledger, as for the runner.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARENA_DIR, all, one, pool } from "./lib/db.js";
import { callModel } from "./lib/llm.js";
import { BASE_LEVEL, classifyTeamGame, keywordBee, keywordCosmos, levelOf } from "./lib/mechanisms.js";
import { EXPERIMENTS } from "./lib/presets.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const out = [];
const p = (s = "") => out.push(s);
const table = (head, rows) => { p(`| ${head.join(" | ")} |`); p(`|${head.map(() => "---").join("|")}|`); for (const r of rows) p(`| ${r.join(" | ")} |`); p(); };
const pct = (x) => (x == null || Number.isNaN(x) ? "-" : `${Math.round(100 * x)}%`);
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : x.toFixed(2));
const median = (xs) => { const a = xs.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const sum = (xs) => xs.reduce((s, x) => s + (x || 0), 0);
const VERIFYING = new Set(["exact-rule", "work-count", "certificate-check", "mixed"]);
const COSTLY = new Set(["hash-pow", "sequential", "certificate", "anytime"]);

// ---------------------------------------------------------------- loading

async function loadGame(arena, row) {
  const g = await one("SELECT * FROM games WHERE id = $1", [row.game_uuid]);
  const config = g.config;
  const m = row.metrics || {};
  const ents = await all(`SELECT e.*, p.name AS persona_name, p.slug, p.model, p.breeder_id, p.generation_born FROM arena.entries e
                           JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1`, [row.id]);
  const teams = ents.filter((e) => !e.sat_out && (g.participants || []).includes(e.team_id)).map((e) => ({
    teamId: e.team_id, name: e.team_name, persona: e.persona_id, personaName: e.persona_name, model: e.model, bred: !!e.breeder_id,
    fitness: e.fitness, rank: e.fitness_rank }));
  const programs = await all("SELECT team_id, kind, version, code, at_ms FROM programs WHERE game_id = $1 ORDER BY team_id, kind, version", [row.game_uuid]);
  const visits = await all(`WITH v AS (
      SELECT a.bee_team, a.visit, max(a.patch_team::text) AS patch, max(a.kind) AS kind, max(a.flower_version) AS fv, bool_or(a.action = 'feed') AS fed
        FROM actions a WHERE a.game_id = $1 AND a.action IN ('arrive', 'ask', 'feed') GROUP BY 1, 2)
    SELECT patch, kind, fv, count(*) FILTER (WHERE bee_team::text <> patch)::int AS rv, count(*) FILTER (WHERE bee_team::text <> patch AND fed)::int AS rf,
           count(*) FILTER (WHERE bee_team::text = patch)::int AS ov, count(*) FILTER (WHERE bee_team::text = patch AND fed)::int AS of
      FROM v GROUP BY 1, 2, 3`, [row.game_uuid]);
  const asks = await all(`SELECT patch_team::text AS patch, kind, flower_version AS fv, count(*)::int AS n, count(*) FILTER (WHERE r IS NULL)::int AS none,
      count(*) FILTER (WHERE error ILIKE '%too long%')::int AS timeouts,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS ms50, percentile_cont(0.9) WITHIN GROUP (ORDER BY ms) AS ms90,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN jsonb_typeof(r) = 'object' AND jsonb_typeof(r->'nodes') = 'number' THEN (r->>'nodes')::numeric END) AS nodes,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY length(r::text)) AS chars
      FROM actions WHERE game_id = $1 AND action = 'ask' GROUP BY 1, 2, 3`, [row.game_uuid]);
  const bees = await all(`SELECT bee_team::text AS team, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY bee_ms) AS p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY bee_ms) AS p90 FROM actions WHERE game_id = $1 AND bee_ms IS NOT NULL GROUP BY 1`, [row.game_uuid]);
  const feeds = await one(`SELECT count(*) FILTER (WHERE action = 'feed')::int AS feeds, count(*) FILTER (WHERE action = 'feed' AND nectar)::int AS nectar,
      count(*) FILTER (WHERE error ILIKE 'too slow%')::int AS too_slow FROM actions WHERE game_id = $1`, [row.game_uuid]);
  const ideas = await one("SELECT count(DISTINCT idea_id) FILTER (WHERE new_in_game)::int AS new FROM arena.idea_sightings WHERE game_id = $1", [row.id]);
  const key = (t, k, v) => `${t}:${k}:${v}`;
  const vstats = new Map(), astats = new Map();
  for (const v of visits) vstats.set(key(v.patch, v.kind, v.fv), v);
  for (const a of asks) astats.set(key(a.patch, a.kind, a.fv), a);
  return { arena, row, uuid: row.game_uuid, gen: row.generation, config, minutes: config.minutes, teams, programs, vstats, astats,
    bees: new Map(bees.map((b) => [b.team, b])), feeds, newIdeas: ideas?.new || 0, changes: m.changes || [], rounds: g.round || m.round || 0, metrics: m };
}

// ---------------------------------------------------------------- labels

async function labelGame(G) {
  G.labels = new Map(); // `${teamId}:${kind}:${version}` -> label
  // Teams in parallel (the model calls share lib/llm.js's concurrency limit).
  await Promise.all(G.teams.map(async (t) => {
    const versions = G.programs.filter((x) => x.team_id === t.teamId).map((x) => ({ kind: x.kind, version: x.version, code: x.code }));
    if (!versions.length) return;
    const ls = await classifyTeamGame(versions, {
      callModel: args.classify ? callModel : null, ctx: { arenaId: `analysis:${G.arena.id}`, gameId: G.row.id, personaId: t.persona },
      log: (m) => console.error(`[${G.arena.id} g${G.gen} ${t.name}]${m}`),
    });
    for (const [k, l] of ls) {
      const [kind, version] = k.split(":");
      const label = kind === "bee"
        ? { checks: l.checks ?? (l.kw.checks.find((c) => c !== "learns" && c !== "random-challenges") || (l.kw.checks.includes("learns") ? "shape-stats" : "none")), threshold: l.threshold ?? (l.kw.threshold ? "fixed" : "none"), tags: l.tags ?? l.kw.checks, summary: l.summary || "", llm: l.llm, kw: l.kw }
        : kind === "cosmos"
          ? { mechanism: l.mechanism ?? l.kw.mechanism, tags: l.tags ?? l.kw.tags, difficulty: l.difficulty || "", summary: l.summary || "", llm: l.llm, kw: l.kw }
          : { strategy: l.strategy ?? "?", imitates: l.imitates || "", tags: l.tags ?? [], summary: l.summary || "", llm: l.llm, kw: l.kw };
      G.labels.set(`${t.teamId}:${kind}:${version}`, label);
    }
  }));
}

// ---------------------------------------------------------------- replay

const REPLAY_CACHE = path.join(ARENA_DIR, "runs", "csig-replay.json");
let replayCache = null;
const sig = (r) => (r && typeof r === "object" ? `${r.nodes}|${Array.isArray(r.edges) ? r.edges.length : "-"}|${Array.isArray(r.labels) ? typeof r.labels[0] : "-"}|${"edgeLabels" in r}` : typeof r);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

async function replayGame(G, prev) {
  G.replay = new Map(); // `${teamId}:orchid:${version}` -> { best: {team, game, version, exact, shape}, exactCopies: [...] }
  if (!args.replay) return;
  const running = await one("SELECT count(*)::int AS n FROM games WHERE status = 'running'");
  if (running.n) { G.replaySkipped = true; return; }
  const { tryFlower } = await import("../server/engine.js");
  if (!replayCache) { try { replayCache = JSON.parse(fs.readFileSync(REPLAY_CACHE, "utf8")); } catch { replayCache = {}; } }
  const cosmosSets = [];
  for (const H of [G, prev].filter(Boolean)) {
    for (const t of H.teams) {
      for (const pr of H.programs.filter((x) => x.team_id === t.teamId && x.kind === "cosmos")) {
        const samples = await all(`SELECT c, r FROM actions WHERE game_id = $1 AND patch_team = $2 AND kind = 'cosmos' AND action = 'ask' AND flower_version = $3
                                    AND r IS NOT NULL ORDER BY seq LIMIT 10`, [H.uuid, t.teamId, pr.version]);
        if (samples.length) cosmosSets.push({ game: H.gen, uuid: H.uuid, team: t.name, persona: t.persona, version: pr.version, samples });
      }
    }
  }
  for (const t of G.teams) {
    for (const o of G.programs.filter((x) => x.team_id === t.teamId && x.kind === "orchid")) {
      const res = [];
      for (const C of cosmosSets.filter((c) => c.persona !== t.persona)) {
        const k = `${crypto.createHash("sha1").update(o.code).digest("hex").slice(0, 16)}|${C.uuid}|${C.team}|${C.version}`;
        if (!replayCache[k]) {
          const r = await tryFlower({ config: { ...G.config }, code: o.code, kind: "orchid", challenges: C.samples.map((s) => (typeof s.c === "string" ? JSON.parse(s.c) : s.c)) });
          let exact = 0, shape = 0;
          C.samples.forEach((s, i) => { const x = r.results[i]; if (x && x.r != null) { if (canon(x.r) === canon(s.r)) exact++; if (sig(x.r) === sig(s.r)) shape++; } });
          replayCache[k] = { exact: exact / C.samples.length, shape: shape / C.samples.length };
          fs.writeFileSync(REPLAY_CACHE, JSON.stringify(replayCache));
        }
        res.push({ ...replayCache[k], team: C.team, game: C.game, version: C.version, persona: C.persona });
      }
      res.sort((a, b) => b.exact - a.exact || b.shape - a.shape);
      G.replay.set(`${t.teamId}:orchid:${o.version}`, { best: res[0] || null, exactCopies: res.filter((x) => x.exact >= 0.8) });
    }
  }
}

// ---------------------------------------------------------------- per game summaries

function gameSummary(G, seen) {
  const lastVersion = (teamId, kind) => Math.max(0, ...G.programs.filter((x) => x.team_id === teamId && x.kind === kind).map((x) => x.version));
  const cosmos = [];
  for (const t of G.teams) {
    for (const pr of G.programs.filter((x) => x.team_id === t.teamId && x.kind === "cosmos")) {
      const l = G.labels.get(`${t.teamId}:cosmos:${pr.version}`) || { mechanism: keywordCosmos(pr.code).mechanism, tags: [] };
      const v = G.vstats.get(`${t.teamId}:cosmos:${pr.version}`) || { rv: 0, rf: 0 };
      const a = G.astats.get(`${t.teamId}:cosmos:${pr.version}`) || {};
      cosmos.push({ team: t, version: pr.version, last: pr.version === lastVersion(t.teamId, "cosmos"), label: l, level: levelOf(l), rv: v.rv, rf: v.rf,
        ms90: a.ms90, nodes: a.nodes, chars: a.chars, asks: a.n || 0, timeouts: a.timeouts || 0, none: a.none || 0 });
    }
  }
  const orchids = [];
  for (const t of G.teams) {
    for (const pr of G.programs.filter((x) => x.team_id === t.teamId && x.kind === "orchid")) {
      const v = G.vstats.get(`${t.teamId}:orchid:${pr.version}`) || { rv: 0, rf: 0 };
      const a = G.astats.get(`${t.teamId}:orchid:${pr.version}`) || {};
      const rep = G.replay?.get(`${t.teamId}:orchid:${pr.version}`);
      const imitated = rep?.best && (rep.best.exact > 0 || rep.best.shape >= 0.5) ? rep.best : null;
      orchids.push({ team: t, version: pr.version, label: G.labels.get(`${t.teamId}:orchid:${pr.version}`) || { strategy: "?" }, rv: v.rv, rf: v.rf, ms90: a.ms90, nodes: a.nodes, timeouts: a.timeouts || 0, rep, imitated });
    }
  }
  const bees = G.teams.map((t) => {
    const l = G.labels.get(`${t.teamId}:bee:${lastVersion(t.teamId, "bee")}`) || { checks: "?" };
    const b = G.bees.get(t.teamId) || {};
    const mt = G.metrics.teams?.[t.teamId] || {};
    return { team: t, label: l, p90: b.p90, precision: mt.precision, gap: mt.gap };
  });
  // Mechanism of each cosmos version that orchids imitated (for the forgery table).
  const mechOf = new Map(cosmos.map((c) => [`${c.team.name}:${G.gen}:${c.version}`, c.label.mechanism]));
  for (const o of orchids) if (o.imitated) o.imitatedMechanism = mechOf.get(`${o.imitated.team}:${o.imitated.game}:${o.imitated.version}`) || seen.mechOf?.get(`${o.imitated.team}:${o.imitated.game}:${o.imitated.version}`) || "?";
  seen.mechOf = new Map([...(seen.mechOf || []), ...mechOf]);

  const rvC = sum(cosmos.map((c) => c.rv)), rfC = sum(cosmos.map((c) => c.rf));
  const rvO = sum(orchids.map((o) => o.rv)), rfO = sum(orchids.map((o) => o.rf));
  const byMech = {};
  for (const c of cosmos) { const b = (byMech[c.label.mechanism] ||= { rv: 0, rf: 0, teams: new Set() }); b.rv += c.rv; b.rf += c.rf; b.teams.add(c.team.name); }
  const dominant = Object.entries(byMech).sort((a, b) => b[1].rf - a[1].rf)[0];
  const finals = cosmos.filter((c) => c.last);
  const winner = [...G.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const winnerCosmos = finals.find((c) => c.team.teamId === winner?.teamId);
  // New this game in this cohort: mechanisms and notable tags.
  const marks = new Set();
  for (const c of cosmos) {
    marks.add(`mechanism:${c.label.mechanism}`);
    if (COSTLY.has(c.label.mechanism)) for (const tg of c.label.tags || []) if (/^(adaptive|combined|puzzle:)/.test(tg)) marks.add(tg);
  }
  const fresh = [...marks].filter((m) => !seen.marks.has(m));
  for (const m of marks) seen.marks.add(m);
  const fitness = G.teams.map((t) => t.fitness).filter((x) => x != null);
  const bud = G.config.budgets;
  return {
    G, cosmos, orchids, bees, byMech, dominant: dominant ? { mechanism: dominant[0], share: rfC ? dominant[1].rf / rfC : null } : null,
    winner, winnerMechanism: winnerCosmos?.label.mechanism,
    mix: Object.entries(finals.reduce((acc, c) => ((acc[c.label.mechanism] = (acc[c.label.mechanism] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "),
    meanLevel: finals.length ? sum(finals.map((c) => c.level)) / finals.length : null,
    feedLevel: rfC ? sum(cosmos.map((c) => (c.level || 0) * c.rf)) / rfC : null,
    maxLevel: Math.max(0, ...cosmos.map((c) => c.level || 0)),
    costlyTeams: finals.filter((c) => COSTLY.has(c.label.mechanism)).length,
    cosmosCompute: median(finals.map((c) => (c.ms90 != null ? c.ms90 / bud.cosmos.ms : null))),
    maxCosmosCompute: Math.max(0, ...finals.map((c) => (c.ms90 != null ? c.ms90 / bud.cosmos.ms : 0))),
    orchidCompute: median(orchids.map((o) => (o.ms90 != null ? o.ms90 / bud.orchid.ms : null))),
    cosmosNodes: median(finals.map((c) => c.nodes)), orchidNodes: median(orchids.map((o) => o.nodes)),
    verifying: bees.filter((b) => VERIFYING.has(b.label.checks)).length, beeP90: median(bees.map((b) => b.p90)),
    gap: rvC && rvO ? rfC / rvC - rfO / rvO : null, cosmosFed: rvC ? rfC / rvC : null, orchidFed: rvO ? rfO / rvO : null,
    precision: G.feeds.feeds ? G.feeds.nectar / G.feeds.feeds : null,
    nectarPerBeeRound: G.rounds && G.teams.length ? G.feeds.nectar / (G.rounds * G.teams.length) : null,
    spread: fitness.length ? Math.max(...fitness) - Math.min(...fitness) : null,
    sessionChanges: G.changes.filter((c) => c.atMs > 0 && c.source === "session").length, scaffoldChanges: G.changes.filter((c) => c.atMs > 0 && c.source === "scaffold").length,
    timeouts: sum(cosmos.map((c) => c.timeouts)) + sum(orchids.map((o) => o.timeouts)), tooSlow: G.feeds.too_slow,
    fresh, newIdeas: G.newIdeas,
    exactCopies: orchids.filter((o) => o.rep?.exactCopies?.length).map((o) => `${o.team.name} orchid v${o.version} = ${o.rep.exactCopies.map((x) => `${x.team} cosmos (game ${x.game})`).join(", ")}`),
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

async function cohortReport(arenaId) {
  const arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [arenaId]);
  if (!arena) { p(`(no arena ${arenaId})`); return null; }
  const rows = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND stage IN ('judged', 'done', 'interviewed', 'played') ORDER BY generation", [arenaId]);
  const s = arena.settings || {};
  p(`## ${arenaId}${s.experiment ? ` (arm: ${s.experiment.arm})` : ""}`);
  p(`${s.description || arena.preset}. Common knowledge: ${s.common ? `\`${s.common.dir}\`` : "none"}. ${rows.length} game(s) played.`);
  p();
  const seen = { marks: new Set() };
  const sums = [];
  let prev = null;
  for (const row of rows) {
    const G = await loadGame(arena, row);
    await labelGame(G);
    await replayGame(G, prev);
    sums.push(gameSummary(G, seen));
    prev = G;
  }
  if (!sums.length) return { arenaId, sums };
  table(["game", "teams (bred)", "cosmos mechanisms at the end", "level: mean / feed-weighted / max", "costly cosmos teams", "cosmos p90 compute (median / max)", "orchid p90 compute", "answer nodes cosmos / orchid", "bees that verify", "bee p90 ms",
    "rival cosmos / orchid fed (gap)", "precision", "nectar per bee-round", "fitness spread", "changes: sessions / scaffolds", "dominant mechanism (share of rival nectar)", "winner's mechanism", "new this game", "new ideas (judges)", "timeouts / too slow"],
  sums.map((x) => [x.G.gen, `${x.G.teams.length} (${x.G.teams.filter((t) => t.bred).length})`, x.mix || "-", `${f2(x.meanLevel)} / ${f2(x.feedLevel)} / ${x.maxLevel}`, `${x.costlyTeams}/${x.G.teams.length}`,
    `${pct(x.cosmosCompute)} / ${pct(x.maxCosmosCompute)}`, pct(x.orchidCompute), `${x.cosmosNodes ?? "-"} / ${x.orchidNodes ?? "-"}`, `${x.verifying}/${x.G.teams.length}`, f2(x.beeP90),
    `${pct(x.cosmosFed)} / ${pct(x.orchidFed)} (${f2(x.gap)})`, f2(x.precision), x.nectarPerBeeRound?.toFixed(3) ?? "-", f2(x.spread), `${x.sessionChanges} / ${x.scaffoldChanges}`,
    x.dominant ? `${x.dominant.mechanism} (${pct(x.dominant.share)})` : "-", x.winnerMechanism || "-", x.fresh.join(", ") || "-", x.newIdeas, `${x.timeouts} / ${x.tooSlow}`]));

  p("Cosmos versions (rival fed = share of other teams' visits that ended in a feed):");
  table(["game", "team", "v", "mechanism", "tags", "difficulty / summary", "level", "p90 ms", "nodes", "rival visits", "rival fed", "label from"],
    sums.flatMap((x) => x.cosmos.map((c) => [x.G.gen, c.team.name, c.version, c.label.mechanism, (c.label.tags || []).join(" "), (c.label.difficulty || c.label.summary || "").replace(/\|/g, "/").slice(0, 110), c.level ?? "-",
      c.ms90 != null ? Math.round(c.ms90) : "-", c.nodes ?? "-", c.rv, pct(c.rv ? c.rf / c.rv : null), c.label.llm ? "haiku" : "keywords"])));

  p("Orchids (fooled = share of other teams' visits that ended in a feed; imitates = nearest rival cosmos in the replay, exact share / same shape share):");
  table(["game", "team", "v", "strategy", "imitates (classifier)", "imitates (replay)", "p90 ms", "nodes", "rival visits", "fooled"],
    sums.flatMap((x) => x.orchids.map((o) => [x.G.gen, o.team.name, o.version, o.label.strategy, (o.label.imitates || "").replace(/\|/g, "/").slice(0, 80),
      o.imitated ? `${o.imitated.team} g${o.imitated.game} v${o.imitated.version} (${pct(o.imitated.exact)} / ${pct(o.imitated.shape)}, ${o.imitatedMechanism})` : x.G.replaySkipped ? "(not replayed)" : args.replay ? "none" : "-",
      o.ms90 != null ? Math.round(o.ms90) : "-", o.nodes ?? "-", o.rv, pct(o.rv ? o.rf / o.rv : null)])));

  p("Bees (final version of each game):");
  table(["game", "team", "model", "checks", "threshold", "summary", "p90 decision ms (of 50)", "precision", "gap"],
    sums.flatMap((x) => x.bees.map((b) => [x.G.gen, b.team.name, b.team.model, b.label.checks, b.label.threshold || "-", (b.label.summary || "").replace(/\|/g, "/").slice(0, 110), f2(b.p90), f2(b.precision), f2(b.gap)])));

  // Effectiveness by mechanism, pooled over games.
  const pooled = {};
  for (const x of sums) for (const [m, b] of Object.entries(x.byMech)) { const q = (pooled[m] ||= { rv: 0, rf: 0, games: 0 }); q.rv += b.rv; q.rf += b.rf; q.games++; }
  p("By mechanism, pooled over games:");
  table(["mechanism", "level", "games present", "rival visits", "rival fed"], Object.entries(pooled).sort((a, b) => (BASE_LEVEL[b[0]] ?? 0) - (BASE_LEVEL[a[0]] ?? 0)).map(([m, q]) => [m, BASE_LEVEL[m] ?? "-", q.games, q.rv, pct(q.rv ? q.rf / q.rv : null)]));
  const forg = {};
  for (const x of sums) for (const o of x.orchids) { const k = `${o.label.strategy} → ${o.imitatedMechanism || "?"}`; const q = (forg[k] ||= { n: 0, rv: 0, rf: 0 }); q.n++; q.rv += o.rv; q.rf += o.rf; }
  p("Forgery, pooled (orchid strategy → mechanism of the cosmos it most resembles in the replay):");
  table(["strategy → imitated mechanism", "orchid versions", "rival visits", "fooled"], Object.entries(forg).sort((a, b) => b[1].rv - a[1].rv).map(([k, q]) => [k, q.n, q.rv, pct(q.rv ? q.rf / q.rv : null)]));
  const copies = sums.flatMap((x) => x.exactCopies.map((c) => `game ${x.G.gen}: ${c}`));
  if (copies.length) { p("Exact copies found by the replay:"); for (const c of copies) p(`- ${c}`); p(); }
  p(`Dominant mechanism by game (most rival nectar): ${tenure(sums.map((x) => x.dominant?.mechanism))}. Sophistication (feed-weighted level) by game: ${sums.map((x) => f2(x.feedLevel)).join(", ")}: ${trajectoryWord(sums.map((x) => x.feedLevel))}.`);
  p();
  return { arenaId, arena, sums };
}

async function main() {
  const ids = args.experiment ? EXPERIMENTS[args.experiment].cohorts.map((c) => c.id) : String(args.arenas || "").split(",").filter(Boolean);
  if (!ids.length) throw new Error("--experiment NAME or --arenas a,b");
  p(`# Costly-signalling analysis: ${ids.join(", ")}`);
  p();
  p(`Levels: 0 a cheap rule or badge, 1 work a bee can't check, 2 hash proof of work, 3 a checkable puzzle, sequential work or graded anytime optimisation, +1 for adaptive difficulty or combined proofs (at most 4). Labels: ${args.classify ? "haiku classifier (cached), keyword evidence where it had no reply" : "cached classifier labels where present, else keyword evidence"}.`);
  p();
  const reports = [];
  for (const id of ids) reports.push(await cohortReport(id));
  const ok = reports.filter((r) => r?.sums?.length);
  if (ok.length > 1) {
    p("## Cohorts side by side");
    const n = Math.max(...ok.map((r) => r.sums.length));
    const head = ["measure", ...ok.map((r) => `${r.arenaId}${r.arena.settings?.experiment ? ` (${r.arena.settings.experiment.arm})` : ""}`)];
    const per = (fn) => ok.map((r) => r.sums.map(fn).join(", "));
    table(head, [
      ["feed-weighted level by game", ...per((x) => f2(x.feedLevel))],
      ["max level by game", ...per((x) => x.maxLevel)],
      ["costly cosmos teams by game", ...per((x) => `${x.costlyTeams}/${x.G.teams.length}`)],
      ["dominant mechanism (tenure)", ...ok.map((r) => tenure(r.sums.map((x) => x.dominant?.mechanism)))],
      ["discrimination gap by game", ...per((x) => f2(x.gap))],
      ["precision by game", ...per((x) => f2(x.precision))],
      ["bees that verify by game", ...per((x) => `${x.verifying}/${x.G.teams.length}`)],
      ["new mechanisms or tags by game", ...per((x) => x.fresh.length)],
      ["new ideas (judges) by game", ...per((x) => x.newIdeas)],
      ["fitness spread by game", ...per((x) => f2(x.spread))],
      ["trajectory", ...ok.map((r) => trajectoryWord(r.sums.map((x) => x.feedLevel)))],
    ]);
    void n;
  }
  console.log(out.join("\n"));
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
