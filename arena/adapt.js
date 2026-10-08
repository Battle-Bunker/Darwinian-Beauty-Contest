#!/usr/bin/env node
// The adapt experiments' analysis (EXPERIMENTS.adapt and EXPERIMENTS["adapt-hi"]): do veterans of the cheap-signalling
// arenas adapt when honest, costly signallers (always 50%) and defectors (always 0%, imitating the most-fed flowers) share
// their garden?
//   node arena/adapt.js [--arena mesa-a] [--compare <arena>] [--classify] > arena/runs/analysis-adapt.md
//   node arena/adapt.js --arena mesa-b > arena/runs/analysis-adapt-hi.md     (adapt-hi, side by side with mesa-a)
// --compare: a second arena summarised next to the first (default mesa-a when --arena is another one; --compare none:
// no comparison). --classify labels unlabelled program versions with the haiku classifier (cached; spends a little);
// without it, cached labels and keyword evidence. Reads the games' stored metrics, their turns (history queries) and the
// arenas' LLM ledger; writes nothing.
//
//   per veteran, per game   flower mechanism and level, CPU share, median percent, whether it copied an honest or a
//                           defecting flower (imitation of answers, or leaked code through grains), its bee's feed rate at
//                           honest / defector / other veterans' flowers and at rich / poor R, fitness and rank
//   honest specialists      conformance (answers at 50%; under adapt-hi's contract also CPU at 0.6 × R: the distribution
//                           of CPU ms ÷ R and the share within ±5 points of 60%), costly honesty (CPU ~ R, visible work
//                           ~ R), feeds received; each change of an honest flower, timed against the defectors' imitations
//                           of it that came before (did it move only to escape imitators, and did that work?)
//   defectors               conformance (answers at 0%), imitation latency, feeds from rival bees before and after
//                           they were told apart, feed rate at them over the game
//   adaptation summary      per veteran over the games: what changed
//   side by side            the two arenas game by game: the agents' effort (sessions, turns, output tokens, spend) and
//                           the headline measures of each role
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
const compareId = args.compare === "none" ? null : args.compare || (arenaId !== "mesa-a" ? "mesa-a" : null);
const out = [];
let quiet = false; // a compared arena is summarised, not printed
const p = (s = "") => { if (!quiet) out.push(s); };
const table = (h, rows) => { p(`| ${h.join(" | ")} |`); p(`|${h.map(() => "---").join("|")}|`); for (const r of rows) p(`| ${r.map((x) => (x == null ? "-" : String(x).replace(/\|/g, "/"))).join(" | ")} |`); p(); };
const pct = (x) => (x == null || Number.isNaN(x) ? "-" : `${Math.round(100 * x)}%`);
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(2));
const n0 = (x) => (x == null || Number.isNaN(x) ? "-" : Math.round(x).toLocaleString("en-US"));
const mmss = (ms) => { if (ms == null) return "-"; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const rate = (ts) => (ts.length ? ts.filter((t) => t.fed).length / ts.length : null);
const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const quantile = (xs, q) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; };
// costly / cheap (lib/wealth.js), or effort that follows R with no visible work to show it, or neither.
const honesty = (w) => (!w || !(w.turns >= 30) ? "-" : honestyOf(w) ?? ((w.effort ?? 0) >= 0.3 ? "costly, not visible" : "none"));
const WINDOW_MS = 60_000; // before / after an honest flower's change

/** One arena's analysis: printed (unless quiet), and its per-game summary for the side-by-side. */
async function analyse(id) {
  const arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
  if (!arena) throw new Error(`no arena ${id}`);
  const roles = arena.settings.roles || {}, seeds = arena.settings.seeds || {};
  const personas = await all("SELECT * FROM arena.personas WHERE arena_id = $1", [id]);
  const roleOf = (slug) => roles[slug]?.role || (seeds[slug] ? "veteran" : "other");
  const r60 = (slug) => roles[slug]?.brief === "r60";
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND metrics IS NOT NULL ORDER BY generation", [id]);
  p(`# Adapt: ${id}${arena.settings.experiment?.name ? ` (${arena.settings.experiment.name})` : ""}`);
  p();
  p(`${personas.length} teams: ${["veteran", "honest", "defector"].map((r) => `${personas.filter((x) => roleOf(x.slug) === r).length} ${r}`).join(", ")}. ` +
    `${games.length} game(s). Veterans: ${personas.filter((x) => seeds[x.slug]).map((x) => `${x.name} (from ${seeds[x.slug]}, ${x.model})`).join(", ")}.`);
  p();
  const perVet = new Map(); // slug -> [{ gen, ... }]
  const summary = [];
  const prevFinal = new Map(); // honest slug -> its final flower code in the previous game
  for (const g of games) {
    const gp = gamePath(arena.room_short_id, g.game_short_id);
    const [teams, turns, versions] = await Promise.all([queryAll(Api, gp, { from: "teams" }), queryAll(Api, gp, { from: "turns" }), queryAll(Api, gp, { from: "versions" })]);
    const ents = await all("SELECT e.*, p.slug, p.name FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1", [g.id]);
    const byIndex = Object.fromEntries(teams.map((t) => [t.index, t.id]));
    const slugOf = Object.fromEntries(ents.map((e) => [e.team_id, e.slug]));
    const role = (teamId) => roleOf(slugOf[teamId]);
    const m = g.metrics;
    // Labels of every version (classifier cache, else keyword evidence).
    const vs = versions.filter((v) => v.code).map((v) => ({ ...v, teamId: byIndex[v.team] }));
    const label = await classifyPrograms(vs, { callModel: args.classify ? callModel : null, model: "haiku", ctx: { arenaId: `analysis:${id}`, gameId: g.id } });
    const lastOf = (teamId, kind) => vs.filter((v) => v.teamId === teamId && v.kind === kind).sort((a, b) => b.version - a.version)[0];
    const flowerLabel = (teamId) => { const v = lastOf(teamId, "flower"); if (!v) return null; const l = label(v); return { mechanism: l.mechanism ?? l.kw.mechanism, families: l.families ?? l.kw.families ?? [], tags: l.tags ?? l.kw.tags ?? [], signal: l.signal ?? l.kw.signal, level: levelOf({ mechanism: l.mechanism ?? l.kw.mechanism, tags: l.tags ?? l.kw.tags, families: l.families ?? l.kw.families }) }; };
    const T = turns.map((t) => ({ bee: byIndex[t.bee], flower: byIndex[t.flower], fed: t.fed, R: t.budgetMs, atMs: t.atMs, percent: t.percent, ms: t.ms,
      answered: t.response != null || t.responseBytes != null }));
    const Rs = T.map((t) => t.R).filter((x) => x != null).sort((a, b) => a - b);
    const lo = Rs[Math.floor(Rs.length / 3)], hi = Rs[Math.floor((2 * Rs.length) / 3)];
    const end = Math.max(...T.map((x) => x.atMs), 1);
    const final = Object.fromEntries((m.final || []).map((f) => [f.teamId, f]));
    const rank = [...(m.final || [])].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0)).map((f) => f.teamId);
    const copies = m.ecology?.imitation?.copies || [], uses = m.grains?.uses || [];
    const teamIdByName = Object.fromEntries(ents.map((e) => [e.team_name, e.team_id]));
    const rivalAt = (teamId, from, to) => rate(T.filter((x) => x.flower === teamId && x.bee !== teamId && x.atMs >= from && x.atMs < to));
    const S = { gen: g.generation, vet: [], honest: [], defector: [] };

    p(`## Game ${g.generation}`);
    p();
    // Veterans.
    const vrows = [];
    for (const e of ents.filter((x) => role(x.team_id) === "veteran")) {
      const tid = e.team_id, t = m.teams?.[tid], fl = flowerLabel(tid);
      const mine = T.filter((x) => x.bee === tid && x.flower !== tid);
      const at = (r) => mine.filter((x) => role(x.flower) === r);
      const copiedFrom = (r) => [...copies.filter((c) => teamIdByName[c.copier] === tid && role(teamIdByName[c.model]) === r).map((c) => `${c.model} (answers)`),
        ...uses.filter((u) => u.teamId === tid && role(u.fromId) === r).map((u) => `${u.from} (${u.type})`)];
      const row = { gen: g.generation, mechanism: fl?.mechanism ?? "-", level: fl?.level ?? null, signal: fl?.signal ?? null, compute: t?.flower?.computeShare ?? null,
        percent: t?.flower?.percent?.p50 ?? null, copiedHonest: copiedFrom("honest"), copiedDefector: copiedFrom("defector"),
        feedHonest: rate(at("honest")), feedDefector: rate(at("defector")), feedVeteran: rate(at("veteran")),
        feedPoor: rate(mine.filter((x) => x.R != null && x.R <= lo)), feedRich: rate(mine.filter((x) => x.R != null && x.R > hi)),
        fitness: final[tid]?.fitness ?? null, rank: rank.indexOf(tid) + 1 || null, n: rank.length };
      if (!perVet.has(e.slug)) perVet.set(e.slug, { name: e.name, team: e.team_name, rows: [] });
      perVet.get(e.slug).rows.push(row);
      S.vet.push(row);
      vrows.push([e.team_name, `${row.mechanism}${row.signal ? ` (${row.signal})` : ""}`, row.level, pct(row.compute), f2(row.percent),
        row.copiedHonest.join(", ") || "-", row.copiedDefector.join(", ") || "-", `${pct(row.feedHonest)} / ${pct(row.feedDefector)} / ${pct(row.feedVeteran)}`,
        `${pct(row.feedPoor)} / ${pct(row.feedRich)}`, `${f2(row.fitness)} (#${row.rank} of ${row.n})`]);
    }
    p("Veterans (their final versions this game; bee feed rates over its turns at other teams' flowers):");
    table(["veteran", "flower mechanism (signal)", "level", "CPU share", "median percent", "copied an honest flower", "copied a defector",
      "its bee's feed rate at honest / defector / veteran flowers", "at poor / rich R", "fitness (rank)"], vrows);

    // Honest specialists.
    const W = m.wealth?.species || [];
    const honestEnts = ents.filter((x) => role(x.team_id) === "honest");
    const contract = honestEnts.some((e) => r60(e.slug));
    p(`Honest specialists (conformance: answers at 50%${contract ? "; CPU at 0.6 × R, over answered calls: CPU ms ÷ R and the share within ±5 points of 60%" : ""}; ` +
      `honesty: costly when effort and visible work both follow R, cheap when only the work does):`);
    table(["team", "conformance (percent 50)", ...(contract ? ["CPU ÷ R p10 / p50 / p90", "within 55–65%", "no response"] : []), "median percent", "CPU share", "effort ~ R", "work ~ R", "honesty",
      "feeds from rival bees", "rival feed rate", "fitness (rank)"],
      honestEnts.map((e) => {
        const tid = e.team_id, t = m.teams?.[tid], w = W.find((s) => s.teamId === tid), rv = T.filter((x) => x.flower === tid && x.bee !== tid);
        const work = [w?.bytes, w?.nodes].filter((x) => x != null);
        const mine = T.filter((x) => x.flower === tid);
        const share = mine.filter((x) => x.answered && x.ms != null && x.R > 0).map((x) => x.ms / x.R);
        const at60 = share.length ? share.filter((x) => Math.abs(x - 0.6) <= 0.05).length / share.length : null;
        const noResponse = mine.length ? mine.filter((x) => !x.answered).length / mine.length : null;
        const conform = m.roles?.[tid]?.conform ?? t?.flower?.percentAt50;
        S.honest.push({ conform, at60, cpuP50: quantile(share, 0.5), noResponse, rivalRate: rate(rv), fitness: final[tid]?.fitness ?? null });
        return [e.team_name, pct(conform), ...(contract ? [`${f2(quantile(share, 0.1))} / ${f2(quantile(share, 0.5))} / ${f2(quantile(share, 0.9))}`, pct(at60), pct(noResponse)] : []),
          f2(t?.flower?.percent?.p50), pct(t?.flower?.computeShare), f2(w?.effort), f2(work.length ? Math.max(...work) : null),
          honesty(w), rv.filter((x) => x.fed).length, pct(rate(rv)), `${f2(final[tid]?.fitness)} (#${rank.indexOf(tid) + 1})`];
      }));
    // Each change of an honest flower, against the defectors' imitations that came before it: the imitations of the
    // version it replaced (by then), how long after the last one it came, and the rival feed rates in the minute before
    // and after, at the honest flower and at its imitators; whether a defector copied the new version too.
    const changes = [];
    for (const e of honestEnts) {
      const tid = e.team_id;
      const fv = vs.filter((v) => v.teamId === tid && v.kind === "flower").sort((a, b) => a.version - b.version);
      const prev = prevFinal.get(e.slug);
      if (fv.length && prev != null && fv[0].code !== prev) changes.push({ e, between: true, v: fv[0] });
      for (let i = 1; i < fv.length; i++) if (fv[i].code !== fv[i - 1].code) changes.push({ e, v: fv[i], from: fv[i - 1] });
      if (fv.length) prevFinal.set(e.slug, fv[fv.length - 1].code);
    }
    const crows = changes.map(({ e, v, from, between }) => {
      const tid = e.team_id, tc = Number(v.atMs) || 0;
      if (between) return [e.team_name, `v${v.version} (between games)`, "-", "-", "-", "-", "-"];
      const imit = copies.filter((c) => c.model === e.team_name && Number(c.modelVersion) === Number(from.version) && role(teamIdByName[c.copier]) === "defector" && c.atMs <= tc);
      const copiers = [...new Set(imit.map((c) => teamIdByName[c.copier]))];
      const last = imit.length ? Math.max(...imit.map((c) => c.atMs)) : null;
      const later = copies.filter((c) => c.model === e.team_name && Number(c.modelVersion) === Number(v.version) && role(teamIdByName[c.copier]) === "defector");
      return [e.team_name, `v${from.version} → v${v.version} at ${mmss(tc)}`,
        imit.length ? `${imit.length} by ${imit.map((c) => c.copier).filter((x, i, a) => a.indexOf(x) === i).join(", ")}` : "none",
        last != null ? `${mmss(tc - last)} after the last` : "-",
        `${pct(rivalAt(tid, tc - WINDOW_MS, tc))} → ${pct(rivalAt(tid, tc, tc + WINDOW_MS))}`,
        copiers.length ? copiers.map((c) => `${pct(rivalAt(c, tc - WINDOW_MS, tc))} → ${pct(rivalAt(c, tc, tc + WINDOW_MS))}`).join("; ") : "-",
        later.length ? `yes, ${mmss(Math.min(...later.map((c) => c.atMs)) - tc)} later` : "no"];
    });
    if (crows.length) {
      p("Changes of the honest flowers, against the defectors' imitations before them (rival feed rates in the minute before → after):");
      table(["team", "change", "defector imitations of the old version before it", "came", "rival feed rate at it", "at its imitators", "new version imitated too"], crows);
    } else if (honestEnts.length) { p("No honest flower changed during this game."); p(); }

    // Defectors.
    p("Defectors (conformance: answers at 0%; imitation: their versions' first close copies of another species' answers; detection: rival bees' feed rate falling below half the model's):");
    table(["team", "conformance", "median percent", "copies (median lag)", "of honest flowers", "rival feeds before / after being told apart", "rival feed rate, first / last third of the game", "fitness (rank)"],
      ents.filter((x) => role(x.team_id) === "defector").map((e) => {
        const tid = e.team_id, t = m.teams?.[tid], mine = copies.filter((c) => teamIdByName[c.copier] === tid);
        const rv = T.filter((x) => x.flower === tid && x.bee !== tid);
        const before = mine.reduce((a, c) => a + (c.rivalFeedsBeforeDetection || 0), 0);
        const detectedAt = mine.filter((c) => c.detected).map((c) => c.atMs + (c.detectedAfterMs || 0));
        const after = detectedAt.length ? rv.filter((x) => x.fed && x.atMs > Math.min(...detectedAt)).length : null;
        const lags = mine.map((c) => c.lagMs).sort((a, b) => a - b);
        const ofHonest = mine.filter((c) => role(teamIdByName[c.model]) === "honest").length;
        S.defector.push({ copies: mine.length, ofHonest, lag: lags.length ? lags[Math.floor(lags.length / 2)] : null, rivalRate: rate(rv), fitness: final[tid]?.fitness ?? null });
        return [e.team_name, pct(m.roles?.[tid]?.conform ?? t?.flower?.percentAt0), f2(t?.flower?.percent?.p50), `${mine.length} (${lags.length ? mmss(lags[Math.floor(lags.length / 2)]) : "-"})`, ofHonest,
          `${before} / ${after ?? "never told apart"}`, `${pct(rate(rv.filter((x) => x.atMs < end / 3)))} / ${pct(rate(rv.filter((x) => x.atMs >= (2 * end) / 3)))}`,
          `${f2(final[tid]?.fitness)} (#${rank.indexOf(tid) + 1})`];
      }));
    // Everyone's bees: where do they feed?
    const groups = ["veteran", "honest", "defector"];
    const byRole = Object.fromEntries(groups.map((b) => [b, Object.fromEntries(groups.map((f) => [f, rate(T.filter((x) => role(x.bee) === b && role(x.flower) === f && x.bee !== x.flower))]))]));
    S.feeds = byRole;
    p("All bees by role (feed rate at flowers of each role, rival flowers only):");
    table(["bees of", ...groups.map((r) => `at ${r} flowers`)], groups.map((b) => [b, ...groups.map((f) => pct(byRole[b][f]))]));
    summary.push(S);
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
  return { id, arena, summary, effort: await effortOf(id, games) };
}

/** The agents' effort per game: team sessions (lobby and in play), their turns, output tokens and spend, per team. */
async function effortOf(id, games) {
  const rows = await all(`SELECT game_id, CASE WHEN purpose LIKE 'lobby%' THEN 'lobby' ELSE 'play' END AS phase, count(*)::int AS n, sum(cost_usd)::float AS usd,
                                 sum(output_tokens)::float AS out, percentile_cont(0.5) WITHIN GROUP (ORDER BY turns)::float AS turns, count(DISTINCT persona_id)::int AS teams
                            FROM arena.llm_calls WHERE arena_id = $1 AND purpose IN ('lobby', 'lobby-fix', 'session') GROUP BY 1, 2`, [id]);
  return games.map((g) => {
    const of = (phase) => rows.find((r) => r.game_id === g.id && r.phase === phase) || null;
    return { gen: g.generation, lobby: of("lobby"), play: of("play") };
  });
}

/** The two arenas side by side, game by game ("a → b → c → d"). */
function sideBySide(A, B) {
  quiet = false;
  const label = (x) => `${x.id}${x.arena.settings.experiment?.name ? ` (${x.arena.settings.experiment.name})` : ""}`;
  const seq = (x, f) => x.summary.map(f).map((v) => (v == null ? "-" : v)).join(" → ") || "-";
  const eff = (x, f) => x.effort.map(f).map((v) => (v == null ? "-" : v)).join(" → ") || "-";
  const perTeam = (r, k) => (r && r.teams ? r[k] / r.teams : null);
  const rows = [
    ["lobby sessions: median turns", (x) => eff(x, (e) => n0(e.lobby?.turns))],
    ["lobby: output tokens per team", (x) => eff(x, (e) => n0(perTeam(e.lobby, "out")))],
    ["play: sessions per team", (x) => eff(x, (e) => f2(perTeam(e.play, "n")))],
    ["play: median turns per session", (x) => eff(x, (e) => n0(e.play?.turns))],
    ["play: output tokens per team", (x) => eff(x, (e) => n0(perTeam(e.play, "out")))],
    ["spend per game (team sessions)", (x) => eff(x, (e) => `$${f2((e.lobby?.usd ?? 0) + (e.play?.usd ?? 0))}`)],
    ["veterans: mean flower level", (x) => seq(x, (s) => f2(mean(s.vet.map((v) => v.level))))],
    ["veterans: mean CPU share", (x) => seq(x, (s) => pct(mean(s.vet.map((v) => v.compute))))],
    ["veterans: median percent (mean)", (x) => seq(x, (s) => f2(mean(s.vet.map((v) => v.percent))))],
    ["veterans' bees: feed rate at honest / defector flowers", (x) => seq(x, (s) => `${pct(mean(s.vet.map((v) => v.feedHonest)))}/${pct(mean(s.vet.map((v) => v.feedDefector)))}`)],
    ["veterans' bees: feed rate at poor / rich R", (x) => seq(x, (s) => `${pct(mean(s.vet.map((v) => v.feedPoor)))}/${pct(mean(s.vet.map((v) => v.feedRich)))}`)],
    ["veterans: copies of honest flowers", (x) => seq(x, (s) => s.vet.reduce((a, v) => a + v.copiedHonest.length, 0))],
    ["honest: answers at 50%", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.conform))))],
    ["honest: CPU within 55–65% of R", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.at60))))],
    ["honest: no response", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.noResponse))))],
    ["honest: rival feed rate", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.rivalRate))))],
    ["defectors: copies (of honest flowers)", (x) => seq(x, (s) => `${s.defector.reduce((a, d) => a + d.copies, 0)} (${s.defector.reduce((a, d) => a + d.ofHonest, 0)})`)],
    ["defectors: rival feed rate", (x) => seq(x, (s) => pct(mean(s.defector.map((d) => d.rivalRate))))],
    ["all bees at honest / defector flowers", (x) => seq(x, (s) => `${pct(mean(["veteran", "honest", "defector"].map((b) => s.feeds?.[b]?.honest)))}/${pct(mean(["veteran", "honest", "defector"].map((b) => s.feeds?.[b]?.defector)))}`)],
    ["mean fitness: veteran / honest / defector", (x) => seq(x, (s) => `${f2(mean(s.vet.map((v) => v.fitness)))}/${f2(mean(s.honest.map((h) => h.fitness)))}/${f2(mean(s.defector.map((d) => d.fitness)))}`)],
  ];
  p(`## Side by side: ${label(A)} and ${label(B)} (game by game)`);
  p();
  table(["measure", label(A), label(B)], rows.map(([name, f]) => [name, f(A), f(B)]));
}

async function main() {
  const A = await analyse(arenaId);
  if (compareId) {
    quiet = true;
    const B = await one("SELECT 1 FROM arena.arenas WHERE id = $1", [compareId]) ? await analyse(compareId) : null;
    if (B) sideBySide(A, B);
    else { quiet = false; p(`(No arena ${compareId} to compare with.)`); }
  }
  console.log(out.join("\n"));
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
