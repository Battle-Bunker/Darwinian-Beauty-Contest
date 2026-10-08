# Concern 1: what does it cost a forger to make its own key pair whose b-byte fingerprint equals a trusted key's?
# A trial = a new key the forger can sign with + one fingerprint. Families (fastest first):
#   nonce:  the key has a free field the fingerprint covers (e.g. a name or a varying public exponent e): 1 hash
#   rsa-n:  n_i = P * q_i over a sieve of primes q_i (the forger knows phi(n_i), so it can sign): 1 bigmul + 1 hash
#   dl-inc: discrete-log keys y_{x+1} = y_x * g mod p (the forger knows x): 1 mulmod + 1 hash
#   dl-pow: y = g^x mod p, a fresh exponentiation per key (a naive forger): 1 modexp + 1 hash
# Also: one iteration of sha256 key stretching (what a bee can afford inside its 50 ms).
# Prints trials per second for each family and each modulus size, single core, pure Python.
import hashlib, json, os, random, sys, time

def rate(fn, seconds=1.0):
    n, t0 = 0, time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        fn(1000); n += 1000
    return n / (time.perf_counter() - t0)

def fp(b):
    return hashlib.sha256(b).digest()

out = {}
P = random.getrandbits(256) | 1
for bits in (256, 512, 2048):
    p = random.getrandbits(bits) | (1 << (bits - 1)) | 1
    g = 5
    key = os.urandom(bits // 8)
    def nonce(k, key=key):
        for i in range(k): fp(key + i.to_bytes(8, "big"))
    def rsa_n(k, P=random.getrandbits(bits // 2) | 1):
        for i in range(k): fp((P * (1000003 + 2 * i)).to_bytes(bits // 8 + 8, "big"))
    y = [pow(g, random.getrandbits(256), p)]
    def dl_inc(k, p=p, g=g, nb=bits // 8):
        v = y[0]
        for i in range(k):
            v = v * g % p
            fp(v.to_bytes(nb, "big"))
        y[0] = v
    def dl_pow(k, p=p, g=g, nb=bits // 8):
        for i in range(k // 100 or 1):
            fp(pow(g, random.getrandbits(256), p).to_bytes(nb, "big"))
    r_pow = rate(dl_pow, 0.5) / 100  # dl_pow does k/100 keys per k
    out[bits] = {"nonce": rate(nonce), "rsa-n": rate(rsa_n), "dl-inc": rate(dl_inc), "dl-pow": r_pow}
h = [b"x" * 32]
def stretch(k):
    v = h[0]
    for i in range(k): v = hashlib.sha256(v).digest()
    h[0] = v
out["stretch"] = rate(stretch)
# Measured end-to-end: find a 2-byte and a 3-byte collision against a random target, nonce family, 512-bit key.
key = os.urandom(64)
for b in (2, 3):
    target = os.urandom(b)
    t0 = time.process_time(); i = 0
    while fp(key + i.to_bytes(8, "big"))[:b] != target: i += 1
    out[f"found{b}"] = {"trials": i, "cpu_s": time.process_time() - t0}
json.dump(out, sys.stdout)
