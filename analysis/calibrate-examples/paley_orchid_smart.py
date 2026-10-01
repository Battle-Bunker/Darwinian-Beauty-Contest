# Calibration only: the best Paley-chain orchid we could write for a 50 ms budget. Same answer format as
# arena/examples/v3/paley_clover.py, with every speed-up we found:
#   - quadratic reciprocity: for an odd prime q and p % 4 == 1, q is a square mod p exactly when p % q is a
#     square mod q, so each Legendre symbol is a pow() with a small modulus (2 is a square iff p % 8 == 1)
#   - wider candidate sampling in the greedy (fewer restarts), local names in the hot loop
#   - spends 80% of its budget (the example clover stops at 60%)
import itertools
import random
import time

K = 17
W = 32768
START = 10**7
FLIP = bytes.maketrans(b"\0\1", b"\1\0")
DIGITS = bytes.maketrans(b"\0\1", b"10")


def is_prime(m):
    d, s = m - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for a in (2, 3, 5, 7):
        x = pow(a, d, m)
        if x in (1, m - 1):
            continue
        for _ in range(s - 1):
            x = x * x % m
            if x == m - 1:
                break
        else:
            return False
    return True


def flower(challenge):
    clock = time.perf_counter
    t0 = clock()
    deadline = t0 + 0.8 * GAME["ms"] / 1000
    room = min(GAME["max_nodes"] // K, 4 * GAME["max_nodes"] // (K * (K - 1) // 2))
    sieve = bytearray([0, 0]) + bytearray([1]) * (W - 1)
    for i in range(2, int(W**0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytes(len(range(i * i, W + 1, i)))
    odd_primes = list(itertools.compress(range(3, W + 1), sieve[3:]))
    full = (1 << (W + 1)) - 1
    rr = random.randrange
    labels = []
    p = START + int(challenge) * 1234567 % (9 * START)
    p += (1 - p) % 4
    while len(labels) // K < room:
        while not is_prime(p):
            p += 4
        non = bytearray(W + 1)
        for q in ([2] if p % 8 != 1 else []) + [q for q in odd_primes if pow(p % q, (q - 1) >> 1, q) != 1]:
            m = q
            while m <= W:
                non[m::m] = non[m::m].translate(FLIP)
                m *= q
        right = non[1:].translate(DIGITS)
        S = int(right[::-1] + b"0" + right, 2)
        found = None
        while found is None and clock() < deadline:
            x = rr(W + 1)
            clique = [x]
            cand = (S >> (W - x)) & full
            while cand:
                best, bc = -1, -1
                for _ in range(6):
                    r = rr(W + 1)
                    y = cand >> r
                    z = r + (y & -y).bit_length() - 1 if y else (cand & -cand).bit_length() - 1
                    c = (cand & (S >> (W - z))).bit_count()
                    if c > bc:
                        best, bc = z, c
                clique.append(best)
                cand &= S >> (W - best)
            if len(clique) >= K:
                found = clique[:K]
        if found is None:
            break
        labels += found
        p += 4
    edges = [[s + i, s + j] for s in range(0, len(labels), K) for i in range(K) for j in range(i)]
    return dict(nodes=len(labels), edges=edges, labels=labels)
