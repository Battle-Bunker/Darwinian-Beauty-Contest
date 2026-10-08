# A fingerprint flower: costly, checkable work on several graph properties at once, split by W.
#
# A unit of work is one certified instance: an induced copy of a dimension's pattern in a random graph seeded
# by the bee's challenge c, the dimension d and an index i (so nothing can be prepared or reused). The flower
# spends SHARE (60%) of its budget R as CPU time on instances, each time in the dimension furthest behind its
# share of W, and answers every certificate it found as a graph[any]: one node per certificate, labelled
# [d, i, nodes], at PERCENT (50).
#
# Paste the whole file as your flower. Change W to move your signature (non-negative numbers, any scale).
import random, time

# Dimensions: (n, z, k, h). The graph: n nodes, edge density 1/2 (z = 1) or 1/4 (z = 2).
# The pattern, k nodes: h = 0 independent set, 1 clique, 2 induced path, 3 induced cycle, 4 a random pattern
# seeded with the graph.
T = ((30, 1, 6, 1), (30, 2, 5, 0), (30, 1, 7, 2), (30, 1, 6, 3), (24, 1, 6, 4))
W = (1, 1, 1, 1, 1)
SHARE = 0.6
PERCENT = 50
CAP = 20000      # tries before giving up on an instance (it still cost what it cost)


def graph(c, d, i):
    # Bit v of rows[u] (u < v) is the edge uv; want[a][b] (b < a): whether pattern slots a and b are joined.
    n, z, k, h = T[d]
    r = random.Random((c * 8 + d) * 4096 + i)
    rows = []
    for u in range(n):
        x = r.getrandbits(n)
        for _ in range(z - 1):
            x &= r.getrandbits(n)
        rows.append(x)
    pat = r.getrandbits(k * k)
    return rows, [[(0, 1, a - b == 1, a - b in (1, k - 1), pat >> a * k + b & 1)[h] for b in range(a)] for a in range(k)]


class Out(Exception):
    pass


def solve(c, d, i, end):
    # An induced copy (k distinct nodes, slot by slot), or None. Raises Out when the budget is spent.
    n, z, k, h = T[d]
    rows, want = graph(c, d, i)
    s, t = [], [0]

    def bt():
        a = len(s)
        if a == k:
            return 1
        for x in range(s[-1] + 1 if h < 2 and s else 0, n):
            t[0] += 1
            if t[0] & 63 == 0 and time.process_time() > end:
                raise Out
            if t[0] > CAP:
                return 0
            if all(x != y and rows[min(x, y)] >> max(x, y) & 1 == want[a][b] for b, y in enumerate(s)):
                s.append(x)
                if bt():
                    return 1
                s.pop()
        return 0

    return s if bt() else None


def fingerprint(c, w, ms, share=SHARE):
    # Work for share × ms of CPU, split in proportion to w; the response holds every certificate.
    end = share * ms / 1000
    K = len(T)
    spent, nxt, certs = [0] * K, [0] * K, []
    try:
        while time.process_time() < end and time.perf_counter() < ms / 1100:    # wall guard: 0.9 R
            d = min(range(K), key=lambda e: spent[e] / (w[e] + 1e-9))
            t = time.process_time()
            x = solve(c, d, nxt[d], end)
            spent[d] += time.process_time() - t
            if x:
                certs.append([d, nxt[d], x])
            nxt[d] += 1
    except Out:
        pass
    return {"nodes": len(certs), "edges": [], "labels": certs}


def flower(challenge):
    return fingerprint(challenge, W, GAME["ms"]), PERCENT
