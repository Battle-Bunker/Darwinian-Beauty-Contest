// Tests for lib/mechanisms.js (one flower per team): keyword evidence for flowers (mechanism, percent policy) and bees,
// skeletons, the classifier prompt and its parsing (with a fake model; never a Fable model).
//   node arena/test-mechanisms.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLASSIFIER_SYSTEM, beeLevelOf, classifierPrompt, classifyTeamGame, keywordBee, keywordFlower, levelOf, skeleton, skeletonHash, stripProse } from "./lib/mechanisms.js";

let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === undefined ? "" : " " + JSON.stringify(extra)}`); if (!ok) failed++; };

const pow = `# flower: proof of work. sha256 nonces
import hashlib, time
def flower(c):
    stop = time.time() + (GAME["ms"] - 15) / 1000
    p = hashlib.sha256(b"%d:" % c)
    found, k = [], 0
    while time.time() < stop:
        q = p.copy(); q.update(b"%d" % k)
        if q.digest()[:2] < b"\\x00@":
            found.append(k)
        k += 1
    return {"nodes": len(found), "edges": [], "labels": found}, 30
`;
const chain = `import time, hashlib
def flower(challenge):
    deadline = time.time() + GAME["ms"] * 0.2 / 1000
    labels, prev, nonce = [], -1, 0
    while time.time() < deadline:
        d = hashlib.sha256(("%d,%d" % (challenge, prev)).encode() + str(nonce).encode()).digest()
        if d[0] == 0 and d[1] < 64:
            labels.append(nonce); prev = nonce
        nonce += 1
    return labels, 20
`;
const rule = `# a proof of work would use hashlib and sha256 nonces, but we don't: small and fast is more energy
def flower(challenge):
    return (challenge * 7 + 3) % 97, 25
`;
const seq = `import hashlib
def flower(c):
    h = str(c).encode()
    marks = []
    for i in range(2000):
        h = hashlib.sha256(h).digest()
        if i % 100 == 0:
            marks.append(h.hex())
    return marks, 40
`;
const clique = `def is_prime(n):
    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))

def flower(c):
    q = 5 + c % 40
    while not is_prime(q) or q % 4 != 1:
        q += 1
    # a clique in the Paley graph of q: quick for a bee to check
    sq = {(x * x) % q for x in range(1, q)}
    found = [0]
    for v in range(1, q):
        if all((v - u) % q in sq for u in found):
            found.append(v)
    return found, 35
`;
const byHistory = `def flower(c):
    fed = HISTORY.turns.my_flower().eq("fed", True).count().value()
    pct = 10 if fed > 5 else 40
    return c, pct
`;

check("keywords: hashcash nonces in a time-bounded loop = hash-pow, fixed percent", keywordFlower(pow).mechanism === "hash-pow" && keywordFlower(pow).tags.includes("time-bounded") && keywordFlower(pow).percent === "fixed", keywordFlower(pow));
check("keywords: a chain of nonces (d[0] == 0) = hash-pow", keywordFlower(chain).mechanism === "hash-pow", keywordFlower(chain));
check("keywords: a formula is a rule, whatever its comments say", keywordFlower(rule).mechanism === "rule" && keywordFlower(rule).percent === "fixed", keywordFlower(rule));
check("keywords: iterated hashing with checkpoints = sequential", keywordFlower(seq).mechanism === "sequential", keywordFlower(seq));
check("keywords: a checkable puzzle (a Paley clique) = certificate", keywordFlower(clique).mechanism === "certificate", keywordFlower(clique));
const knows = byHistory.replace("my_flower()", 'eq("flower", GAME["team"])');
check("keywords: a percent set from HISTORY, a flower that knows its own team", keywordFlower(byHistory).percent === "by-history?" && keywordFlower(byHistory).tags.includes("reads-history")
  && keywordFlower(knows).tags.includes("knows-own-team"), [keywordFlower(byHistory), keywordFlower(knows)]);
check("prose stripped: comments and docstrings", !/sha256/.test(stripProse(rule)) && !/hello/.test(stripProse('"""hello"""\nx = 1')));

const bee1 = `PRIOR = {"a": [1, 2], "b": [3, 4], "c": [5, 6], "d": [7, 8], "e": [9, 10], "f": [11, 12], "g": [13, 14], "h": [15, 16], "i": [17, 18], "j": [19, 20], "k": [21, 22], "l": [23, 24], "m": [25, 26], "n": [27, 28]}
T = 120
def first():
    return 1

def decide(challenge, response):
    return "leave", 1
`;
const bee2 = bee1.replace("[1, 2]", "[9, 9]").replace("T = 120", "T = 133");
check("skeleton: a scaffold's retuned tables and thresholds don't change it", skeletonHash(bee1) === skeletonHash(bee2) && skeleton(bee1).includes("{T}"));
check("skeleton: different logic does", skeletonHash(bee1) !== skeletonHash(bee1.replace('return "leave", 1', 'return "feed", 1')));
check("keywords: a bee that tests hashes for proof of work counts work", keywordBee("import hashlib\nT = 5\ndef decide(c, r):\n    ok = hashlib.sha256(b'x').digest()[0] == 0\n    return 'feed', 1").checks.includes("work-count"));
check("keywords: a bee that recomputes a hash without a difficulty test checks a key", keywordBee("import hashlib\nK = 'k3y'\ndef decide(c, r):\n    ok = r == hashlib.sha256((K + str(c)).encode()).hexdigest()\n    return 'feed', 1").checks.includes("key-check"));
const keyed = `import hashlib\nSECRET = "m00nfl0wer"\ndef flower(c):\n    h = hashlib.sha256((SECRET + str(c)).encode()).digest()\n    return {"nodes": 3, "edges": [[0, 1]], "labels": list(h[:3])}, 20\n`;
check("keywords: signal families: a keyed signal, a puzzle", keywordFlower(keyed).families.includes("keyed?") && keywordFlower(pow).families.includes("puzzle") && !keywordFlower(rule).families.length,
  [keywordFlower(keyed), keywordFlower(pow).families, keywordFlower(rule).families]);
check("levels: keyed 2, commitment 3, a flower with two families +1; bee levels", levelOf({ mechanism: "keyed", tags: [] }) === 2 && levelOf({ mechanism: "commitment", tags: [] }) === 3
  && levelOf({ mechanism: "keyed", tags: [], families: ["keyed", "puzzle"] }) === 3 && beeLevelOf({ checks: "key-check" }) === 2 && beeLevelOf({ checks: "certificate-check" }) === 3 && beeLevelOf({ checks: "none" }) === 0);
const learner = "def decide(c, r):\n    paid = HISTORY.turns.my_bee().eq('fed', True).group_by('flower').avg('nectar').rows()\n    MEMORY['n'] = MEMORY.get('n', 0) + 1\n    return 'feed', 1";
check("keywords: a bee that learns from HISTORY's nectar and keeps MEMORY", keywordBee(learner).checks.includes("learns") && keywordBee(learner).checks.includes("uses-memory"), keywordBee(learner));

check("level: rule 0, hash-pow 2, adaptive certificate 4", levelOf({ mechanism: "rule", tags: ["adaptive"] }) === 0 && levelOf({ mechanism: "hash-pow", tags: [] }) === 2 && levelOf({ mechanism: "certificate", tags: ["adaptive"] }) === 4);

const versions = [{ kind: "flower", version: 1, code: pow }, { kind: "flower", version: 2, code: rule }, { kind: "bee", version: 1, code: bee1 }, { kind: "bee", version: 2, code: bee2 }];
const prompt = classifierPrompt(versions);
check("prompt: every program, numbered, in order", /## \[1\] FLOWER v1/.test(prompt) && /## \[2\] FLOWER v2/.test(prompt) && /## \[4\] BEE v2/.test(prompt) && prompt.indexOf("FLOWER v1") < prompt.indexOf("FLOWER v2"));
check("prompt: the percent policy, energy-aware tags, handshakes, how a bee uses MEMORY", /"percent_policy"/.test(prompt) && /"by-history"/.test(prompt) && /"by-visitor"/.test(prompt) && /"lean"/.test(prompt)
  && /"own-bee-handshake"/.test(prompt) && /"handshake-only"/.test(prompt) && /"memory": how it uses MEMORY/.test(prompt)
  && /"families": every signal family/.test(prompt) && /"keyed"/.test(prompt) && /"commitment"/.test(prompt) && /"key-check"/.test(prompt) && /"cracks"/.test(prompt));
check("system: species, nectar and pollen given, HISTORY, fresh calls, MEMORY", /species/.test(CLASSIFIER_SYSTEM) && /gives it percent% of E as nectar and the rest as pollen/.test(CLASSIFIER_SYSTEM)
  && /HISTORY/.test(CLASSIFIER_SYSTEM) && /MEMORY/.test(CLASSIFIER_SYSTEM) && !/ledger|surplus/.test(CLASSIFIER_SYSTEM + prompt));
check("prompt: a search that runs until its time limit is time-bounded, not adaptive", /NOT just\s+running until the time limit/.test(prompt));
check("prompt: nothing of earlier variants", !/cosmos|orchid|forage\(seen|reads-ledger|ledger-value/i.test(prompt));

// A fake model: replies per item; counts calls (a scaffold's retuned bee shares its skeleton: classified once).
let calls = 0;
const fake = async ({ model, prompt }) => {
  calls++;
  if (/fable/i.test(model)) throw new Error("fable");
  const items = [...prompt.matchAll(/## \[(\d+)\] (FLOWER|BEE) v(\d+)/g)].reverse().map(([, n, k, v]) => ({ n: Number(n), kind: k.toLowerCase(), version: Number(v),
    ...(k === "FLOWER" ? { mechanism: Number(v) === 1 ? "hash-pow" : "rule", percent_policy: "fixed", percent: 30, tags: ["time-bounded", "challenge-tied"], families: ["puzzle", "Keyed", "nonsense"], difficulty: "10 bits" }
      : { checks: "work-count", feeds: "by-check", threshold: "adaptive", memory: "counters", tags: ["learns"] }), summary: "x" }));
  return { text: "Here you go: " + JSON.stringify({ items }) };
};
process.env.ARENA_MECH_CACHE = path.join(os.tmpdir(), `mech-test-${process.pid}.json`);
const labels = await classifyTeamGame(versions.map((v) => ({ ...v, code: v.code + "\n# test " + Date.now() })), { callModel: fake });
const f1 = labels.get("flower:1");
check("classifier: one call; labels for every version, the retuned bee shares one", calls === 1 && f1.mechanism === "hash-pow" && f1.percentPolicy === "fixed" && f1.percent === 30
  && labels.get("flower:2").mechanism === "rule" && labels.get("bee:1").checks === "work-count" && labels.get("bee:1").feeds === "by-check" && labels.get("bee:1").memory === "counters"
  && labels.get("bee:2").skeleton === labels.get("bee:1").skeleton,
  { calls, l: [...labels.entries()] });
check("classifier: families kept (known ones only)", f1.families.join() === "puzzle,keyed", f1.families);
check("classifier: keyword evidence attached", f1.kw.mechanism === "hash-pow" && labels.get("flower:2").kw.mechanism === "rule");
let refused = false;
try { await classifyTeamGame(versions, { callModel: fake, model: "fable-1" }); } catch { refused = true; }
check("classifier: never a Fable model", refused);

fs.rmSync(process.env.ARENA_MECH_CACHE, { force: true });
if (failed) { console.log(`${failed} mechanism check(s) FAILED`); process.exit(1); }
console.log("all mechanism checks passed");
