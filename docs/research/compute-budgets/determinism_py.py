#!/usr/bin/env python3
"""
Can a Python call's budget be counted in machine-independent work units? Overhead and variance of counting.

    determinism_py.py OUT.jsonl [--tag T] [--reps 5] [--pythons /usr/local/bin/python3,/usr/bin/python3.12,...]

For every interpreter, mode and workload it runs a fresh process (PYTHONHASHSEED=0, as the runners do) that
times one call and counts what the mode counts:
  native      no counting: the CPU time to compare against
  opcodes     sys.settrace with f_trace_opcodes: one Python callback per bytecode (3.7+)
  lines       sys.settrace, line events only
  calls       sys.setprofile: calls and returns (Python and C functions)
  mon_instr   sys.monitoring INSTRUCTION events (3.12+)
  mon_branch  sys.monitoring JUMP + BRANCH + PY_START events: loop back-edges, branches and calls (3.12+)
Workloads: interp (common.work_interp), memory (common.work_memory), cbig (one big C call:
sum(range(3*10**6)) + sorted(range(10**6, 0, -1)): lots of CPU, few bytecodes).
Each line: {tag, python, mode, work, units, cpu_ms}.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))

INNER = r"""
import json, sys, time
sys.path.insert(0, HERE)
import common as C
mode, work = sys.argv[1], sys.argv[2]

def cbig():
    return sum(range(3 * 10**6)) + len(sorted(range(10**6, 0, -1)))

fn = {"interp": C.work_interp, "memory": C.work_memory, "cbig": cbig}[work]
fn.__call__  # (resolve before timing)
n = [0]
if mode == "opcodes":
    def tr(frame, event, arg):
        frame.f_trace_opcodes = True
        frame.f_trace_lines = False
        if event == "opcode":
            n[0] += 1
        return tr
    start = lambda: sys.settrace(tr)
    stop = lambda: sys.settrace(None)
elif mode == "lines":
    def tr(frame, event, arg):
        if event == "line":
            n[0] += 1
        return tr
    start = lambda: sys.settrace(tr)
    stop = lambda: sys.settrace(None)
elif mode == "calls":
    def pr(frame, event, arg):
        n[0] += 1
    start = lambda: sys.setprofile(pr)
    stop = lambda: sys.setprofile(None)
elif mode in ("mon_instr", "mon_branch"):
    if not hasattr(sys, "monitoring"):
        print(json.dumps({"units": None, "cpu_ms": None, "error": "no sys.monitoring"}))
        raise SystemExit
    M = sys.monitoring
    TOOL = 3
    M.use_tool_id(TOOL, "units")
    def cb(*a):
        n[0] += 1
    E = M.events
    evs = E.INSTRUCTION if mode == "mon_instr" else (E.JUMP | E.BRANCH | E.PY_START)
    for e in ([E.INSTRUCTION] if mode == "mon_instr" else [E.JUMP, E.BRANCH, E.PY_START]):
        M.register_callback(TOOL, e, cb)
    start = lambda: M.set_events(TOOL, evs)
    stop = lambda: M.set_events(TOOL, 0)
else:
    start = stop = lambda: None
fn_small = None
t = time.process_time_ns()
start()
fn()
stop()
cpu = (time.process_time_ns() - t) / 1e6
print(json.dumps({"units": n[0] if mode != "native" else None, "cpu_ms": cpu}))
""".replace("HERE", repr(HERE))


def main():
    args = sys.argv[1:]
    out = args[0]
    opt = {"tag": "", "reps": "5", "pythons": "/usr/local/bin/python3,/usr/bin/python3.12,/usr/bin/python3.13",
           "modes": "native,opcodes,lines,calls,mon_instr,mon_branch", "works": "interp,memory,cbig"}
    for i in range(1, len(args), 2):
        opt[args[i][2:]] = args[i + 1]
    env = dict(os.environ, PYTHONHASHSEED="0", PYTHONDONTWRITEBYTECODE="1")
    with open(out, "a") as f:
        for py in opt["pythons"].split(","):
            if not os.path.exists(py):
                continue
            ver = subprocess.run([py, "-c", "import sys;print(sys.version.split()[0])"], capture_output=True, text=True).stdout.strip()
            for work in opt["works"].split(","):
                for mode in opt["modes"].split(","):
                    for rep in range(int(opt["reps"])):
                        p = subprocess.run([py, "-s", "-c", INNER, mode, work], capture_output=True, text=True, env=env, timeout=600)
                        try:
                            d = json.loads(p.stdout.strip().splitlines()[-1])
                        except Exception:
                            d = {"error": (p.stderr or p.stdout)[-300:]}
                        d.update({"tag": opt["tag"], "python": ver, "mode": mode, "work": work, "rep": rep})
                        f.write(json.dumps(d) + "\n")
                        f.flush()


if __name__ == "__main__":
    main()
