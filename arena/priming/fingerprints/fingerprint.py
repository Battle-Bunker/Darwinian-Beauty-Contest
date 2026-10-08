# A fingerprint flower (compact): costly, checkable work in several dimensions at once, split by W.
#
# Dimension d's instance i is a random graph (edge density 1/2) seeded by the bee's challenge c, d and i; one
# unit of work is a clique of k nodes in it. Instances are taken in order, 0, 1, 2, ... in each dimension, and
# bees credit only the unbroken run from 0, so skipping a hard instance gains nothing. The flower works for 60%
# of its budget R of CPU time (stopping at 90% of R of wall time), taking dimensions in the order of W, and
# answers a graph[any]: one node per clique, labelled [d, i, nodes], and a last node labelled [-1, f], f = the
# share of 0.6 R it actually spent. At percent 50.
#
# Paste the whole file as your flower. Change W to move your signature: each character is a dimension, and the
# flower cycles through W, so "0012" gives dimension 0 half of its work.
import random, time

# Dimensions (n, k): a clique of k nodes in a random graph of n nodes (bit v of row u, u < v, is the edge uv).
T = ((24, 5), (40, 6), (64, 7))
W = "012"


def flower(c):
    ms = GAME["ms"]
    end = ms * 6e-4
    out, nxt = [], [0] * len(T)
    while time.process_time() < end and time.perf_counter() < ms / 1100:
        d = int(W[sum(nxt) % len(W)])
        n, k = T[d]
        i = nxt[d]
        r = random.Random((c * 8 + d) * 999 + i)
        N = [r.getrandbits(n) for _ in range(n)]
        s = []

        def bt(m):                  # nodes in increasing order: only each row's upper bits are needed
            while m:
                if time.process_time() > end:
                    return 0
                x = (m & -m).bit_length() - 1
                s.append(x)
                if len(s) == k or bt(m & N[x] & -(2 << x)):
                    return 1
                s.pop()
                m &= m - 1

        if bt((1 << n) - 1):
            out.append([d, i, s])
        nxt[d] += 1
    out.append([-1, time.process_time() / end])
    return {"nodes": len(out), "edges": [], "labels": out}, 50
