#!/usr/bin/env node
// Summarise everything in the arena schema as Markdown (spend, leaderboards, metrics, collapses, judges, ideas, breeders).
//   node arena/analyze.js [--arenas a,b] > arena/runs/analysis.md
import { all, pool } from "./lib/db.js";
import { breederScores } from "./lib/population.js";
import { spearman } from "./lib/metrics.js";
import fs from "node:fs";
import { demoBorrowing, gameRef, shapeCensus, transcriptStats } from "./lib/cohort.js";
import { catalogueFor } from "./lib/adoption.js";
import { v3RoundStats } from "./lib/v3.js";
import { TRANSCRIPTS } from "./lib/workspace.js";
globalThis.__fs = fs;

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const WEB = process.env.ARENA_WEB || "http://localhost:4000";
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(2));
const f3 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(3));
const mean = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const out = [];
const p = (s = "") => out.push(s);
const table = (head, rows) => { p(`| ${head.join(" | ")} |`); p(`|${head.map(() => "---").join("|")}|`); rows.forEach((r) => p(`| ${r.join(" | ")} |`)); p(); };

const arenaFilter = args.arenas ? args.arenas.split(",") : null;
const arenas = (await all("SELECT * FROM arena.arenas ORDER BY created_at")).filter((a) => !arenaFilter || arenaFilter.includes(a.id));
const ids = arenas.map((a) => a.id);
// Games hit by the session-limit outage are quarantined: listed, but excluded from every metric and leaderboard.
const QUAR = new Set((await all("SELECT id FROM arena.games WHERE contaminated IS NOT NULL")).map((r) => r.id));
const CLEAN = "(SELECT id FROM arena.games WHERE contaminated IS NULL)";

// ---------- spend
p("## Spend");
const byModel = await all(`SELECT model, count(*)::int AS calls, sum(cost_usd) AS usd, sum(input_tokens)::bigint AS inp, sum(output_tokens)::bigint AS outp, sum(cache_read)::bigint AS cr, sum(cache_write)::bigint AS cw,
                                  count(*) FILTER (WHERE NOT ok)::int AS failed, avg(duration_ms)::int AS ms FROM arena.llm_calls WHERE arena_id = ANY($1) OR arena_id IS NULL GROUP BY model ORDER BY usd DESC`, [ids]);
table(["model", "calls", "failed", "USD", "input tok", "output tok", "cache read", "cache write", "avg s"], byModel.map((r) => [r.model, r.calls, r.failed, f2(r.usd), r.inp, r.outp, r.cr, r.cw, (r.ms / 1000).toFixed(0)]));
const byPurpose = await all(`SELECT purpose, count(*)::int AS calls, sum(cost_usd) AS usd FROM arena.llm_calls WHERE arena_id = ANY($1) OR arena_id IS NULL GROUP BY purpose ORDER BY usd DESC`, [ids]);
table(["purpose", "calls", "USD"], byPurpose.map((r) => [r.purpose, r.calls, f2(r.usd)]));
const byArena = await all(`SELECT arena_id, sum(cost_usd) AS usd, count(*)::int AS calls FROM arena.llm_calls GROUP BY arena_id ORDER BY arena_id`);
table(["arena", "calls", "USD"], byArena.filter((r) => !arenaFilter || ids.includes(r.arena_id)).map((r) => [r.arena_id ?? "(none)", r.calls, f2(r.usd)]));
const pm = await all(`SELECT purpose, model, count(*)::int AS calls, sum(cost_usd) AS usd FROM arena.llm_calls WHERE arena_id = ANY($1) OR arena_id IS NULL GROUP BY purpose, model ORDER BY purpose, usd DESC`, [ids]);
table(["purpose", "model", "calls", "USD", "USD/call"], pm.map((r) => [r.purpose, r.model, r.calls, f2(r.usd), f3(r.usd / r.calls)]));

// ---------- per arena
for (const a of arenas) {
  p(`## Arena \`${a.id}\` (${a.preset})`);
  p(`${a.settings.description}. Room: ${WEB}${a.room_url}. Status: ${a.status}.`);
  p();
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 ORDER BY generation", [a.id]);
  const rows = [];
  for (const g of games) {
    const m = g.metrics;
    const ent = await all("SELECT e.*, p.name, p.model, p.archetype FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE game_id = $1 ORDER BY fitness_rank", [g.id]);
    const newIdeas = await all("SELECT DISTINCT i.tag FROM arena.idea_sightings s JOIN arena.ideas i ON i.id = s.idea_id WHERE s.game_id = $1 AND s.new_in_game", [g.id]);
    const allTags = await all("SELECT DISTINCT i.tag FROM arena.idea_sightings s JOIN arena.ideas i ON i.id = s.idea_id WHERE s.game_id = $1", [g.id]);
    const corr = ent.filter((e) => e.social != null).length > 2 ? spearman(ent.filter((e) => e.social != null).map((e) => e.fitness), ent.filter((e) => e.social != null).map((e) => e.social)) : null;
    if (QUAR.has(g.id)) { rows.push([g.generation, g.condition || "-", `[${g.game_short_id}](${WEB}${g.game_url})`, `QUARANTINED (${g.contaminated})`, ...Array(17).fill("")]); continue; }
    const ot = m?.orchidTargets, oft = m?.orchidFeatureTargets;
    const sat = ent.filter((e) => e.sat_out).length;
    rows.push([g.generation, g.condition || "-", `[${g.game_short_id}](${WEB}${g.game_url})`, ent[0] ? `${ent[0].team_name} (${ent[0].model}) ${f2(ent[0].fitness)}` : "-",
      f2(m?.fitnessStd), f2(m?.topRatio), f2(m?.avg?.precision), f2(m?.avg?.feedRate), f2(m?.avg?.feedsPerBee), f2(m?.avg?.orchidFeedShare), f2(m?.avg?.orchidSelfMimicry),
      f2(m?.avg?.topChallengeShare), f2(m?.avg?.cumRankTau), m ? `${f2(m.changeUse.clover)}/${f2(m.changeUse.orchid)}/${f2(m.changeUse.bee)}` : "-",
      m ? `${f2(m.lastSimilarity.clover)}/${f2(m.lastSimilarity.orchid)}/${f2(m.lastSimilarity.bee)}` : "-",
      `${newIdeas.length}/${allTags.length}`, f2(corr), ot ? `${ot.self ?? 0}/${ot.rival ?? 0}/${ot.convention ?? 0}/${ot.none ?? 0}` : "-",
      oft ? `${oft.self ?? 0}/${oft.rival ?? 0}/${oft.convention ?? 0}/${oft.none ?? 0}` : "-", sat || "-", (m?.collapses || []).map((c) => c.mode).join(", ") || "-"]);
  }
  table(["gen", "condition", "game", "winner", "fit std", "top/2nd", "precision", "feed rate", "feeds/bee", "orchid feed share", "orchid self-mimicry", "top challenge share", "cum rank tau", "change use c/o/b", "similarity c/o/b", "new/all ideas", "ρ(fit,social)", "orchid targets self/rival/conv/none (team-rounds)", "feature-level targets", "sat out", "game collapse flags"], rows);
  // Round-level detail
  p(`<details><summary>Round metrics</summary>\n`);
  const rrows = [];
  for (const g of games) {
    if (QUAR.has(g.id)) continue;
    const rms = await all("SELECT * FROM arena.round_metrics WHERE game_id = $1 ORDER BY round_no", [g.id]);
    const cev = await all("SELECT round_no, mode FROM arena.collapse_events WHERE game_id = $1 AND round_no IS NOT NULL", [g.id]);
    for (const r of rms) {
      const m = r.metrics;
      const o = m.orchidTargets;
      rrows.push([`${g.generation}.${r.round_no}`, o?.counts ? `${o.counts.self}/${o.counts.rival}/${o.counts.convention}/${o.counts.none}` : "-", o?.victims ? `${o.victims.length}: ${f2(o.victimCloverFedRate)} vs ${f2(o.otherCloverFedRate)}` : "-", m.feeds, f2(m.precision), f2(m.feedRate), m.beesNotFeeding, f2(m.orchidFeedShare), f2(m.orchidSelfMimicry), f2(m.orchidCrossMimicry), f2(m.cloverAgreement), f2(m.topChallengeShare), m.distinctFirstChallenges, f2(m.asksPerVisit), f2(m.rankTau), f2(m.fitnessStd), `${m.change.clover.total}/${m.change.orchid.total}/${m.change.bee.total}`, f2(m.errorRate), m.timeouts, f2(m.selfFeedShare), cev.filter((c) => c.round_no === r.round_no).map((c) => c.mode).join(", ")]);
    }
  }
  table(["gen.round", "orchid targets s/r/c/n", "victims: clover fed rate vs others", "feeds", "precision", "feed rate", "bees not feeding", "orchid feed share", "orchid self-mimic", "orchid cross-mimic", "clover agreement", "top challenge share", "distinct 1st challenges", "asks/visit", "rank tau", "fit std", "edits c/o/b", "error rate", "timeouts", "self-feed", "flags"], rrows);
  p(`</details>\n`);
  // Winners, social tops and new ideas per generation; dominance across generations.
  p("Per generation: fitness winner, social winner, ideas new to the ledger (by team):");
  const winners = [];
  for (const g of games) {
    if (QUAR.has(g.id)) { p(`- gen ${g.generation}: QUARANTINED (outage)`); continue; }
    const ent = await all("SELECT e.*, p.name, p.model, p.archetype FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE game_id = $1", [g.id]);
    const fw = [...ent].filter((e) => e.fitness != null).sort((x, y) => y.fitness - x.fitness)[0];
    const sw = [...ent].filter((e) => e.social != null).sort((x, y) => y.social - x.social)[0];
    if (fw) winners.push(fw);
    const ni = await all(`SELECT i.tag, string_agg(DISTINCT e.team_name, ', ') AS teams FROM arena.idea_sightings s JOIN arena.ideas i ON i.id = s.idea_id
                            JOIN arena.entries e ON e.game_id = s.game_id AND e.persona_id = s.persona_id WHERE s.game_id = $1 AND s.new_in_game GROUP BY i.tag ORDER BY i.tag`, [g.id]);
    p(`- gen ${g.generation}: fitness ${fw ? `${fw.team_name} (${fw.name}, ${fw.model}) ${f2(fw.fitness)}` : "-"}; social ${sw ? `${sw.team_name} ${f2(sw.social)}` : "-"}; new ideas: ${ni.map((x) => `${x.tag} [${x.teams}]`).join("; ") || "none"}`);
  }
  let streak = 1, best = 1;
  for (let i = 1; i < winners.length; i++) { streak = winners[i].persona_id === winners[i - 1].persona_id ? streak + 1 : 1; best = Math.max(best, streak); }
  const archWins = {};
  winners.forEach((w) => (archWins[w.archetype] = (archWins[w.archetype] || 0) + 1));
  p(`\nLongest winning streak by one persona: ${best}. Wins by archetype: ${Object.entries(archWins).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  p();
  // Population events
  const ev = await all(`SELECT e.*, p.name, p.team_name, p.model, p.archetype FROM arena.population_events e JOIN arena.personas p ON p.id = e.persona_id WHERE e.arena_id = $1 AND e.event IN ('retired','born','reinstated','displaced','abandoned-game') AND e.generation > 1 ORDER BY e.generation, e.id`, [a.id]);
  if (ev.length) {
    p("Population changes:");
    for (const e of ev) p(`- gen ${e.generation}: ${e.event} ${e.name} / "${e.team_name}" (${e.model}, ${e.archetype}): ${e.reason}${e.details?.rationale ? ` Rationale: ${e.details.rationale}` : ""}`);
    p();
  }
}

// ---------- conditions: primed (old shared starter code) vs post-primed vs unprimed, by round number
p("## Conditions by round (int→int arenas only, so the conditions are comparable)");
p("primed = round-1 prompts showed the old shared starter code (and the old RULES text); post-primed = no starters but the arena's history began primed (recaps, notebooks); unprimed = arena never saw starter code.");
p();
const cond = await all(`SELECT g.condition, rm.round_no, rm.metrics FROM arena.round_metrics rm JOIN arena.games g ON g.id = rm.game_id JOIN arena.arenas a ON a.id = g.arena_id
                         WHERE a.id = ANY($1) AND g.config->>'challengeType' = 'int' AND g.config->>'responseType' = 'int' AND g.condition IS NOT NULL AND g.contaminated IS NULL`, [ids]);
const crow = [];
for (const c of ["primed", "post-primed", "unprimed"]) for (let r = 1; r <= 5; r++) {
  const ms = cond.filter((x) => x.condition === c && x.round_no === r).map((x) => x.metrics);
  if (!ms.length) continue;
  const ot = ms.reduce((acc, m) => { for (const [k, v] of Object.entries(m.orchidTargets?.counts || {})) acc[k] = (acc[k] || 0) + v; return acc; }, {});
  const tot = Object.values(ot).reduce((a, b) => a + b, 0) || 1;
  crow.push([c, r, ms.length, f2(mean(ms.map((m) => m.precision))), f2(mean(ms.map((m) => m.feedRate))), f2(mean(ms.map((m) => m.similarity?.clover))), f2(mean(ms.map((m) => m.similarity?.orchid))), f2(mean(ms.map((m) => m.similarity?.bee))),
    f2(mean(ms.map((m) => m.cloverAgreement))), f2(mean(ms.map((m) => m.topChallengeShare))), f2(mean(ms.map((m) => m.distinctFirstChallenges))),
    `${Math.round(100 * (ot.self || 0) / tot)}/${Math.round(100 * (ot.rival || 0) / tot)}/${Math.round(100 * (ot.convention || 0) / tot)}/${Math.round(100 * (ot.none || 0) / tot)}`,
    f2(mean(ms.map((m) => m.orchidTargets?.victimCloverFedRate))), f2(mean(ms.map((m) => m.orchidTargets?.otherCloverFedRate)))]);
}
table(["condition", "round", "games", "precision", "feed rate", "sim clover", "sim orchid", "sim bee", "clover agreement", "top challenge share", "distinct 1st challenges", "orchid targets % s/r/c/n", "victim clover fed rate", "other clover fed rate"], crow);

// Structured arenas: exact vs feature-level imitation by round.
const st = await all(`SELECT g.arena_id, g.generation, rm.round_no, rm.metrics FROM arena.round_metrics rm JOIN arena.games g ON g.id = rm.game_id
                       WHERE g.arena_id = ANY($1) AND g.config->>'responseType' ~ 'tree|graph' AND g.contaminated IS NULL ORDER BY 1, 2, 3`, [ids]);
if (st.length) {
  p("## Trees and graphs: exact vs structural imitation, bees' structural tests");
  table(["arena", "gen.round", "precision", "feed rate", "exact targets s/r/c/n", "feature targets s/r/c/n", "bees testing structure", "bees keyed on exact answer", "victims: fed rate vs others"],
    st.map((x) => { const o = x.metrics.orchidTargets || {}; const c = o.counts || {}, fc = o.featCounts || {};
      return [x.arena_id, `${x.generation}.${x.round_no}`, f2(x.metrics.precision), f2(x.metrics.feedRate), `${c.self ?? "-"}/${c.rival ?? "-"}/${c.convention ?? "-"}/${c.none ?? "-"}`, `${fc.self ?? "-"}/${fc.rival ?? "-"}/${fc.convention ?? "-"}/${fc.none ?? "-"}`, o.beesStructural ?? "-", o.beesExactKey ?? "-", o.victims ? `${o.victims.length}: ${f2(o.victimCloverFedRate)} vs ${f2(o.otherCloverFedRate)}` : "-"]; }));
}

// ---------- engine v2 phase (tool-using teams, idea cards)
const v2games = await all(`SELECT g.* FROM arena.games g WHERE g.arena_id = ANY($1) AND g.condition = 'v2' AND g.contaminated IS NULL AND g.metrics IS NOT NULL ORDER BY g.arena_id, g.generation`, [ids]);
if (v2games.length) {
  p("## Engine v2 (tool-using teams)");
  const vrows = [];
  for (const g of v2games) {
    for (const r of await all("SELECT * FROM arena.round_metrics WHERE game_id = $1 ORDER BY round_no", [g.id])) {
      const m = r.metrics, o = m.orchidTargets || {}, c = o.counts || {}, fc = o.featCounts || {};
      vrows.push([`${g.arena_id} ${g.generation}.${r.round_no}`, f2(m.precision), f3(m.nectarPerTurn), f2(m.feedsPerBeePerFlower), f2(m.fedVisitsWithPostFeedAsks), m.beesReadingMemory ?? "-",
        `${f2(m.cloverComputeFrac)} (max ${f2(m.cloverComputeMaxFrac)})`, f2(m.orchidComputeFrac), `${c.self ?? "-"}/${c.rival ?? "-"}/${c.convention ?? "-"}/${c.none ?? "-"}`,
        o.featCounts ? `${fc.self}/${fc.rival}/${fc.convention}/${fc.none}` : "-", o.victims ? `${o.victims.length}: ${f2(o.victimCloverFedRate)} vs ${f2(o.otherCloverFedRate)}` : "-",
        `${m.change.clover.teamsChanged}/${m.change.orchid.teamsChanged}/${m.change.bee.teamsChanged}`, f2(m.rankTau),
        (await all("SELECT mode FROM arena.collapse_events WHERE game_id = $1 AND round_no = $2", [g.id, r.round_no])).map((x) => x.mode).join(", ")]);
    }
  }
  table(["arena gen.round", "precision", "nectar/turn", "feeds/bee/flower", "fed visits with post-feed asks", "bees reading MEMORY", "clover compute/budget", "orchid compute/budget",
    "orchid targets s/r/c/n", "structural s/r/c/n", "victims: fed vs others", "teams changed c/o/b", "rank τ", "flags"], vrows);
  // Hinted vs unhinted: per persona-game, from the round metrics' team features and the entries.
  const hrows = await all(`SELECT p.id, p.idea_card, p.model, e.game_id, e.fitness, e.social, e.team_id, e.sat_out FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id
                            WHERE e.game_id = ANY($1)`, [v2games.map((g) => g.id)]);
  const feats = {};
  for (const g of v2games) for (const r of await all("SELECT metrics FROM arena.round_metrics WHERE game_id = $1", [g.id])) {
    const tf = r.metrics.teamFeatures || {}, per = r.metrics.orchidTargets?.perTeam || [];
    for (const [team, f] of Object.entries(tf)) (feats[`${g.id}:${team}`] ||= []).push({ ...f, orchidCat: per.find((x) => x.team === team)?.category, orchidFeatCat: per.find((x) => x.team === team)?.feature?.category });
  }
  const grp = {};
  for (const h of hrows) {
    const key = h.idea_card ? `card ${h.idea_card}` : "no card";
    const fs_ = feats[`${h.game_id}:${h.team_id}`] || [];
    const g = (grp[key] ||= { n: 0, models: {}, fit: [], soc: [], prec: [], npt: [], cc: [], post: [], mem: [], keyed: [], rival: [], self: [], sat: 0 });
    g.n++; g.models[h.model] = (g.models[h.model] || 0) + 1;
    if (h.sat_out) { g.sat++; continue; }
    g.fit.push(h.fitness); g.soc.push(h.social);
    for (const f of fs_) {
      g.prec.push(f.precision); g.npt.push(f.nectarPerTurn); g.cc.push(f.cloverComputeFrac); g.post.push(f.postFeedAsks > 0 ? 1 : 0); g.mem.push(f.beeReadsMemory ? 1 : 0);
      g.keyed.push(f.cloverKeyedMod ? 1 : 0); g.rival.push(f.orchidCat === "rival" || f.orchidFeatCat === "rival" ? 1 : 0); g.self.push(f.orchidCat === "self" ? 1 : 0);
    }
  }
  p("Hinted vs unhinted teams (per persona-game; behaviour shares are over team-rounds):");
  table(["group", "persona-games", "models", "sat out", "fitness", "social", "bee precision", "nectar/turn", "clover compute/budget", "bee asks after feeding", "bee reads MEMORY", "clover keyed on challenge (mod)", "orchid imitates a rival", "orchid imitates own clover"],
    Object.entries(grp).map(([k, g]) => [k, g.n, Object.entries(g.models).map(([m, c]) => `${m} ${c}`).join(", "), g.sat, f2(mean(g.fit)), f2(mean(g.soc)), f2(mean(g.prec)), f3(mean(g.npt)), f2(mean(g.cc)),
      f2(mean(g.post)), f2(mean(g.mem)), f2(mean(g.keyed)), f2(mean(g.rival)), f2(mean(g.self))]));
  // Adoption over rounds among UNHINTED teams (spread of the card ideas).
  const arows = [];
  for (const g of v2games) for (const r of await all("SELECT round_no, metrics FROM arena.round_metrics WHERE game_id = $1 ORDER BY round_no", [g.id])) {
    const tf = r.metrics.teamFeatures || {}, per = r.metrics.orchidTargets?.perTeam || [];
    const hinted = new Set(hrows.filter((h) => h.game_id === g.id && h.idea_card).map((h) => h.team_id));
    const un = Object.entries(tf).filter(([t]) => !hinted.has(t)), hi = Object.entries(tf).filter(([t]) => hinted.has(t));
    const share = (rows, fn) => (rows.length ? `${rows.filter(fn).length}/${rows.length}` : "-");
    const rivalOf = (t) => { const x = per.find((y) => y.team === t); return x?.category === "rival" || x?.feature?.category === "rival"; };
    arows.push([`${g.arena_id} ${g.generation}.${r.round_no}`,
      share(hi, ([, f]) => f.cloverComputeFrac > 0.25), share(un, ([, f]) => f.cloverComputeFrac > 0.25),
      share(hi, ([, f]) => f.cloverKeyedMod), share(un, ([, f]) => f.cloverKeyedMod),
      share(hi, ([, f]) => f.postFeedAsks > 0), share(un, ([, f]) => f.postFeedAsks > 0),
      share(hi, ([, f]) => f.beeReadsMemory), share(un, ([, f]) => f.beeReadsMemory),
      share(hi, ([t]) => rivalOf(t)), share(un, ([t]) => rivalOf(t))]);
  }
  p("Adoption of the card ideas, hinted | unhinted (teams per round):");
  table(["arena gen.round", "clover compute >25% (H)", "(U)", "clover keyed mod (H)", "(U)", "post-feed asks (H)", "(U)", "bee reads MEMORY (H)", "(U)", "orchid imitates rival (H)", "(U)"], arows);
  const viol = await all("SELECT arena_id, severity, count(*)::int AS n, count(DISTINCT persona_id)::int AS teams FROM arena.violations WHERE arena_id = ANY($1) GROUP BY 1, 2 ORDER BY 1, 2", [ids]);
  p("Fair-play audit of tool sessions:");
  table(["arena", "severity", "findings", "teams"], viol.map((v) => [v.arena_id, v.severity, v.n, v.teams]));
  const sess = await all(`SELECT c.model, c.purpose, count(*)::int AS n, sum(c.cost_usd) AS usd, avg(c.turns) AS turns, avg(c.duration_ms) / 1000 AS s FROM arena.llm_calls c
                           WHERE c.arena_id = ANY($1) AND c.arena_id LIKE 'v2-%' GROUP BY 1, 2 ORDER BY 2, 1`, [ids]);
  p("v2 spend by purpose and model:");
  table(["model", "purpose", "calls", "USD", "USD/call", "avg turns", "avg s"], sess.map((r) => [r.model, r.purpose, r.n, f2(r.usd), f3(r.usd / r.n), f2(r.turns), (r.s ?? 0).toFixed(0)]));
}

// ---------- cohort experiment (int→graph[any]; control vs treatment vs control2)
// Arenas with settings.cohort, grouped by experiment (gx = int→graph[any] cards; v3 = engine-v3 continuation;
// v3x = engine-v3 examples experiment). A group with a treatment gets paired comparisons against its controls.
const cohortGroups = {};
for (const a of arenas.filter((x) => x.settings?.cohort)) (cohortGroups[a.settings.cohort.experiment || "gx"] ||= []).push(a);
for (const [experiment, cohortArenas] of Object.entries(cohortGroups)) {
  const T = cohortArenas.find((a) => a.settings.cohort.role === "treatment")?.id;
  const [C1, C2] = cohortArenas.filter((a) => a.settings.cohort.role === "control").map((a) => a.id).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const examplesArm = !!cohortArenas.find((a) => a.settings.cohort.examples);
  p(`## Cohort experiment \`${experiment}\` (${cohortArenas.map((a) => `${a.id}: ${a.settings.cohort.role}`).join(", ")})`);
  const cgames = await all(`SELECT g.* FROM arena.games g WHERE g.arena_id = ANY($1) AND g.stage IN ('played','interviewed','judged','done') AND g.contaminated IS NULL ORDER BY g.generation, g.arena_id`, [cohortArenas.map((a) => a.id)]);
  // Per cohort/game summary.
  const srows = [];
  for (const g of cgames) {
    const m = g.metrics || {};
    const ent = await all("SELECT e.*, p.slug FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1 ORDER BY e.fitness_rank", [g.id]);
    const rms = await all("SELECT metrics FROM arena.round_metrics WHERE game_id = $1", [g.id]);
    const avg = (k) => f3(mean(rms.map((r) => r.metrics[k])));
    const ot = m.orchidTargets || {}, of = m.orchidFeatureTargets || {};
    srows.push([`${g.arena_id} g${g.generation}`, `[${g.game_short_id}](${WEB}${g.game_url})`, ent[0] ? `${ent[0].slug} ${f2(ent[0].fitness)}` : "-", ent.map((e) => `${e.slug} ${f2(e.fitness)}`).join(", "),
      avg("precision"), avg("nectarPerTurn"), avg("feedsPerBeePerFlower"), avg("cloverComputeFrac"), avg("fedVisitsWithPostFeedAsks"), f2(mean(rms.map((r) => r.metrics.beesReadingMemory))),
      `${ot.self ?? 0}/${ot.rival ?? 0}/${ot.convention ?? 0}/${ot.none ?? 0}`, `${of.self ?? 0}/${of.rival ?? 0}/${of.convention ?? 0}/${of.none ?? 0}`, (m.collapses || []).map((c) => c.mode).join(", ") || "-"]);
  }
  table(["cohort game", "link", "winner", "final fitness by team", "precision", "nectar/turn", "feeds/bee/flower", "clover compute/budget", "fed visits w/ post-feed asks", "bees reading MEMORY",
    "orchid targets s/r/c/n", "structural s/r/c/n", "game flags"], srows);
  // Paired comparison: each persona's fitness and rank in treatment vs its twins.
  const tArena = cohortArenas.find((a) => a.settings.cohort.role === "treatment");
  const holders = tArena?.settings.cohort.holders || {};
  const fit = await all(`SELECT g.arena_id, g.generation, p.slug, e.fitness, e.fitness_rank, e.social FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id JOIN arena.games g ON g.id = e.game_id
                          WHERE g.arena_id = ANY($1) AND e.fitness IS NOT NULL`, [cohortArenas.map((a) => a.id)]);
  const slugs = [...new Set(fit.map((x) => x.slug))].sort();
  const gens = [...new Set(fit.map((x) => x.generation))].sort();
  const prow = [];
  const diffs = { holder: [], other: [], noise: [] };
  for (const sl of slugs) for (const g of gens) {
    const get = (a) => fit.find((x) => x.arena_id === a && x.slug === sl && x.generation === g);
    const t = T && get(T), c = C1 && get(C1), c2 = C2 && get(C2);
    if (!t && !c) continue;
    if (t && c) (holders[sl] || examplesArm ? diffs.holder : diffs.other).push(t.fitness - (c2 ? (c.fitness + c2.fitness) / 2 : c.fitness));
    if (c && c2) diffs.noise.push(Math.abs(c.fitness - c2.fitness));
    prow.push([sl, examplesArm ? "examples" : holders[sl] || "-", g, t ? `${f2(t.fitness)} (#${t.fitness_rank})` : "-", c ? `${f2(c.fitness)} (#${c.fitness_rank})` : "-", c2 ? `${f2(c2.fitness)} (#${c2.fitness_rank})` : "-",
      t && c ? f2(t.fitness - (c2 ? (c.fitness + c2.fitness) / 2 : c.fitness)) : "-", c && c2 ? f2(Math.abs(c.fitness - c2.fitness)) : "-"]);
  }
  if (T) {
    p(`Paired comparison (same persona, same games, same seeds; treatment ${T}, controls ${C1}${C2 ? `, ${C2}` : ""}; Δ = treatment − mean of controls; noise = |control − control2|):`);
    table(["persona", examplesArm ? "arm" : "card", "game", "treatment", "control", "control2", "Δ fitness", "noise"], prow);
  }
  if (T) p(`Mean Δ fitness, ${examplesArm ? "treatment teams (the whole cohort got the examples)" : "card holders"}: ${f3(mean(diffs.holder))} (n=${diffs.holder.length}); other treatment teams: ${f3(mean(diffs.other))} (n=${diffs.other.length}); noise floor (mean |control − control2|): ${f3(mean(diffs.noise))} (n=${diffs.noise.length}).`);
  p();
  // Adoption of catalogue ideas: per cohort, game.round: teams whose code implements each idea (haiku classifier), holders marked *.
  const ad = await all(`SELECT g.arena_id, g.generation, a.round_no, p.slug, a.method, a.ideas FROM arena.adoption a JOIN arena.games g ON g.id = a.game_id JOIN arena.personas p ON p.id = a.persona_id
                         WHERE g.arena_id = ANY($1) ORDER BY g.generation, a.round_no`, [cohortArenas.map((a) => a.id)]);
  const ideaIds = catalogueFor(experiment).map((c) => c.id);
  const arow = [];
  for (const a of cohortArenas) for (const g of gens) for (const r of [1, 2, 3, 4, 5]) {
    const rows = ad.filter((x) => x.arena_id === a.id && x.generation === g && x.round_no === r && x.method === "llm");
    if (!rows.length) continue;
    const kw = ad.filter((x) => x.arena_id === a.id && x.generation === g && x.round_no === r && x.method === "keyword");
    arow.push([`${a.id} g${g}.r${r}`, ...ideaIds.map((id) => {
      const who = rows.filter((x) => ["clover", "orchid", "bee"].some((k) => (x.ideas[k] || []).includes(id))).map((x) => x.slug + (holders[x.slug] ? "*" : ""));
      const kwWho = kw.filter((x) => (x.ideas.code || []).includes(id) || (x.ideas.notes || []).includes(id)).length;
      return who.length || kwWho ? `${who.join(" ") || "-"}${kwWho ? ` (kw ${kwWho})` : ""}` : "";
    })]);
  }
  if (arow.length) p("Adoption of catalogue ideas (teams whose code implements the idea per the haiku classifier; * = card holder or its twin; kw = teams whose code or notes mention it):");
  if (arow.length) table(["cohort game.round", ...ideaIds], arow);
  // Manipulation check and Python use, from the session transcripts.
  const trow = [];
  for (const a of cohortArenas) {
    const ts = transcriptStats(TRANSCRIPTS, a.id);
    for (const g of Object.keys(ts).map(Number).sort()) {
      const o = ts[g], py = cgames.find((x) => x.arena_id === a.id && x.generation === g)?.python;
      trow.push([`${a.id} g${g}`, py == null ? "-" : py ? "yes" : "no", o.sessions, o.pyRan, o.pySessions.size, o.pyDenied, [...o.cardReaders].map((s) => s + (holders[s] && a.settings.cohort.role === "treatment" ? "*" : "")).join(" ") || "-"]);
    }
  }
  p("Sessions, Python and idea files (from transcripts; * = card holder):");
  table(["cohort game", "python enabled", "sessions", "python cmds ran", "sessions running python", "python cmds denied", "teams that opened ideas.md / idea-card.md"], trow);
  // Metagame: modal clover and orchid shapes in each game's last round (from the answers bees saw), per team.
  const shapeRows = [];
  const srcRef = await gameRef(cohortArenas[0].settings.cohort.forkOf.split("/")[0], Number(cohortArenas[0].settings.cohort.forkOf.split("-").pop()));
  if (srcRef) { const cs = await shapeCensus(srcRef, srcRef.rounds, "clover"), os = await shapeCensus(srcRef, srcRef.rounds, "orchid");
    shapeRows.push([`fork source g${srcRef.row.generation}.r${srcRef.rounds}`, ...slugs.map((s) => `${cs[s] ?? "-"} / ${os[s] ?? "-"}`)]); }
  for (const g of gens) for (const a of cohortArenas) {
    const G = await gameRef(a.id, g);
    if (!G || !G.rounds) continue;
    const cs = await shapeCensus(G, G.rounds, "clover"), os = await shapeCensus(G, G.rounds, "orchid");
    shapeRows.push([`${a.id} g${g}.r${G.rounds}`, ...slugs.map((s) => `${cs[s] ?? "-"} / ${os[s] ?? "-"}`)]);
  }
  p("Metagame: modal clover / orchid answer shape in each game's last round (shares when below 90%; /degree, /index, /factors = label patterns):");
  table(["game", ...slugs.map((s) => s + (holders[s] ? ` (${holders[s]} in treatment)` : ""))], shapeRows);
  // Diffusion through the top-2 code demo.
  const drow = [];
  for (const a of cohortArenas) for (const g of gens) {
    const G = await gameRef(a.id, g);
    const P = g === 1 ? srcRef : await gameRef(a.id, g - 1);
    if (!G || !P || !G.rounds) continue;
    const d = await demoBorrowing(G, P);
    const b = d.rows.filter((r) => r.borrowed);
    drow.push([`${a.id} g${g}`, d.demo.join(", "), d.rows.length, f2(mean(d.rows.map((r) => r.before))), f2(mean(d.rows.map((r) => r.r1))), f2(mean(d.rows.map((r) => r.last))),
      b.map((r) => `${r.slug}.${r.kind} ← ${r.from} (${f2(r.before)} → ${f2(Math.max(r.r1, r.last))})`).join("; ") || "-"]);
  }
  p("Diffusion through the top-2 code demo (token-shingle similarity of each non-demo program to the closest demo program of the same kind: before = own final code in the previous game; borrowed = up by > 0.25 to > 0.35):");
  table(["cohort game", "demo (top 2 of previous game)", "programs", "mean sim before", "round 1", "last round", "borrowed"], drow);

  // Engine v3: per-round discrimination, fingerprinting, non-determinism, compute and example markers.
  if (cohortArenas.some((a) => a.settings.cohort.experiment !== "gx") || args["v3-tables"]) {
    const vrow = [], byKey = {};
    for (const g of gens) for (const a of cohortArenas) {
      const G = await gameRef(a.id, g);
      if (!G || !G.rounds) continue;
      for (const r of await v3RoundStats(G)) {
        byKey[`${a.id}|${g}|${r.round}`] = r;
        const n = r.teams, mk = (k, m) => r.markers[k][m];
        vrow.push([`${a.id} g${g}.r${r.round}`, f3(r.nectarPerTurn), f2(r.precision), `${f2(r.rivalCloverFed)} / ${f2(r.rivalOrchidFed)}`, f2(r.gap), f2(r.repeatShare),
          `${f2(r.stolenShare)} / ${f2(r.twinShare)}`, `${r.nondet.clover}/${r.nondet.cloverAsked} · ${r.nondet.orchid}/${r.nondet.orchidAsked}`,
          `${mk("clover", "random")}/${mk("clover", "clock")}/${mk("clover", "gameMs")} of ${n}`,
          `${f2(r.compute.clover.mean)} (p90 max ${f2(r.compute.clover.p90max)})`, `${f2(r.compute.orchid.mean)} (p90 max ${f2(r.compute.orchid.p90max)})`,
          `${mk("clover", "paley")}/${mk("orchid", "paley")}/${mk("bee", "paley")}`, `${mk("clover", "graceful")}/${mk("orchid", "graceful")}/${mk("bee", "graceful")}`]);
      }
    }
    p("Engine v3, per round (rival = other teams' patches; fingerprinting = share of a bee's pre-feed asks repeating a challenge it already asked this game; " +
      "stolen / twin = rival-orchid visits whose every pre-feed answer equals a rival's / its own clover's answer that round; non-deterministic = flowers seen giving 2+ answers to one challenge, of flowers asked; " +
      "clover code using random / time / GAME[\"ms\"]; compute = mean share of the ms budget; example markers (Paley clique chain, graceful labelling) in clover/orchid/bee code):");
    table(["arena game.round", "nectar/turn", "precision", "rival clover / orchid fed", "gap", "fingerprinting", "stolen / twin orchids", "non-det. clovers · orchids",
      "clovers using random/time/ms", "clover compute", "orchid compute", "Paley c/o/b", "graceful c/o/b"], vrow);
    if (T && C1) {
      // Paired by (game, round): treatment − mean(controls); noise = |control − control2|.
      const keys = ["nectarPerTurn", "precision", "gap", "repeatShare", "stolenShare"];
      const prow2 = [];
      const acc = Object.fromEntries(keys.map((k) => [k, { d: [], n: [] }]));
      for (const g of gens) for (let rn = 1; rn <= 5; rn++) {
        const t = byKey[`${T}|${g}|${rn}`], c = byKey[`${C1}|${g}|${rn}`], c2 = C2 && byKey[`${C2}|${g}|${rn}`];
        if (!t || !c) continue;
        const cell = (k) => {
          const cm = c2 ? (c[k] + c2[k]) / 2 : c[k], d = t[k] - cm, nz = c2 ? Math.abs(c[k] - c2[k]) : null;
          if (Number.isFinite(d)) acc[k].d.push(d);
          if (Number.isFinite(nz)) acc[k].n.push(nz);
          return `${f3(d)}${nz != null ? ` (±${f3(nz)})` : ""}`;
        };
        prow2.push([`g${g}.r${rn}`, ...keys.map(cell)]);
      }
      prow2.push(["mean Δ (mean noise)", ...keys.map((k) => `${f3(mean(acc[k].d))} (${f3(mean(acc[k].n))})`)]);
      p(`Paired by round, ${T} − mean(${C1}${C2 ? `, ${C2}` : ""}) (in brackets: |${C1} − ${C2 || "-"}|, the noise floor):`);
      table(["game.round", "nectar/turn", "precision", "rival clover−orchid gap", "fingerprinting", "stolen-face orchids"], prow2);
    }
    // Fitness spread and the model gap per game.
    const frow = [];
    for (const g of gens) for (const a of cohortArenas) {
      const ent = fit.filter((x) => x.arena_id === a.id && x.generation === g);
      if (!ent.length) continue;
      const models = await all("SELECT slug, model FROM arena.personas WHERE arena_id = $1", [a.id]);
      const by = (m) => mean(ent.filter((e) => models.find((x) => x.slug === e.slug)?.model === m).map((e) => e.fitness));
      const fs = ent.map((e) => e.fitness), mu = mean(fs);
      frow.push([`${a.id} g${g}`, f2(Math.sqrt(mean(fs.map((x) => (x - mu) ** 2)))), f2(Math.max(...fs) - Math.min(...fs)), f2(by("opus")), f2(by("sonnet")), f2(by("haiku")),
        ent.sort((x, y) => x.fitness_rank - y.fitness_rank)[0]?.slug ?? "-"]);
    }
    p("Fitness spread and model gap per game:");
    table(["arena game", "fitness σ", "range", "opus", "sonnet", "haiku", "winner"], frow);
  }
}

// ---------- leaderboards (separately)
p("## Fitness leaderboard (mean final fitness per persona; par 1.0)");
const lb = await all(`SELECT p.id, p.name, p.team_name, p.model, p.archetype, p.is_kid, p.status, p.breeder_id, count(e.*)::int AS games, avg(e.fitness) AS fit, avg(e.fitness_rank::float / nullif((SELECT count(*) FROM arena.entries x WHERE x.game_id = e.game_id),0)) AS relrank,
                             avg(e.social) AS social, count(*) FILTER (WHERE e.fitness_rank = 1)::int AS wins
                        FROM arena.personas p JOIN arena.entries e ON e.persona_id = p.id WHERE p.arena_id = ANY($1) AND e.fitness IS NOT NULL AND e.game_id IN ${CLEAN} GROUP BY p.id ORDER BY fit DESC`, [ids]);
table(["#", "persona", "team", "arena", "model", "archetype", "games", "wins", "mean fitness", "status"], lb.map((r, i) => [i + 1, r.name, r.team_name, r.id.split("/")[0], r.model, r.archetype, r.games, r.wins, f2(r.fit), r.status + (r.breeder_id ? ` (bred by ${r.breeder_id})` : "")]));
p("## Social leaderboard (mean panel score 0-10; never mixed into fitness)");
const sl = [...lb].filter((r) => r.social != null).sort((a, b) => b.social - a.social);
const parts = await all(`SELECT e.persona_id, avg((e.social_parts->>'understanding')::float) AS u, avg((e.social_parts->>'respect')::float) AS r, avg((e.social_parts->>'novelty')::float) AS n, avg((e.social_parts->>'team_up')::float) AS t,
                                sum(jsonb_array_length(coalesce(e.social_parts->'newIdeas','[]'::jsonb)))::int AS newideas
                           FROM arena.entries e WHERE e.social IS NOT NULL AND e.game_id IN ${CLEAN} GROUP BY e.persona_id`);
table(["#", "persona", "team", "arena", "model", "archetype", "games", "social", "underst.", "respect", "novelty", "team-up", "new ideas"], sl.map((r, i) => { const x = parts.find((y) => y.persona_id === r.id) || {}; return [i + 1, r.name, r.team_name, r.id.split("/")[0], r.model, r.archetype, r.games, f2(r.social), f2(x.u), f2(x.r), f2(x.n), f2(x.t), x.newideas ?? 0]; }));

// ---------- model / kid effects
p("## By model and by kid/adult");
const bym = await all(`SELECT p.model, p.is_kid, count(*)::int AS n, avg(e.fitness) AS fit, avg(e.social) AS social FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id
                        WHERE p.arena_id = ANY($1) AND e.fitness IS NOT NULL AND e.game_id IN ${CLEAN} GROUP BY p.model, p.is_kid ORDER BY p.model, p.is_kid`, [ids]);
table(["model", "kid?", "entries", "mean fitness", "mean social"], bym.map((r) => [r.model, r.is_kid ? "kid" : "adult", r.n, f2(r.fit), f2(r.social)]));

// ---------- judges
p("## Judges");
const js = await all(`SELECT j.id, j.name, j.age, j.model, count(*)::int AS n, avg(understanding) AS u, avg(respect) AS r, avg(novelty) AS nv, avg(team_up) AS t, stddev(respect) AS rs
                        FROM arena.evaluations e JOIN arena.judges j ON j.id = e.judge_id WHERE e.game_id IN ${CLEAN} GROUP BY j.id ORDER BY j.id`);
table(["judge", "age", "model", "evaluations", "understanding", "respect", "novelty", "team-up", "respect sd"], js.map((r) => [r.name, r.age, r.model, r.n, f2(r.u), f2(r.r), f2(r.nv), f2(r.t), f2(r.rs)]));
// Inter-judge agreement on respect (Spearman over shared (game, persona) pairs).
const evs = await all(`SELECT game_id, judge_id, persona_id, respect, team_up, understanding, novelty FROM arena.evaluations WHERE game_id IN ${CLEAN}`);
const pairs = [];
const jids = js.map((j) => j.id);
for (let i = 0; i < jids.length; i++) for (let k = i + 1; k < jids.length; k++) {
  const A = evs.filter((e) => e.judge_id === jids[i]);
  const xs = [], ys = [];
  for (const e of A) { const o = evs.find((x) => x.judge_id === jids[k] && x.game_id === e.game_id && x.persona_id === e.persona_id); if (o) { xs.push(e.respect + e.team_up); ys.push(o.respect + o.team_up); } }
  pairs.push([`${jids[i]}–${jids[k]}`, xs.length, f2(xs.length > 2 ? spearman(xs, ys) : null)]);
}
table(["judge pair", "shared", "ρ(respect+team-up)"], pairs);
// Obscure-CS check: advanced techniques in the final CODE (any of the three programs; team names like
// "Posterior Pollen" or "Entropy Garden" made an explanation-based check useless).
const JARGON = /betavariate|thompson|\bucb\b|upper[_ ]confidence|\bposterior\b|\bpriors?\b|bayes|bloom[_ ]?filter|kalman|hmac|softmax|sigmoid|log[_ ]?likelihood|\bentropy\b|gaussian|markov|beta\s*\(/i;
const progRows = await all(`SELECT g.id AS game_id, g.arena_id, g.generation, e.persona_id, e.team_name, e.social_parts, e.explanation, string_agg(rp.code, E'\n') AS code
                              FROM arena.entries e JOIN arena.games g ON g.id = e.game_id
                              JOIN games gg ON gg.code LIKE g.game_short_id || '%' AND gg.prefix_len <= length(g.game_short_id)
                              JOIN rooms rr ON rr.id = gg.room_id
                              JOIN arena.arenas a ON a.id = g.arena_id AND rr.code LIKE a.room_short_id || '%' AND rr.prefix_len <= length(a.room_short_id)
                              JOIN round_programs rp ON rp.game_id = gg.id AND rp.team_id = e.team_id AND rp.round_no = gg.rounds_played
                             WHERE e.social IS NOT NULL AND g.arena_id = ANY($1) AND g.contaminated IS NULL
                             GROUP BY g.id, g.arena_id, g.generation, e.persona_id, e.team_name, e.social_parts, e.explanation`, [ids]).catch((e) => { p(`(jargon query failed: ${e.message})`); return []; });
// Strip comments, string literals and team names (agents name rivals like "Posterior Pollen" in comments and keys).
const teamNamesAll = (await all("SELECT DISTINCT name FROM teams")).map((r) => r.name).filter((n) => n.length > 3).sort((a, b) => b.length - a.length);
const bare = (code) => { let c = code.replace(/#.*$/gm, "").replace(/\/\/.*$/gm, "").replace(/"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""'); for (const n of teamNamesAll) c = c.split(n).join(""); return c; };
const noNames = (t) => { let c = t || ""; for (const n of teamNamesAll) c = c.split(n).join(""); return c; };
progRows.forEach((r) => (r.code = bare(r.code) + "\n" + noNames(r.explanation)));
const jar = progRows.filter((r) => JARGON.test(r.code)), plain = progRows.filter((r) => !JARGON.test(r.code));
const sp = (rs, k) => f2(mean(rs.map((r) => r.social_parts?.[k])));
table(["final code + interview", "entries", "understanding", "respect", "novelty", "team-up"], [
  ["uses advanced statistics/CS (Beta/Thompson, UCB, Bayes/posterior, Bloom filter, entropy, softmax...)", jar.length, sp(jar, "understanding"), sp(jar, "respect"), sp(jar, "novelty"), sp(jar, "team_up")],
  ["plain", plain.length, sp(plain, "understanding"), sp(plain, "respect"), sp(plain, "novelty"), sp(plain, "team_up")],
]);
if (jar.length) p("Flagged: " + jar.map((r) => `${r.team_name} (${r.arena_id} g${r.generation}: \`${r.code.match(JARGON)[0]}\`, respect ${f2(r.social_parts?.respect)})`).join("; ") + "\n");

// ---------- ideas
p("## Idea ledger");
const ideas = await all(`SELECT i.*, (SELECT count(DISTINCT game_id)::int FROM arena.idea_sightings s WHERE s.idea_id = i.id) AS games,
                                (SELECT count(DISTINCT persona_id)::int FROM arena.idea_sightings s WHERE s.idea_id = i.id) AS teams
                           FROM arena.ideas i ORDER BY games DESC, id`);
p(`${ideas.length} distinct idea tags.`);
table(["tag", "games", "teams", "first seen", "description"], ideas.slice(0, 60).map((i) => [i.tag, i.games, i.teams, `${i.first_arena} g${i.first_game_id} ${i.first_team}`, i.description.replace(/\|/g, "/")]));
const perGame = await all(`SELECT g.arena_id, g.generation, count(DISTINCT s.idea_id) FILTER (WHERE s.new_in_game)::int AS new, count(DISTINCT s.idea_id)::int AS total
                             FROM arena.games g LEFT JOIN arena.idea_sightings s ON s.game_id = g.id WHERE g.arena_id = ANY($1) AND g.contaminated IS NULL GROUP BY g.arena_id, g.generation ORDER BY g.arena_id, g.generation`, [ids]);
table(["arena", "gen", "new ideas", "ideas seen"], perGame.map((r) => [r.arena_id, r.generation, r.new, r.total]));

// ---------- breeders
p("## Breeders");
const bs = await breederScores();
table(["breeder", "model", "spawn", "retired", "spawn-games", "fitness pct", "social pct", "score"], Object.values(bs).map((b) => [b.name, b.model, b.spawns, b.retired, b.games, f2(b.fitPct), f2(b.socPct), f3(b.score)]));

// ---------- collapse summary
p("## Collapse events (round-level counts by arena)");
const ce = await all(`SELECT arena_id, mode, count(*)::int AS n, avg(severity) AS sev FROM arena.collapse_events WHERE arena_id = ANY($1) AND game_id IN ${CLEAN} GROUP BY arena_id, mode ORDER BY arena_id, n DESC`, [ids]);
table(["arena", "mode", "count", "mean severity"], ce.map((r) => [r.arena_id, r.mode, r.n, f2(r.sev)]));

console.log(out.join("\n"));
await pool.end();
