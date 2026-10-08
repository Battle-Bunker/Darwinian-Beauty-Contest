# A fingerprint flower (the pattern option): like fingerprint.py, but the dimensions are different graph
# properties: an induced copy of a k-node pattern (a clique, a path, a cycle, or a random pattern seeded with
# the instance) in a random graph of n nodes, edge density 1/2. Bigger code than the compact flower (it needs
# full neighbour sets and a candidate set per pattern slot), so less energy left per turn. Same rules: instances
# in order per dimension, bees credit the unbroken run from 0, 60% of R, percent 50, a last [-1, f] record.
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
