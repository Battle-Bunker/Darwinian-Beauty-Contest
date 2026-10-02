#!/usr/bin/env node
// Summarise arenas of continuous games as Markdown: spend, each game (time windows, teams, how fast orchids copy
// clovers, the change timeline, compute against budget, sessions, storage), the panel, ideas, breeders, the fair-play
// audit, and games of different durations side by side.
//   node arena/analyze.js [--arenas a,b] [--recompute] > arena/runs/analysis.md
import { all, migrate, one, pool, q } from "./lib/db.js";
import { breederScores } from "./lib/population.js";
import { computeGameMetrics } from "./lib/metrics.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]); return acc; }, []));
const WEB = process.env.ARENA_WEB || process.env.ARENA_API || "http://localhost:4000";
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(2));
const f3 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(3));
const pc = (x) => (x == null || Number.isNaN(x) ? "-" : `${Math.round(100 * x)}%`);
const mmss = (ms) => { if (ms == null) return "-"; const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const secs = (ms) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)} s`);
const mb = (b) => (b == null ? "-" : `${(Number(b) / 1e6).toFixed(2)} MB`);
const mean = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const out = [];
const p = (s = "") => out.push(s);
const table = (head, rows) => { if (!rows.length) { p("(none)"); p(); return; } p(`| ${head.join(" | ")} |`); p(`|${head.map(() => "---").join("|")}|`); rows.forEach((r) => p(`| ${r.map((x) => String(x ?? "-").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`)); p(); };

await migrate();
const arenaFilter = args.arenas ? String(args.arenas).split(",") : null;
const arenas = (await all("SELECT * FROM arena.arenas ORDER BY created_at")).filter((a) => !arenaFilter || arenaFilter.includes(a.id));
const ids = arenas.map((a) => a.id);

p(`# Arena analysis (${arenas.map((a) => a.id).join(", ") || "no arenas"})`);
p();

// ---------- spend
p("## Spend");
const byModel = await all(`SELECT model, count(*)::int AS calls, sum(cost_usd) AS usd, count(*) FILTER (WHERE estimated)::int AS est, count(*) FILTER (WHERE NOT ok)::int AS failed,
                                  sum(input_tokens)::bigint AS inp, sum(output_tokens)::bigint AS outp, sum(cache_read)::bigint AS cr, avg(duration_ms)::int AS ms
                             FROM arena.llm_calls WHERE arena_id = ANY($1) GROUP BY model ORDER BY usd DESC`, [ids]);
table(["model", "calls", "not ok", "estimated cost", "USD", "input tok", "output tok", "cache read", "avg s"], byModel.map((r) => [r.model, r.calls, r.failed, r.est, f2(r.usd), r.inp, r.outp, r.cr, (r.ms / 1000).toFixed(0)]));
const byPurpose = await all(`SELECT purpose, model, count(*)::int AS calls, sum(cost_usd) AS usd FROM arena.llm_calls WHERE arena_id = ANY($1) GROUP BY 1, 2 ORDER BY 1, usd DESC`, [ids]);
table(["purpose", "model", "calls", "USD", "USD/call"], byPurpose.map((r) => [r.purpose, r.model, r.calls, f2(r.usd), f3(r.usd / r.calls)]));
const tot = await one("SELECT coalesce(sum(cost_usd), 0) AS usd FROM arena.llm_calls WHERE arena_id = ANY($1)", [ids]);
const glob = await one("SELECT coalesce(sum(cost_usd), 0) AS usd FROM arena.llm_calls");
p(`Total for these arenas: **$${f2(tot.usd)}** (whole ledger: $${f2(glob.usd)}). Models used: ${byModel.map((r) => r.model).join(", ")}.`);
p();

const durations = [];

for (const a of arenas) {
  p(`## Arena \`${a.id}\` (${a.preset})`);
  p(`${a.settings.description || ""}. Room: ${WEB}${a.room_url}. Status: ${a.status}.`);
  p();
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 ORDER BY generation", [a.id]);
  const grows = [];
  for (const g of games) {
    if (!g.metrics && g.game_uuid && ["played", "interviewed", "judged", "done"].includes(g.stage) || (args.recompute && g.game_uuid && g.stage !== "created")) {
      g.metrics = await computeGameMetrics({ all, one }, g.game_uuid, { arenaGameId: g.id });
      await q("UPDATE arena.games SET metrics = $2 WHERE id = $1", [g.id, g.metrics]);
    }
    const m = g.metrics;
    const ent = await all("SELECT e.*, p.name, p.model FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1 ORDER BY e.fitness_rank NULLS LAST", [g.id]);
    const ss = await one(`SELECT count(*) FILTER (WHERE phase = 'lobby')::int AS lobby, count(*) FILTER (WHERE phase = 'game')::int AS game, coalesce(sum(cost_usd), 0) AS usd FROM arena.sessions WHERE game_id = $1`, [g.id]);
    const rq = await one(`SELECT count(*) FILTER (WHERE op = 'submit' AND ok AND clock_ms > 0)::int AS live, count(*) FILTER (WHERE op = 'submit' AND NOT ok AND clock_ms > 0)::int AS refused FROM arena.requests WHERE game_id = $1`, [g.id]);
    const cost = await one("SELECT coalesce(sum(cost_usd), 0) AS usd FROM arena.llm_calls WHERE game_id = $1", [g.id]);
    const w = ent[0];
    grows.push([g.generation, g.config?.minutes, `[${g.game_short_id}](${WEB}${g.game_url})`, g.stage, ent.filter((e) => !e.sat_out).length, m?.actions ?? "-", m?.rounds ?? "-", f2(m?.actionsPerSec),
      w?.fitness != null ? `${w.team_name} (${w.model}) ${f2(w.fitness)}` : "-", ent.filter((e) => e.fitness != null).map((e) => `${e.team_name} ${f2(e.fitness)}`).join(", ") || "-",
      `${ss.lobby}/${ss.game}`, m ? `${(m.scaffolds || []).filter((x) => x.starts > x.refused).length}` : "-",
      m ? `${m.changes.filter((c) => c.atMs > 0 && c.source === "session").length} / ${m.changes.filter((c) => c.atMs > 0 && c.source === "scaffold").length}` : "-",
      `${rq.live}/${rq.refused}`, f2(cost.usd), g.contaminated ? `QUARANTINED: ${g.contaminated}` : ""]);
    if (m && !g.contaminated) {
      const teams = Object.values(m.teams);
      durations.push({ minutes: g.config?.minutes, arena: a.id, gen: g.generation, actionsPerSec: m.actionsPerSec, roundsPerSec: m.roundsPerSec,
        precision: mean(teams.map((t) => t.precision)), gap: mean(teams.map((t) => t.gap)), repeat: mean(teams.map((t) => t.repeatShare)),
        changes: m.changes.filter((c) => c.atMs > 0).length / Math.max(1, teams.length), copies: m.copies?.copied ?? 0, copyLatency: m.copies?.medianLatencyMs,
        newCopies: m.copies?.afterNewVersion ?? 0, newCopyLatency: m.copies?.medianLatencyAfterNewVersionMs,
        scaffoldTeams: (m.scaffolds || []).filter((x) => x.starts > x.refused).length, teams: teams.length,
        sessionChanges: m.changes.filter((c) => c.atMs > 0 && c.source === "session").length, autoChanges: m.changes.filter((c) => c.atMs > 0 && c.source === "scaffold").length,
        cloverCompute: mean(Object.values(m.compute || {}).filter((c) => c.kind === "clover").map((c) => c.meanFrac)),
        orchidCompute: mean(Object.values(m.compute || {}).filter((c) => c.kind === "orchid").map((c) => c.meanFrac)),
        cloverNodes: mean(Object.values(m.compute || {}).filter((c) => c.kind === "clover").map((c) => c.answerNodes)),
        orchidNodes: mean(Object.values(m.compute || {}).filter((c) => c.kind === "orchid").map((c) => c.answerNodes)),
        sessions: ss.game / Math.max(1, teams.length), liveSubmits: rq.live, cost: cost.usd, fitSpread: (() => { const f = (m.final || []).map((x) => x.fitness); return f.length ? Math.max(...f) - Math.min(...f) : null; })() });
    }
  }
  p("### Games");
  table(["game", "minutes", "link", "stage", "teams", "actions", "rounds", "actions/s", "winner", "final fitness", "sessions lobby/game", "teams with a scaffold", "in-game versions by sessions / scaffolds", "in-game submits ok/refused", "USD", ""], grows);

  for (const g of games) {
    const m = g.metrics;
    if (!m) continue;
    p(`### Game ${g.generation}: ${g.config?.minutes} min, ${m.actions} actions in ${mmss(m.durationMs)} (${f2(m.actionsPerSec)}/s), ${m.rounds} rounds (${f2(m.roundsPerSec)}/s)`);
    p(`Feed cost ${m.config?.feedCost} rounds; ${m.config?.challengeType} → ${m.config?.responseType}; change budgets per minute (cap): ${["clover", "orchid", "bee"].map((k) => `${k} ${m.config?.budgets?.[k]?.perMinute} (${m.config?.budgets?.[k]?.cap})`).join(", ")}.`);
    p();
    const names = Object.fromEntries(Object.entries(m.teams).map(([id, t]) => [id, t.name]));
    p(`Over time (windows of ${secs(m.windowMs)}; precision = nectar per feed; nectar/bee-round = nectar ÷ (rounds × bees); rival fed = share of visits to rival flowers that ended in a feed; repeat = share of a bee's pre-feed asks repeating a challenge it asked before; stolen/twin = orchid answers equal to an earlier answer of a rival clover / of its own clover; compute = flower time ÷ budget):`);
    table(["window", "actions", "rounds", "feeds", "precision", "nectar/bee-round", "rival clover fed", "rival orchid fed", "gap", "repeat", "distinct/bee", "stolen", "twin", "clover compute", "orchid compute", "fitness in window", "cumulative fitness"],
      m.windows.map((w) => [`${mmss(w.from)}-${mmss(w.to)}`, w.actions, w.rounds, w.feeds, f2(w.precision), f3(w.nectarPerBeeRound), pc(w.rivalCloverFed), pc(w.rivalOrchidFed), f2(w.gap), pc(w.repeatShare), f2(w.distinctPerBee),
        pc(w.stolenShare), pc(w.twinShare), pc(w.cloverCompute), pc(w.orchidCompute),
        Object.entries(w.fitness).map(([id, f]) => `${names[id]?.slice(0, 12)} ${f2(f)}`).join(", "), Object.entries(w.cumFitness).map(([id, f]) => `${names[id]?.slice(0, 12)} ${f2(f)}`).join(", ")]));
    // Teams.
    const ent = await all("SELECT e.*, p.name, p.model FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1", [g.id]);
    const trows = [];
    for (const [id, t] of Object.entries(m.teams)) {
      const e = ent.find((x) => x.team_id === id);
      const f = (m.final || []).find((x) => x.teamId === id);
      const ss = e ? await one(`SELECT count(*) FILTER (WHERE phase = 'game')::int AS n, coalesce(sum(cost_usd), 0) AS usd, count(*) FILTER (WHERE violation)::int AS v FROM arena.sessions WHERE game_id = $1 AND persona_id = $2`, [g.id, e.persona_id]) : {};
      const rq = e ? await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE op = 'submit' AND ok)::int AS ok, count(*) FILTER (WHERE op = 'submit' AND NOT ok)::int AS bad FROM arena.requests WHERE game_id = $1 AND persona_id = $2`, [g.id, e.persona_id]) : {};
      trows.push([t.name, e?.model, f2(f?.fitness), `${f?.feedsReceived ?? "-"} / ${f?.nectarCollected ?? "-"}`, f2(t.precision), `${pc(t.rivalCloverFed)} / ${pc(t.rivalOrchidFed)}`, f2(t.gap), pc(t.repeatShare), t.distinctChallenges,
        ss.n ?? "-", f2(ss.usd), rq.n ?? "-", `${rq.ok ?? 0}/${rq.bad ?? 0}`, ss.v || 0]);
    }
    p("Teams:");
    table(["team", "model", "fitness", "feeds received / nectar collected", "bee precision", "bee fed at rival clovers / orchids", "gap", "repeat", "distinct challenges", "game sessions", "USD (all sessions)", "requests", "submits ok/refused", "violations"], trows);
    // Copies.
    const cp = m.copies || {};
    p(`Orchids copying clovers: ${cp.copied ?? 0} matches of ${cp.cloverAnswers ?? 0} distinct clover answers${cp.medianLatencyMs != null ? `, median ${secs(cp.medianLatencyMs)} after the clover's answer first appeared` : ""} ` +
      `(a match = a rival orchid answering r to c for the first time, after a clover answered r to c). ${cp.afterNewVersion ?? 0} came from an orchid version that went live after the clover's answer appeared` +
      `${cp.medianLatencyAfterNewVersionMs != null ? ` (median ${secs(cp.medianLatencyAfterNewVersionMs)})` : ""}: those are copies; the rest can be convergence (the same rule) or coincidence.`);
    table(["orchid of", "copies", "copied from", "median latency", "fastest 10%", "by a version that went live after the clover's answer", "median latency of those"],
      Object.values(cp.byOrchid || {}).map((o) => [o.name, o.copies, o.from.join(", "), secs(o.medianLatencyMs), secs(o.p10LatencyMs), o.afterNewVersion, secs(o.medianLatencyAfterNewVersionMs)]));
    // Changes.
    p("Change timeline (every program version; lobby = written before the start):");
    table(["game time", "team", "program", "version", "size", "node edits", "cost", "by", "first problem"],
      m.changes.map((c) => [c.atMs ? mmss(c.atMs) : "lobby", c.team, c.kind, `v${c.version}`, c.size, c.distance ?? "-", c.cost,
        c.source === "scaffold" ? "scaffold" : c.source === "runner" ? "runner (lobby fallback)" : c.session != null ? `session ${c.session}` : c.source, c.problem || ""]));
    if ((m.scaffolds || []).length) {
      p("Scaffolds:");
      table(["team", "starts", "crashes", "refused by the audit", "first start", "CPU s", "paused for its CPU share", "automatic submissions ok / refused"],
        m.scaffolds.map((x) => [x.team, x.starts, x.crashes, x.refused, x.first_start_ms != null ? mmss(Number(x.first_start_ms)) : "-", f2(x.cpu_seconds), `${(Number(x.throttled_ms) / 1000).toFixed(1)} s`, `${x.submits} / ${x.refused_submits}`]));
    } else p("No team ran a scaffold.\n");
    // Compute.
    p("Flower compute against budget:");
    table(["flower", "asks", "mean ms", "p90 ms", "max ms", "budget ms", "mean/budget", "p90/budget", "timeouts", "answer chars", "answer nodes / edges (graphs)"],
      Object.values(m.compute || {}).sort((x, y) => x.team.localeCompare(y.team) || x.kind.localeCompare(y.kind)).map((c) => [`${c.team} ${c.kind}`, c.asks, c.meanMs, c.p90Ms, c.maxMs, c.budgetMs, pc(c.meanFrac), pc(c.p90Frac), c.timeouts,
        f2(c.answerChars), c.answerNodes != null ? `${f2(c.answerNodes)} / ${f2(c.answerEdges)}` : "-"]));
    if (Object.keys(m.beeCompute || {}).length) {
      p("Bee decision time against budget:");
      table(["bee", "decisions", "mean ms", "p90 ms", "max ms", "budget ms", "over budget"], Object.values(m.beeCompute).map((b) => [b.team, b.decisions, b.meanMs, b.p90Ms, b.maxMs, b.budgetMs, b.overBudget ?? "-"]));
    }
    // Sessions.
    const sess = await all(`SELECT s.*, p.name, (SELECT count(*)::int FROM arena.requests r WHERE r.session_id = s.id) AS requests,
                                   (SELECT string_agg(r.kind || ' v' || r.version, ', ' ORDER BY r.id) FROM arena.requests r WHERE r.session_id = s.id AND r.op = 'submit' AND r.ok) AS submits,
                                   (SELECT count(*)::int FROM arena.requests r WHERE r.session_id = s.id AND r.op = 'submit' AND NOT r.ok) AS refused
                              FROM arena.sessions s JOIN arena.personas p ON p.id = s.persona_id WHERE s.game_id = $1 ORDER BY s.started_at`, [g.id]);
    p("Sessions (game time at start and end; lobby sessions run before the clock starts):");
    table(["team", "session", "phase", "model", "start", "end", "real s", "ended by", "turns", "USD", "requests", "submitted", "refused submits"],
      sess.map((s) => [s.name, s.attempt ? `${s.no}.${s.attempt}` : s.no, s.phase, s.model, s.phase === "lobby" ? "lobby" : mmss(Number(s.clock_start)), s.clock_end != null ? mmss(Number(s.clock_end)) : "-",
        s.ended_at ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 1000) : "-", s.ended_by || "-", s.turns ?? "-", `${f2(s.cost_usd)}${s.cost_estimated ? " (est.)" : ""}`, s.requests, s.submits || "-", s.refused || 0]));
    const st = m.storage || {};
    p(`Storage: ${st.actions ?? m.actions} actions take ${mb(st.bytes)} in the database (${st.actions ? `${(Number(st.bytes) / st.actions).toFixed(0)} bytes each` : "-"}); the shared stream file ${mb(st.sharedStreamBytes)}; ` +
      `the arena's workspaces ${mb(st.arenaDiskBytes)} on disk (hard links counted once); ${st.freeBytes ? (st.freeBytes / 1e9).toFixed(1) : "-"} GB free after the game.`);
    p();
  }

  // Panel.
  const soc = await all(`SELECT g.generation, e.team_name, e.social, e.social_rank, e.social_parts, e.fitness_rank FROM arena.entries e JOIN arena.games g ON g.id = e.game_id
                          WHERE g.arena_id = $1 AND e.social IS NOT NULL ORDER BY g.generation, e.social_rank`, [a.id]);
  p("### The interview panel");
  table(["game", "team", "social (rank)", "fitness rank", "understanding", "respect", "novelty", "team-up", "judges", "new ideas"],
    soc.map((r) => [r.generation, r.team_name, `${f2(r.social)} (#${r.social_rank})`, r.fitness_rank ?? "-", f2(r.social_parts?.understanding), f2(r.social_parts?.respect), f2(r.social_parts?.novelty), f2(r.social_parts?.team_up), r.social_parts?.judges, (r.social_parts?.newIdeas || []).join(", ")]));
  const comments = await all(`SELECT g.generation, j.name AS judge, j.model, e.team_name, ev.comment FROM arena.evaluations ev JOIN arena.judges j ON j.id = ev.judge_id
                               JOIN arena.games g ON g.id = ev.game_id JOIN arena.entries e ON e.game_id = ev.game_id AND e.persona_id = ev.persona_id
                              WHERE g.arena_id = $1 ORDER BY g.generation DESC, e.team_name, j.name LIMIT 24`, [a.id]);
  if (comments.length) {
    p("<details><summary>Judges' comments (latest games)</summary>\n");
    for (const c of comments) p(`- game ${c.generation}, ${c.judge} on ${c.team_name}: ${String(c.comment || "").slice(0, 300)}`);
    p("\n</details>\n");
  }
  const ev = await all(`SELECT e.*, p.name, p.team_name, p.model FROM arena.population_events e JOIN arena.personas p ON p.id = e.persona_id
                         WHERE e.arena_id = $1 AND e.event IN ('retired','born') AND (e.event = 'retired' OR e.generation > 1) ORDER BY e.generation, e.id`, [a.id]);
  if (ev.length) {
    p("Population changes:");
    for (const e of ev) p(`- after game ${e.event === "born" ? e.generation - 1 : e.generation}: ${e.event} ${e.name} / "${e.team_name}" (${e.model}): ${e.reason}${e.details?.rationale ? `. Rationale: ${e.details.rationale}` : ""}`);
    p();
  }
}

// ---------- durations side by side
if (durations.length) {
  p("## Games by duration");
  p("Per game, averaged over teams where it's per team. Change budgets accrue per minute of game time, so short games allow little or no change.");
  table(["minutes", "arena game", "actions/s", "rounds/s", "teams with a scaffold", "in-game changes: sessions / scaffolds", "bee precision", "rival clover−orchid fed gap (discrimination)", "repeat share",
    "clover / orchid compute used", "clover / orchid answer nodes", "orchid matches of earlier clover answers (median latency)", "of those, copies by a newer orchid version (median latency)", "game sessions per team", "fitness spread", "USD"],
    durations.sort((x, y) => x.minutes - y.minutes || x.gen - y.gen).map((d) => [d.minutes, `${d.arena} ${d.gen}`, f2(d.actionsPerSec), f2(d.roundsPerSec), `${d.scaffoldTeams}/${d.teams}`, `${d.sessionChanges} / ${d.autoChanges}`,
      f2(d.precision), f2(d.gap), pc(d.repeat), `${pc(d.cloverCompute)} / ${pc(d.orchidCompute)}`, `${f2(d.cloverNodes)} / ${f2(d.orchidNodes)}`,
      `${d.copies} (${secs(d.copyLatency)})`, `${d.newCopies} (${secs(d.newCopyLatency)})`, f2(d.sessions), f2(d.fitSpread), f2(d.cost)]));
}

// ---------- ideas, breeders, audit
const ideas = await all(`SELECT i.tag, i.description, i.first_arena, i.first_team, (SELECT count(DISTINCT s.game_id)::int FROM arena.idea_sightings s WHERE s.idea_id = i.id) AS games
                           FROM arena.ideas i WHERE i.first_arena = ANY($1) ORDER BY i.id`, [ids]);
p("## Idea ledger (ideas first seen in these arenas)");
table(["tag", "description", "first team", "games seen"], ideas.map((i) => [i.tag, i.description, `${i.first_team} (${i.first_arena})`, i.games]));
const bs = await breederScores();
p("## Breeders (all arenas)");
table(["breeder", "model", "spawn", "retired", "games", "fitness pct", "social pct", "score"], Object.values(bs).map((b) => [b.name, b.model, b.spawns, b.retired, b.games, f2(b.fitPct), f2(b.socPct), f3(b.score)]));
p("## Fair-play audit");
const viol = await all(`SELECT v.arena_id, v.severity, count(*)::int AS n, count(DISTINCT v.persona_id)::int AS teams, (array_agg(left(v.detail, 160) ORDER BY v.id))[1:3] AS examples
                          FROM arena.violations v WHERE v.arena_id = ANY($1) GROUP BY 1, 2 ORDER BY 1, 2`, [ids]);
const audited = await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE violation)::int AS v FROM arena.sessions WHERE arena_id = ANY($1) AND ended_at IS NOT NULL", [ids]);
p(`${audited.n} sessions audited (live, before every request, and in full afterwards); ${audited.v} with a violation.`);
p();
table(["arena", "severity", "findings", "teams", "examples"], viol.map((v) => [v.arena_id, v.severity, v.n, v.teams, (v.examples || []).join(" // ")]));

console.log(out.join("\n"));
await pool.end();
