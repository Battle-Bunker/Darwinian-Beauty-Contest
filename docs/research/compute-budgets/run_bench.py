#!/usr/bin/env python3
"""
Runs every measurement under each load condition, on a machine that is otherwise idle.

    run_bench.py RESULTS_DIR [--only cond1,cond2] [--steps noise,enforce,node,det,fuel,micro] [--quick]

Conditions (the load is load.py's: spin:3, mem:1, bursty:4, i.e. 8 processes wanting ~5 cores of 4):
  idle          no load
  idle1slot     no load, one runner slot (no other program on the machine at all)
  autogroup     the hogs each in their own session at nice 15: the arena's scaffolds and session tools
                today. With sched_autogroup_enabled=1, each session is its own autogroup of equal weight,
                so the nice value counts for nothing against a runner in another session.
  agnice        the same hogs with their autogroup's nice set to 15 (/proc/<pid>/autogroup)
  cpuidle       the same hogs in a cpu cgroup with cpu.idle=1 (SCHED_IDLE weight for the whole group)
  cpuset        the same hogs confined to cpus 0-1; the runners to cpus 2-3
  fifo          the autogroup load; the runners at SCHED_FIFO 10
Steps: noise (noise_py.py), enforce (enforce_py.py), node (node_cpu.cjs), det (determinism_py.py),
fuel (fuel/fuel_bench.py), micro (micro.py, idle only).
Everything it starts is killed by PID at the end of each condition; its cgroups (cb-*) are removed.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C
import load as L

LOAD = "spin:3,mem:1,bursty:4"
CONDITIONS = {
    "idle": {},
    "idle1slot": {"slots": 1},
    "autogroup": {"load": {"setsid": True, "nice": "15"}},
    "agnice": {"load": {"setsid": True, "nice": "15", "autogroup_nice": "15"}},
    "cpuidle": {"load": {"setsid": True, "nice": "15", "cpu_cgroup": "cb-idle"}},
    "cpuset": {"load": {"setsid": True, "nice": "15", "cpuset": "cb-rest"}, "runner_cpuset": "cb-runner"},
    "fifo": {"load": {"setsid": True, "nice": "15"}, "fifo": True},
}
STEPS_BY_COND = {
    "idle": ["micro", "noise", "enforce", "node", "det", "fuel"],
    "idle1slot": ["noise"],
    "autogroup": ["noise", "enforce", "node", "det", "fuel"],
    "agnice": ["noise"],
    "cpuidle": ["noise", "enforce"],
    "cpuset": ["noise", "enforce"],
    "fifo": ["noise"],
}


def setup_cgroups():
    C.cg_make("cpu", "cb-idle", cpu__idle=1)
    C.cg_make("cpuset", "cb-rest", cpuset__cpus="0-1", cpuset__mems="0")
    C.cg_make("cpuset", "cb-runner", cpuset__cpus="2-3", cpuset__mems="0")


def teardown_cgroups():
    C.cg_remove("cpu", "cb-idle")
    C.cg_remove("cpuset", "cb-rest")
    C.cg_remove("cpuset", "cb-runner")


def run(cmd, cond, log, env=None, timeout=1800):
    cs = cond.get("runner_cpuset")

    def pre():
        if cs:
            with open(f"/sys/fs/cgroup/cpuset/{cs}/cgroup.procs", "w") as f:
                f.write(str(os.getpid()))

    t = time.time()
    p = subprocess.run(cmd, preexec_fn=pre, env=env, capture_output=True, text=True, timeout=timeout)
    log.write(f"$ {' '.join(cmd)}\n  rc={p.returncode} {time.time() - t:.1f}s\n{p.stdout[-2000:]}{p.stderr[-2000:]}\n")
    log.flush()
    return p


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    args = sys.argv[2:]
    only = steps = None
    quick = "--quick" in args
    for i, a in enumerate(args):
        if a == "--only":
            only = args[i + 1].split(",")
        if a == "--steps":
            steps = args[i + 1].split(",")
    py = sys.executable
    # wasmtime (pip install --target) and the compiled workload live outside the results (CB_PYLIB, CB_FUEL)
    pylib = os.environ.get("CB_PYLIB", os.path.join(out, "pylib"))
    fuel_dir = os.environ.get("CB_FUEL", os.path.join(out, "fuel-build"))
    log = open(os.path.join(out, "run.log"), "a")
    setup_cgroups()
    try:
        for name, cond in CONDITIONS.items():
            if only and name not in only:
                continue
            todo = [s for s in STEPS_BY_COND[name] if not steps or s in steps]
            if not todo:
                continue
            pidfile = os.path.join(out, f"load-{name}.pids")
            log.write(f"\n=== {name} {time.strftime('%H:%M:%S')} steps={todo}\n")
            if cond.get("load"):
                pids = L.start(pidfile, LOAD, cond["load"])
                log.write(f"load pids {pids}\n")
                time.sleep(2)  # let the load settle
            try:
                with open(f"/proc/loadavg") as f:
                    log.write(f"loadavg {f.read()}")
                for step in todo:
                    tag = name
                    if step == "micro":
                        run([py, f"{HERE}/micro.py", f"{out}/micro.json"], cond, log)
                    elif step == "noise":
                        cmd = [py, f"{HERE}/noise_py.py", f"{out}/noise.jsonl", "--tag", tag, "--calls", "10" if quick else "30",
                               "--slots", str(cond.get("slots", 2))]
                        run(cmd + (["--fifo"] if cond.get("fifo") else []), cond, log)
                    elif step == "enforce":
                        cmd = [py, f"{HERE}/enforce_py.py", f"{out}/enforce.jsonl", "--tag", tag]
                        run(cmd + (["--n", "3", "--nc", "1"] if quick else []), cond, log)
                    elif step == "node":
                        run(["node", f"{HERE}/node_cpu.cjs", f"{out}/node.jsonl", tag, "3" if quick else "10"], cond, log)
                    elif step == "det":
                        extra = ["--reps", "3"]
                        if name != "idle":  # counts under load: a subset is enough to show they don't move
                            extra += ["--pythons", "/usr/local/bin/python3,/usr/bin/python3.12", "--modes", "native,opcodes,mon_instr", "--works", "interp"]
                        run([py, f"{HERE}/determinism_py.py", f"{out}/determinism.jsonl", "--tag", tag] + extra, cond, log)
                    elif step == "fuel":
                        env = dict(os.environ, PYTHONPATH=pylib)
                        run([py, f"{HERE}/fuel/fuel_bench.py", f"{out}/fuel.jsonl", f"{fuel_dir}/work.wasm", f"{fuel_dir}/work.so",
                             "--tag", tag, "--reps", "5" if quick else "20"], cond, log, env=env)
            finally:
                if cond.get("load"):
                    L.stop(pidfile)
                    log.write(f"load stopped {time.strftime('%H:%M:%S')}\n")
                log.flush()
    finally:
        teardown_cgroups()
        log.close()


if __name__ == "__main__":
    main()
