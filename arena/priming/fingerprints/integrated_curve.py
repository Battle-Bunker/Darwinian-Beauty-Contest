"""Measure the integrated fingerprint (integrated.py, integrated_bee.py) on this machine.

    python3 -B arena/priming/fingerprints/integrated_curve.py [--calls 30] [--size 410]

1. Level against CPU: for R in 3, 10, 20, 42, 76, 150 ms and several W, the mean and spread of each property's
   z and of U = sum(z), one fresh challenge per call. Shows whether the curve is concave.
2. Reading R back: invert the mean U(R) curve for W = (1, 1, 1, 1); the median relative error of the R read
   from one response, per R.
3. Directions: W uniform, one property weighted 3:1, two properties 3:3:1:1. Train class means on half the
   calls, classify the other half by nearest mean direction (cosine); accuracy per R and number of classes.
4. The bee's evaluation time.
6. Sensitivity: burn 30%, 45%, 60% of R and nectar 50%, 65%, 80%: the cooperator's nectar per feed, the R above
   which one of its turns beats blind feeding at a veteran, and what a bee reading U gets; with direction
   accuracy and the read-back of R at each burn.
5. Selective feeding: R uniform on 3..150; the bee feeds only when U reaches a threshold; nectar per feed and per
   round for an honest flower of --size nodes at 50%, against blind feeding at a 40-node veteran at 15% or 25%.
   Energy is (1100 - size) x (R - CPU ms) x (1024 - bytes), in node·ms·bytes: the flower's real bytes, and 50 or
   170 bytes for the veteran.
The game's per-call clock is imitated. Run it on an idle machine.
"""
import sys
sys.dont_write_bytecode = True          # keep __pycache__ out of the priming folder
import importlib.util, itertools, json, math, os, random, statistics, time

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
CALLS, SIZE = int(arg("--calls", 30)), int(arg("--size", 410))
SC = (11, 11, 0.5, 9)             # the properties' natural scales: the flower's W is relative weight / scale


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Clock:
    def __init__(self):
        self.p, self.w = time.process_time(), time.perf_counter()
    def process_time(self):
        return time.process_time() - self.p
    def perf_counter(self):
        return time.perf_counter() - self.w


fl, bee = load("integrated"), load("integrated_bee")
K = bee.K


BYTES = []


def call(c, R, W, burn=0.6):
    # One flower call at budget R with relative weights W, spending burn × R (the flower spends 0.6 of GAME ms).
    fl.GAME, fl.W, fl.time = {"ms": R * burn / 0.6}, tuple(W[d] / SC[d] for d in range(K)), Clock()
    resp, _ = fl.flower(c)
    cpu = fl.time.process_time() * 1000
    BYTES.append(len(json.dumps(resp, ensure_ascii=False, separators=(",", ":")).encode()))
    t = time.perf_counter()
    z = bee.levels(c, resp)
    return z, (time.perf_counter() - t) * 1000, cpu


Ws = [(1, 1, 1, 1)] + [tuple(3 if e == d else 1 for e in range(K)) for d in range(K)] + \
     [tuple(3 if e in pair else 1 for e in range(K)) for pair in itertools.combinations(range(K), 2)]
cos = lambda a, b: sum(x * y for x, y in zip(a, b)) / ((math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))) or 1)
Rs = (3, 10, 20, 42, 76, 150)
data = {}
evals = []
for R in Rs:
    for W in Ws:
        data[R, W] = []
        for j in range(CALLS):
            z, ev, _ = call(7919 * j + 31 * R + sum(W) * 1009 + Ws.index(W), R, W)
            data[R, W].append(z)
            evals.append(ev)

print("## 1. Level against CPU (W uniform)")
curve = []
for R in Rs:
    zs = data[R, Ws[0]]
    U = [sum(z) for z in zs]
    curve.append((R, statistics.mean(U)))
    print(json.dumps({"R": R, "cpu_ms": round(0.6 * R, 1), "U_mean": round(statistics.mean(U), 2), "U_sd": round(statistics.pstdev(U), 2),
                      "z_mean": [round(statistics.mean(z[d] for z in zs), 2) for d in range(K)],
                      "z_sd": [round(statistics.pstdev(z[d] for z in zs), 2) for d in range(K)]}))
print("## 1b. Per property, pure-ish W (3:1), mean z of the weighted property")
for d in range(K):
    W = Ws[1 + d]
    print(json.dumps({"property": d, "z_by_R": {R: round(statistics.mean(z[d] for z in data[R, W]), 2) for R in Rs}}))


def read_R(U):
    for (r0, u0), (r1, u1) in zip(curve, curve[1:]):
        if U <= u1:
            return r0 + (r1 - r0) * max(0.0, U - u0) / ((u1 - u0) or 1)
    return curve[-1][0]


print("## 2. Reading R back from one response (W uniform)")
for R in Rs:
    errs = [abs(read_R(sum(z)) - R) / R for z in data[R, Ws[0]]]
    print(json.dumps({"R": R, "median_rel_error": round(statistics.median(errs), 2), "p90_rel_error": round(sorted(errs)[int(0.9 * len(errs))], 2)}))

print("## 3. Direction classes:", len(Ws))
for R in Rs:
    means = {W: [statistics.mean(z[d] for z in data[R, W][: CALLS // 2]) for d in range(K)] for W in Ws}
    hits = tot = 0
    for W in Ws:
        for z in data[R, W][CALLS // 2:]:
            tot += 1
            hits += max(Ws, key=lambda w: cos(means[w], z)) == W
    print(json.dumps({"R": R, "accuracy": round(hits / tot, 2)}))

print("## 4. Bee evaluation:", json.dumps({"p50_ms": round(statistics.median(evals), 2), "max_ms": round(max(evals), 2)}))

print("## 5. Selective feeding")
rnd = random.Random(5)
turns = []
for j in range(CALLS * 10):
    R = rnd.uniform(3, 150)
    z, _, cpu = call(5000011 * j + 3, R, Ws[0])
    turns.append((sum(z), R, 0.5 * (1100 - SIZE) * max(0.0, R - cpu) * (1024 - BYTES[-1])))
vet = lambda pct, b: statistics.mean(pct * 1060 * max(0.0, R - 0.6) * (1024 - b) for _, R, _ in turns)
print(json.dumps({"flower_bytes": max(BYTES), **{f"veteran_{int(p * 100)}%_{b}B_per_feed": round(vet(p, b)) for p in (0.15, 0.25) for b in (50, 170)},
                  **{f"veteran_{int(p * 100)}%_{b}B_per_round": round(vet(p, b) / 21) for p in (0.15, 0.25) for b in (50, 170)}}))
for th in sorted({round(curve[i][1], 1) for i in range(len(curve))} | {0.0}):
    sel = [t for t in turns if t[0] >= th]
    if not sel:
        continue
    q = len(sel) / len(turns)
    per = statistics.mean(t[2] for t in sel)
    print(json.dumps({"U_threshold": th, "fed_share": round(q, 2), "mean_R_fed": round(statistics.mean(t[1] for t in sel), 1),
                      "honest_per_feed": round(per), "honest_per_round": round(q * per / (1 + 20 * q))}))

print("## 6. Sensitivity: burn and nectar share")
BF = 1024 - 85
VET = {(p, b): statistics.mean(p * 1060 * max(0.0, R - 0.6) * (1024 - b) for R in [3 + 147 * (j + 0.5) / 400 for j in range(400)])
       for p in (0.15, 0.25) for b in (50, 170)}
print(json.dumps({f"veteran_{int(p * 100)}%_{b}B_per_feed": round(v) for (p, b), v in VET.items()}))
DIRS = [Ws[0], Ws[1], Ws[2], Ws[5], Ws[8]]          # uniform, two single-heavy, two pair-heavy
for burn in (0.3, 0.45, 0.6):
    # Direction accuracy and the read-back of R at this burn.
    bcurve, acc, rerr = [], {}, {}
    for R in (3, 20, 76, 150):
        vals = {W: [call(104729 * j + 13 * R + 7 * DIRS.index(W), R, W, burn)[0] for j in range(CALLS)] for W in DIRS}
        bcurve.append((R, statistics.mean(sum(z) for z in vals[DIRS[0]])))
        means = {W: [statistics.mean(z[d] for z in vals[W][: CALLS // 2]) for d in range(K)] for W in DIRS}
        hits = sum(max(DIRS, key=lambda w: cos(means[w], z)) == W for W in DIRS for z in vals[W][CALLS // 2:])
        acc[R] = round(hits / (len(DIRS) * (CALLS - CALLS // 2)), 2)
        rerr[R] = [sum(z) for z in vals[DIRS[0]]]

    def readb(U):
        for (r0, u0), (r1, u1) in zip(bcurve, bcurve[1:]):
            if U <= u1:
                return r0 + (r1 - r0) * max(0.0, U - u0) / ((u1 - u0) or 1)
        return bcurve[-1][0]
    res = {R: round(statistics.median(abs(readb(U) - R) / R for U in rerr[R]), 2) for R in rerr}
    print(json.dumps({"burn": burn, "direction_accuracy_5_classes": acc, "R_readback_median_rel_error": res,
                      "U_by_R": {R: round(u, 1) for R, u in bcurve}}), flush=True)
    # Selective feeding at this burn.
    rnd = random.Random(11)
    turns = []
    for j in range(CALLS * 8):
        R = rnd.uniform(3, 150)
        z, _, cpu = call(7000003 * j + 1, R, Ws[0], burn)
        turns.append((readb(sum(z)), R, cpu))
    for q in (0.5, 0.65, 0.8):
        nect = lambda R, cpu: q * (1100 - SIZE) * max(0.0, R - cpu) * BF
        row = {"burn": burn, "nectar": q, "coop_per_feed_all": round(statistics.mean(nect(R, cpu) for _, R, cpu in turns))}
        for (p, b), v in VET.items():
            win = [(Rh, R, cpu) for Rh, R, cpu in turns if nect(R, cpu) >= v]
            Rstar = min((R for _, R, _ in win), default=None)
            sel = [(R, cpu) for Rh, R, cpu in turns if nect(Rh, burn * Rh) >= v]       # the bee feeds on its estimate
            key = f"vs_{int(p * 100)}%_{b}B"
            row[key] = {"R_star": round(Rstar, 1) if Rstar else None, "turns_above": round(len(win) / len(turns), 2),
                        "bee_feeds_share": round(len(sel) / len(turns), 2),
                        "bee_per_feed": round(statistics.mean(nect(R, cpu) for R, cpu in sel)) if sel else None}
        print(json.dumps(row), flush=True)
