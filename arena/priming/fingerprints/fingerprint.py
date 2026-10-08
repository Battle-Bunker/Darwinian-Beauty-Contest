# A fingerprint flower: costly, checkable work on several different graph properties at once, split by W.
#
# Dimension d's instance i is a random graph (n nodes, edge density 1/2) seeded by the bee's challenge c, d and
# i; one unit of work is k nodes of it that induce dimension d's pattern: a clique, a path, a cycle, or a random
# pattern seeded with the instance. Instances are taken in order, 0, 1, 2, ... in each dimension, and bees credit
# only the unbroken run from 0, so skipping a hard instance gains nothing. The flower works for 60% of its budget
# R of CPU time (stopping at 90% of R of wall time), taking dimensions in the order of W, and answers a
# graph[any]: one node per certificate, labelled [d, i, nodes], and a last node labelled [-1, f], f = the share
# of 0.6 R it actually spent. At percent 50.
#
# Paste the whole file as your flower. Change W to move your profile: each character is a dimension, and the
# flower cycles through W, so "0012" gives dimension 0 half of its work. (fingerprint_compact.py is a smaller
# option whose dimensions are cliques at three scales.)
import random, time

# Dimensions (n, k, h): h = 0 clique, 1 induced path, 2 induced cycle, 3 random pattern.
T = ((24, 5, 0), (30, 7, 1), (30, 6, 2), (24, 6, 3))
W = "0123"


def flower(c):
    ms = GAME["ms"]
    end = ms * 6e-4
    out, nxt = [], [0] * len(T)
    while time.process_time() < end and time.perf_counter() < ms / 1100:
        d = int(W[sum(nxt) % len(W)])
        n, k, h = T[d]
        i = nxt[d]
        r = random.Random((c * 8 + d) * 999 + i)
        N = [0] * n                 # full neighbour sets
        for u in range(n):
            x = r.getrandbits(n)
            for v in range(u + 1, n):
                if x >> v & 1:
                    N[u] |= 1 << v
                    N[v] |= 1 << u
        p = r.getrandbits(k * k)
        s = []

        def bt(C):                  # C: the candidates of each slot still to fill
            m = C[0]
            while m:
                if time.process_time() > end:
                    return 0
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
            out.append([d, i, s])
        nxt[d] += 1
    out.append([-1, time.process_time() / end])
    return {"nodes": len(out), "edges": [], "labels": out}, 50
