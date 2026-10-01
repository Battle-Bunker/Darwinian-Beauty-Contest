# Calibration only: the strongest Paley-chain orchid we could write for a 50 ms budget. Same answer format as
# arena/examples/v3/paley_clover.py (and the same local search: greedy growth plus 1-for-2 and 1-for-1 swaps),
# with every speed-up we found on top:
#   - each member's friend set is computed once and cached instead of on every step
#   - members are masked out before scanning the "misses exactly one member" set
#   - local names in the hot loops, perf_counter, wider candidate sampling (6) when growing
#   - spends 80% of its budget (the example clover stops at 60%), and uses the window that suits it best
import itertools
import random
import time

K = 18
W = 32768
START = 10**8
FLIP = bytes.maketrans(b"\0\1", b"\1\0")
DIGITS = bytes.maketrans(b"\0\1", b"01")


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


def solve(p, odd_primes, deadline, clock, rr):
    non = bytearray(W + 1)
    for q in ([2] if p % 8 != 1 else []) + [q for q in odd_primes if pow(p % q, (q - 1) >> 1, q) != 1]:
        m = q
        while m <= W:
            non[m::m] = non[m::m].translate(FLIP)
            m *= q
    sq = non.translate(FLIP)
    sq[0] = 0
    right = sq[1:].translate(DIGITS)
    S = int(right[::-1] + b"0" + right, 2)
    full = (1 << (W + 1)) - 1
    cache = {}

    def nb(x):
        f = cache.get(x)
        if f is None:
            f = cache[x] = (S >> (W - x)) & full
        return f

    def pick(c):
        r = rr(W + 1)
        y = c >> r
        return r + (y & -y).bit_length() - 1 if y else (c & -c).bit_length() - 1

    def grow(C, cand):
        while cand:
            best, bc = -1, -1
            for _ in range(6):
                z = pick(cand)
                c = (cand & nb(z)).bit_count()
                if c > bc:
                    best, bc = z, c
            C.append(best)
            cand &= nb(best)
        return C

    while clock() < deadline:
        x = rr(W + 1)
        C = grow([x], nb(x))
        tabu = set()
        for _ in range(200):
            if len(C) >= K or clock() > deadline:
                break
            none, one = full, 0
            mask = 0
            for v in C:
                f = nb(v)
                one = (one & f) | (none & ~f)
                none &= f
                mask |= 1 << v
            if none:
                C = grow(C, none)
                continue
            one &= ~mask
            reps = {}
            while one:
                low = one & -one
                u = low.bit_length() - 1
                one ^= low
                for v in C:
                    if not sq[u - v if u > v else v - u]:
                        reps.setdefault(v, []).append(u)
                        break
            pair = None
            for v, us in reps.items():
                for i in range(len(us)):
                    a = us[i]
                    for b in us[i + 1:]:
                        if sq[a - b if a > b else b - a]:
                            pair = (v, a, b)
                            break
                    if pair:
                        break
                if pair:
                    break
            if pair:
                v, a, b = pair
                C.remove(v)
                C += [a, b]
                continue
            moves = [(v, u) for v, us in reps.items() for u in us if u not in tabu]
            if not moves:
                break
            v, u = moves[rr(len(moves))]
            tabu.add(v)
            C.remove(v)
            C.append(u)
        if len(C) >= K:
            return sorted(C[:K])
    return None


def flower(challenge):
    clock = time.perf_counter
    deadline = clock() + 0.8 * GAME["ms"] / 1000
    sieve = bytearray([0, 0]) + bytearray([1]) * (W - 1)
    for i in range(2, int(W**0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytes(len(range(i * i, W + 1, i)))
    odd_primes = list(itertools.compress(range(3, W + 1), sieve[3:]))
    rr = random.randrange
    cliques = []
    p = START + int(challenge) * 1234567 % (9 * START)
    p += (1 - p) % 4
    while len(cliques) < GAME["max_nodes"]:
        while not is_prime(p):
            p += 4
        c = solve(p, odd_primes, deadline, clock, rr)
        if c is None:
            break
        cliques.append(c)
        p += 4
    return dict(nodes=len(cliques), edges=[[k, k + 1] for k in range(len(cliques) - 1)], labels=cliques)
