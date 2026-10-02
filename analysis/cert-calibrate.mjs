// 4(c) Calibrate costly-but-checkable certificates against the real budgets (cosmos 150 ms, orchid 50 ms, bee 25 ms
// per call; Python runner; one program per core). Flowers run through the engine's own runner: server/runners/proc.js
// with the engine's flower setup (tryFlower's path), one call per challenge, wall time measured around each call
// (that includes the runner's fork, ~1-3 ms). For each certificate and size:
//   solve time distribution with a generous 2 s budget, and the share of challenges answered VALIDLY within the
//   cosmos's 150 ms and the orchid's 50 ms budgets (run with exactly those budgets, so timeouts are the runner's own).
// Bee-side verification is timed in-process (a bee is a persistent process, so no fork), in plain python3.
//
// Certificates:
//   factor star   challenge = p*q (two random b-bit primes, built by the bee; int challenges stop at 2^53)
//                 cosmos: Pollard-Brent rho + Miller-Rabin (the best stdlib-only method); also naive trial division
//   time-lock     2^(2^t) mod N by t sequential squarings; the bee built N = p*q, so it checks with phi(N) in microseconds.
//                 int challenges: N < 2^53 can be factored by rho, which gives an orchid the same shortcut.
//                 str challenges: N of 256 bits as 64 hex characters (cannot be factored), response 64 hex characters
//   hashcash×k    k nonces n_i with sha256(c:i:n_i) ending in d zero bits; no trapdoor, any challenge type;
//                 the sum of k geometric searches concentrates the work (CV ≈ 1/sqrt(k)); response list[int]
//
//   node analysis/cert-calibrate.mjs [trials=40] [sections=star,hashcash,tlock,verify]
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

process.env.CPU_SLOTS ||= "1";
const { ProgramProcess } = await import("../server/runners/proc.js");
const { tryFlower } = await import("../server/engine.js");
const { normalizeConfig } = await import("../server/lib/gameConfig.js");

const TRIALS = Number(process.argv[2] || 40);
const SECTIONS = new Set((process.argv[3] || "star,hashcash,tlock,verify").split(","));
const py = (code) => execFileSync("python3", ["-c", code], { encoding: "utf8" }).trim();

const MR = `
def is_prime(n):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True
`;
const RHO = `import math
${MR}
def brent(n, c):
    y, m, g, r, q = 2, 128, 1, 1, 1
    while g == 1:
        x = y
        for _ in range(r):
            y = (y * y + c) % n
        k = 0
        while k < r and g == 1:
            ys = y
            for _ in range(min(m, r - k)):
                y = (y * y + c) % n
                q = q * abs(x - y) % n
            g = math.gcd(q, n)
            k += m
        r *= 2
    if g == n:
        g = 1
        while g == 1:
            ys = (ys * ys + c) % n
            g = math.gcd(abs(x - ys), n)
    return g


def factor(n):
    if n == 1:
        return []
    if is_prime(n):
        return [n]
    if n % 2 == 0:
        return [2] + factor(n // 2)
    c = 1
    while True:
        d = brent(n, c)
        if d != n:
            return factor(d) + factor(n // d)
        c += 1
`;
const STAR = `
def flower(c):
    fs = sorted(factor(c))
    return {"nodes": 1 + len(fs), "edges": [[0, i + 1] for i in range(len(fs))], "labels": [c] + fs}
`;
const TRIAL = `
def flower(c):
    fs, n, p = [], c, 2
    while p * p <= n:
        while n % p == 0:
            fs.append(p)
            n //= p
        p += 1 if p == 2 else 2
    if n > 1:
        fs.append(n)
    return {"nodes": 1 + len(fs), "edges": [[0, i + 1] for i in range(len(fs))], "labels": [c] + fs}
`;
const HASHCASH = (k, d) => `import hashlib
def flower(c):
    mask = ${(1 << d) - 1}
    out, n = [], 0
    for i in range(${k}):
        pre = (str(c) + ":" + str(i) + ":").encode()
        while int.from_bytes(hashlib.sha256(pre + str(n).encode()).digest()[-4:], "big") & mask:
            n += 1
        out.append(n)
        n += 1
    return out
`;
const TLOCK_STR = (t) => `
def flower(c):
    n = int(c, 16)
    return format(pow(2, 1 << ${t}, n), "x")
`;
const TLOCK_INT = (t) => `
def flower(c):
    return pow(2, 1 << ${t}, c)
`;
const TLOCK_INT_SHORTCUT = (t) => `${RHO}
def flower(c):
    p, q = factor(c)[:2]
    return pow(2, pow(2, ${t}, (p - 1) * (q - 1)), c)
`;

// challenges: semiprimes of two b-bit primes (deterministic per size)
function semiprimes(bits, count, seed) {
  return JSON.parse(py(`import random
${MR}
random.seed(${seed})
def rp(b):
    while True:
        x = random.getrandbits(b) | (1 << (b - 1)) | 1
        if is_prime(x):
            return x
out = []
while len(out) < ${count}:
    p, q = rp(${bits}), rp(${bits})
    if p != q and p * q < 2 ** 53:
        out.append([p * q, p, q])
print(__import__("json").dumps(out))`));
}

async function timeCalls(config, kind, code, challenges, ms) {
  const cfg = normalizeConfig({ ...config, budgets: { [kind]: { ms } } });
  const game = { turns: 1200, feed_cost: 5, challenge_type: cfg.challengeType, response_type: cfg.responseType, max_len: cfg.maxLen, max_nodes: cfg.maxNodes, flowers: 12, ms };
  const proc = new ProgramProcess("python", "flower", { code, ms, game, maxChars: 262144, pure: false, clock: true });
  const load = await proc.ready;
  if (!load.ok) throw new Error(load.e);
  const out = [];
  for (const c of challenges) {
    const t0 = performance.now();
    const res = await proc.call({ c });
    out.push({ ms: performance.now() - t0, v: res.v, e: res.e });
  }
  proc.kill();
  return out;
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const pct = (x) => `${Math.round(100 * x)}%`;

async function calibrate(label, config, code, challenges, valid) {
  const free = await timeCalls(config, "cosmos", code, challenges, 2000);
  const times = free.map((x) => (x.e ? 2000 : x.ms));
  // the real budgets, through the engine's tryFlower path (the runner's own timeout decides)
  const ok = async (kind) => {
    const cfg = normalizeConfig(config);
    let good = 0;
    for (let i = 0; i < challenges.length; i += 50) {
      const r = await tryFlower({ config: cfg, code, kind, challenges: challenges.slice(i, i + 50), nTeams: 6 });
      good += (r.results || []).filter((x, j) => !x.error && valid(challenges[i + j], x.r)).length;
    }
    return good / challenges.length;
  };
  const cosmos = await ok("cosmos"), orchid = await ok("orchid");
  console.log(`${label.padEnd(34)} median ${q(times, 0.5).toFixed(1).padStart(7)} ms  p90 ${q(times, 0.9).toFixed(1).padStart(7)}  p99 ${q(times, 0.99).toFixed(1).padStart(7)}  max ${Math.max(...times).toFixed(1).padStart(7)}  | valid within cosmos 150 ms ${pct(cosmos).padStart(4)}, orchid 50 ms ${pct(orchid).padStart(4)}`);
  return { label, median: q(times, 0.5), p90: q(times, 0.9), p99: q(times, 0.99), max: Math.max(...times), cosmos, orchid };
}

const results = [];
console.log(`# Certificate calibration (${TRIALS} challenges per row; Python runner, CPU_SLOTS=${process.env.CPU_SLOTS})\n`);
if (SECTIONS.has("star")) {
console.log("## Factor star of a semiprime p*q (int -> graph[any]); the bee checks prod(labels) == c and each leaf is prime\n");
const starCfg = { language: "python", challengeType: "int", responseType: "graph[any]" };
const starValid = (ch, r) => r && Array.isArray(r.labels) && r.labels.slice(1).length === 2 && r.labels[1] * r.labels[2] === ch;
for (const bits of [12, 16, 20, 22, 24, 26]) {
  const sp = semiprimes(bits, TRIALS, bits);
  const cs = sp.map((x) => x[0]);
  results.push(await calibrate(`rho, factors of ${bits} bits`, starCfg, RHO + STAR, cs, starValid));
  if (bits <= 22) results.push(await calibrate(`trial division, factors of ${bits} bits`, starCfg, TRIAL, cs, starValid));
}
}

let hashRate = null;
if (SECTIONS.has("hashcash")) {
console.log("\n## Hashcash × k: k nonces whose sha256(c:i:n) ends in d zero bits (int -> list[int]); the bee re-hashes k times\n");
hashRate = Number(py(`import hashlib, time
pre = b"123456789:3:"
t = time.perf_counter(); n = 0
while n < 200000:
    int.from_bytes(hashlib.sha256(pre + str(n).encode()).digest()[-4:], "big") & 4095
    n += 1
print(200000 / (time.perf_counter() - t))`));
console.log(`(python3 here: ${(hashRate / 1e6).toFixed(2)} M hash tries per second)`);
const hcCfg = { language: "python", challengeType: "int", responseType: "list[int]" };
const hcChallenges = Array.from({ length: TRIALS }, (_, i) => 1e12 + i * 7919);
for (const k of [8, 16, 32, 64]) {
  for (const target of [60, 90, 110]) {
    const d = Math.max(1, Math.round(Math.log2((target / 1000) * hashRate / k)));
    const valid = (ch, r) => Array.isArray(r) && r.length === k; // the search is exact by construction; timeouts give no answer
    if (results.some((x) => x.label.startsWith(`hashcash k=${k} d=${d} `))) continue;
    results.push(await calibrate(`hashcash k=${k} d=${d} (mean ≈ ${Math.round((k * 2 ** d) / hashRate * 1000)} ms)`, hcCfg, HASHCASH(k, d), hcChallenges, valid));
  }
}
}

let sqRateStr = null, sqRateInt = null;
if (SECTIONS.has("tlock")) {
console.log("\n## Time-lock 2^(2^t) mod N by t sequential squarings\n");
sqRateStr = Number(py(`import time, random
random.seed(1); n = random.getrandbits(256) | 1
t = time.perf_counter(); pow(2, 1 << 200000, n); print(200000 / (time.perf_counter() - t))`));
sqRateInt = Number(py(`import time, random
random.seed(1); n = random.getrandbits(52) | (1 << 52) | 1
t = time.perf_counter(); pow(2, 1 << 400000, n); print(400000 / (time.perf_counter() - t))`));
console.log(`(python3 here: ${(sqRateStr / 1e6).toFixed(2)} M squarings/s mod a 256-bit N, ${(sqRateInt / 1e6).toFixed(2)} M/s mod a 53-bit N)`);
const tlStr = JSON.parse(py(`import random, json
random.seed(7)
${MR}
def rp(b):
    while True:
        x = random.getrandbits(b) | (1 << (b - 1)) | 1
        if is_prime(x):
            return x
out = []
for _ in range(${TRIALS}):
    p, q = rp(128), rp(128)
    out.append(format(p * q, "x"))
print(json.dumps(out))`));
const tlCfg = { language: "python", challengeType: "str", responseType: "str" };
for (const target of [80, 100]) {
  const t = Math.round((target / 1000) * sqRateStr);
  results.push(await calibrate(`str, N 256-bit, t=${t}`, tlCfg, TLOCK_STR(t), tlStr, (ch, r) => typeof r === "string" && r.length > 0));
}
const tInt = Math.round(0.1 * sqRateInt);
const tlInt = semiprimes(26, TRIALS, 99).map((x) => x[0]);
const intCfg = { language: "python", challengeType: "int", responseType: "int" };
results.push(await calibrate(`int, N < 2^53, t=${tInt}: cosmos`, intCfg, TLOCK_INT(tInt), tlInt, (ch, r) => Number.isInteger(r)));
results.push(await calibrate(`int, N < 2^53, t=${tInt}: rho shortcut`, intCfg, TLOCK_INT_SHORTCUT(tInt), tlInt, (ch, r) => Number.isInteger(r)));
}

let v = null;
if (SECTIONS.has("verify")) {
console.log("\n## Bee-side verification, in-process python3 (median of 2000 calls)\n");
const verify = py(`import time, hashlib, random, json
${MR}
def med(f, xs):
    ts = []
    for x in xs:
        t = time.perf_counter(); f(x); ts.append(time.perf_counter() - t)
    ts.sort(); return ts[len(ts) // 2] * 1000
random.seed(3)
def rp(b):
    while True:
        x = random.getrandbits(b) | (1 << (b - 1)) | 1
        if is_prime(x):
            return x
stars = []
for _ in range(2000):
    p, q = rp(26), rp(26)
    stars.append([p * q, p, q])
star = med(lambda s: s[1] * s[2] == s[0] and is_prime(s[1]) and is_prime(s[2]), stars)
def hc(k, d):
    mask = (1 << d) - 1
    c = 123456789
    ns = list(range(k))
    return med(lambda _: sum(int.from_bytes(hashlib.sha256((str(c) + ":" + str(i) + ":" + str(n)).encode()).digest()[-4:], "big") & mask for i, n in enumerate(ns)), range(2000))
p, q = rp(128), rp(128)
N, phi = p * q, (p - 1) * (q - 1)
tl = med(lambda t: pow(2, pow(2, t, phi), N), [2000000 + i for i in range(2000)])
print(json.dumps({"star": star, "hc8": hc(8, 12), "hc32": hc(32, 10), "hc64": hc(64, 9), "tlock": tl}))`);
v = JSON.parse(verify);
console.log(`factor star (multiply + 2 Miller-Rabin tests, 26-bit primes): ${v.star.toFixed(3)} ms`);
console.log(`hashcash k=8 / 32 / 64 (k sha256 checks): ${v.hc8.toFixed(3)} / ${v.hc32.toFixed(3)} / ${v.hc64.toFixed(3)} ms`);
console.log(`time-lock with phi(N), 256-bit N: ${v.tlock.toFixed(3)} ms`);
console.log("(bee budget: 25 ms per call)");
}
const fs = await import("node:fs");
fs.writeFileSync(new URL(`../arena/runs/cert-calibrate${SECTIONS.size < 4 ? "-" + [...SECTIONS].join("-") : ""}.json`, import.meta.url), JSON.stringify({ results, verify: v, hashRate, sqRateStr, sqRateInt }));
