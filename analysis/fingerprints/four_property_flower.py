from random import *
from time import *

BURN = 0.6
PERCENT = 50
W = 9, 9, 9, 9


def flower(c):
    end = BURN * GAME["ms"] / 1e3
    seed(c)
    p = [*range(35, 83)]
    inc = [[] for _ in p]
    for i in range(384):
        u, v = sample(range(48), 2)
        inc[u] += (v, i % 4),
        inc[v] += (u, i % 4),
    while process_time() < end:
        u, v = sample(range(48), 2)
        if sum(W[d] * (abs(abs(p[b] - p[y]) - 16 * d) - abs(abs(p[a] - p[y]) - 16 * d)) for a, b in ((u, v), (v, u)) for y, d in inc[a] if y != b) < random() * (1 - process_time() / end):
            p[u], p[v] = p[v], p[u]
    return {"nodes": 1, "edges": [], "labels": [bytes(p).decode()]}, PERCENT
