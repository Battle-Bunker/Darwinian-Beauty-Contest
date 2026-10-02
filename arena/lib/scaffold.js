// Scaffolds: a team's own long-running program outside the engine. In games of a few minutes an LLM session is too slow
// to react; a scaffold watches the stream and submits changes by itself (tools/garden.py), within the team's change
// budget (the server enforces it). A session starts it from the workspace (tools/scaffold.py start scaffold.py); the
// runner then supervises it for the rest of the game, independently of sessions:
//   - a static audit of its code before every start and restart (the entry file and the workspace modules it imports),
//     with the session audit's rules plus: nothing that escapes supervision (no subprocesses, forks, exec/eval,
//     dynamic imports, ctypes), no environment, no paths outside the workspace
//   - limits: nice 15, RLIMIT_AS / RLIMIT_CPU / RLIMIT_FSIZE / RLIMIT_NOFILE (lib/scaffold_launch.py), and a CPU share
//     (a fraction of one core) enforced by pausing it (SIGSTOP/SIGCONT) when it uses more
//   - its own process group; stdout and stderr go to <workspace>/scaffold/scaffold.log (kept under a size limit)
//   - restarts after a crash with backoff (1, 2, 4, ... 30 s), re-audited each time; a clean exit (code 0) is final
//   - stopped when the game ends (and when the runner stops)
// Its requests carry a token only it knows (from its environment, read by tools/_runner.py), so the runner can tell
// its submissions from a session's. Every start is recorded in arena.scaffolds with the audited source.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARENA_DIR, one, q } from "./db.js";
import { codeFindings, installTools, otherWorkspaces, processTree } from "./workspace.js";

const LAUNCHER = path.join(ARENA_DIR, "lib", "scaffold_launch.py");
const BACKOFF = [1, 2, 4, 8, 15, 30];
export const SCAFFOLD_LIMITS = { cpuShare: 0.15, memMB: 1024, fileMB: 200, nice: 15, logBytes: 2e6, cpuSeconds: 900 };

// What a scaffold may not do on top of what any written code may not: escape supervision or the static audit.
const SPAWN = /\bsubprocess\b|\bos\s*\.\s*(?:system|popen|fork|forkpty|exec\w*|spawn\w*|posix_spawn\w*|kill|killpg|setsid|setpgid|setpgrp|daemon|nice|setpriority|chdir)\b|\bmultiprocessing\b|\bimport\s+pty\b|\bfrom\s+pty\b|ProcessPoolExecutor|\bctypes\b|\bimportlib\b|__import__|(?<![\w.])(?:exec|eval|compile)\s*\(|\bsys\s*\.\s*modules\b|\bbuiltins\b|\bresource\s*\.\s*setrlimit\b|\bsignal\s*\.\s*(?:signal|SIGSTOP|SIGCONT|pthread_kill)\b/;
const PY_STRINGS = /(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")/g;

/** Static audit of a scaffold: the entry file and the workspace modules it imports (not tools/, which are the runner's).
 * Returns { files: [{path, text}], found: [{severity, detail}] }. */
export function auditScaffold(dir, entry, { arenaId, slug, port = "4000" }) {
  const otherWs = otherWorkspaces(arenaId, slug);
  const files = [], found = [];
  const add = (severity, detail) => found.push({ severity, detail });
  const abs = path.resolve(dir, entry);
  if (!abs.startsWith(dir + "/")) { add("violation", `scaffold outside the workspace: ${entry}`); return { files, found }; }
  if (!fs.existsSync(abs)) { add("error", `no such file: ${entry}`); return { files, found }; }
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(dir, file);
    files.push({ path: rel, text });
    for (const f of codeFindings(text, dir, otherWs, port)) add(f.severity, `${rel}: ${f.detail}`);
    const code = text.replace(/#.*$/gm, "");
    const m = code.match(SPAWN);
    if (m) add("violation", `${rel}: not allowed in a scaffold (it must stay under supervision and auditable): ${m[0]}`);
    // Paths in string literals must stay inside the workspace.
    for (const lit of code.match(PY_STRINGS) || []) {
      const v = lit.replace(/^('''|"""|'|")|('''|"""|'|")$/g, "");
      if (/^https?:/i.test(v)) continue;
      if ((/^\/[\w.-]/.test(v) && !path.resolve(v).startsWith(dir)) || (/(^|\/)\.\.(\/|$)/.test(v) && !path.resolve(dir, v).startsWith(dir))) {
        add("violation", `${rel}: a path outside the workspace: ${v.slice(0, 80)}`);
      }
    }
    // Workspace modules it imports (from the workspace root, or a folder it adds to sys.path), except tools/.
    const bases = [dir, ...[...code.matchAll(/sys\s*\.\s*path\s*\.\s*(?:insert\s*\(\s*\d+\s*,|append\s*\()\s*['"]([^'"]+)['"]/g)].map((x) => path.resolve(dir, x[1]))]
      .filter((b) => b.startsWith(dir) && !b.startsWith(path.join(dir, "tools")));
    const mods = new Set();
    for (const mm of code.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) mods.add(mm[1].split(".")[0]);
    for (const mm of code.matchAll(/^\s*import\s+([\w.,\s]+)$/gm)) for (const x of mm[1].split(",")) mods.add(x.trim().split(/\s+/)[0].split(".")[0]);
    for (const mod of mods) {
      for (const b of bases) {
        for (const cand of [path.join(b, `${mod}.py`), path.join(b, mod, "__init__.py")]) if (fs.existsSync(cand)) visit(cand);
      }
    }
  };
  visit(abs);
  return { files, found };
}

/** /proc/<pid>/stat: CPU seconds used so far (user + system, all threads). */
function cpuSeconds(pid) {
  try {
    const f = fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\)\s+/, "").split(" ");
    return (Number(f[11]) + Number(f[12])) / 100;
  } catch { return null; }
}

/** One team's scaffold for one game. */
export class Scaffold {
  /** ctx: { arena, gameRow, persona, dir, port, apiBase, clockMs(), log(msg), limits } */
  constructor(ctx) {
    this.ctx = ctx;
    this.limits = { ...SCAFFOLD_LIMITS, ...(ctx.limits || {}) };
    this.state = "stopped";
    this.file = null;
    this.child = null;
    this.tokens = new Set();
    this.restarts = 0;
    this.crashes = 0;
    this.rowId = null;
    this.lastExit = null;
    this.lastError = null;
    this.throttledMs = 0;
    this.stopping = false;
    this.timers = [];
    this.logFile = path.join(ctx.dir, "scaffold", "scaffold.log");
  }

  /** Is this request from the running scaffold (its token)? */
  owns(token) { return !!token && this.tokens.has(token); }
  pids() { return this.child?.pid ? processTree(this.child.pid) : new Set(); }

  /** Audit, then launch. Returns { ok, text, found }. action: start | restart | crash-restart | resume */
  async start(file, { action = "start", sessionId = null } = {}) {
    const { arena, gameRow, persona, dir, port } = this.ctx;
    if (this.child) await this.stop("replaced");
    this.stopping = false;
    this.file = file;
    installTools(dir); // the scaffold imports the runner's tools, never edited copies
    const { files, found } = auditScaffold(dir, file, { arenaId: arena.id, slug: persona.slug, port });
    const bad = found.filter((f) => f.severity === "violation" || f.severity === "error");
    const source = files.map((f) => `# ==== ${f.path}\n${f.text}`).join("\n");
    const row = await one(`INSERT INTO arena.scaffolds (arena_id, game_id, persona_id, session_id, action, file, source, audit, status, clock_start)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [arena.id, gameRow.id, persona.id, sessionId, action, file, source, JSON.stringify(found), bad.length ? "refused" : "running", this.ctx.clockMs()]);
    this.rowId = row.id;
    for (const f of found) {
      await q("INSERT INTO arena.violations (arena_id, game_id, persona_id, session_id, scaffold_id, severity, tool, detail) VALUES ($1,$2,$3,$4,$5,$6,'scaffold',$7)",
        [arena.id, gameRow.id, persona.id, sessionId, row.id, f.severity === "error" ? "warning" : f.severity, f.detail.slice(0, 400)]);
    }
    if (bad.length) {
      this.state = "refused";
      this.lastError = bad.map((f) => f.detail).join("; ");
      this.ctx.log(`  ${persona.name}: scaffold ${file} REFUSED by the audit: ${this.lastError.slice(0, 200)}`);
      return { ok: false, found, text: `not started: the audit refused ${file}:\n- ${bad.map((f) => f.detail).join("\n- ")}` };
    }
    this.#launch();
    this.ctx.log(`  ${persona.name}: scaffold ${file} ${action === "start" ? "started" : action} (pid ${this.child?.pid}) at ${Math.round(this.ctx.clockMs() / 1000)} s`);
    return { ok: true, found, text: `scaffold ${file} is running (pid ${this.child?.pid}). It keeps running until the game ends; logs: python3 tools/scaffold.py logs` };
  }

  #launch() {
    const { dir, apiBase } = this.ctx;
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    const fd = fs.openSync(this.logFile, "a");
    fs.writeSync(fd, `\n==== scaffold ${this.file} starting (game time ${Math.round(this.ctx.clockMs() / 1000)} s)\n`);
    const token = crypto.randomBytes(12).toString("hex");
    this.tokens = new Set([token]);
    const limits = JSON.stringify({ memMB: this.limits.memMB, cpuSeconds: this.limits.cpuSeconds, fileMB: this.limits.fileMB, nice: this.limits.nice });
    const child = spawn("python3", [LAUNCHER, limits, this.file], {
      cwd: dir, detached: true, stdio: ["ignore", fd, fd],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: dir, LANG: "C.UTF-8", PYTHONUNBUFFERED: "1", ARENA_SCAFFOLD_TOKEN: token, ARENA_GAME_API: apiBase },
    });
    fs.closeSync(fd);
    this.child = child;
    this.state = "running";
    this.startedAt = Date.now();
    this.cpuAtStart = 0;
    child.on("exit", (code, signal) => this.#exited(child, code, signal));
    // CPU share: pause it while it uses more than its share of a core, over a sliding window.
    const samples = [];
    let stoppedUntil = 0;
    const tick = setInterval(() => {
      if (this.child !== child) return clearInterval(tick);
      const now = Date.now(), cpu = cpuSeconds(child.pid);
      if (cpu === null) return;
      this.cpuSeconds = cpu;
      samples.push([now, cpu]);
      while (samples.length > 2 && now - samples[0][0] > 2000) samples.shift();
      if (now < stoppedUntil || samples.length < 2) return;
      const [t0, c0] = samples[0];
      const used = (cpu - c0) / Math.max(0.001, (now - t0) / 1000);
      if (used > this.limits.cpuShare) {
        const pauseMs = Math.min(2000, ((now - t0) * (used / this.limits.cpuShare - 1)));
        try { process.kill(-child.pid, "SIGSTOP"); } catch {}
        stoppedUntil = now + pauseMs;
        this.throttledMs += pauseMs;
        setTimeout(() => { try { process.kill(-child.pid, "SIGCONT"); } catch {} }, pauseMs).unref();
      }
    }, 250);
    tick.unref();
    // Keep the log under its size limit (keep the most recent half).
    const trim = setInterval(() => {
      if (this.child !== child) return clearInterval(trim);
      try {
        const st = fs.statSync(this.logFile);
        if (st.size > this.limits.logBytes) {
          const keep = Math.floor(this.limits.logBytes / 2);
          const fdr = fs.openSync(this.logFile, "r");
          const buf = Buffer.alloc(keep);
          fs.readSync(fdr, buf, 0, keep, st.size - keep);
          fs.closeSync(fdr);
          fs.writeFileSync(this.logFile, Buffer.concat([Buffer.from("[earlier output trimmed]\n"), buf]));
        }
      } catch {}
    }, 5000);
    trim.unref();
    this.timers.push(tick, trim);
  }

  async #exited(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    this.lastExit = signal ? `signal ${signal}` : `exit ${code}`;
    const status = this.stopping ? "stopped" : code === 0 ? "finished" : "crashed";
    await q("UPDATE arena.scaffolds SET status = $2, ended_at = now(), clock_end = $3, exit_code = $4, cpu_seconds = $5, throttled_ms = $6 WHERE id = $1",
      [this.rowId, status, this.ctx.clockMs(), code, this.cpuSeconds ?? null, Math.round(this.throttledMs)]).catch(() => {});
    if (this.stopping) { this.state = "stopped"; return; }
    if (code === 0) { this.state = "finished"; this.ctx.log(`  ${this.ctx.persona.name}: scaffold finished (exit 0)`); return; }
    // A crash: restart after a backoff, re-audited (the team may have edited it meanwhile).
    this.crashes++;
    const wait = BACKOFF[Math.min(this.crashes - 1, BACKOFF.length - 1)];
    this.state = "backoff";
    this.ctx.log(`  ${this.ctx.persona.name}: scaffold crashed (${this.lastExit}); restarting in ${wait} s`);
    const t = setTimeout(() => { if (!this.stopping && this.state === "backoff") { this.restarts++; this.start(this.file, { action: "crash-restart" }).catch((e) => this.ctx.log(`  scaffold restart failed: ${e.message}`)); } }, wait * 1000);
    t.unref();
    this.timers.push(t);
  }

  /** Stop it (SIGTERM to its process group, then SIGKILL). */
  async stop(reason = "stopped") {
    this.stopping = true;
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers = [];
    const child = this.child;
    if (!child) { if (this.state === "backoff") this.state = "stopped"; return false; }
    try { process.kill(-child.pid, "SIGCONT"); process.kill(-child.pid, "SIGTERM"); } catch {}
    const gone = await new Promise((resolve) => {
      const t = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} ; resolve(false); }, 3000);
      child.once("exit", () => { clearTimeout(t); resolve(true); });
    });
    this.tokens.clear();
    try { fs.appendFileSync(this.logFile, `==== scaffold stopped (${reason})\n`); } catch {}
    return gone;
  }

  status() {
    return { state: this.state, file: this.file, pid: this.child?.pid ?? null, restarts: this.restarts, crashes: this.crashes, lastExit: this.lastExit,
      lastError: this.lastError, cpuSeconds: this.cpuSeconds ?? null, throttledMs: Math.round(this.throttledMs), runningForS: this.child ? Math.round((Date.now() - this.startedAt) / 1000) : null };
  }

  logTail(n = 40) {
    try {
      const st = fs.statSync(this.logFile);
      const len = Math.min(st.size, 64 * 1024);
      const fd = fs.openSync(this.logFile, "r");
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      fs.closeSync(fd);
      return buf.toString("utf8").split("\n").slice(-n - 1).join("\n");
    } catch { return "(no log yet)"; }
  }
}
