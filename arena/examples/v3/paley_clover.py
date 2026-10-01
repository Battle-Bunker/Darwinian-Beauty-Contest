# Example clover: the Paley clique chain.
#
# Two numbers are "friends" modulo a prime p when their difference is a perfect square mod p
# (Euler's criterion: d is a square mod p exactly when pow(d, (p - 1) // 2, p) == 1).
# For a prime p with p % 4 == 1 this friendship goes both ways, and the friends form the Paley graph.
# A clique is a group of numbers that are all friends with each other.
#
# The challenge n picks a starting point, and from there a chain of primes p0 < p1 < p2 < ...
# (every prime with p % 4 == 1, in order). For each prime in turn, this flower searches for a clique
# of CLIQUE_SIZE numbers. It answers with as many cliques in a row as it finds before its time is up:
# a path of nodes, where node k is labelled with the clique for the k-th prime.
# A bee checks every pair with one pow() each, which is quick. Finding the cliques is the slow part.
import itertools
import random
import time

CLIQUE_SIZE = 24
WINDOW = 24576        # look for cliques among the numbers 0..WINDOW
START = 10**7         # the chain starts somewhere from 10**7 to 10**8, chosen by n


def is_prime(m):
    # Miller-Rabin with bases 2, 3, 5, 7: exact for every m below 3,215,031,751.
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


def chain_primes(n):
    # The primes p with p % 4 == 1, in order, from a starting point that n picks. Multiplying by
    # 1234567 first sends nearby challenges to unrelated starting points.
    p = START + n * 1234567 % (9 * START)
    p += (1 - p) % 4
    while True:
        if is_prime(p):
            yield p
        p += 4


FLIP = bytes.maketrans(b"\0\1", b"\1\0")
DIGITS = bytes.maketrans(b"\0\1", b"10")


def squares_mod(p, odd_primes):
    # Which of 1..WINDOW are squares mod p? Being a square is multiplicative (a non-square times a
    # non-square is a square), so we only test primes, then flip the multiples of each non-square
    # prime power: d ends up a non-square when it has an odd number of non-square prime factors.
    # Testing a prime q uses quadratic reciprocity: when p % 4 == 1, q is a square mod p exactly when
    # p % q is a square mod q (a much smaller pow), and 2 is a square mod p exactly when p % 8 == 1.
    nonsquare = bytearray(WINDOW + 1)
    for q in ([2] if p % 8 != 1 else []) + [q for q in odd_primes if pow(p % q, (q - 1) // 2, q) != 1]:
        power = q
        while power <= WINDOW:
            nonsquare[power::power] = nonsquare[power::power].translate(FLIP)
            power *= q
    square = nonsquare.translate(FLIP)  # square[d] == 1 when d is a square (and d > 0)
    square[0] = 0
    right = square[1:].translate(DIGITS)
    # One big integer whose bit WINDOW + e is 1 when the difference e (from -WINDOW to WINDOW) is a
    # square. Shifting it right by WINDOW - x gives the set of x's friends among 0..WINDOW, as bits.
    return square, int(right[::-1] + b"0" + right, 2)


def find_clique(p, odd_primes, deadline):
    square, pattern = squares_mod(p, odd_primes)
    everyone = (1 << (WINDOW + 1)) - 1

    def friends(x):
        return (pattern >> (WINDOW - x)) & everyone

    def random_member(bits):
        r = random.randrange(WINDOW + 1)
        above = bits >> r
        if above:
            return r + (above & -above).bit_length() - 1
        return (bits & -bits).bit_length() - 1

    def members(bits):
        found = []
        while bits:
            lowest = bits & -bits
            found.append(lowest.bit_length() - 1)
            bits ^= lowest
        return found

    def grow(clique, candidates):
        # Greedy: keep adding a candidate (a friend of every member). Of a few random candidates,
        # take the one that leaves the most candidates for later.
        while candidates:
            x = max((random_member(candidates) for _ in range(4)),
                    key=lambda y: (candidates & friends(y)).bit_count())
            clique.append(x)
            candidates &= friends(x)
        return clique

    while time.time() < deadline:
        start = random.randrange(WINDOW + 1)
        clique = grow([start], friends(start))
        swapped_out = set()
        for _ in range(200):
            if len(clique) >= CLIQUE_SIZE or time.time() > deadline:
                break
            # Sort every number by how many members it is NOT friends with: none, exactly one, more.
            none_missed, one_missed = everyone, 0
            for v in clique:
                f = friends(v)
                one_missed = (one_missed & f) | (none_missed & ~f)
                none_missed &= f
            if none_missed:
                clique = grow(clique, none_missed)
                continue
            # A number that misses only member v could take v's place.
            replacements = {}
            for u in members(one_missed):
                v = next(v for v in clique if not square[abs(u - v)])
                if v != u:
                    replacements.setdefault(v, []).append(u)
            # If two of v's replacements are friends, swapping v out for both makes the clique bigger.
            pair = next(((v, a, b) for v, us in replacements.items()
                         for a, b in itertools.combinations(us, 2) if square[abs(a - b)]), None)
            if pair:
                v, a, b = pair
                clique = [w for w in clique if w != v] + [a, b]
                continue
            # Otherwise swap one member for one replacement (never bringing back one swapped out).
            moves = [(v, u) for v, us in replacements.items() for u in us if u not in swapped_out]
            if not moves:
                break
            v, u = random.choice(moves)
            swapped_out.add(v)
            clique = [w for w in clique if w != v] + [u]
        if len(clique) >= CLIQUE_SIZE:
            return sorted(clique[:CLIQUE_SIZE])
    return None


def flower(challenge):
    deadline = time.time() + 0.6 * GAME["ms"] / 1000
    sieve = bytearray([0, 0]) + bytearray([1]) * (WINDOW - 1)
    for i in range(2, int(WINDOW**0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytes(len(range(i * i, WINDOW + 1, i)))
    odd_primes = list(itertools.compress(range(3, WINDOW + 1), sieve[3:]))

    cliques = []
    for p in itertools.islice(chain_primes(int(challenge)), GAME["max_nodes"]):
        clique = find_clique(p, odd_primes, deadline)
        if clique is None:
            break
        cliques.append(clique)
    edges = [[k, k + 1] for k in range(len(cliques) - 1)]
    return dict(nodes=len(cliques), edges=edges, labels=cliques)
