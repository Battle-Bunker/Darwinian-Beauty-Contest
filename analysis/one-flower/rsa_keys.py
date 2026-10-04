# Generates RSA keys for sig.mjs and times Pollard rho on balanced semiprimes (pure Python, as a scaffold has).
import json, math, random, sys, time

def is_prime(n):
    if n < 2: return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0: return n == p
    d, s = n - 1, 0
    while d % 2 == 0: d //= 2; s += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41):
        x = pow(a, d, n)
        if x in (1, n - 1): continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1: break
        else: return False
    return True

def prime(bits, rnd):
    while True:
        p = rnd.getrandbits(bits) | (1 << (bits - 1)) | 1
        if is_prime(p) and math.gcd(65537, p - 1) == 1: return p

def rho(n):
    for c in range(1, 100):
        x = y = 2; d = 1
        while d == 1:
            x = (x * x + c) % n; y = (y * y + c) % n; y = (y * y + c) % n
            d = math.gcd(abs(x - y), n)
        if d != n: return d

rnd = random.Random(7)
out = {"keys": {}, "rho": {}}
for bits in (128, 256, 512, 1024):
    p, q = prime(bits // 2, rnd), prime(bits // 2, rnd)
    out["keys"][bits] = {"p": p, "q": q, "n": p * q}
p, q = prime(256, rnd), prime(256, rnd)
out["keys"]["512b"] = {"p": p, "q": q, "n": p * q}   # a second 512-bit key: the next game's, or a rotation
for bits in (40, 48, 56, 64, 72):
    ts = []
    for _ in range(3 if bits < 72 else 1):
        n = prime(bits // 2, rnd) * prime(bits // 2, rnd)
        t = time.process_time(); rho(n); ts.append(time.process_time() - t)
    out["rho"][bits] = sorted(ts)[len(ts) // 2]
json.dump({"keys": {k: {kk: str(vv) for kk, vv in v.items()} for k, v in out["keys"].items()}, "rho": out["rho"]}, sys.stdout)
