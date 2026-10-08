# A bee for the integrated fingerprint (integrated.py): scores the one arrangement on every property, as
# z-scores against a random arrangement (how many standard deviations better than chance), predicts what a
# feed would pay, and feeds or leaves.
#
# Level vector z: one entry per property. Its size U = sum(z) shows how far the flower's search got; the
# reference curve below reads it as the CPU ms that took. Its direction z / |z| is the flower's profile (its W).
# A response that isn't an arrangement of the n nodes: leave.
#
# Each flower picks its own BURN (the share of R it spends) and PERCENT, and the bee never sees either; fed
# (nectar), after a feed, is all it learns. A flower that burns less or gives more pays more per ms of CPU it
# spent, so the bee learns that rate per profile. MEMORY holds one entry per profile it has fed at, as many as
# fit in its 50 bytes: the key is the profile in tenths, one letter per property, chr(80 + round(10 z / |z|));
# the value is the learned rate, in thousands of node·ms·bytes per ms of CPU. A reading within NEAR of a key is
# that profile (and moves the key a third of the way to it); any other starts at the prior RATE. The curve fixes
# only the shape (more CPU, higher U); the learned rates take up the scale, including a profile whose U runs
# below the equal-weights curve.
import math, random

n, M = 48, 96             # must match the flowers (integrated.py)
K = 4
# (CPU ms, U) for an honest flower with equal weights, measured on the game machine (one response varies by about 1):
CURVE = ((0, 0.0), (1.8, 8.6), (6, 13.4), (12, 15.5), (25.2, 17.3), (45.6, 17.9), (90, 18.4))
RATE = 216                # prior rate: a 410-node, 85-byte flower burning 0.6, at 50%: 0.5 × 690 × 939 × 0.4 / 0.6 / 1000
NEED = 5e6                # feed when the predicted nectar reaches this (the prior flower at about R = 40); a feed costs 20 rounds
NEAR = 3.5                # readings closer than this (in tenths) count as the same profile
LEARN = 0.5               # how far one feed moves its profile's rate toward what it paid (in log terms)
EXPLORE = 0.05            # the share of other arrangements fed anyway, so a rate learned too low can recover
CAP = 50                  # MEMORY bytes: keys plus values

# Under a random arrangement, D = |p[u] - p[v]| for a pair takes value t with probability 2(n - t) / (n(n - 1)).
PD = [0] + [2 * (n - t) / (n * (n - 1)) for t in range(1, n)]
ED = sum(t * PD[t] for t in range(n))
VD = sum(t * t * PD[t] for t in range(n)) - ED * ED
QB = n / (2 * (n - 1))   # chance a pair is split across the middle
cpu, here, near = 0, "", ""   # this turn's reading (CPU ms, profile, the MEMORY key it matched), from decide for fed


def arrangement(response):
    # The positions p[v]: from the one-string format (character v is chr(35 + p[v])), or from a list of labels.
    labels = response["labels"]
    if type(labels[0]) is str:
        return [ord(ch) - 35 for ch in labels[0][:n]]
    return labels[:n]


def levels(c, response):
    # z-scores per property, or None if the response isn't an arrangement of the n nodes.
    try:
        p = arrangement(response)
        if sorted(p) != list(range(n)):
            return None
    except (TypeError, KeyError, IndexError):
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


def wealth(U):
    # CPU ms an honest flower needs to reach U, read off the reference curve (linear between points).
    for (c0, u0), (c1, u1) in zip(CURVE, CURVE[1:]):
        if U <= u1:
            return c0 + (c1 - c0) * max(0.0, U - u0) / (u1 - u0)
    return CURVE[-1][0]


def profile(z):
    # z's direction in tenths, one letter per property ("F" is -1, "P" is 0, "Z" is 1).
    L = math.sqrt(sum(x * x for x in z))
    return "".join(chr(80 + round(10 * x / L)) for x in z)


def gap(a, b):
    # The distance between two profiles, in tenths.
    return math.dist([ord(x) for x in a], [ord(x) for x in b])


def first():                  # for engines that still ask for a first challenge
    return random.getrandbits(52)


def decide(challenge, response):
    global cpu, here, near
    z = levels(challenge, response)
    cpu = 0
    if not z or sum(z) <= 0:                # not an arrangement, or no better than chance
        return "leave", random.getrandbits(52)
    cpu, here = wealth(sum(z)), profile(z)
    near = min((k for k in MEMORY if len(k) == K), key=lambda k: gap(k, here), default="")
    if near and gap(near, here) > NEAR:
        near = ""
    rate = MEMORY[near] if near else RATE
    feed = rate * 1000 * cpu >= NEED or random.random() < EXPLORE
    return ("feed" if feed else "leave"), random.getrandbits(52)


def fed(nectar):
    # Move this profile's rate toward what the feed paid per ms of CPU (read from U). (fed may also return the
    # next challenge, replacing decide's; None keeps it.)
    if cpu < 0.5:
        return None
    old = MEMORY.pop(near) if near else RATE
    key = "".join(chr(round(ord(a) + (ord(b) - ord(a)) / 3)) for a, b in zip(near, here)) if near else here
    MEMORY[key] = round(min(9999, max(1, old * (max(nectar, 1) / cpu / 1000 / old) ** LEARN)))
    for k in [k for k in MEMORY if len(k) != K]:          # entries an older bee left
        del MEMORY[k]
    while sum(len(k) + len(str(v)) for k, v in MEMORY.items()) > CAP:
        # Over the cap: forget the profile whose rate says least (nearest the prior), never this one.
        del MEMORY[min(MEMORY, key=lambda k: (k == key) * 99 + abs(math.log(MEMORY[k] / RATE)))]
    return None
