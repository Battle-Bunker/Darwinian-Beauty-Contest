#!/usr/bin/env python3
"""
Tables (Markdown) from run_bench.py's results.

    summarize.py RESULTS_DIR > RESULTS_DIR/tables.md
"""
import collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import stats

D = sys.argv[1]


def rows(name):
    p = os.path.join(D, name)
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p) if l.strip()]


def f(x, d=2):
    return "–" if x is None else (f"{x:.{d}f}" if isinstance(x, float) else str(x))


def table(head, body):
    print("| " + " | ".join(head) + " |")
    print("|" + "|".join("---" for _ in head) + "|")
    for r in body:
        print("| " + " | ".join(r) + " |")
    print()


COND_ORDER = ["idle1slot", "idle", "autogroup", "agnice", "cpuidle", "cpuset", "fifo", "contained"]
order = lambda t: COND_ORDER.index(t) if t in COND_ORDER else 99

# --- noise and misses ----------------------------------------------------------------------------------------
noise = rows("noise.jsonl")
if noise:
    print("## CPU-time noise of identical work, and misses (2 slots)\n")
    g = collections.defaultdict(list)
    for r in noise:
        g[(r["tag"], r["kind"])].append(r)
    idle = {k: stats([r["cpu"] for r in v])["p50"] for (t, k), v in g.items() if t == "idle"}
    body = []
    for tag in sorted({t for t, _ in g}, key=order):
        for kind in ("interp", "memory"):
            v = g.get((tag, kind), [])
            if not v:
                continue
            s, w = stats([r["cpu"] for r in v]), stats([r["wall"] for r in v])
            body.append([tag, kind, f(s["p50"]), f(s["p50"] / idle[kind] if idle.get(kind) else None, 3), f(100 * s["cv"], 1),
                         f(s["p5"]), f(s["p95"]), f(s["max"]), f(w["p50"]), f(w["p95"])])
    table(["condition", "work", "CPU p50 ms", "÷ idle", "CPU CV %", "CPU p5", "CPU p95", "CPU max", "wall p50", "wall p95"], body)
    body = []
    for tag in sorted({t for t, _ in g}, key=order):
        cells = [tag]
        for kind in ("burn_wall", "bee", "burn_cpu"):
            v = g.get((tag, kind), [])
            cells.append(f"{100 * sum(r['late'] for r in v) / len(v):.1f}% of {len(v)}" if v else "–")
        v = g.get((tag, "burn_cpu"), [])
        cells.append(f(stats([r["wall"] / max(r["r"], 1e-9) for r in v])["p95"]) if v else "–")
        body.append(cells)
    table(["condition", "0.9R burner, wall limit R: late", "bee 40 ms CPU, 50 ms wall: late", "0.9R burner, CPU limit R: late",
           "CPU-limit burner wall ÷ R, p95"], body)

# --- enforcement precision -----------------------------------------------------------------------------------
# A process-wide CPU timer (ITIMER_PROF / ITIMER_VIRTUAL / timer_create on the process clock) makes the
# process's own process_time() tick-stale, so for those the stop is the child's total CPU minus an exit.
STALE = {"prof", "virtual", "posix", "prof_kill"}
MECHS = ["real", "prof", "virtual", "posix", "prof_kill", "tkill", "rearm", "rearm_tkill", "watchdog", "schedstat",
         "watchdog_perf", "watchdog_rt", "perf_kill", "perf_sigtrap", "perf_sigtrap_k"]


def enforcement(fname, title):
    allr = rows(fname)
    enf = [r for r in allr if not r["mech"].startswith("_")]
    ctl = {r["tag"]: r for r in allr if r["mech"] == "_controls"}
    if not enf:
        return
    print(f"## {title}: CPU at the stop − (CPU at arming + R), ms\n")
    print("Controls (CPU an exit costs, ms): " + ", ".join(f"{t} {c['exit']:.3f} ({c['exit_perf']:.3f} with a perf event)" for t, c in ctl.items()) + "\n")
    for r in enf:
        if r["mech"] in STALE:
            r["over"] = r["total"] / 1e6 - ctl[r["tag"]]["exit"] - r["arm_cpu"] / 1e6 - r["r"]
    g = collections.defaultdict(list)
    for r in enf:
        g[(r["tag"], r["work"], r["mech"])].append(r)
    for work in ("py", "c"):
        body = []
        for tag in sorted({t for t, _, _ in g}, key=order):
            for m in MECHS:
                v = g.get((tag, work, m))
                if not v:
                    continue
                s = stats([r["over"] for r in v])
                by_r = {rr: stats([r["over"] for r in v if r["r"] == rr])["p50"] for rr in sorted({r["r"] for r in v})}
                wall = stats([r["wall"] / r["r"] for r in v])
                hows = collections.Counter(r["how"] for r in v)
                late = sum(1 for r in v if r["over"] > 0.5 * r["r"] and r["over"] > 2)
                body.append([tag, m, f(s["p50"], 3), f(s["p95"], 3), f(s["min"], 3), f(s["max"], 3), str(late),
                             " ".join(f"{k:g}:{f(x, 2)}" for k, x in by_r.items()), f(wall["p50"]), ",".join(f"{k}:{n}" for k, n in hows.items())])
        print(f"### workload: {work}\n")
        table(["condition", "mechanism", "over p50", "over p95", "min", "max", "> R/2 late", "p50 by R", "wall÷R p50", "stopped by"], body)
    arm = collections.defaultdict(list)
    for r in enf:
        if r.get("arm_us") is not None and r["tag"] == "idle":
            arm[r["mech"]].append(r["arm_us"])
    print("Arming cost (idle, us, p50): " + ", ".join(f"{m} {stats(v)['p50']:.1f}" for m, v in sorted(arm.items())) + "\n")
    wk = collections.defaultdict(list)
    for r in enf:
        if r["mech"].startswith("watchdog") or r["mech"] == "schedstat":
            wk[(r["tag"], r["mech"])].append(r["wakeups"])
    if wk:
        print("Watchdog wake-ups per call (p50/max): " + ", ".join(f"{t}/{m} {stats(v)['p50']}/{stats(v)['max']}" for (t, m), v in sorted(wk.items())) + "\n")


enforcement("enforce.jsonl", "Stop precision")
enforcement("enforce2.jsonl", "Stop precision, follow-up (per-thread CPU-timer kill, perf counting kernel time)")
log = os.path.join(D, "run.log")
if os.path.exists(log):
    st = [l.strip() for l in open(log) if l.startswith("steal ")]
    if st:
        print("Host steal time measured during the conditions: " + "; ".join(x[6:] for x in st) + "\n")

# --- node ----------------------------------------------------------------------------------------------------
node = rows("node.jsonl")
if node:
    print("## TypeScript runner options: CPU at the stop − R (main or worker thread), ms\n")
    g = collections.defaultdict(list)
    for r in node:
        if r.get("test") == "stop":
            g[(r["tag"], r["mech"])].append(r)
    body = []
    for (tag, m), v in sorted(g.items(), key=lambda kv: (order(kv[0][0]), kv[0][1])):
        s = stats([r["over"] for r in v])
        wall = stats([r["wall"] / r["r"] for r in v])
        by_r = {rr: stats([r["over"] for r in v if r["r"] == rr])["p50"] for rr in sorted({r["r"] for r in v})}
        extra = ""
        if m == "worker_kill":
            extra = f"terminate {stats([r['terminate_ms'] for r in v])['p50']:.1f} ms, respawn {stats([r['respawn_ms'] for r in v])['p50']:.1f} ms"
        if m == "sigint_perf":
            extra = f"arm {stats([r['arm_us'] for r in v])['p50']:.0f} us"
        body.append([tag, m, f(s["p50"], 3), f(s["p95"], 3), f(s["min"], 3), f(s["max"], 3), " ".join(f"{k:g}:{f(x, 2)}" for k, x in by_r.items()),
                     f(wall["p50"]), extra])
    table(["condition", "mechanism", "over p50", "over p95", "min", "max", "p50 by R", "wall÷R p50", "costs"], body)
    nz = collections.defaultdict(list)
    for r in node:
        if r.get("test") == "noise":
            nz[r["tag"]].append(r)
    body = []
    for tag, v in sorted(nz.items(), key=lambda kv: order(kv[0])):
        v = v[3:]  # the first calls warm the JIT up
        for k in ("thread", "process", "wall"):
            s = stats([r[k] for r in v])
            body.append([tag, k, f(s["p50"]), f(100 * s["cv"], 1), f(s["p5"]), f(s["p95"]), f(s["max"])])
    if body:
        print("Fixed JS workload in fresh contexts (ms):\n")
        table(["condition", "clock", "p50", "CV %", "p5", "p95", "max"], body)
    for r in node:
        if r.get("test") == "worker_cpuUsage_live":
            ss = r["samples"]
            steps = [round(b[1] - a[1], 2) for a, b in zip(ss, ss[1:]) if b[1] != a[1]]
            print(f"- worker.cpuUsage() while the worker computes ({r['tag']}): {len(ss)} answers in {ss[-1][0]:.0f} ms; "
                  f"the value changed {len(steps)} times, steps (ms) {steps[:12]}\n")

# --- determinism ---------------------------------------------------------------------------------------------
det = [r for r in rows("determinism.jsonl") if "error" not in r]
if det:
    print("## Counting work units in Python\n")
    g = collections.defaultdict(list)
    for r in det:
        g[(r["tag"], r["python"], r["work"], r["mode"])].append(r)
    native = {(t, p, w): stats([r["cpu_ms"] for r in v])["p50"] for (t, p, w, m), v in g.items() if m == "native"}
    body = []
    for (t, p, w, m), v in sorted(g.items(), key=lambda kv: (order(kv[0][0]), kv[0][1], kv[0][2], kv[0][3])):
        units = [r["units"] for r in v if r["units"] is not None]
        cpu = stats([r["cpu_ms"] for r in v])
        n = native.get((t, p, w))
        body.append([t, p, w, m, f(cpu["p50"], 1), f(cpu["p50"] / n if n else None, 1), str(units[0]) if units else "–",
                     ("identical" if len(set(units)) == 1 else f"{len(set(units))} values") if units else "–",
                     f(cpu["p50"] * 1e6 / units[0] if units and units[0] else None, 1)])
    table(["condition", "python", "work", "mode", "CPU p50 ms", "× native", "units", "across runs", "ns of CPU per unit"], body)

fuel = rows("fuel.jsonl")
if fuel:
    print("## WebAssembly fuel (wasmtime)\n")
    g = collections.defaultdict(list)
    for r in fuel:
        if r["mode"] != "limit":
            g[(r["tag"], r["mode"])].append(r)
    body = []
    for (t, m), v in sorted(g.items(), key=lambda kv: (order(kv[0][0]), kv[0][1])):
        s = stats([r["cpu_ms"] for r in v])
        fu = [r.get("fuel") for r in v if r.get("fuel") is not None]
        body.append([t, m, f(s["p50"]), f(100 * s["cv"], 1), f(s["p5"]), f(s["p95"]), str(fu[0]) if fu else "–",
                     ("identical" if len(set(fu)) == 1 else f"{len(set(fu))} values") if fu else "–"])
    table(["condition", "mode", "CPU p50 ms", "CV %", "p5", "p95", "fuel", "fuel across runs"], body)
    for r in fuel:
        if r["mode"] == "limit":
            print(f"- {r['tag']}: given {r['given']} fuel → {'completed' if r['result'] else 'trapped: ' + str(r['error'])}\n")

micro = os.path.join(D, "micro.json")
if os.path.exists(micro):
    print("## Per-call machinery costs (idle, us)\n")
    m = json.load(open(micro))
    body = []
    for k, v in m.items():
        if isinstance(v, dict) and "p50" in v:
            body.append([k, f(v["p50"], 1), f(v["p95"], 1), f(v["max"], 1)])
        else:
            body.append([k, str(v), "", ""])
    table(["what", "p50", "p95", "max"], body)
