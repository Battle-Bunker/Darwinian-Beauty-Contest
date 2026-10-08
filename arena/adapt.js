#!/usr/bin/env node
// The adapt experiment's analysis (EXPERIMENTS.adapt): do veterans of the cheap-signalling arenas adapt when honest,
// costly signallers (always 50%) and defectors (always 0%, imitating the most-fed flowers) share their garden?
//   node arena/adapt.js [--arena mesa-a] [--classify] > arena/runs/analysis-adapt.md
// --classify labels unlabelled program versions with the haiku classifier (cached; spends a little); without it, cached
// labels and keyword evidence. Reads the games' stored metrics and their turns (history queries); writes nothing.
//
//   per veteran, per game   flower mechanism and level, CPU share, median percent, whether it copied an honest or a
//                           defecting flower (imitation of answers, or leaked code through grains), its bee's feed rate at
//                           honest / defector / other veterans' flowers and at rich / poor R, fitness and rank
//   honest specialists      conformance (answers at 50%), costly honesty (CPU ~ R, visible work ~ R), feeds received
//   defectors               conformance (answers at 0%), imitation latency, feeds from rival bees before and after
//                           they were told apart, feed rate at them over the game
//   adaptation summary      per veteran over the games: what changed
import { Api, gamePath } from "./lib/api.js";
import { all, one, pool } from "./lib/db.js";
import { callModel } from "./lib/llm.js";
import { classifyPrograms, levelOf } from "./lib/mechanisms.js";
import { queryAll } from "./lib/metrics.js";
import { honestyOf } from "./lib/wealth.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));
const arenaId = args.arena || "mesa-a";
const out = [];
const p = (s = "") => out.push(s);
const table = (h, rows) => { p(`| ${h.join(" | ")} |`); p(`|${h.map(() => "---").join("|")}|`); for (const r of rows) p(`| ${r.map((x) => (x == null ? "-" : String(x).replace(/\|/g, "/"))).join(" | ")} |`); p(); };
const pct = (x) => (x == null || Number.isNaN(x) ? "-" : `${Math.round(100 * x)}%`);
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(2));
const mmss = (ms) => { if (ms == null) return "-"; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const rate = (ts) => (ts.length ? ts.filter((t) => t.fed).length / ts.length : null);
// costly / cheap (lib/wealth.js), or effort that follows R with no visible work to show it, or neither.
const honesty = (w) => (!w || !(w.turns >= 30) ? "-" : honestyOf(w) ?? ((w.effort ?? 0) >= 0.3 ? "costly, not visible" : "none"));

async function main() {
  const arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [arenaId]);
  if (!arena) throw new Error(`no arena ${arenaId}`);
  const roles = arena.settings.roles || {}, seeds = arena.settings.seeds || {};
  const personas = await all("SELECT * FROM arena.personas WHERE arena_id = $1", [arenaId]);
  const roleOf = (slug) => roles[slug]?.role || (seeds[slug] ? "veteran" : "other");
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND metrics IS NOT NULL ORDER BY generation", [arenaId]);
  p(`# Adapt: ${arenaId}`);
  p();
  p(`${personas.length} teams: ${["veteran", "honest", "defector"].map((r) => `${personas.filter((x) => roleOf(x.slug) === r).length} ${r}`).join(", ")}. ` +
    `${games.length} game(s). Veterans: ${personas.filter((x) => seeds[x.slug]).map((x) => `${x.name} (from ${seeds[x.slug]}, ${x.model})`).join(", ")}.`);
  p();
  const perVet = new Map(); // slug -> [{ gen, ... }]
  for (const g of games) {
    const gp = gamePath(arena.room_short_id, g.game_short_id);
    const [teams, turns, versions] = await Promise.all([queryAll(Api, gp, { from: "teams" }), queryAll(Api, gp, { from: "turns" }), queryAll(Api, gp, { from: "versions" })]);
    const ents = await all("SELECT e.*, p.slug, p.name FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1", [g.id]);
    const byIndex = Object.fromEntries(teams.map((t) => [t.index, t.id]));
    const slugOf = Object.fromEntries(ents.map((e) => [e.team_id, e.slug]));
    const nameOf = Object.fromEntries(ents.map((e) => [e.team_id, e.team_name]));
    const role = (teamId) => roleOf(slugOf[teamId]);
    const m = g.metrics;
    // Labels of every version (classifier cache, else keyword evidence).
    const vs = versions.filter((v) => v.code).map((v) => ({ ...v, teamId: byIndex[v.team] }));
    const label = await classifyPrograms(vs, { callModel: args.classify ? callModel : null, model: "haiku", ctx: { arenaId: `analysis:${arenaId}`, gameId: g.id } });
    const lastOf = (teamId, kind) => vs.filter((v) => v.teamId === teamId && v.kind === kind).sort((a, b) => b.version - a.version)[0];
    const flowerLabel = (teamId) => { const v = lastOf(teamId, "flower"); if (!v) return null; const l = label(v); return { mechanism: l.mechanism ?? l.kw.mechanism, families: l.families ?? l.kw.families ?? [], tags: l.tags ?? l.kw.tags ?? [], signal: l.signal ?? l.kw.signal, level: levelOf({ mechanism: l.mechanism ?? l.kw.mechanism, tags: l.tags ?? l.kw.tags, families: l.families ?? l.kw.families }) }; };
    const T = turns.map((t) => ({ bee: byIndex[t.bee], flower: byIndex[t.flower], fed: t.fed, R: t.budgetMs, atMs: t.atMs, percent: t.percent }));
    const Rs = T.map((t) => t.R).filter((x) => x != null).sort((a, b) => a - b);
    const lo = Rs[Math.floor(Rs.length / 3)], hi = Rs[Math.floor((2 * Rs.length) / 3)];
    const final = Object.fromEntries((m.final || []).map((f) => [f.teamId, f]));
    const rank = [...(m.final || [])].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0)).map((f) => f.teamId);
    const copies = m.ecology?.imitation?.copies || [], uses = m.grains?.uses || [];
    const teamIdByName = Object.fromEntries(ents.map((e) => [e.team_name, e.team_id]));

    p(`## Game ${g.generation}`);
    p();
    // Veterans.
    const vrows = [];
    for (const e of ents.filter((x) => role(x.team_id) === "veteran")) {
      const id = e.team_id, t = m.teams?.[id], fl = flowerLabel(id);
      const mine = T.filter((x) => x.bee === id && x.flower !== id);
      const at = (r) => mine.filter((x) => role(x.flower) === r);
      const copiedFrom = (r) => [...copies.filter((c) => teamIdByName[c.copier] === id && role(teamIdByName[c.model]) === r).map((c) => `${c.model} (answers)`),
        ...uses.filter((u) => u.teamId === id && role(u.fromId) === r).map((u) => `${u.from} (${u.type})`)];
      const row = { gen: g.generation, mechanism: fl?.mechanism ?? "-", level: fl?.level ?? null, signal: fl?.signal ?? null, compute: t?.flower?.computeShare ?? null,
        percent: t?.flower?.percent?.p50 ?? null, copiedHonest: copiedFrom("honest"), copiedDefector: copiedFrom("defector"),
        feedHonest: rate(at("honest")), feedDefector: rate(at("defector")), feedVeteran: rate(at("veteran")),
        feedPoor: rate(mine.filter((x) => x.R != null && x.R <= lo)), feedRich: rate(mine.filter((x) => x.R != null && x.R > hi)),
        fitness: final[id]?.fitness ?? null, rank: rank.indexOf(id) + 1 || null, n: rank.length };
      if (!perVet.has(e.slug)) perVet.set(e.slug, { name: e.name, team: e.team_name, rows: [] });
      perVet.get(e.slug).rows.push(row);
      vrows.push([e.team_name, `${row.mechanism}${row.signal ? ` (${row.signal})` : ""}`, row.level, pct(row.compute), f2(row.percent),
        row.copiedHonest.join(", ") || "-", row.copiedDefector.join(", ") || "-", `${pct(row.feedHonest)} / ${pct(row.feedDefector)} / ${pct(row.feedVeteran)}`,
        `${pct(row.feedPoor)} / ${pct(row.feedRich)}`, `${f2(row.fitness)} (#${row.rank} of ${row.n})`]);
    }
    p("Veterans (their final versions this game; bee feed rates over its turns at other teams' flowers):");
    table(["veteran", "flower mechanism (signal)", "level", "CPU share", "median percent", "copied an honest flower", "copied a defector",
      "its bee's feed rate at honest / defector / veteran flowers", "at poor / rich R", "fitness (rank)"], vrows);
    // Honest specialists.
    const W = m.wealth?.species || [];
    p("Honest specialists (conformance: answers at 50%; honesty: costly when effort and visible work both follow R, cheap when only the work does):");
    table(["team", "conformance", "median percent", "CPU share", "effort ~ R", "work ~ R", "honesty", "feeds from rival bees", "rival feed rate", "fitness (rank)"],
      ents.filter((x) => role(x.team_id) === "honest").map((e) => {
        const id = e.team_id, t = m.teams?.[id], w = W.find((s) => s.teamId === id), rv = T.filter((x) => x.flower === id && x.bee !== id);
        const work = [w?.bytes, w?.nodes].filter((x) => x != null);
        return [e.team_name, pct(m.roles?.[id]?.conform ?? t?.flower?.percentAt50), f2(t?.flower?.percent?.p50), pct(t?.flower?.computeShare), f2(w?.effort), f2(work.length ? Math.max(...work) : null),
          honesty(w), rv.filter((x) => x.fed).length, pct(rate(rv)), `${f2(final[id]?.fitness)} (#${rank.indexOf(id) + 1})`];
      }));
    // Defectors.
    p("Defectors (conformance: answers at 0%; imitation: their versions' first close copies of another species' answers; detection: rival bees' feed rate falling below half the model's):");
    table(["team", "conformance", "median percent", "copies (median lag)", "rival feeds before / after being told apart", "rival feed rate, first / last third of the game", "fitness (rank)"],
      ents.filter((x) => role(x.team_id) === "defector").map((e) => {
        const id = e.team_id, t = m.teams?.[id], mine = copies.filter((c) => teamIdByName[c.copier] === id);
        const rv = T.filter((x) => x.flower === id && x.bee !== id), end = Math.max(...T.map((x) => x.atMs), 1);
        const before = mine.reduce((a, c) => a + (c.rivalFeedsBeforeDetection || 0), 0);
        const detectedAt = mine.filter((c) => c.detected).map((c) => c.atMs + (c.detectedAfterMs || 0));
        const after = detectedAt.length ? rv.filter((x) => x.fed && x.atMs > Math.min(...detectedAt)).length : null;
        const lags = mine.map((c) => c.lagMs).sort((a, b) => a - b);
        return [e.team_name, pct(m.roles?.[id]?.conform ?? t?.flower?.percentAt0), f2(t?.flower?.percent?.p50), `${mine.length} (${lags.length ? mmss(lags[Math.floor(lags.length / 2)]) : "-"})`,
          `${before} / ${after ?? "never told apart"}`, `${pct(rate(rv.filter((x) => x.atMs < end / 3)))} / ${pct(rate(rv.filter((x) => x.atMs >= (2 * end) / 3)))}`,
          `${f2(final[id]?.fitness)} (#${rank.indexOf(id) + 1})`];
      }));
    // Everyone's bees: where do they feed?
    const groups = ["veteran", "honest", "defector"];
    p("All bees by role (feed rate at flowers of each role, rival flowers only):");
    table(["bees of", ...groups.map((r) => `at ${r} flowers`)], groups.map((b) => [b, ...groups.map((f) => pct(rate(T.filter((x) => role(x.bee) === b && role(x.flower) === f && x.bee !== x.flower))))]));
  }

  // Adaptation summary.
  p("## Adaptation summary (per veteran, game by game)");
  p();
  table(["veteran", "mechanism (level)", "CPU share", "median percent", "copied honest / defector", "bee: feed rate at honest / defector flowers", "bee: poor / rich R", "rank"],
    [...perVet.values()].map((v) => [`${v.name} (${v.team})`, v.rows.map((r) => `${r.mechanism} (${r.level ?? "-"})`).join(" → "), v.rows.map((r) => pct(r.compute)).join(" → "),
      v.rows.map((r) => f2(r.percent)).join(" → "), v.rows.map((r) => `${r.copiedHonest.length}/${r.copiedDefector.length}`).join(" → "),
      v.rows.map((r) => `${pct(r.feedHonest)}/${pct(r.feedDefector)}`).join(" → "), v.rows.map((r) => `${pct(r.feedPoor)}/${pct(r.feedRich)}`).join(" → "),
      v.rows.map((r) => `#${r.rank}`).join(" → ")]));
  const adapted = [...perVet.values()].map((v) => {
    const a = v.rows[0], z = v.rows[v.rows.length - 1];
    if (!a || !z || v.rows.length < 2) return null;
    const signs = [];
    if ((z.level ?? 0) > (a.level ?? 0)) signs.push(`flower level ${a.level ?? 0} → ${z.level}`);
    if ((z.compute ?? 0) > 2 * (a.compute ?? 0) + 0.02) signs.push(`CPU share ${pct(a.compute)} → ${pct(z.compute)}`);
    if (z.feedDefector != null && a.feedDefector != null && z.feedDefector < a.feedDefector - 0.15) signs.push(`bee feeds less at defectors (${pct(a.feedDefector)} → ${pct(z.feedDefector)})`);
    if (z.feedHonest != null && z.feedDefector != null && z.feedHonest - z.feedDefector >= 0.15) signs.push(`bee prefers honest flowers (${pct(z.feedHonest)} vs ${pct(z.feedDefector)})`);
    if (z.feedRich != null && z.feedPoor != null && z.feedRich - z.feedPoor >= 0.1) signs.push(`bee prefers rich instances (${pct(z.feedPoor)} → ${pct(z.feedRich)})`);
    if (v.rows.some((r) => r.copiedHonest.length)) signs.push("copied an honest flower");
    return [`${v.name}`, signs.join("; ") || "no adaptation seen"];
  }).filter(Boolean);
  if (adapted.length) table(["veteran", "signs of adaptation (first game → last)"], adapted);
  console.log(out.join("\n"));
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
