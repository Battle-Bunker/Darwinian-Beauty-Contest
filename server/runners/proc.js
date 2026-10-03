// A program running in a child process, spoken to with JSON lines (one reply per request, in order).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Programs never see the server's environment (DATABASE_URL, secrets, ...).
const CHILD_ENV = { PATH: process.env.PATH || "/usr/bin:/bin", PYTHONHASHSEED: "0", PYTHONDONTWRITEBYTECODE: "1", LANG: "C.UTF-8" };

function command(language, role) {
  if (language === "python") return [process.env.PYTHON || "python3", ["-s", "-u", path.join(DIR, "py_runner.py"), role]];
  return [process.execPath, ["--no-warnings", "--max-old-space-size=256", path.join(DIR, "ts_runner.cjs"), role]];
}

export class ProgramProcess {
  /**
   * role: "flower" | "bee". setup: {code, ms, limitMs?, game, maxChars, ledger}: limitMs is a bee call's hard
   * stop; ledger is the team ledger so far (later entries come with sync()).
   */
  constructor(language, role, setup) {
    const [cmd, args] = command(language, role);
    // Kill-on-hang backstop per call: well past the runner's own stop (the budget, or a bee's hard limit).
    this.backstopMs = setup.limitMs ? setup.limitMs + 1500 : setup.ms * 2 + 1500;
    this.dead = null;
    this.queue = [];
    this.inflight = null;
    this.buf = "";
    this.child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: CHILD_ENV, cwd: DIR });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => this.#onData(d));
    this.child.stderr.on("data", () => {});
    this.child.on("close", () => this.#fail("program process exited"));
    this.child.on("error", (e) => this.#fail("could not start program: " + e.message));
    this.child.stdin.on("error", () => {});
    // Setup gets a longer leash (bee module code may precompute; python startup is ~50ms).
    this.ready = this.#request(setup, setup.ms * 10 + 15000);
    this.synced = this.ready; // settles once every ledger entry sent so far is in the program's ledger
  }

  #onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const p = this.inflight;
      this.inflight = null;
      if (p) {
        clearTimeout(p.timer);
        try { p.resolve(JSON.parse(line)); } catch { p.resolve({ e: "garbled reply" }); }
      }
      this.#pump();
    }
  }

  #fail(reason) {
    if (!this.dead) this.dead = reason;
    const all = [this.inflight, ...this.queue.splice(0)].filter(Boolean);
    this.inflight = null;
    for (const p of all) { clearTimeout(p.timer); p.resolve({ e: reason, dead: true }); }
  }

  // One request in flight at a time, so each one's deadline starts when it is actually sent.
  #pump() {
    if (this.inflight || this.dead || !this.queue.length) return;
    const p = (this.inflight = this.queue.shift());
    // Hard stop if the runner itself stops answering (e.g. a program swallowed its timeout).
    p.timer = setTimeout(() => { this.#fail("Timeout: program stopped responding"); this.kill(); }, p.timeoutMs);
    this.child.stdin.write(JSON.stringify(p.obj) + "\n");
  }

  #request(obj, timeoutMs) {
    if (this.dead) return Promise.resolve({ e: this.dead, dead: true });
    return new Promise((resolve) => {
      this.queue.push({ resolve, obj, timeoutMs });
      this.#pump();
    });
  }

  /** One request; killed (and answered {e, dead}) if the runner hasn't replied by the backstop. */
  call(obj, timeoutMs = this.backstopMs) {
    return this.#request(obj, timeoutMs);
  }

  /**
   * Append entries to the program's ledger, between calls. Requests run in order, so a call sent after this
   * sees them; a caller that times a call awaits `synced` first, so the delivery is never on its clock.
   */
  sync(entries) {
    if (!entries.length || this.dead) return this.synced;
    return (this.synced = this.#request({ op: "ledger", entries }, 15000));
  }

  kill() {
    try { this.child.kill("SIGKILL"); } catch {}
  }
}
