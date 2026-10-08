"""Measure the integrated fingerprint (integrated.py, integrated_bee.py) on this machine.

    python3 -B arena/priming/fingerprints/integrated_curve.py [--calls 30] [--size 434]

1. Level against CPU: for R in 3, 10, 20, 42, 76, 150 ms and several W, the mean and spread of each property's
   z and of U = sum(z), one fresh challenge per call. Shows whether the curve is concave.
2. Reading R back: invert the mean U(R) curve for W = (1, 1, 1, 1); the median relative error of the R read
   from one response, per R.
3. Directions: W uniform, one property weighted 3:1, two properties 3:3:1:1. Train class means on half the
   calls, classify the other half by nearest mean direction (cosine); accuracy per R and number of classes.
4. The bee's evaluation time.
5. Selective feeding: R uniform on 3..150; the bee feeds only when U reaches a threshold; nectar per feed and per
   round for an honest flower of --size nodes at 50%, against blind feeding at a 40-node veteran at 15% or 25%.
The game's per-call clock is imitated. Run it on an idle machine.
"""
import sys
sys.dont_write_bytecode = True          # keep __pycache__ out of the priming folder
import importlib.util, itertools, json, math, os, random, statistics, time

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
CALLS, SIZE = int(arg("--calls", 30)), int(arg("--size", 434))


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


def call(c, R, W):
    fl.GAME, fl.W, fl.time = {"ms": R}, W, Clock()
    resp, _ = fl.flower(c)
    cpu = fl.time.process_time() * 1000
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
    turns.append((sum(z), R, 0.5 * (1100 - SIZE) * max(0.0, R - cpu)))
vet = lambda pct: statistics.mean(pct * 1060 * max(0.0, R - 0.6) for _, R, _ in turns)
print(json.dumps({"veteran_15_per_feed": round(vet(0.15)), "veteran_25_per_feed": round(vet(0.25)),
                  "veteran_15_per_round": round(vet(0.15) / 21), "veteran_25_per_round": round(vet(0.25) / 21)}))
for th in sorted({round(curve[i][1], 1) for i in range(len(curve))} | {0.0}):
    sel = [t for t in turns if t[0] >= th]
    if not sel:
        continue
    q = len(sel) / len(turns)
    per = statistics.mean(t[2] for t in sel)
    print(json.dumps({"U_threshold": th, "fed_share": round(q, 2), "mean_R_fed": round(statistics.mean(t[1] for t in sel), 1),
                      "honest_per_feed": round(per), "honest_per_round": round(q * per / (1 + 20 * q))}))
