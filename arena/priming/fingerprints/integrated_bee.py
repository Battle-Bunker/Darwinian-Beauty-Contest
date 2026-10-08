# A bee for the integrated fingerprint (integrated.py, and the hybrid, hybrid.py): scores the one arrangement on
# every property, as z-scores against a random arrangement (how many standard deviations better than chance),
# reads the hybrid's tally of cliques if there is one, and feeds or leaves.
#
# Level vector z: one entry per property. Its size U = sum(z) shows how far the flower got: its wealth this turn
# (an honest flower spends 60% of R on the search); read it back with the reference curve below. Its
# direction z / U is the flower's signature (its W). A response that isn't an arrangement of the n nodes: leave.
# The bee never sees the percent: only fed(nectar), after a feed, tells it what a signature paid.
import math, random, time

n, M = 48, 96             # must match the flowers (integrated.py)
K = 4
KEYS = "abcd"             # MEMORY: the learned adjustment per property, in tenths (-9..9)
WEIGHT = (1,) * K         # the fingerprint weights
TAU = 12                  # feed when the weighted score reaches this (a feed costs 20 rounds)
CURVE = ((0, 0.0), (2, 4.0), (12, 9.0), (45, 13.0), (90, 15.0))   # (CPU ms, U) for W = (1, 1, 1, 1): calibrate
PER_MS = 160              # nectar an honest 50% flower gives per ms of R (from calibration; see signals.md)
NT, KT = 40, 6            # the hybrid's tally (hybrid.py): cliques of KT nodes in graphs of NT nodes
UNIT_MS = 1.0             # CPU per tally clique (from calibration)

# Under a random arrangement, D = |p[u] - p[v]| for a pair takes value t with probability 2(n - t) / (n(n - 1)).
PD = [0] + [2 * (n - t) / (n * (n - 1)) for t in range(1, n)]
ED = sum(t * PD[t] for t in range(n))
VD = sum(t * t * PD[t] for t in range(n)) - ED * ED
QB = n / (2 * (n - 1))   # chance a pair is split across the middle


def levels(c, response):
    # z-scores per property, or None if the response isn't an arrangement of the n nodes.
    try:
        p = response["labels"][:n]
        if sorted(p) != list(range(n)):
            return None
    except (TypeError, KeyError):
        return None
    r = random.Random(c)
    z = []
    for d in range(K):
        s = mu = var = 0.0
        for _ in range(M):
            u, v, t = r.randrange(n), r.randrange(n), r.randrange(1, n)
            if u == v:
                continue
            D = abs(p[u] - p[v])
            if d < 2:
                s += D
                mu += ED
                var += VD
            elif d == 2:
                s += (p[u] < n / 2) != (p[v] < n / 2)
                mu += QB
                var += QB * (1 - QB)
            else:
                e = sum(PD[x] * abs(x - t) for x in range(n))
                s += abs(D - t)
                mu += e
                var += sum(PD[x] * abs(x - t) ** 2 for x in range(n)) - e * e
        sign = -1 if d in (0, 3) else 1          # lower is better for 0 and 3
        z.append(sign * (s - mu) / math.sqrt(var))
    return z


def tally(c, response):
    # The hybrid's wealth: the unbroken run of valid cliques from index 0 (labels after the arrangement and f).
    # None if one is forged. 0 for a flower with no tally.
    got = set()
    try:
        for i, x in response["labels"][n + 1:]:
            if type(i) is not int or not 0 <= i < 999 or i in got or type(x) is not list or len(set(x)) != KT:
                return None
            if any(type(v) is not int or not 0 <= v < NT for v in x):
                return None
            g = random.Random(c * 999 + i)
            N = [g.getrandbits(NT) for _ in range(NT)]
            if any(not N[min(u, v)] >> max(u, v) & 1 for a, u in enumerate(x) for v in x[:a]):
                return None
            got.add(i)
    except (TypeError, ValueError, KeyError):
        return None
    m = 0
    while m in got:
        m += 1
    return m


def wealth(U):
    # CPU ms an honest flower needs to reach U, read off the reference curve (linear between points).
    for (c0, u0), (c1, u1) in zip(CURVE, CURVE[1:]):
        if U <= u1:
            return c0 + (c1 - c0) * max(0.0, U - u0) / (u1 - u0)
    return CURVE[-1][0]


def first():                  # for engines that still ask for a first challenge
    return random.getrandbits(52)


def decide(challenge, response):
    global z, U, m
    z = levels(challenge, response) or [0.0] * K
    U = sum(z)
    m = tally(challenge, response)
    if m is None:                      # a forged tally: leave
        return "leave", random.getrandbits(52)
    # The signature's weighted score, plus the tally's count (each clique is about UNIT_MS of honest work).
    score = sum((WEIGHT[d] + MEMORY.get(KEYS[d], 0) / 10) * z[d] for d in range(K)) + m
    return ("feed" if score >= TAU else "leave"), random.getrandbits(52)


def fed(nectar):
    # Did this signature pay what an honest flower of this wealth would? (fed may also return the next
    # challenge, replacing decide's; None keeps it.)
    if U <= 0:
        return None
    cpu = m * UNIT_MS / 0.5 if m else wealth(U)    # the hybrid spends half its 60% on the tally (A = 0.5)
    ratio = nectar / (PER_MS * cpu / 0.6 + 1)
    for d in range(K):
        if z[d] > 0:
            MEMORY[KEYS[d]] = max(-9, min(9, MEMORY.get(KEYS[d], 0) + round(4 * (ratio - 1) * z[d] / U)))
    return None
