// 4(b) + "what breaks identity linkage": rules that restrict which challenges a bee may ask, against clover strategies
// that try to stay recognisable. Scripted on the real engine (no LLMs, no database); every bee complies bee-side.
//
// Rules (bee behaviour):
//   R0  no rule (baseline). The bee asks a secret probe p_r, new each round (what the best v2 bees did), at every
//       visit; at a face it hasn't judged this round it also asks last round's probe p_{r-1} once (cross-round
//       probe reuse) to carry the verdict over.
//   R1  no challenge twice per bee per game (the soft "per round" version allows the same linkage here). The bee asks
//       distinct challenges inside one bucket of 2^24 numbers per round; a new face also gets one fresh challenge in
//       last round's bucket (the cross-round link).
//   R2  the engine draws every challenge uniformly from [0, 2^53); the bee only chooses how many and whether to feed.
//   R3  R2, and the bee is stateless within a round: each visit is judged from MEMORY (all earlier rounds, including
//       every taste) plus the current visit only.
// Clover strategies (one team each; response = list[int]):
//   HASH    [H(k, c)]                      keyed hash of the exact challenge
//   TWIN    HASH, and the orchid is an exact copy of the clover
//   COARSE  [H(k, c // 2^24)]               keyed hash of a coarsened challenge: nearby challenges give one answer
//   SALT    [S_r, H(k, c)]                 a header S_r that is fresh every round (1 literal edit per round)
//   STYLE   [T, H(k, c)]                   a header T that is fixed all game (a copyable style)
//   CHAIN   [s_r, H(k, c)]                 a hash chain: s_{r-1} = G(s_r), revealed one link per round, so a bee that
//                                          trusted s_{r-1} can verify s_r, but nobody can compute s_r from s_{r-1}
//   CERT    [-1, nonce]                    a checkable certificate: G(c, nonce) ends in 8 zero bits (here cheap to
//                                          make; 4(c) calibrates real costly ones); orchids can't make one
//   MIMIC   clover HASH; orchid from round 2 wears last round's costumes by c mod 3: STYLE's T, SALT's S_{r-1},
//           CHAIN's s_{r-1}
// Every other orchid is honest (its own keys/headers; CERT's orchid sends an invalid certificate).
// Bees (identical in every team) recognise their own flowers, check certificates, key a nectar tally on the answer
// (1-element answers) or its header, follow chains (a header whose G-image they trusted earlier inherits that
// verdict; a header whose successor has appeared is stale), feed a known key while ≥ 75% paid, and taste unknown keys
// while unknowns have paid ≥ 40% (R3: with probability 0.5, or 0.1 once unknowns stop paying).
//
//   node analysis/identity-rules-sim.mjs [seeds=2] [rounds=4] [rules=R0,R1,R2,R3]
import { playGame, summarise, H40, PY_H40, mean, sd, f2, f3 } from "./sim-lib.mjs";

const SEEDS = Number(process.argv[2] || 2), ROUNDS = Number(process.argv[3] || 4);
const RULES = (process.argv[4] || "R0,R1,R2,R3").split(",");
const STRATS = ["HASH", "TWIN", "COARSE", "SALT", "STYLE", "CHAIN", "CERT", "MIMIC"];
const N = STRATS.length;
const B = 2 ** 24;
const config = { language: "python", challengeType: "int", responseType: "list[int]", turnsPerFlower: 100, feedCost: 5, rounds: ROUNDS };
const G = (x) => H40("chain", x);

// per-team, per-round constants
function constants(seed) {
  const salt = (t, r, who) => H40(`salt-${seed}-${t}-${who}`, r);
  const chain = (t, who) => { const s = new Array(ROUNDS + 2); s[ROUNDS] = H40(`chainseed-${seed}-${t}-${who}`, 0); for (let r = ROUNDS - 1; r >= 1; r--) s[r] = G(s[r + 1]); return s; };
  return { salt, chainC: chain(5, "c"), chainO: chain(5, "o"), tag: H40(`tag-${seed}`, 4), tagO: H40(`tagO-${seed}`, 4) };
}

// Python flower bodies (one expression or a few lines inside def flower(c))
function flowers(i, r, K) {
  const kc = `"c${i}"`, ko = `"o${i}"`;
  const h = (k) => `H40(${k}, c)`;
  switch (STRATS[i]) {
    case "HASH": case "MIMIC": return { clover: `return [${h(kc)}]`, orchid: STRATS[i] === "HASH" || r === 1 ? `return [${h(ko)}]` : null };
    case "TWIN": return { clover: `return [${h(kc)}]`, orchid: `return [${h(kc)}]` };
    case "COARSE": return { clover: `return [H40(${kc}, c // ${B})]`, orchid: `return [H40(${ko}, c // ${B})]` };
    case "SALT": return { clover: `return [${K.salt(i, r, "c")}, ${h(kc)}]`, orchid: `return [${K.salt(i, r, "o")}, ${h(ko)}]` };
    case "STYLE": return { clover: `return [${K.tag}, ${h(kc)}]`, orchid: `return [${K.tagO}, ${h(ko)}]` };
    case "CHAIN": return { clover: `return [${K.chainC[r]}, ${h(kc)}]`, orchid: `return [${K.chainO[r]}, ${h(ko)}]` };
    case "CERT": return { clover: `n = 0\nwhile H40("cert:" + str(c), n) % 256:\n    n += 1\nreturn [-1, n]`, orchid: `return [-1, ${h(ko)} % 1048576]` };
  }
}
function mimicOrchid(r, K) {
  // wears last round's costumes: STYLE's tag, SALT's S_{r-1}, CHAIN's s_{r-1}
  return `k = c % 3\nhdr = ${K.tag} if k == 0 else (${K.salt(3, r - 1, "c")} if k == 1 else ${K.chainC[r - 1]})\nreturn [hdr, H40("o7", c)]`;
}
const indent = (body) => body.split("\n").join("\n    ");
const flowerCode = (body) => `import hashlib\n${PY_H40}\ndef flower(c):\n    ${indent(body)}\n`;

function beeCode(i, r, rule, K) {
  const f = flowers(i, r, K);
  const own = indent;
  const orchidBody = STRATS[i] === "MIMIC" && r > 1 ? mimicOrchid(r, K) : f.orchid;
  return `import hashlib, random
${PY_H40}
RULE = "${rule}"
ME = "${i}"
R = len(MEMORY) + 1
B = ${B}


def G(x):
    return H40("chain", x)


def own_clover(c):
    ${own(f.clover)}


def own_orchid(c):
    ${own(orchidBody)}


def cert_ok(c, a):
    return len(a) == 2 and a[0] == -1 and H40("cert:" + str(c), a[1]) % 256 == 0


def probe(r):
    return 10 ** 12 + H40("probe-" + ME, r) % 10 ** 12


def bucket(r):
    return 1 + H40("bucket-" + ME, r) % (2 ** 27)


# verdicts carried from earlier rounds: key -> [fed, paid]. stale: chain headers, which an honest chain clover never
# shows again in a later round (a chain alias still reaches them).
prev, stale, unk = {}, set(), [0, 0]
if MEMORY:
    m = MEMORY[-1]
    prev = {k: list(v) for k, v in m["prev"].items()}
    stale = set(m["stale"])
    unk = list(m["unk"])
    for keys, nectar in m["log"]:
        for k in keys:
            if k != "?":
                s = prev.setdefault(k, [0, 0])
                s[0] += 1
                s[1] += 1 if nectar else 0
        if keys[-1] == "?":
            unk[0] += 1
            unk[1] += 1 if nectar else 0
    for k, p in m["links"]:
        stale.add(k)
        stale.add(p)
cur = {}            # this round's tally (never read under R3)
unk_now = [0, 0]    # this round's tastes at unknown keys (never read under R3)
stale_now = set()   # chain predecessors seen superseded this round (never read under R3)
links = []          # [header, predecessor] chain links seen this round
log = []            # every taste this round: [keys, nectar]
visit_no = [0]


def key_of(a):
    return ("h" if len(a) >= 2 else "a") + str(a[0])


def verdict(k, a):
    # this round's tally first (not under R3), then a chain predecessor, then the same key from earlier rounds
    if RULE != "R3" and k in cur:
        return cur[k], None
    if len(a) >= 2:
        p = "h" + str(G(a[0]))
        if p in prev:
            return prev[p], p
    if k in prev and k not in stale and not (RULE != "R3" and k in stale_now):
        return prev[k], None
    return None, None


def first_challenge():
    if RULE == "R0":
        return probe(R)
    if RULE == "R1":
        visit_no[0] += 1
        return bucket(R) * B + visit_no[0]
    return random.randint(0, 2 ** 53 - 1)


def link_challenge():
    if RULE == "R0":
        return probe(R - 1)
    return bucket(R - 1) * B + 2 ** 23 + visit_no[0]


def forage(seen, turns_left, visit):
    if visit["fed"]:
        return "leave"
    if not seen:
        return ["ask", first_challenge()]
    c, a = seen[0]
    if not a:
        return "leave"
    if a == own_clover(c):
        return "feed"
    if a == own_orchid(c) or turns_left < GAME["feed_cost"] + 2:
        return "leave"
    if a[0] == -1:
        return "feed" if cert_ok(c, a) else "leave"
    k = key_of(a)
    v, via = verdict(k, a)
    if via and RULE != "R3":
        stale_now.add(via)
    if v is None and len(a) == 1 and RULE in ("R0", "R1") and R > 1:
        # cross-round link: ask last round's probe (R0) or a fresh number in last round's bucket (R1) once per face
        if len(seen) == 1:
            return ["ask", link_challenge()]
        lk = key_of(seen[1][1]) if seen[1][1] else None
        v = list(prev[lk]) if lk in prev else [0, 0]
        cur[k] = v
    if v is not None and v[0] > 0:
        return "feed" if v[1] >= 0.75 * v[0] else "leave"
    if RULE == "R3":
        est = (unk[1] + 1) / (unk[0] + 2)
        return "feed" if random.random() < (0.5 if est >= 0.4 else 0.1) else "leave"
    est = (unk[1] + unk_now[1] + 1) / (unk[0] + unk_now[0] + 2)
    return "feed" if est >= 0.4 else "leave"


def tasted(seen, nectar):
    c, a = seen[0]
    if not a or a[0] == -1 or a == own_clover(c):
        return
    k = key_of(a)
    v, via = verdict(k, a)
    ks = [k]
    if via:
        links.append([k, via])
    if v is None or v[0] == 0:
        ks.append("?")
    log.append([ks, bool(nectar)])
    if RULE != "R3":
        base = v if v is not None else [0, 0]
        cur[k] = [base[0] + 1, base[1] + (1 if nectar else 0)]
        if ks[-1] == "?":
            unk_now[0] += 1
            unk_now[1] += 1 if nectar else 0
`;
}

function programsFor(rule, seed) {
  const K = constants(seed);
  return (r) => STRATS.map((s, i) => {
    const f = flowers(i, r, K);
    const orchidBody = s === "MIMIC" && r > 1 ? mimicOrchid(r, K) : f.orchid;
    return { clover: flowerCode(f.clover), orchid: flowerCode(orchidBody), bee: beeCode(i, r, rule, K) };
  });
}

console.log(`# Identity rules: ${N} teams (${STRATS.join(", ")}), ${ROUNDS} rounds, ${SEEDS} seeds per rule; fed rates are by RIVAL bees\n`);
const all = {};
for (const rule of RULES) {
  const acc = { perTeam: STRATS.map(() => ({ cf: [], of: [], allure: [], forage: [], fit: [], cfLast: [], ofLast: [] })), gap: [], prec: [], npt: [], fitSd: [], errors: 0, problems: [] };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const t0 = Date.now();
    const g = await playGame({ config, nTeams: N, rounds: ROUNDS, seed, programsFor: programsFor(rule, seed) });
    const s = summarise(g.history, N), sl = summarise(g.history, N, { rounds: [ROUNDS] });
    STRATS.forEach((_, i) => {
      const p = acc.perTeam[i];
      p.cf.push(s.flower[i].cloverFed); p.of.push(s.flower[i].orchidFed); p.cfLast.push(sl.flower[i].cloverFed); p.ofLast.push(sl.flower[i].orchidFed);
      p.allure.push(g.scores[i].allureShare * N); p.forage.push(g.scores[i].forageShare * N); p.fit.push(g.scores[i].fitness);
    });
    acc.gap.push(mean(s.bee.map((b) => b.gap))); acc.prec.push(mean(s.bee.map((b) => b.precRival))); acc.npt.push(mean(s.bee.map((b) => b.nectarPerTurn)));
    acc.fitSd.push(sd(g.scores.map((x) => x.fitness)));
    acc.errors += s.bee.reduce((a, b) => a + b.errors, 0);
    acc.problems.push(...g.history.flatMap((h) => h.problems));
    process.stderr.write(`${rule} seed ${seed}: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
  all[rule] = acc;
  console.log(`## ${rule}   bees: rival gap ${f2(mean(acc.gap))}, rival precision ${f2(mean(acc.prec))}, nectar/turn ${f3(mean(acc.npt))}; fitness SD ${f2(mean(acc.fitSd))}; bee errors ${acc.errors}`);
  if (acc.problems.length) console.log("   problems:", [...new Set(acc.problems)].slice(0, 4).join(" | "));
  console.log("   strategy  clover fed  orchid fed  (last round: clover / orchid)  allure×N  forage×N  fitness");
  STRATS.forEach((name, i) => {
    const p = acc.perTeam[i];
    console.log(`   ${name.padEnd(8)}  ${f2(mean(p.cf)).padStart(10)}  ${f2(mean(p.of)).padStart(10)}  ${`${f2(mean(p.cfLast))} / ${f2(mean(p.ofLast))}`.padStart(30)}  ${f2(mean(p.allure)).padStart(8)}  ${f2(mean(p.forage)).padStart(8)}  ${f2(mean(p.fit)).padStart(7)}`);
  });
  console.log();
}
const fs = await import("node:fs");
fs.writeFileSync(new URL("../arena/runs/identity-rules-sim.json", import.meta.url), JSON.stringify(all));
