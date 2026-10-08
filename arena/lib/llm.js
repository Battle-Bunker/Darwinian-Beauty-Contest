// Headless model calls through the `claude` CLI (no API key needed):
//   claude -p --model <m> --tools "" --system-prompt <sys> --output-format json --no-session-persistence
// The prompt goes in on stdin. One process-wide concurrency limiter, retries with backoff, a global
// cool-down on rate limits, a spend guard, and a cost ledger (arena.llm_calls).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ARENA_DIR, one, q } from "./db.js";

// No Fable model anywhere: team personas, judges, breeders and every other call use opus, sonnet or haiku.
export const MODELS = ["opus", "sonnet", "haiku"];

const EMPTY_CWD = path.join(ARENA_DIR, "runs", "cwd"); // no CLAUDE.md, no repo: nothing leaks into prompts
// The CLI to run (tests point it at a stub that makes no model calls).
const CLAUDE = process.env.ARENA_CLAUDE_BIN || "claude";
// Team sessions (the CLI and everything it starts: the agents' python, their tools) run below the game server, whose
// programs' time limits are wall clock; a preset can lower them further (session.nice). Scaffolds run at nice 15.
const SESSION_NICE = 5;
fs.mkdirSync(EMPTY_CWD, { recursive: true });

export class BudgetError extends Error {}

// ---------- limiter ----------
let maxConcurrent = Number(process.env.ARENA_CONCURRENCY || 8);
let active = 0;
const waiters = [];
let coolUntil = 0; // global pause after a rate limit / overload

export function setConcurrency(n) { maxConcurrent = n; pump(); }
// Live tuning without a restart: echo 16 > arena/runs/concurrency. Only a file written while this runner is running
// counts: one left over from an earlier run doesn't override ARENA_CONCURRENCY or a preset's concurrency.
const CONTROL = path.join(ARENA_DIR, "runs", "concurrency");
const STARTED = Date.now();
setInterval(() => {
  try {
    if (fs.statSync(CONTROL).mtimeMs < STARTED) return;
    const n = Number(fs.readFileSync(CONTROL, "utf8").trim());
    if (n > 0 && n !== maxConcurrent) { console.log(`[llm] concurrency ${maxConcurrent} -> ${n}`); setConcurrency(n); }
  } catch {}
}, 20_000).unref();
function pump() {
  while (active < maxConcurrent && waiters.length) { active++; waiters.shift()(); }
}
async function acquire() {
  if (active < maxConcurrent) { active++; return; }
  await new Promise((r) => waiters.push(r));
}
function release() { active--; pump(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const llmStats = () => ({ active, waiting: waiters.length, maxConcurrent });

// ---------- budget ----------
export const GLOBAL_CAP = Number(process.env.ARENA_BUDGET_USD || 300);
const arenaCaps = new Map(); // arenaId -> usd
export function setArenaCap(arenaId, usd) { if (usd) arenaCaps.set(arenaId, usd); }

export async function spend(arenaId) {
  const g = await one("SELECT coalesce(sum(cost_usd),0) AS s FROM arena.llm_calls");
  const a = arenaId ? await one("SELECT coalesce(sum(cost_usd),0) AS s FROM arena.llm_calls WHERE arena_id = $1", [arenaId]) : { s: 0 };
  return { global: g.s, arena: a.s };
}
async function checkBudget(arenaId) {
  const s = await spend(arenaId);
  if (s.global >= GLOBAL_CAP) throw new BudgetError(`global budget reached: $${s.global.toFixed(2)} >= $${GLOBAL_CAP}`);
  const cap = arenaCaps.get(arenaId);
  if (cap && s.arena >= cap) throw new BudgetError(`arena ${arenaId} budget reached: $${s.arena.toFixed(2)} >= $${cap}`);
}

// ---------- one CLI run ----------
function runCli({ model, system, prompt, effort, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ["-p", "--model", model, "--tools", "", "--system-prompt", system, "--output-format", "json", "--no-session-persistence"];
    if (effort) args.push("--effort", effort);
    const child = spawn(CLAUDE, args, { cwd: EMPTY_CWD, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let out = "", err = "", done = false;
    const timer = setTimeout(() => { if (!done) { err += "\n[arena] timeout"; child.kill("SIGKILL"); } }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { err += String(e); });
    child.on("close", (code) => {
      done = true;
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "null"); } catch {}
      resolve({ code, json, out, err });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

// ---------- usage limits: pause, then resume by hand ----------
// Account-level limits ("You've hit your session limit · resets 3:10am (UTC)") are shared with other sessions,
// so the runner PAUSES: it writes arena/runs/PAUSED, starts no new calls, and holds every call that comes back
// limit-failed (not an attempt, not a failure, nothing recorded as a result) until a person deletes the file.
// Creating the file by hand pauses the runner too. In-flight calls finish normally.
export const PAUSE_FILE = process.env.ARENA_PAUSE_FILE || path.join(ARENA_DIR, "runs", "PAUSED");
export const USAGE_LIMIT = /session limit|usage limit|limit\s*·\s*resets|hit your .{0,20}limit|resets \d{1,2}(:\d\d)?\s*(am|pm)|\b429\b|rate.?limit/i;
export function classify(r) {
  const j = r.json;
  const text = `${j?.result ?? ""} ${r.err ?? ""} ${j?.api_error_status ?? ""}`;
  const limit = USAGE_LIMIT.test(text);
  const overloaded = !limit && /overloaded|\b529\b|too many requests/i.test(text);
  return { limit, overloaded, msg: (j?.result || r.err || `exit ${r.code}`).toString().slice(0, 500) };
}

export const isPaused = () => fs.existsSync(PAUSE_FILE);
/** Enter the paused state (idempotent): write the pause file and log one line. */
export function pause(msg, reason = "usage limit hit") {
  if (isPaused()) return;
  try { fs.writeFileSync(PAUSE_FILE, `${new Date().toISOString()}\n${reason}: ${msg}\n`); } catch {}
  console.log(`[arena] PAUSED: ${reason} (${String(msg).replace(/\s+/g, " ").slice(0, 200)}). Resume: rm ${path.relative(process.cwd(), PAUSE_FILE) || PAUSE_FILE}`);
}
let waitingLogged = false;
/** Block while the pause file exists (polled every 30 s). Used before every call and before every round. */
export async function waitIfPaused(pollMs = 30_000) {
  if (!isPaused()) return;
  if (!waitingLogged) { waitingLogged = true; console.log(`[arena] paused: waiting for ${PAUSE_FILE} to be deleted`); }
  while (isPaused()) await sleep(pollMs);
  if (waitingLogged) { waitingLogged = false; console.log(`[arena] RESUMED (pause file removed)`); }
}

// Kept for older imports; the runner no longer halts on usage limits, it pauses.
export class SessionLimitError extends BudgetError {}

/**
 * Call a model. Returns { text, cost, usage, ms, model }.
 * ctx: { purpose, arenaId, gameId, personaId } for the ledger.
 */
export async function callModel({ model, system, prompt, effort = null, timeoutMs = 12 * 60_000, retries = 3, ctx = {} }) {
  if (!MODELS.includes(model)) throw new Error("unknown model " + model);
  let lastErr = null, waits = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitIfPaused();
    await checkBudget(ctx.arenaId);
    while (Date.now() < coolUntil) await sleep(coolUntil - Date.now() + Math.random() * 2000);
    await acquire();
    if (isPaused()) { release(); attempt--; continue; } // paused while queued: hold it
    const t0 = Date.now();
    let r;
    try {
      r = await runCli({ model, system, prompt, effort, timeoutMs });
    } finally {
      release();
    }
    const ms = Date.now() - t0;
    const j = r.json;
    const cost = Number(j?.total_cost_usd || 0);
    const usage = j?.usage || {};
    const resolved = j?.modelUsage ? Object.keys(j.modelUsage).join(",") : null;
    const ok = !!j && !j.is_error && typeof j.result === "string" && j.result.trim().length > 0;
    const { limit, overloaded, msg } = ok ? { limit: false, overloaded: false, msg: null } : classify(r);
    // Cost ledger only (not evaluation data). Limit-held calls are marked so they're easy to tell apart.
    await q(
      `INSERT INTO arena.llm_calls (model, resolved, purpose, arena_id, game_id, persona_id, cost_usd, input_tokens, output_tokens, cache_read, cache_write, duration_ms, ok, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [model, resolved, ctx.purpose || "other", ctx.arenaId || null, ctx.gameId || null, ctx.personaId || null, cost,
        usage.input_tokens ?? null, usage.output_tokens ?? null, usage.cache_read_input_tokens ?? null, usage.cache_creation_input_tokens ?? null,
        ms, ok, limit ? `[held: usage limit] ${msg}` : msg]).catch((e) => console.error("ledger insert failed", e.message));
    if (ok) return { text: j.result, cost, usage, ms, model: resolved };
    if (limit) { pause(msg); attempt--; continue; } // not an attempt: re-issued unchanged after resume
    lastErr = msg;
    // Overloads get a cool-down that doesn't use up attempts (up to ~1 hour); other errors back off 5s, 15s, 45s.
    if (overloaded && waits < 12) { waits++; attempt--; }
    const backoff = overloaded ? Math.min(5 * 60_000, 60_000 * waits) : 5_000 * 3 ** Math.max(0, attempt);
    if (overloaded) coolUntil = Math.max(coolUntil, Date.now() + backoff);
    console.error(`[llm] ${model} ${ctx.purpose} ${ctx.personaId || ""} failed (${overloaded ? `overloaded, cool-down ${waits}` : `attempt ${attempt + 1}`}): ${msg?.slice(0, 200)}`);
    await sleep(backoff);
  }
  throw new Error(`model call failed after ${retries + 1} attempts: ${lastErr}`);
}

// ---------- reply parsing ----------

/** First JSON object in the text (```json fences preferred), or null. */
export function extractJson(text) {
  if (!text) return null;
  const tries = [];
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text))) tries.push(m[1]);
  // Balanced-brace scan of top-level objects (respecting strings).
  let start = text.indexOf("{");
  while (start >= 0 && tries.length < 16) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { end = i; break; }
    }
    if (end < 0) { tries.push(text.slice(start)); break; }
    tries.push(text.slice(start, end + 1));
    start = text.indexOf("{", end + 1);
  }
  tries.sort((a, b) => b.length - a.length); // the big object is the answer; small ones are code fragments
  for (const t of tries) {
    for (const s of [t, t.replace(/,\s*([}\]])/g, "$1")]) {
      try { const v = JSON.parse(s); if (v && typeof v === "object") return v; } catch {}
    }
  }
  return null;
}

/** Content of <tag>...</tag> (last occurrence wins, so a model that drafts then finalises is fine). */
export function extractTag(text, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m, last = null;
  while ((m = re.exec(text))) last = m[1];
  if (last === null) return null;
  // Tolerate a markdown fence inside the tag.
  const f = last.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/);
  return (f ? f[1] : last).replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
}

// ---------- tool-using sessions ----------
// One `claude -p` agent session with file and shell tools, run inside a team's workspace. Minimal environment
// (HOME, PATH, LANG only): no database URL, no proxy or session tokens, no login secret. The stream-json transcript is
// saved for auditing, and kept in memory (control.lines) so the runner can audit it while the session runs. Same
// limiter, cost ledger and usage-limit pause as callModel.
const SESSION_PATH = ["/opt/node22/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
const NICE_BIN = "/usr/bin/nice";

// Per-million-token prices, used only to estimate the cost of a session the runner had to stop before the CLI
// reported its cost (stream-json reports usage per message). Conservative public list prices.
const PRICES = {
  opus: { in: 5, out: 25, read: 0.5, write: 6.25 },
  sonnet: { in: 3, out: 15, read: 0.3, write: 3.75 },
  haiku: { in: 1, out: 5, read: 0.1, write: 1.25 },
};
/** Estimated cost of a (partial) stream-json transcript: usage summed once per assistant message id. */
export function estimateCost(lines, model) {
  const p = PRICES[model] || PRICES.opus;
  const seen = new Map();
  for (const line of lines) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type !== "assistant" || !ev.message?.usage) continue;
    seen.set(ev.message.id || seen.size, ev.message.usage); // later events of one message carry its final usage
  }
  let usd = 0;
  const tot = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const u of seen.values()) {
    for (const k of Object.keys(tot)) tot[k] += Number(u[k] || 0);
  }
  usd = (tot.input_tokens * p.in + tot.output_tokens * p.out + tot.cache_read_input_tokens * p.read + tot.cache_creation_input_tokens * p.write) / 1e6;
  return { usd, usage: tot, turns: seen.size };
}

/** The model an arena may use: settings.maxModel "sonnet" runs opus calls (judges, breeders) on sonnet. */
export function capModel(model, maxModel) {
  if (!maxModel) return model;
  const order = ["haiku", "sonnet", "opus"];
  return order.indexOf(model) > order.indexOf(maxModel) ? maxModel : model;
}

function runSessionCli({ model, cwd, appendSystem, prompt, maxTurns, maxBudgetUsd, transcriptFile, timeoutMs, python = true, control, env = {}, effort = null, nice = SESSION_NICE }) {
  return new Promise((resolve) => {
    const args = ["-p", "--model", model, "--tools", "Bash,Read,Write,Edit,Glob,Grep", "--permission-mode", "acceptEdits",
      // The user explicitly approved a Python interpreter for team agents (this container is isolated and
      // disposable), so they can analyse the stream and test programs with scripts. The workspace tools
      // (tools/*.py) run with it too.
      ...(python ? ["--allowedTools", "Bash(python3:*)", "Bash(python:*)"] : []),
      "--max-turns", String(maxTurns), "--output-format", "stream-json", "--verbose", "--no-session-persistence",
      // A full system prompt (not appended): Claude Code's default one advertises an auto-memory directory under
      // ~/.claude/projects/ (outside the workspace, next to the other teams'), plus env and cwd details.
      "--system-prompt", appendSystem];
    if (maxBudgetUsd) args.push("--max-budget-usd", String(maxBudgetUsd));
    if (effort) args.push("--effort", effort);
    fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
    const out = fs.createWriteStream(transcriptFile);
    // A team's own scripts (tests, stream analysis) yield the CPU to the garden's programs, whose time limits are wall
    // clock: the session and everything it starts run at a lower priority. Started through nice(1), so every thread of
    // the CLI, and every process it starts, has it from the first instruction (nice 0 keeps the old way: no wrapper).
    const env2 = { HOME: process.env.HOME || "/root", PATH: SESSION_PATH, LANG: "C.UTF-8", ...env };
    const child = nice > 0 && fs.existsSync(NICE_BIN)
      ? spawn(NICE_BIN, ["-n", String(nice), CLAUDE, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"], env: env2 })
      : spawn(CLAUDE, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: env2 });
    if (nice > 0 && !fs.existsSync(NICE_BIN)) try { os.setPriority(child.pid, nice); } catch {}
    const lines = [];
    let buf = "", last = null, err = "", limitText = null, killed = null, closed = false;
    if (control) {
      control.lines = lines;
      control.child = child;
      control.kill = (reason) => {
        if (closed || killed) return;
        killed = reason;
        err += `\n[arena] stopped: ${reason}`;
        child.kill("SIGTERM");
        setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 4000).unref();
      };
    }
    const timer = setTimeout(() => { if (control?.kill) control.kill("timeout"); else { killed = "timeout"; child.kill("SIGKILL"); } }, timeoutMs);
    child.stdout.on("data", (d) => {
      out.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        lines.push(line);
        try {
          const ev = JSON.parse(line);
          if (ev.type === "result") last = ev;
          if (ev.type === "assistant" && ev.error) limitText = JSON.stringify(ev.message?.content ?? ev.error).slice(0, 500);
        } catch {}
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (err += String(e)));
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true; closed = true;
      clearTimeout(timer);
      out.end();
      resolve({ code, result: last, err, limitText, killed, lines });
    };
    child.on("close", finish);
    // A process the session left running may still hold the CLI's stdout: don't wait for it once the CLI has exited.
    child.on("exit", (code) => setTimeout(() => { if (!done) { child.stdout.destroy(); child.stderr.destroy(); finish(code); } }, 3000).unref());
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

/**
 * Run one tool-using session. Returns { text, cost, estimated, turns, subtype, isError, killed, ms }.
 * `control` (optional, filled in here): { lines, child, kill(reason) } so the caller can audit the live transcript
 * and stop the session (game over, fair-play violation). A stopped session's cost is estimated from its usage.
 * Usage-limit failures pause the runner and the session is re-run unchanged after resume (not an attempt), unless
 * `holdOnLimit` is false (sessions in a running game: the moment has passed, so the caller decides). `env`: extra
 * environment (a session tag, so the runner can find what the session left running).
 */
export async function runSession({ model, cwd, appendSystem, prompt, maxTurns = 30, maxBudgetUsd = null, transcriptFile, timeoutMs = 40 * 60_000, python = true, ctx = {}, control = null, holdOnLimit = true, env = {}, effort = null, nice = SESSION_NICE }) {
  if (!MODELS.includes(model)) throw new Error("unknown model " + model);
  for (let hold = 0; ; hold++) {
    await waitIfPaused();
    await checkBudget(ctx.arenaId);
    await acquire();
    if (isPaused()) { release(); continue; }
    if (control?.cancelled) { release(); return { text: "", cost: 0, estimated: false, turns: 0, subtype: "cancelled", isError: true, killed: control.cancelled, ms: 0, err: "" }; }
    const t0 = Date.now();
    let r;
    try {
      r = await runSessionCli({ model, cwd, appendSystem, prompt, maxTurns, maxBudgetUsd, python, control, env, effort, nice, transcriptFile: hold ? transcriptFile.replace(/\.jsonl$/, `.hold${hold}.jsonl`) : transcriptFile, timeoutMs });
    } finally {
      release();
    }
    const ms = Date.now() - t0;
    const res = r.result || {};
    let cost = Number(res.total_cost_usd || 0), estimated = false;
    let usage = res.usage || {};
    if (!r.result) { // stopped (or crashed) before the CLI reported: estimate from the transcript's usage
      const e = estimateCost(r.lines, model);
      cost = e.usd; usage = e.usage; estimated = true;
    }
    const text = typeof res.result === "string" ? res.result : "";
    const limitMsg = [text, r.err, r.limitText, res.api_error_status].filter(Boolean).join(" ");
    const limit = !r.killed && (res.is_error || !r.result) && USAGE_LIMIT.test(limitMsg);
    const ok = !!r.result && !limit;
    await q(
      `INSERT INTO arena.llm_calls (model, resolved, purpose, arena_id, game_id, persona_id, cost_usd, estimated, input_tokens, output_tokens, cache_read, cache_write, duration_ms, ok, error, turns)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [model, res.modelUsage ? Object.keys(res.modelUsage).join(",") : null, ctx.purpose || "session", ctx.arenaId || null, ctx.gameId || null, ctx.personaId || null, cost, estimated,
        usage.input_tokens ?? null, usage.output_tokens ?? null, usage.cache_read_input_tokens ?? null, usage.cache_creation_input_tokens ?? null,
        ms, ok, limit ? `[held: usage limit] ${limitMsg.slice(0, 400)}` : r.killed ? `[stopped: ${r.killed}]` : ok ? (res.subtype !== "success" ? res.subtype : null) : (r.err || "no result").slice(0, 500), res.num_turns ?? null])
      .catch((e) => console.error("ledger insert failed", e.message));
    if (limit) {
      pause(limitMsg);
      if (holdOnLimit) continue;
    }
    return { text, cost, estimated, turns: res.num_turns ?? null, subtype: r.killed ? `killed:${r.killed}` : limit ? "usage-limit" : res.subtype ?? null,
      isError: !!res.is_error || !r.result, killed: r.killed, limit, ms, err: r.err };
  }
}
