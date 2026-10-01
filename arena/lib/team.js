// One team agent's turn before a round: build the prompt from its own filtered view, call the model,
// validate every program with POST base/check (+ a runtime smoke test with base/try), give errors back
// (max 2 retries), and submit what passes.
import { Api, login } from "./api.js";
import { all, q } from "./db.js";
import { BudgetError, callModel, extractJson, extractTag } from "./llm.js";
import { retryPrompt, teamRoundPrompt, teamSystem } from "./prompts.js";

const KINDS = ["clover", "orchid", "bee"];
const MAX_RETRIES = 2;
// Haiku at medium effort thinks for 10k+ tokens (slower and pricier than sonnet), so it runs at low.
const EFFORT = { haiku: "low", sonnet: "medium", opus: "medium", fable: "medium", ...JSON.parse(process.env.ARENA_TEAM_EFFORT || "{}") };

function parseType(s) {
  s = s.trim();
  const m = s.match(/^list\[(.*)\]$/);
  return m ? { kind: "list", of: parseType(m[1]) } : { kind: s };
}
function samples(t, maxLen) {
  switch (t.kind) {
    case "int": return [0, 1, 42, 7, 999, -3, 123456];
    case "float": return [0, 0.5, 3.14159, -2.5, 1000.25];
    case "bool": return [true, false];
    case "str": return ["", "a", "hello", "bee?", "ZZZ 123", "x".repeat(Math.min(maxLen, 64))];
    case "list": {
      const s = samples(t.of, maxLen);
      return [[], [s[1]], s.slice(0, 3), Array.from({ length: Math.min(maxLen, 64) }, (_, i) => s[i % s.length])];
    }
    default: return [0];
  }
}
export const sampleChallenges = (config) => samples(parseType(config.challengeType), config.maxLen);
const sampleResponse = (config, i) => samples(parseType(config.responseType), config.maxLen)[i];

/** A minimal program for when the starter itself doesn't fit the budget (e.g. the TypeScript bee under tight budgets). */
export function fallback(kind, config) {
  const ex = JSON.stringify(sampleChallenges(config)[2]);
  if (config.language === "typescript") {
    return kind === "bee" ? `function forage(seen: any[], turnsLeft: number): any { return seen.length ? "feed" : ["ask", ${ex}]; }\n`
      : `function flower(challenge: any): any { return ${JSON.stringify(sampleResponse(config, kind === "clover" ? 1 : 2))}; }\n`;
  }
  return kind === "bee" ? `def forage(seen, turns_left):\n    return "feed" if seen else ["ask", ${ex}]\n`
    : `def flower(challenge):\n    return ${JSON.stringify(sampleResponse(config, kind === "clover" ? 1 : 2)).replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False")}\n`;
}

/** Parse the reply: <clover>/<orchid>/<bee>/<notes> tags; falls back to a JSON object with the same keys. */
export function parseReply(text) {
  const out = {};
  for (const k of [...KINDS, "notes"]) {
    const v = extractTag(text, k);
    if (v !== null && v.trim()) out[k] = v;
  }
  if (!KINDS.some((k) => out[k])) {
    const j = extractJson(text);
    if (j) for (const k of [...KINDS, "notes"]) if (typeof j[k] === "string" && j[k].trim()) out[k] = j[k].endsWith("\n") ? j[k] : j[k] + "\n";
  }
  if (out.notes) out.notes = out.notes.trim().slice(0, 2500);
  return out;
}

async function validate(tok, g, kind, code, config) {
  const check = await Api.check(tok, g, kind, code);
  const errors = [...(check.errors || [])];
  if (check.ok && kind !== "bee") {
    const t = await Api.try(tok, g, kind, code, sampleChallenges(config));
    if (t.error) errors.push(`fails to load: ${t.error}`);
    const bad = (t.results || []).filter((r) => r.error);
    if (bad.length) errors.push(`runtime test: ${bad.slice(0, 3).map((r) => `flower(${JSON.stringify(r.c).slice(0, 40)}) -> ${r.error}`).join("; ")}`);
  }
  return { kind, code, errors, nodes: check.nodes, distance: check.distance };
}

async function beeRuntime(tok, g, code) {
  const t = await Api.try(tok, g, "bee", code);
  const errs = [];
  if (t.problems?.bee) errs.push(`runtime test (your bee foraging your own patch): ${t.problems.bee}`);
  const ev = (t.visits || []).filter((v) => v.action === "error");
  if (ev.length && !t.problems?.bee) errs.push(`runtime test: ${ev.length} error visits, e.g. ${ev[0].beeError}`);
  return errs;
}

/**
 * ctx: { arena, gameRow, persona, entry, gPath, roundNo, recap, log }
 * Returns { submitted: [kinds], failed: [kinds], cost }
 */
export async function playTurn(ctx) {
  const { arena, gameRow, persona, entry, gPath, roundNo, recap, log } = ctx;
  const tok = await login(entry.login_name);
  const view = await Api.view(tok, gPath);
  const config = view.game.config;
  const system = teamSystem(persona, config);
  const notebook = (await all("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id]))[0]?.notebook || "";
  const starterNodes = {};
  if (roundNo === 1) for (const k of KINDS) starterNodes[k] = (await Api.check(tok, gPath, k, view.starters[k])).nodes;
  const base = teamRoundPrompt(view, { generation: gameRow.generation, recap: roundNo === 1 ? recap : null, nextRound: roundNo, notebook, starterNodes });
  let prompt = base;
  const submitted = new Set();
  let notes = null, cost = 0, failures = [];
  const need = roundNo === 1 ? new Set(KINDS) : new Set();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let reply;
    try {
      reply = await callModel({
        model: persona.model, system, prompt, effort: EFFORT[persona.model],
        ctx: { purpose: attempt ? "team-retry" : "team", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id },
      });
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      log(`  ${persona.name}: model call failed: ${e.message}`);
      await q("INSERT INTO arena.agent_turns (game_id, persona_id, round_no, attempt, prompt_chars, error) VALUES ($1,$2,$3,$4,$5,$6)",
        [gameRow.id, persona.id, roundNo, attempt, prompt.length, e.message.slice(0, 1000)]);
      break;
    }
    cost += reply.cost;
    const parsed = parseReply(reply.text);
    if (parsed.notes) notes = parsed.notes;
    failures = [];
    const checks = [];
    // Flowers first so the bee's runtime test forages the new flowers.
    for (const kind of ["clover", "orchid"]) {
      if (!parsed[kind]) continue;
      const v = await validate(tok, gPath, kind, parsed[kind], config);
      checks.push({ kind, nodes: v.nodes, distance: v.distance, errors: v.errors });
      if (v.errors.length) failures.push(v);
      else { const s = await Api.submit(tok, gPath, kind, parsed[kind]); if (s.submitted) { submitted.add(kind); need.delete(kind); } else failures.push({ ...v, errors: s.errors || ["not accepted"] }); }
    }
    if (parsed.bee) {
      const v = await validate(tok, gPath, "bee", parsed.bee, config);
      if (!v.errors.length) v.errors.push(...(await beeRuntime(tok, gPath, parsed.bee)));
      checks.push({ kind: "bee", nodes: v.nodes, distance: v.distance, errors: v.errors });
      if (v.errors.length) failures.push(v);
      else { const s = await Api.submit(tok, gPath, "bee", parsed.bee); if (s.submitted) { submitted.add("bee"); need.delete("bee"); } else failures.push({ ...v, errors: s.errors || ["not accepted"] }); }
    }
    for (const kind of need) if (!parsed[kind] && !failures.some((f) => f.kind === kind)) failures.push({ kind, code: "", errors: ["missing: round 1 needs all three programs"] });
    await q("INSERT INTO arena.agent_turns (game_id, persona_id, round_no, attempt, prompt_chars, reply, parsed, checks, submitted, notes, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [gameRow.id, persona.id, roundNo, attempt, prompt.length, reply.text.slice(0, 60000), JSON.stringify(Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v.length]))),
        JSON.stringify(checks), JSON.stringify([...submitted]), parsed.notes || null, reply.cost]);
    if (!failures.length) break;
    log(`  ${persona.name} r${roundNo} attempt ${attempt + 1}: ${failures.map((f) => `${f.kind}: ${f.errors.join("; ").slice(0, 160)}`).join(" | ")}`);
    if (attempt < MAX_RETRIES) prompt = retryPrompt(base, reply.text, failures, [...submitted], view);
  }

  // Round 1 needs all three programs: fall back to the starters for anything that never passed.
  const failed = failures.map((f) => f.kind).filter((k) => !submitted.has(k));
  if (roundNo === 1) {
    for (const kind of KINDS) {
      if (submitted.has(kind)) continue;
      let s = await Api.submit(tok, gPath, kind, view.starters[kind]);
      if (!s.submitted) s = await Api.submit(tok, gPath, kind, fallback(kind, config));
      log(`  ${persona.name}: using the ${s.submitted ? "starter/fallback" : "NOTHING (fallback rejected)"} ${kind}`);
    }
  }
  if (failed.length) await q("UPDATE arena.entries SET agent_errors = agent_errors + $3 WHERE game_id = $1 AND persona_id = $2", [gameRow.id, persona.id, failed.length]);
  if (notes) await q("UPDATE arena.personas SET notebook = $2 WHERE id = $1", [persona.id, notes]);
  return { submitted: [...submitted], failed, cost };
}

/** Post-game interview: "teach us your code". Same system prompt as the team turns (cache-friendly). */
export async function interview({ arena, gameRow, persona, entry, gPath, buildPrompt }) {
  const tok = await login(entry.login_name);
  const view = await Api.view(tok, gPath);
  const system = teamSystem(persona, view.game.config);
  const notebook = (await all("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id]))[0]?.notebook || "";
  const prompt = buildPrompt(view, persona, { notebook });
  const r = await callModel({ model: persona.model, system, prompt, effort: "low", ctx: { purpose: "interview", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id } });
  const ex = (extractTag(r.text, "explanation") || r.text).trim().slice(0, 4000);
  return ex;
}
