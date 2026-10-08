// One team's sessions: a tool-using Claude Code session in the team's private workspace, with the runner answering
// the workspace tools (tools/*.py: submit, check, try, status, query) through lib/broker.js. Before every request the runner
// audits the live transcript (a fair-play violation stops the session at once and refuses the request); after the
// session it audits the whole transcript, stops anything the session left running, and keeps the notebook.
// Also the lobby (write both programs, with fix sessions) and the post-game interview.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Api, gamePath, login, publicGameUrl } from "./api.js";
import { all, one, q } from "./db.js";
import { BudgetError, callModel, capModel, extractTag, runSession } from "./llm.js";
import { gameBrief, interviewPrompt, interviewSystem, lobbyBrief, mmss, rFloor, toolSystem } from "./prompts.js";
import { Broker } from "./broker.js";
import { Scaffold } from "./scaffold.js";
import { definesFed } from "./mechanisms.js";
import { bytesFactor, bytesInEnergy, bytesTerm } from "./energy.js";
import { SPIN_WARNING, TRANSCRIPTS, audit, collect, commonFiles, extOf, killLeftovers, prepareWorkspace, recordViolations, spillDir, writeMinified } from "./workspace.js";

const KINDS = ["flower", "bee"];
const n0 = (x) => Math.floor(x).toLocaleString("en-US");
/** JSON as the game measures MEMORY: sorted keys, no spaces. */
/** A MEMORY's size as the game counts it: Σ over its entries of the key's UTF-8 bytes + the value's JSON bytes. */
export const memorySize = (m) => (m && typeof m === "object" && !Array.isArray(m) ? Object.entries(m).reduce((a, [k, v]) => a + Buffer.byteLength(k) + Buffer.byteLength(JSON.stringify(v) ?? "null"), 0) : null);
/** What the game's Python refuses (introspection: dunder names, a module's private names, modules it doesn't allow), as
 * the runner reports it: a hint for check.py's output when an error looks like one of those. */
const REFUSED = /__\w+__|\bdunder\b|introspection|private name|not allowed|isn't available|not available|has no attribute '_|\bf_(?:back|globals|locals|code)\b|\bgi_frame\b/i;
export function refusalHint(errors) {
  if (!errors.some((e) => REFUSED.test(String(e)))) return null;
  return "The game's Python refuses introspection: dunder attributes (such as x.__class__, f.__globals__, .__dict__; defining dunder " +
    "methods on your own classes is fine), frame and generator internals, eval/exec/compile/globals/locals/vars/open, modules' private " +
    "names (random._os) and modules outside the allowed list (RULES.md, \"What programs can use\"). Use plain public names instead.";
}

/** A response as a short text: a big one (over 4 KB, r null with rBytes and rHash) as its size, hash and first characters. */
const showResponse = (a, n = 40) => (a.rHash ? `<${n0(a.rBytes)} bytes, sha256 ${String(a.rHash).slice(0, 12)}…: ${String(a.rPreview ?? "").slice(0, n)}…>` : JSON.stringify(a.r ?? null).slice(0, n));
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x)) ?? "null";

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

/** A quick runtime test on the game's real runner: [] when fine, else short error strings. A bee plays a short garden of
 * the team's own flower: its submitted one, or (before one is submitted) `flowerCode`, the workspace's flower file. */
export async function runtimeTest(api, tok, g, kind, code, config, flowerCode = null) {
  try {
    if (kind === "flower") {
      const t = await api.tryFlower(tok, g, code, sampleChallenges(config));
      if (t.error) return [`fails to load: ${t.error}`];
      const bad = (t.results || []).filter((r) => r.error);
      return bad.length ? [`runtime test: ${bad.slice(0, 3).map((r) => `flower(${JSON.stringify(r.c).slice(0, 40)}) -> ${r.error}`).join("; ")}`] : [];
    }
    let t;
    try { t = await api.tryBee(tok, g, code, { rounds: 60 }); }
    catch (e) {
      if (e.status !== 409 || !flowerCode?.trim()) throw e;
      t = await api.tryBee(tok, g, code, { rounds: 60, flower: flowerCode }); // no flower submitted yet: the file's
    }
    // Too slow is not a failure: a slow bee loses turns but plays on (try.py reports it).
    const slow = (x) => /too slow/i.test(String(x || ""));
    const probs = (t.problems || []).filter((p) => (p.kind ?? "bee") === "bee" && !slow(p.error)).map((p) => p.error);
    if (probs.length) return [`runtime test (your bee in a garden of your own flower): ${probs[0]}`];
    return [];
  } catch (e) {
    if (e.status === 409 && kind === "bee") return []; // no flower yet: can't run the bee, the check is enough
    return [`runtime test failed: ${e.message}`];
  }
}

// ---------------------------------------------------------------- status: clock, budgets, scores

/** Change budget available now: min(cap, bank + perMinute × (clock − atMs)). */
export const availableNow = (budget, bank, clockMs) => Math.min(budget.cap, bank.bank + (budget.perMinute * Math.max(0, clockMs - bank.atMs)) / 60000);

const num = (x, d = 2) => (x == null ? "-" : Number(x).toFixed(d));
const big = (x) => (x == null ? "-" : Math.abs(x) >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : Number(x).toFixed(0));
/** The live scoreboard, one line per team: fitness, pollination and forage with their shares, and some information
 * (pollen, feeds). Sorted by fitness. */
export function scoreboard(scores, name, teamId = null) {
  const rows = [...scores].sort((a, b) => (b.fitness ?? -1) - (a.fitness ?? -1) || (b.pollination ?? 0) - (a.pollination ?? 0));
  return rows.map((x, i) => `  ${i + 1}. ${name[x.teamId] ?? x.teamId}${x.teamId === teamId ? " (you)" : ""}: fitness ${num(x.fitness)}; ` +
    `pollination ${num(x.pollination, 1)} (share ${num(x.pollinationShare)}, from ${x.pollinators ?? "-"} bee teams), ` +
    `forage ${num(x.forage, 1)} (share ${num(x.forageShare)}, from ${x.nectarSources ?? "-"} flower species); pollen ${big(x.pollen)}, ` +
    `feeds received ${x.feedsReceived ?? "-"}, given ${x.feedsGiven ?? "-"}`).join("\n");
}

export function statusOf(view, teamId, { afford = null, code = false, memory = false } = {}) {
  const g = view.game, config = g.config, endMs = g.endMs ?? config.minutes * 60000;
  const name = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const mine = view.teams.find((t) => t.id === teamId);
  const out = { ok: true, status: g.status, clockMs: g.clockMs, endMs, leftMs: Math.max(0, endMs - g.clockMs), round: g.round ?? null, budgets: null, scores: null, versions: {}, memory: null };
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
      const x = { available: Math.floor(av), exact: av, perMinute: b.perMinute, cap: b.cap, bank: bank.bank, bankAtMs: bank.atMs, fullInMs: full };
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
  if (view.scores) {
    out.scores = view.scores.map((x) => ({ team: name[x.teamId], ...x }));
    lines.push(`Scores (live${g.status === "finished" ? ", final" : ""}):`);
    lines.push(scoreboard(view.scores, name, teamId));
  }
  if (mine?.programs) {
    const parts = [];
    for (const k of KINDS) {
      const vs = mine.programs[k] || [];
      const v = vs[vs.length - 1];
      out.versions[k] = v ? { version: v.version, size: v.size, atMs: v.atMs, problem: v.problem, ...(code ? { code: v.code } : {}) } : null;
      parts.push(v ? `${k} v${v.version} (${v.atMs ? `live since ${mmss(v.atMs)}` : "lobby"}, ${n0(v.size)} nodes${v.problem ? `; problem: ${v.problem.slice(0, 80)}` : ""})` : `${k}: not submitted`);
    }
    lines.push(`Your programs ${g.status === "lobby" ? "submitted" : "playing"}: ${parts.join(", ")}.`);
    const fl = out.versions.flower, cap = config.budgets?.flower?.size, fms = config.budgets?.flower?.ms;
    if (fl && cap && fms) lines.push(`Your flower's size ${n0(fl.size)} of ${n0(cap)}: its excess energy per turn is (${n0(cap)} − ${n0(fl.size)}) × (R − CPU ms)${bytesTerm(config)}, R the call's hidden budget ` +
      `(${rFloor(config)} to ${fms} ms): at most ${n0((cap - fl.size) * fms)} node·ms, less ${n0(cap - fl.size)} for every ms of compute or of R below ${fms}` +
      `${bytesInEnergy(config) ? ", and less in proportion to the response's size" : ""}.`);
  }
  // The bee's MEMORY: read only (only the deployed bee writes it; it starts as {} with every new bee version).
  const mem = mine?.memory;
  if (mem) {
    out.memory = { bytes: mem.bytes, cap: mem.cap ?? config.budgets?.bee?.memory ?? null, version: mem.version ?? null, error: mem.error ?? null, ...(memory ? { value: mem.value } : {}) };
    lines.push(`Your bee's MEMORY: ${n0(mem.bytes ?? 0)} of ${n0(out.memory.cap ?? 0)} bytes (bee v${mem.version ?? "-"}; only your bee writes it)` +
      (mem.error ? `; its last save failed: ${String(mem.error).slice(0, 200)}` : "") +
      (memory ? `:\n  ${JSON.stringify(mem.value ?? null).slice(0, 4000)}` : ". tools/status.py --memory shows it."));
  }
  out.text = lines.join("\n");
  return out;
}

// ---------------------------------------------------------------- the requests behind tools/*.py

/**
 * The handler for one team session's requests. ctx: { api, tok, gPath, config, teamId, gate() -> refusal|null,
 * notice() -> text|null (a fair-play warning for the session, added to what its next tool prints), record(row) }.
 * Results carry `text` (what the tool prints) plus the structured fields.
 */
export function requestHandler(ctx) {
  const { notice: noticeOf = () => null, sourceOf = () => "session" } = ctx;
  const handle = handlerOf(ctx);
  return async (req) => {
    const res = await handle(req);
    const note = sourceOf(req) === "session" ? noticeOf() : null;
    if (note && res && typeof res === "object") { res.notice = note; res.text = `${res.text ? `${res.text}\n\n` : ""}${note}`; }
    return res;
  };
}

function handlerOf(ctx) {
  const { api = Api, tok, gPath, config, teamId, gate: gateOf = () => null, record: recordRow = async () => {}, dir = null,
    sourceOf = () => "session", scaffoldOp = null } = ctx;
  // The workspace's flower file, for testing a bee before a flower is submitted.
  const fileFlower = () => { if (!dir) return null; try { return fs.readFileSync(path.join(dir, `flower.${config.language === "typescript" ? "ts" : "py"}`), "utf8"); } catch { return null; } };
  return async (req) => {
    const op = String(req.op || "");
    const kind = req.kind;
    // Who is asking: a session (an agent's tool call) or the team's scaffold (its token). Nobody else gets answers.
    const source = sourceOf(req);
    if (!source) return { ok: false, refused: true, error: "no session of your team is running, and this request isn't from your scaffold", text: "refused: no session of your team is running, and this request isn't from your scaffold" };
    const record = (row) => recordRow({ ...row, source });
    const refusal = gateOf(op, source);
    if (refusal) {
      await record({ op, kind, code: req.code, ok: false, refused: refusal });
      return { ok: false, refused: true, error: refusal, text: `refused: ${refusal}` };
    }
    if (op === "scaffold") {
      if (source !== "session" || !scaffoldOp) return { ok: false, error: "only a session can start or stop the scaffold", text: "only a session can start or stop the scaffold" };
      try { return await scaffoldOp(req); } catch (e) { return { ok: false, error: e.message, text: `error: ${e.message}` }; }
    }
    if (["check", "try", "submit"].includes(op)) {
      if (!KINDS.includes(kind)) return { ok: false, error: "kind must be flower or bee", text: "kind must be flower or bee" };
      if (typeof req.code !== "string") return { ok: false, error: "no code", text: "no code was sent" };
    }
    try {
      if (op === "status") {
        const view = await api.view(tok, gPath);
        const s = statusOf(view, teamId, { afford: Number.isFinite(req.afford) ? req.afford : null, code: !!req.code, memory: !!req.memory });
        await record({ op, ok: true, result: { clockMs: s.clockMs, budgets: s.budgets }, clockMs: s.clockMs });
        return s;
      }
      if (op === "query") {
        // A history query (docs/QUERY.md) with the team's token: this game as the team may see it, or (room) the room's
        // finished games, fully revealed. (Programs see no history: this is for the team.)
        const ast = req.ast;
        if (!ast || typeof ast !== "object" || Array.isArray(ast) || typeof ast.from !== "string") return { ok: false, error: "ast must be a query object with `from`", text: "error: ast must be a query object with `from` (docs/QUERY.md)" };
        if (JSON.stringify(ast).length > 20000) return { ok: false, error: "query too large", text: "error: query too large" };
        const room = gPath.split("/")[2];
        const r = req.room ? await api.roomQuery(tok, room, ast) : await api.query(tok, gPath, ast);
        await record({ op, ok: true, result: { from: ast.from, room: !!req.room, n: (r.rows || []).length, truncated: !!r.truncated } });
        return { ok: true, rows: r.rows || [], truncated: !!r.truncated, text: `${(r.rows || []).length} rows${r.truncated ? " (truncated: more matched)" : ""}` };
      }
      if (op === "check") {
        const c = await api.check(tok, gPath, kind, req.code);
        const errors = [...(c.errors || [])];
        if (req.test !== false && !errors.length) errors.push(...(await runtimeTest(api, tok, gPath, kind, req.code, config, fileFlower())));
        const out = { ok: !errors.length, kind, size: c.size, budget: c.budget?.size, distance: c.distance, cost: c.cost, available: c.available, minified: c.minified, errors };
        const cap = config.budgets?.flower?.size, fms = config.budgets?.flower?.ms;
        out.text = [`${kind}: ${n0(c.size)} of ${n0(c.budget?.size ?? 0)} nodes.` + (c.available != null ? ` Submitting now would cost ${n0(c.cost)} of the ${n0(c.available)} you have.` : " (lobby: submitting is free)") +
          (kind === "flower" && cap && fms && c.size != null ? ` Excess energy per turn (${n0(cap)} − ${n0(c.size)}) × (R − CPU ms)${bytesTerm(config)}, R the call's hidden budget (${rFloor(config)} to ${fms} ms): ` +
            `at most ${n0(Math.max(0, cap - c.size) * fms)} node·ms, less ${n0(Math.max(0, cap - c.size))} per ms of compute or of R below ${fms}` +
            `${bytesInEnergy(config) ? ", and less in proportion to the response's size" : ""}.` : ""),
          errors.length ? `Problems:\n- ${errors.join("\n- ")}` : "No problems found.", refusalHint(errors)].filter(Boolean).join("\n");
        if (refusalHint(errors)) out.refused = true;
        await record({ op, kind, code: req.code, ok: out.ok, result: { size: c.size, cost: c.cost, available: c.available, errors } });
        return out;
      }
      if (op === "try") {
        let out;
        if (kind === "flower") {
          const challenges = Array.isArray(req.challenges) && req.challenges.length ? req.challenges : sampleChallenges(config);
          // The call's hidden budget R: a number (ms), "random" (a fresh one per challenge, as in a game; the default), or one
          // per challenge. The server runs each call with its R as the limit and GAME.ms; a server that doesn't yet takes
          // none, and then E is recomputed here at the R asked for (its limit stays the maximum).
          const fb = config.budgets?.flower || {}, lo = rFloor(config), hi = fb.ms ?? 150;
          const want = Array.isArray(req.budget) ? req.budget : req.budget === undefined || req.budget === null || req.budget === "random" ? "random" : Number(req.budget);
          if (typeof want === "number" && !(want >= lo && want <= hi)) return { ok: false, error: `budget must be from ${lo} to ${hi} ms`, text: `error: --budget must be a number from ${lo} to ${hi} (ms), or random` };
          const t = await api.tryFlower(tok, gPath, req.code, challenges, want);
          const res = t.results || [];
          let local = false;
          if (res.length && res.every((r) => r.budgetMs === undefined)) {
            local = true;
            res.forEach((r, i) => {
              const R = Array.isArray(want) ? Number(want[i % want.length]) : typeof want === "number" ? want : lo + Math.random() * (hi - lo);
              r.budgetMs = R;
              // (cap − size): from the size, else from the energy the server computed at its own limit.
              const k = t.size != null ? Math.max(0, (fb.size ?? 1100) - t.size) : r.energy != null && r.ms != null && hi > r.ms ? r.energy / (hi - r.ms) : null;
              if (k != null && r.ms != null && !r.error) r.energy = k * Math.max(0, R - r.ms) * bytesFactor(config, r.rBytes);
            });
          }
          out = { ok: !t.error && res.every((r) => !r.error), error: t.error, results: res, size: t.size ?? null,
            text: t.error ? `fails to load: ${t.error}` : (t.size != null ? `size ${n0(t.size)} nodes\n` : "") + res.map((r) => `flower(${JSON.stringify(r.c).slice(0, 50)}) -> ${r.error ? `ERROR ${r.error}` : `${showResponse(r, 160)}, percent ${r.percent}`}` +
              `  (R ${r.budgetMs != null ? Number(r.budgetMs).toFixed(1) : "?"} ms, energy ${r.energy != null ? n0(r.energy) : "-"}, ${r.ms ?? "?"} ms CPU${r.rBytes != null ? `, ${n0(r.rBytes)} bytes` : ""})`).join("\n") +
              (local ? `\n(the game's try doesn't take a budget yet: each call ran with ${hi} ms as its limit, and the energy is recomputed here at the R shown)` : "") };
        } else {
          // memory: what the TEST bee starts with (default {}); the game's bee's MEMORY is never touched by a try.
          const opts = { rounds: Number.isFinite(req.rounds) ? req.rounds : undefined, flower: typeof req.flower === "string" ? req.flower : undefined,
            memory: req.memory !== undefined && req.memory !== null ? req.memory : undefined };
          let t;
          try { t = await api.tryBee(tok, gPath, req.code, opts); }
          catch (e) { if (e.status !== 409 || opts.flower || !fileFlower()) throw e; t = await api.tryBee(tok, gPath, req.code, { ...opts, flower: fileFlower() }); }
          const acts = (t.actions || []).filter((a) => a.action !== "arrive");
          // The test bee's final MEMORY: the server sends { value, bytes, cap, error } (a bare value is taken as the value).
          const tm = t.memory === undefined ? null : t.memory && typeof t.memory === "object" && "value" in t.memory && "bytes" in t.memory
            ? t.memory : { value: t.memory, bytes: memorySize(t.memory), cap: null, error: null };
          // fed(nectar): run by the server after each feed decided in time, in the instance that decided; a failure is a
          // bee problem "fed() failed (...)", and MEMORY stays as decide saved it.
          const fedFails = (t.problems || []).filter((p) => /^fed\(\) failed/.test(p.error || ""));
          const fed = { defined: definesFed(req.code), calls: definesFed(req.code) ? t.feeds ?? null : 0, failures: fedFails.length, firstError: fedFails[0]?.error ?? null };
          const by = (a) => acts.filter((x) => x.action === a).length;
          const probs = (t.problems || []).map((p) => `${p.kind ?? "?"}: ${p.error}`);
          const slowN = acts.filter((a) => /too slow/i.test(a.beeError || "")).length;
          const ms = acts.map((a) => a.beeMs).filter((x) => x != null).sort((a, b) => a - b);
          out = { ok: !probs.some((p) => p.startsWith("bee") && !/too slow/i.test(p)), rounds: t.rounds, feeds: t.feeds, nectar: t.nectar, pollen: t.pollen, memory: tm, fed, problems: probs, tooSlow: slowN,
            actions: acts.slice(0, 200),
            text: `${t.rounds ?? "?"} rounds in a garden of just your own flower: ${acts.length} turns, ${by("feed")} feeds, ${by("leave")} leaves; ` +
              `your bee got ${n0(t.nectar ?? 0)} nectar and ${n0(t.pollen ?? 0)} pollen.` +
              (fed.defined ? ` fed(nectar) ran after each of the ${n0(t.feeds ?? 0)} feeds${fed.failures ? `, and failed ${fed.failures} time${fed.failures === 1 ? "" : "s"} (${String(fed.firstError).slice(0, 160)})` : ""}.`
                : " Your bee defines no fed(nectar) (optional: it would run after each feed, in the same instance, and could update MEMORY).") +
              (tm ? ` The test bee's MEMORY at the end (${n0(tm.bytes)} bytes of ${n0(tm.cap ?? config.budgets?.bee?.memory ?? 0)}): ${canonical(tm.value).slice(0, 300)}${tm.error ? ` (a save was refused: ${String(tm.error).slice(0, 120)})` : ""}.` : "") +
              `${slowN ? ` ${slowN} decisions were too slow (each costs a turn).` : ""}` +
              (ms.length ? ` Decision time: median ${ms[Math.floor(ms.length / 2)].toFixed(1)} ms, slowest ${ms[ms.length - 1].toFixed(1)} ms (limit ${config.budgets?.bee?.ms ?? "?"} ms).` : "") +
              (probs.length ? `\nProblems:\n- ${probs.join("\n- ")}` : "") +
              `\nFirst turns:\n` + acts.slice(0, 12).map((a) => `  ${a.action} c=${JSON.stringify(a.c).slice(0, 40)} r=${showResponse(a)}` +
                `${a.percent != null ? ` percent=${a.percent}` : ""}${a.energy != null ? ` energy=${n0(a.energy)}` : ""}${a.nectar != null ? ` nectar=${n0(a.nectar)}` : ""}` +
                `${a.beeError ? ` bee error: ${String(a.beeError).slice(0, 80)}` : ""}${a.flowerError ? ` flower error: ${String(a.flowerError).slice(0, 80)}` : ""}${a.log ? ` printed: ${String(a.log).trim().slice(0, 60)}` : ""}`).join("\n") +
              `\n(--json for every turn)` };
        }
        await record({ op, kind, code: req.code, ok: out.ok, result: { problems: out.problems, error: out.error } });
        return out;
      }
      if (op === "submit") {
        if (!req.force) {
          const errs = await runtimeTest(api, tok, gPath, kind, req.code, config, fileFlower());
          if (errs.length) {
            const text = `not submitted: the quick runtime test failed (pass --force to submit anyway):\n- ${errs.join("\n- ")}` + (refusalHint(errs) ? `\n${refusalHint(errs)}` : "");
            await record({ op, kind, code: req.code, ok: false, refused: "runtime test", result: { errors: errs } });
            return { ok: false, errors: errs, text };
          }
        }
        const r = await api.submit(tok, gPath, kind, req.code);
        const over = (r.errors || []).some((e) => /game over/i.test(e));
        // Not affordable yet: how long until it is (the server's message says so).
        const wait = (r.errors || []).map((e) => e.match(/(?:in about|wait) (\d+) s/i)).find(Boolean);
        const never = (r.errors || []).some((e) => /can never afford|never can/i.test(e));
        const out = { ok: !!r.submitted, kind, version: r.version, size: r.size, distance: r.distance, cost: r.cost, available: r.available, atMs: r.atMs ?? null,
          errors: r.errors || [], gameOver: over, waitS: wait ? Number(wait[1]) : never ? null : undefined, never: never || undefined };
        out.text = r.submitted
          ? `${kind} v${r.version} submitted${r.cost ? `: it cost ${n0(r.cost)} nodes of change, ${n0(r.available ?? 0)} left` : ""}. ${r.available != null ? "It is live now." : "(lobby: free)"}`
          : over ? `not submitted: the game is over.` : `not submitted:\n- ${(r.errors || ["not accepted"]).join("\n- ")}` + (refusalHint(r.errors || []) ? `\n${refusalHint(r.errors)}` : "");
        await record({ op, kind, code: req.code, ok: out.ok, refused: over ? "game over" : null, version: r.version ?? null, cost: r.submitted ? r.cost : null,
          clockMs: r.submitted ? r.atMs ?? undefined : undefined, result: { size: r.size, distance: r.distance, cost: r.cost, available: r.available, errors: r.errors } });
        return out;
      }
      return { ok: false, error: `unknown request ${op}`, text: `unknown request ${op} (submit, check, try, status, query, scaffold)` };
    } catch (e) {
      await record({ op, kind, code: req.code, ok: false, result: { error: e.message } }).catch(() => {});
      return { ok: false, error: e.message, text: `error: ${e.message}` };
    }
  };
}

// ---------------------------------------------------------------- the team's desk: requests for the whole game

/**
 * One team's link to the runner for a whole game: the broker answering its workspace tools, whichever of its sessions is
 * running (session requests are gated by that session's live audit), and its scaffold (requests carrying the
 * scaffold's token). Started before the lobby, stopped (with the scaffold) when the game ends.
 */
export class TeamDesk {
  constructor({ arena, gameRow, persona, entry, gPath, dir, stream, log, apiBase, api = Api, scaffoldLimits = null, tok = null }) {
    Object.assign(this, { arena, gameRow, persona, entry, gPath, dir, stream, log, apiBase, api, tok });
    this.session = null;
    this.port = new URL(apiBase).port || "80";
    this.scaffold = new Scaffold({ arena, gameRow, persona, dir, port: this.port, apiBase, clockMs: () => stream?.clockMs ?? 0, log, limits: scaffoldLimits || arena.settings.scaffold || null });
  }

  async start() {
    this.tok ??= await login(this.entry.login_name);
    const view = await this.api.view(this.tok, this.gPath);
    this.config = view.game.config;
    fs.mkdirSync(this.dir, { recursive: true });
    this.broker = new Broker({ dir: this.dir, log: this.log, handle: requestHandler({
      api: this.api, tok: this.tok, gPath: this.gPath, config: this.config, teamId: this.entry.team_id, dir: this.dir,
      sourceOf: (req) => (this.scaffold.owns(req.scaffold) ? "scaffold" : this.session ? "session" : null),
      gate: (op, source) => (source === "session" ? this.session?.gate(op) ?? null : null),
      notice: () => this.session?.notice?.() ?? null,
      record: (row) => this.record(row),
      scaffoldOp: (req) => this.scaffoldOp(req),
    }) }).start();
    return this;
  }

  async record(r) {
    const session = r.source === "session" ? this.session : null;
    if (session) { session.requests++; if (r.op === "submit" && r.ok) session.submitted.push({ kind: r.kind, version: r.version, cost: r.cost }); }
    const clockMs = r.clockMs ?? this.stream?.clockMs ?? null;
    await q(`INSERT INTO arena.requests (session_id, game_id, persona_id, op, kind, code, ok, refused, result, version, cost, clock_ms, source, scaffold_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [session?.id ?? null, this.gameRow.id, this.persona.id, r.op, r.kind ?? null, r.code ?? null, r.ok ?? null, r.refused ?? null, JSON.stringify(r.result ?? null),
        r.version ?? null, r.cost ?? null, clockMs, r.source, r.source === "scaffold" ? this.scaffold.rowId : null]);
    if (r.op === "submit" && r.ok) this.log(`  ${this.persona.name}: ${r.source === "scaffold" ? "SCAFFOLD " : ""}submitted ${r.kind} v${r.version}${r.cost ? ` (cost ${r.cost})` : ""} at ${clockMs != null ? mmss(clockMs) : "?"}`);
  }

  /** tools/scaffold.py: start | stop | restart | status | logs */
  async scaffoldOp(req) {
    const action = String(req.action || "status");
    const sc = this.scaffold;
    if (action === "start" || action === "restart") {
      const file = String(req.file || sc.file || "scaffold.py");
      if (this.stream?.status === "finished") return { ok: false, text: "the game is over: no scaffold can start now" };
      const r = await sc.start(file, { action: sc.file && action === "restart" ? "restart" : "start", sessionId: this.session?.id ?? null });
      return { ok: r.ok, text: r.text, audit: r.found };
    }
    if (action === "stop") { const had = !!sc.child; await sc.stop("stopped by the team"); return { ok: true, text: had ? "scaffold stopped" : "no scaffold was running" }; }
    if (action === "logs") return { ok: true, text: sc.logTail(Math.min(400, Number(req.n) || 40)) };
    const st = sc.status();
    return { ok: true, ...st, text: st.file ? `scaffold ${st.file}: ${st.state}${st.pid ? ` (pid ${st.pid}, running ${st.runningForS} s)` : ""}; restarts ${st.restarts}, crashes ${st.crashes}` +
      `${st.lastExit ? `, last exit ${st.lastExit}` : ""}${st.lastError ? `\naudit: ${st.lastError}` : ""}; CPU ${st.cpuSeconds ?? 0} s, paused ${st.throttledMs} ms for using more than its CPU share` : "no scaffold started in this game" };
  }

  async stop(reason = "game over") {
    await this.scaffold.stop(reason);
    await this.broker?.stop();
  }
}

// ---------------------------------------------------------------- one session

/**
 * Run one session of a team. phase: lobby | game. buildPrompt({ view, drafts, status, maxTurns }) -> the brief.
 * control: { cancelled?, kill? } shared with the caller (the runner stops sessions when the game ends). Returns
 * { sessionId, cost, violation, killed, requests, submitted }.
 */
/** How the brief names a team's start bee: common/<file> when its role's documents include it, else the file's name. */
const startBeeName = (file, common) => (!file ? null : common?.includes(path.basename(file)) ? `common/${path.basename(file)}` : path.basename(file));

export async function runTeamSession({ desk, arena, gameRow, persona, entry, gPath, stream, phase, sessionNo, attempt = 0, buildPrompt, log, control = {}, timeoutMs, carry = null, api = Api }) {
  const S = arena.settings.session || {};
  const tok = await login(entry.login_name);
  const view = await api.view(tok, gPath);
  const config = view.game.config;
  const teamId = entry.team_id;
  const lim = limitsFor(arena, persona.model, phase);
  const maxTurns = attempt ? Math.min(15, lim.turns) : lim.turns;
  const apiBase = publicGameUrl(arena.room_short_id, gameRow.game_short_id);
  const status = statusOf(view, teamId);
  const { dir, ext, drafts } = await prepareWorkspace({ arena, gameRow, persona, view, stream, apiBase, statusText: status.text + "\n(at the start of this session)\n", carry, tok });
  const teams = (view.participants || view.teams.map((t) => t.id)).length;
  const cf = commonFiles(arena, persona);
  const system = toolSystem(persona, config, dir, { fixed: !!arena.settings.noEvolution, apiBase, teams, common: cf?.files, commonScope: cf?.scope,
    role: arena.settings.roles?.[persona.slug]?.role ?? null, roleBrief: arena.settings.roles?.[persona.slug]?.brief ?? null,
    startBee: startBeeName(arena.settings.starts?.[persona.slug]?.bee, cf?.files), brevity: arena.settings.prompts?.brevity !== false,
    simpleCode: arena.settings.prompts?.simpleCode !== false });
  const scripts = fs.readdirSync(dir).filter((f) => f.endsWith(".py") && !KINDS.includes(f.replace(/\.py$/, "")));
  const prompt = buildPrompt({ view, drafts, status, maxTurns, scripts, dir, brevity: arena.settings.prompts?.brevity !== false });
  const tag = `${arena.id}:${persona.slug}:g${gameRow.generation}:s${sessionNo}${attempt ? `a${attempt}` : ""}:${crypto.randomBytes(3).toString("hex")}`;
  const transcript = path.join(TRANSCRIPTS, arena.id, persona.slug, `g${gameRow.generation}-s${sessionNo}${attempt ? `-a${attempt}` : ""}.jsonl`);
  const row = await one(`INSERT INTO arena.sessions (arena_id, game_id, persona_id, no, attempt, phase, model, clock_start, transcript, prompt_chars)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [arena.id, gameRow.id, persona.id, sessionNo, attempt, phase, persona.model, view.game.clockMs, transcript, system.length + prompt.length]);
  const sessionId = row.id;
  const port = new URL(apiBase).port || "80";
  let violated = null;
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
  // Fair-play warnings that don't stop the session (a busy-wait burning a core): told to it once, with its next tool's
  // output, and logged.
  const warned = new Set();
  const notice = () => {
    const fresh = audit(control.lines || [], dir, arena.id, persona.slug, { port }).filter((f) => f.severity === "warning" && SPIN_WARNING.test(f.detail) && !warned.has(f.detail));
    if (!fresh.length) return null;
    for (const f of fresh) warned.add(f.detail);
    log(`  ${persona.name}: fair-play warning in session ${sessionNo}: ${fresh[0].detail.slice(0, 160)}`);
    return `Fair play (a warning from the runner): ${fresh[0].detail.split(":")[0]}. A busy-wait or a deliberate CPU burn takes a core from ` +
      `the game's programs, whose time limits are wall clock. To wait, use time.sleep() (or garden.wait_for_budget in a scaffold).`;
  };
  const session = { id: sessionId, no: sessionNo, gate, notice, requests: 0, submitted: [] };
  desk.session = session;
  let s;
  try {
    s = await runSession({
      model: persona.model, cwd: dir, appendSystem: system, prompt, maxTurns, python: true, maxBudgetUsd: attempt ? lim.usd / 3 : lim.usd,
      transcriptFile: transcript, timeoutMs: timeoutMs || 40 * 60_000, control, env: { ARENA_SESSION: tag }, holdOnLimit: phase === "lobby",
      effort: S.effort ?? null, ...(S.nice != null ? { nice: S.nice } : {}),
      ctx: { purpose: phase === "lobby" ? (attempt ? "lobby-fix" : "lobby") : "session", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id },
    });
  } catch (e) {
    if (desk.session === session) desk.session = null;
    await killLeftovers(tag, dir, () => desk.scaffold.pids());
    await q("UPDATE arena.sessions SET ended_at = now(), ended_by = $2 WHERE id = $1", [sessionId, e instanceof BudgetError ? "budget" : `error: ${e.message.slice(0, 200)}`]);
    throw e;
  }
  if (desk.session === session) desk.session = null; // from now on only the scaffold's requests get answers
  // Whatever the session left running is stopped (its scaffold, which the runner supervises, is not).
  const left = await killLeftovers(tag, dir, () => desk.scaffold.pids());
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
  return { sessionId, cost: s.cost, violation, killed: s.killed, limit: s.limit, requests: session.requests, submitted: session.submitted, dir, ext, files };
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
 * The lobby: one session to write both programs, then fix sessions while one is missing. A program file the team
 * wrote but didn't submit is submitted for it if it passes the checks (writing is free in the lobby). Returns
 * { ready, violation }; a team that isn't ready sits the game out.
 */
export async function lobby({ desk, arena, gameRow, persona, entry, gPath, stream, log, carry, examples, api = Api }) {
  const tok = await login(entry.login_name);
  let fix = null, violation = false;
  for (let attempt = 0; attempt <= MAX_LOBBY_FIXES; attempt++) {
    // A preset's lobbyMinutes: the lobby session's wall time (a fix attempt gets a third of it, at least two minutes).
    const lobbyMinutes = arena.settings.session?.lobbyMinutes ?? null;
    const minutes = lobbyMinutes ? (attempt ? Math.max(2, lobbyMinutes / 3) : lobbyMinutes) : null;
    const s = await runTeamSession({
      desk, arena, gameRow, persona, entry, gPath, stream, phase: "lobby", sessionNo: 0, attempt, log, carry: attempt ? null : carry, api,
      ...(minutes ? { timeoutMs: minutes * 60_000 } : {}),
      buildPrompt: ({ view, maxTurns, brevity }) => lobbyBrief({ config: view.game.config, teamName: entry.team_name, generation: gameRow.generation, maxTurns,
        carried: !!carry && Object.values(carry).some(Boolean), fix, examples, common: commonFiles(arena, persona)?.files, commonScope: commonFiles(arena, persona)?.scope,
        seeded: !!arena.settings.seeds?.[persona.slug], brevity, minutes: attempt ? null : minutes,
        started: gameRow.generation === 1 ? Object.keys(arena.settings.starts?.[persona.slug] || {}) : null }),
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
      if (!errs.length) errs.push(...(await runtimeTest(api, tok, gPath, k, code, config, s.files.flower)));
      if (errs.length) {
        if (have[k] === null) failures.push(`- ${k}: ${errs.join("; ")}`);
        if (c.minified) writeMinified(s.dir, s.ext, k, c.minified);
        continue;
      }
      const r = await api.submit(tok, gPath, k, code);
      if (r.submitted) {
        log(`  ${persona.name}: ${k}.${s.ext} was ${have[k] === null ? "written but not submitted" : "changed after submitting"}; the runner submitted it (v${r.version})`);
        await q(`INSERT INTO arena.requests (session_id, game_id, persona_id, op, kind, code, ok, refused, result, version, cost, clock_ms, source) VALUES ($1,$2,$3,'submit',$4,$5,true,'auto: lobby fallback',$6,$7,0,0,'runner')`,
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

/** The final programs (latest versions) of every team in a finished game, and how often each changed during play, from
 * the game's API (everything is revealed once it is over). gPath: the game's API path. */
export async function finalPrograms(gPath, api = Api) {
  const view = await api.view(null, gPath);
  const out = {};
  for (const t of view.teams || []) {
    const o = { code: {}, changes: 0 };
    for (const k of KINDS) {
      const vs = t.programs?.[k] || [];
      if (vs.length) o.code[k] = vs[vs.length - 1].code ?? null;
      o.changes += vs.filter((v) => Number(v.atMs) > 0).length;
    }
    out[t.id] = o;
  }
  return out;
}

/** Post-game interview: "teach us your code" (one model call, no tools). */
export async function interview({ arena, gameRow, persona, entry, entries, finals }) {
  const notebook = (await one("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id]))?.notebook || "";
  const standings = entries.filter((e) => e.fitness != null).sort((a, b) => b.fitness - a.fitness).map((e) => ({ name: e.team_name, fitness: e.fitness, me: e.persona_id === persona.id }));
  const mine = finals[entry.team_id] || { code: {}, changes: 0 };
  const r = await callModel({ model: capModel(persona.model, arena.settings.maxModel), system: interviewSystem(persona, !!arena.settings.noEvolution, { simpleCode: arena.settings.prompts?.simpleCode !== false }),
    prompt: interviewPrompt({ standings, programs: mine.code, changes: mine.changes, config: gameRow.config, notebook }),
    effort: "low", ctx: { purpose: "interview", arenaId: arena.id, gameId: gameRow.id, personaId: persona.id } });
  return (extractTag(r.text, "explanation") || r.text).trim().slice(0, 4000);
}

export { extOf, gameBrief };
