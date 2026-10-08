# A fingerprint flower: costly, checkable work on several graph properties at once, split by W.
#
# A unit of work is one certified instance: k nodes of a random graph (density 1/2) seeded by the bee's
# challenge c, the dimension d and an index j, that induce dimension d's pattern. Nothing can be prepared in
# advance or reused. The flower works for SHARE (60%) of its budget R of CPU time, taking dimensions in turn
# in proportion to W (whole numbers), and answers a graph[any]: one node per certificate, labelled [d, j,
# nodes], and a last node labelled [-1, f], f = the share of 0.6 R it actually spent. At PERCENT 50.
#
# Paste the whole file as your flower. Change W to move your signature.
import random, time

# Dimensions: (n, k, h): a graph of n nodes; a pattern of k nodes: h = 0 clique, 1 induced path,
# 2 induced cycle, 3 a random pattern seeded with the graph. The default has three; the four-dimension
# option adds the induced cycle:   T = ((30, 6, 0), (30, 7, 1), (30, 6, 2), (24, 6, 3))
T = ((30, 6, 0), (30, 7, 1), (24, 6, 3))
W = (1, 1, 1)
SHARE = 0.6
PERCENT = 50


class Out(Exception):
    pass


def flower(c):
    ms = GAME["ms"]
    end = SHARE * ms / 1000
    S = [d for d in range(len(T)) for _ in range(W[d])]
    out, j = [], 0
    try:
        while time.process_time() < end and time.perf_counter() < ms / 1100:   # and 90% of R on the wall clock
            d = S[j % len(S)]
            n, k, h = T[d]
            r = random.Random((c * 8 + d) * 4096 + j)
            N = [0] * n                    # neighbour masks
            for u in range(n):
                x = r.getrandbits(n)
                for v in range(u + 1, n):
                    if x >> v & 1:
                        N[u] |= 1 << v
                        N[v] |= 1 << u
            p = r.getrandbits(k * k)
            s = []

            def bt(C):                     # C: the candidates of each slot still to fill
                m = C[0]
                while m:
                    if time.process_time() > end:
                        raise Out
                    x = (m & -m).bit_length() - 1
                    m &= m - 1
                    s.append(x)
                    a = len(s)
                    if a == k or bt([q & ~(1 << x) & (-(2 << x) if h < 1 else -1) &
                                     (N[x] if (1, b - a < 1, b - a in (0, k - 2), p >> b * k + a - 1 & 1)[h] else ~N[x])
                                     for b, q in enumerate(C[1:], a)]):
                        return 1
                    s.pop()

            if bt([(1 << n) - 1] * k):
                out.append([d, j, s])
            j += 1
    except Out:
        pass
    out.append([-1, time.process_time() / end])
    return {"nodes": len(out), "edges": [], "labels": out}, PERCENT
