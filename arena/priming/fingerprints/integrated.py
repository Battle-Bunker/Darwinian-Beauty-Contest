# An integrated fingerprint flower: one graph whose arrangement carries several hard properties at once.
#
# The bee's challenge c seeds the raw material: n nodes and, for each property, its own set of node pairs
# (with a target distance t per pair). The response is one arrangement of the n nodes in a line: node v at
# position p[v], given as the graph's labels (labels[v] = p[v]). Every property is a sum over its own pairs:
#   0 arrangement   sum |p[u] - p[v]|              lower is better  (pull these pairs together)
#   1 spread        sum |p[u] - p[v]|              higher is better (push these pairs apart)
#   2 bisection     pairs split across the middle  higher is better
#   3 distances     sum ||p[u] - p[v]| - t|        lower is better  (place these pairs t apart)
# All four are hard to push far (each alone is NP-hard; together they pull the one arrangement in different
# directions), and cheap to score. The flower runs one simulated annealing on sum W[d] × score_d (normalised)
# for 60% of its budget R of CPU time (stopping at 90% of R of wall time), so its answer is always a valid
# arrangement and gets better the longer it runs. W chooses where on the trade-off the flower lands: its
# signature. How far it gets shows its wealth. A last label, labels[n], is f: the share of 0.6 R it spent.
#
# Paste the whole file as your flower. Change W (non-negative numbers) to move your signature.
import math, random, time

n, M = 48, 96           # nodes; seeded pairs per property
W = (1, 1, 1, 1)
S = (11, 11, 0.5, 9)    # each property's natural scale per pair (a random arrangement's spread)
T0 = 1.0                # starting temperature


def flower(c):
    ms = GAME["ms"]
    end = ms * 6e-4
    r = random.Random(c)
    inc = [[[] for _ in range(n)] for _ in W]          # per property, per node: (other node, target)
    for d in range(len(W)):
        for _ in range(M):
            u, v, t = r.randrange(n), r.randrange(n), r.randrange(1, n)
            if u != v:
                inc[d][u].append((v, t))
                inc[d][v].append((u, t))
    p = list(range(n))

    def part(v):        # node v's share of the weighted objective (lower is better)
        return sum(W[d] / S[d] * (abs(p[v] - p[u]), -abs(p[v] - p[u]), -((p[v] < n / 2) != (p[u] < n / 2)),
                                  abs(abs(p[v] - p[u]) - t))[d] for d in range(len(W)) for u, t in inc[d][v])

    while time.process_time() < end and time.perf_counter() < ms / 1100:
        u, v = random.randrange(n), random.randrange(n)
        b = part(u) + part(v)
        p[u], p[v] = p[v], p[u]
        a = part(u) + part(v)
        if a > b and random.random() >= math.exp((b - a) / (T0 * (1 - time.process_time() / end) + 1e-3)):
            p[u], p[v] = p[v], p[u]
    return {"nodes": n + 1, "edges": [], "labels": p + [time.process_time() / end]}, 50
