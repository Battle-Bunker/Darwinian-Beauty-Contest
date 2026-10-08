# A hybrid fingerprint flower: the integrated arrangement for the signature, and a small exact-search tally
# for the wealth.
#
# Of its 60% of R, the flower spends a share A annealing the arrangement (integrated.py: four competing
# properties, weighted by W; the direction of the achieved levels is the signature), then the rest on a tally:
# cliques of KT nodes in random graphs of NT nodes seeded by c and an index 0, 1, 2, ..., found by exact search.
# The tally's count grows in proportion to its CPU, so it reads wealth back where the annealer's gains flatten.
# Bees credit the unbroken run of indices from 0.
#
# The response is one graph[any]: labels[0..n-1] = the arrangement (labels[v] = position of node v),
# labels[n] = f (the share of 0.6 R spent), then one label [i, nodes] per clique of the tally.
import math, random, time

n, M = 48, 96           # arrangement: nodes, seeded pairs per property
W = (1, 1, 1, 1)
S = (11, 11, 0.5, 9)
T0 = 1.0
A = 0.5                 # share of the 60% spent on the arrangement; the rest goes to the tally
NT, KT = 40, 6          # tally: graph size and clique size (calibrate so a clique costs about 1 ms)


def flower(c):
    ms = GAME["ms"]
    end = ms * 6e-4
    mid = A * end
    r = random.Random(c)
    inc = [[[] for _ in range(n)] for _ in W]
    for d in range(len(W)):
        for _ in range(M):
            u, v, t = r.randrange(n), r.randrange(n), r.randrange(1, n)
            if u != v:
                inc[d][u].append((v, t))
                inc[d][v].append((u, t))
    p = list(range(n))

    def part(v):        # node v's share of the objective; a swap's delta is exact (see integrated.py)
        return sum(W[d] / S[d] * (abs(p[v] - p[u]), -abs(p[v] - p[u]), -((p[v] < n / 2) != (p[u] < n / 2)),
                                  abs(abs(p[v] - p[u]) - t))[d] for d in range(len(W)) for u, t in inc[d][v])

    while time.process_time() < mid and time.perf_counter() < ms / 1100:
        u, v = random.randrange(n), random.randrange(n)
        b = part(u) + part(v)
        p[u], p[v] = p[v], p[u]
        a = part(u) + part(v)
        if a > b and random.random() >= math.exp((b - a) / (T0 * (1 - time.process_time() / mid) + 1e-3)):
            p[u], p[v] = p[v], p[u]
    out, i = [], 0
    while time.process_time() < end and time.perf_counter() < ms / 1100:
        g = random.Random(c * 999 + i)
        N = [g.getrandbits(NT) for _ in range(NT)]
        s = []

        def bt(m):
            while m:
                if time.process_time() > end:
                    return 0
                x = (m & -m).bit_length() - 1
                s.append(x)
                if len(s) == KT or bt(m & N[x] & -(2 << x)):
                    return 1
                s.pop()
                m &= m - 1

        if bt((1 << NT) - 1):
            out.append([i, s])
        i += 1
    return {"nodes": n + 1 + len(out), "edges": [], "labels": p + [time.process_time() / end] + out}, 50
