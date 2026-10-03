// Tests for lib/mechanisms.js: keyword evidence, skeletons, the classifier prompt and its parsing (with a fake model).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifierPrompt, classifyTeamGame, keywordBee, keywordCosmos, levelOf, skeleton, skeletonHash, stripProse } from "./lib/mechanisms.js";

let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === undefined ? "" : " " + JSON.stringify(extra)}`); if (!ok) failed++; };

const pow = `# cosmos: proof of work. sha256 nonces
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
    return {"nodes": len(found), "edges": [], "labels": found}
`;
const chain = `import time, hashlib
def flower(challenge):
    deadline = time.time() + GAME["ms"] * 0.8 / 1000
    labels, prev, nonce = [], -1, 0
    while time.time() < deadline:
        d = hashlib.sha256(("%d,%d" % (challenge, prev)).encode() + str(nonce).encode()).digest()
        if d[0] == 0 and d[1] < 64:
            labels.append(nonce); prev = nonce
        nonce += 1
    return {"nodes": len(labels), "edges": [], "labels": labels}
`;
const rule = `# a proof of work would use hashlib and sha256 nonces, but we don't
def flower(challenge):
    n = 6 + challenge % 16
    return {"nodes": n, "edges": [[i, (i + 1) % n] for i in range(n)], "labels": [(i * challenge + 7) % 97 for i in range(n)]}
`;
const seq = `import hashlib
def flower(c):
    h = str(c).encode()
    marks = []
    for i in range(20000):
        h = hashlib.sha256(h).digest()
        if i % 1000 == 0:
            marks.append(h.hex())
    return {"nodes": len(marks), "edges": [], "labels": marks}
`;
const paley = fs.readFileSync(new URL("./priming/recipes/paley_cosmos.py", import.meta.url), "utf8");

check("keywords: hashcash nonces in a time-bounded loop = hash-pow", keywordCosmos(pow).mechanism === "hash-pow" && keywordCosmos(pow).tags.includes("time-bounded"), keywordCosmos(pow));
check("keywords: a chain of nonces (d[0] == 0) = hash-pow", keywordCosmos(chain).mechanism === "hash-pow", keywordCosmos(chain));
check("keywords: a formula is a rule, whatever its comments say", keywordCosmos(rule).mechanism === "rule", keywordCosmos(rule));
check("keywords: iterated hashing with checkpoints = sequential", keywordCosmos(seq).mechanism === "sequential", keywordCosmos(seq));
check("keywords: the Paley recipe = certificate", keywordCosmos(paley).mechanism === "certificate", keywordCosmos(paley));
check("prose stripped: comments and docstrings", !/sha256/.test(stripProse(rule)) && !/hello/.test(stripProse('"""hello"""\nx = 1')));

const bee1 = `PRIOR = {"a": [1, 2], "b": [3, 4], "c": [5, 6], "d": [7, 8], "e": [9, 10], "f": [11, 12], "g": [13, 14], "h": [15, 16], "i": [17, 18], "j": [19, 20], "k": [21, 22], "l": [23, 24], "m": [25, 26], "n": [27, 28]}
T = 120
def forage(seen, visit):
    return "leave"
`;
const bee2 = bee1.replace("[1, 2]", "[9, 9]").replace("T = 120", "T = 133");
check("skeleton: a scaffold's retuned tables and thresholds don't change it", skeletonHash(bee1) === skeletonHash(bee2) && skeleton(bee1).includes("{T}"));
check("skeleton: different logic does", skeletonHash(bee1) !== skeletonHash(bee1.replace('return "leave"', 'return "feed"')));
check("keywords: a bee that hashes counts work", keywordBee("import hashlib\nT = 5\ndef forage(seen, visit):\n    return hashlib.sha256(b'x').digest()").checks.includes("work-count"));

check("level: rule 0, hash-pow 2, adaptive certificate 4", levelOf({ mechanism: "rule", tags: ["adaptive"] }) === 0 && levelOf({ mechanism: "hash-pow", tags: [] }) === 2 && levelOf({ mechanism: "certificate", tags: ["adaptive"] }) === 4);

const versions = [{ kind: "cosmos", version: 1, code: pow }, { kind: "orchid", version: 1, code: rule }, { kind: "bee", version: 1, code: bee1 }, { kind: "bee", version: 2, code: bee2 }];
const prompt = classifierPrompt(versions);
check("prompt: every program, numbered, in order", /## \[1\] COSMOS v1/.test(prompt) && /## \[2\] ORCHID v1/.test(prompt) && /## \[4\] BEE v2/.test(prompt) && prompt.indexOf("COSMOS v1") < prompt.indexOf("ORCHID v1"));
check("prompt: a search that runs until its time limit is time-bounded, not adaptive", /NOT just running until the\s+time limit/.test(prompt));

// A fake model: replies per item; counts calls (a scaffold's retuned bee shares its skeleton: classified once).
let calls = 0;
const fake = async ({ model, prompt }) => {
  calls++;
  if (/fable/i.test(model)) throw new Error("fable");
  const items = [...prompt.matchAll(/## \[(\d+)\] (COSMOS|ORCHID|BEE) v(\d+)/g)].reverse().map(([, n, k, v]) => ({ n: Number(n), kind: k.toLowerCase(), version: Number(v),
    ...(k === "COSMOS" ? { mechanism: "hash-pow", tags: ["time-bounded", "challenge-tied"], difficulty: "10 bits" } : k === "ORCHID" ? { strategy: "look-alike", imitates: "a ring" } : { checks: "work-count", threshold: "adaptive" }), summary: "x" }));
  return { text: "Here you go: " + JSON.stringify({ items }) };
};
process.env.ARENA_MECH_CACHE = path.join(os.tmpdir(), `mech-test-${process.pid}.json`);
const labels = await classifyTeamGame(versions.map((v) => ({ ...v, code: v.code + "\n# test " + Date.now() })), { callModel: fake });
check("classifier: one call; labels for every version, the retuned bee shares one", calls === 1 && labels.get("cosmos:1").mechanism === "hash-pow" && labels.get("bee:1").checks === "work-count" && labels.get("bee:2").skeleton === labels.get("bee:1").skeleton, { calls, l: [...labels.keys()] });
check("classifier: keyword evidence attached", labels.get("cosmos:1").kw.mechanism === "hash-pow" && labels.get("orchid:1").kw.mechanism === "rule");
let refused = false;
try { await classifyTeamGame(versions, { callModel: fake, model: "fable-1" }); } catch { refused = true; }
check("classifier: never a Fable model", refused);

fs.rmSync(process.env.ARENA_MECH_CACHE, { force: true });
if (failed) { console.log(`${failed} mechanism check(s) FAILED`); process.exit(1); }
console.log("all mechanism checks passed");
