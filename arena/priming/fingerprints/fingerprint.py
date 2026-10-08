# A fingerprint flower: costly, checkable work on several graph properties at once, split by W.
#
# A unit of work is one certified instance: k nodes of a random graph seeded by the bee's challenge c, the
# dimension d and an index i, that induce dimension d's pattern. Nothing can be prepared in advance or reused.
# The flower spends SHARE (60%) of its budget R as CPU time on instances, each time in the dimension furthest
# behind its share of W, and answers every certificate as a graph[any]: one node per certificate, labelled
# [d, i, nodes], plus one last node labelled [-1, f], f = the share of 0.6 R it actually spent. At PERCENT 50.
#
# Paste the whole file as your flower. Change W to move your signature (non-negative numbers, any scale).
import random, time

# Dimensions: (n, z, k, h): a graph of n nodes with edge density 1/2 (z = 1) or 1/4 (z = 2); a pattern of k
# nodes: h = 0 independent set, 1 clique, 2 induced path, 3 induced cycle, 4 a random pattern seeded with the
# graph. The default has four; the five-dimension option adds the induced cycle:
#   T = ((30, 1, 6, 1), (30, 2, 5, 0), (30, 1, 7, 2), (30, 1, 6, 3), (24, 1, 6, 4))
T = ((30, 1, 6, 1), (30, 2, 5, 0), (30, 1, 7, 2), (24, 1, 6, 4))
W = (1, 1, 1, 1)
SHARE = 0.6
PERCENT = 50


class Out(Exception):
    pass


def solve(c, d, i, end):
    # An induced copy of the pattern (its nodes, slot by slot), or None. Raises Out when the budget is spent.
    n, z, k, h = T[d]
    r = random.Random((c * 8 + d) * 4096 + i)
    N = [0] * n                     # neighbour masks
    for u in range(n):
        x = r.getrandbits(n)
        for _ in range(z - 1):
            x &= r.getrandbits(n)
        x >>= u + 1
        v = u
        while x:
            v += 1
            if x & 1:
                N[u] |= 1 << v
                N[v] |= 1 << u
            x >>= 1
    p = r.getrandbits(k * k)
    s = []

    def bt(C):                      # C: the candidates of each slot still to fill
        m = C[0]
        while m:
            if time.process_time() > end:
                raise Out
            x = (m & -m).bit_length() - 1
            m &= m - 1
            s.append(x)
            a = len(s)
            if a == k or bt([q & ~(1 << x) & (-(2 << x) if h < 2 else -1) &
                             (N[x] if (0, 1, b - a < 1, b - a in (0, k - 2), p >> b * k + a - 1 & 1)[h] else ~N[x])
                             for b, q in enumerate(C[1:], a)]):
                return 1
            s.pop()
        return 0

    return s if bt([(1 << n) - 1] * k) else None


def fingerprint(c, w, ms, share=SHARE):
    # Work for share × ms of CPU (stopping at 90% of R of wall time), split in proportion to w.
    end = share * ms / 1000
    K = len(T)
    spent, nxt, out = [0] * K, [0] * K, []
    try:
        while time.process_time() < end and time.perf_counter() < ms / 1100:
            d = min(range(K), key=lambda e: spent[e] / (w[e] + 1e-9))
            t = time.process_time()
            x = solve(c, d, nxt[d], end)
            spent[d] += time.process_time() - t
            if x:
                out.append([d, nxt[d], x])
            nxt[d] += 1
    except Out:
        pass
    out.append([-1, round(time.process_time() / end, 2)])
    return {"nodes": len(out), "edges": [], "labels": out}


def flower(challenge):
    return fingerprint(challenge, W, GAME["ms"]), PERCENT
