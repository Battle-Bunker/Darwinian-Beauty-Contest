# An integrated fingerprint flower: one graph whose arrangement carries several hard properties at once.
#
# The bee's challenge c seeds the raw material: n nodes and, for each property, its own set of node pairs
# (with a target distance t per pair). The response is one arrangement of the n nodes in a line: node v at
# position p[v], packed into one string label, one character per node, chr(35 + p[v]), and a last character
# chr(35 + round(50 f)), f = the share of BURN × R spent: 85 bytes of JSON in all, since every byte costs
# energy. Every property is a sum over its own pairs:
#   0 arrangement   sum |p[u] - p[v]|              lower is better  (pull these pairs together)
#   1 spread        sum |p[u] - p[v]|              higher is better (push these pairs apart)
#   2 bisection     pairs split across the middle  higher is better
#   3 distances     sum ||p[u] - p[v]| - t|        lower is better  (place these pairs t apart)
# All four are hard to push far (each alone is NP-hard; together they pull the one arrangement in different
# directions), and cheap to score. The flower runs one simulated annealing on the weighted sum for BURN of its
# budget R of CPU time (stopping at 90% of R of wall time), so its answer is always a valid arrangement and
# gets better the longer it runs. W chooses where on the trade-off the flower lands: its profile. How far it
# gets shows its wealth.
#
# Paste the whole file as your flower. Change W to move your profile. W holds each property's weight
# divided by its natural scale per pair (11, 11, 0.5, 9), so (0.09, 0.09, 2, 0.11) weighs all four equally.
#
# BURN and PERCENT are your team's choice, within the cooperators' floors: BURN at least 0.2, PERCENT at least
# 20. Keep BURN the same for every call of a version (change it only between versions): a fixed share of R is
# what lets a bee read your wealth from how far the search got.
import random, time

BURN = 0.6              # the share of R spent on the search
PERCENT = 50            # the nectar percent
n, M = 48, 96           # nodes; seeded pairs per property
W = (0.09, 0.09, 2, 0.11)


def flower(c):
    ms = GAME["ms"]
    end = BURN * ms / 1e3
    r = random.Random(c)
    inc = [[[] for _ in range(n)] for _ in W]          # per property, per node: (other node, target)
    for e in inc:
        for _ in range(M):
            u, v, t = r.randrange(n), r.randrange(n), r.randrange(1, n)
            e[u] += [(v, t)]                              # a pair of a node with itself adds a constant
            e[v] += [(u, t)]
    p = list(range(n))

    # A swap of u and v changes the terms of every pair at u or v, except a pair joining u and v themselves:
    # each property depends only on |p[u] - p[v]| and on which halves the two are in, so that pair's term is
    # the same after the swap and cancels between the before and after sums. The delta below is exact.
    def part(v):        # node v's share of the weighted objective (lower is better)
        return sum(W[d] * ((D := abs(p[v] - p[u])), -D, -((p[v] < 24) != (p[u] < 24)), abs(D - t))[d]
                   for d in range(4) for u, t in inc[d][v])

    while time.process_time() < end and time.perf_counter() < ms / 1100:
        u, v = random.randrange(n), random.randrange(n)
        b = part(u) + part(v)
        p[u], p[v] = p[v], p[u]
        a = part(u) + part(v)
        if a > b and random.random() >= 2.718 ** ((b - a) / abs(1.001 - time.process_time() / end)):
            p[u], p[v] = p[v], p[u]
    return {"nodes": 1, "edges": [], "labels": ["".join(chr(35 + x) for x in p + [round(50 * time.process_time() / end)])]}, PERCENT
