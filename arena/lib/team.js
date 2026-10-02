// One team's sessions: a tool-using Claude Code session in the team's private workspace, with the runner answering
// the workspace tools (tools/*.py: submit, check, try, status) through lib/broker.js. Before every request the runner
// audits the live transcript (a fair-play violation stops the session at once and refuses the request); after the
// session it audits the whole transcript, stops anything the session left running, and keeps the notebook.
// Also the lobby (write all three programs, with fix sessions) and the post-game interview.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Api, login, publicGameUrl } from "./api.js";
import { all, one, q } from "./db.js";
import { BudgetError, callModel, capModel, extractTag, runSession } from "./llm.js";
import { gameBrief, interviewPrompt, interviewSystem, lobbyBrief, mmss, toolSystem } from "./prompts.js";
import { Broker } from "./broker.js";
import { TRANSCRIPTS, audit, collect, extOf, killLeftovers, prepareWorkspace, recordViolations, spillDir, writeMinified } from "./workspace.js";

const KINDS = ["clover", "orchid", "bee"];
const n0 = (x) => Math.floor(x).toLocaleString("en-US");

export const SESSION_LIMITS = {
  // max agent turns and USD per session, by model; an arena can override them (settings.limits)
  opus: { turns: 30, usd: 2.5 }, sonnet: { turns: 30, usd: 1.0 }, haiku: { turns: 25, usd: 0.6 },
  ...JSON.parse(process.env.ARENA_SESSION_LIMITS || "{}"),
};
export const limitsFor = (arena, model, phase) => ({ ...SESSION_LIMITS[model], ...(arena.settings.limits?.[model] || {}), ...(arena.settings.limits?.[phase]?.[model] || {}) });

// ---------------------------------------------------------------- runtime tests (edge cases only: never in prompts)

function parseType(s) {
  s = s.trim();
  const m = s.match(/^(list|tree)\[(.*)\]$/);
  return m ? { kind: m[1], of: parseType(m[2]) } : { kind: s.replace(/\[.*$/, "") };
}
function samples(t, maxLen) {
  const L = Math.min(maxLen, 64);
  switch (t.kind) {
    case "int": return [0, 1, 42, 7, 999, -3, 123456];
    case "float": return [0, 0.5, 3.14159, -2.5, 1000.25];
    case "bool": return [true, false];
    case "str": return ["", "a", "hello", "bee?", "ZZZ 123", "x".repeat(L)];
    case "list": { const s = samples(t.of, maxLen); return [[], [s[1]], s.slice(0, 3), Array.from({ length: L }, (_, i) => s[i % s.length])]; }
    case "tree": { const v = samples(t.of, maxLen); const leaf = (x) => ({ value: x, children: [] }); return [leaf(v[0]), { value: v[1], children: [leaf(v[2]), leaf(v[3])] }]; }
    case "graph": case "digraph": return [{ nodes: 0, edges: [] }, { nodes: 1, edges: [] }, { nodes: 3, edges: [[0, 1], [1, 2]] }];
    default: return [0];
  }
}
export const sampleChallenges = (config) => samples(parseType(config.challengeType), config.maxLen);

/** A quick runtime test on the game's real runner: [] when fine, else short error strings. */
export async function runtimeTest(api, tok, g, kind, code, config) {
  try {
    if (kind !== "bee") {
      const t = await api.try(tok, g, kind, code, sampleChallenges(config));
      if (t.error) return [`fails to load: ${t.error}`];
      const bad = (t.results || []).filter((r) => r.error);
      return bad.length ? [`runtime test: ${bad.slice(0, 3).map((r) => `flower(${JSON.stringify(r.c).slice(0, 40)}) -> ${r.error}`).join("; ")}`] : [];
    }
    const t = await api.try(tok, g, "bee", code);
    const probs = (t.problems || []).filter((p) => p.kind === "bee").map((p) => p.error);
    const errs = (t.actions || []).filter((a) => a.action === "error");
    if (probs.length) return [`runtime test (your bee foraging your own two flowers): ${probs[0]}`];
    if (errs.length) return [`runtime test: ${errs.length} of ${t.actions.length} actions were errors, e.g. ${errs[0].error}`];
    return [];
  } catch (e) {
    if (e.status === 409 && kind === "bee") return []; // no flowers yet: can't run the bee, the check is enough
    return [`runtime test failed: ${e.message}`];
  }
}

// ---------------------------------------------------------------- status: clock, budgets, scores

/** Change budget available now: min(cap, bank + perMinute × (clock − atMs)). */
export const availableNow = (budget, bank, clockMs) => Math.min(budget.cap, bank.bank + (budget.perMinute * Math.max(0, clockMs - bank.atMs)) / 60000);

export function statusOf(view, teamId, { afford = null } = {}) {
  const g = view.game, config = g.config, endMs = g.endMs ?? config.minutes * 60000;
  const name = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const mine = view.teams.find((t) => t.id === teamId);
  const out = { ok: true, status: g.status, clockMs: g.clockMs, endMs, leftMs: Math.max(0, endMs - g.clockMs), round: g.round ?? null, budgets: null, scores: null, recent: null, versions: {} };
  const lines = [];
  if (g.status === "lobby") lines.push(`The game hasn't started (lobby). It will last ${mmss(endMs)} of game time.`);
  else lines.push(`Game ${g.status}: ${mmss(g.clockMs)} of ${mmss(endMs)} played (${mmss(out.leftMs)} left)${g.round != null ? `, round ${g.round}` : ""}.`);
  if (mine?.banks && g.status !== "lobby") {
    out.budgets = {};
    lines.push("Your change budgets (nodes):");
    for (const k of KINDS) {
      const b = config.budgets[k], bank = mine.banks[k] || { bank: 0, atMs: 0 };
      const av = availableNow(b, bank, g.clockMs);
      const full = b.perMinute > 0 ? Math.max(0, (b.cap - av) * 60000 / b.perMinute) : null;
      const x = { available: Math.floor(av), perMinute: b.perMinute, cap: b.cap, fullInMs: full };
      let extra = "";
      if (afford != null) {
        const ms = afford > b.cap ? null : afford <= av ? 0 : b.perMinute > 0 ? (afford - av) * 60000 / b.perMinute : null;
        x.affordInMs = ms;
        extra = `; ${n0(afford)} nodes: ${ms === null ? `never (cap ${n0(b.cap)}: change in steps)` : ms === 0 ? "now" : `in ${mmss(ms)}${ms > out.leftMs ? " (after the game ends)" : ""}`}`;
      }
      out.budgets[k] = x;
      lines.push(`  ${k.padEnd(6)} ${n0(av).padStart(6)} available, +${n0(b.perMinute)}/min, cap ${n0(b.cap)}${full ? ` (full in ${mmss(full)})` : " (full)"}${extra}`);
    }
  }
  const board = (scores) => [...scores].sort((a, b) => b.fitness - a.fitness).map((s, i) => `${i + 1}. ${name[s.teamId]}${s.teamId === teamId ? " (you)" : ""} ${s.fitness.toFixed(2)}`).join("   ");
  if (view.scores) {
    out.scores = view.scores.map((s) => ({ team: name[s.teamId], ...s }));
    lines.push(`Scores, whole game: ${board(view.scores)}`);
  }
  if (view.recent?.scores) {
    out.recent = { fromMs: view.recent.fromMs, toMs: view.recent.toMs, scores: view.recent.scores.map((s) => ({ team: name[s.teamId], ...s })) };
    if (view.recent.fromMs > 0) lines.push(`Scores, last 5 minutes: ${board(view.recent.scores)}`);
  }
  if (mine?.programs) {
    const parts = [];
    for (const k of KINDS) {
      const vs = mine.programs[k] || [];
      const v = vs[vs.length - 1];
      out.versions[k] = v ? { version: v.version, size: v.size, atMs: v.atMs, problem: v.problem } : null;
      parts.push(v ? `${k} v${v.version} (${v.atMs ? `live since ${mmss(v.atMs)}` : "lobby"}, ${n0(v.size)} nodes${v.problem ? `; problem: ${v.problem.slice(0, 80)}` : ""})` : `${k}: not submitted`);
    }
    lines.push(`Your programs ${g.status === "lobby" ? "submitted" : "playing"}: ${parts.join(", ")}.`);
  }
  out.text = lines.join("\n");
  return out;
}

// ---------------------------------------------------------------- the requests behind tools/*.py

/**
 * The handler for one team session's requests. ctx: { api, tok, gPath, config, teamId, gate() -> refusal|null,
 * record(row) }. Results carry `text` (what the tool prints) plus the structured fields.
 */
export function requestHandler(ctx) {
  const { api = Api, tok, gPath, config, teamId, gate = () => null, record = async () => {} } = ctx;
  return async (req) => {
    const op = String(req.op || "");
    const kind = req.kind;
    const refusal = gate(op);
    if (refusal) {
      await record({ op, kind, code: req.code, ok: false, refused: refusal });
      return { ok: false, refused: true, error: refusal, text: `refused: ${refusal}` };
    }
    if (["check", "try", "submit"].includes(op)) {
      if (!KINDS.includes(kind)) return { ok: false, error: "kind must be clover, orchid or bee", text: "kind must be clover, orchid or bee" };
      if (typeof req.code !== "string") return { ok: false, error: "no code", text: "no code was sent" };
    }
    try {
      if (op === "status") {
        const view = await api.view(tok, gPath);
        const s = statusOf(view, teamId, { afford: Number.isFinite(req.afford) ? req.afford : null });
        await record({ op, ok: true, result: { clockMs: s.clockMs, budgets: s.budgets }, clockMs: s.clockMs });
        return s;
      }
      if (op === "check") {
        const c = await api.check(tok, gPath, kind, req.code);
        const errors = [...(c.errors || [])];
        if (req.test !== false && !errors.length) errors.push(...(await runtimeTest(api, tok, gPath, kind, req.code, config)));
        const out = { ok: !errors.length, kind, size: c.size, budget: c.budget?.size, distance: c.distance, cost: c.cost, available: c.available, minified: c.minified, errors };
        out.text = [`${kind}: ${n0(c.size)} of ${n0(c.budget?.size ?? 0)} nodes.` + (c.available != null ? ` Submitting now would cost ${n0(c.cost)} of the ${n0(c.available)} you have.` : " (lobby: submitting is free)"),
          errors.length ? `Problems:\n- ${errors.join("\n- ")}` : "No problems found."].join("\n");
        await record({ op, kind, code: req.code, ok: out.ok, result: { size: c.size, cost: c.cost, available: c.available, errors } });
        return out;
      }
      if (op === "try") {
        const challenges = Array.isArray(req.challenges) && req.challenges.length ? req.challenges : kind === "bee" ? undefined : sampleChallenges(config);
        const t = await api.try(tok, gPath, kind, req.code, challenges);
        let out;
        if (kind !== "bee") {
          const res = t.results || [];
          out = { ok: !t.error && res.every((r) => !r.error), error: t.error, results: res,
            text: t.error ? `fails to load: ${t.error}` : res.map((r) => `flower(${JSON.stringify(r.c).slice(0, 60)}) -> ${r.error ? `ERROR ${r.error}` : JSON.stringify(r.r).slice(0, 200)}  (${r.ms ?? "?"} ms)`).join("\n") };
        } else {
          const acts = t.actions || [];
          const by = (a) => acts.filter((x) => x.action === a).length;
          const probs = (t.problems || []).map((p) => `${p.kind}: ${p.error}`);
          out = { ok: !probs.some((p) => p.startsWith("bee")) && !by("error"), rounds: t.rounds, feeds: t.feeds, nectar: t.nectar, problems: probs, actions: acts.slice(0, 200),
            text: `${t.rounds ?? "?"} rounds in a garden of just your own two flowers: ${by("ask")} asks, ${t.feeds} feeds (${t.nectar} nectar), ${by("leave")} leaves, ${by("error")} errors.` +
              (probs.length ? `\nProblems:\n- ${probs.join("\n- ")}` : "") +
              `\nFirst actions:\n` + acts.slice(0, 12).map((a) => `  ${a.kind} ${a.action}${a.action === "ask" ? ` c=${JSON.stringify(a.c).slice(0, 40)} r=${JSON.stringify(a.r).slice(0, 40)}` : ""}${a.action === "feed" ? ` nectar=${a.nectar}` : ""}${a.error ? ` error: ${a.error.slice(0, 80)}` : ""}${a.log ? ` printed: ${a.log.trim().slice(0, 60)}` : ""}`).join("\n") +
              `\n(--json for every action)` };
        }
        await record({ op, kind, code: req.code, ok: out.ok, result: { problems: out.problems, error: out.error } });
        return out;
      }
      if (op === "submit") {
        if (!req.force) {
          const errs = await runtimeTest(api, tok, gPath, kind, req.code, config);
          if (errs.length) {
            const text = `not submitted: the quick runtime test failed (pass --force to submit anyway):\n- ${errs.join("\n- ")}`;
            await record({ op, kind, code: req.code, ok: false, refused: "runtime test", result: { errors: errs } });
            return { ok: false, errors: errs, text };
          }
        }
        const r = await api.submit(tok, gPath, kind, req.code);
        const over = (r.errors || []).some((e) => /game over/i.test(e));
        const out = { ok: !!r.submitted, kind, version: r.version, size: r.size, distance: r.distance, cost: r.cost, available: r.available, errors: r.errors || [], gameOver: over };
        out.text = r.submitted
          ? `${kind} v${r.version} submitted${r.cost ? `: it cost ${n0(r.cost)} nodes of change, ${n0(r.available ?? 0)} left` : ""}. ${r.available != null ? "It is live now." : "(lobby: free)"}`
          : over ? `not submitted: the game is over.` : `not submitted:\n- ${(r.errors || ["not accepted"]).join("\n- ")}`;
        await record({ op, kind, code: req.code, ok: out.ok, refused: over ? "game over" : null, version: r.version ?? null, cost: r.submitted ? r.cost : null,
          result: { size: r.size, distance: r.distance, cost: r.cost, available: r.available, errors: r.errors } });
        return out;
      }
      return { ok: false, error: `unknown request ${op}`, text: `unknown request ${op} (submit, check, try, status)` };
    } catch (e) {
      await record({ op, kind, code: req.code, ok: false, result: { error: e.message } }).catch(() => {});
      return { ok: false, error: e.message, text: `error: ${e.message}` };
    }
  };
}

// ---------------------------------------------------------------- one session

/**
 * Run one session of a team. phase: lobby | game. buildPrompt({ view, drafts, status, maxTurns }) -> the brief.
 * control: { cancelled?, kill? } shared with the caller (the runner stops sessions when the game ends). Returns
 * { sessionId, cost, violation, killed, requests, submitted }.
 */
export async function runTeamSession({ arena, gameRow, persona, entry, gPath, stream, phase, sessionNo, attempt = 0, buildPrompt, log, control = {}, timeoutMs, carry = null, api = Api }) {
  const tok = await login(entry.login_name);
  const view = await api.view(tok, gPath);
  const config = view.game.config;
  const teamId = entry.team_id;
  const lim = limitsFor(arena, persona.model, phase);
  const maxTurns = attempt ? Math.min(15, lim.turns) : lim.turns;
  const apiBase = publicGameUrl(arena.room_short_id, gameRow.game_short_id);
  const status = statusOf(view, teamId);
  const { dir, ext, drafts } = await prepareWorkspace({ arena, gameRow, persona, view, stream, apiBase, statusText: status.text + "\n(at the start of this session)\n", carry });
  const teams = (view.participants || view.teams.map((t) => t.id)).length;
  const system = toolSystem(persona, config, dir, { fixed: !!arena.settings.noEvolution, apiBase, teams });
  const scripts = fs.readdirSync(dir).filter((f) => f.endsWith(".py") && !KINDS.includes(f.replace(/\.py$/, "")));
  const prompt = buildPrompt({ view, drafts, status, maxTurns, scripts, dir });
  const tag = `${arena.id}:${persona.slug}:g${gameRow.generation}:s${sessionNo}${attempt ? `a${attempt}` : ""}:${crypto.randomBytes(3).toString("hex")}`;
  const transcript = path.join(TRANSCRIPTS, arena.id, persona.slug, `g${gameRow.generation}-s${sessionNo}${attempt ? `-a${attempt}` : ""}.jsonl`);
  const row = await one(`INSERT INTO arena.sessions (arena_id, game_id, persona_id, no, attempt, phase, model, clock_start, transcript, prompt_chars)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [arena.id, gameRow.id, persona.id, sessionNo, attempt, phase, persona.model, view.game.clockMs, transcript, system.length + prompt.length]);
  const sessionId = row.id;
  const port = new URL(apiBase).port || "80";
  let violated = null;
  const requests = { n: 0, submitted: [] };
  // Fair play, live: before acting on any request, audit what the session has done so far.
  const gate = () => {
    if (violated) return `a fair-play violation earlier in this session (${violated})`;
    const found = audit(control.lines || [], dir, arena.id, persona.slug, { port }).filter((f) => f.severity === "violation");
    if (!found.length) return null;
    violated = found[0].detail.slice(0, 160);
    log(`  ${persona.name}: fair-play VIOLATION in session ${sessionNo} (${violated}); stopping it`);
    control.kill?.("violation");
    return `fair-play violation (${violated}): this session is over`;
  };
  const record = async (r) => {
    requests.n++;
    if (r.op === "submit" && r.ok) requests.submitted.push({ kind: r.kind, version: r.version, cost: r.cost });
    const clockMs = r.clockMs ?? stream?.clockMs ?? null;
    await q(`INSERT INTO arena.requests (session_id, game_id, persona_id, op, kind, code, ok, refused, result, version, cost, clock_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [sessionId, gameRow.id, persona.id, r.op, r.kind ?? null, r.code ?? null, r.ok ?? null, r.refused ?? null, JSON.stringify(r.result ?? null), r.version ?? null, r.cost ?? null, clockMs]);
    if (r.op === "submit" && r.ok) log(`  ${persona.name}: submitted ${r.kind} v${r.version}${r.cost ? ` (cost ${r.cost})` : ""} at ${clockMs != null ? mmss(clockMs) : "?"}`);
  };
  const broker = new Broker({ dir, log, handle: requestHandler({ api, tok, gPath, config, teamId, gate, record }) }).start();
  let s;
  try {
    s = await runSession({
      model: persona.model, cwd: dir, appendSystem: system, prompt, maxTurns, python: true, maxBudgetUsd: attempt ? lim.usd / 3 : lim.usd,
      transcriptFile: transcript, timeoutMs: timeoutMs || 40 * 60_000, control, env: { ARENA_SESSION: tag }, holdOnLimit: phase === "lobby",
      ctx: { purpose: phase === "lobby" ? (attempt ? "lobby-fix" : "lobby") : "session", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id },
    });
  } catch (e) {
    await broker.stop();
    await killLeftovers(tag, dir);
    await q("UPDATE arena.sessions SET ended_at = now(), ended_by = $2 WHERE id = $1", [sessionId, e instanceof BudgetError ? "budget" : `error: ${e.message.slice(0, 200)}`]);
    throw e;
  }
  await broker.stop();
  const left = await killLeftovers(tag, dir);
  if (left.length) log(`  ${persona.name}: stopped ${left.length} process${left.length > 1 ? "es" : ""} session ${sessionNo} left running`);
  const found = audit(transcript, dir, arena.id, persona.slug, { port });
  await recordViolations({ arena, gameRow, persona, sessionId, found });
  const violation = !!violated || found.some((f) => f.severity === "violation");
  if (violation && !violated) log(`  ${persona.name}: fair-play VIOLATION in session ${sessionNo}: ${found.filter((f) => f.severity === "violation").map((f) => f.detail.slice(0, 120)).join(" | ")}`);
  const files = collect(dir, ext);
  if (files.notes !== null && !violation) await q("UPDATE arena.personas SET notebook = $2 WHERE id = $1", [persona.id, files.notes]);
  fs.rmSync(spillDir(dir), { recursive: true, force: true }); // the session's saved tool outputs: audited, no longer needed
  const clockEnd = stream?.clockMs ?? null;
  await q(`UPDATE arena.sessions SET ended_at = now(), clock_end = $2, ended_by = $3, cost_usd = $4, cost_estimated = $5, turns = $6, subtype = $7, reply = $8, violation = $9 WHERE id = $1`,
    [sessionId, clockEnd, s.killed ? `killed:${s.killed}` : s.limit ? "usage-limit" : s.isError ? "error" : "done", s.cost, !!s.estimated, s.turns, s.subtype, (s.text || "").slice(0, 20000), violation]);
  return { sessionId, cost: s.cost, violation, killed: s.killed, limit: s.limit, requests: requests.n, submitted: requests.submitted, dir, ext, files };
}

// ---------------------------------------------------------------- the lobby

const MAX_LOBBY_FIXES = 2;

/** The team's submitted programs (latest per kind) from its own view. */
async function submitted(api, tok, gPath, teamId) {
  const v = await api.view(tok, gPath);
  const t = v.teams.find((x) => x.id === teamId);
  return Object.fromEntries(KINDS.map((k) => { const vs = t?.programs?.[k] || []; return [k, vs.length ? vs[vs.length - 1].code : null]; }));
}

/**
 * The lobby: one session to write all three programs, then fix sessions while some are missing. A program file the team
 * wrote but didn't submit is submitted for it if it passes the checks (writing is free in the lobby). Returns
 * { ready, violation }; a team that isn't ready sits the game out.
 */
export async function lobby({ arena, gameRow, persona, entry, gPath, stream, log, carry, examples, api = Api }) {
  const tok = await login(entry.login_name);
  let fix = null, violation = false;
  for (let attempt = 0; attempt <= MAX_LOBBY_FIXES; attempt++) {
    const s = await runTeamSession({
      arena, gameRow, persona, entry, gPath, stream, phase: "lobby", sessionNo: 0, attempt, log, carry: attempt ? null : carry, api,
      buildPrompt: ({ view, maxTurns }) => lobbyBrief({ config: view.game.config, teamName: entry.team_name, generation: gameRow.generation, maxTurns,
        carried: !!carry && Object.values(carry).some(Boolean), fix, examples }),
    });
    if (s.violation) { violation = true; break; }
    const have = await submitted(api, tok, gPath, entry.team_id);
    const config = (await api.view(tok, gPath)).game.config;
    const failures = [];
    for (const k of KINDS) {
      const code = s.files[k];
      if (have[k] !== null && (code === have[k] || !code.trim())) continue;
      if (!code.trim()) { failures.push(`- ${k}: ${k}.${s.ext} is empty`); continue; }
      // Written but not submitted (or edited after submitting): submit it if it passes, as the team would have.
      const c = await api.check(tok, gPath, k, code);
      const errs = [...(c.errors || [])];
      if (!errs.length) errs.push(...(await runtimeTest(api, tok, gPath, k, code, config)));
      if (errs.length) {
        if (have[k] === null) failures.push(`- ${k}: ${errs.join("; ")}`);
        if (c.minified) writeMinified(s.dir, s.ext, k, c.minified);
        continue;
      }
      const r = await api.submit(tok, gPath, k, code);
      if (r.submitted) {
        log(`  ${persona.name}: ${k}.${s.ext} was ${have[k] === null ? "written but not submitted" : "changed after submitting"}; the runner submitted it (v${r.version})`);
        await q(`INSERT INTO arena.requests (session_id, game_id, persona_id, op, kind, code, ok, refused, result, version, cost, clock_ms) VALUES ($1,$2,$3,'submit',$4,$5,true,'auto: lobby fallback',$6,$7,0,0)`,
          [s.sessionId, gameRow.id, persona.id, k, code, JSON.stringify({ size: r.size }), r.version]);
      } else if (have[k] === null) failures.push(`- ${k}: ${(r.errors || ["not accepted"]).join("; ")}`);
    }
    if (!failures.length) return { ready: true, violation };
    fix = failures.join("\n");
    log(`  ${persona.name}: lobby attempt ${attempt + 1}: ${fix.replace(/\n/g, " | ").slice(0, 300)}`);
  }
  const have = await submitted(api, tok, gPath, entry.team_id);
  return { ready: KINDS.every((k) => have[k] !== null), violation };
}

// ---------------------------------------------------------------- after the game

/** The final programs (latest versions) of every team in a finished game, and how often each changed during play. */
export async function finalPrograms(gameUuid) {
  const rows = await all(`SELECT DISTINCT ON (team_id, kind) team_id, kind, version, code FROM programs WHERE game_id = $1 ORDER BY team_id, kind, version DESC`, [gameUuid]);
  const changes = await all(`SELECT team_id, count(*)::int AS n FROM programs WHERE game_id = $1 AND at_ms > 0 GROUP BY team_id`, [gameUuid]);
  const out = {};
  for (const r of rows) (out[r.team_id] ||= { code: {}, changes: 0 }).code[r.kind] = r.code;
  for (const c of changes) if (out[c.team_id]) out[c.team_id].changes = c.n;
  return out;
}

/** Post-game interview: "teach us your code" (one model call, no tools). */
export async function interview({ arena, gameRow, persona, entry, entries, finals }) {
  const notebook = (await one("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id]))?.notebook || "";
  const standings = entries.filter((e) => e.fitness != null).sort((a, b) => b.fitness - a.fitness).map((e) => ({ name: e.team_name, fitness: e.fitness, me: e.persona_id === persona.id }));
  const mine = finals[entry.team_id] || { code: {}, changes: 0 };
  const r = await callModel({ model: capModel(persona.model, arena.settings.maxModel), system: interviewSystem(persona, !!arena.settings.noEvolution),
    prompt: interviewPrompt({ standings, programs: mine.code, changes: mine.changes, config: gameRow.config, notebook }),
    effort: "low", ctx: { purpose: "interview", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id } });
  return (extractTag(r.text, "explanation") || r.text).trim().slice(0, 4000);
}

export { extOf, gameBrief };
