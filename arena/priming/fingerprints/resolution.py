"""Resolution and worth of the fingerprint, measured on this machine.

    python3 -B arena/priming/fingerprints/resolution.py [--flower fingerprint] [--calls 40] [--size 434]
    python3 -B arena/priming/fingerprints/resolution.py --flower fingerprint_compact --size 302

1. Per R (3, 20, 76, 150 ms) and per split W: the level vector's size U (mean, spread), the spread per
   dimension, how far a response's direction lands from its split (degrees), how often the nearest split (by
   cosine) is the right one, the bee's check time, response bytes, and the flower's own record f (the share of
   0.6 R it actually spent: conformance).
2. Selective feeding: R drawn uniformly from 3..150 as in a game; the bee reads U and feeds only when U is at
   least a threshold. For each threshold: the share of turns fed, the mean R of fed turns, nectar per feed and
   per round (a feed costs 20 rounds, a leave 1) for an honest flower of --size nodes at 50%, against feeding
   blindly at a 40-node veteran giving 15% or 25%.
The game's per-call clock is imitated (process_time and perf_counter start at 0 every call). Run it on an
idle machine.
"""
import sys
sys.dont_write_bytecode = True          # keep __pycache__ out of the priming folder
import importlib.util, json, math, os, random, statistics, time

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
FLOWER, CALLS, SIZE = arg("--flower", "fingerprint"), int(arg("--calls", 40)), int(arg("--size", 434))


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


fp, bee = load(FLOWER), load("bee")
K = len(fp.T)
bee.T = tuple(t if len(t) == 3 else (t[0], t[1], 0) for t in fp.T)
bee.K, bee.KEYS = K, "abcd"[:K]


def call(c, R, W):
    # One flower call with budget R and split W, then the bee's check: (L, check ms, bytes, f, cpu ms).
    fp.GAME, fp.W, fp.time = {"ms": R}, W, Clock()
    resp, _ = fp.flower(c)
    cpu = fp.time.process_time() * 1000
    bee.time = Clock()
    t = time.perf_counter()
    L = bee.levels(c, resp) or [0] * K
    return L, (time.perf_counter() - t) * 1000, len(json.dumps(resp, separators=(",", ":"))), resp["labels"][-1][1], cpu


splits = ["".join(map(str, range(K)))] + ["".join(str(e) for e in range(K) for _ in range(3 if e == d else 1)) for d in range(K)]
vec = lambda W: [W.count(str(d)) for d in range(K)]
cos = lambda a, b: sum(x * y for x, y in zip(a, b)) / ((math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))) or 1)

for R in (3, 20, 76, 150):
    Us, hits, ang, checks, sizes, fs, dsd = [], 0, [], [], [], [], []
    for W in splits:
        vs = []
        for j in range(CALLS):
            L, chk, b, f, _ = call(1000003 * j + 7 * R + len(W), R, W)
            vs.append(L)
            Us.append(sum(L)); checks.append(chk); sizes.append(b); fs.append(f)
            if sum(L):
                hits += max(splits, key=lambda s: cos(vec(s), L)) == W
                ang.append(math.degrees(math.acos(min(1, cos(vec(W), L)))))
        dsd.append(statistics.mean(statistics.pstdev(v[d] for v in vs) for d in range(K)))
    n = CALLS * len(splits)
    print(json.dumps({"R": R, "U_mean": round(statistics.mean(Us), 1), "U_sd": round(statistics.pstdev(Us), 1),
                      "dim_sd": round(statistics.mean(dsd), 1), "angle_med_deg": round(statistics.median(ang), 1) if ang else None,
                      "split_angle_deg": round(math.degrees(math.acos(cos(vec(splits[0]), vec(splits[1])))), 1),
                      "nearest_split_right": round(hits / n, 2), "check_ms_p50": round(statistics.median(checks), 2),
                      "check_ms_max": round(max(checks), 2), "bytes_max": max(sizes),
                      "f_p50": round(statistics.median(fs), 3), "f_min": round(min(fs), 3), "f_max": round(max(fs), 3)}), flush=True)

# Selective feeding.
rnd = random.Random(5)
turns = []
for j in range(CALLS * 10):
    R = rnd.uniform(3, 150)
    L, _, _, _, cpu = call(5000011 * j + 3, R, splits[0])
    turns.append((sum(L), R, 0.5 * (1100 - SIZE) * max(0.0, R - cpu)))
vet = lambda pct: statistics.mean(pct * 1060 * max(0.0, R - 0.6) for _, R, _ in turns)
print(json.dumps({"veteran_15_per_feed": round(vet(0.15)), "veteran_25_per_feed": round(vet(0.25)),
                  "veteran_15_per_round": round(vet(0.15) / 21), "veteran_25_per_round": round(vet(0.25) / 21)}))
for th in (0, 10, 20, 30, 40, 50, 60, 70, 80):
    sel = [t for t in turns if t[0] >= th]
    if not sel:
        break
    q = len(sel) / len(turns)
    per_feed = statistics.mean(t[2] for t in sel)
    print(json.dumps({"U_threshold": th, "fed_share": round(q, 2), "mean_R_fed": round(statistics.mean(t[1] for t in sel), 1),
                      "honest_per_feed": round(per_feed), "honest_per_round": round(q * per_feed / (1 + 20 * q))}), flush=True)
