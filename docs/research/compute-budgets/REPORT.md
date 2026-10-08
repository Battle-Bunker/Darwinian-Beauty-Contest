# Compute budgets on a shared box

*Is more precise compute-budget enforcement tractable, and how do we make time budgets fair and reliable on a 4-core
VM shared with LLM sessions, scaffolds and Postgres?*

- Research and prototypes only; nothing under `server/` changed.
- Measured on 2026-10-08 on the 4-vCPU Firecracker VM.
  - Probes ran while the experiment was live; they were read-only and each took under a second.
  - The benchmarks ran on the otherwise idle machine, 03:51–04:07 UTC: an 8-minute main suite and 2 minutes of
    follow-ups.
- The load was the investigator's own, bounded in time and killed by PID; the temporary `cb-*` cgroups were removed.
- Raw data is in `results/`. `results/tables.md` is the full output of `summarize.py`.

(Written by the investigation agent; saved here by the coordinator, since the agent's harness doesn't let it write
report files.)

## The answer in brief

1. **Precise CPU-time enforcement is tractable and cheap.** A flower's R can be enforced on its own CPU time to
   within about 0.1 ms, with a hard kill at most about 9 ms past R even inside a long C call.
   - It needs no perf, no cgroups and no privileges, and adds about 5 µs per call.
   - Three pieces:
     - the child's thread CPU clock, which is exact and excludes host steal;
     - an hrtimer (`ITIMER_REAL`) re-armed against that clock, for the graceful stop;
     - a per-thread POSIX CPU timer that sends SIGKILL, for the hard stop.
   - On Python loops the stop landed +0.00–0.05 ms past R at p50 and +0.13 ms at most, idle and loaded. It never
     landed more than 0.13 ms early.
2. **Isolation alone can't make wall-clock limits reliable here.** The test load imitated the arena: 8 processes
   wanting about 5 cores, each in its own session at nice 15.
   - With today's setup, 100% of flowers burning 0.9R were late, and 98% of bees burning 40 ms missed the 50 ms wall
     deadline. Runners got about 25% of a core.
   - The best non-RT containment (agents in a `cpu.idle` cgroup on cores 0–1, runners on cores 2–3) still left 17%
     of those flowers and 7% of those bees late.
   - Only SCHED_FIFO runners reached 0%.
   - A wall limit tolerates only R − CPU of interference. A flower using 0.9R has 10% headroom, and anything else on
     its core takes it.
3. **The root cause of today's misses is autogroup scheduling.** `kernel.sched_autogroup_enabled=1`, and every
   runner, scaffold and agent tool shell is in its own session, so each is its own equal-weight autogroup. The arena's
   `nice 5` and `nice 15` count for almost nothing against runners.
4. **Machine-independent work units are not tractable in this stack today.**
   - The VM exposes no hardware PMU.
   - Python opcode counting repeats exactly, but costs 8–18× and can't see work inside C builtins: 26 opcodes for
     88 ms of `sum` and `sorted`.
   - WebAssembly fuel is exact and cheap (the same count idle and loaded, 1.42× native), but it needs a runtime swap:
     CPython built for WASI, and a JS engine compiled to WASM.
5. **CPU time is fair at the median but noisy in the tail.**
   - Identical work costs the same median CPU (±3%) under every load condition, so load doesn't bias it.
   - The tail is heavy: p95 is 1.2–1.9× the median, and outliers reach 2× even idle with one call at a time.
   - The noise looks external (the host). Only fuel-style metering would remove it.

## 1. What the VM permits (`probe_vm.py`)

| What | Finding | Consequence |
|---|---|---|
| Kernel, tick | 6.18, HZ=250 (4 ms tick), PREEMPT_DYNAMIC, no NO_HZ_FULL | POSIX CPU timers and `ITIMER_PROF`/`ITIMER_VIRTUAL` fire on the tick: up to 4 ms late |
| Steal accounting | `PARAVIRT_TIME_ACCOUNTING=y` | Thread and process CPU clocks exclude host steal; perf task-clock does not |
| Steal measured | 0.36% of CPU idle, 0.97% under load, in bursts. One 0.9R burner lost about 15 ms of steal in a 152 ms call | perf-based stops can land early by the steal |
| Scheduler | `sched_autogroup_enabled=1` | nice only orders processes within one session |
| cgroups | v1 (cpu, cpuacct, cpuset, memory, …). The v2 mount has no controllers. `cpu.idle`, CFS bandwidth and `RT_GROUP_SCHED` are present | cpusets, `cpu.idle` and `cfs_quota_us` all work. RT tasks in a child cpu cgroup need `cpu.rt_runtime_us` |
| Privileges | root with CAP_SYS_NICE, CAP_SYS_ADMIN, CAP_PERFMON and CAP_SYS_PTRACE; no CAP_SYS_RESOURCE | Creating cgroups, SCHED_FIFO/RR/IDLE, nice −10 and setaffinity are all permitted. Rlimits can be lowered, not raised past their hard limit |
| RT throttling | 950 ms per 1 s | A runaway SCHED_FIFO task still leaves 5% |
| perf | `perf_event_paranoid=2`. No guest PMU: hardware instructions and cycles return ENOENT. Software task-clock works, including `sigtrap` and fasync signals | No instruction counting; task-clock includes steal |
| Clocks | `CLOCK_THREAD_CPUTIME_ID` is exact (0.4 µs to read). Another process's process CPU clock, and `/proc/<pid>/schedstat`, are tick-stale. Another process's thread clock returns EINVAL | A parent can't read a child's CPU exactly, except through a perf counter read (23 µs, an IPI) |
| timerfd | Takes no CPU clocks, and `os.timerfd_create` isn't in Python 3.11 | Not usable |
| `RLIMIT_CPU` | Whole seconds only | Useless for 3–150 ms budgets |
| Python | The runner's `python3` is 3.11.15, which has no `sys.monitoring`. 3.12.3 and 3.13.14 are also installed. 3.12.3's `settrace` opcode events never fire | |
| Node | 22.22. `vm` `breakOnSigint` and `process.threadCpuUsage()` work. `worker.cpuUsage()` is tick-stale (steps of about 4 ms) | |
| Network | PyPI and npm are reachable. GitHub release downloads are refused by egress policy (403) | No CPython-WASI build could be fetched, so fuel was tested on C compiled to wasm32 |

## 2. How the engine times programs today

- **Python flowers.** `py_runner.py` forks a child per call. The child arms `setitimer(ITIMER_REAL, R)`, a wall-clock
  timer, and measures `cpu` with `process_time()`. The parent's backstop is 2R + 0.5 s of wall time.
- **TypeScript flowers.** `ts_runner.cjs` runs each step under a `vm` `{timeout}`, which is wall time. It measures
  `cpu` with `process.cpuUsage()`, which covers the whole process, including V8's background compiler and GC threads.
- **Slots.** `withCpu` caps concurrent calls at `CPU_SLOTS`, and the R timer starts after the slot is granted. Runner
  start-up happens outside any slot, so it competes with running calls.
- **Rounds already stretch.** `Garden.#round` awaits every flower answer, then waits until 150 ms of wall time, then
  runs the decision window. Game time is rounds × 200 ms, so the fixed 150 ms delivery is already game time. Nothing
  in the round structure needs R to be wall time.
- **Bees.** `#decide` uses `byDeadline(call.done, started, 50)`: 50 ms of wall time from when the call got its slot,
  including IPC, the fork and loading the program. A late call runs on up to a 2 s hard limit.
- **Process layout.** Every `ProgramProcess` is spawned `detached`, so each runner has its own session and its own
  autogroup; forked calls inherit it. Scaffolds are also `detached`, and every claude tool command runs in a new
  session, so each of those is an autogroup too. The claude CLIs themselves share the arena runner's autogroup.

## 3. Measurements

### Setup

- **Load** (`load.py`): 3 pure-Python spinners, 1 memory hog copying 64 MB, and 4 bursty processes (busy 5–50 ms,
  then asleep 5–50 ms). That is about 5 cores of demand on 4.
- **Today's arrangement:** each hog in its own session at nice 15, which is what scaffolds and tool shells are now.
- **Runners:** 2 "slot" processes that fork a child per call, as `py_runner.py` does with CPU_SLOTS=2.
- **Conditions:**
  - `idle`: no load. `idle1slot`: no load and one slot.
  - `autogroup`: today's arrangement.
  - `agnice`: the same, with each hog's autogroup nice set to 15 (equivalent to autogroups off with nice 15).
  - `cpuidle`: hogs in a cpu cgroup with `cpu.idle=1`.
  - `cpuset`: hogs confined to cores 0–1, runners to cores 2–3.
  - `fifo`: today's arrangement, with runners at SCHED_FIFO 10.
  - `contained`: hogs in a `cpu.idle` cgroup and on cores 0–1, runners on cores 2–3.

### 3.1 Misses: wall-clock limits versus CPU-time limits (`noise_py.py`)

Two slots, 60 calls of each kind per condition. "0.9R burner" is a flower that burns 0.9R of CPU, with R uniform in
3–150 ms.

| Condition | Wall-limited burner late | 40 ms bee vs 50 ms wall: late | Wall-limited burner's CPU before R ÷ 0.9R (p50 / min) | CPU-limited burner late | CPU-limited burner wall ÷ CPU, p50 / p95 (R ≥ 30 ms) |
|---|---|---|---|---|---|
| idle1slot | 0% | 0% | 1.00 / 1.00 | 0% | 1.02 / 1.09 |
| idle | 0% | 0% | 1.00 / 1.00 | 0% | 1.03 / 1.16 |
| **autogroup (today)** | **100%** | **98%** | **0.29 / 0.20** | 3.3%* | **4.02 / 4.76** |
| agnice | 38% | 33% | 1.00 / 0.55 | 1.7%* | 1.04 / 1.80 |
| cpuidle | 12% | 10% | 1.00 / 0.84 | 0% | 1.04 / 1.47 |
| cpuset | 18% | 17% | 1.00 / 0.33 | 0% | 1.06 / 1.66 |
| fifo | 0% | 0% | 1.00 / 1.00 | 0% | 1.02 / 1.37 |
| contained | 17% | 7% | 1.00 / 0.71 | 1.7%* | 1.04 / 1.54 |

\* In this test the CPU limit was a perf task-clock event, which counts host steal (§3.3). These few kills came early,
before the call had used R of real CPU. The recommended mechanism uses the thread clock and never stopped a call more
than 0.13 ms early.

### 3.2 Is CPU time fair? Identical work under each condition

Each call runs the same deterministic Python in a fresh fork. "interp" is cache-resident (about 26 ms); "memory"
touches a few MB of dicts and lists.

| Condition | interp CPU p50 (÷ idle) | interp CV | interp p95 / max | memory CPU p50 (÷ idle) | memory CV | memory p95 / max |
|---|---|---|---|---|---|---|
| idle1slot | 25.6 ms (0.98) | 17% | 31.1 / 49.9 | 27.1 (0.94) | 16% | 32.3 / 50.7 |
| idle | 26.1 (1.00) | 19% | 41.4 / 48.5 | 29.0 (1.00) | 22% | 50.1 / 53.9 |
| autogroup | 26.8 (1.03) | 15% | 34.6 / 52.7 | 29.3 (1.01) | 15% | 35.5 / 52.7 |
| agnice | 26.3 (1.01) | 9% | 32.1 / 39.1 | 28.5 (0.98) | 11% | 37.4 / 41.2 |
| cpuidle | 25.8 (0.99) | 19% | 39.4 / 49.3 | 29.0 (1.00) | 26% | 52.3 / 55.7 |
| cpuset | 25.5 (0.98) | 11% | 28.9 / 44.6 | 28.6 (0.99) | 17% | 38.7 / 51.1 |
| fifo | 25.3 (0.97) | 10% | 28.0 / 40.3 | 27.5 (0.95) | 17% | 31.8 / 54.9 |
| contained | 26.1 (1.00) | 14% | 30.1 / 45.9 | 28.2 (0.98) | 12% | 32.9 / 47.1 |

- **The median doesn't move with load (±3%).** Not even the memory hog raised the memory-bound work's median.
- **The tail is heavy even idle.** 5–20% of calls take 1.2–2× the median, including with one call at a time on an idle
  machine. It varied over time, not with the load, which points at the host (sibling hyperthreads, other tenants),
  which nothing inside the VM can isolate. So CPU-based energy is unbiased but noisy: a few percent typically, and tens
  of percent in about 1 call in 10–20.
- **TypeScript.** A fixed JS workload in fresh contexts used 31.0 ms of main-thread CPU (CV 2.3%) idle and 31.9 ms
  (CV 11.5%) under load. Whole-process CPU, which today's runner reports, is about 20% higher (37.3 ms) because it
  includes V8's background threads.

### 3.3 Stopping a call at R of CPU (`enforce_py.py`)

A forked child runs a workload that never ends, and the mechanism under test stops it. Overshoot is the CPU at the
stop minus (the CPU when armed + R), for R = 3, 10, 50 and 150 ms; 60 trials for "py" (a Python loop with a CPU
heartbeat every ~10 µs) and 16 for "c" (one long `sum(range(10**7))` after another). Cells are overshoot in ms,
p50 / max.

| Mechanism | py idle | py autogroup | py contained | c idle | c autogroup | c contained |
|---|---|---|---|---|---|---|
| `real`: today's `ITIMER_REAL`, wall clock | +0.06 / +0.14 | −4.0 / down to −81 (R=150: p50 −43) | +0.01 / +0.10 | +93 / +169 | +98 / +111 | +94 / +115 |
| `prof`, `virtual`, `posix`: CPU itimer + Python handler | +2.6…+3.9 / +6…+14 | +2.3…+4.2 / +24 | +2.4…+4.1 / +11 | +93 / +168 | +94 / +135 | +91 / +145 |
| `prof_kill`: `ITIMER_PROF`, SIGPROF at its default action | +3.3 / +7.0 | +4.6 / +24 | +3.5 / +5.8 | +3.5 / +5.9 | +4.3 / +15 | +3.5 / +7.2 |
| **`tkill`: per-thread CPU timer delivering SIGKILL** | +2.5 / +3.7 | +2.0 / +6.2 | +2.4 / +4.0 | +1.8 / +3.4 | +3.2 / +7.0 | +3.2 / +4.0 |
| **`rearm`: `ITIMER_REAL` re-armed for the thread CPU still left** | **+0.04 / +0.12** | **+0.00 / +0.07** | **+0.05 / +0.13** | +100 / +179 | +96 / +133 | +97 / +183 |
| **`rearm_tkill`: rearm, plus tkill at R + 5 ms** | **+0.05 / +0.10** | **+0.00 / +0.06** | **+0.04 / +0.09** | **+6.8 / +7.9** | **+7.3 / +9.1** | **+7.2 / +8.4** |
| `watchdog`: parent reads the child's process clock | (+0.2)† | (+0.04)† | (+0.2)† | +3.7 / +4.5 | +0.12 / +3.4 | +3.4 / +4.3 |
| `schedstat`: parent reads `/proc/<pid>/schedstat` | (+0.3)† | (+0.04)† | (+0.3)† | +3.6 / +4.8 | +0.15 / +4.0 | +3.8 / +4.4 |
| `watchdog_perf`: parent reads a perf counter | +0.23 / range −12…+1.5 | +0.01 / range −11…+1.5 | +0.21 / +1.1 | +0.06 / +0.47 | +0.05 / +4.0 | +0.42 / +1.6 |
| `perf_kill`: perf overflow with fasync SIGKILL | 0.00 / **+148**‡ | −0.03 / +149‡ | −0.05 / +10‡ | −0.04 / +0.28 | +0.03 / +0.67 | +0.16 / +0.35 |
| `perf_sigtrap`: in-child perf event with `sigtrap` | −0.01 / +147‡ | −0.04 / +150‡ | −0.04 / +100‡ | −0.11 / +0.01 | +0.01 / +3.1 | +0.07 / +0.26 |
| `perf_sigtrap_k`: the same, counting kernel time | −0.05 / +0.13 (min −5.9) | −0.05 / +0.13 (min −3.6) | −0.03 / −0.01 (min −8.4) | −0.04 / +0.12 | −0.02 / +0.15 (min −5.7) | +0.19 / +0.34 |

† The "py" heartbeat's syscalls refresh the child's clock, hiding how stale parent-side readers are; the "c" column
shows the real staleness, about one tick. ‡ With `exclude_kernel`, an overflow that lands while the child is in the
kernel is skipped and the next one comes a whole period later; counting kernel time fixes it.

**Four clock pitfalls, each measured:**
1. A process-wide CPU timer makes the process's own `process_time()` tick-stale. Never arm `ITIMER_PROF`,
   `ITIMER_VIRTUAL` or a process-clock POSIX timer in a runner; measure with the thread clock.
2. A parent can't read a child's CPU exactly; only a perf counter read is exact, at 23 µs per read.
3. perf task-clock counts host steal; the thread and process clocks don't. perf-based stops landed up to 4–8 ms before
   R of real CPU.
4. Python signal handlers can't interrupt a C call: every in-process handler overshoots by the rest of the C call. The
   hard stop must be delivered by the kernel.

**The winner is `rearm` plus `tkill` at R + 5 ms:** exact (≤ +0.13 ms) while Python bytecode runs and never early;
bounded (≤ +9.1 ms) inside C calls; ignores host steal; needs no perf; also stops programs that swallow `Timeout`.

### 3.4 Costs per call (`micro.py`, idle)

| Operation | p50 | p95 |
|---|---|---|
| fork + reply + reap, as every Python call does today | 1,008 µs | 1,603 µs |
| `setitimer` arm + disarm | 0.8 µs | 1.4 µs |
| thread CPU timer: create + arm + disarm + delete (ctypes resolved ahead of time) | 3.3 µs | 4.8 µs |
| `thread_time_ns()` | 0.4 µs | |
| `perf_event_open` + fasync + close, with another event kept open | 276 µs | 425 µs |
| the same with no other event open | 6,865 µs | 10,291 µs |
| perf counter read on a running child | 22.7 µs | 27.8 µs |
| per-call cgroup cycle (mkdir, attach, read `cpuacct.usage`, detach, rmdir) | 563 µs | 939 µs (p99 19 ms) |

### 3.5 TypeScript (`node_cpu.cjs`, `node_sigint.cjs`)

Overshoot past R in ms, p50 / p95 and extremes:

| Mechanism | idle | autogroup |
|---|---|---|
| `vm_wall`: today's `vm` `{timeout: R}` | −2.0 / +0.5 | −7.7 / −0.3, down to −115 (R=150: p50 −73) |
| `sigint_poll`: a watchdog Worker polls `process.cpuUsage()` and sends SIGINT; the script runs with `breakOnSigint` | +0.7 / +5.0 (one stop at +2,977) | −0.4 / +4.3, min −6.5 |
| `worker_kill`: user code in a Worker; main polls `worker.cpuUsage()` and calls `terminate()` | +1.2 / +3.8 | −1.0 / +0.7, min −5.8 |
| `sigint_perf`: a sidecar's perf event on the main thread sends SIGINT | −1.7 / +9.8, max +146‡ | −1.0 / +0.3, max +147‡ |

- `worker_kill` is expensive: each stop costs `terminate()` (2.1 ms) plus a new Worker, 37 ms idle and 91 ms loaded.
- `sigint_poll` reads whole-process CPU, which includes V8's other threads, so it can fire early. Its one +2,977 ms stop
  was a SIGINT that landed before the script started; hence the design below (read the main thread's own CPU, and keep
  re-sending while the script still runs).
- `breakOnSigint` is safe with a `process.on("SIGINT")` listener installed; each arm should fire at most once.

### 3.6 Machine-independent units (`determinism_py.py`, `fuel/`)

| Counter | 3.11 (runner) | 3.12 | 3.13 | Units counted |
|---|---|---|---|---|
| `settrace` opcodes | 15.7× | fires nothing (3.12.3 bug) | partial (4,563) | 2,647,575 |
| `sys.monitoring` INSTRUCTION | not available | 18.0× | 9.5× | 2.54M / 2.32M |
| `sys.monitoring` JUMP + BRANCH + PY_START | not available | 2.1× | 2.0× | 221k |
| `setprofile` calls | 2.4× | 2.3× | 2.8× | 221k |
| `settrace` lines | 3.6× | 3.9× | 2.8× | 442k |

Every bytecode-level meter is blind to builtins (`sum(range(3*10**6)) + sorted(...)` takes 83–108 ms but counts as 26
opcodes), so it can be gamed by moving work into builtins. No hardware counters exist in the VM.

WebAssembly fuel (wasmtime 49; the same C workload compiled to wasm32 and natively):

| Measure | idle | autogroup load |
|---|---|---|
| native CPU p50 | 26.0 ms | 26.2 ms |
| wasm without fuel | 32.8 ms (1.26×) | 32.8 ms |
| wasm with fuel | 36.8 ms (1.42×) | 36.4 ms |
| fuel used | 478,852,091 on every run | 478,852,091 on every run |

Fuel is the only measure that is exact, unaffected by load and covers all the work, but it needs CPython built for
WASI (cost unmeasured; the download is blocked here), per-call snapshots, and TypeScript moved to a JS engine compiled
to WASM. That is a separate project.

## 4. Recommendation

### 4.1 The contract

- **A flower's R is CPU time.** A call is stopped when it has used R of CPU, and it is late iff its exact thread CPU
  (including writing the response as JSON) exceeds R. Lateness is judged on that measurement, so stop precision
  affects only wasted server time, never fairness.
- **A wall-clock backstop catches calls that aren't computing** (sleeping, or starved far beyond reason), flagged as a
  server fault so overload shows in the records.
- **A bee is in time iff `decide` used at most 50 ms of CPU**, with a hard stop at 2 s of CPU plus the wall backstop.
  `fed` has a hard limit of 50 ms of CPU.
- **Rounds are paced in game time, as now.** The flower window ends when every flower has answered and at least
  150 ms of wall time has passed; the decision window ends when every bee has replied or is known to have spent its
  50 ms of CPU. With containment, rounds stay close to 200 ms of wall time.
- **Clocks.** `process_time()` and `thread_time()` are the call's CPU time, exactly the clock R and E count;
  `perf_counter()` and `time()` stay wall time since the call started. The rules should tell players to budget with
  `process_time()`.
- **E is unchanged**, with CPU taken from the thread clock. It is unbiased under load (§3.2).

### 4.2 (a) Engine: how runners enforce and measure budgets

**Python (`py_runner.py`).** Each forked call:

```python
# before any fork: resolve librt timer_create/timer_settime/timer_delete; build sigevent {SIGEV_SIGNAL, SIGKILL}
c0 = time.thread_time_ns()                        # exact, ignores host steal, never made stale
deadline = c0 + R_ns
hard = thread_cpu_timer(R_ns + 5_000_000, SIGKILL)  # timer_create(CLOCK_THREAD_CPUTIME_ID): C calls can't block it
def on_alarm(*_):                                 # SIGALRM comes from an hrtimer, so it fires on time
    left = deadline - time.thread_time_ns()
    if left <= 20_000: raise Timeout()            # graceful stop: reply {"e": "Timeout", "cpu": ...}
    signal.setitimer(signal.ITIMER_REAL, left / 1e9)  # the CPU left can't take less wall time than this
signal.setitimer(signal.ITIMER_REAL, R_ns / 1e9)
# ... run the program, call flower(), write the reply as JSON ...
signal.setitimer(signal.ITIMER_REAL, 0); timer_delete(hard)
cpu = time.thread_time_ns() - c0                  # late iff cpu > R_ns: null response, E = 0
```

- The parent's `read_line` wait becomes the wall backstop; a child killed by SIGKILL is answered with a timeout and its
  `wait4` rusage CPU; a backstop kill is flagged. Drop the 2R + 0.5 s heuristic.
- Don't use `ITIMER_PROF`, `ITIMER_VIRTUAL` or `CLOCK_PROCESS_CPUTIME_ID` timers.
- Bees: `first` and `decide` armed the same way with the 2 s hard limit plus a non-fatal alarm at 50 ms of CPU (the
  child writes a one-line "late" notice); every reply carries `cpu`. `fed` armed with R = 50 ms, hard.
- Expected precision: Python bytecode +0.0–0.05 ms p50, at most 0.13 ms, never early; inside a long C call +7 ms p50,
  at most 9 ms. Overhead about 5 µs per call.

**TypeScript (`ts_runner.cjs`).**
- Measure `cpu` with `process.threadCpuUsage()` (excludes V8's background threads, about +20%).
- Run every `vm.runInContext` with `{ breakOnSigint: true, timeout: <wall backstop> }` and register
  `process.on("SIGINT", () => {})` once.
- One watchdog Worker per runner shares `{inScript, deadline in main-thread CPU ms}`; while `inScript` is set it reads
  the main thread's CPU from `/proc/self/task/<pid>/schedstat` (stale by up to a tick but never ahead), and once the
  deadline is reached it sends SIGINT, re-sending every 2 ms while still in the script.
- Expected precision about +4 ms (one tick), never early. Optional: a small native addon reading the main thread's
  clock exactly would give about 0.1 ms. Don't stop user code by terminating Workers.

**Engine (`engine.js`, `proc.js`, `gameConfig.js`).**
- `#decide`: wait up to a wall backstop of about 250 ms; a decision is in time iff `res.cpu ≤ beeMs` (CPU).
- `flowerSetup`/`beeSetup` gain a `wallMs` backstop; `proc.js` kills a hung process at `wallMs + 1500` and learns the
  late notice.
- Placement: a `cpuset/dbc-runners` with `cpus=2-3`; write each `ProgramProcess` PID into it after its setup reply.
  Keep `CPU_SLOTS` equal to the reserved cores (2). If the cgroup can't be created, log it and carry on.
- Don't run user programs at SCHED_FIFO (a bug in the stop path would hand a core to user code).

### 4.3 (b) Arena runner: containing whatever agents start

nice can't do this here: autogroups give every session equal weight, and a `while time.time()-t<150: pass` tool call
takes a whole core regardless of nice. Containment has to follow every descendant, including ones that call setsid:

1. At arena start (root; cgroup v1 on this box) create `cpuset/dbc-agents` (`cpus=0-1`, `mems=0`) and
   `cpu/dbc-agents` (`cpu.idle=1`), optionally capped at 1.5 cores (`cfs_quota_us=150000`, `cfs_period_us=100000`).
2. Start every claude session and every scaffold through a wrapper that joins the cgroups before exec:
   ```sh
   echo $$ > /sys/fs/cgroup/cpuset/dbc-agents/cgroup.procs; echo $$ > /sys/fs/cgroup/cpu/dbc-agents/cgroup.procs
   exec nice -n 5 claude …
   ```
   Every descendant inherits the cgroup; autogroups only apply in the root cpu cgroup, so setsid can't escape it.
3. The scaffold's SIGSTOP share limiter becomes optional.
4. Keep Postgres and the game server out of `dbc-agents`, ideally in `cpuset/dbc-rest` (cores 0–1).
5. Effect (`contained`): identical work costs the same CPU as idle; CPU-limited flowers stretch 1.04× in wall time at
   p50 and 1.54× at p95 (against 4.0× and 4.8× today). Under today's wall limits it would still leave 17% of flowers
   and 7% of bees late, which is why (a) is needed as well.
6. Without cgroups: `kernel.sched_autogroup_enabled=0` globally makes nice work again (misses 100% → 38%).

### 4.4 Fallbacks

1. Without ctypes: `rearm` alone, with the parent's wall backstop as the hard stop.
2. Tick precision is enough: `tkill` alone (+2–3 ms p50, at most 7 ms).
3. The parent must decide the stop: a perf task-clock event with `exclude_kernel=0`, period R plus a margin for steal,
   fasync SIGKILL; keep one perf event open for the runner's lifetime.

### 4.5 Implementation plan

| File | Change |
|---|---|
| `server/runners/py_runner.py` | Thread-clock accounting; `rearm` + `tkill`; parent backstop and SIGKILL handling; `cpu` on bee replies; the late notice; `fed` hard at 50 ms CPU. Remove the wall-clock `timer(budget)`. Resolve ctypes before forking |
| `server/runners/ts_runner.cjs` | `threadCpuUsage()`; `breakOnSigint` plus a wall `timeout`; the watchdog Worker; the SIGINT listener; the late notice |
| `server/runners/proc.js` | Kill-on-hang based on `wallMs`; the late notice; join `dbc-runners` after setup |
| `server/engine.js` | `#decide` judged on CPU with a wall backstop; `beeMs` recorded as CPU; backstop flag |
| `server/lib/gameConfig.js` | `wallMs` defaults; comments saying R is CPU time |
| `server/lib/interface.js`, `RULES.md`, `docs/API.md` | R and the bee's 50 ms are CPU time; the wall backstop; budget with `process_time()`; remove "a busy server can make a flower late" |
| `arena/lib/llm.js`, `arena/lib/scaffold.js`, `arena/server.sh` | The `dbc-agents` cgroups and the exec wrapper; log if they can't be created |

Tests: a 0.9R flower next to a spinner pinned to its core is never late (Python, TypeScript, and a 40 ms bee); an
infinite loop reports `cpu` within [R, R + 1 ms]; `sum(range(10**9))` reports `cpu` ≤ R + 10 ms; a program that
swallows `Timeout` is still stopped by R + 10 ms; a flower whose `cpu` lands just over R is late; a flower that sleeps
5 s is stopped by the backstop and flagged; `process_time()` stays exact while the alarms are armed; the TS runner
serves the next call after a CPU stop without a respawn and survives a stray SIGINT; a bee starved of wall time but
under 50 ms of CPU still feeds.

### 4.6 Considered and not recommended

| Option | Why not |
|---|---|
| `RLIMIT_CPU` | 1 s granularity |
| Process-wide CPU itimers or POSIX timers | Fire up to a tick late, can't interrupt C calls through a Python handler, and make `process_time()` stale |
| Parent polling `/proc/<pid>/stat`, `schedstat` or the child's process clock | About 3.5 ms stale |
| `cpuacct` per call | 0.56 ms per call with 19 ms spikes, and just as stale |
| `cfs_quota` per runner | Throttles a runner; doesn't stop or measure a call |
| perf as the primary mechanism | Counts steal, so it can stop calls early; 0.2–0.3 ms per open; the `exclude_kernel` trap |
| Opcode or branch counting | 2–18× slower and blind to builtins |
| Hardware instruction counters | No PMU in this VM |
| WebAssembly fuel | Needs a runtime swap for both languages |
| SCHED_FIFO for user programs | Risky (§4.2) |

## 5. Reproducing

Run as root on an idle machine; it takes about 10 minutes.

```sh
cd docs/research/compute-budgets
python3 probe_vm.py
pip install --target /tmp/cb-pylib wasmtime
mkdir -p /tmp/cb-fuel && clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--export=work -o /tmp/cb-fuel/work.wasm fuel/work.c && gcc -O2 -shared -fPIC -o /tmp/cb-fuel/work.so fuel/work.c
CB_PYLIB=/tmp/cb-pylib CB_FUEL=/tmp/cb-fuel python3 run_bench.py results
python3 summarize.py results > results/tables.md
```
