#!/usr/bin/env node
// Arena runner: LLM-agent teams playing continuous games of Darwinian Beauty Contest through the HTTP API.
// A game: the room owner creates it; every team writes its two programs (flower, bee) in the lobby (one tool-using session each,
// in parallel, lib/team.js); the owner starts it; while it runs, every team has sessions back to back (the first ones
// start a few seconds before the game does), watching the live stream and submitting changes through its workspace
// tools; when the game's clock runs out, running sessions are stopped. Then: metrics, interviews, the teen judges,
// and (unless the arena has fixed membership) retirements and breeding.
//
//   node arena/run.js --arena pilot --games 3      # a fresh arena from a preset (preset = id unless --preset)
//   node arena/run.js --arenas a:2,b:3             # several arenas in one process (":n" = games)
//   node arena/run.js --experiment NAME --budget 50   # a cohort experiment (lib/presets.js EXPERIMENTS), interleaved;
//                                                     # --budget caps each cohort
//
// Re-running the same command resumes from the database (arena schema): finished stages are skipped.
// Env: ARENA_API (default http://localhost:4100), ARENA_CONCURRENCY (8), ARENA_BUDGET_USD (global cap, 300),
//      ARENA_SESSION_LIMITS, ARENA_WS_ROOT, ARENA_DATABASE_URL.
import fs from "node:fs";
import path from "node:path";
import { Api, ApiError, gamePath, login } from "./lib/api.js";
import { ARENA_DIR, all, migrate, one, pool, q } from "./lib/db.js";
import { BudgetError, GLOBAL_CAP, PAUSE_FILE, isPaused, llmStats, pause, setArenaCap, setConcurrency, spend, waitIfPaused } from "./lib/llm.js";
import { WS_ROOT, diskBytes, killLeftovers, wsDir } from "./lib/workspace.js";
import { publicGameUrl } from "./lib/api.js";
import { GameStream, readMemorySamples } from "./lib/stream.js";
import { syncPause } from "./lib/gamecontrol.js";
import { computeGameMetrics, scaffoldsOf, submitsOf } from "./lib/metrics.js";
import { FOUNDERS, ROLE_PERSONAS, withoutCodingLimits } from "./lib/personas.js";
import { breed, decideRetirements, retire, seedBreeders } from "./lib/population.js";
import { DEFAULT_SESSION, EXPERIMENTS, PRESETS } from "./lib/presets.js";
import { gameBrief, mmss } from "./lib/prompts.js";
import { judgeGame, seedJudges } from "./lib/social.js";
import { TeamDesk, finalPrograms, interview, lobby, runTeamSession } from "./lib/team.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
  return acc;
}, []));

const STAGES = ["created", "lobby-done", "playing", "played", "interviewed", "judged", "done"];
const atLeast = (stage, s) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KINDS = ["flower", "bee"];

function logger(id) {
  const file = path.join(ARENA_DIR, "runs", `${id}.log`);
  return (msg) => {
    const line = `[${new Date().toISOString().slice(11, 19)}] [${id}] ${msg}`;
    fs.appendFileSync(file, line + "\n");
    console.log(line);
  };
}

// Running games and their sessions, so a shutdown can pause the games and stop the sessions.
const live = new Map(); // arena game id -> { ownerTok, gPath, controls: Map(personaId -> control), stream }

// ---------------------------------------------------------------- arena setup

async function ensureArena(id, presetName, games, extra = {}) {
  let arena = await one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
  if (arena) return arena;
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`unknown preset ${presetName}`);
  const owner = `Arena owner ${id}`;
  const tok = await login(owner);
  const room = await Api.createRoom(tok);
  const settings = {
    config: preset.config, minutesByGame: preset.minutesByGame || null, teams: preset.lineup.length, games, description: preset.description,
    session: { ...DEFAULT_SESSION, ...(preset.session || {}) }, limits: preset.limits || null, maxModel: preset.maxModel || null,
    prompts: preset.prompts || null, concurrency: preset.concurrency || null, expectConfig: preset.expectConfig || null, honest: preset.honest || null,
    reserveUsd: preset.reserveUsd ?? 5, noEvolution: !!preset.noEvolution, examples: preset.examples || null, scaffold: preset.scaffold || null, budgetUsd: args.budget ? Number(args.budget) : null,
    ...extra,
  };
  // Lineup options ([source, model, opts]): role ("honest" | "defector": a private brief, with the role's documents in
  // common/), and seed (a persona from an earlier arena carried over as it was: its last programs as its starting
  // programs, its notebook, and the files it wrote in its workspace).
  settings.roles = {};
  settings.seeds = {};
  settings.starts = {}; // start: { bee: file }: a new persona's first programs (the honest teams' reference bee in adapt-hi)
  for (const [source, , opts = {}] of preset.lineup) {
    const slug = source.startsWith("from:") ? source.slice(5).split("/").pop() : source.replace(/^founder:/, "");
    if (opts.role) settings.roles[slug] = { role: opts.role, common: opts.common || null, ...(opts.brief ? { brief: opts.brief } : {}) };
    if (opts.seed && source.startsWith("from:")) settings.seeds[slug] = source.slice(5);
    if (opts.start) settings.starts[slug] = opts.start;
  }
  await q("INSERT INTO arena.arenas (id, preset, settings, owner_name, room_short_id, room_url) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, presetName, settings, owner, room.shortId, room.url]);
  for (const [source, model, opts = {}] of preset.lineup) {
    if (!["opus", "sonnet", "haiku"].includes(model)) throw new Error(`model ${model} not allowed (opus, sonnet or haiku)`);
    let row;
    if (source.startsWith("from:")) {
      const src = await one("SELECT * FROM arena.personas WHERE id = $1", [source.slice(5)]);
      if (!src) throw new Error(`unknown source persona ${source}`);
      // A seeded persona keeps its notes as they were (the same rules); else they come with a caveat.
      const nb = !src.notebook ? "" : opts.seed ? `(Your notes from your last tournament.)\n${src.notebook}`
        : `(Your notes from an earlier tournament, possibly under older rules. Some of it may not apply any more.)\n${src.notebook}`;
      // uncap: the persona without its coding limits (a kid's "only things you understand"); the rest of it as it was.
      row = { slug: src.slug, name: src.name, teamName: src.team_name, archetype: src.archetype, isKid: src.is_kid, prompt: opts.uncap ? withoutCodingLimits(src.slug, src.persona_prompt) : src.persona_prompt, notebook: nb, source: src.id };
    } else {
      const slug = source.replace(/^founder:/, "");
      const f = FOUNDERS.find((x) => x.slug === slug) || ROLE_PERSONAS.find((x) => x.slug === slug);
      if (!f) throw new Error(`unknown founder ${slug}`);
      row = { slug, name: f.name, teamName: f.teamName, archetype: f.archetype, isKid: f.isKid, prompt: f.prompt, notebook: "", source: "founder" };
    }
    const pid = `${id}/${row.slug}`;
    await q(`INSERT INTO arena.personas (id, arena_id, slug, name, team_name, model, archetype, is_kid, persona_prompt, generation_born, notebook, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11)`, [pid, id, row.slug, row.name, row.teamName, model, row.archetype, row.isKid, row.prompt, row.notebook, row.source]);
    await q("INSERT INTO arena.population_events (arena_id, generation, persona_id, event, reason, details) VALUES ($1,1,$2,'born',$3,$4)",
      [id, pid, row.source === "founder" ? "founder" : `seeded from ${row.source}`, { role: opts.role || null, brief: opts.brief || null, seed: !!opts.seed, uncapped: !!opts.uncap }]);
    if (opts.seed && row.source !== "founder") seedWorkspace(row.source, id, row.slug);
  }
  return one("SELECT * FROM arena.arenas WHERE id = $1", [id]);
}

/** Game N's config: the arena's, with this game's duration. */
function configFor(arena, generation) {
  const m = arena.settings.minutesByGame;
  return { ...arena.settings.config, ...(m?.length ? { minutes: m[Math.min(generation, m.length) - 1] } : {}) };
}

async function setupGame(arena, generation, log) {
  const ownerTok = await login(arena.owner_name);
  let gameRow = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [arena.id, generation]);
  if (!gameRow) {
    // Refill empty slots first (e.g. after a crash between retiring and breeding).
    const active = await all("SELECT * FROM arena.personas WHERE arena_id = $1 AND status = 'active'", [arena.id]);
    const missing = arena.settings.teams - active.length;
    if (missing > 0) {
      const retired = await all(`SELECT * FROM arena.personas p WHERE arena_id = $1 AND status = 'retired'
                                   AND NOT EXISTS (SELECT 1 FROM arena.personas r WHERE r.replaced = p.id) ORDER BY retired_after DESC`, [arena.id]);
      for (const r of retired.slice(0, missing)) await breed(arena, generation - 1, { model: r.model, replacing: r.name, replacingId: r.id, reason: r.retire_reason }, log);
    }
    await waitIfPaused();
    const config = configFor(arena, generation);
    const g = await Api.createGame(ownerTok, arena.room_short_id, config);
    const view = await Api.view(ownerTok, gamePath(arena.room_short_id, g.shortId));
    // A preset that relies on the server's defaults (adapt-hi: the new R floor, feed cost and score exponents) checks
    // them on its first game, before any session runs: an old server would play the old rules.
    for (const [key, want] of Object.entries(arena.settings.expectConfig || {})) {
      const got = key.split(".").reduce((o, k) => o?.[k], view.game.config);
      if (got !== want) throw new Error(`the server's game config has ${key} = ${JSON.stringify(got)}, not ${JSON.stringify(want)}: restart it with the engine's new defaults (arena/server.sh)`);
    }
    await q("INSERT INTO arena.games (arena_id, generation, game_short_id, game_url, game_uuid, config) VALUES ($1,$2,$3,$4,$5,$6)",
      [arena.id, generation, g.shortId, g.url, view.game.id, view.game.config]);
    gameRow = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [arena.id, generation]);
    log(`game ${generation}: ${view.game.config.minutes} min, ${g.url}`);
  }
  const gPath = gamePath(arena.room_short_id, gameRow.game_short_id);
  let entries = await all("SELECT * FROM arena.entries WHERE game_id = $1", [gameRow.id]);
  if (!entries.length) {
    const active = await all("SELECT * FROM arena.personas WHERE arena_id = $1 AND status = 'active' ORDER BY generation_born, id", [arena.id]);
    for (const p of active) {
      // One login per persona (its id is unique): two personas with the same name must never share a team.
      const loginName = `${p.name} · ${p.id}`;
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

/** The persona's final programs from the last game it played in this arena (its starting point in the lobby). */
async function carryOver(arena, generation, personaId) {
  const prev = await one(`SELECT g.game_short_id, e.team_id FROM arena.entries e JOIN arena.games g ON g.id = e.game_id
                           WHERE g.arena_id = $1 AND g.generation < $2 AND e.persona_id = $3 AND NOT e.sat_out ORDER BY g.generation DESC LIMIT 1`, [arena.id, generation, personaId]);
  if (prev) return (await finalPrograms(gamePath(arena.room_short_id, prev.game_short_id)))[prev.team_id]?.code || null;
  // A persona with start programs (settings.starts): those, in its first game.
  const start = arena.settings.starts?.[personaId.split("/").pop()];
  if (start) return startPrograms(start);
  // A seeded persona's first game: its final programs from its last game in its source arena.
  const src = arena.settings.seeds?.[personaId.split("/").pop()];
  if (!src) return null;
  const last = await one(`SELECT g.game_short_id, e.team_id, a.room_short_id FROM arena.entries e JOIN arena.games g ON g.id = e.game_id JOIN arena.arenas a ON a.id = g.arena_id
                           WHERE e.persona_id = $1 AND NOT e.sat_out ORDER BY g.generation DESC LIMIT 1`, [src]);
  if (!last) return null;
  return (await finalPrograms(gamePath(last.room_short_id, last.game_short_id)))[last.team_id]?.code || null;
}

/** Start programs ({ kind: file under the repo }) as code; a missing file stops the runner (checked before an experiment). */
function startPrograms(start) {
  return Object.fromEntries(Object.entries(start).map(([k, f]) => [k, fs.readFileSync(path.resolve(ARENA_DIR, "..", f), "utf8")]));
}

/** The files a seeded persona wrote in its source arena's workspace (its scripts, scaffold, data), copied into its new
 * workspace; that arena's previous games go to earlier-tournament/. Runner-managed files are left out (they are
 * rebuilt), and so are its programs (they come as the starting programs) and notebook (it comes with the persona). */
const SOURCE_WS_ROOT = process.env.ARENA_SOURCE_WS_ROOT || "/home/user/arena-ws";
const RUNNER_FILES = new Set(["RULES.md", "README.md", "interface.txt", "config.json", "status.txt", "notebook.md", "tools", "stream", "history", "drafts",
  "previous-games", "common", "examples", ".runner", ".game", "scaffold", "cache", "flower.py", "bee.py", "flower.ts", "bee.ts", "__pycache__"]);
function seedWorkspace(sourcePersonaId, arenaId, slug) {
  const [srcArena, srcSlug] = sourcePersonaId.split("/");
  const from = path.join(SOURCE_WS_ROOT, srcArena, srcSlug), to = wsDir(arenaId, slug);
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (RUNNER_FILES.has(f) || /\.minified\.(py|ts)$/.test(f)) continue;
    fs.cpSync(path.join(from, f), path.join(to, f), { recursive: true, dereference: false });
  }
  if (fs.existsSync(path.join(from, "previous-games"))) fs.cpSync(path.join(from, "previous-games"), path.join(to, "earlier-tournament"), { recursive: true });
}

// ---------------------------------------------------------------- one game

// Disk: below 4 GB free on the workspace disk the runner pauses (same pause file as usage limits).
const MIN_FREE_BYTES = 4e9;
function diskLow(log) {
  const st = fs.statfsSync(fs.existsSync(WS_ROOT) ? WS_ROOT : ARENA_DIR);
  const free = st.bavail * st.bsize;
  if (free >= MIN_FREE_BYTES) return false;
  const msg = `${(free / 1e9).toFixed(1)} GB free on the workspace disk (${WS_ROOT}), under ${MIN_FREE_BYTES / 1e9} GB`;
  log(`PAUSING: low disk: ${msg}`);
  pause(msg, "low disk");
  return true;
}

/** Can a new team session start without eating the reserve kept for interviews and judges? */
async function budgetOk(arena) {
  const s = await spend(arena.id);
  const reserve = arena.settings.reserveUsd ?? 5;
  if (s.global + reserve >= GLOBAL_CAP) return `global spend $${s.global.toFixed(2)} + reserve $${reserve} reaches the cap $${GLOBAL_CAP}`;
  if (arena.settings.budgetUsd && s.arena + reserve >= arena.settings.budgetUsd) return `arena spend $${s.arena.toFixed(2)} + reserve $${reserve} reaches its cap $${arena.settings.budgetUsd}`;
  return null;
}

/** Keep the game's pause state in line with the pause file (lib/gamecontrol.js). */
async function syncGamePause(ctx, stream, log) {
  const r = await syncPause({
    paused: isPaused(), status: stream.status, setStatus: (action) => Api.status(ctx.ownerTok, ctx.gPath, action),
    pausedBy: async () => (await one("SELECT paused_by FROM arena.games WHERE id = $1", [ctx.gameRow.id]))?.paused_by,
    markPausedBy: (by) => q("UPDATE arena.games SET paused_by = $2 WHERE id = $1", [ctx.gameRow.id, by]),
  });
  if (r) { stream.status = r === "paused" ? "paused" : "running"; log(`  game ${r} at ${mmss(stream.clockMs)}${r === "paused" ? " (the pause file exists)" : ""}`); }
}

async function lobbyStage(arena, ctx, stream, desks, log) {
  const { gameRow, gPath, entries } = ctx;
  const personas = await all("SELECT * FROM arena.personas WHERE id = ANY($1)", [entries.map((e) => e.persona_id)]);
  const examples = arena.settings.examples ? fs.readdirSync(path.resolve(ARENA_DIR, "..", arena.settings.examples)) : null;
  const t0 = Date.now();
  const res = await Promise.all(entries.map(async (e) => {
    const p = personas.find((x) => x.id === e.persona_id);
    // Resume: a team that already has both programs and a lobby session is done.
    const done = await one("SELECT 1 FROM arena.sessions WHERE game_id = $1 AND persona_id = $2 AND phase = 'lobby' AND ended_at IS NOT NULL LIMIT 1", [gameRow.id, p.id]);
    if (done) {
      const t = (await Api.view(ctx.ownerTok, gPath)).teams.find((x) => x.id === e.team_id);
      if (KINDS.every((k) => t?.ready?.[k])) return { p, ready: true, violation: false };
    }
    try {
      const carry = await carryOver(arena, gameRow.generation, p.id);
      return { p, ...(await lobby({ desk: desks.get(p.id), arena, gameRow, persona: p, entry: e, gPath, stream, log, carry, examples })) };
    } catch (err) {
      if (err instanceof BudgetError) throw err;
      log(`  ${p.name}: lobby failed: ${err.stack || err.message}`);
      return { p, ready: false, violation: false };
    }
  }));
  for (const r of res) {
    if (!r.ready) log(`  ${r.p.name}: not both programs submitted: SITS OUT game ${gameRow.generation}`);
    if (r.violation) log(`  ${r.p.name}: fair-play violation in the lobby: no sessions during game ${gameRow.generation}`);
  }
  await q("UPDATE arena.games SET stage = 'lobby-done' WHERE id = $1", [gameRow.id]);
  const s = await spend(arena.id);
  log(`game ${gameRow.generation}: lobby done in ${Math.round((Date.now() - t0) / 1000)} s (arena $${s.arena.toFixed(2)}, all $${s.global.toFixed(2)})`);
  return res;
}

async function playGame(arena, ctx, log) {
  const { ownerTok, gameRow, gPath } = ctx;
  const gen = gameRow.generation;
  let view = await Api.view(ownerTok, gPath);
  const teams = view.teams.map((t) => ({ id: t.id, name: t.name }));
  const stream = new GameStream({ root: path.join(WS_ROOT, arena.id), gen, gPath, gameUuid: gameRow.game_uuid, teams, grainsPublic: view.game.config?.grains === "public", log }).load();
  // Every team's desk (its tools' requests, its scaffold) lives from the lobby to the end of the game.
  const allEntries = await all("SELECT * FROM arena.entries WHERE game_id = $1", [gameRow.id]);
  const allPersonas = await all("SELECT * FROM arena.personas WHERE id = ANY($1)", [allEntries.map((e) => e.persona_id)]);
  const desks = new Map();
  const apiBase = publicGameUrl(arena.room_short_id, gameRow.game_short_id);
  for (const e of allEntries) {
    const p = allPersonas.find((x) => x.id === e.persona_id);
    desks.set(p.id, await new TeamDesk({ arena, gameRow, persona: p, entry: e, gPath, dir: wsDir(arena.id, p.slug), stream, log, apiBase }).start());
  }
  const state = { ownerTok, gPath, controls: new Map(), stream, over: false, desks };
  live.set(gameRow.id, state);
  // After a runner restart: scaffolds that were running are started again (re-audited).
  for (const r of await all(`SELECT DISTINCT ON (persona_id) persona_id, file, status, ended_at FROM arena.scaffolds WHERE game_id = $1 ORDER BY persona_id, id DESC`, [gameRow.id])) {
    if (r.status !== "running" || view.game.status === "finished") continue;
    await q("UPDATE arena.scaffolds SET status = 'stopped', ended_at = coalesce(ended_at, now()) WHERE game_id = $1 AND persona_id = $2 AND status = 'running'", [gameRow.id, r.persona_id]);
    await desks.get(r.persona_id)?.scaffold.start(r.file, { action: "resume" });
  }
  let lobbyRes = null;
  if (gameRow.stage === "created") lobbyRes = await lobbyStage(arena, ctx, stream, desks, log);
  // A violation in the lobby costs the team its sessions during the game.
  const barred = new Set((await all("SELECT DISTINCT persona_id FROM arena.sessions WHERE game_id = $1 AND phase = 'lobby' AND violation", [gameRow.id])).map((r) => r.persona_id));
  view = await Api.view(ownerTok, gPath);
  const S = { ...DEFAULT_SESSION, ...(arena.settings.session || {}) };
  const entries = await all("SELECT * FROM arena.entries WHERE game_id = $1", [gameRow.id]);
  const personas = await all("SELECT * FROM arena.personas WHERE id = ANY($1)", [entries.map((e) => e.persona_id)]);
  const ready = (t) => t && (view.game.status !== "lobby" ? view.participants?.includes(t.id) : KINDS.every((k) => t.ready?.[k]));
  const players = entries.filter((e) => ready(view.teams.find((t) => t.id === e.team_id)));
  if (players.length < 2) {
    for (const d of desks.values()) await d.stop("no game");
    live.delete(gameRow.id);
    throw new Error(`game ${gen}: only ${players.length} team(s) have both programs; a game needs 2`);
  }
  stream.status = view.game.status;
  stream.clockMs = view.game.clockMs;
  const endMs = view.game.endMs;
  const over = () => state.over || stream.status === "finished";
  let budgetStop = null;
  const autoCounts = new Map();
  const autoCount = (personaId) => autoCounts.get(personaId) || 0;
  const refreshAuto = async () => {
    for (const r of await all("SELECT persona_id, count(*)::int AS n FROM arena.requests WHERE game_id = $1 AND source = 'scaffold' AND op = 'submit' AND ok GROUP BY 1", [gameRow.id])) autoCounts.set(r.persona_id, r.n);
  };

  // One team's sessions, back to back, while the game lasts.
  const sessionsOf = async (e) => {
    const p = personas.find((x) => x.id === e.persona_id);
    if (barred.has(p.id)) return;
    let no = ((await one("SELECT max(no)::int AS n FROM arena.sessions WHERE game_id = $1 AND persona_id = $2", [gameRow.id, p.id]))?.n || 0) + 1;
    let penaltyUntil = 0, idle = 0;
    while (!over()) {
      if (isPaused() || stream.status === "paused") { await sleep(1000); continue; }
      if (Date.now() < penaltyUntil) { await sleep(1000); continue; }
      if (stream.status === "running" && endMs - stream.clockMs < S.endMarginSeconds * 1000) break;
      const why = await budgetOk(arena);
      if (why) { if (!budgetStop) { budgetStop = why; log(`  no more sessions: ${why}`); } break; }
      if (diskLow(log)) continue;
      const control = {};
      state.controls.set(p.id, control);
      await refreshAuto().catch(() => {});
      try {
        const head = stream.headline(e.team_id);
        const desk = desks.get(p.id);
        const s = await runTeamSession({
          desk, arena, gameRow, persona: p, entry: e, gPath, stream, phase: "game", sessionNo: no, control, log, timeoutMs: S.maxMinutes * 60_000,
          buildPrompt: ({ view: v, drafts, status, maxTurns, scripts, brevity }) => gameBrief({ config: v.game.config, teamName: e.team_name, teamId: e.team_id, generation: gen,
            sessionNo: no, status: v.game.status, clockMs: v.game.clockMs, budgets: status.budgets, scores: v.game.clockMs > 0 ? v.scores : null,
            names: Object.fromEntries(v.teams.map((t) => [t.id, t.name])), head: v.game.clockMs > 0 ? head : null, memory: status.memory, drafts, maxTurns, scripts,
            scaffold: desk.scaffold.status(), automatic: autoCount(p.id), brevity }),
        });
        log(`  ${p.name}: session ${no} ${s.killed ? `stopped (${s.killed})` : "ended"} at ${mmss(stream.clockMs)}: $${s.cost.toFixed(2)}${s.cost && s.killed ? " (estimated)" : ""}, ${s.requests} requests, ` +
          `${s.submitted.length ? `submitted ${s.submitted.map((x) => `${x.kind} v${x.version}`).join(", ")}` : "nothing submitted"}`);
        // A violation costs the team its next session (session.penaltyMinutes: how long it waits, else maxMinutes).
        if (s.violation) penaltyUntil = Date.now() + (S.penaltyMinutes ?? S.maxMinutes) * 60_000;
        // Sessions that change nothing come less often, unless the preset says otherwise (session.idleBackoff false: a
        // constant gap).
        idle = s.submitted.length || S.idleBackoff === false ? 0 : idle + 1;
      } catch (err) {
        if (err instanceof BudgetError) { budgetStop = err.message; log(`  no more sessions: ${err.message}`); break; }
        log(`  ${p.name}: session ${no} failed: ${err.stack || err.message}`);
        await sleep(5000);
      } finally {
        state.controls.delete(p.id);
      }
      no++;
      // The gap between sessions ends early when the game does (the end of the game waits for every team's loop).
      const gapUntil = Date.now() + Math.min(S.gapSeconds * 2 ** idle, Math.max(S.gapSeconds, S.maxIdleGapSeconds ?? 20)) * 1000;
      while (!over() && Date.now() < gapUntil) await sleep(Math.min(1000, gapUntil - Date.now()));
    }
  };

  let loops = [];
  if (view.game.status === "lobby") {
    // Warm start: the first sessions begin a few seconds before the game, so the teams are at their desks.
    loops = players.map((e) => sessionsOf(e));
    await sleep(S.warmupSeconds * 1000);
    await waitIfPaused();
    const st = await Api.start(ownerTok, gPath);
    const sat = entries.filter((e) => !st.participants.includes(e.team_id));
    for (const e of sat) await q("UPDATE arena.entries SET sat_out = true WHERE game_id = $1 AND persona_id = $2", [gameRow.id, e.persona_id]);
    stream.status = "running";
    log(`game ${gen} STARTED (${view.game.config.minutes} min) with ${st.participants.length} teams${sat.length ? `; sitting out: ${sat.map((e) => e.team_name).join(", ")}` : ""}`);
  } else {
    if (view.game.status !== "finished") loops = players.map((e) => sessionsOf(e));
    log(`game ${gen}: resuming (${view.game.status}, ${mmss(view.game.clockMs)} played)`);
  }
  await q("UPDATE arena.games SET stage = 'playing' WHERE id = $1 AND stage IN ('created','lobby-done')", [gameRow.id]);
  stream.start(1000);

  // Watch the game: the pause file, the clock, the end.
  let lastLog = 0;
  while (stream.status !== "finished") {
    await sleep(500);
    try { await syncGamePause({ ...ctx, ...state }, stream, log); } catch (err) { log(`  pause sync failed: ${err.message}`); }
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      const s = await spend(arena.id);
      log(`  ${mmss(stream.clockMs)} of ${mmss(endMs)}: ${stream.lastSeq} actions, ${state.controls.size} session(s) running; spend arena $${s.arena.toFixed(2)}, all $${s.global.toFixed(2)}`);
    }
  }
  // The game is over: stop the sessions that are still running (late submissions are refused by the server anyway).
  state.over = true;
  for (const [, c] of state.controls) { c.cancelled = "game over"; c.kill?.("game over"); }
  await Promise.all(loops);
  for (const [pid, d] of desks) {
    await d.stop("game over");
    const left = await killLeftovers(null, d.dir);
    if (left.length) log(`  ${allPersonas.find((x) => x.id === pid)?.name}: stopped ${left.length} leftover process(es) at the end of the game`);
  }
  await stream.stop();
  await stream.poll();
  live.delete(gameRow.id);
  await q("UPDATE arena.games SET stage = 'played', finished_at = now() WHERE id = $1", [gameRow.id]);
  const s = await spend(arena.id);
  log(`game ${gen} FINISHED: ${stream.lastSeq} actions; spend arena $${s.arena.toFixed(2)}, all $${s.global.toFixed(2)}`);
  return lobbyRes;
}

// ---------------------------------------------------------------- after the game

async function analyseGame(arena, ctx, log) {
  const { gameRow } = ctx;
  const m = await computeGameMetrics(ctx.gPath, { submits: await submitsOf(all, gameRow.id), memorySamples: readMemorySamples(path.join(WS_ROOT, arena.id), gameRow.generation),
    contract: arena.settings.honest ?? null });
  m.scaffolds = await scaffoldsOf(all, gameRow.id);
  // Storage: the stream files and the arena's workspaces (hard links counted once).
  const seen = new Set();
  const sharedBytes = diskBytes(path.join(WS_ROOT, arena.id, ".shared", `g${gameRow.generation}`), seen);
  const wsBytes = diskBytes(path.join(WS_ROOT, arena.id), seen) + sharedBytes;
  const st = fs.statfsSync(fs.existsSync(WS_ROOT) ? WS_ROOT : ARENA_DIR);
  m.storage = { sharedStreamBytes: sharedBytes, arenaDiskBytes: wsBytes, freeBytes: st.bavail * st.bsize };
  // Role conformance (logged, never enforced): an honest flower should answer at 50%, a defector at 0%.
  const roles = arena.settings.roles || {};
  if (Object.keys(roles).length) {
    const personas = await all("SELECT id, slug, name FROM arena.personas WHERE id = ANY($1)", [ctx.entries.map((e) => e.persona_id)]);
    m.roles = {};
    for (const e of ctx.entries) {
      const p = personas.find((x) => x.id === e.persona_id), r = roles[p?.slug]?.role, f = m.teams?.[e.team_id]?.flower;
      if (!r || !f) continue;
      // adapt-hi's honest contract (settings.honest: { burn, nectar }) fixes both the percent and the work: CPU at burn × R
      // (within ±0.05 of R).
      const c = roles[p.slug]?.brief === "contract" ? (arena.settings.honest ?? { burn: 0.6, nectar: 50 }) : null;
      const share = c ? f.contract?.percentAt ?? null : r === "honest" ? f.percentAt50 : r === "defector" ? f.percentAt0 : null;
      m.roles[e.team_id] = { role: r, brief: roles[p.slug]?.brief ?? null, persona: p.name, conform: share, medianPercent: f.percent?.p50 ?? null,
        ...(c ? { contract: c, cpuAt: f.contract?.cpuAt ?? null, cpuOfR: f.cpuOfR ?? null } : {}) };
      if (share != null && share < 0.99) log(`  ROLE DRIFT: ${p.name} (${r}) answered at its role's percent${c ? ` (${c.nectar})` : ""} on ${Math.round(100 * share)}% of turns (median percent ${f.percent?.p50 ?? "-"})`);
      if (c && f.contract?.cpuAt != null && f.contract.cpuAt < 0.9) log(`  ROLE DRIFT: ${p.name} (${r}) spent ${c.burn} × R (±0.05) of CPU on ${Math.round(100 * f.contract.cpuAt)}% of its answered turns (median CPU ÷ R ${f.cpuOfR?.p50 ?? "-"})`);
    }
  }
  await q("UPDATE arena.games SET metrics = $2 WHERE id = $1", [gameRow.id, m]);
  const final = [...(m.final || [])].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
  for (const e of ctx.entries) {
    const f = final.find((x) => x.teamId === e.team_id);
    if (!f) continue;
    await q("UPDATE arena.entries SET fitness = $3, fitness_rank = $4, pollination = $5, forage = $6, pollen = $7, shares = $8 WHERE game_id = $1 AND persona_id = $2",
      [gameRow.id, e.persona_id, f.fitness, final.indexOf(f) + 1, f.pollination, f.forage, f.pollen, { pollination: f.pollinationShare, forage: f.forageShare }]);
  }
  log(`game ${gameRow.generation} final: ${final.map((x) => `${x.team} ${x.fitness?.toFixed(2) ?? "-"}`).join(", ")}; ${m.turns} turns, ${m.rounds} rounds, ` +
    `${m.totals.feeds} feeds, ${m.changes.filter((c) => c.atMs > 0).length} in-game changes; stream ${(sharedBytes / 1e6).toFixed(1)} MB`);
}

async function socialEvaluation(arena, ctx, log) {
  const { gameRow } = ctx;
  const entries = await all("SELECT * FROM arena.entries WHERE game_id = $1 AND NOT sat_out", [gameRow.id]);
  const personas = await all("SELECT * FROM arena.personas WHERE id = ANY($1)", [entries.map((e) => e.persona_id)]);
  const finals = await finalPrograms(ctx.gPath);
  if (!atLeast(gameRow.stage, "interviewed")) {
    await Promise.all(entries.filter((e) => !e.explanation).map(async (e) => {
      const p = personas.find((x) => x.id === e.persona_id);
      try {
        const ex = await interview({ arena, gameRow, persona: p, entry: e, entries, finals });
        await q("UPDATE arena.entries SET explanation = $3 WHERE game_id = $1 AND persona_id = $2", [gameRow.id, e.persona_id, ex]);
      } catch (err) {
        if (err instanceof BudgetError) throw err;
        log(`  interview ${p.name} failed: ${err.message}`);
        await q("UPDATE arena.entries SET explanation = $3 WHERE game_id = $1 AND persona_id = $2", [gameRow.id, e.persona_id, "(no explanation: the interview failed)"]);
      }
    }));
    await q("UPDATE arena.games SET stage = 'interviewed' WHERE id = $1", [gameRow.id]);
    gameRow.stage = "interviewed";
    log(`game ${gameRow.generation}: interviews done`);
  }
  if (!atLeast(gameRow.stage, "judged")) {
    const fresh = await all("SELECT * FROM arena.entries WHERE game_id = $1 AND NOT sat_out", [gameRow.id]);
    const teams = fresh.map((e) => ({ persona_id: e.persona_id, name: e.team_name, explanation: e.explanation, code: finals[e.team_id]?.code || {} }));
    const res = await judgeGame({ arena, gameRow, config: gameRow.config, teams, log });
    await q("UPDATE arena.games SET stage = 'judged' WHERE id = $1", [gameRow.id]);
    gameRow.stage = "judged";
    const rows = await all("SELECT team_name, social, social_rank, social_parts FROM arena.entries WHERE game_id = $1 ORDER BY social_rank NULLS LAST", [gameRow.id]);
    log(`game ${gameRow.generation} social (${res.evaluations} evaluations): ${rows.map((r) => `${r.team_name} ${r.social?.toFixed(2) ?? "-"}${r.social_parts?.newIdeas?.length ? ` [+${r.social_parts.newIdeas.length} new ideas]` : ""}`).join(", ")}`);
  }
}

async function evolve(arena, generation, isLast, gameRow, log) {
  if (atLeast(gameRow.stage, "done")) return;
  if (arena.settings.noEvolution) {
    await q("UPDATE arena.games SET stage = 'done' WHERE id = $1", [gameRow.id]);
    return;
  }
  const already = await one("SELECT count(*)::int AS n FROM arena.population_events WHERE arena_id = $1 AND generation = $2 AND event = 'retired'", [arena.id, generation]);
  if (!already.n) {
    const out = await decideRetirements(arena, generation, log);
    for (const c of out) {
      log(`game ${generation}: RETIRE ${c.persona.name} (${c.persona.team_name}, ${c.persona.model}): ${c.reason}`);
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

/** One game of an arena, from setup to evolution (finished stages are skipped). */
async function runGeneration(arena, gen, games, log) {
  const existing = await one("SELECT stage FROM arena.games WHERE arena_id = $1 AND generation = $2", [arena.id, gen]);
  if (existing?.stage === "done") return;
  const ctx = await setupGame(arena, gen, log);
  if (!atLeast(ctx.gameRow.stage, "played")) await playGame(arena, ctx, log);
  ctx.gameRow = await one("SELECT * FROM arena.games WHERE id = $1", [ctx.gameRow.id]);
  ctx.entries = await all("SELECT * FROM arena.entries WHERE game_id = $1", [ctx.gameRow.id]);
  if (!ctx.gameRow.metrics) await analyseGame(arena, ctx, log);
  await socialEvaluation(arena, ctx, log);
  await evolve(arena, gen, gen === games, ctx.gameRow, log);
  const s = await spend(arena.id);
  log(`game ${gen} done. Spend: arena $${s.arena.toFixed(2)}, all $${s.global.toFixed(2)}. LLM ${JSON.stringify(llmStats())}`);
}

async function startArena(id, presetName, games, extra = {}) {
  const log = logger(id);
  const arena = await ensureArena(id, presetName, games, extra);
  arena.settings.games = games;
  await q("UPDATE arena.arenas SET settings = $2, status = 'running' WHERE id = $1", [id, arena.settings]);
  setArenaCap(id, arena.settings.budgetUsd);
  // A preset's concurrency (as many sessions at once as it has teams, say), unless ARENA_CONCURRENCY sets it.
  if (arena.settings.concurrency && !process.env.ARENA_CONCURRENCY) setConcurrency(arena.settings.concurrency);
  log(`arena ${id} (${arena.preset}): room ${arena.room_url}, ${games} games${arena.settings.common ? `, common knowledge from ${arena.settings.common.dir}` : ""}` +
    `; ${JSON.stringify(llmStats())}`);
  return { arena, log };
}

async function stopped(ids, e, log) {
  const status = e instanceof BudgetError ? "stopped-budget" : "error";
  await q("UPDATE arena.arenas SET status = $2 WHERE id = ANY($1) AND status = 'running'", [ids, status]);
  log(e instanceof BudgetError ? `STOPPED: ${e.message}` : `ERROR: ${e.stack || e.message}`);
}

async function runArena(id, presetName, games) {
  const { arena, log } = await startArena(id, presetName, games);
  try {
    for (let gen = 1; gen <= games; gen++) await runGeneration(arena, gen, games, log);
    await q("UPDATE arena.arenas SET status = 'done' WHERE id = $1", [id]);
    log(`arena ${id} finished`);
  } catch (e) {
    await stopped([id], e, log);
  }
}

/** A cohort experiment (lib/presets.js EXPERIMENTS): its cohorts play one game at a time, interleaved by game number, in an
 * order that rotates every game. A stop (budget or error) in any cohort stops the whole experiment, so the cohorts stay
 * matched game for game. */
async function runExperiment(name) {
  const exp = EXPERIMENTS[name];
  if (!exp) throw new Error(`unknown experiment ${name} (${Object.keys(EXPERIMENTS).join(", ")})`);
  const games = Number(args.games || exp.games);
  const ids = exp.cohorts.map((c) => c.id);
  // Every cohort's common knowledge must be there before anything starts (a missing folder would stop the experiment
  // in the middle of a game).
  const roleDirs = (PRESETS[exp.preset]?.lineup || []).flatMap(([, , o = {}]) => [o.common ?? []].flat());
  for (const c of [...exp.cohorts, ...[...new Set(roleDirs)].map((dir) => ({ id: "a role", common: { dir } }))]) {
    if (!c.common) continue;
    const dir = path.resolve(ARENA_DIR, "..", c.common.dir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith(".") && fs.statSync(path.join(dir, f)).isFile()) : [];
    if (!files.length) throw new Error(`${c.id}: its common knowledge ${c.common.dir} is missing or empty`);
  }
  // So must every start program (the honest teams' reference bee in adapt-hi).
  for (const [, , o = {}] of PRESETS[exp.preset]?.lineup || []) {
    for (const f of Object.values(o.start || {})) if (!fs.existsSync(path.resolve(ARENA_DIR, "..", f))) throw new Error(`start program ${f} is missing`);
  }
  const started = [];
  // The experiment's own cap: each cohort gets an equal share (--budget overrides it per cohort).
  const budgetUsd = args.budget ? Number(args.budget) : exp.capUsd ? exp.capUsd / exp.cohorts.length : null;
  for (const c of exp.cohorts) {
    started.push(await startArena(c.id, exp.preset, games, {
      budgetUsd, common: c.common || null, ledgerExclude: ids.filter((x) => x !== c.id),
      experiment: { name, arm: c.arm, label: c.label || null, cohorts: ids, description: exp.description },
    }));
  }
  const elog = logger(name);
  const labelOf = (id) => exp.cohorts.find((c) => c.id === id)?.label || exp.cohorts.find((c) => c.id === id)?.arm || id;
  elog(`experiment ${name}: ${exp.cohorts.map((c) => `${c.id} (${c.label || c.arm}${c.common ? `, common knowledge ${c.common.dir}` : ""})`).join(", ")}; ${games} games each, interleaved; ` +
    `preset ${exp.preset}; ${budgetUsd ? `each cohort capped at $${+budgetUsd.toFixed(2)} ($${+(budgetUsd * exp.cohorts.length).toFixed(2)} in all), ` : ""}global ledger cap $${GLOBAL_CAP}`);
  let doneCount = (await one("SELECT count(*)::int AS n FROM arena.games WHERE arena_id = ANY($1) AND stage = 'done'", [ids]))?.n || 0;
  try {
    for (let gen = 1; gen <= games; gen++) {
      // Matched cohorts: a game starts only if every cohort can afford all of it (exp.gameUsd: a generous estimate).
      if (!(await one("SELECT 1 FROM arena.games WHERE arena_id = ANY($1) AND generation = $2 AND stage = 'done' LIMIT 1", [ids, gen]))) {
        const per = exp.gameUsd ?? 10;
        for (const { arena } of started) {
          const s = await spend(arena.id);
          if (arena.settings.budgetUsd && s.arena + per > arena.settings.budgetUsd) throw new BudgetError(`${arena.id} has spent $${s.arena.toFixed(2)} of its $${arena.settings.budgetUsd}: not enough for game ${gen} (about $${per}), so no cohort plays it`);
          if (s.global + per * started.length > GLOBAL_CAP) throw new BudgetError(`the ledger is at $${s.global.toFixed(2)} of $${GLOBAL_CAP}: not enough for game ${gen} in every cohort`);
        }
      }
      const order = started.map((_, i) => started[(i + gen - 1) % started.length]);
      elog(`game ${gen}: ${order.map((x) => `${x.arena.id} (${labelOf(x.arena.id)})`).join(" → ")}`);
      for (const { arena, log } of order) {
        const already = await one("SELECT 1 FROM arena.games WHERE arena_id = $1 AND generation = $2 AND stage = 'done'", [arena.id, gen]);
        if (!already) elog(`stage: game ${gen} of ${games} in ${arena.id} (${labelOf(arena.id)}) starting; ${doneCount} of ${games * started.length} cohort-games done`);
        await runGeneration(arena, gen, games, log);
        if (!already) {
          doneCount++;
          const sp = await spend(arena.id);
          let mine = 0;
          for (const x of started) mine += (await spend(x.arena.id)).arena;
          elog(`progress: game ${gen} of ${games} in ${arena.id} (${labelOf(arena.id)}) done; ${doneCount} of ${games * started.length} cohort-games done; ` +
            `spend: this cohort $${sp.arena.toFixed(2)}${budgetUsd ? ` of $${+budgetUsd.toFixed(2)}` : ""}, this experiment $${mine.toFixed(2)}` +
            `${budgetUsd ? ` of $${+(budgetUsd * started.length).toFixed(2)}` : ""}, the whole ledger $${sp.global.toFixed(2)} of $${GLOBAL_CAP}`);
        }
      }
    }
    await q("UPDATE arena.arenas SET status = 'done' WHERE id = ANY($1)", [ids]);
    elog(`experiment ${name} finished`);
  } catch (e) {
    await stopped(ids, e, elog);
  }
}

// A shutdown (Ctrl-C, kill) pauses the running games, so a restart picks them up where they were, and stops the sessions.
let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  console.log(`[arena] ${sig}: pausing running games and stopping sessions`);
  for (const [gameId, st] of live) {
    for (const [, c] of st.controls) { c.cancelled = "runner stopped"; c.kill?.("runner stopped"); }
    for (const d of st.desks?.values() || []) await d.scaffold.stop("runner stopped").catch(() => {});
    if (st.stream.status === "running") {
      try { await Api.status(st.ownerTok, st.gPath, "pause"); await q("UPDATE arena.games SET paused_by = 'runner-exit' WHERE id = $1", [gameId]); } catch (e) { console.log(`[arena] could not pause: ${e.message}`); }
    }
  }
  await sleep(5000); // the sessions' own cleanup (stop their leftover processes)
  process.exit(130);
}

async function main() {
  if (isPaused()) console.log(`[arena] starting PAUSED (${PAUSE_FILE} exists): games resume from the database once it is deleted`);
  await migrate();
  await seedJudges();
  await seedBreeders();
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(sig));
  if (args.experiment) { await runExperiment(String(args.experiment)); await pool.end(); return; }
  const list = (args.arenas ? String(args.arenas).split(",") : [String(args.arena || "pilot")]).map((x) => x.split(":"));
  const presetOf = (id) => (args.preset && list.length === 1 ? String(args.preset) : id.replace(/-\d+$/, ""));
  const gamesOf = (id, n) => Number(n || args.games || args.generations || PRESETS[presetOf(id)]?.minutesByGame?.length || 1);
  await Promise.all(list.map(([id, n]) => runArena(id, presetOf(id), gamesOf(id, n))));
  await pool.end();
}

process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
main().catch((e) => { console.error(e); process.exit(1); });

