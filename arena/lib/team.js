// One team's turn before a round: a tool-using Claude Code session in the team's private workspace, a fair-play audit
// of its transcript, then validation (POST base/check plus a runtime smoke test with base/try) and submission of the
// programs the team may change this round. Failures go back to short fix sessions. Also the post-game interview.
import fs from "node:fs";
import path from "node:path";
import { Api, login } from "./api.js";
import { q, one } from "./db.js";
import { BudgetError, callModel, extractTag, runSession } from "./llm.js";
import { NOTICES, examplesNotice, interviewSystem, roundBrief, toolSystem } from "./prompts.js";
import { TRANSCRIPTS, audit, collect, prepareWorkspace, recordViolations, restoreProgram, spillDir, writeMinified } from "./workspace.js";
import { changeable as schedule, nextChangeRound } from "../../server/lib/schedule.js";

const KINDS = ["clover", "orchid", "bee"];
const MAX_FIXES = 2; // fix sessions after round 1's (round 1 gets 4: a team without valid programs sits the game out)

export const SESSION_LIMITS = {
  // max agent turns and USD per session, by model (tuned after the pilot)
  opus: { turns: 30, usd: 2.5 }, sonnet: { turns: 30, usd: 1.0 }, haiku: { turns: 25, usd: 0.6 },
  ...JSON.parse(process.env.ARENA_SESSION_LIMITS || "{}"),
};

function parseType(s) {
  s = s.trim();
  const m = s.match(/^(list|tree)\[(.*)\]$/);
  return m ? { kind: m[1], of: parseType(m[2]) } : { kind: s };
}
// Sample challenges for the runtime smoke test of a flower (edge cases only: these never reach prompts).
function samples(t, maxLen) {
  const L = Math.min(maxLen, 64);
  switch (t.kind) {
    case "int": return [0, 1, 42, 7, 999, -3, 123456];
    case "float": return [0, 0.5, 3.14159, -2.5, 1000.25];
    case "bool": return [true, false];
    case "str": return ["", "a", "hello", "bee?", "ZZZ 123", "x".repeat(L)];
    case "list": {
      const s = samples(t.of, maxLen);
      return [[], [s[1]], s.slice(0, 3), Array.from({ length: L }, (_, i) => s[i % s.length])];
    }
    case "tree": {
      const v = samples(t.of, maxLen);
      const leaf = (x) => ({ value: x, children: [] });
      return [leaf(v[0]), { value: v[1], children: [leaf(v[2]), leaf(v[3])] }, { value: v[2], children: [{ value: v[1], children: [leaf(v[0])] }] }];
    }
    case "graph": case "digraph":
      return [{ nodes: 0, edges: [] }, { nodes: 1, edges: [] }, { nodes: 3, edges: [[0, 1], [1, 2]] },
        { nodes: L, edges: Array.from({ length: L - 1 }, (_, i) => [i, i + 1]) }];
    default: return [0];
  }
}
const sampleChallenges = (config) => samples(parseType(config.challengeType), config.maxLen);

async function validate(tok, g, kind, code, config) {
  const check = await Api.check(tok, g, kind, code);
  const errors = [...(check.errors || [])];
  if (check.ok && kind !== "bee") {
    const t = await Api.try(tok, g, kind, code, sampleChallenges(config));
    if (t.error) errors.push(`fails to load: ${t.error}`);
    const bad = (t.results || []).filter((r) => r.error);
    if (bad.length) errors.push(`runtime test: ${bad.slice(0, 3).map((r) => `flower(${JSON.stringify(r.c).slice(0, 40)}) -> ${r.error}`).join("; ")}`);
  }
  return { kind, code, errors, size: check.size, unit: check.unit, distance: check.distance, minified: check.minified };
}

async function beeRuntime(tok, g, code, flowers) {
  let t;
  try { t = await Api.try(tok, g, "bee", code, undefined, flowers); }
  catch (e) { if (e.status === 409) return []; throw e; } // no valid flowers yet: can't run the bee, check only
  const errs = [];
  if (t.problems?.bee) errs.push(`runtime test (your bee foraging your own patch): ${t.problems.bee}`);
  const ev = (t.visits || []).filter((v) => v.action === "error");
  if (ev.length && !t.problems?.bee) errs.push(`runtime test: ${ev.length} error visits, e.g. ${ev[0].beeError}`);
  return errs;
}

/** Round-1 notices: named ones for a given game (settings.cohort.notices), and the examples treatment's in every game. */
export function roundNotices(arena, generation, roundNo, config) {
  const c = arena.settings.cohort;
  if (!c || roundNo !== 1) return [];
  const out = [];
  const named = c.notices?.[generation];
  const n = named && (NOTICES[named] || named);
  if (n) out.push(typeof n === "function" ? n(config) : n);
  if (c.examples) out.push(examplesNotice(c.examples.files));
  return out;
}

/** One team's turn before round `roundNo`. Returns { submitted, failed, cost, satOut, disqualified, restored }. */
export async function playTurn(ctx) {
  const { arena, gameRow, persona, entry, gPath, roundNo, log } = ctx;
  const tok = await login(entry.login_name);
  const { dir, ext, view } = await prepareWorkspace({ arena, gameRow, persona, entry, gPath, roundNo });
  await q("UPDATE arena.games SET python = true WHERE id = $1 AND python IS DISTINCT FROM true", [gameRow.id]);
  const config = view.game.config;
  const lim = SESSION_LIMITS[persona.model];
  const fixed = !!arena.settings.noEvolution;
  const system = toolSystem(persona, config, dir, fixed);
  const prev = roundNo > 1 ? view.myTeam?.previous || {} : {};
  // Clovers and orchids take turns to change (server/lib/schedule.js); the view says which kinds are open.
  const open = view.game.changeable || schedule(roundNo);
  const locked = KINDS.filter((k) => !open.includes(k));
  const nextTurns = Object.fromEntries(locked.map((k) => [k, nextChangeRound(k, roundNo)]));
  // Locked files the team edited last round were restored then; say so once, in this round's brief.
  const restored = (await one(`SELECT parsed->'restored' AS r FROM arena.agent_turns WHERE game_id = $1 AND persona_id = $2 AND round_no = $3
                                ORDER BY attempt DESC LIMIT 1`, [gameRow.id, persona.id, roundNo - 1]))?.r || [];
  let cost = 0, failures = [], disqualified = false;
  const submitted = new Set(), restoredNow = new Set();

  const maxFixes = roundNo === 1 ? 4 : MAX_FIXES;
  for (let attempt = 0; attempt <= maxFixes; attempt++) {
    const fix = attempt ? failures.map((f) => `- ${f.kind}: ${f.errors.join("; ")}`).join("\n") : null;
    const maxTurns = attempt ? Math.min(15, lim.turns) : lim.turns;
    const transcript = path.join(TRANSCRIPTS, arena.id, persona.slug, `g${gameRow.generation}-r${roundNo}-a${attempt}.jsonl`);
    let s;
    try {
      s = await runSession({
        model: persona.model, cwd: dir, appendSystem: system, maxTurns, python: true, maxBudgetUsd: attempt ? lim.usd / 3 : lim.usd, transcriptFile: transcript,
        prompt: roundBrief({ view, entry, generation: gameRow.generation, roundNo, maxTurns, ext, fix, forked: !!arena.settings.cohort,
          notices: roundNotices(arena, gameRow.generation, roundNo, config), changeable: open, nextTurns, restored: attempt ? [] : restored }),
        ctx: { purpose: attempt ? "team-fix" : "team-session", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id },
      });
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      log(`  ${persona.name}: session failed: ${e.message}`);
      break;
    }
    cost += s.cost;
    // Fair-play audit: a violation disqualifies this round's code (previous programs carry over).
    const found = audit(transcript, dir, arena.id, persona.slug);
    await recordViolations({ arena, gameRow, persona, roundNo, attempt, found });
    fs.rmSync(spillDir(dir), { recursive: true, force: true }); // the session's saved tool outputs: audited, no longer needed
    if (found.some((f) => f.severity === "violation")) {
      disqualified = true;
      log(`  ${persona.name}: DISQUALIFIED for round ${roundNo}: ${found.filter((f) => f.severity === "violation").map((f) => f.detail.slice(0, 120)).join(" | ")}`);
      if (roundNo > 1) for (const k of open) if (prev[k] !== undefined) await Api.submit(tok, gPath, k, prev[k]); // overwrite anything it submitted itself
      break;
    }
    const files = collect(dir, ext);
    if (files.notes !== null) await q("UPDATE arena.personas SET notebook = $2 WHERE id = $1", [persona.id, files.notes]);
    // A locked file the team edited anyway: put the version that played back, and tell the team next round.
    for (const k of locked) if (files[k] !== prev[k]) { restoreProgram(dir, ext, k, prev[k]); restoredNow.add(k); }
    if (restoredNow.size && !attempt) log(`  ${persona.name}: edited locked ${[...restoredNow].join(", ")}; restored`);
    // Validate and submit what changed among the open kinds (round 1: everything). Flowers first so the bee test
    // forages the new flowers.
    failures = [];
    const checks = [], good = {};
    for (const kind of open) {
      const code = files[kind];
      if (roundNo > 1 && code === prev[kind]) continue; // unchanged: carries over
      if (!code.trim()) { if (roundNo === 1) failures.push({ kind, code, errors: [`${kind}.${ext} is empty`] }); continue; }
      const v = await validate(tok, gPath, kind, code, config);
      if (kind === "bee" && !v.errors.length) v.errors.push(...(await beeRuntime(tok, gPath, code, Object.keys(good).length ? good : undefined)));
      checks.push({ kind, size: v.size, unit: v.unit, distance: v.distance, errors: v.errors });
      if (v.errors.length) { failures.push(v); if (v.minified) writeMinified(dir, ext, kind, v.minified); continue; }
      const r = await Api.submit(tok, gPath, kind, code);
      if (r.submitted) { submitted.add(kind); if (kind !== "bee") good[kind] = code; }
      else failures.push({ ...v, errors: r.errors || ["not accepted"] });
    }
    await q("INSERT INTO arena.agent_turns (game_id, persona_id, round_no, attempt, prompt_chars, reply, parsed, checks, submitted, notes, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [gameRow.id, persona.id, roundNo, attempt, system.length, (s.text || "").slice(0, 20000),
        JSON.stringify({ turns: s.turns, subtype: s.subtype, ms: s.ms, changeable: open, restored: [...restoredNow] }),
        JSON.stringify(checks), JSON.stringify([...submitted]), files.notes, s.cost]);
    if (!failures.length) break;
    log(`  ${persona.name} r${roundNo} attempt ${attempt + 1}: ${failures.map((f) => `${f.kind}: ${f.errors.join("; ").slice(0, 140)}`).join(" | ")}`);
  }

  let satOut = false;
  if (roundNo === 1) {
    const v = await Api.view(tok, gPath, "none");
    const missing = KINDS.filter((k) => !v.myTeam.drafts[k]);
    if (missing.length) {
      satOut = true;
      log(`  ${persona.name}: SITS OUT this game (no valid ${missing.join(", ")})`);
      await q("UPDATE arena.entries SET sat_out = true WHERE game_id = $1 AND persona_id = $2", [gameRow.id, persona.id]);
    }
  }
  const failed = failures.map((f) => f.kind).filter((k) => !submitted.has(k));
  if (failed.length) await q("UPDATE arena.entries SET agent_errors = agent_errors + $3 WHERE game_id = $1 AND persona_id = $2", [gameRow.id, persona.id, failed.length]);
  return { submitted: [...submitted], failed, cost, satOut, disqualified, restored: [...restoredNow] };
}

/** Post-game interview: "teach us your code" (one model call, no tools). */
export async function interview({ arena, gameRow, persona, entry, gPath, buildPrompt }) {
  const tok = await login(entry.login_name);
  const view = await Api.view(tok, gPath, "none");
  const notebook = (await one("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id]))?.notebook || "";
  const r = await callModel({ model: persona.model, system: interviewSystem(persona, !!arena.settings.noEvolution), prompt: buildPrompt(view, persona, { notebook }),
    effort: "low", ctx: { purpose: "interview", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id } });
  return (extractTag(r.text, "explanation") || r.text).trim().slice(0, 4000);
}
