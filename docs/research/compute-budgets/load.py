#!/usr/bin/env python3
"""
Controlled load that stands in for the shared box (LLM sessions, their tools, scaffolds).

    load.py start PIDFILE SPEC [options]   start hogs, write their PIDs to PIDFILE, return at once
    load.py stop PIDFILE                   SIGKILL exactly those PIDs (each checked to still be one of ours)

SPEC: comma-separated kind:count, e.g. "spin:3,mem:1,bursty:4".
  spin    a pure-Python busy loop (CPU only, cache-resident)
  mem     copies a 64 MB buffer over and over (memory bandwidth, evicts the shared cache)
  bursty  busy 5-50 ms, then asleep 5-50 ms (an interactive process: a CLI parsing, a tool run)
Options:
  --setsid          each hog in its own session, so its own autogroup (as scaffolds and tool shells are)
  --nice N          nice value of each hog
  --autogroup-nice N   write N to /proc/self/autogroup (the weight of the hog's autogroup)
  --cpu-cgroup NAME    join /sys/fs/cgroup/cpu/NAME (e.g. one with cpu.idle=1)
  --cpuset NAME        join /sys/fs/cgroup/cpuset/NAME
  --idle            SCHED_IDLE
"""
import os, random, signal, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
TAG = "cb-load-hog"


MAX_LIFE_S = 900  # every hog ends by itself after this, even if nobody stops it


def hog(kind):
    end_of_life = time.monotonic() + MAX_LIFE_S
    alive = lambda: time.monotonic() < end_of_life
    if kind == "spin":
        while alive():
            for _ in range(1_000_000):
                pass
    elif kind == "mem":
        a = bytearray(os.urandom(1 << 16)) * (1 << 10)  # 64 MB
        b = bytearray(len(a))
        while alive():
            b[:] = a
            a[:] = b
    elif kind == "bursty":
        rnd = random.Random(os.getpid())
        while alive():
            end = time.perf_counter() + rnd.uniform(0.005, 0.05)
            while time.perf_counter() < end:
                pass
            time.sleep(rnd.uniform(0.005, 0.05))
    else:
        raise SystemExit(f"unknown hog kind {kind}")


def start(pidfile, spec, opts):
    pids = []
    for part in spec.split(","):
        if not part:
            continue
        kind, n = part.split(":")
        for _ in range(int(n)):
            pid = os.fork()
            if pid == 0:
                try:
                    if opts.get("setsid"):
                        os.setsid()
                    if opts.get("cpuset"):
                        with open(f"/sys/fs/cgroup/cpuset/{opts['cpuset']}/cgroup.procs", "w") as f:
                            f.write(str(os.getpid()))
                    if opts.get("cpu_cgroup"):
                        with open(f"/sys/fs/cgroup/cpu/{opts['cpu_cgroup']}/cgroup.procs", "w") as f:
                            f.write(str(os.getpid()))
                    if opts.get("autogroup_nice") is not None:
                        with open("/proc/self/autogroup", "w") as f:
                            f.write(str(opts["autogroup_nice"]))
                    if opts.get("nice"):
                        os.setpriority(os.PRIO_PROCESS, 0, int(opts["nice"]))
                    if opts.get("idle"):
                        os.sched_setscheduler(0, os.SCHED_IDLE, os.sched_param(0))
                    devnull = os.open(os.devnull, os.O_RDWR)
                    for fd in (0, 1):
                        os.dup2(devnull, fd)
                    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__), "hog", kind, TAG])
                except BaseException as e:
                    sys.stderr.write(f"hog setup failed: {e}\n")
                    os._exit(1)
            pids.append(pid)
    with open(pidfile, "w") as f:
        f.write("\n".join(map(str, pids)) + "\n")
    return pids


def ours(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return TAG.encode() in f.read()
    except OSError:
        return False


def stop(pidfile):
    try:
        with open(pidfile) as f:
            pids = [int(x) for x in f.read().split()]
    except FileNotFoundError:
        return
    for pid in pids:
        if ours(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    for pid in pids:
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
    os.unlink(pidfile)


def parse(argv):
    opts, rest, i = {}, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--setsid":
            opts["setsid"] = True
        elif a == "--idle":
            opts["idle"] = True
        elif a in ("--nice", "--autogroup-nice", "--cpu-cgroup", "--cpuset"):
            opts[a[2:].replace("-", "_")] = argv[i + 1]
            i += 1
        else:
            rest.append(a)
        i += 1
    return opts, rest


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "hog":
        hog(sys.argv[2])
    elif cmd == "start":
        opts, rest = parse(sys.argv[2:])
        print(" ".join(map(str, start(rest[0], rest[1], opts))))
    elif cmd == "stop":
        stop(sys.argv[2])
