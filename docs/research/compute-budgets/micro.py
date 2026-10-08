#!/usr/bin/env python3
"""
What each piece of per-call machinery costs (wall microseconds, idle machine).

    micro.py OUT.json

  fork_call        fork a child that writes one byte and exits; reap it (what every Python call pays today)
  perf_open_warm   perf_event_open of a task-clock event on a blocked child + fasync setup + close, while
                   another perf event stays open in the runner (perf's scheduler hooks already on)
  perf_open_cold   the same with no other event open for over a second (the first open switches perf's
                   scheduler hooks on, which patches kernel text)
  perf_read        read() of that counter while the child runs on another CPU
  cpuclock_read    clock_gettime on the child's process CPU clock (tick-stale while it runs)
  schedstat_read   open/read/close /proc/<pid>/schedstat
  setitimer        one setitimer(ITIMER_REAL) arm + disarm
  cgroup_cycle     per-call cgroup: mkdir under cpuacct, move the child in, read cpuacct.usage, move it out, rmdir
"""
import json, os, signal, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

ns = time.perf_counter_ns


def blocked_child():
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(w)
        os.read(r, 1)
        os._exit(0)
    os.close(r)
    return pid, w


def spinning_child():
    pid = os.fork()
    if pid == 0:
        t = time.perf_counter()
        while time.perf_counter() - t < 0.3:
            pass
        os._exit(0)
    return pid


def end(pid, w=None):
    if w is not None:
        os.write(w, b"x")
        os.close(w)
    os.waitpid(pid, 0)


def per(fn, n):
    xs = []
    for _ in range(n):
        xs.append(fn())
    return C.stats(xs)


def main():
    out = sys.argv[1]
    res = {}

    def fork_call():
        r, w = os.pipe()
        t = ns()
        pid = os.fork()
        if pid == 0:
            os.write(w, b"x")
            os._exit(0)
        os.read(r, 1)
        os.waitpid(pid, 0)
        d = (ns() - t) / 1000
        os.close(r)
        os.close(w)
        return d

    res["fork_call_us"] = per(fork_call, 200)

    def perf_open_once():
        pid, w = blocked_child()
        t = ns()
        fd = C.perf_open(pid, period_ns=10**9)
        C.perf_signal_on_overflow(fd, pid, signal.SIGKILL)
        os.close(fd)
        d = (ns() - t) / 1000
        end(pid, w)
        return d

    cold = []
    for _ in range(4):
        time.sleep(1.3)  # perf's scheduler hooks switch off about a second after the last event closes
        cold.append(perf_open_once())
    res["perf_open_cold_us"] = C.stats(cold)
    keep = C.perf_open(0, disabled=True)
    res["perf_open_warm_us"] = per(perf_open_once, 200)

    pid = spinning_child()
    time.sleep(0.01)
    fd = C.perf_open(pid)

    def timed(f):
        t = ns()
        f()
        return (ns() - t) / 1000

    res["perf_read_us"] = per(lambda: timed(lambda: C.perf_read(fd)), 300)
    res["cpuclock_read_us"] = per(lambda: timed(lambda: C.cpu_ns(pid)), 300)
    res["schedstat_read_us"] = per(lambda: timed(lambda: C.schedstat(pid)), 300)
    # freshness while it runs: distinct values seen in 2 ms of back-to-back reads
    for name, f in (("perf", lambda: C.perf_read(fd)), ("cpuclock", lambda: C.cpu_ns(pid)), ("schedstat", lambda: C.schedstat(pid)[0])):
        seen, t = set(), time.perf_counter()
        while time.perf_counter() - t < 0.002:
            seen.add(f())
        res[f"{name}_distinct_values_in_2ms"] = len(seen)
    os.close(fd)
    os.waitpid(pid, 0)
    res["setitimer_us"] = per(lambda: timed(lambda: (signal.setitimer(signal.ITIMER_REAL, 1.0), signal.setitimer(signal.ITIMER_REAL, 0))), 300)

    def cgroup_cycle():
        pid, w = blocked_child()
        t = ns()
        p = C.cg_make("cpuacct", f"cb-call-{pid}")
        C.cg_join("cpuacct", f"cb-call-{pid}", pid)
        with open(f"{p}/cpuacct.usage") as f:
            f.read()
        with open(f"{C.CG}/cpuacct/cgroup.procs", "w") as f:  # back to the root
            f.write(str(pid))
        os.rmdir(p)
        d = (ns() - t) / 1000
        end(pid, w)
        return d

    try:
        res["cgroup_cycle_us"] = per(cgroup_cycle, 50)
    except OSError as e:
        res["cgroup_cycle_us"] = {"error": str(e)}
    os.close(keep)
    with open(out, "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
