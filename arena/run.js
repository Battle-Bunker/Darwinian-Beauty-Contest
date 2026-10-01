#!/usr/bin/env node
// Arena runner: rooms of evolving LLM-agent populations playing Darwinian Beauty Contest via the HTTP API.
//
//   node arena/run.js --arena baseline --generations 6            # one arena (preset = id unless --preset)
//   node arena/run.js --arenas baseline,strdark,lists,tight --generations 6
//   node arena/run.js --arena pilot --preset pilot --generations 1
//
// Re-running the same command resumes from the database (arena schema): finished stages are skipped.
// Env: ARENA_API (default http://localhost:4000), ARENA_CONCURRENCY (8), ARENA_BUDGET_USD (global cap, 300),
//      ARENA_TEAM_EFFORT (medium), DATABASE_URL.
import fs from "node:fs";
import path from "node:path";
import { Api, ApiError, gamePath, login } from "./lib/api.js";
import { ARENA_DIR, all, migrate, one, pool, q } from "./lib/db.js";
import { BudgetError, PAUSE_FILE, SessionLimitError, isPaused, llmStats, setArenaCap, spend, waitIfPaused } from "./lib/llm.js";
import { storeMetrics } from "./lib/gamemetrics.js";
import { FOUNDERS } from "./lib/personas.js";
import { breed, decideRetirements, retire, seedBreeders } from "./lib/population.js";
import { PRESETS } from "./lib/presets.js";
import { interviewPrompt } from "./lib/prompts.js";
import { judgeGame, seedJudges } from "./lib/social.js";
import { interview, playTurn, playTurnTools } from "./lib/team.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const STAGES = ["created", "playing", "played", "interviewed", "judged", "done"];
const atLeast = (stage, s) => STAGES.indexOf(stage) >= STAGES.indexOf(s);

function logger(id) {
  const file = path.join(ARENA_DIR, "runs", `${id}.log`);
  return (msg) => {
    const line = `[${new Date().toISOString().slice(11, 19)}] [${id}] ${msg}`;
    fs.appendFileSync(file, line + "\n");
    console.log(line);
  };
}

// ---------------------------------------------------------------- arena setup

async function ensureArena(id, presetName, generations) {
  let arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
  if (arena) return arena;
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`unknown preset ${presetName}`);
  const owner = `Arena owner ${id}`;
  const tok = await login(owner);
  const room = await Api.createRoom(tok);
  const settings = { config: preset.config, teams: preset.lineup.length, generations, description: preset.description, recap: preset.recap || "full", unprimed: true, condition: preset.condition || null, mode: preset.mode || "prompt", budgetUsd: args.budget ? Number(args.budget) : null };
  await q("INSERT INTO arena.arenas (id, preset, settings, owner_name, room_short_id, room_url) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, presetName, settings, owner, room.shortId, room.url]);
  for (const [source, model, card] of preset.lineup) {
    if (model === "fable") throw new Error("no fable personas (v2 phase rule)");
    let row;
    if (source.startsWith("from:")) {
      // A strong persona from an earlier arena: same prompt and team, plus its last notebook (marked as v1 notes).
      const src = await one("SELECT * FROM arena.personas WHERE id = $1", [source.slice(5)]);
      if (!src) throw new Error(`unknown source persona ${source}`);
      const nb = src.notebook ? `(Your notes from an earlier tournament, under older rules: 100 turns per round, no MEMORY, no asks after feeding, ` +
        `different budgets. Some of it may not apply any more.)\n${src.notebook}` : "";
      row = { slug: src.slug, name: src.name, teamName: src.team_name, archetype: src.archetype, isKid: src.is_kid, prompt: src.persona_prompt, notebook: nb, source: src.id };
    } else {
      const slug = source.replace(/^founder:/, "");
      const f = FOUNDERS.find((x) => x.slug === slug);
      if (!f) throw new Error(`unknown founder ${slug}`);
      row = { slug, name: f.name, teamName: f.teamName, archetype: f.archetype, isKid: f.isKid, prompt: f.prompt, notebook: "", source: "founder" };
    }
    const pid = `${id}/${row.slug}`;
    await q(`INSERT INTO arena.personas (id, arena_id, slug, name, team_name, model, archetype, is_kid, persona_prompt, generation_born, notebook, idea_card, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12)`, [pid, id, row.slug, row.name, row.teamName, model, row.archetype, row.isKid, row.prompt, row.notebook, card || null, row.source]);
    await q("INSERT INTO arena.population_events (arena_id, generation, persona_id, event, reason, details) VALUES ($1,1,$2,'born',$3,$4)",
      [id, pid, row.source === "founder" ? "founder" : `seeded from ${row.source}`, JSON.stringify({ ideaCard: card || null })]);
  }
  return one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
}

// ---------------------------------------------------------------- recap of the previous game

async function recapFor(arena, generation) {
  const prev = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [arena.id, generation - 1]);
  if (!prev || !prev.game_short_id) return null;
  const view = await Api.view(null, gamePath(arena.room_short_id, prev.game_short_id), "none");
  if (!view.game.revealed) return null;
  const entries = await all("SELECT e.*, p.name FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1", [prev.id]);
  const names = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const last = view.rounds[view.rounds.length - 1];
  const lang = view.game.config.language === "typescript" ? "ts" : "python";
  const final = [...view.final].sort((a, b) => b.fitness - a.fitness);
  const lines = [`Final standings (fitness; panel social score 0-10 and rank):`];
  final.forEach((s, i) => {
    const e = entries.find((x) => x.team_id === s.teamId);
    lines.push(`${i + 1}. ${names[s.teamId]}: fitness ${s.fitness.toFixed(2)} (allure ${s.allure.toFixed(2)}, forage ${s.forage.toFixed(2)}); social ${e?.social?.toFixed(1) ?? "-"} (#${e?.social_rank ?? "-"})`);
  });
  if (arena.settings.recap === "scores") return { text: lines.join("\n") + "\n(Other teams' code is not shown in this arena.)", prevGameId: prev.id };
  lines.push(`\nFinal code of every team:`);
  for (const s of final) {
    const p = last.programs[s.teamId];
    lines.push(`### ${names[s.teamId]}\n` + ["clover", "orchid", "bee"].map((k) => `${k}:\n\`\`\`${lang}\n${(p[k].code || "").trim()}\n\`\`\``).join("\n"));
  }
  return { text: lines.join("\n"), prevGameId: prev.id };
}

async function personalFeedback(prevGameId, personaId) {
  if (!prevGameId) return "";
  const evs = await all("SELECT j.name, j.age, e.* FROM arena.evaluations e JOIN arena.judges j ON j.id = e.judge_id WHERE e.game_id = $1 AND e.persona_id = $2", [prevGameId, personaId]);
  if (!evs.length) return "";
  return `\nWhat the interview panel said about YOUR team last game:\n` + evs.map((e) =>
    `- ${e.name} (${e.age}): understanding ${e.understanding}, respect ${e.respect}, novelty ${e.novelty}, team-up ${e.team_up}. "${e.comment}"`).join("\n");
}

// ---------------------------------------------------------------- one generation

async function setupGame(arena, generation, log) {
  const ownerTok = await login(arena.owner_name);
  let gameRow = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [arena.id, generation]);
  if (!gameRow) {
    // Refill any empty slots first (e.g. after a crash between retiring and breeding).
    const active = await all("SELECT * FROM arena.personas WHERE arena_id = $1 AND status = 'active'", [arena.id]);
    const missing = arena.settings.teams - active.length;
    if (missing > 0) {
      const retired = await all(`SELECT * FROM arena.personas p WHERE arena_id = $1 AND status = 'retired'
                                   AND NOT EXISTS (SELECT 1 FROM arena.personas r WHERE r.replaced = p.id) ORDER BY retired_after DESC`, [arena.id]);
      for (const r of retired.slice(0, missing)) await breed(arena, generation - 1, { model: r.model, replacing: r.name, replacingId: r.id, reason: r.retire_reason }, log);
    }
    await waitIfPaused();
    const g = await Api.createGame(ownerTok, arena.room_short_id, arena.settings.config);
    await q("INSERT INTO arena.games (arena_id, generation, game_short_id, game_url, config) VALUES ($1,$2,$3,$4,$5)",
      [arena.id, generation, g.shortId, g.url, arena.settings.config]);
    gameRow = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [arena.id, generation]);
    log(`gen ${generation}: game ${g.url}`);
  }
  const gPath = gamePath(arena.room_short_id, gameRow.game_short_id);
  let entries = await all("SELECT * FROM arena.entries WHERE game_id = $1", [gameRow.id]);
  if (!entries.length) {
    const active = await all("SELECT * FROM arena.personas WHERE arena_id = $1 AND status = 'active' ORDER BY generation_born, id", [arena.id]);
    for (const p of active) {
      const loginName = `${p.name} · ${arena.id}`;
      const tok = await login(loginName);
      let team;
      try { team = await Api.createTeam(tok, gPath, p.team_name); }
      catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409) throw e;
        const v = await Api.view(tok, gPath);
        team = v.myTeam ? { id: v.myTeam.id, name: v.myTeam.name } : await Api.createTeam(tok, gPath, `${p.team_name} ${generation}`);
      }
      await q("INSERT INTO arena.entries (game_id, persona_id, team_id, team_name, login_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [gameRow.id, p.id, team.id, team.name, loginName]);
    }
    entries = await all("SELECT * FROM arena.entries WHERE game_id = $1", [gameRow.id]);
  }
  return { ownerTok, gameRow, gPath, entries };
}

async function playGame(arena, generation, { ownerTok, gameRow, gPath, entries }, log) {
  await q("UPDATE arena.games SET stage = 'playing' WHERE id = $1 AND stage = 'created'", [gameRow.id]);
  const personas = await all("SELECT * FROM arena.personas WHERE id = ANY($1)", [entries.map((e) => e.persona_id)]);
  const recap = generation > 1 && arena.settings.mode !== "tools" ? await recapFor(arena, generation) : null;
  let view = await Api.view(ownerTok, gPath);
  const rounds = view.game.config.rounds;
  if (!gameRow.condition) {
    const condition = arena.settings.condition || (arena.settings.unprimed ? "unprimed" : "post-primed");
    await q("UPDATE arena.games SET condition = $2 WHERE id = $1 AND condition IS NULL", [gameRow.id, condition]);
  }
  for (let r = view.game.roundsPlayed + 1; r <= rounds; r++) {
    const t0 = Date.now();
    // After round 1 only participants play (a team that had no valid programs for round 1 sits the game out).
    const players = r === 1 ? personas : personas.filter((p) => view.participants?.includes(entries.find((e) => e.persona_id === p.id)?.team_id));
    const results = await Promise.all(players.map(async (p) => {
      const entry = entries.find((e) => e.persona_id === p.id);
      // Resume safety: don't pay twice for a turn whose reply was already processed before a restart.
      const done = await one("SELECT 1 FROM arena.agent_turns WHERE game_id = $1 AND persona_id = $2 AND round_no = $3 AND error IS NULL LIMIT 1", [gameRow.id, p.id, r]);
      if (done) {
        const tok = await login(entry.login_name);
        const v = await Api.view(tok, gPath);
        if (r > 1 || ["clover", "orchid", "bee"].every((k) => v.myTeam.drafts[k])) { log(`  ${p.name}: round ${r} turn already done before restart; skipping`); return { submitted: [], failed: [], cost: 0 }; }
      }
      const personalRecap = arena.settings.mode !== "tools" && r === 1 && recap ? recap.text + (await personalFeedback(recap.prevGameId, p.id)) : null;
      try {
        if (arena.settings.mode === "tools") return await playTurnTools({ arena, gameRow, persona: p, entry, gPath, roundNo: r, log });
        return await playTurn({ arena, gameRow, persona: p, entry, gPath, roundNo: r, recap: personalRecap, log });
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        log(`  ${p.name}: turn failed: ${e.stack || e.message}`);
        if (r === 1) {
          log(`  ${p.name}: SITS OUT this game (turn failed before round 1)`);
          await q("UPDATE arena.entries SET sat_out = true WHERE game_id = $1 AND persona_id = $2", [gameRow.id, p.id]);
        }
        return { submitted: [], failed: ["all"], cost: 0 };
      }
    }));
    const tAgents = Date.now() - t0;
    await waitIfPaused(); // games don't advance while paused
    await Api.runRound(ownerTok, gPath);
    view = await Api.view(ownerTok, gPath);
    const rd = view.rounds[r - 1];
    const names = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
    const s = await spend(arena.id);
    log(`gen ${generation} round ${r}: agents ${Math.round(tAgents / 1000)}s, cost $${results.reduce((a, x) => a + x.cost, 0).toFixed(2)} (arena $${s.arena.toFixed(2)}, all $${s.global.toFixed(2)}); ` +
      `feeds ${rd.visits.filter((v) => v.action === "feed").length}, nectar ${rd.visits.filter((v) => v.nectar).length}; ` +
      [...rd.totals].sort((a, b) => b.fitness - a.fitness).map((x) => `${names[x.teamId]} ${x.fitness.toFixed(2)}`).join(", "));
  }
  await q("UPDATE arena.games SET stage = 'played', finished_at = now() WHERE id = $1", [gameRow.id]);
}

async function analyseGame(arena, generation, { ownerTok, gameRow, gPath, entries }, log) {
  const view = await Api.view(ownerTok, gPath);
  if (!view.game.revealed) throw new Error("game not revealed; metrics need revealOnFinish");
  const { gm } = await storeMetrics(arena, gameRow, view);
  const final = [...view.final].sort((a, b) => b.fitness - a.fitness);
  for (const e of entries) {
    const s = view.final.find((x) => x.teamId === e.team_id);
    if (!s) continue;
    await q("UPDATE arena.entries SET fitness = $3, fitness_rank = $4, allure = $5, forage = $6 WHERE game_id = $1 AND persona_id = $2",
      [gameRow.id, e.persona_id, s.fitness, final.indexOf(s) + 1, s.allure, s.forage]);
  }
  log(`gen ${generation} final: ${final.map((x) => `${entries.find((e) => e.team_id === x.teamId)?.team_name} ${x.fitness.toFixed(2)}`).join(", ")}; collapses: ${gm.collapses.map((f) => f.mode).join(", ") || "none"}; orchid targets ${JSON.stringify(gm.orchidTargets)}`);
  return view;
}

async function socialEvaluation(arena, generation, ctx, log) {
  const { gameRow, gPath } = ctx;
  const entries = await all("SELECT * FROM arena.entries WHERE game_id = $1 AND NOT sat_out", [gameRow.id]);
  const personas = await all("SELECT * FROM arena.personas WHERE id = ANY($1)", [entries.map((e) => e.persona_id)]);
  if (!atLeast(gameRow.stage, "interviewed")) {
    await Promise.all(entries.filter((e) => !e.explanation).map(async (e) => {
      const p = personas.find((x) => x.id === e.persona_id);
      try {
        const ex = await interview({ arena, gameRow, persona: p, entry: e, gPath, buildPrompt: interviewPrompt });
        await q("UPDATE arena.entries SET explanation = $3 WHERE game_id = $1 AND persona_id = $2", [gameRow.id, e.persona_id, ex]);
      } catch (err) {
        if (err instanceof BudgetError) throw err;
        log(`  interview ${p.name} failed: ${err.message}`);
        await q("UPDATE arena.entries SET explanation = $3 WHERE game_id = $1 AND persona_id = $2", [gameRow.id, e.persona_id, "(no explanation: the interview failed)"]);
      }
    }));
    await q("UPDATE arena.games SET stage = 'interviewed' WHERE id = $1", [gameRow.id]);
    gameRow.stage = "interviewed";
    log(`gen ${generation}: interviews done`);
  }
  if (!atLeast(gameRow.stage, "judged")) {
    const view = await Api.view(null, gPath, "none");
    const last = view.rounds[view.rounds.length - 1];
    const fresh = await all("SELECT * FROM arena.entries WHERE game_id = $1 AND NOT sat_out", [gameRow.id]);
    const teams = fresh.map((e) => ({
      persona_id: e.persona_id, name: e.team_name, explanation: e.explanation,
      code: Object.fromEntries(["clover", "orchid", "bee"].map((k) => [k, last.programs[e.team_id]?.[k]?.code || ""])),
    }));
    const res = await judgeGame({ arena, gameRow, config: view.game.config, teams, log });
    await q("UPDATE arena.games SET stage = 'judged' WHERE id = $1", [gameRow.id]);
    gameRow.stage = "judged";
    const rows = await all("SELECT team_name, social, social_rank, social_parts FROM arena.entries WHERE game_id = $1 ORDER BY social_rank NULLS LAST", [gameRow.id]);
    log(`gen ${generation} social (${res.evaluations} evaluations): ${rows.map((r) => `${r.team_name} ${r.social?.toFixed(2) ?? "-"}${r.social_parts?.newIdeas?.length ? ` [+${r.social_parts.newIdeas.length} new ideas]` : ""}`).join(", ")}`);
  }
}

async function evolve(arena, generation, isLast, gameRow, log) {
  if (atLeast(gameRow.stage, "done")) return;
  const already = await one("SELECT count(*)::int AS n FROM arena.population_events WHERE arena_id = $1 AND generation = $2 AND event = 'retired'", [arena.id, generation]);
  if (!already.n) {
    const out = await decideRetirements(arena, generation, log);
    for (const c of out) {
      log(`gen ${generation}: RETIRE ${c.persona.name} (${c.persona.team_name}, ${c.persona.model}): ${c.reason}`);
      await retire(arena, generation, c);
    }
  }
  if (!isLast) {
    const retired = await all(`SELECT * FROM arena.personas p WHERE arena_id = $1 AND status = 'retired' AND retired_after = $2
                                 AND NOT EXISTS (SELECT 1 FROM arena.personas r WHERE r.replaced = p.id)`, [arena.id, generation]);
    for (const r of retired) {
      try { await breed(arena, generation, { model: r.model, replacing: r.name, replacingId: r.id, reason: r.retire_reason }, log); }
      catch (e) { if (e instanceof BudgetError) throw e; log(`  breeding failed: ${e.message} (will retry before the next game)`); }
    }
  }
  await q("UPDATE arena.games SET stage = 'done' WHERE id = $1", [gameRow.id]);
}

async function runArena(id, presetName, generations) {
  const log = logger(id);
  let arena = await ensureArena(id, presetName, generations);
  arena.settings.generations = generations;
  await q("UPDATE arena.arenas SET settings = $2, status = 'running' WHERE id = $1", [id, arena.settings]);
  setArenaCap(id, arena.settings.budgetUsd);
  log(`arena ${id} (${arena.preset}): room ${arena.room_url}, ${generations} generations`);
  try {
    for (let gen = 1; gen <= generations; gen++) {
      const existing = await one("SELECT stage FROM arena.games WHERE arena_id = $1 AND generation = $2", [id, gen]);
      if (existing?.stage === "done") continue;
      const ctx = await setupGame(arena, gen, log);
      if (!atLeast(ctx.gameRow.stage, "played")) await playGame(arena, gen, ctx, log);
      ctx.gameRow = await one("SELECT * FROM arena.games WHERE id = $1", [ctx.gameRow.id]);
      if (!ctx.gameRow.metrics) await analyseGame(arena, gen, ctx, log);
      await socialEvaluation(arena, gen, ctx, log);
      await evolve(arena, gen, gen === generations, ctx.gameRow, log);
      const s = await spend(id);
      log(`gen ${gen} done. Spend: arena $${s.arena.toFixed(2)}, all $${s.global.toFixed(2)}. LLM ${JSON.stringify(llmStats())}`);
    }
    await q("UPDATE arena.arenas SET status = 'done' WHERE id = $1", [id]);
    log(`arena ${id} finished`);
  } catch (e) {
    if (e instanceof SessionLimitError) {
      await q("UPDATE arena.arenas SET status = 'stopped-limit' WHERE id = $1", [id]);
      log(`STOPPED (account session limit): ${e.message}`);
    } else if (e instanceof BudgetError) {
      await q("UPDATE arena.arenas SET status = 'stopped-budget' WHERE id = $1", [id]);
      log(`STOPPED: ${e.message}`);
    } else {
      await q("UPDATE arena.arenas SET status = 'error' WHERE id = $1", [id]);
      log(`ERROR: ${e.stack || e.message}`);
    }
  }
}

async function main() {
  if (isPaused()) console.log(`[arena] starting PAUSED (${PAUSE_FILE} exists): games resume from the database once it is deleted`);
  await migrate();
  await seedJudges();
  await seedBreeders();
  // --arenas a,b:4,c  (optional per-arena generation count after a colon; default --generations)
  const generations = Number(args.generations || 1);
  const list = (args.arenas ? String(args.arenas).split(",") : [String(args.arena || "pilot")]).map((x) => x.split(":"));
  const presetOf = (id) => (args.preset && list.length === 1 ? String(args.preset) : id.replace(/-\d+$/, ""));
  await Promise.all(list.map(([id, g]) => runArena(id, presetOf(id), Number(g || generations))));
  await pool.end();
}

process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
main().catch((e) => { console.error(e); process.exit(1); });
