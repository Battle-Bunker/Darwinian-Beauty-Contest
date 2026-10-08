# A fingerprint bee: checks every certificate in a fingerprint response, reads the level vector, scores it
# with weights (in code) plus a learned adjustment (in MEMORY), and feeds or leaves. A starting point: change
# the weights, the threshold and the learning as you play.
#
# Level vector L: certified instances per dimension. Its size U = sum(L) shows the flower's wealth this turn
# (an honest flower spends 60% of R on the work); its direction L / U is the flower's signature (its split).
# The bee never sees the percent: only fed(nectar), after a feed, tells it what the signature paid.
# A failed certificate, a repeated (d, i), or more certificates than any flower can make: leave.
import random, time

# Must match the flowers' T exactly (fingerprint.py; the five-dimension option adds (30, 1, 6, 3)).
T = ((30, 1, 6, 1), (30, 2, 5, 0), (30, 1, 7, 2), (24, 1, 6, 4))
K = len(T)
KEYS = "abcde"            # MEMORY: the learned adjustment per dimension, in tenths (-9..9)
WEIGHT = (1,) * K         # the fingerprint weights: what this bee values in each dimension
TAU = 30                  # feed when the weighted score reaches this (a feed costs 20 rounds)
PER_UNIT = 2400           # nectar an honest 50% flower gives per certified unit (from calibration)
LMAX = 160                # more certificates than R = 150 allows: implausible
CHECK_MS = 35             # stop checking here; only checked certificates count


def graph(c, d, i):
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


def valid(c, d, i, x):
    # Whether x (k distinct nodes) is an induced copy of dimension d's pattern in instance i for challenge c.
    n, z, k, h = T[d]
    if type(x) is not list or len(x) != k or len(set(x)) != k or any(type(v) is not int or not 0 <= v < n for v in x):
        return False
    rows, want = graph(c, d, i)
    return all(rows[min(x[a], x[b])] >> max(x[a], x[b]) & 1 == want[a][b] for a in range(k) for b in range(a))


def levels(c, response):
    # The level vector of checked certificates; None if anything is forged or malformed.
    L = [0] * K
    try:
        labels = response["labels"]
        if len(labels) > LMAX:
            return None
        seen = set()
        for lab in labels:
            if time.perf_counter() * 1000 > CHECK_MS:
                break
            if lab[0] == -1 and len(lab) == 2:     # the flower's record of the share of 0.6 R it spent
                continue
            d, i, x = lab
            if type(d) is not int or not 0 <= d < K or type(i) is not int or not 0 <= i < 4096 or (d, i) in seen:
                return None
            if not valid(c, d, i, x):
                return None
            seen.add((d, i))
            L[d] += 1
    except (TypeError, ValueError, KeyError, IndexError):
        return None
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
    # Did this signature pay what an honest flower of this wealth would? Shift each dimension's adjustment by
    # its share of the vector. Returning a challenge here would replace the one decide queued; None keeps it.
    if not U:
        return None
    r = nectar / (PER_UNIT * U)
    for d in range(K):
        if L[d]:
            MEMORY[KEYS[d]] = max(-9, min(9, MEMORY.get(KEYS[d], 0) + round(4 * (r - 1) * L[d] / U)))
    return None
