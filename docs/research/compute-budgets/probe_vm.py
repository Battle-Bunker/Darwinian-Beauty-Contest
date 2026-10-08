#!/usr/bin/env python3
"""
What this VM permits for per-call compute budgets: a quick, read-mostly probe (well under a second, no load).

    python3 docs/research/compute-budgets/probe_vm.py

It checks the kernel tick, the scheduler's autogroups, the cgroup layout, capabilities, real-time and idle
scheduling (on a child that exits at once), perf_event_open for hardware and software counters, the precise
CPU-time sources, and the timers that could stop a call. It changes nothing on the machine.
"""
import ctypes, gzip, os, resource, signal, struct, sys, time

libc = ctypes.CDLL(None, use_errno=True)
out = []


def say(k, v):
    out.append((k, v))
    print(f"{k:34s} {v}")


def read(p, n=None):
    try:
        with open(p) as f:
            s = f.read().strip()
        return s if n is None else s[:n]
    except OSError as e:
        return f"<{e.strerror}>"


# --- kernel, tick, scheduler ---------------------------------------------------------------------------------
say("kernel", os.uname().release)
say("python (runner's python3)", sys.version.split()[0])
cfg = {}
try:
    for line in gzip.open("/proc/config.gz", "rt"):
        if line.startswith("CONFIG_") and "=" in line:
            k, v = line.strip().split("=", 1)
            cfg[k] = v
except OSError:
    pass
for k in ("CONFIG_HZ", "CONFIG_NO_HZ_FULL", "CONFIG_POSIX_CPU_TIMERS_TASK_WORK", "CONFIG_PARAVIRT_TIME_ACCOUNTING",
          "CONFIG_SCHED_AUTOGROUP", "CONFIG_RT_GROUP_SCHED", "CONFIG_CFS_BANDWIDTH", "CONFIG_CPUSETS", "CONFIG_SCHED_INFO",
          "CONFIG_PERF_EVENTS", "CONFIG_PREEMPT_DYNAMIC"):
    say(k, cfg.get(k, "not set"))
say("sched_autogroup_enabled", read("/proc/sys/kernel/sched_autogroup_enabled"))
say("sched_rt_runtime_us/period", read("/proc/sys/kernel/sched_rt_runtime_us") + " / " + read("/proc/sys/kernel/sched_rt_period_us"))
say("this process's autogroup", read("/proc/self/autogroup"))
say("perf_event_paranoid", read("/proc/sys/kernel/perf_event_paranoid"))
flags = read("/proc/cpuinfo").split("flags\t\t: ", 1)[-1].split("\n", 1)[0].split()
say("cpu flag arch_perfmon (guest PMU)", "arch_perfmon" in flags)
say("event_source devices", " ".join(sorted(os.listdir("/sys/bus/event_source/devices"))))
say("steal accounting (cpu line)", read("/proc/stat").split("\n", 1)[0])

# --- capabilities, limits ------------------------------------------------------------------------------------
st = dict(l.split(":\t", 1) for l in read("/proc/self/status").splitlines() if ":\t" in l)
cap = int(st.get("CapEff", "0"), 16)
for bit, name in ((21, "CAP_SYS_ADMIN"), (23, "CAP_SYS_NICE"), (24, "CAP_SYS_RESOURCE"), (38, "CAP_PERFMON"), (19, "CAP_SYS_PTRACE")):
    say(name, bool(cap >> bit & 1))
for name in ("RLIMIT_CPU", "RLIMIT_RTPRIO", "RLIMIT_NICE", "RLIMIT_CORE"):
    say(name, resource.getrlimit(getattr(resource, name)))

# --- cgroups -------------------------------------------------------------------------------------------------
say("cgroup membership", read("/proc/self/cgroup").replace("\n", " | "))
for d in ("cpu", "cpuacct", "cpuset", "unified"):
    p = f"/sys/fs/cgroup/{d}"
    say(f"cgroup {d}", "present" if os.path.isdir(p) else "absent")
say("cpu.cfs_quota_us (root)", read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"))
say("cpu.idle exists", os.path.exists("/sys/fs/cgroup/cpu/cpu.idle"))
say("cpu.rt_runtime_us (root)", read("/sys/fs/cgroup/cpu/cpu.rt_runtime_us"))
say("cpuset.cpus (root)", read("/sys/fs/cgroup/cpuset/cpuset.cpus"))
say("unified controllers", read("/sys/fs/cgroup/unified/cgroup.controllers") or "(none)")
say("cgroup fs writable (cpu)", os.access("/sys/fs/cgroup/cpu", os.W_OK))
say("PSI /proc/pressure/cpu", read("/proc/pressure/cpu").replace("\n", " | "))


# --- scheduling classes, tried on a child that exits at once ---------------------------------------------------
def try_in_child(fn):
    pid = os.fork()
    if pid == 0:
        try:
            fn()
            os._exit(0)
        except OSError as e:
            os._exit(100 + (e.errno or 0) % 100)
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    return "ok" if code == 0 else f"denied (errno {code - 100})"


say("SCHED_FIFO prio 10", try_in_child(lambda: os.sched_setscheduler(0, os.SCHED_FIFO, os.sched_param(10))))
say("SCHED_RR prio 10", try_in_child(lambda: os.sched_setscheduler(0, os.SCHED_RR, os.sched_param(10))))
say("SCHED_IDLE", try_in_child(lambda: os.sched_setscheduler(0, os.SCHED_IDLE, os.sched_param(0))))
say("nice -10", try_in_child(lambda: os.setpriority(os.PRIO_PROCESS, 0, -10)))
say("affinity (sched_setaffinity {0})", try_in_child(lambda: os.sched_setaffinity(0, {0})))

# --- perf_event_open -----------------------------------------------------------------------------------------
NR_PERF_EVENT_OPEN = 298  # x86_64


def perf_open(type_, config, pid=0, period=0, sigtrap=False):
    attr = bytearray(136)
    struct.pack_into("IIQQ", attr, 0, type_, 136, config, period)
    bits = (1 << 5) | (1 << 6)  # exclude_kernel, exclude_hv
    if sigtrap:
        bits |= (1 << 36) | (1 << 37)  # remove_on_exec, sigtrap
    struct.pack_into("Q", attr, 40, bits)
    struct.pack_into("I", attr, 48, 1)  # wakeup_events
    buf = (ctypes.c_char * 136).from_buffer(attr)
    fd = libc.syscall(NR_PERF_EVENT_OPEN, buf, pid, -1, -1, 0)
    if fd < 0:
        return None, os.strerror(ctypes.get_errno())
    return fd, "ok"


for name, t, c in (("hw instructions", 0, 1), ("hw cpu-cycles", 0, 0), ("sw task-clock", 1, 1), ("sw cpu-clock", 1, 0)):
    fd, why = perf_open(t, c)
    if fd is not None:
        x = sum(range(20000))
        v = struct.unpack("Q", os.read(fd, 8))[0]
        os.close(fd)
        why = f"ok (read {v})"
    say(f"perf_event_open {name}", why)
fd, why = perf_open(1, 1, period=10**9, sigtrap=True)
if fd is not None:
    os.close(fd)
say("perf task-clock sigtrap event", why)

# --- precise CPU-time sources --------------------------------------------------------------------------------
say("clock_getres PROCESS_CPUTIME", time.clock_getres(time.CLOCK_PROCESS_CPUTIME_ID))
say("clock_getres THREAD_CPUTIME", time.clock_getres(time.CLOCK_THREAD_CPUTIME_ID))
pid = os.fork()
if pid == 0:
    time.sleep(0.05)
    os._exit(0)
clk = (~pid << 3) | 2  # the process-wide CPU clock of another process (CPUCLOCK_SCHED)
try:
    say("clock_gettime(child's CPU clock)", f"ok ({time.clock_gettime_ns(clk)} ns)")
except OSError as e:
    say("clock_gettime(child's CPU clock)", f"denied ({e})")
say("/proc/<child>/schedstat", read(f"/proc/{pid}/schedstat"))
os.waitpid(pid, 0)
say("/proc/self/schedstat", read("/proc/self/schedstat") + "  (cpu ns, run-queue wait ns, timeslices)")

# --- timers --------------------------------------------------------------------------------------------------
hits = []
signal.signal(signal.SIGPROF, lambda *a: hits.append(time.process_time()))
t0 = time.process_time()
signal.setitimer(signal.ITIMER_PROF, 0.010)
while not hits and time.process_time() - t0 < 0.1:
    pass
signal.setitimer(signal.ITIMER_PROF, 0)
say("setitimer(ITIMER_PROF, 10 ms)", f"fired at {(hits[0] - t0) * 1000:.3f} ms CPU" if hits else "never fired")

# POSIX timer on this process's CPU clock (timer_create(CLOCK_PROCESS_CPUTIME_ID, SIGEV_SIGNAL)).
librt = ctypes.CDLL("librt.so.1", use_errno=True)
tid = ctypes.c_void_p()
r = librt.timer_create(2, None, ctypes.byref(tid))  # sevp NULL: SIGALRM on expiry
say("timer_create(PROCESS_CPUTIME_ID)", "ok" if r == 0 else os.strerror(ctypes.get_errno()))
if r == 0:
    librt.timer_delete(tid)
say("os.timerfd_create", "present" if hasattr(os, "timerfd_create") else "absent in this python (3.13+); timerfd takes no CPU clocks anyway")
