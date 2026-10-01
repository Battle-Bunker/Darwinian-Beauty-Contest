#!/usr/bin/env node
// Summarise everything in the arena schema as Markdown (spend, leaderboards, metrics, collapses, judges, ideas, breeders).
//   node arena/analyze.js [--arenas a,b] > arena/runs/analysis.md
import { all, pool } from "./lib/db.js";
import { breederScores } from "./lib/population.js";
import { spearman } from "./lib/metrics.js";

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
    rows.push([g.generation, `[${g.game_short_id}](${WEB}${g.game_url})`, ent[0] ? `${ent[0].team_name} (${ent[0].model}) ${f2(ent[0].fitness)}` : "-",
      f2(m?.fitnessStd), f2(m?.topRatio), f2(m?.avg?.precision), f2(m?.avg?.feedRate), f2(m?.avg?.feedsPerBee), f2(m?.avg?.orchidFeedShare), f2(m?.avg?.orchidSelfMimicry),
      f2(m?.avg?.topChallengeShare), f2(m?.avg?.cumRankTau), m ? `${f2(m.changeUse.clover)}/${f2(m.changeUse.orchid)}/${f2(m.changeUse.bee)}` : "-",
      m ? `${f2(m.lastSimilarity.clover)}/${f2(m.lastSimilarity.orchid)}/${f2(m.lastSimilarity.bee)}` : "-",
      `${newIdeas.length}/${allTags.length}`, f2(corr), (m?.collapses || []).map((c) => c.mode).join(", ") || "-"]);
  }
  table(["gen", "game", "winner", "fit std", "top/2nd", "precision", "feed rate", "feeds/bee", "orchid feed share", "orchid self-mimicry", "top challenge share", "cum rank tau", "change use c/o/b", "similarity c/o/b", "new/all ideas", "ρ(fit,social)", "game collapse flags"], rows);
  // Round-level detail
  p(`<details><summary>Round metrics</summary>\n`);
  const rrows = [];
  for (const g of games) {
    const rms = await all("SELECT * FROM arena.round_metrics WHERE game_id = $1 ORDER BY round_no", [g.id]);
    const cev = await all("SELECT round_no, mode FROM arena.collapse_events WHERE game_id = $1 AND round_no IS NOT NULL", [g.id]);
    for (const r of rms) {
      const m = r.metrics;
      rrows.push([`${g.generation}.${r.round_no}`, m.feeds, f2(m.precision), f2(m.feedRate), m.beesNotFeeding, f2(m.orchidFeedShare), f2(m.orchidSelfMimicry), f2(m.orchidCrossMimicry), f2(m.cloverAgreement), f2(m.topChallengeShare), m.distinctFirstChallenges, f2(m.asksPerVisit), f2(m.rankTau), f2(m.fitnessStd), `${m.change.clover.total}/${m.change.orchid.total}/${m.change.bee.total}`, f2(m.errorRate), m.timeouts, f2(m.selfFeedShare), cev.filter((c) => c.round_no === r.round_no).map((c) => c.mode).join(", ")]);
    }
  }
  table(["gen.round", "feeds", "precision", "feed rate", "bees not feeding", "orchid feed share", "orchid self-mimic", "orchid cross-mimic", "clover agreement", "top challenge share", "distinct 1st challenges", "asks/visit", "rank tau", "fit std", "edits c/o/b", "error rate", "timeouts", "self-feed", "flags"], rrows);
  p(`</details>\n`);
  // Winners, social tops and new ideas per generation; dominance across generations.
  p("Per generation: fitness winner, social winner, ideas new to the ledger (by team):");
  const winners = [];
  for (const g of games) {
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
  const ev = await all(`SELECT e.*, p.name, p.team_name, p.model, p.archetype FROM arena.population_events e JOIN arena.personas p ON p.id = e.persona_id WHERE e.arena_id = $1 AND e.event IN ('retired','born') AND e.generation > 1 ORDER BY e.generation, e.id`, [a.id]);
  if (ev.length) {
    p("Population changes:");
    for (const e of ev) p(`- gen ${e.generation}: ${e.event} ${e.name} / "${e.team_name}" (${e.model}, ${e.archetype}): ${e.reason}${e.details?.rationale ? ` Rationale: ${e.details.rationale}` : ""}`);
    p();
  }
}

// ---------- leaderboards (separately)
p("## Fitness leaderboard (mean final fitness per persona; par 1.0)");
const lb = await all(`SELECT p.id, p.name, p.team_name, p.model, p.archetype, p.is_kid, p.status, p.breeder_id, count(e.*)::int AS games, avg(e.fitness) AS fit, avg(e.fitness_rank::float / nullif((SELECT count(*) FROM arena.entries x WHERE x.game_id = e.game_id),0)) AS relrank,
                             avg(e.social) AS social, count(*) FILTER (WHERE e.fitness_rank = 1)::int AS wins
                        FROM arena.personas p JOIN arena.entries e ON e.persona_id = p.id WHERE p.arena_id = ANY($1) AND e.fitness IS NOT NULL GROUP BY p.id ORDER BY fit DESC`, [ids]);
table(["#", "persona", "team", "arena", "model", "archetype", "games", "wins", "mean fitness", "status"], lb.map((r, i) => [i + 1, r.name, r.team_name, r.id.split("/")[0], r.model, r.archetype, r.games, r.wins, f2(r.fit), r.status + (r.breeder_id ? ` (bred by ${r.breeder_id})` : "")]));
p("## Social leaderboard (mean panel score 0-10; never mixed into fitness)");
const sl = [...lb].filter((r) => r.social != null).sort((a, b) => b.social - a.social);
const parts = await all(`SELECT e.persona_id, avg((e.social_parts->>'understanding')::float) AS u, avg((e.social_parts->>'respect')::float) AS r, avg((e.social_parts->>'novelty')::float) AS n, avg((e.social_parts->>'team_up')::float) AS t,
                                sum(jsonb_array_length(coalesce(e.social_parts->'newIdeas','[]'::jsonb)))::int AS newideas
                           FROM arena.entries e WHERE e.social IS NOT NULL GROUP BY e.persona_id`);
table(["#", "persona", "team", "arena", "model", "archetype", "games", "social", "underst.", "respect", "novelty", "team-up", "new ideas"], sl.map((r, i) => { const x = parts.find((y) => y.persona_id === r.id) || {}; return [i + 1, r.name, r.team_name, r.id.split("/")[0], r.model, r.archetype, r.games, f2(r.social), f2(x.u), f2(x.r), f2(x.n), f2(x.t), x.newideas ?? 0]; }));

// ---------- model / kid effects
p("## By model and by kid/adult");
const bym = await all(`SELECT p.model, p.is_kid, count(*)::int AS n, avg(e.fitness) AS fit, avg(e.social) AS social FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id
                        WHERE p.arena_id = ANY($1) AND e.fitness IS NOT NULL GROUP BY p.model, p.is_kid ORDER BY p.model, p.is_kid`, [ids]);
table(["model", "kid?", "entries", "mean fitness", "mean social"], bym.map((r) => [r.model, r.is_kid ? "kid" : "adult", r.n, f2(r.fit), f2(r.social)]));

// ---------- judges
p("## Judges");
const js = await all(`SELECT j.id, j.name, j.age, j.model, count(*)::int AS n, avg(understanding) AS u, avg(respect) AS r, avg(novelty) AS nv, avg(team_up) AS t, stddev(respect) AS rs
                        FROM arena.evaluations e JOIN arena.judges j ON j.id = e.judge_id GROUP BY j.id ORDER BY j.id`);
table(["judge", "age", "model", "evaluations", "understanding", "respect", "novelty", "team-up", "respect sd"], js.map((r) => [r.name, r.age, r.model, r.n, f2(r.u), f2(r.r), f2(r.nv), f2(r.t), f2(r.rs)]));
// Inter-judge agreement on respect (Spearman over shared (game, persona) pairs).
const evs = await all("SELECT game_id, judge_id, persona_id, respect, team_up, understanding, novelty FROM arena.evaluations");
const pairs = [];
const jids = js.map((j) => j.id);
for (let i = 0; i < jids.length; i++) for (let k = i + 1; k < jids.length; k++) {
  const A = evs.filter((e) => e.judge_id === jids[i]);
  const xs = [], ys = [];
  for (const e of A) { const o = evs.find((x) => x.judge_id === jids[k] && x.game_id === e.game_id && x.persona_id === e.persona_id); if (o) { xs.push(e.respect + e.team_up); ys.push(o.respect + o.team_up); } }
  pairs.push([`${jids[i]}–${jids[k]}`, xs.length, f2(xs.length > 2 ? spearman(xs, ys) : null)]);
}
table(["judge pair", "shared", "ρ(respect+team-up)"], pairs);
// Obscure-CS check: code containing advanced jargon vs respect.
const JARGON = /thompson|beta\s*\(|betavariate|conjugate|posterior|bayes|bloom|kalman|hmac|lsh|locality.sensitive|ucb|upper confidence|entropy|log.?likelihood|sigmoid|softmax|markov|gaussian|laplace/i;
const progRows = await all(`SELECT g.id AS game_id, e.persona_id, e.explanation, e.social_parts, rp.code
                              FROM arena.entries e JOIN arena.games g ON g.id = e.game_id
                              JOIN games gg ON gg.room_id IS NOT NULL AND gg.code LIKE g.game_short_id || '%' AND gg.prefix_len <= length(g.game_short_id)
                              JOIN rooms rr ON rr.id = gg.room_id
                              JOIN arena.arenas a ON a.id = g.arena_id AND rr.code LIKE a.room_short_id || '%' AND rr.prefix_len <= length(a.room_short_id)
                              JOIN round_programs rp ON rp.game_id = gg.id AND rp.team_id = e.team_id AND rp.round_no = gg.rounds_played AND rp.kind = 'bee'
                             WHERE e.social IS NOT NULL AND g.arena_id = ANY($1)`, [ids]).catch((e) => { p(`(jargon query failed: ${e.message})`); return []; });
const jar = progRows.filter((r) => JARGON.test(r.code + " " + (r.explanation || ""))), plain = progRows.filter((r) => !JARGON.test(r.code + " " + (r.explanation || "")));
table(["bee code / explanation", "entries", "mean respect", "mean understanding", "mean team-up"], [
  ["uses advanced jargon (Thompson, Beta, Bayes, Bloom, UCB, entropy...)", jar.length, f2(mean(jar.map((r) => r.social_parts?.respect))), f2(mean(jar.map((r) => r.social_parts?.understanding))), f2(mean(jar.map((r) => r.social_parts?.team_up)))],
  ["plain", plain.length, f2(mean(plain.map((r) => r.social_parts?.respect))), f2(mean(plain.map((r) => r.social_parts?.understanding))), f2(mean(plain.map((r) => r.social_parts?.team_up)))],
]);

// ---------- ideas
p("## Idea ledger");
const ideas = await all(`SELECT i.*, (SELECT count(DISTINCT game_id)::int FROM arena.idea_sightings s WHERE s.idea_id = i.id) AS games,
                                (SELECT count(DISTINCT persona_id)::int FROM arena.idea_sightings s WHERE s.idea_id = i.id) AS teams
                           FROM arena.ideas i ORDER BY games DESC, id`);
p(`${ideas.length} distinct idea tags.`);
table(["tag", "games", "teams", "first seen", "description"], ideas.slice(0, 60).map((i) => [i.tag, i.games, i.teams, `${i.first_arena} g${i.first_game_id} ${i.first_team}`, i.description.replace(/\|/g, "/")]));
const perGame = await all(`SELECT g.arena_id, g.generation, count(DISTINCT s.idea_id) FILTER (WHERE s.new_in_game)::int AS new, count(DISTINCT s.idea_id)::int AS total
                             FROM arena.games g LEFT JOIN arena.idea_sightings s ON s.game_id = g.id WHERE g.arena_id = ANY($1) GROUP BY g.arena_id, g.generation ORDER BY g.arena_id, g.generation`, [ids]);
table(["arena", "gen", "new ideas", "ideas seen"], perGame.map((r) => [r.arena_id, r.generation, r.new, r.total]));

// ---------- breeders
p("## Breeders");
const bs = await breederScores();
table(["breeder", "model", "spawn", "retired", "spawn-games", "fitness pct", "social pct", "score"], Object.values(bs).map((b) => [b.name, b.model, b.spawns, b.retired, b.games, f2(b.fitPct), f2(b.socPct), f3(b.score)]));

// ---------- collapse summary
p("## Collapse events (round-level counts by arena)");
const ce = await all(`SELECT arena_id, mode, count(*)::int AS n, avg(severity) AS sev FROM arena.collapse_events WHERE arena_id = ANY($1) GROUP BY arena_id, mode ORDER BY arena_id, n DESC`, [ids]);
table(["arena", "mode", "count", "mean severity"], ce.map((r) => [r.arena_id, r.mode, r.n, f2(r.sev)]));

console.log(out.join("\n"));
await pool.end();
