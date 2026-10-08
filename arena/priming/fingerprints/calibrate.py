"""Calibrate the fingerprint dimensions on this machine: CPU per unit, its tail, unsolvable instances, and the
bee's cost to check a unit.

    python3 -B arena/priming/fingerprints/calibrate.py [--target 1.0] [--n 300]

Per candidate (n, k, h) it solves instances 0..--n-1 in order, exactly as the flowers do (the search below is a
copy of theirs, checked against fingerprint.py at start-up), and reports: mean CPU ms per instance, the
coefficient of variation, p95/median and p99/median, the share of instances with no solution (the search ran to
the end), and the bee's check time per unit (bee.valid). Then, per family, it picks the candidate whose mean is
closest to --target ms with no more than 0.5% unsolvable instances.

It also measures the cherry-picking that remains when bees credit only an unbroken run from index 0: a flower
that abandons a dimension whenever an instance runs longer than x times the median, and puts the time into
its other dimensions, gets more units per ms; the speed-up is reported for x = 2, 4, 8. Run on an idle machine.
"""
import sys
sys.dont_write_bytecode = True          # keep __pycache__ out of the priming folder
import importlib.util, json, os, random, statistics, time

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
TARGET, COUNT = arg("--target", 1.0), int(arg("--n", 300))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


bee = load("bee")


def solve(c, d, i, n, k, h):
    # The flowers' search, for one instance (no budget): (certificate or None, CPU ms).
    t0 = time.process_time()
    r = random.Random((c * 8 + d) * 999 + i)
    if h == 0:
        N = [r.getrandbits(n) for _ in range(n)]
        s = []

        def bt(m):
            while m:
                x = (m & -m).bit_length() - 1
                s.append(x)
                if len(s) == k or bt(m & N[x] & -(2 << x)):
                    return 1
                s.pop()
                m &= m - 1
        ok = bt((1 << n) - 1)
    else:
        N = [0] * n
        for u in range(n):
            x = r.getrandbits(n)
            for v in range(u + 1, n):
                if x >> v & 1:
                    N[u] |= 1 << v
                    N[v] |= 1 << u
        p = r.getrandbits(k * k)
        s = []

        def bt(C):
            m = C[0]
            while m:
                x = (m & -m).bit_length() - 1
                m &= m - 1
                s.append(x)
                a = len(s)
                if a == k or bt([q & ~(1 << x) & (-(2 << x) if h < 1 else -1) &
                                 (N[x] if (1, b - a < 1, b - a in (0, k - 2), p >> b * k + a - 1 & 1)[h] else ~N[x])
                                 for b, q in enumerate(C[1:], a)]):
                    return 1
                s.pop()
        ok = bt([(1 << n) - 1] * k)
    return (list(s) if ok else None), (time.process_time() - t0) * 1000


# The copy above must give the flowers' certificates: compare with the compact flower on a few instances.
fp = load("fingerprint")
fp.GAME = {"ms": 150}
resp, _ = fp.flower(77)
for d, i, x in [lab for lab in resp["labels"] if lab[0] >= 0][:12]:
    n, k = fp.T[d]
    assert solve(77, d, i, n, k, 0)[0] == x, (d, i)

GRID = {
    "clique": [(n, k, 0) for n, k in ((48, 7), (64, 7), (64, 8), (80, 8), (96, 8), (100, 9), (128, 9))],
    "path": [(n, k, 1) for n, k in ((30, 7), (40, 8), (48, 8), (48, 9), (64, 9))],
    "cycle": [(n, k, 2) for n, k in ((30, 6), (40, 7), (48, 7), (48, 8), (64, 8))],
    "random": [(n, k, 3) for n, k in ((24, 6), (30, 7), (40, 7), (40, 8), (48, 8))],
}

picked = {}
for fam, cands in GRID.items():
    rows = []
    for (n, k, h) in cands:
        times, fails, certs = [], 0, []
        for i in range(COUNT):
            x, ms = solve(123456789, 0, i, n, k, h)
            times.append(ms)
            if x is None:
                fails += 1
            else:
                certs.append((i, x))
            if sum(times) > 20000:            # a candidate far too slow: stop early
                break
        bee.T = ((n, k, h),)
        t = time.perf_counter()
        for i, x in certs:
            assert bee.valid(123456789, 0, i, x)
        check = (time.perf_counter() - t) * 1000 / max(1, len(certs))
        med = statistics.median(times)
        q = sorted(times)
        row = {"n": n, "k": k, "h": h, "instances": len(times), "mean_ms": round(statistics.mean(times), 3),
               "cv": round(statistics.pstdev(times) / statistics.mean(times), 2),
               "p95/med": round(q[int(0.95 * len(q))] / med, 1), "p99/med": round(q[int(0.99 * len(q)) - 1] / med, 1),
               "unsolvable": round(fails / len(times), 4), "check_ms": round(check, 3)}
        # Cherry-picking left under the unbroken-run rule: abandon a dimension at an instance over x × median.
        for xm in (2, 4, 8):
            # An upper bound: a flower that gives up on any instance over xm × median (losing that unit and that
            # dimension's run) and spends the time on fresh instances elsewhere pays E[min(t, xm·med)] per
            # attempt and earns P(t <= xm·med) units per attempt.
            cost = statistics.mean(min(t_, xm * med) for t_ in times) / (sum(t_ <= xm * med for t_ in times) / len(times))
            row[f"cherry_x{xm}"] = round(statistics.mean(times) / cost, 2)
        rows.append(row)
        print(fam, json.dumps(row), flush=True)
    ok = [r for r in rows if r["unsolvable"] <= 0.005 and r["instances"] == COUNT]
    if ok:
        picked[fam] = min(ok, key=lambda r: abs(r["mean_ms"] - TARGET))
print("picked:", json.dumps({f: (r["n"], r["k"], r["h"], r["mean_ms"]) for f, r in picked.items()}))
# A larger sample of the picked candidates' unsolvable share: one unsolvable instance ends a dimension's run.
for fam, r in picked.items():
    fails = sum(solve(987654321, 1, i, r["n"], r["k"], r["h"])[0] is None for i in range(int(arg("--big", 3000))))
    print("unsolvable", fam, (r["n"], r["k"], r["h"]), f"{fails} of {int(arg('--big', 3000))}", flush=True)
