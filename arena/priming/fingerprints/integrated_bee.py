# A bee for the arrangement flower (integrated.py): reads which flower it is (its profile) and how far its search
# got (q), predicts what a feed would pay, and feeds only when that beats the feed price by a margin. At any other
# flower it learns, per coarse response shape, what feeds there have paid.
#
# The challenge seeds the same 192 pairs the flower got, in the same two classes. For each class and each
# candidate target t (0 to 47), the bee compares the pairs' total distance from t, S(t) = sum ||p[u] - p[v]| - t|,
# with what a random arrangement gives:
#   z(t)  how many standard deviations below random S(t) is. The best t per class is the profile (the flower's T).
#   q     at that t, the share of random's distance the flower removed (0 for random, 1 for every pair exactly t
#         apart), averaged over the two classes.
# REF(q) is what the starter flower pays on average at that q, measured on the real runner. A profile's trust m
# (1 for the starter) scales it: the bee expects m × REF(q) and feeds when that is at least MARGIN × the price.
#
# Each flower picks its own BURN, PERCENT and T, and the bee sees none of them; fed(nectar), the gross nectar of
# a feed, is all it learns. After each feed, m moves LEARN of the way toward nectar / REF(q). For the starter that
# ratio averages 1 at every q, so choosing turns by q doesn't bias it. A dud (a feed that paid under a quarter of
# what the bee expected) moves m DUD of the way instead: one that pays nothing halves m, and then even the richest
# reading falls short of the margin, so the bee isn't fooled twice in a row by a profile.
# Each time it passes a profile it trusts less than the starter, trust comes back DRIFT of the way, so a profile
# whose copy stopped is tried again. (A copy that shows the same profile as an honest flower is the same profile
# to the bee: the two share one m.)
#
# At any other response shape the bee learns the shape's mean nectar from its own feeds, starting at MARGIN × the
# price, and feeds while that mean clears the margin (and now and then when it doesn't, to notice a change).
#
# MEMORY (50 bytes; keys plus values): a profile is chr(40 + t) per class, valued 100 m; a response shape is "~"
# and two letters, valued its mean nectar in units of 100,000. Two profile keys within NEAR merge. When full, the
# entry nearest its prior goes.
import math, random

n, K, M = 48, 2, 96       # nodes, classes of pairs, pairs per class (must match integrated.py)
# (q, mean nectar in 100,000s) for the starter flower (T = 8, 32; BURN 0.6; 50%), with R drawn as in a coop-eq
# game: 2,000 calls on the real runner (analysis/fingerprints/results/coop_eq_ref.txt).
REF = ((0, 0), (0.09, 2), (0.2, 4), (0.28, 6), (0.32, 9), (0.36, 14), (0.38, 20), (0.395, 27), (0.41, 34),
       (0.425, 42), (0.44, 49), (0.46, 53), (0.48, 56), (0.5, 59), (0.53, 66))
MARGIN = 1.2              # feed when the expected nectar is at least MARGIN × the feed price
NEAR = 6.0                # readings closer than this (in target units) count as the same profile
LEARN = 0.2               # how far one feed moves a profile's m toward what it paid (nectar / REF(q))
DUD = 0.5                 # ... and how far when it paid under a quarter of what the bee expected
SHAPE_LEARN = 0.2         # how far one feed moves a shape's mean toward what it paid
DRIFT = 0.03              # how far trust in a profile below the starter's comes back each time the bee passes it
NEW = 0.3                 # the chance of feeding at a response shape it hasn't fed at yet
EXPLORE = 0.05            # the chance of feeding at a shape whose mean falls short, to notice a change
CAP = 50                  # MEMORY bytes: keys plus values

# Under a random arrangement, D = |p[u] - p[v]| for a pair takes value x with probability 2(n - x) / (n(n - 1)).
PD = [0] + [2 * (n - x) / (n * (n - 1)) for x in range(1, n)]
MU = [sum(PD[x] * abs(x - t) for x in range(n)) for t in range(n)]                         # E|D - t|
SD = [math.sqrt(sum(PD[x] * (x - t) ** 2 for x in range(n)) - MU[t] ** 2) for t in range(n)]  # its spread
here, near, ref = "", "", 0   # this turn's reading (its key, the MEMORY key it matched, REF in nectar), for fed


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


def expect(q):
    # The starter's mean nectar at reading q, off REF (linear between points).
    for (q0, e0), (q1, e1) in zip(REF, REF[1:]):
        if q <= q1:
            return 1e5 * (e0 + (e1 - e0) * (q - q0) / (q1 - q0))
    return 1e5 * REF[-1][1]


def shape(response):
    # A coarse bucket for any other response: "~", then for a graph the number of digits in its node count and the
    # kind of its first label, else the kind of the response.
    if type(response) is dict:
        labels = response.get("labels") or [None]
        return "~" + str(min(9, len(str(response.get("nodes"))))) + type(labels[0]).__name__[0]
    return "~" + type(response).__name__[:2]


def profile(k):
    return len(k) == K and all(40 <= ord(ch) < 88 for ch in k)


def gap(a, b):
    # The distance between two profiles, in target units.
    return math.dist([ord(x) for x in a], [ord(x) for x in b])


def first():                  # for engines that still ask for a first challenge
    return random.getrandbits(52)


def decide(challenge, response):
    global here, near, ref
    price = GAME.get("feed_price", 2.8e6)   # node·ms·bytes a feed costs the bee
    got = read(challenge, response)
    if got:
        here, ref = got[0], expect(got[1])
        near = min((k for k in MEMORY if profile(k)), key=lambda k: gap(k, here), default="")
        if near and gap(near, here) > NEAR:
            near = ""
        m = MEMORY[near] / 100 if near else 1.0
        feed = m * ref >= MARGIN * price
        if not feed and near and MEMORY[near] < 100:  # distrust fades
            MEMORY[near] += max(1, round(DRIFT * (100 - MEMORY[near])))
    else:
        here, near, ref = shape(response), "", 0
        mean = MEMORY.get(here)
        feed = response is not None and (random.random() < NEW if mean is None else
                                         mean * 1e5 >= MARGIN * price or random.random() < EXPLORE)
    return ("feed" if feed else "leave"), random.getrandbits(52)


def fed(nectar):
    # Learn from the feed's gross nectar. (fed may also return the next challenge, replacing decide's; None keeps it.)
    if not here:
        return None
    if ref:                                  # an arrangement: move its profile's m toward nectar / REF(q)
        if ref < 1e6:                        # too poor a reading to learn from
            return None
        old = MEMORY.pop(near) if near else 100
        key = "".join(chr(round(ord(a) + (ord(b) - ord(a)) / 3)) for a, b in zip(near, here)) if near else here
        paid = 100 * nectar / ref
        MEMORY[key] = round(min(999, max(0, old + (DUD if paid < old / 4 else LEARN) * (paid - old))))
        for k in [k for k in MEMORY if profile(k) and k != key and gap(k, key) <= NEAR]:   # one profile, one key
            MEMORY[key] = (MEMORY[key] + MEMORY.pop(k)) // 2
    else:                                    # any other shape: move its mean toward the nectar
        key, old = here, MEMORY.get(here, MARGIN * GAME.get("feed_price", 2.8e6) / 1e5)
        MEMORY[key] = round(old + SHAPE_LEARN * (nectar / 1e5 - old))
    for k in [k for k in MEMORY if not profile(k) and k[:1] != "~"]:     # entries an older bee left
        del MEMORY[k]
    price = GAME.get("feed_price", 2.8e6) / 1e5
    while sum(len(k) + len(str(v)) for k, v in MEMORY.items()) > CAP:
        # Over the cap: forget the entry nearest its prior (100 for a profile, the price for a shape), never this one.
        del MEMORY[min(MEMORY, key=lambda k: (k == key) * 99 + abs(MEMORY[k] - (100 if profile(k) else price)) / (100 if profile(k) else price))]
    return None
