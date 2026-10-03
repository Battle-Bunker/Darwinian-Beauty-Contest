# Bee-side checkers for the two example cosmos flowers. Plain code with no imports: paste what you need.
# Each takes the challenge you asked and the response you got, and returns a quality score
# (higher is better), or None when the response is not a well-formed answer of that kind.


# ---- Paley clique chain (paley_cosmos.py) ----

CLIQUE_SIZE = 18
START = 10**8


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


def check_paley(challenge, response, enough=None):
    # How many cliques in a row, from the start of the chain, are real: node k's label must be
    # CLIQUE_SIZE whole numbers whose differences are all squares mod the k-th prime of the chain.
    # Each clique costs 153 pow() calls (about 0.2 ms), so pass enough=k to stop counting at k.
    try:
        score = 0
        for clique, p in zip(response["labels"], chain_primes(challenge)):
            if len(clique) != CLIQUE_SIZE or not all(type(x) is int for x in clique):
                break
            half = (p - 1) // 2
            if any(pow(a - b, half, p) != 1 for i, a in enumerate(clique) for b in clique[:i]):
                break
            score += 1
            if score == enough:
                break
        return score
    except Exception:
        return None


# ---- Graceful labelling (graceful_cosmos.py) ----

VERTICES = 512


def build_links(n):
    t = n + 2**64
    links = [(0, 1)]
    for i in range(2, VERTICES):
        first = t % i
        second = t // i % (i - 1)
        if second >= first:
            second += 1
        links += [(first, i), (second, i)]
    return links


def check_graceful(challenge, response):
    # How many different differences |label(a) - label(b)| the graph's links show (at most 1021),
    # provided the response is exactly the graph n builds, with different labels from 0..1021.
    links = build_links(challenge)
    try:
        labels = response["labels"]
        if (response["nodes"] != VERTICES or len(response["edges"]) != len(links)
                or {(min(e), max(e)) for e in response["edges"]} != set(links)
                or len(labels) != VERTICES or len(set(labels)) != VERTICES
                or not all(type(x) is int and 0 <= x <= len(links) for x in labels)):
            return None
    except Exception:
        return None
    return len({abs(labels[a] - labels[b]) for a, b in links})
