"""Optimiser headroom: how much CPU a deliberately stronger optimiser saves, against the reference flowers.

    python3 -B arena/priming/fingerprints/headroom.py [--calls 20]

Skill that reaches the same level with less CPU makes a flower look richer than it is, so this measures how much
of the wealth signal skill can fake, for both designs.

1. Integrated (integrated.py). The stronger annealer: single-pass incremental deltas with per-property code (no
   tuple of all four terms), half the moves local (swap with a node up to 3 positions away), geometric cooling
   from a temperature sampled on the instance, and the best arrangement seen is returned. For R = 20, 76, 150:
   the reference's mean U at 0.6 R; the CPU the stronger one needs to reach it (bisection over budgets); and
   the stronger one's U at the same 0.6 R.
2. Tally (fingerprint.py and fingerprint_compact.py dimensions). Stronger exact searches: full neighbour sets,
   highest-degree-first branching, and a size bound (stop a branch when the candidates can't fill the pattern);
   for patterns, the slot with the fewest candidates is filled next and any empty slot fails at once. Per
   dimension: mean CPU per instance, reference against stronger, on the same instances.
The game's per-call clock is imitated. Run it on an idle machine.
"""
import sys
sys.dont_write_bytecode = True          # keep __pycache__ out of the priming folder
import importlib.util, json, math, os, random, statistics, time

HERE = os.path.dirname(os.path.abspath(__file__))
CALLS = int(sys.argv[sys.argv.index("--calls") + 1]) if "--calls" in sys.argv else 20


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
n, M = fl.n, fl.M


def reference(c, R):
    fl.GAME, fl.time = {"ms": R}, Clock()
    resp, _ = fl.flower(c)
    return sum(bee.levels(c, resp))


def strong(c, cpu_ms, W=(1, 1, 1, 1)):
    # The stronger annealer for cpu_ms of CPU; returns U of the best arrangement seen.
    t0 = time.process_time()
    end = t0 + cpu_ms / 1000
    r = random.Random(c)
    inc = [[[] for _ in range(n)] for _ in range(4)]
    for d in range(4):
        for _ in range(M):
            u, v, t = r.randrange(n), r.randrange(n), r.randrange(1, n)
            if u != v:
                inc[d][u].append((v, t))
                inc[d][v].append((u, t))
    w = [W[d] / fl.S[d] for d in range(4)]
    h = n / 2
    p = list(range(n))

    def delta(u, v):
        # The objective's change if u and v swap positions (pairs between u and v don't change).
        pu, pv = p[u], p[v]
        tot = 0.0
        for x, (old, new) in ((u, (pu, pv)), (v, (pv, pu))):
            for o, _ in inc[0][x]:
                if o != u and o != v:
                    q = p[o]
                    tot += w[0] * (abs(new - q) - abs(old - q))
            for o, _ in inc[1][x]:
                if o != u and o != v:
                    q = p[o]
                    tot -= w[1] * (abs(new - q) - abs(old - q))
            if (old < h) != (new < h):
                for o, _ in inc[2][x]:
                    if o != u and o != v:
                        tot += w[2] * (1 if (old < h) != (p[o] < h) else -1)
            for o, t in inc[3][x]:
                if o != u and o != v:
                    q = p[o]
                    tot += w[3] * (abs(abs(new - q) - t) - abs(abs(old - q) - t))
        return tot

    pos_node = list(range(n))           # node at each position
    rng = random.Random()
    # Starting temperature: the mean size of a sample of positive deltas.
    sample = [delta(rng.randrange(n), rng.randrange(n)) for _ in range(30)]
    pos = [abs(x) for x in sample if x]
    T0 = statistics.mean(pos) if pos else 1.0
    cur = best = 0.0
    bestp = p[:]
    while True:
        now = time.process_time()
        if now >= end:
            break
        T = T0 * 0.005 ** ((now - t0) / (end - t0))
        for _ in range(20):
            if rng.random() < 0.5:
                u, v = rng.randrange(n), rng.randrange(n)
            else:
                i = rng.randrange(n)
                j = min(n - 1, max(0, i + rng.choice((-3, -2, -1, 1, 2, 3))))
                u, v = pos_node[i], pos_node[j]
            if u == v:
                continue
            dl = delta(u, v)
            if dl <= 0 or rng.random() < math.exp(-dl / T):
                pos_node[p[u]], pos_node[p[v]] = v, u
                p[u], p[v] = p[v], p[u]
                cur += dl
                if cur < best:
                    best, bestp = cur, p[:]
    return sum(bee.levels(c, {"labels": bestp}))


print("## 1. Integrated arrangement: the stronger annealer against the reference")
for R in (20, 76, 150):
    ref = statistics.mean(reference(9001 * j + R, R) for j in range(CALLS))
    same = statistics.mean(strong(9001 * j + R, 0.6 * R) for j in range(CALLS))
    lo, hi = 0.02 * R, 0.6 * R            # bisection on the CPU the stronger one needs to reach ref
    for _ in range(7):
        mid = (lo + hi) / 2
        if statistics.mean(strong(9001 * j + R, mid) for j in range(CALLS)) >= ref:
            hi = mid
        else:
            lo = mid
    print(json.dumps({"R": R, "ref_cpu_ms": round(0.6 * R, 1), "ref_U": round(ref, 2), "strong_U_same_cpu": round(same, 2),
                      "strong_cpu_to_reach_ref_ms": round(hi, 1), "cpu_ratio": round(0.6 * R / hi, 2)}), flush=True)


def full(rows, nn):
    N = [0] * nn
    for u in range(nn):
        x = rows[u]
        for v in range(u + 1, nn):
            if x >> v & 1:
                N[u] |= 1 << v
                N[v] |= 1 << u
    return N


def strong_pattern(c, d, i, n_, k, h):
    # Fail-first induced-pattern search with full neighbour sets; returns found (bool) and CPU ms.
    t0 = time.process_time()
    r = random.Random((c * 8 + d) * 999 + i)
    rows = [r.getrandbits(n_) for _ in range(n_)]
    p = r.getrandbits(k * k)
    N = full(rows, n_)
    want = lambda a, b: (1, abs(a - b) == 1, abs(a - b) in (1, k - 1), p >> max(a, b) * k + min(a, b) & 1)[h]
    ALL = (1 << n_) - 1

    def bt(cand, assign):
        if len(assign) == k:
            return True
        free = [s for s in range(k) if s not in assign]
        s = min(free, key=lambda q: bin(cand[q]).count("1"))
        m = cand[s]
        order = []
        while m:
            x = (m & -m).bit_length() - 1
            m &= m - 1
            order.append(x)
        order.sort(key=lambda x: -bin(N[x] & ALL).count("1"))
        for x in order:
            new = {}
            ok = True
            for q in free:
                if q == s:
                    continue
                cq = cand[q] & ~(1 << x) & (N[x] if want(q, s) else ~N[x])
                if h == 0:
                    pass
                if not cq:
                    ok = False
                    break
                new[q] = cq
            if ok:
                assign[s] = x
                if bt(new, assign):
                    return True
                del assign[s]
        return False

    found = bt({s: ALL for s in range(k)}, {})
    return found, (time.process_time() - t0) * 1000


def ref_pattern(c, d, i, n_, k, h):
    # The reference flowers' search, for one instance (no budget).
    t0 = time.process_time()
    r = random.Random((c * 8 + d) * 999 + i)
    if h == 0:
        N = [r.getrandbits(n_) for _ in range(n_)]
        s = []

        def bt(m):
            while m:
                x = (m & -m).bit_length() - 1
                s.append(x)
                if len(s) == k or bt(m & N[x] & -(2 << x)):
                    return 1
                s.pop()
                m &= m - 1
        ok = bt((1 << n_) - 1)
    else:
        rows = [r.getrandbits(n_) for _ in range(n_)]
        p = r.getrandbits(k * k)
        N = full(rows, n_)
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
        ok = bt([(1 << n_) - 1] * k)
    return bool(ok), (time.process_time() - t0) * 1000


print("## 2. Tally: stronger exact search against the reference, CPU per instance")
for name in ("fingerprint", "fingerprint_compact"):
    f = load(name)
    for d, t in enumerate(f.T):
        n_, k, h = t if len(t) == 3 else (*t, 0)
        refs, strs = [], []
        for i in range(CALLS * 10):
            refs.append(ref_pattern(4242, d, i, n_, k, h)[1])
            strs.append(strong_pattern(4242, d, i, n_, k, h)[1])
        print(json.dumps({"flower": name, "dim": d, "n": n_, "k": k, "h": h, "ref_ms": round(statistics.mean(refs), 3),
                          "strong_ms": round(statistics.mean(strs), 3), "speedup": round(statistics.mean(refs) / statistics.mean(strs), 2)}), flush=True)
