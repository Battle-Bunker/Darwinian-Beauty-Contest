#!/usr/bin/env node
// Summarise arenas of one-flower games as Markdown: spend; each game (energy, percent, nectar and pollen over time and
// their distributions; the scores and their two shares; every species and bee; each bee's MEMORY and how often teams
// changed their bee; self-feeding and handshakes; whether bees
// discriminate generous flowers; flower size and compute against energy; how fast flowers copy each other's answers;
// the change timeline, scaffolds, sessions, storage); the interview panel; games side by side; ideas, breeders and the
// fair-play audit. Metrics come from arena.games.metrics (lib/metrics.js), recomputed from the game's API if missing.
//   node arena/analyze.js [--arenas a,b] [--recompute] > arena/runs/analysis.md
import { all, migrate, one, pool, q } from "./lib/db.js";
import { gamePath } from "./lib/api.js";
import { breederScores } from "./lib/population.js";
import { computeGameMetrics, scaffoldsOf, submitsOf } from "./lib/metrics.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]); return acc; }, []));
const WEB = process.env.ARENA_WEB || process.env.ARENA_API || "http://localhost:4100";
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(2));
const f3 = (x) => (x == null || Number.isNaN(x) ? "-" : Number(x).toFixed(3));
const pc = (x) => (x == null || Number.isNaN(x) ? "-" : `${Math.round(100 * x)}%`);
const big = (x) => { if (x == null || Number.isNaN(x)) return "-"; const a = Math.abs(x); return a >= 1e9 ? `${(x / 1e9).toFixed(2)}G` : a >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(x / 1e3).toFixed(1)}k` : Number(x).toFixed(a < 10 ? 2 : 0); };
const mmss = (ms) => { if (ms == null) return "-"; const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const secs = (ms) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)} s`);
const mb = (b) => (b == null ? "-" : `${(Number(b) / 1e6).toFixed(2)} MB`);
const mean = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const q3 = (d, f = big) => (d?.n ? `${f(d.p10)} / ${f(d.p50)} / ${f(d.p90)}` : "-");
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
table(["model", "calls", "not ok", "estimated cost", "USD", "input tok", "output tok", "cache read", "avg s"], byModel.map((r) => [r.model, r.calls, r.failed, r.est, f2(r.usd), r.inp, r.outp, r.cr, ((r.ms || 0) / 1000).toFixed(0)]));
const byPurpose = await all(`SELECT purpose, model, count(*)::int AS calls, sum(cost_usd) AS usd FROM arena.llm_calls WHERE arena_id = ANY($1) GROUP BY 1, 2 ORDER BY 1, usd DESC`, [ids]);
table(["purpose", "model", "calls", "USD", "USD/call"], byPurpose.map((r) => [r.purpose, r.model, r.calls, f2(r.usd), f3(r.usd / r.calls)]));
const tot = await one("SELECT coalesce(sum(cost_usd), 0) AS usd FROM arena.llm_calls WHERE arena_id = ANY($1)", [ids]);
const glob = await one("SELECT coalesce(sum(cost_usd), 0) AS usd FROM arena.llm_calls");
p(`Total for these arenas: **$${f2(tot.usd)}** (whole ledger: $${f2(glob.usd)}). Models used: ${byModel.map((r) => r.model).join(", ") || "none"}.`);
p();

const across = []; // one row per analysed game, for the side-by-side table

for (const a of arenas) {
  p(`## Arena \`${a.id}\` (${a.preset})`);
  const exp = a.settings.experiment;
  p(`${a.settings.description || ""}. Room: ${WEB}${a.room_url}. Status: ${a.status}.${exp ? ` Experiment ${exp.name}, arm ${exp.arm} (cohorts ${exp.cohorts.join(", ")}).` : ""}` +
    `${a.settings.common ? ` Common knowledge from ${a.settings.common.dir}.` : ""}`);
  p();
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 ORDER BY generation", [a.id]);
  const grows = [];
  for (const g of games) {
    const played = g.game_short_id && ["played", "interviewed", "judged", "done"].includes(g.stage);
    if ((!g.metrics && played) || (args.recompute && g.game_short_id && g.stage !== "created")) {
      try {
        const old = g.metrics || {};
        g.metrics = await computeGameMetrics(gamePath(a.room_short_id, g.game_short_id), { submits: await submitsOf(all, g.id) });
        g.metrics.scaffolds = await scaffoldsOf(all, g.id);
        if (old.storage) g.metrics.storage = old.storage;
        await q("UPDATE arena.games SET metrics = $2 WHERE id = $1", [g.id, g.metrics]);
      } catch (e) {
        p(`(game ${g.generation}: metrics could not be computed: ${e.message})`);
        p();
      }
    }
    const m = g.metrics;
    const ent = await all("SELECT e.*, p.name, p.model FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1 ORDER BY e.fitness_rank NULLS LAST", [g.id]);
    const ss = await one(`SELECT count(*) FILTER (WHERE phase = 'lobby')::int AS lobby, count(*) FILTER (WHERE phase = 'game')::int AS game, coalesce(sum(cost_usd), 0) AS usd FROM arena.sessions WHERE game_id = $1`, [g.id]);
    const rq = await one(`SELECT count(*) FILTER (WHERE op = 'submit' AND ok AND clock_ms > 0)::int AS live, count(*) FILTER (WHERE op = 'submit' AND NOT ok AND clock_ms > 0)::int AS refused FROM arena.requests WHERE game_id = $1`, [g.id]);
    const cost = await one("SELECT coalesce(sum(cost_usd), 0) AS usd FROM arena.llm_calls WHERE game_id = $1", [g.id]);
    const w = ent[0];
    const inGame = m ? m.changes.filter((c) => c.atMs > 0) : [];
    grows.push([g.generation, g.config?.minutes, `[${g.game_short_id}](${WEB}${g.game_url})`, g.stage, ent.filter((e) => !e.sat_out).length, m?.turns ?? "-", m?.rounds ?? "-",
      m ? `${m.totals.feeds} (${pc(m.totals.feedRate)})` : "-", m ? pc(m.totals.energy ? m.totals.energyLost / m.totals.energy : null) : "-",
      w?.fitness != null ? `${w.team_name} (${w.model}) ${f2(w.fitness)}` : "-", ent.filter((e) => e.fitness != null).map((e) => `${e.team_name} ${f2(e.fitness)}`).join(", ") || "-",
      `${ss.lobby}/${ss.game}`, m ? `${(m.scaffolds || []).filter((x) => x.starts > x.refused).length}` : "-",
      m ? `${inGame.filter((c) => c.source === "session").length} / ${inGame.filter((c) => c.source === "scaffold").length}` : "-",
      `${rq.live}/${rq.refused}`, f2(cost.usd), g.contaminated ? `QUARANTINED: ${g.contaminated}` : ""]);
    if (m && !g.contaminated) {
      const teams = Object.values(m.teams);
      const fit = (m.final || []).map((x) => x.fitness).filter((x) => x != null);
      across.push({ minutes: g.config?.minutes, arena: a.id, gen: g.generation, turnsPerSec: m.turnsPerSec, feedRate: m.totals.feedRate, meanPercent: m.distributions.percent?.mean,
        lost: m.totals.energy ? m.totals.energyLost / m.totals.energy : null, size: mean(m.versions.map((v) => v.size)), compute: mean(teams.map((t) => t.flower.computeShare)),
        selfShare: m.totals.feeds ? m.totals.selfFeeds / m.totals.feeds : null, handshakes: teams.filter((t) => t.handshake.flag).length, mutual: (m.handshakes?.mutual || []).length,
        lowHigh: [m.discrimination.byOffer.low.feedRate, m.discrimination.byOffer.high.feedRate], copies: m.copies.copies, copyLatency: m.copies.medianLatencyMs,
        changes: inGame.length / Math.max(1, teams.length), scaffoldTeams: (m.scaffolds || []).filter((x) => x.starts > x.refused).length, teams: teams.length,
        tooSlow: teams.reduce((s, t) => s + (t.bee.tooSlow || 0), 0), sessions: ss.game / Math.max(1, teams.length), cost: cost.usd,
        memShare: mean((m.memory?.teams || []).map((x) => x.finalShare)), beeChanges: mean((m.memory?.teams || []).map((x) => x.beeChanges)),
        grainRate: m.grains?.perMinute ?? null, grainHeld: m.grains?.versionsWithGrains ? `${m.grains.versionsFullyHeld}/${m.grains.versionsWithGrains}` : "-",
        grainUses: m.grains?.uses ? `${m.grains.secretUses}/${m.grains.copies}` : "-",
        fitSpread: fit.length ? Math.max(...fit) - Math.min(...fit) : null });
    }
  }
  p("### Games");
  table(["game", "minutes", "link", "stage", "teams", "turns", "rounds", "feeds (rate)", "energy lost", "winner", "final fitness", "sessions lobby/game", "teams with a scaffold",
    "in-game versions by sessions / scaffolds", "in-game submits ok/refused", "USD", ""], grows);

  for (const g of games) {
    const m = g.metrics;
    if (!m) continue;
    const B = m.config?.budgets || {};
    p(`### Game ${g.generation}: ${g.config?.minutes} min, ${m.turns} turns in ${m.rounds} rounds (${mmss(m.durationMs)} of game time, ${f2(m.turnsPerSec)} turns/s)`);
    p(`Feed cost ${m.config?.feedCost} rounds; ${m.config?.challengeType} → ${m.config?.responseType}; flower size cap ${B.flower?.size}, ${B.flower?.ms} ms; ` +
      `change budgets per minute (cap): ${["flower", "bee"].map((k) => `${k} ${B[k]?.perMinute} (${B[k]?.cap})`).join(", ")}.`);
    p();
    const T = m.totals;
    p(`Totals: ${T.feeds} feeds (${pc(T.feedRate)} of turns), ${T.selfFeeds} of them a bee at its own flower; excess energy ${big(T.energy)}, of which ${big(T.energyLost)} ` +
      `(${pc(T.energy ? T.energyLost / T.energy : null)}) lost to turns without a feed; nectar ${big(T.nectar)}, pollen ${big(T.pollen)}; ${T.failures} turns with no response.`);
    p();
    if (m.bigResponses?.turns) p(`Responses over 4 KB: ${m.bigResponses.turns} turns, ${m.bigResponses.distinct} distinct, ${big(m.bigResponses.bytes)} bytes in all; ` +
      `${m.bigResponses.fetched} fetched (${big(m.bigResponses.fetchedBytes)} bytes) for their shapes${m.bigResponses.failed ? `, ${m.bigResponses.failed} failed` : ""}.`);
    p("Distributions (p10 / p50 / p90; response bytes and percent over answered turns, energy over every turn, nectar and pollen over feeds):");
    table(["", "n", "min", "p10 / p50 / p90", "max", "mean"], ["responseBytes", "percent", "energy", "nectar", "pollen"].map((k) => { const d = m.distributions[k] || {}; return [k === "responseBytes" ? "response bytes" : k, d.n ?? 0, big(d.min), q3(d), big(d.max), big(d.mean)]; }));
    p(`Over time (windows of ${secs(m.windowMs)}; energy lost = energy of turns without a feed; self = a bee at its own flower):`);
    table(["window", "turns", "feeds", "feed rate", "energy", "energy lost", "nectar", "pollen", "mean percent", "no response", "self feeds / turns"],
      m.windows.map((x) => [`${mmss(x.from)}-${mmss(x.from + m.windowMs)}`, x.turns, x.feeds, pc(x.feedRate), big(x.energy), `${big(x.energyLost)} (${pc(x.energyLostShare)})`, big(x.nectar), big(x.pollen),
        f2(x.meanPercent), x.failures, `${x.selfFeeds} / ${x.selfTurns}`]));

    // Scores.
    const ent = await all("SELECT e.*, p.name, p.model FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1", [g.id]);
    const model = (id) => ent.find((x) => x.team_id === id)?.model;
    p("Scores (pollination = Σ over bee teams of √pollen the species gave them; forage = Σ over species of √nectar the bee got; share = the team's value ÷ the sum over teams; fitness = N² × the two shares):");
    table(["team", "model", "fitness", "pollination (share)", "forage (share)", "pollen given", "feeds received / given", "pollinators", "nectar collected / given", "nectar sources"],
      [...(m.final || [])].sort((x, y) => (y.fitness ?? 0) - (x.fitness ?? 0)).map((f) => [f.team, model(f.teamId), f2(f.fitness), `${big(f.pollination)} (${pc(f.pollinationShare)})`, `${big(f.forage)} (${pc(f.forageShare)})`,
        big(f.pollen), `${f.feedsReceived} / ${f.feedsGiven}`, f.pollinators, `${big(f.nectarCollected)} / ${big(f.nectarGiven)}`, f.nectarSources]));

    // Flowers.
    p("Flowers (percent p10 / p50 / p90 over answered turns; compute = CPU ms per call, and its mean as a share of the flower window):");
    table(["species of", "visits", "feeds", "feed rate", "pollinators", "percent", "mean energy", "energy lost", "nectar given", "pollen given", "compute mean / p90 ms", "compute share", "response bytes p50 / max", "over 4 KB", "no response"],
      Object.values(m.teams).map((t) => { const f = t.flower; return [t.name, f.turns, f.feeds, pc(f.feedRate), f.pollinators, q3(f.percent, f2), big(f.energy?.mean), big(f.energyLost), big(f.nectarPaid), big(f.pollen),
        `${f2(f.ms?.mean)} / ${f2(f.ms?.p90)}`, pc(f.computeShare), `${big(f.responseBytes?.p50)} / ${big(f.responseBytes?.max)}`, f.bigResponses ?? "-", f.failures]; }));
    // Bees, with the team's sessions and requests.
    const brows = [];
    for (const [id, t] of Object.entries(m.teams)) {
      const e = ent.find((x) => x.team_id === id);
      const ssx = e ? await one(`SELECT count(*) FILTER (WHERE phase = 'game')::int AS n, coalesce(sum(cost_usd), 0) AS usd, count(*) FILTER (WHERE violation)::int AS v FROM arena.sessions WHERE game_id = $1 AND persona_id = $2`, [g.id, e.persona_id]) : {};
      const rqx = e ? await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE op = 'submit' AND ok)::int AS ok, count(*) FILTER (WHERE op = 'submit' AND NOT ok)::int AS bad FROM arena.requests WHERE game_id = $1 AND persona_id = $2`, [g.id, e.persona_id]) : {};
      const b = t.bee;
      brows.push([t.name, e?.model, b.turns, b.feeds, pc(b.feedRate), big(b.nectar), big(b.nectarPerFeed), b.flowersFedAt, `${f2(b.decisionMs?.p50)} / ${f2(b.decisionMs?.p90)}`, b.tooSlow, b.errors,
        ssx.n ?? "-", f2(ssx.usd), rqx.n ?? "-", `${rqx.ok ?? 0}/${rqx.bad ?? 0}`, ssx.v || 0]);
    }
    p("Bees (decision ms p50 / p90; too slow = no decision within the bee window, which never feeds):");
    table(["bee of", "model", "turns", "feeds", "feed rate", "nectar", "nectar/feed", "flowers fed at", "decision ms", "too slow", "errors", "game sessions", "USD (all sessions)", "requests", "submits ok/refused", "violations"], brows);

    // Bee MEMORY and bee changes.
    if (m.memory) {
      p(`Bee MEMORY (a key-value store, cap ${m.memory.cap ?? "-"} bytes: Σ key bytes + value JSON bytes; only the bee writes it, in first, decide and fed; every new bee version ` +
        `starts empty). Sizes during play are the runner's samples; saves refused = decide's (over the cap or the wrong shape); fed() failures and the last error from the samples and the end:`);
      table(["bee of", "MEMORY at the end", "share of cap", "keys", "largest / mean sampled", "saves refused", "fed() failures", "last save error", "bee versions", "in-game bee changes", "per minute", "mean time between changes", "value at the end"],
        m.memory.teams.map((x) => [x.team, x.finalBytes ?? "-", pc(x.finalShare), x.keys ?? "-", `${x.sampledMaxBytes ?? "-"} / ${f2(x.sampledMeanBytes)}`, x.overCap, x.fedFailures ?? "-",
          x.finalError ? String(x.finalError).slice(0, 60) : "-", x.beeVersions, x.beeChanges, f2(x.beeChangesPerMinute),
          secs(x.meanMsBetweenChanges), x.value != null ? JSON.stringify(x.value).slice(0, 80) : "-"]));
    }

    // Pollen grains.
    const Gr = m.grains;
    if (Gr && Gr.setting !== "off" && Gr.grains != null) {
      p(`Pollen grains (${Gr.setting ?? "feeder"}; on every feed the bee's team got floor(pollen^(1/3)) characters of the answering flower version's minified code): ` +
        `${Gr.grains} grains, mean ${f2(Gr.meanLength)} characters; ${big(Gr.charactersToOthers)} characters to other teams' bees (${big(Gr.perMinute)} a minute). ` +
        `${Gr.versionsFullyHeld} of ${Gr.versionsWithGrains} flower versions were fully held by one other team (median ${Gr.medianMsToFullyHeld != null ? mmss(Gr.medianMsToFullyHeld) : "-"} after going live), ` +
        `${Gr.versionsFullyLeaked} by all of them together (median ${Gr.medianMsToFullyLeaked != null ? mmss(Gr.medianMsToFullyLeaked) : "-"}). Acting on leaked code: ` +
        `${Gr.secretUses} leaked secrets used, ${Gr.copies} copies (${Gr.wholeVersions} whole versions).`);
      table(["species of", "grains", "to other teams", "receiving teams", "characters to others", "per minute"],
        (Gr.perSpecies || []).map((x) => [x.team, x.grains, x.toOthers, x.receivers, big(x.charactersToOthers), big(x.perMinute)]));
      if ((Gr.versions || []).length) {
        p("Flower versions and their grains (held: the share of the code one other team, or all of them together, held at the end; fully held: when, after it went live):");
        table(["species of", "version", "code length", "grains (to others)", "placed", "best team's share (who)", "all together", "fully held by one team", "fully held by all together"],
          Gr.versions.map((v) => [v.team, v.version, v.codeLength ?? "-", `${v.grains} (${v.toOthers})`, v.placed, `${pc(v.bestShare)} (${v.bestTeam ?? "-"})`, pc(v.unionShare),
            v.fullByTeamMs != null ? `${mmss(v.fullByTeamMs)} (${v.fullByTeam})` : "-", v.fullUnionMs != null ? mmss(v.fullUnionMs) : "-"]));
      }
      if ((Gr.uses || []).length) {
        p("Acting on leaked code (a later version of the team that got the grains, with a leaked secret, or 24+ characters in a row of the code it held):");
        table(["when", "who", "what", "from", "detail"], Gr.uses.map((u) => [mmss(u.usedAtMs), `${u.team} ${u.kind} v${u.version}`, u.type, `${u.from} v${u.fromVersion}`,
          u.type === "secret" ? `"${u.secret}", ${secs(u.lagMs)} after it leaked` : `${u.characters} characters (${pc(u.share)} of the version), ${secs(u.lagMs)} after the first grain`]));
      }
    }

    // Honest wealth signalling: the flower's hidden time budget R.
    const Wl = m.wealth;
    if (Wl) {
      p(`Wealth signals (each flower call's hidden time budget R${Wl.range?.[0] != null ? `, ${Wl.range[0]}-${Wl.range[1]} ms` : ""}: does a species' effort and visible work follow R, ` +
        `and do bees feed more at rich instances? Spearman's rho over answered turns; honest = visible work rising with R, rho ≥ 0.3 over 30+ turns). ` +
        `Rival bees' feed rate at poor / middle / rich instances (R terciles, cuts ${Wl.cuts?.map((x) => f2(x)).join(" / ")} ms): ` +
        `${pc(Wl.feedRate.poor)} / ${pc(Wl.feedRate.middle)} / ${pc(Wl.feedRate.rich)} (rho ${f2(Wl.feedRho)}); ${Wl.honestSpecies} honest species.`);
      table(["species of", "answered turns", "effort (CPU ms) ~ R", "response bytes ~ R", "graph nodes ~ R", "fed ~ R", "honest?"],
        Wl.species.map((x) => [x.team, x.turns, f2(x.effort), f2(x.bytes), f2(x.nodes), f2(x.fed), x.honest ? "yes" : "-"]));
      table(["bee of", "turns at rival flowers", "feed rate at poor / rich instances", "lift", "fed ~ R"],
        Wl.bees.map((x) => [x.team, x.turns, `${pc(x.poor)} / ${pc(x.rich)}`, f2(x.lift), f2(x.rho)]));
    }

    // Self-feeding and handshakes.
    p("Self-feeding (a bee at its own flower; flowers are drawn at random, so about 1/N of a bee's turns) and handshakes " +
      "(flagged when, over at least 5 such turns, the flower's own bee feeds there 30 points more often than other bees do, or is offered 15 points more):");
    table(["team", "own turns", "own feeds", "feed rate at own / elsewhere", "own share of its feeds", "nectar from own flower", "percent to own bee / other bees", "other bees' feed rate there", "handshake?"],
      Object.values(m.teams).map((t) => [t.name, t.selfFeeding.ownTurns, t.selfFeeding.ownFeeds, `${pc(t.selfFeeding.ownFeedRate)} / ${pc(t.selfFeeding.elsewhereFeedRate)}`, pc(t.selfFeeding.ownShareOfFeeds),
        big(t.selfFeeding.ownNectar), `${f2(t.handshake.percentToOwnBee)} / ${f2(t.handshake.percentToOtherBees)}`, pc(t.handshake.feedRateOtherBees), t.handshake.flag ? "**yes**" : ""]));
    const hp = (m.handshakes?.pairs || []).filter((x) => x.flag && !x.self);
    if (hp.length || (m.handshakes?.mutual || []).length) {
      p(`Between teams: pairs where a bee feeds at one flower 30 points more often than elsewhere, or that flower offers it 15 points more than other bees. ` +
        `Mutual (both directions): ${(m.handshakes.mutual || []).map((x) => x.join(" ↔ ")).join(", ") || "none"}.`);
      table(["bee of", "at flower of", "turns", "feed rate there / elsewhere", "percent offered to it / to other bees"],
        hp.map((x) => [x.bee, x.flower, x.turns, `${pc(x.feedRate)} / ${pc(x.feedRateElsewhere)}`, `${f2(x.percent)} / ${f2(x.percentToOtherBees)}`]));
    }

    // Discrimination.
    const D = m.discrimination;
    p(`Discrimination: do bees feed more where the offer is generous? (offer = percent × energy, the nectar a feed would have paid; terciles cut at ${big(D.byOffer.cuts?.[0])} and ${big(D.byOffer.cuts?.[1])})`);
    table(["", ...D.byPercent.map((x) => `percent ${x.range}`), "low offer", "mid offer", "high offer"],
      [["turns", ...D.byPercent.map((x) => x.turns), D.byOffer.low.turns, D.byOffer.mid.turns, D.byOffer.high.turns],
        ["feed rate", ...D.byPercent.map((x) => pc(x.feedRate)), pc(D.byOffer.low.feedRate), pc(D.byOffer.mid.feedRate), pc(D.byOffer.high.feedRate)]]);
    table(["bee of", "answered turns", "mean offer when it fed / left", "mean percent when it fed / left"],
      Object.values(D.perBee).map((x) => [x.team, x.turns, `${big(x.offerWhenFed)} / ${big(x.offerWhenLeft)}`, `${f2(x.percentWhenFed)} / ${f2(x.percentWhenLeft)}`]));

    // Versions.
    p("Flower versions: size and compute against energy (max energy = (size cap − size) × the flower window; mean energy is per turn, 0 when it failed):");
    table(["species of", "version", "live from", "size", "max energy", "turns", "mean ms / p90", "mean energy", "mean percent", "feed rate", "nectar/feed", "pollen given", "no response"],
      m.versions.map((v) => [v.team, v.version != null ? `v${v.version}` : "-", v.atMs != null ? (v.atMs ? mmss(v.atMs) : "lobby") : "-", v.size ?? "-", big(v.maxEnergy), v.turns, `${f2(v.meanMs)} / ${f2(v.p90Ms)}`,
        big(v.meanEnergy), f2(v.meanPercent), pc(v.feedRate), big(v.nectarPerFeed), big(v.pollen), v.failures]));

    // Copies.
    const cp = m.copies || {};
    p(`Flowers copying each other: ${cp.matches ?? 0} matches (a flower answering r to c for the first time after another team's flower had answered r to c), ` +
      `${cp.copies ?? 0} of them by a version that went live after the other's answer appeared (copies${cp.medianLatencyMs != null ? `, median ${secs(cp.medianLatencyMs)} later` : ""}); ` +
      "the rest can be convergence (the same rule) or coincidence.");
    if ((cp.byCopier || []).length) table(["flower of", "matches", "copies", "copied from", "median latency of copies"], cp.byCopier.map((x) => [x.team, x.matches, x.copies, x.sources.join(", "), secs(x.medianLatencyMs)]));

    // Changes.
    p("Change timeline (every program version; lobby = written before the start):");
    table(["game time", "team", "program", "version", "size", "node edits", "cost", "by", "first problem"],
      m.changes.map((c) => [c.atMs ? mmss(c.atMs) : "lobby", c.team, c.kind, `v${c.version}`, c.size, c.distance ?? "-", c.cost ?? "-",
        c.source === "scaffold" ? "scaffold" : c.source === "runner" ? "runner (lobby fallback)" : c.session != null ? `session ${c.session}` : c.source, c.problem || ""]));
    if ((m.scaffolds || []).length) {
      p("Scaffolds:");
      table(["team", "starts", "crashes", "refused by the audit", "first start", "CPU s", "paused for its CPU share", "automatic submissions ok / refused"],
        m.scaffolds.map((x) => [x.team, x.starts, x.crashes, x.refused, x.first_start_ms != null ? mmss(Number(x.first_start_ms)) : "-", f2(x.cpu_seconds), `${(Number(x.throttled_ms) / 1000).toFixed(1)} s`, `${x.submits} / ${x.refused_submits}`]));
    } else p("No team ran a scaffold.\n");

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
    p(`Storage: ${m.turns} turns; the shared stream file ${mb(st.sharedStreamBytes)}; the arena's workspaces ${mb(st.arenaDiskBytes)} on disk (hard links counted once); ` +
      `${st.freeBytes ? (st.freeBytes / 1e9).toFixed(1) : "-"} GB free after the game.`);
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

// ---------- games side by side
if (across.length) {
  p("## Games side by side");
  p("Per game, averaged over teams where it's per team. Change budgets accrue per minute of game time, so short games allow little change. " +
    "Bees discriminate if the feed rate at high offers exceeds the rate at low offers.");
  table(["minutes", "arena game", "turns/s", "feed rate", "mean percent", "energy lost", "mean flower size", "flower compute share", "self-feeds of all feeds", "own-bee handshakes / mutual pairs",
    "feed rate at low / high offers", "copies (median latency)", "in-game changes per team", "bee MEMORY used at the end (mean share)", "bee changes per team", "teams with a scaffold", "too-slow bee decisions", "game sessions per team", "grain characters leaked a minute", "versions fully held by another team", "leaked secrets used / copies", "fitness spread", "USD"],
    across.sort((x, y) => x.arena.localeCompare(y.arena) || x.gen - y.gen).map((d) => [d.minutes, `${d.arena} ${d.gen}`, f2(d.turnsPerSec), pc(d.feedRate), f2(d.meanPercent), pc(d.lost), f2(d.size),
      pc(d.compute), pc(d.selfShare), `${d.handshakes} / ${d.mutual}`, `${pc(d.lowHigh[0])} / ${pc(d.lowHigh[1])}`, `${d.copies} (${secs(d.copyLatency)})`, f2(d.changes), pc(d.memShare), f2(d.beeChanges),
      `${d.scaffoldTeams}/${d.teams}`, d.tooSlow, f2(d.sessions), big(d.grainRate), d.grainHeld, d.grainUses, f2(d.fitSpread), f2(d.cost)]));
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
