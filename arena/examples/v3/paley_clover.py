# Example clover: the Paley clique chain.
#
# Two numbers are "friends" modulo a prime p when their difference is a perfect square mod p
# (Euler's criterion: d is a square mod p exactly when pow(d, (p - 1) // 2, p) == 1).
# For a prime p with p % 4 == 1 this friendship goes both ways, and the friends form the Paley graph.
# A clique is a group of numbers that are all friends with each other.
#
# The challenge n picks a starting point, and from there a chain of primes p0 < p1 < p2 < ...
# (every prime with p % 4 == 1, in order). For each prime in turn, this flower searches for a clique
# of CLIQUE_SIZE numbers, and it answers with as many cliques in a row as it finds before its time is up.
# A bee checks every pair with one pow() each, which is quick. Finding the cliques is the slow part.
import itertools
import random
import time

CLIQUE_SIZE = 17
WINDOW = 32768        # look for cliques among the numbers 0..WINDOW
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
    # The primes p with p % 4 == 1, in order, starting from a point that n picks.
    p = START + n % (9 * START)
    p += (1 - p) % 4
    while True:
        if is_prime(p):
            yield p
        p += 4


FLIP = bytes.maketrans(b"\0\1", b"\1\0")
DIGITS = bytes.maketrans(b"\0\1", b"10")


def square_bits(p, small_primes):
    # Which of 1..WINDOW are squares mod p? Being a square is multiplicative (a non-square times a
    # non-square is a square), so test only the primes with pow() and flip the multiples of each
    # non-square prime power: d ends up a non-square exactly when it has an odd number of
    # non-square prime factors.
    nonsquare = bytearray(WINDOW + 1)
    for q in small_primes:
        if pow(q, (p - 1) // 2, p) != 1:
            power = q
            while power <= WINDOW:
                nonsquare[power::power] = nonsquare[power::power].translate(FLIP)
                power *= q
    right = nonsquare[1:].translate(DIGITS)  # "1" where d = 1, 2, ..., WINDOW is a square
    # One big integer whose bit WINDOW + e is 1 when the difference e (from -WINDOW to WINDOW) is a
    # square. Shifting it right by WINDOW - x gives the bit set of x's friends among 0..WINDOW.
    return int(right[::-1] + b"0" + right, 2)


def find_clique(squares, deadline):
    everyone = (1 << (WINDOW + 1)) - 1

    def friends(x):
        return (squares >> (WINDOW - x)) & everyone

    def random_member(bits):
        r = random.randrange(WINDOW + 1)
        above = bits >> r
        if above:
            return r + (above & -above).bit_length() - 1
        return (bits & -bits).bit_length() - 1

    # Greedy with restarts: start from a random number, then keep adding a friend of everyone so far.
    # Of a few random candidates, take the one that keeps the most candidates for later.
    while time.time() < deadline:
        x = random.randrange(WINDOW + 1)
        clique, candidates = [x], friends(x)
        while candidates:
            options = [random_member(candidates) for _ in range(4)]
            x = max(options, key=lambda y: (candidates & friends(y)).bit_count())
            clique.append(x)
            candidates &= friends(x)
        if len(clique) >= CLIQUE_SIZE:
            return clique[:CLIQUE_SIZE]
    return None


def flower(challenge):
    deadline = time.time() + 0.6 * GAME["ms"] / 1000
    pairs = CLIQUE_SIZE * (CLIQUE_SIZE - 1) // 2
    room = min(GAME["max_nodes"] // CLIQUE_SIZE, 4 * GAME["max_nodes"] // pairs)
    sieve = bytearray([0, 0]) + bytearray([1]) * (WINDOW - 1)
    for i in range(2, int(WINDOW**0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytes(len(range(i * i, WINDOW + 1, i)))
    small_primes = list(itertools.compress(range(WINDOW + 1), sieve))

    labels = []
    for p in itertools.islice(chain_primes(int(challenge)), room):
        clique = find_clique(square_bits(p, small_primes), deadline)
        if clique is None:
            break
        labels += clique
    # Draw each clique as a complete graph: node i is labelled with its number.
    edges = [[start + i, start + j]
             for start in range(0, len(labels), CLIQUE_SIZE)
             for i in range(CLIQUE_SIZE) for j in range(i)]
    return dict(nodes=len(labels), edges=edges, labels=labels)
