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
//   responses by role       median bytes (p90), and in games with the byte factor the energy share the bytes took
//   side by side            the two arenas game by game: the agents' effort (sessions, turns, output tokens, spend) and
//                           the headline measures of each role
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Api, gamePath } from "./lib/api.js";
import { all, one, pool } from "./lib/db.js";
import { callModel } from "./lib/llm.js";
import { classifyPrograms, levelOf } from "./lib/mechanisms.js";
import { queryAll } from "./lib/metrics.js";
import { bytesInEnergy, bytesShare } from "./lib/energy.js";
import { honestyOf, spearman } from "./lib/wealth.js";
import { coopRules, floorAt, prevalenceOf, samplesOf } from "./lib/prevalence.js";

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
// The time bins of the over-time tables: a minute, or five in a long game (coop-eq's 40 minutes), so they stay readable.
let BIN = 60_000;
const binLabel = (w) => (BIN === 60_000 ? `min ${w + 1}` : `${(w * BIN) / 60_000}–${((w + 1) * BIN) / 60_000} min`);

/** One arena's analysis: printed (unless quiet), and its per-game summary for the side-by-side. */
async function analyse(id) {
  const arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
  if (!arena) throw new Error(`no arena ${id}`);
  const roles = arena.settings.roles || {}, seeds = arena.settings.seeds || {};
  const personas = await all("SELECT * FROM arena.personas WHERE arena_id = $1", [id]);
  const roleOf = (slug) => roles[slug]?.role || (seeds[slug] ? "veteran" : "other");
  // The cooperators' contract (adapt-hi: settings.honest { burn, nectar }); else the adapt brief (percent 50, work free).
  const onContract = (slug) => roles[slug]?.brief === "contract";
  const C = { burnMin: 0.2, nectarMin: 20, startBurn: 0.6, startNectar: 50, ...(arena.settings.honest || {}) };
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
    BIN = (g.config?.minutes ?? 10) > 15 ? 300_000 : 60_000;
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
      answered: t.response != null || t.responseBytes != null, bytes: t.responseBytes ?? null, version: t.flowerVersion, c: t.challenge, r: t.response,
      nectar: t.nectar ?? null, price: t.price ?? null, net: t.net ?? null })); // (price, net: a feed's price and the bee's net nectar, metagame v2)
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
    const contract = honestEnts.some((e) => onContract(e.slug));
    // adapt's honest teams answer at exactly 50%; adapt-hi's cooperators keep above the floors (percent ≥ nectarMin, CPU
    // ≥ (burnMin − 0.05) × R) and choose their spend b and percent.
    p(`Honest specialists (${contract ? `cooperators: floors percent ≥ ${C.nectarMin} and CPU ≥ ${C.burnMin} × R (less 0.05 of R), their burn b the realised CPU ms ÷ R` : "conformance: answers at 50%"}; ` +
      `honesty: costly when effort and visible work both follow R, cheap when only the work does):`);
    table(["team", contract ? `percent ≥ ${C.nectarMin}` : "conformance (percent 50)", ...(contract ? [`CPU ≥ ${C.burnMin} × R`, "burn: CPU ÷ R p10 / p50 / p90", "no response"] : []),
      "median percent", "CPU share", "effort ~ R", "work ~ R", "honesty", "feeds from rival bees", "rival feed rate", "fitness (rank)"],
      honestEnts.map((e) => {
        const tid = e.team_id, t = m.teams?.[tid], w = W.find((s) => s.teamId === tid), rv = T.filter((x) => x.flower === tid && x.bee !== tid);
        const work = [w?.bytes, w?.nodes].filter((x) => x != null);
        const mine = T.filter((x) => x.flower === tid);
        const share = mine.filter((x) => x.answered && x.ms != null && x.R > 0).map((x) => x.ms / x.R);
        const cpuOk = share.length ? share.filter((x) => x >= C.burnMin - 0.05).length / share.length : null;
        const noResponse = mine.length ? mine.filter((x) => !x.answered).length / mine.length : null;
        const answered = mine.filter((x) => x.answered && x.percent != null);
        const conform = !answered.length ? null : contract ? answered.filter((x) => x.percent >= C.nectarMin - 0.5).length / answered.length
          : answered.filter((x) => Math.abs(x.percent - 50) < 0.5).length / answered.length;
        S.honest.push({ slug: e.slug, name: e.team_name, conform, cpuOk, burn: quantile(share, 0.5), percent: quantile(answered.map((x) => x.percent), 0.5), noResponse, rivalRate: rate(rv), fitness: final[tid]?.fitness ?? null });
        return [e.team_name, pct(conform), ...(contract ? [pct(cpuOk), `${f2(quantile(share, 0.1))} / ${f2(quantile(share, 0.5))} / ${f2(quantile(share, 0.9))}`, pct(noResponse)] : []),
          f2(t?.flower?.percent?.p50), pct(t?.flower?.computeShare), f2(w?.effort), f2(work.length ? Math.max(...work) : null),
          honesty(w), rv.filter((x) => x.fed).length, pct(rate(rv)), `${f2(final[tid]?.fitness)} (#${rank.indexOf(tid) + 1})`];
      }));
    if (contract) cooperatorTrajectories({ T, honestEnts, vs, copies, role, teamIdByName });
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

    fingerprintReport({ T, ents, role, copies, teamIdByName, gen: g.generation, S });
    await prevalenceReport({ g, gp, teams, ents, role, T, copies, teamIdByName, S });
    if (coopRules(g.config).on) await coopReport({ g, gp, teams, ents, role, T, S });

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
    // Responses by role: their size, and (in a game whose energy has the byte factor) the share of the energy their bytes
    // took: Σ e0 × bytes ÷ Σ e0 × cap, with e0 = (cap − size) × max(0, R − CPU ms), over answered calls.
    const config = g.config || {}, sizeCap = config.budgets?.flower?.size ?? 1100;
    const sizeOf = new Map(versions.filter((v) => v.kind === "flower").map((v) => [`${byIndex[v.team]}:${v.version}`, Number(v.size) || 0]));
    const bytesRow = (r) => {
      const ts = T.filter((x) => role(x.flower) === r && x.answered && x.bytes != null);
      let e0 = 0, lost = 0;
      for (const x of ts) {
        const e = Math.max(0, sizeCap - (sizeOf.get(`${x.flower}:${x.version}`) ?? 0)) * Math.max(0, (x.R ?? config.budgets?.flower?.ms ?? 150) - (x.ms ?? 0));
        e0 += e; lost += e * bytesShare(config, x.bytes);
      }
      return { median: quantile(ts.map((x) => x.bytes), 0.5), p90: quantile(ts.map((x) => x.bytes), 0.9), lost: bytesInEnergy(config) && e0 ? lost / e0 : null };
    };
    S.bytes = Object.fromEntries(groups.map((r) => [r, bytesRow(r)]));
    p(`Responses by role (bytes of JSON${bytesInEnergy(config) ? `; energy lost to bytes: the share of E at an empty response that the bytes took, Σ e0 × bytes ÷ Σ e0 × ${n0(config.maxResponseBytes)}` : "; this game's energy has no byte factor"}):`);
    table(["flowers of", "median bytes (p90)", "energy lost to bytes"], groups.map((r) => [r, `${n0(S.bytes[r].median)} (${n0(S.bytes[r].p90)})`, pct(S.bytes[r].lost)]));
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
  // Cooperators across games: realised burn and median percent, rival feed rate and fitness, game by game.
  const coop = [...new Set(summary.flatMap((s) => s.honest.map((h) => h.slug)))];
  if (coop.length && Object.values(roles).some((r) => r.brief === "contract")) {
    p("## Cooperators game by game (burn b: median CPU ms ÷ R · median percent · rival feed rate · fitness)");
    p();
    table(["cooperator", ...summary.map((s) => `game ${s.gen}`)], coop.map((slug) => [summary.map((s) => s.honest.find((h) => h.slug === slug)?.name).find(Boolean),
      ...summary.map((s) => { const h = s.honest.find((x) => x.slug === slug); return h ? `b ${f2(h.burn)} · ${h.percent ?? "-"}% · ${pct(h.rivalRate)} · ${f2(h.fitness)}` : "-"; })]));
  }
  // Fingerprints across games: each flower's whole-game profile, game by game, and how often defectors copied it.
  const fpSlugs = [...new Set(summary.flatMap((s) => Object.keys(s.fingerprints || {})))];
  if (fpSlugs.length) {
    p("## Fingerprints game by game (whole-game profile over the four properties, U; defector copies of it that game)");
    p();
    table(["flower", "role", ...summary.map((s) => `game ${s.gen}`)], fpSlugs.map((slug) => {
      const any = summary.map((s) => s.fingerprints?.[slug]).find(Boolean);
      return [any.name, any.role, ...summary.map((s) => { const f = s.fingerprints?.[slug]; return f?.profile ? `${f.profile.map((x) => x.toFixed(2)).join(" ")} (U ${f.U.toFixed(1)}; ${f.copied} copied)` : "-"; })];
    }));
  }
  return { id, arena, summary, effort: await effortOf(id, games) };
}

// ---------------------------------------------------------------- prevalence (metagame v2)

/** The game's published prevalence samples, one per team and sample ({ atMs, team id, F, B, pF, pB, fitness }), from its
 * `prevalence` history query (lib/prevalence.js reads the engine's shapes); [] when the game has none or the query isn't
 * there. */
async function prevalenceSamples(gp, teams) {
  let rows = [];
  try { rows = await queryAll(Api, gp, { from: "prevalence" }); } catch { return []; }
  const idOf = (t) => (teams.some((x) => x.id === t) ? t : teams.find((x) => x.index === Number(t))?.id ?? null);
  return samplesOf(rows).map((s) => ({ ...s, team: idOf(s.team) })).filter((s) => s.team);
}

/** The flower side: each species' prevalence p_s (its draw chance, flowerP) over the game, by role; the share each role
 * holds and the concentration (HHI = Σ p_s²), by bin; whether prevalent species cut their percent; and extinctions (p_s at
 * its floor, c / (N (c + 1)), for a minute or more). The bee side and F × B: coopReport. */
async function prevalenceReport({ g, gp, teams, ents, role, T, S }) {
  const config = g.config || {};
  if (!prevalenceOf(config)) return;
  const samples = (await prevalenceSamples(gp, teams)).filter((x) => x.pF != null).map((x) => ({ ...x, p: x.pF }));
  if (!samples.length) { p(`Species prevalence, game ${g.generation}: no samples (the game publishes none, or its query entity has another name).`); p(); return; }
  const n = teams.length, duration = Math.max(g.metrics?.durationMs ?? 0, (config.minutes ?? 0) * 60000, ...samples.map((x) => x.atMs));
  const nWin = Math.max(1, Math.ceil(duration / BIN));
  const name = Object.fromEntries(ents.map((e) => [e.team_id, e.team_name]));
  const species = [...new Set(samples.map((x) => x.team))];
  const pAt = (team, w) => mean(samples.filter((x) => x.team === team && Math.floor(x.atMs / BIN) === w).map((x) => x.p));
  const roles = ["veteran", "honest", "defector"];
  // Per species, minute by minute.
  p(`Species prevalence, game ${g.generation} (p_s: the chance a visit is to the species, mean per bin; uniform would be ${f2(1 / n)}):`);
  table(["species", "role", ...Array.from({ length: nWin }, (_, w) => binLabel(w))],
    [...species].sort((a, b) => roles.indexOf(role(a)) - roles.indexOf(role(b))).map((t) => [name[t] ?? t, role(t), ...Array.from({ length: nWin }, (_, w) => f2(pAt(t, w)))]));
  // Role shares and concentration.
  const share = (r, w) => { const xs = species.filter((t) => role(t) === r).map((t) => pAt(t, w)).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
  const hhi = (w) => { const xs = species.map((t) => pAt(t, w)).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b * b, 0) : null; };
  p(`Species prevalence held by each role, and its concentration (HHI = Σ p_s²; ${f2(1 / n)} when uniform), by bin:`);
  table(["", ...Array.from({ length: nWin }, (_, w) => binLabel(w))], [
    ...roles.map((r) => [`${r} (${species.filter((t) => role(t) === r).length} species; uniform ${f2(species.filter((t) => role(t) === r).length / n)})`, ...Array.from({ length: nWin }, (_, w) => f2(share(r, w)))]),
    ["HHI", ...Array.from({ length: nWin }, (_, w) => f2(hhi(w)))]]);
  // Prevalence against percent: per species, over its minutes; and pooled over every species-minute.
  const pairs = [], rows = [];
  for (const t of species) {
    const own = [];
    for (let w = 0; w < nWin; w++) {
      const pc = T.filter((x) => x.flower === t && x.answered && x.percent != null && Math.floor(x.atMs / BIN) === w).map((x) => x.percent);
      const pw = pAt(t, w);
      if (pw != null && pc.length) { const med = quantile(pc, 0.5); own.push([pw, med]); pairs.push([pw, med]); }
    }
    rows.push([name[t] ?? t, role(t), own.length, f2(spearman(own))]);
  }
  p(`Do prevalent species cut their percent? Spearman rho of a species' prevalence and its median percent over its minutes (negative: it gives less when it is drawn more); pooled over every species-minute: ${f2(spearman(pairs))}.`);
  table(["species", "role", "minutes", "rho(p_s, percent)"], rows);
  // Extinctions: at the floor (within 10%) for a minute or more of samples in a row.
  const ext = [];
  for (const t of species) {
    const xs = samples.filter((x) => x.team === t).sort((a, b) => a.atMs - b.atMs);
    let from = null, longest = 0, total = 0;
    for (let i = 0; i < xs.length; i++) {
      const fl = floorAt(config, xs[i].atMs, duration, n), low = fl != null && xs[i].p <= fl * 1.1;
      if (low && from == null) from = xs[i].atMs;
      if ((!low || i === xs.length - 1) && from != null) { const len = (low ? xs[i].atMs : xs[i - 1]?.atMs ?? from) - from; if (len >= 60000) { total += len; longest = Math.max(longest, len); } from = null; }
    }
    if (total) ext.push([name[t] ?? t, role(t), mmss(total), mmss(longest)]);
  }
  if (ext.length) { p("Extinctions (p_s within 10% of its floor c / (N (c + 1)) for a minute or more):"); table(["species", "role", "time at the floor", "longest stretch"], ext); }
  else { p("No species sat at its floor for a minute or more."); p(); }
  S.prevalence = { share: Object.fromEntries(roles.map((r) => [r, mean(Array.from({ length: nWin }, (_, w) => share(r, w)))])),
    hhi: mean(Array.from({ length: nWin }, (_, w) => hhi(w))), extinct: ext.length, rho: spearman(pairs) };
}

// ---------------------------------------------------------------- coop-eq: prevalence on both sides

/** coop-eq's question, minute by minute: the cooperators' combined share of flower and bee prevalence (Σ flowerP, Σ beeP),
 * flower success F and bee success B per role (and per team, by bin), the defector's draw chances and F and B; fitness
 * (F × B's time-average) per team at the end; each bee's visits and dud feeds (net nectar below 0: nectar under the feed
 * price) and their cost; and the verdict: did the cooperators' shares hold or grow in the last ten minutes? */
async function coopReport({ g, gp, teams, ents, role, T, S }) {
  const config = g.config || {}, co = coopRules(config, ents.length);
  const samples = await prevalenceSamples(gp, teams);
  const duration = Math.max((config.minutes ?? 0) * 60000, ...samples.map((x) => x.atMs), 1), nMin = Math.ceil(duration / 60000);
  const at = (team, w, f) => mean(samples.filter((x) => x.team === team && Math.floor(x.atMs / 60000) === w).map(f).filter((v) => v != null));
  const teamsOf = (r) => ents.filter((e) => role(e.team_id) === r).map((e) => e.team_id);
  const sumOf = (r, w, f) => { const v = teamsOf(r).map((t) => at(t, w, f)).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const meanOf = (r, w, f) => mean(teamsOf(r).map((t) => at(t, w, f)).filter((x) => x != null));
  const FB = (r, w) => `${f2(meanOf(r, w, (x) => x.F))} / ${f2(meanOf(r, w, (x) => x.B))}`;
  p(`## coop-eq, game ${g.generation}: prevalence on both sides`);
  p();
  p(`Rules: ${co.perRound ?? "?"} of ${ents.length} bees visit each round; a feed price of ${n0(co.price)} ${co.unit} (${pct(co.priceShare)} of the most E); responses at ${co.windowMs} ms, R up to ${config.budgets?.flower?.ms ?? "?"} ms; fitness ${co.final ? "N² × pF × pB at the last round" : "the time-average of F × B"}.`);
  p();
  if (!samples.length) { p("(No prevalence samples: the game publishes none, or its query entity has another name.)"); p(); return; }
  const coopN = teamsOf("honest").length, N = ents.length;
  p(`Minute by minute: the cooperators' combined share of flower and bee prevalence (Σ pF, Σ pB; uniform: ${f2(coopN / N)}), the defector's draw chances, and F (flower success) / B (bee success), par 1, per role (mean):`);
  table(["min", "coop Σ pF", "coop Σ pB", "coop F / B", "defector pF / pB", "defector F / B", "veterans F / B"],
    Array.from({ length: nMin }, (_, w) => [w + 1, f2(sumOf("honest", w, (x) => x.pF)), f2(sumOf("honest", w, (x) => x.pB)), FB("honest", w),
      `${f2(sumOf("defector", w, (x) => x.pF))} / ${f2(sumOf("defector", w, (x) => x.pB))}`, FB("defector", w), FB("veteran", w)]));
  // Per team, by bin; and its fitness at the end (the final scoreboard's, else the last sample's).
  const nBin = Math.ceil(duration / BIN);
  const binAt = (team, b, f) => mean(samples.filter((x) => x.team === team && Math.floor(x.atMs / BIN) === b).map(f).filter((v) => v != null));
  const lastOf = (team) => g.metrics?.final?.find((f) => f.teamId === team)?.fitness ?? samples.filter((x) => x.team === team && x.fitness != null).sort((a, b) => b.atMs - a.atMs)[0]?.fitness ?? null;
  p("F / B per team, over time, and its fitness (F × B's time-average) at the end:");
  table(["team", "role", ...Array.from({ length: nBin }, (_, b) => binLabel(b)), "fitness"],
    ents.map((e) => [e.team_name, role(e.team_id), ...Array.from({ length: nBin }, (_, b) => `${f2(binAt(e.team_id, b, (x) => x.F))} / ${f2(binAt(e.team_id, b, (x) => x.B))}`), f2(lastOf(e.team_id))]));
  // Visits and dud feeds: a feed whose net nectar (nectar − price) was below 0.
  const netOf = (x) => x.net ?? (x.nectar != null ? x.nectar - (x.price ?? co.price) : null);
  const drows = ents.map((e) => {
    const visits = T.filter((x) => x.bee === e.team_id), feeds = visits.filter((x) => x.fed);
    const known = feeds.filter((x) => netOf(x) != null), duds = known.filter((x) => netOf(x) < 0);
    const cost = duds.reduce((a, x) => a - netOf(x), 0), net = known.reduce((a, x) => a + netOf(x), 0);
    return [e.team_name, role(e.team_id), visits.length, feeds.length, known.length ? `${duds.length} (${pct(duds.length / known.length)})` : "-", duds.length ? n0(cost) : "-", known.length ? n0(net) : "-"];
  });
  p(`Each bee's visits (rounds it was drawn), feeds, dud feeds (net nectar below 0: nectar under the ${n0(co.price)} price) and what they cost, and its net nectar in all:`);
  table(["bee of", "role", "visits", "feeds", "dud feeds", "their cost", "net nectar"], drows);
  // The verdict: the cooperators' shares in the last ten minutes against minutes 10 to 30 (the middle of the game).
  const span = (f, from, to) => mean(Array.from({ length: Math.max(0, to - from) }, (_, i) => sumOf("honest", from + i, f)).filter((x) => x != null));
  const last = Math.max(0, nMin - 10), mid0 = Math.min(10, last), mid1 = Math.max(mid0 + 1, last);
  const verdict = (f) => { const a = span(f, mid0, mid1), b = span(f, last, nMin); if (a == null || b == null) return { a, b, v: "-" };
    return { a, b, v: b >= a + 0.02 ? "grew" : b >= a - 0.02 ? "held" : "fell" }; };
  const vf = verdict((x) => x.pF), vb = verdict((x) => x.pB);
  p(`Stability: the cooperators' flower share ${vf.v} (${f2(vf.a)} in minutes ${mid0 + 1}–${mid1}, ${f2(vf.b)} in the last ten), and their bee share ${vb.v} (${f2(vb.a)} → ${f2(vb.b)}). ` +
    `Uniform would be ${f2(coopN / N)}.`);
  p();
  S.coop = { flower: vf, bee: vb, fitness: Object.fromEntries(ents.map((e) => [e.team_name, lastOf(e.team_id)])) };
}

// ---------------------------------------------------------------- cooperators' spend and generosity (adapt-hi)

/** Each cooperator's realised burn b (median CPU ms ÷ R; its p10–p90 spread shows whether a version kept one fixed b) and
 * median percent, per version and minute by minute, alongside its rival feed rate and the defectors' imitations. */
function cooperatorTrajectories({ T, honestEnts, vs, copies, role, teamIdByName }) {
  const stats = (ts) => {
    const share = ts.filter((x) => x.answered && x.ms != null && x.R > 0).map((x) => x.ms / x.R);
    const pc = ts.filter((x) => x.answered && x.percent != null).map((x) => x.percent);
    return { n: ts.length, b: quantile(share, 0.5), b10: quantile(share, 0.1), b90: quantile(share, 0.9), percent: quantile(pc, 0.5) };
  };
  const vrows = [];
  for (const e of honestEnts) {
    const tid = e.team_id;
    for (const v of vs.filter((x) => x.teamId === tid && x.kind === "flower").sort((a, b) => a.version - b.version)) {
      const ts = T.filter((x) => x.flower === tid && Number(x.version) === Number(v.version));
      if (!ts.length) continue;
      const st = stats(ts), rv = ts.filter((x) => x.bee !== tid);
      const imit = copies.filter((c) => c.model === e.team_name && Number(c.modelVersion) === Number(v.version) && role(teamIdByName[c.copier]) === "defector");
      vrows.push([e.team_name, `v${v.version}`, Number(v.atMs) ? mmss(Number(v.atMs)) : "lobby", st.n, `${f2(st.b)} (${f2(st.b10)}–${f2(st.b90)})`, f2(st.percent), pct(rate(rv)),
        imit.length ? `${imit.length} (first ${mmss(Math.min(...imit.map((c) => c.lagMs)))} after it appeared)` : "-"]);
    }
  }
  p("Cooperators by version (burn b: median CPU ms ÷ R, p10–p90 in brackets, one fixed b per version keeps it narrow; median percent; rival feed rate; defector copies of the version):");
  table(["cooperator", "version", "live from", "turns", "burn b", "percent", "rival feed rate", "defector copies"], vrows);
  const end = Math.max(...T.map((x) => x.atMs), 1), nWin = Math.ceil(end / BIN);
  const mrows = honestEnts.map((e) => {
    const tid = e.team_id;
    const copied = new Set(copies.filter((c) => c.model === e.team_name && role(teamIdByName[c.copier]) === "defector").map((c) => Math.floor(c.atMs / BIN)));
    return [e.team_name, ...Array.from({ length: nWin }, (_, w) => {
      const ts = T.filter((x) => x.flower === tid && Math.floor(x.atMs / BIN) === w);
      if (!ts.length) return "-";
      const st = stats(ts);
      return `b ${f2(st.b)} · ${st.percent ?? "-"}% · ${pct(rate(ts.filter((x) => x.bee !== tid)))}${copied.has(w) ? " ←copied" : ""}`;
    })];
  });
  p("Cooperators minute by minute (burn b · median percent · rival feed rate; \"←copied\" where a defector's close copy of it began):");
  table(["cooperator", ...Array.from({ length: nWin }, (_, w) => binLabel(w))], mrows);
}

// ---------------------------------------------------------------- fingerprints (adapt-hi's cooperators)

// The integrated fingerprint (arena/priming/fingerprints/integrated.py): a response {"nodes": 1, "edges": [], "labels":
// [S]}, S of 49 characters: p[v] = ord(S[v]) − 35 for v < 48 (an arrangement of the 48 nodes) and S[48] its spend share
// f = (ord − 35) / 50. The starter bee's levels(challenge, response) scores the arrangement on its four properties as
// z-scores (its pair sets come from Python's random.Random(challenge), so it runs in Python): profile z / Σz, wealth Σz.
const FINGERPRINT_BEE = args["fingerprint-bee"] || path.join(path.dirname(new URL(import.meta.url).pathname), "priming", "fingerprints", "integrated_bee.py");
const PER_WINDOW = 40; // responses scored per flower and minute at most (levels() is a few ms each)
const isFingerprint = (r) => !!r && Array.isArray(r.labels) && typeof r.labels[0] === "string" && r.labels[0].length === 49;

/** z per (challenge, response), from the starter bee's own levels() (one Python run): Map key -> z array or null. */
function fingerprintLevels(items) {
  if (!items.length || !fs.existsSync(FINGERPRINT_BEE)) return new Map();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adapt-fp-")), file = path.join(dir, "items.json");
  fs.writeFileSync(file, JSON.stringify(items.map(({ k, c, r }) => ({ k, c, r }))));
  const py = `import json, sys
ns = {"__name__": "fingerprint_bee"}
exec(compile(open(sys.argv[1]).read(), sys.argv[1], "exec"), ns)
out = {}
for it in json.load(open(sys.argv[2])):
    try:
        out[it["k"]] = ns["levels"](it["c"], it["r"])
    except Exception:
        out[it["k"]] = None
print(json.dumps(out))`;
  const res = spawnSync("python3", ["-I", "-c", py, FINGERPRINT_BEE, file], { encoding: "utf8", maxBuffer: 1 << 28 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (res.status !== 0) { p(`(fingerprint levels failed: ${String(res.stderr).slice(0, 300)})`); return new Map(); }
  return new Map(Object.entries(JSON.parse(res.stdout)));
}

/** Each cooperator's fingerprint over the game, minute by minute (its profile z / Σz, wealth Σz and claimed spend share
 * f), against the defectors' imitations of it; and the defectors' own, where they answer in the format. */
function fingerprintReport({ T, ents, role, copies, teamIdByName, gen, S }) {
  const who = ents.filter((e) => ["honest", "defector"].includes(role(e.team_id)));
  const items = [];
  for (const e of who) {
    const perWin = new Map();
    for (const [i, x] of T.entries()) {
      if (x.flower !== e.team_id || !x.answered || !isFingerprint(x.r)) continue;
      const w = Math.floor(x.atMs / BIN), n = perWin.get(w) || 0;
      if (n >= PER_WINDOW) continue;
      perWin.set(w, n + 1);
      items.push({ k: String(i), c: x.c, r: x.r, team: e.team_id, w, f: (x.r.labels[0].charCodeAt(48) - 35) / 50 });
    }
  }
  if (!items.length) return;
  const z = fingerprintLevels(items);
  const prof = (zs) => { const v = zs.filter((x) => x && x.reduce((a, b) => a + b, 0) > 0); if (!v.length) return null;
    const ps = v.map((x) => { const U = x.reduce((a, b) => a + b, 0); return x.map((y) => y / U); });
    return { p: ps[0].map((_, d) => mean(ps.map((x) => x[d]))), U: mean(v.map((x) => x.reduce((a, b) => a + b, 0))), n: v.length }; };
  const fmtP = (q) => (q ? `${q.p.map((x) => x.toFixed(2)).join(" ")} (U ${q.U.toFixed(1)})` : "-");
  const nWin = Math.max(...items.map((x) => x.w)) + 1;
  const rows = [], summary = {};
  for (const e of who) {
    const mine = items.filter((x) => x.team === e.team_id);
    if (!mine.length) continue;
    const all = prof(mine.map((x) => z.get(x.k)));
    const imit = copies.filter((c) => c.model === e.team_name && role(teamIdByName[c.copier]) === "defector").map((c) => Math.floor(c.atMs / BIN));
    const cells = Array.from({ length: nWin }, (_, w) => {
      const q = prof(mine.filter((x) => x.w === w).map((x) => z.get(x.k)));
      return `${q ? q.p.map((x) => x.toFixed(2)).join(" ") : "-"}${imit.includes(w) ? " ←copied" : ""}`;
    });
    summary[e.slug] = { name: e.team_name, role: role(e.team_id), profile: all?.p ?? null, U: all?.U ?? null, f: mean(mine.map((x) => x.f)), copied: imit.length };
    rows.push([e.team_name, role(e.team_id), fmtP(all), f2(mean(mine.map((x) => x.f))), ...cells]);
  }
  S.fingerprints = summary;
  p(`Fingerprints, game ${gen} (the integrated format, scored by the starter bee's levels(): profile z / Σz over its four properties, ` +
    `U = Σz; f the spend share it claims; over time, "←copied" where a defector's close copy of it began; at most ${PER_WINDOW} responses a bin):`);
  table(["flower", "role", "profile (U), whole game", "f", ...Array.from({ length: nWin }, (_, w) => binLabel(w))], rows);
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
    ["honest: answers at their percent (adapt: 50; adapt-hi: at or above the floor)", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.conform))))],
    ["honest: CPU at or above the burn floor (adapt-hi)", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.cpuOk))))],
    ["honest: mean burn (median CPU ÷ R) / mean percent", (x) => seq(x, (s) => `${f2(mean(s.honest.map((h) => h.burn)))} / ${f2(mean(s.honest.map((h) => h.percent)))}`)],
    ["honest: no response", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.noResponse))))],
    ["honest: rival feed rate", (x) => seq(x, (s) => pct(mean(s.honest.map((h) => h.rivalRate))))],
    ["defectors: copies (of honest flowers)", (x) => seq(x, (s) => `${s.defector.reduce((a, d) => a + d.copies, 0)} (${s.defector.reduce((a, d) => a + d.ofHonest, 0)})`)],
    ["defectors: rival feed rate", (x) => seq(x, (s) => pct(mean(s.defector.map((d) => d.rivalRate))))],
    ["median response bytes: veteran / honest / defector", (x) => seq(x, (s) => ["veteran", "honest", "defector"].map((r) => n0(s.bytes?.[r]?.median)).join("/"))],
    ["energy lost to bytes: veteran / honest / defector", (x) => seq(x, (s) => ["veteran", "honest", "defector"].map((r) => pct(s.bytes?.[r]?.lost)).join("/"))],
    ["cooperators' mean fingerprint profile (4 properties)", (x) => seq(x, (s) => { const ps = Object.values(s.fingerprints || {}).filter((f) => f.role === "honest" && f.profile);
      return ps.length ? ps[0].profile.map((_, d) => mean(ps.map((f) => f.profile[d])).toFixed(2)).join(" ") : null; })],
    ["prevalence held: veteran / honest / defector (game mean)", (x) => seq(x, (s) => (s.prevalence ? ["veteran", "honest", "defector"].map((r) => f2(s.prevalence.share[r])).join("/") : null))],
    ["prevalence HHI (game mean); species extinct a minute or more", (x) => seq(x, (s) => (s.prevalence ? `${f2(s.prevalence.hhi)}; ${s.prevalence.extinct}` : null))],
    ["prevalence against percent (pooled rho)", (x) => seq(x, (s) => (s.prevalence ? f2(s.prevalence.rho) : null))],
    ["coop-eq: cooperators' flower share, minutes 10–30 → last ten (verdict)", (x) => seq(x, (s) => (s.coop ? `${f2(s.coop.flower.a)} → ${f2(s.coop.flower.b)} (${s.coop.flower.v})` : null))],
    ["coop-eq: cooperators' bee share, minutes 10–30 → last ten (verdict)", (x) => seq(x, (s) => (s.coop ? `${f2(s.coop.bee.a)} → ${f2(s.coop.bee.b)} (${s.coop.bee.v})` : null))],
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
