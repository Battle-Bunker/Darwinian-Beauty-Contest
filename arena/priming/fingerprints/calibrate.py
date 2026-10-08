"""Calibrate the fingerprint dimensions: CPU per certified unit, its spread, and the bee's cost to check one.

    python3 arena/priming/fingerprints/calibrate.py [--target 1.0] [--seconds 0.4]

For every candidate (n, z, k, h) of each dimension it solves instances in order (as a flower does, giving up at
CAP tries) for --seconds of CPU and reports: ms per certified unit, the share of instances certified, the
coefficient of variation of the time per certified unit, and the bee's check time per unit (rebuilding the
graph and checking the certificate). It then picks, per dimension, the candidate closest to --target ms per
unit. Run it on an idle machine: it measures CPU speed.
"""
import sys
sys.dont_write_bytecode = True     # keep __pycache__ out of the priming folder
import importlib.util, json, os, statistics, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


fp, bee = load("fingerprint"), load("bee")
arg = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
TARGET, SECONDS = arg("--target", 1.0), arg("--seconds", 0.4)

# Candidate grids per dimension (kind fixed per dimension; size and density vary).
GRID = {
    0: [(n, 3, 3, -1) for n in (24, 30, 36, 42, 48)],                       # 3-colouring, p = 1/8
    1: [(n, 2, 4, -1) for n in (18, 22, 26, 30, 34)],                       # 4-colouring, p = 1/4
    2: [(n, 1, k, 1) for n, k in ((24, 6), (30, 6), (36, 6), (30, 7), (40, 7))],   # clique, p = 1/2
    3: [(n, 2, k, 0) for n, k in ((24, 6), (30, 6), (30, 7), (36, 7), (40, 7))],   # independent set, p = 1/4
    4: [(n, 1, k, 2) for n, k in ((20, 6), (24, 6), (30, 6), (24, 7), (30, 7))],   # induced random pattern, p = 1/2
}


def run(d, cand, c=123456789):
    fp.T = bee.T = tuple(cand if e == d else fp.T[e] for e in range(len(fp.T)))
    times, ok, i = [], 0, 0
    certs = []
    t_start = time.process_time()
    acc = 0.0
    while time.process_time() - t_start < SECONDS:
        t = time.process_time()
        x = fp.solve(c, d, i, (1e9, 1e9))
        acc += time.process_time() - t
        if x is not None:
            ok += 1
            times.append(acc)      # CPU spent since the last certified unit (skips included)
            acc = 0.0
            certs.append((i, x))
        i += 1
    if not ok:
        return {"cand": cand, "ms_per_unit": None, "certified": 0, "tried": i}
    t = time.perf_counter()
    for j, x in certs:
        assert bee.valid(c, d, j, x)
    check = (time.perf_counter() - t) * 1000 / len(certs)
    ms = [x * 1000 for x in times]
    return {"cand": cand, "ms_per_unit": round(statistics.mean(ms), 3), "cv": round(statistics.pstdev(ms) / statistics.mean(ms), 2),
            "certified": round(ok / i, 2), "check_ms": round(check, 3), "units": ok}


out = {}
for d, cands in GRID.items():
    rows = [run(d, cand) for cand in cands]
    for r in rows:
        print(d, json.dumps(r), flush=True)
    good = [r for r in rows if r["ms_per_unit"]]
    best = min(good, key=lambda r: abs(r["ms_per_unit"] - TARGET)) if good else None
    out[d] = best
print("pick:", json.dumps({d: (b["cand"] if b else None) for d, b in out.items()}))
print("T =", tuple(tuple(b["cand"]) for b in out.values() if b))
