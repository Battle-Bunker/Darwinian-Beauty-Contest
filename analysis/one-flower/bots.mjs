// Scripted Python bots for the real engine (int → int). Programs take the ledger argument of the engine at
// 2661f14 (`flower(c, ledger)`, `decide(c, r, ledger)`); the HISTORY interface that replaces it carries the
// same records, so the logic carries over unchanged.
//
// Flowers answer with a team rule r = c·K mod M (M = 1,000,003, prime). One (c, r) pair reveals K, so any bee
// (and any flower) can learn a flower's rule from public history: the rule is that flower's signal.
// A keyed handshake (sha256 with a team secret) lets a team's bee and flower recognise each other exactly:
// the bee's challenge carries a 20-bit tag, and the flower answers its own bee with a 40-bit MAC (>= M, so
// it can't be mistaken for a rule answer). Rivals see every tag and MAC in public but can't make new ones.

export const M = 1000003;

const handshakeFlower = (key, pOwn) => `
    t = c & 1048575
    n = c >> 20
    if n > 0 and t == int(hashlib.sha256(b"${key}t%d" % n).hexdigest()[:5], 16):
        return M + int(hashlib.sha256(b"${key}r%d" % c).hexdigest()[:10], 16), ${pOwn}`;

/**
 * kind: "rule" (answers c·K mod M), "mimic" (reads the ledger, finds the rival flower with the best mean percent
 * on rival feeds, learns its K and answers with it), "pow" (hashcash until `powMs` of CPU, then the rule).
 */
export function flowerCode({ K, pct, kind = "rule", handshake = null, pOwn = 50, powMs = 125, rotate = 20, seed = "rot" }) {
  const head = `import hashlib, time\nM = ${M}\n`;
  const hs = handshake ? handshakeFlower(handshake, pOwn) : "";
  if (kind === "rule") return `${head}def flower(c, ledger):${hs}\n    return c * ${K} % M, ${pct}\n`;
  if (kind === "pow") return `${head}def flower(c, ledger):${hs}
    t = time.process_time()
    k = 0
    while time.process_time() - t < ${powMs / 1000}:
        hashlib.sha256(b"%d:%d" % (c, k)).digest()
        k += 1
    return c * ${K} % M, ${pct}
`;
  if (kind === "rotating") return `${head}def flower(c, ledger):${hs}
    rnd = (ledger[-1]["round"] if ledger else 0) + 1
    k = int(hashlib.sha256(b"${seed}%d" % (rnd // ${rotate})).hexdigest()[:6], 16) % (M - 1) + 1
    return c * k % M, ${pct}
`;
  if (kind === "mimic") return `${head}def flower(c, ledger):${hs}
    me = GAME["team"]
    tot = {}
    k = {}
    for e in ledger[-600:]:
        f = e["flower"]
        if f == me or e["response"] is None or e["response"] >= M or e["challenge"] % M == 0:
            continue
        k[f] = e["response"] * pow(e["challenge"] % M, M - 2, M) % M
        if e["fed"] and e["bee"] != f:
            s = tot.get(f, [0, 0])
            tot[f] = [s[0] + e["percent"], s[1] + 1]
    best = max(tot, key=lambda f: tot[f][0] / tot[f][1], default=None)
    return c * k.get(best, ${K}) % M, ${pct}
`;
  throw new Error(kind);
}

/**
 * kind: "naive" (feeds at every flower), "self" (feeds only at its own flower, by the handshake),
 * "greedy" (the model's greedy bee: values each signal by the change in its team's fitness from feeding at
 * the flowers known to show it, at their last public percent to rival bees, and feeds iff the signal in front
 * of it is in the set that maximises the renewal reward rate), "thresh" (own flower, and signals whose
 * flowers' mean last percent >= theta).
 * Feeding at its own flower: with a handshake it recognises it exactly; without one it treats it like any other.
 */
export function beeCode({ kind, handshake = null, pOwn = 50, theta = 20, prior = 30, feedCost = 10, stateless = true }) {
  return `import hashlib, math, random
M = ${M}
KEY = ${handshake ? `b"${handshake}"` : "None"}
ME = GAME["team"]
N = GAME["teams"]
done = 0
feeds = [[0] * N for _ in range(N)]
nectar = [[0.0] * N for _ in range(N)]
pollen = [[0.0] * N for _ in range(N)]
lastp = [None] * N
laste = [None] * N
seen = {}                     # rule K -> {flower: round last seen}

def challenge():
    n = random.randint(1, 1 << 30)
    if KEY is None:
        return n
    return (n << 20) | int(hashlib.sha256(KEY + b"t%d" % n).hexdigest()[:5], 16)

def first(ledger):
    return challenge()

def own_mac(c, r):
    return KEY is not None and r is not None and r == M + int(hashlib.sha256(KEY + b"r%d" % c).hexdigest()[:10], 16)

def rule_of(c, r):
    if r is None or r >= M or r < 0 or c % M == 0:
        return None
    return r * pow(c % M, M - 2, M) % M

def catch_up(ledger):
    global done
    if ${stateless ? "True" : "False"}:
        # Nothing carries over between calls (the bee's MEMORY is ~1 KB): rebuild from the full history.
        done = 0
        for row in feeds + nectar + pollen:
            row[:] = [0 * v for v in row]
        lastp[:] = [None] * N
        laste[:] = [None] * N
        seen.clear()
    for e in ledger[done:]:
        b, f = e["bee"], e["flower"]
        k = rule_of(e["challenge"], e["response"])
        if k is not None:
            seen.setdefault(k, {})[f] = e["round"]
        if e["fed"]:
            x = e["nectar"] or 0.0
            y = e["pollen"] if "pollen" in e else e.get("surplus", 0.0)
            feeds[b][f] += 1
            nectar[b][f] += x
            pollen[b][f] += y
            if b != f:
                lastp[f] = e["percent"]
            laste[f] = e["energy"]
    done = len(ledger)

def fitness_after(b, g, x, y):
    P = [sum(math.sqrt(pollen[i][f]) for i in range(N)) for f in range(N)]
    F = [sum(math.sqrt(v) for v in nectar[i]) for i in range(N)]
    dP = math.sqrt(pollen[b][g] + y) - math.sqrt(pollen[b][g])
    dF = math.sqrt(nectar[b][g] + x) - math.sqrt(nectar[b][g])
    tP, tF = sum(P), sum(F)
    now = N * N * (P[ME] / tP if tP > 0 else 1 / N) * (F[ME] / tF if tF > 0 else 1 / N)
    Pi = P[ME] + (dP if g == ME else 0)
    Fi = F[ME] + dF
    after = N * N * (Pi / (tP + dP) if tP + dP > 0 else 1 / N) * (Fi / (tF + dF) if tF + dF > 0 else 1 / N)
    return after - now

def value(g, own):
    p = ${pOwn} if own else (lastp[g] if lastp[g] is not None else ${prior})
    es = [e for e in laste if e is not None]
    E = laste[g] if laste[g] is not None else (sum(es) / len(es) if es else 150000.0)
    return fitness_after(ME, g, p / 100 * E, (1 - p / 100) * E)

def flowers_showing(k, rnd):
    # flowers that showed rule k recently (a mimic may have taken it up); own flower excluded with a handshake
    s = [f for f, r in seen.get(k, {}).items() if r >= rnd - 300 and not (KEY is not None and f == ME)]
    return s

def decide(c, r, ledger):
    kind = "${kind}"
    own = own_mac(c, r)
    nxt = challenge()
    if kind == "naive":
        return "feed", nxt
    if kind == "self":
        return ("feed" if own else "leave"), nxt
    catch_up(ledger)
    rnd = ledger[-1]["round"] if ledger else 0
    k = rule_of(c, r)
    if kind == "thresh":
        if own:
            return "feed", nxt
        fs = flowers_showing(k, rnd) if k is not None else []
        p = sum(lastp[f] if lastp[f] is not None else ${prior} for f in fs) / len(fs) if fs else ${prior}
        return ("feed" if p >= ${theta} else "leave"), nxt
    # greedy: the classes it can meet now are its own flower (by handshake) and the rules in circulation
    classes = []
    here = None
    if KEY is not None:
        d = value(ME, True)
        classes.append((1 / N, d))
        if own:
            here = d
    cur = {}
    for kk, fl in seen.items():
        for f, rr in fl.items():
            if rr >= rnd - 300 and not (KEY is not None and f == ME):
                cur.setdefault(kk, []).append(f)
    for kk, fs in cur.items():
        d = sum(value(f, False) for f in fs) / len(fs)
        classes.append((len(fs) / N, d))
        if kk == k and not own:
            here = d
    if here is None and not own:
        # a rule nobody has shown recently: any rival, at the prior
        rivals = [f for f in range(N) if f != ME]
        es = [e for e in laste if e is not None]
        E = sum(es) / len(es) if es else 150000.0
        here = sum(fitness_after(ME, f, ${prior} / 100 * E, (1 - ${prior} / 100) * E) for f in rivals) / len(rivals)
    best, cut, sp, sv = -1e18, 1e18, 0.0, 0.0
    for pi, d in sorted([x for x in classes if x[1] > 0], key=lambda x: -x[1]):
        sp += pi
        sv += pi * d
        rate = sv / (1 + ${feedCost} * sp)
        if rate > best:
            best, cut = rate, d
    feed = here is not None and here > 0 and (here >= cut or not classes)
    return ("feed" if feed else "leave"), nxt
`;
}
