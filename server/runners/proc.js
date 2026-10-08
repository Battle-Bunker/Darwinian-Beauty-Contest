// A program running in a child process, spoken to with JSON lines (one reply per request, in order; a bee's
// call may send a notice line first). Every runner joins the dbc-runners cpuset (cores of their own) once set up.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW_ABOVE = 4096;
// Programs never see the server's environment (DATABASE_URL, secrets, ...).
// TZ: the game's clock is UTC, whatever the server's time zone.
const CHILD_ENV = { PATH: process.env.PATH || "/usr/bin:/bin", PYTHONHASHSEED: "0", PYTHONDONTWRITEBYTECODE: "1", LANG: "C.UTF-8", TZ: "UTC" };

function command(language, role) {
  if (language === "python") return [process.env.PYTHON || "python3", ["-s", "-u", path.join(DIR, "py_runner.py"), role]];
  return [process.execPath, ["--no-warnings", "--max-old-space-size=256", path.join(DIR, "ts_runner.cjs"), role]];
}

// Runners run on cores of their own: a cgroup v1 cpuset (RUNNER_CPUS, default "2-3"; RUNNER_CPUSET=off: none),
// made once per server process. Programs' limits are CPU time, so this only keeps rounds close to real time
// when the rest of the machine is busy. If it can't be made (no cgroups, not root), it says so once and runners
// run anywhere.
const CPUSET = process.env.RUNNER_CPUSET === "off" ? null : "/sys/fs/cgroup/cpuset/dbc-runners";
let cpusetReady = null;
function joinCpuset(pid) {
  if (!CPUSET || cpusetReady === false) return;
  try {
    if (cpusetReady === null) {
      fs.mkdirSync(CPUSET, { recursive: true });
      fs.writeFileSync(path.join(CPUSET, "cpuset.cpus"), process.env.RUNNER_CPUS || "2-3");
      fs.writeFileSync(path.join(CPUSET, "cpuset.mems"), fs.readFileSync(path.join(CPUSET, "..", "cpuset.mems"), "utf8").trim() || "0");
      cpusetReady = true;
    }
    fs.writeFileSync(path.join(CPUSET, "cgroup.procs"), String(pid));
  } catch (e) {
    if (cpusetReady !== false) console.error(`runners: no cpuset (${e.message}); they run on any core`);
    cpusetReady = false;
  }
}

export class ProgramProcess {
  /**
   * role: "flower" | "bee". setup: {code, ms, limitMs?, wallMs?, hardWallMs?, game, maxChars, maxResponseBytes?}:
   * ms is a flower's most R and a bee's CPU time to decide, limitMs a bee call's hard CPU limit, wallMs and
   * hardWallMs the runner's wall-clock backstops.
   */
  constructor(language, role, setup) {
    const [cmd, args] = command(language, role);
    // Kill-on-hang backstop per call: well past the runner's own wall backstop.
    this.backstopMs = (setup.hardWallMs ?? setup.wallMs ?? setup.limitMs ?? setup.ms * 2) + 1500;
    this.dead = null;
    this.queue = [];
    this.inflight = null;
    this.buf = "";
    // Its own process group, so killing it kills every process it forked too (a forked call can't outlive it).
    this.child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: CHILD_ENV, cwd: DIR, detached: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => this.#onData(d));
    this.child.stderr.on("data", () => {});
    this.child.on("close", () => this.#fail("program process exited"));
    this.child.on("error", (e) => this.#fail("could not start program: " + e.message));
    this.child.stdin.on("error", () => {});
    // Setup gets a longer leash (bee module code may precompute; python startup is ~50ms).
    this.ready = this.#request(setup, setup.ms * 10 + 15000);
    this.ready.then((r) => { if (r && r.ok) joinCpuset(this.child.pid); });
  }

  #onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const p = this.inflight;
      // A notice ahead of the reply (a bee's call: {"notice": "late" | "fault"}).
      if (p && line.startsWith('{"notice":')) {
        try { p.onNotice?.(JSON.parse(line).notice); } catch {}
        continue;
      }
      this.inflight = null;
      if (p) {
        clearTimeout(p.timer);
        let res;
        try { res = JSON.parse(line); } catch { res = { e: "garbled reply" }; }
        // A long reply keeps its text too (a big response is stored as the runner wrote it, not re-encoded).
        if (line.length > RAW_ABOVE && res && typeof res === "object") Object.defineProperty(res, "raw", { value: line });
        p.resolve(res);
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
    this.child.stdin.write((typeof p.obj === "string" ? p.obj : JSON.stringify(p.obj)) + "\n");
  }

  #request(obj, timeoutMs, onNotice) {
    if (this.dead) return Promise.resolve({ e: this.dead, dead: true });
    return new Promise((resolve) => {
      this.queue.push({ resolve, obj, timeoutMs, onNotice });
      this.#pump();
    });
  }

  /**
   * One request (an object, or its JSON text already made); killed (and answered {e, dead}) if the runner
   * hasn't replied by the backstop. onNotice(kind) hears a bee call's notice ("late" or "fault") before its reply.
   */
  call(obj, timeoutMs = this.backstopMs, onNotice = null) {
    return this.#request(obj, timeoutMs ?? this.backstopMs, onNotice);
  }

  kill() {
    try { process.kill(-this.child.pid, "SIGKILL"); } catch {}
    try { this.child.kill("SIGKILL"); } catch {}
  }
}
