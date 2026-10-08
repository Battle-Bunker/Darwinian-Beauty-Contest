// Containment of everything the agents start (docs/research/compute-budgets/REPORT.md §4.3). nice can't do it on this
// box: with sched_autogroup every session is its own equal-weight group, so a team's busy loop takes a whole core from the
// garden's programs whatever its nice. Instead, at arena start the runner makes cgroup v1 groups for the agents:
//   cpuset/dbc-agents   cpus 0-1, mems 0
//   cpu/dbc-agents      cpu.idle 1 (it runs only when nothing else wants the CPU), at most 1.5 cores (CFS quota)
// and starts every claude session and one-shot call (agent_exec.sh) and every scaffold (scaffold_launch.py) through a
// launcher that joins both groups before it execs, so the agent and every process it starts (tool shells, python, try
// runs, spinners, setsid or not) inherit them: autogroups only apply in the root cpu group. nice still orders processes
// inside the group. The groups are left in place, empty, when the runner exits (another runner may be using them).
// If they can't be made, the runner says so loudly and carries on uncontained; it never touches the global
// kernel.sched_autogroup_enabled.
import fs from "node:fs";
import path from "node:path";

export const CGROUP_ROOT = process.env.ARENA_CGROUP_ROOT || "/sys/fs/cgroup";
export const AGENT_GROUP = process.env.ARENA_AGENT_CGROUP || "dbc-agents";
export const AGENT_LIMITS = Object.freeze({ cpus: "0-1", mems: "0", idle: 1, periodUs: 100000, quotaUs: 150000 });
/** The launcher every claude process starts through: `sh agent_exec.sh <nice> <dirs|-> <command> [args...]`. */
export const AGENT_EXEC = path.join(path.dirname(new URL(import.meta.url).pathname), "agent_exec.sh");

let joined = null; // the group directories agents join, once set up: [cpuset dir, cpu dir]

/** The agents' cgroup directories, or null when the arena runs uncontained. */
export const agentCgroups = () => joined;

/** Make (or check) the agents' groups. Idempotent; returns { ok, dirs } or { ok: false, reason }. */
export function setupAgentCgroups(log = console.log, lim = AGENT_LIMITS) {
  const cs = path.join(CGROUP_ROOT, "cpuset", AGENT_GROUP), cpu = path.join(CGROUP_ROOT, "cpu", AGENT_GROUP);
  const put = (dir, file, v) => fs.writeFileSync(path.join(dir, file), String(v));
  try {
    if (!fs.existsSync(path.join(CGROUP_ROOT, "cpuset", "cpuset.cpus")) || !fs.existsSync(path.join(CGROUP_ROOT, "cpu", "cpu.shares"))) {
      throw new Error(`no cgroup v1 cpuset and cpu hierarchies under ${CGROUP_ROOT}`);
    }
    fs.mkdirSync(cs, { recursive: true });
    put(cs, "cpuset.cpus", lim.cpus); // (a cpuset needs its cpus and mems before it can take a process)
    put(cs, "cpuset.mems", lim.mems);
    fs.mkdirSync(cpu, { recursive: true });
    let idle = true;
    try { put(cpu, "cpu.idle", lim.idle); } catch (e) { idle = false; log(`*** containment: cpu.idle could not be set (${e.message}); the agents' group keeps the default weight`); }
    put(cpu, "cpu.cfs_period_us", lim.periodUs);
    put(cpu, "cpu.cfs_quota_us", lim.quotaUs);
    joined = [cs, cpu];
    log(`containment: claude sessions, their tools and the scaffolds run in ${cs} (cpus ${lim.cpus}) and ${cpu}` +
      ` (${idle ? "cpu.idle, " : ""}at most ${lim.quotaUs / lim.periodUs} cores)`);
    return { ok: true, dirs: joined };
  } catch (e) {
    joined = null;
    log(`*** CONTAINMENT UNAVAILABLE: the agents' cgroups could not be set up (${e.message}). Sessions and scaffolds run ` +
      `uncontained: with autogroups their nice counts for almost nothing, and a busy loop can make the garden's flowers late. ***`);
    return { ok: false, reason: e.message };
  }
}

/** The command line that starts `command args` in the agents' groups at `nice`: [file, argv]. */
export function agentSpawn(nice, command, args) {
  return ["/bin/sh", [AGENT_EXEC, String(nice ?? 0), joined ? joined.join(":") : "-", command, ...args]];
}

/** Which of a process's cgroups (v1 controllers) it is in: { cpuset, cpu, ... } from /proc/<pid>/cgroup. */
export function cgroupsOf(pid) {
  try {
    return Object.fromEntries(fs.readFileSync(`/proc/${pid}/cgroup`, "utf8").trim().split("\n").map((l) => l.split(":"))
      .filter((x) => x.length >= 3).flatMap(([, ctrls, p]) => ctrls.split(",").map((c) => [c || "unified", p])));
  } catch { return null; }
}
