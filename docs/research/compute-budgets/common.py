"""
Shared helpers for the compute-budget prototypes: precise CPU clocks of other processes, perf_event_open
(software task-clock), POSIX CPU timers, cgroup v1 helpers, and the workloads. Standalone: nothing here
touches server/ or the runners.
"""
import ctypes, fcntl, json, math, os, signal, statistics, struct, time

libc = ctypes.CDLL(None, use_errno=True)
librt = ctypes.CDLL("librt.so.1", use_errno=True)

# --- CPU clocks ----------------------------------------------------------------------------------------------


def cpu_clock_of(pid):
    """The process-wide CPU clock id of another process (MAKE_PROCESS_CPUCLOCK(pid, CPUCLOCK_SCHED))."""
    return (~pid << 3) | 2


def cpu_ns(pid):
    """CPU time of process `pid` in ns, exact at the moment of the call (the kernel folds in a running slice)."""
    return time.clock_gettime_ns(cpu_clock_of(pid))


def schedstat(pid="self"):
    """(cpu ns, run-queue wait ns, timeslices) from /proc/<pid>/schedstat (cpu is stale by up to a tick while it runs)."""
    with open(f"/proc/{pid}/schedstat") as f:
        a, b, c = f.read().split()
    return int(a), int(b), int(c)


def set_timer_slack(ns=1):
    """Make this process's timed sleeps (select, nanosleep) wake within `ns` of their deadline (default slack: 50 us)."""
    PR_SET_TIMERSLACK = 29
    libc.prctl(PR_SET_TIMERSLACK, ctypes.c_ulong(ns), 0, 0, 0)


# --- perf_event_open: software task-clock --------------------------------------------------------------------
NR_PERF_EVENT_OPEN = 298  # x86_64
PERF_TYPE_HARDWARE, PERF_TYPE_SOFTWARE = 0, 1
PERF_COUNT_SW_TASK_CLOCK = 1
PERF_EVENT_IOC_ENABLE, PERF_EVENT_IOC_DISABLE, PERF_EVENT_IOC_REFRESH, PERF_EVENT_IOC_RESET = 0x2400, 0x2401, 0x2402, 0x2403
F_SETSIG = 10


def perf_open(pid=0, period_ns=0, sigtrap=False, type_=PERF_TYPE_SOFTWARE, config=PERF_COUNT_SW_TASK_CLOCK, disabled=False):
    """
    A perf event on `pid` (0: this thread). With period_ns, it overflows after that much of the task's own CPU
    time: the software task-clock event runs an hrtimer only while the task is on a CPU. sigtrap: the kernel
    then forces SIGTRAP on the task itself (kernel 5.13+). Returns the fd; raises OSError.
    """
    attr = bytearray(136)
    struct.pack_into("IIQQ", attr, 0, type_, 136, config, period_ns)
    bits = (1 << 5) | (1 << 6)  # exclude_kernel, exclude_hv
    if disabled:
        bits |= 1
    if sigtrap:
        bits |= (1 << 36) | (1 << 37)  # remove_on_exec, sigtrap
    struct.pack_into("Q", attr, 40, bits)
    struct.pack_into("I", attr, 48, 1)  # wakeup_events
    buf = (ctypes.c_char * 136).from_buffer(attr)
    fd = libc.syscall(NR_PERF_EVENT_OPEN, buf, ctypes.c_int(pid), ctypes.c_int(-1), ctypes.c_int(-1), ctypes.c_ulong(0))
    if fd < 0:
        e = ctypes.get_errno()
        raise OSError(e, os.strerror(e))
    return fd


def perf_signal_on_overflow(fd, pid, sig):
    """On the event's overflow, the kernel sends `sig` to `pid` (fasync: F_SETOWN, F_SETSIG, O_ASYNC). SIGKILL works."""
    fcntl.fcntl(fd, fcntl.F_SETOWN, pid)
    fcntl.fcntl(fd, F_SETSIG, sig)
    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_ASYNC)


def perf_read(fd):
    return struct.unpack("Q", os.read(fd, 8))[0]


# --- POSIX CPU timer (timer_create on CLOCK_PROCESS_CPUTIME_ID; SIGALRM on expiry) ------------------------------


class Itimerspec(ctypes.Structure):
    _fields_ = [("it_interval_s", ctypes.c_long), ("it_interval_ns", ctypes.c_long),
                ("it_value_s", ctypes.c_long), ("it_value_ns", ctypes.c_long)]


def posix_cpu_timer(seconds, clock=time.CLOCK_PROCESS_CPUTIME_ID):
    tid = ctypes.c_void_p()
    if librt.timer_create(clock, None, ctypes.byref(tid)) != 0:  # NULL sigevent: SIGALRM
        e = ctypes.get_errno()
        raise OSError(e, os.strerror(e))
    ns = int(seconds * 1e9)
    spec = Itimerspec(0, 0, ns // 1_000_000_000, ns % 1_000_000_000)
    librt.timer_settime(tid, 0, ctypes.byref(spec), None)
    return tid


# --- cgroup v1 helpers ---------------------------------------------------------------------------------------
CG = "/sys/fs/cgroup"


def cg_make(ctrl, name, **files):
    p = f"{CG}/{ctrl}/{name}"
    os.makedirs(p, exist_ok=True)
    for k, v in files.items():
        with open(f"{p}/{k.replace('__', '.')}", "w") as f:
            f.write(str(v))
    return p


def cg_join(ctrl, name, pid=0):
    with open(f"{CG}/{ctrl}/{name}/cgroup.procs", "w") as f:
        f.write(str(pid or os.getpid()))


def cg_remove(ctrl, name):
    """Move whatever is left back to the root, then remove the group."""
    p = f"{CG}/{ctrl}/{name}"
    if not os.path.isdir(p):
        return
    try:
        with open(f"{p}/cgroup.procs") as f:
            pids = f.read().split()
        for pid in pids:
            try:
                with open(f"{CG}/{ctrl}/cgroup.procs", "w") as g:
                    g.write(pid)
            except OSError:
                pass
        os.rmdir(p)
    except OSError as e:
        print(f"cg_remove {ctrl}/{name}: {e}")


# --- workloads -----------------------------------------------------------------------------------------------


def work_interp(n=110000):
    """Interpreter-bound flower-like work: small data, hashing, dict and list operations. Deterministic."""
    import hashlib
    d = {}
    acc = 0
    for i in range(n):
        k = (i * 2654435761) % 4093
        d[k] = d.get(k, 0) + i
        acc ^= k
    items = sorted(d.items())
    s = json.dumps(items)
    h = hashlib.sha256()
    for _ in range(20):
        h.update(s.encode())
    return acc, h.hexdigest()


def work_memory(n=70000):
    """Memory-bound work: a dict and lists of ~n entries (tens of MB touched), random access. Deterministic."""
    d = {}
    for i in range(n):
        d[(i * 2654435761) % 1000003] = i
    keys = list(d)
    acc = 0
    j = 7
    for _ in range(n):
        j = (j * 1103515245 + 12345) % len(keys)
        acc += d[keys[j]]
    return acc


def stats(xs):
    xs = sorted(x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x)))
    if not xs:
        return {"n": 0}
    q = lambda p: xs[min(len(xs) - 1, max(0, int(round(p * (len(xs) - 1)))))]
    m = statistics.fmean(xs)
    sd = statistics.pstdev(xs) if len(xs) > 1 else 0.0
    return {"n": len(xs), "mean": m, "sd": sd, "cv": sd / m if m else None, "min": xs[0], "p5": q(0.05), "p50": q(0.5),
            "p95": q(0.95), "p99": q(0.99), "max": xs[-1]}


def rusage_cpu_ms(ru):
    return (ru.ru_utime + ru.ru_stime) * 1000
