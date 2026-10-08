# A bee for the arrangement flower (integrated.py): reads which flower it is (its profile) and how far its search
# got (its wealth), predicts what a feed would pay, and feeds only when that beats the feed price by a margin.
#
# The challenge seeds the same 192 pairs the flower got, in the same two classes. For each class and each
# candidate target t (0 to 47), the bee compares the pairs' total distance from t, S(t) = sum ||p[u] - p[v]| - t|,
# with what a random arrangement gives:
#   z(t)  how many standard deviations below random S(t) is. The best t per class is the profile (the flower's T).
#   q     at that t, the share of random's distance the flower removed (0 for random, 1 for every pair exactly t
#         apart), averaged over the two classes. That is its wealth, read as CPU ms through CURVE.
# A response that isn't an arrangement of the 48 nodes: leave.
#
# Each flower picks its own BURN, PERCENT and T, and the bee sees none of them; fed(nectar), after a feed, is all
# it learns. So it learns, per profile, what a feed pays per ms of CPU. MEMORY holds one entry per profile, as
# many as fit in its 50 bytes: the key is the profile, chr(40 + t) per class; the value is the rate, in thousands
# of node·ms·bytes per ms of CPU. A reading within NEAR of a key is that profile (and moves the key a third of
# the way to it); any other starts at the prior RATE. Each feed moves the profile's rate halfway toward what it
# paid, in log terms, so a profile whose feed paid little or nothing drops at once: the bee is not fooled twice
# by the same profile. (A copy that shows the same profile as an honest flower is the same profile to the bee:
# the two share one rate.)
import math, random

n, K, M = 48, 2, 96       # nodes, classes of pairs, pairs per class (must match integrated.py)
# (CPU ms, q) for the starter flower. PROVISIONAL: a straight line until it is measured on the real runner; the
# learned rates take up its scale meanwhile.
CURVE = ((0, 0.0), (30, 1.0))
RATE = 266                # prior rate: a 250-node, 84-byte flower, BURN 0.6, 50%: 0.5 × 850 × 940 × 0.4 / 0.6 / 1000
MARGIN = 1.5              # feed when the predicted nectar is at least MARGIN × the feed price
NEAR = 4.0                # readings closer than this (in target units) count as the same profile
LEARN = 0.5               # how far one feed moves its profile's rate toward what it paid (in log terms)
EXPLORE = 0.02            # the share of other arrangements fed anyway (each costs the price), so a rate can recover
CAP = 50                  # MEMORY bytes: keys plus values

# Under a random arrangement, D = |p[u] - p[v]| for a pair takes value x with probability 2(n - x) / (n(n - 1)).
PD = [0] + [2 * (n - x) / (n * (n - 1)) for x in range(1, n)]
MU = [sum(PD[x] * abs(x - t) for x in range(n)) for t in range(n)]                         # E|D - t|
SD = [math.sqrt(sum(PD[x] * (x - t) ** 2 for x in range(n)) - MU[t] ** 2) for t in range(n)]  # its spread
cpu, here, near = 0, "", ""   # this turn's reading (CPU ms, profile, the MEMORY key it matched), from decide for fed


def read(c, response):
    # (profile, q) for an arrangement of the 48 nodes, or None.
    try:
        p = [ord(ch) - 35 for ch in response["labels"][0][:n]]
        if sorted(p) != list(range(n)):
            return None
    except (TypeError, KeyError, IndexError):
        return None
    r = random.Random(c)
    D = [[], []]
    for i in range(K * M):
        u, v = r.sample(range(n), 2)
        D[i % K].append(abs(p[u] - p[v]))
    key, q = "", 0.0
    for d in D:
        S = [sum(abs(x - t) for x in d) for t in range(n)]
        t = max(range(n), key=lambda t: (M * MU[t] - S[t]) / SD[t])
        key += chr(40 + t)
        q += (1 - S[t] / (M * MU[t])) / K
    return key, q


def wealth(q):
    # CPU ms the starter flower needs to reach q, read off the reference curve (linear between points).
    for (c0, q0), (c1, q1) in zip(CURVE, CURVE[1:]):
        if q <= q1:
            return c0 + (c1 - c0) * max(0.0, q - q0) / (q1 - q0)
    return CURVE[-1][0]


def gap(a, b):
    # The distance between two profiles, in target units.
    return math.dist([ord(x) for x in a], [ord(x) for x in b])


def first():                  # for engines that still ask for a first challenge
    return random.getrandbits(52)


def decide(challenge, response):
    global cpu, here, near
    got = read(challenge, response)
    cpu, near = 0, ""
    if not got or got[1] <= 0:              # not an arrangement, or no better than chance
        return "leave", random.getrandbits(52)
    here, cpu = got[0], wealth(got[1])
    near = min((k for k in MEMORY if len(k) == K), key=lambda k: gap(k, here), default="")
    if near and gap(near, here) > NEAR:
        near = ""
    rate = MEMORY[near] if near else RATE
    price = GAME.get("feed_price", 2.8e6)   # node·ms·bytes a feed costs the bee
    feed = rate * 1000 * cpu >= MARGIN * price or random.random() < EXPLORE
    return ("feed" if feed else "leave"), random.getrandbits(52)


def fed(nectar):
    # Move this profile's rate toward what the feed paid per ms of CPU (read from q). (fed may also return the
    # next challenge, replacing decide's; None keeps it.)
    if cpu < 0.1:
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
