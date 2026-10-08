# A fingerprint bee: checks every certificate in a fingerprint response, reads the level vector, scores it
# with weights (in code) plus a learned adjustment (in MEMORY), and feeds or leaves. A starting point: change
# the weights, the threshold and the learning as you play.
#
# Level vector L: per dimension, how many instances the flower solved in an unbroken run from index 0 (a gap
# ends the run: skipping hard instances earns nothing). Its size U = sum(L) shows the flower's wealth this
# turn: an honest flower spends 60% of R on the work. Its direction L / U is the flower's profile.
# The bee never sees the percent: only fed(nectar), after a feed, tells it what a profile paid.
# Any certificate that fails, or a repeated (d, i): forged, leave.
import random, time

# Must match the flowers' dimensions: (n, k, h), h = 0 clique, 1 induced path, 2 induced cycle, 3 random
# pattern. The default flower (fingerprint.py):
T = ((80, 8, 0), (64, 9, 1), (90, 9, 2), (48, 8, 3))
# The compact option (fingerprint_compact.py, cliques at three scales):  T = ((24, 5, 0), (40, 6, 0), (64, 7, 0))
K = len(T)
KEYS = "abcd"             # MEMORY: the learned adjustment per dimension, in tenths (-9..9)
WEIGHT = (1,) * K         # the fingerprint weights: what this bee values in each dimension
TAU = 30                  # feed when the weighted score reaches this (a feed costs 20 rounds)
PER_UNIT = 200000         # nectar (node·ms·bytes) an honest 50% flower gives per unit (calibrate)
LMAX = 400                # more labels than any flower can make: implausible
CHECK_MS = 35             # stop checking here; only checked certificates count


def valid(c, d, i, x):
    # Whether x (k distinct nodes) induces dimension d's pattern in instance i for challenge c.
    n, k, h = T[d]
    if type(x) is not list or len(x) != k or len(set(x)) != k or any(type(v) is not int or not 0 <= v < n for v in x):
        return False
    r = random.Random((c * 8 + d) * 999 + i)
    rows = [r.getrandbits(n) for _ in range(n)]
    p = r.getrandbits(k * k)
    for a in range(k):
        for b in range(a):
            u, v = min(x[a], x[b]), max(x[a], x[b])
            if rows[u] >> v & 1 != (1, a - b == 1, a - b in (1, k - 1), p >> a * k + b & 1)[h]:
                return False
    return True


def levels(c, response):
    # The level vector of checked certificates; None if anything is forged or malformed.
    got = [set() for _ in range(K)]
    try:
        labels = response["labels"]
        if len(labels) > LMAX:
            return None
        for lab in labels:
            if time.perf_counter() * 1000 > CHECK_MS:
                break
            if lab[0] == -1 and len(lab) == 2:     # the flower's record of the share of 0.6 R it spent
                continue
            d, i, x = lab
            if type(d) is not int or not 0 <= d < K or type(i) is not int or not 0 <= i < 999 or i in got[d]:
                return None
            if not valid(c, d, i, x):
                return None
            got[d].add(i)
    except (TypeError, ValueError, KeyError, IndexError):
        return None
    L = [0] * K
    for d in range(K):
        while L[d] in got[d]:
            L[d] += 1
    return L


def first():                  # for engines that still ask for a first challenge
    return random.getrandbits(52)


def decide(challenge, response):
    global L, U
    L = levels(challenge, response) or [0] * K
    U = sum(L)
    score = sum((WEIGHT[d] + MEMORY.get(KEYS[d], 0) / 10) * L[d] for d in range(K))
    return ("feed" if score >= TAU else "leave"), random.getrandbits(52)


def fed(nectar):
    # Did this profile pay what an honest flower of this wealth would? Shift each dimension's adjustment by
    # its share of the vector. fed may also return the next challenge (it replaces the one decide queued);
    # None keeps decide's.
    if not U:
        return None
    r = nectar / (PER_UNIT * U)
    for d in range(K):
        if L[d]:
            MEMORY[KEYS[d]] = max(-9, min(9, MEMORY.get(KEYS[d], 0) + round(4 * (r - 1) * L[d] / U)))
    return None
