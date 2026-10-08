#!/usr/bin/env python3
"""
CPU-time noise for identical work, and the misses a wall-clock limit causes, with SLOTS runner-like processes
calling at once (the engine's CPU_SLOTS).

    noise_py.py OUT.jsonl [--tag T] [--slots 2] [--calls 30] [--fifo]

Each slot is a process that forks a child per call (as py_runner.py does). Calls, shuffled:
  interp      work_interp(): fixed interpreter-bound work, ~30 ms of CPU idle
  memory      work_memory(): fixed memory-bound work (a few MB of dicts and lists, random access)
  burn_wall   a flower that burns 0.9 R of CPU (R uniform in 3-150 ms) under today's wall-clock limit R
              (setitimer(ITIMER_REAL)): late if the wall clock reaches R first
  burn_cpu    the same flower under a CPU-time limit R (perf task-clock sigtrap) and a wall backstop of 1 s
  bee         a bee decision burning 40 ms of CPU against today's 50 ms wall deadline
Every line: {tag, slot, kind, r, cpu (the child's own process_time for the call), wall (fork to reply, as
the runner sees it), late}.
--fifo: the slot processes and their children run SCHED_FIFO 10.
"""
import json, os, random, signal, struct, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import hashlib  # noqa: F401  (pre-imported, as the runner pre-imports its modules)


class Timeout(BaseException):
    pass


def _raise(*_):
    raise Timeout()


def call(kind, r_ms):
    rd, wr = os.pipe()
    t0 = time.perf_counter_ns()
    pid = os.fork()
    if pid == 0:
        os.close(rd)
        signal.signal(signal.SIGALRM, _raise)
        signal.signal(signal.SIGTRAP, signal.SIG_DFL)
        c0 = time.process_time_ns()
        late = 0
        try:
            if kind in ("interp", "memory"):
                (C.work_interp if kind == "interp" else C.work_memory)()
            elif kind in ("burn_wall", "bee"):
                signal.setitimer(signal.ITIMER_REAL, r_ms / 1000)
                until = c0 + int((0.8 if kind == "bee" else 0.9) * r_ms * 1e6)
                while time.process_time_ns() < until:
                    pass
                signal.setitimer(signal.ITIMER_REAL, 0)
            elif kind == "burn_cpu":
                C.perf_open(0, period_ns=int(r_ms * 1e6), sigtrap=True)
                signal.setitimer(signal.ITIMER_REAL, 1.0)  # the wall backstop
                until = c0 + int(0.9 * r_ms * 1e6)
                while time.process_time_ns() < until:
                    pass
                signal.setitimer(signal.ITIMER_REAL, 0)
        except Timeout:
            late = 1
        cpu = time.process_time_ns() - c0
        os.write(wr, struct.pack("qq", cpu, late))
        os._exit(0)
    os.close(wr)
    buf = os.read(rd, 16)
    wall = (time.perf_counter_ns() - t0) / 1e6
    os.close(rd)
    os.waitpid(pid, 0)
    if len(buf) == 16:
        cpu, late = struct.unpack("qq", buf)
        return cpu / 1e6, wall, late
    return None, wall, 1  # killed (a CPU limit)


def slot(i, out, tag, calls, fifo, seed):
    if fifo:
        os.sched_setscheduler(0, os.SCHED_FIFO, os.sched_param(10))
    rnd = random.Random(seed)
    plan = [("interp", 0)] * calls + [("memory", 0)] * calls + [("bee", 50)] * calls
    plan += [("burn_wall", rnd.uniform(3, 150)) for _ in range(calls)]
    plan += [("burn_cpu", rnd.uniform(3, 150)) for _ in range(calls)]
    rnd.shuffle(plan)
    with open(out, "a") as f:
        for kind, r in plan:
            cpu, wall, late = call(kind, r)
            f.write(json.dumps({"tag": tag, "slot": i, "kind": kind, "r": r, "cpu": cpu, "wall": wall, "late": late}) + "\n")
            f.flush()


def main():
    args = sys.argv[1:]
    out = args[0]
    opt = {"tag": "", "slots": "2", "calls": "30"}
    fifo = "--fifo" in args
    args = [a for a in args if a != "--fifo"]
    for i in range(1, len(args), 2):
        opt[args[i][2:]] = args[i + 1]
    C.work_interp(2000)  # warm
    C.work_memory(2000)
    kids = []
    for i in range(int(opt["slots"])):
        pid = os.fork()
        if pid == 0:
            try:
                slot(i, out, opt["tag"], int(opt["calls"]), fifo, 1000 + i)
            finally:
                os._exit(0)
        kids.append(pid)
    for pid in kids:
        os.waitpid(pid, 0)


if __name__ == "__main__":
    main()
