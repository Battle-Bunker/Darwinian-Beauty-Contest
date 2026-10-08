#!/usr/bin/env python3
"""
How precisely can a forked Python call be stopped at R ms of CPU time? (and today's wall-clock stop, for contrast)

    enforce_py.py OUT.jsonl [--mechs a,b,...] [--rs 3,10,50,150] [--n 15] [--nc 4] [--works py,c] [--tag NAME]

Every trial forks a child, as py_runner.py does for a call. The child runs a workload that never ends by
itself, so whatever stops it is the mechanism under test (or a wall backstop at R + 2 s).

Workloads:
  py   a pure-Python loop (the interpreter checks for signals between bytecodes). Every ~10 us it writes its
       CPU time to shared memory, so the CPU it had when it was stopped is known without exit costs.
  c    one long C call after another (sum(range(10**7)), ~0.1-0.3 s each): a Python signal handler can't run
       until the C call returns, so in-process Python handlers overshoot; kills from outside don't care.

Mechanisms (where the stop is decided):
  real          child: setitimer(ITIMER_REAL, R): today's wall-clock limit
  prof          child: setitimer(ITIMER_PROF, R)        (user + system CPU; checked on the 4 ms tick)
  virtual       child: setitimer(ITIMER_VIRTUAL, R)     (user CPU only; tick)
  posix         child: timer_create(CLOCK_PROCESS_CPUTIME_ID) (tick)
  rearm         child: ITIMER_REAL armed for the CPU still left, re-armed until process_time reaches R
  watchdog      parent: reads the child's process CPU clock (clock_gettime), sleeps for the CPU left
                (select on the reply pipe), SIGKILL at R. Another process's clock is only as fresh as its
                last tick or context switch, so this is tick-limited.
  schedstat     parent: the same loop reading /proc/<pid>/schedstat (also tick-stale)
  watchdog_perf parent: the same loop reading a perf task-clock counter on the child (a read folds in the
                running slice, by IPI if need be: exact)
  watchdog_rt   watchdog_perf with the parent at SCHED_FIFO 50 (its wake-ups can't wait behind load)
  perf_kill     parent: perf task-clock event on the child, period R, fasync with F_SETSIG=SIGKILL: the
                kernel kills the child itself when its on-CPU time reaches R (an hrtimer, no tick)
  perf_sigtrap  child: perf task-clock event on itself with sigtrap: the kernel forces SIGTRAP at R
Controls: exit (the child kills itself at once: what an exit costs), exit_perf (the same with a perf event
open on it). For the c workload a kill's stop is the child's total CPU minus the matching control's median.

Each line of OUT: {tag, mech, work, r, stop, over, wall, how, sig, arm_us, wakeups}. over = CPU at the stop −
(CPU when armed + R), in ms.
"""
import json, mmap, os, random, select, signal, struct, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C


class Timeout(BaseException):
    pass


def _raise(*_):
    raise Timeout()


C_N = 10_000_000
PARENT_MECHS = {"watchdog", "schedstat", "watchdog_perf", "watchdog_rt", "perf_kill", "exit_perf"}
PERF_FAMILY = {"perf_kill", "perf_sigtrap", "watchdog_perf", "watchdog_rt", "exit_perf"}


def child(mech, r_ms, work, r_go, w_rep, beat):
    for s in (signal.SIGALRM, signal.SIGPROF, signal.SIGVTALRM):
        signal.signal(s, _raise)
    signal.signal(signal.SIGTRAP, signal.SIG_DFL)
    os.write(w_rep, b"R")  # set up: blocked on the go from here on, so its CPU stands still
    os.read(r_go, 1)
    r = r_ms / 1000
    t_arm0 = time.perf_counter_ns()
    pt = time.process_time_ns
    try:
        if mech == "real":
            signal.setitimer(signal.ITIMER_REAL, r)
        elif mech == "prof":
            signal.setitimer(signal.ITIMER_PROF, r)
        elif mech == "virtual":
            signal.setitimer(signal.ITIMER_VIRTUAL, r)
        elif mech == "posix":
            C.posix_cpu_timer(r)
        elif mech == "rearm":
            deadline = pt() + int(r_ms * 1_000_000)

            def check(*_):
                left = deadline - pt()
                if left <= 20_000:
                    raise Timeout()
                signal.setitimer(signal.ITIMER_REAL, left / 1e9)

            signal.signal(signal.SIGALRM, check)
            signal.setitimer(signal.ITIMER_REAL, r)
        elif mech == "perf_sigtrap":
            C.perf_open(0, period_ns=int(r_ms * 1_000_000), sigtrap=True)
        arm_cpu = pt()
        arm_us = (time.perf_counter_ns() - t_arm0) / 1000
        os.write(w_rep, struct.pack("qd", arm_cpu, arm_us))
        if mech in ("exit", "exit_perf"):
            os.kill(os.getpid(), signal.SIGKILL)
        if work == "py":
            pack = struct.pack_into
            while True:
                for _ in range(400):
                    pass
                pack("q", beat, 0, pt())
        else:
            while True:
                sum(range(C_N))
    except Timeout:
        cpu = pt()
        os.write(w_rep, struct.pack("q", cpu))
        os._exit(0)


def trial(mech, r_ms, work):
    beat = mmap.mmap(-1, 8)
    r_go, w_go = os.pipe()
    r_rep, w_rep = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(w_go)
        os.close(r_rep)
        try:
            child(mech, r_ms, work, r_go, w_rep, beat)
        finally:
            os._exit(0)
    os.close(r_go)
    os.close(w_rep)
    r_ns = int(r_ms * 1_000_000)
    os.read(r_rep, 1)  # the child is ready, and blocked
    pfd, arm_us = None, None
    t = time.perf_counter_ns()
    if mech == "perf_kill":
        pfd = C.perf_open(pid, period_ns=r_ns)
        C.perf_signal_on_overflow(pfd, pid, signal.SIGKILL)
    elif mech in ("watchdog_perf", "watchdog_rt", "exit_perf"):
        pfd = C.perf_open(pid)  # counting only
    if pfd is not None:
        arm_us = (time.perf_counter_ns() - t) / 1000
    c_arm_parent = C.cpu_ns(pid)  # exact: the child is blocked
    t0 = time.perf_counter_ns()
    os.write(w_go, b"g")
    buf = b""
    while len(buf) < 16:
        b = os.read(r_rep, 16 - len(buf))
        if not b:
            break
        buf += b
    arm_cpu, child_arm_us = struct.unpack("qd", buf) if len(buf) == 16 else (0, 0.0)
    if mech in PARENT_MECHS:  # the parent's budget counts from the child's CPU at the go
        arm_cpu = c_arm_parent
        arm_us = arm_us or 0.0
    else:
        arm_us = child_arm_us
    p0 = C.perf_read(pfd) if mech in ("watchdog_perf", "watchdog_rt") else 0
    deadline = arm_cpu + r_ns
    backstop = t0 + r_ns + 2_000_000_000
    how, wakeups, reported = None, 0, b""
    while True:
        now = time.perf_counter_ns()
        if now >= backstop:
            os.kill(pid, signal.SIGKILL)
            how = "backstop"
            break
        wait = (backstop - now) / 1e9
        if mech in ("watchdog", "schedstat", "watchdog_perf", "watchdog_rt"):
            if mech == "watchdog":
                left = deadline - C.cpu_ns(pid)
            elif mech == "schedstat":
                left = deadline - C.schedstat(pid)[0]
            else:
                left = r_ns - (C.perf_read(pfd) - p0)
            if left <= 0:
                os.kill(pid, signal.SIGKILL)
                how = "killed"
                break
            wait = min(wait, max(left / 1e9, 10e-6))
        ready, _, _ = select.select([r_rep], [], [], wait)
        wakeups += 1
        if ready:
            b = os.read(r_rep, 64)
            if not b:
                how = how or "died"
                break
            reported += b
    _, status, ru = os.wait4(pid, 0)
    t_end = time.perf_counter_ns()
    if pfd is not None:
        os.close(pfd)
    os.close(r_rep)
    os.close(w_go)
    total = int((ru.ru_utime + ru.ru_stime) * 1e9)
    caught = struct.unpack("q", reported[:8])[0] if len(reported) >= 8 else None
    last_beat = struct.unpack("q", beat[:8])[0]
    beat.close()
    return {"mech": mech, "work": work, "r": r_ms, "arm_cpu": arm_cpu, "caught": caught, "beat": last_beat, "total": total,
            "wall": (t_end - t0) / 1e6, "how": "caught" if caught is not None else how,
            "sig": os.WTERMSIG(status) if os.WIFSIGNALED(status) else None, "arm_us": arm_us, "wakeups": wakeups}


def main():
    args = sys.argv[1:]
    out = args[0]
    opt = {"mechs": "real,prof,virtual,posix,rearm,watchdog,schedstat,watchdog_perf,watchdog_rt,perf_kill,perf_sigtrap",
           "rs": "3,10,50,150", "n": "15", "nc": "4", "tag": "", "works": "py,c"}
    for i in range(1, len(args), 2):
        opt[args[i][2:]] = args[i + 1]
    mechs = opt["mechs"].split(",")
    rs = [float(x) for x in opt["rs"].split(",")]
    C.set_timer_slack(1)
    keep = C.perf_open(0, disabled=True)  # one event kept open: perf's scheduler hooks stay switched on
    controls = {}
    for ctl in ("exit", "exit_perf"):
        xs = sorted((t["total"] - t["arm_cpu"]) / 1e6 for t in (trial(ctl, 1000, "py") for _ in range(25)))
        controls[ctl] = xs[len(xs) // 2]
    plan = []
    for work in opt["works"].split(","):
        n = int(opt["n"]) if work == "py" else int(opt["nc"])
        for mech in mechs:
            for r in rs:
                plan += [(mech, r, work)] * n
    random.Random(1).shuffle(plan)
    with open(out, "a") as f:
        f.write(json.dumps({"tag": opt["tag"], "mech": "_controls", **controls}) + "\n")
        for mech, r, work in plan:
            rt = mech == "watchdog_rt"
            if rt:  # the parent only: its children start as SCHED_OTHER
                os.sched_setscheduler(0, os.SCHED_FIFO | os.SCHED_RESET_ON_FORK, os.sched_param(50))
            try:
                t = trial(mech, r, work)
            finally:
                if rt:
                    os.sched_setscheduler(0, os.SCHED_OTHER, os.sched_param(0))
            if t["caught"] is not None:
                stop = t["caught"]  # what the runner would report: process_time when Timeout reached Python
            elif work == "py" and t["beat"]:
                stop = t["beat"]  # the workload's last heartbeat (within ~10 us of the stop)
            else:
                stop = t["total"] - controls["exit_perf" if mech in PERF_FAMILY else "exit"] * 1e6
            t["stop"] = stop / 1e6
            t["over"] = (stop - t["arm_cpu"]) / 1e6 - r
            t["tag"] = opt["tag"]
            f.write(json.dumps(t) + "\n")
            f.flush()
    os.close(keep)


if __name__ == "__main__":
    main()
