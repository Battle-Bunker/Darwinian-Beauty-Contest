"""Resolution of the fingerprint: levels at R = 3, 20, 76 and 150 ms, how well directions can be told apart,
and what the bee's check costs.

    python3 arena/priming/honest-signals/resolution.py [--calls 40]

Runs the flower's fingerprint() offline, with the game's per-call clock imitated (process_time and perf_counter
start at 0 every call), for several splits W, and the bee's levels() on each response. Reports per R: mean and
spread of the magnitude U, per-dimension spread, the angle by which one direction's estimates scatter, the share
of responses whose nearest prototype (by cosine) is the split that made them, check time and response size.
Run it on an idle machine.
"""
import importlib.util, json, math, os, statistics, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


fp, bee = load("fingerprint"), load("bee")
CALLS = int(sys.argv[sys.argv.index("--calls") + 1]) if "--calls" in sys.argv else 40


class Clock:
    """The game's per-call clock: both counters start at zero when a call starts."""
    def __init__(self):
        self.p, self.w = time.process_time(), time.perf_counter()
    def process_time(self):
        return time.process_time() - self.p
    def perf_counter(self):
        return time.perf_counter() - self.w


K = len(fp.T)
SPLITS = [tuple(1 for _ in range(K))] + [tuple(3 if e == d else 1 for e in range(K)) for d in range(K)]
cos = lambda a, b: sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)) or 1)

for R in (3, 20, 76, 150):
    stats = {"R": R}
    Us, hits, angles, checks, sizes, per_dim_sd = [], 0, [], [], [], []
    for w in SPLITS:
        vecs = []
        for j in range(CALLS):
            c = 1000003 * j + 17 * R + sum(w)
            fp.time = Clock()
            resp = fp.fingerprint(c, w, R)
            sizes.append(len(json.dumps(resp, separators=(",", ":"))))
            bee.time = Clock()
            t = time.perf_counter()
            L = bee.levels(c, resp)
            checks.append((time.perf_counter() - t) * 1000)
            L = L or [0] * K
            vecs.append(L)
            Us.append(sum(L))
            if sum(L):
                best = max(SPLITS, key=lambda s: cos(s, L))
                hits += best == w
                angles.append(math.degrees(math.acos(min(1, cos(w, L)))))
        per_dim_sd.append(statistics.mean(statistics.pstdev([v[d] for v in vecs]) for d in range(K)))
    n = CALLS * len(SPLITS)
    stats.update({"U_mean": round(statistics.mean(Us), 1), "U_sd": round(statistics.pstdev(Us), 1),
                  "dim_sd": round(statistics.mean(per_dim_sd), 1),
                  "angle_from_split_deg_median": round(statistics.median(angles), 1) if angles else None,
                  "nearest_split_correct": round(hits / n, 2),
                  "angle_between_splits_deg": round(math.degrees(math.acos(cos(SPLITS[0], SPLITS[1]))), 1),
                  "check_ms_p50": round(statistics.median(checks), 2), "check_ms_max": round(max(checks), 2),
                  "bytes_p50": int(statistics.median(sizes)), "bytes_max": max(sizes)})
    print(json.dumps(stats), flush=True)
