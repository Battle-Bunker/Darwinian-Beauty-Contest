// Python flower programs for the no-history experiments (int challenge → graph[any] response), and their keys.
// Every flower has a keyed handshake with its own bee (bee challenge = nonce·2^20 + 20-bit tag; the flower
// answers its own bee with a MAC and pOwn), then answers everyone else by its strategy.
import { execFileSync } from "node:child_process";

const here = new URL(".", import.meta.url).pathname;
export const KEYS = JSON.parse(execFileSync("python3", [here + "rsa_keys.py"]).toString()).keys;
const hex = (s) => BigInt(s).toString(16);

const HS = (key, pOwn) => `
    t = c & 1048575
    if c >> 20 and t == int(hashlib.sha256(b"${key}t%d" % (c >> 20)).hexdigest()[:5], 16):
        return {"nodes": 1, "edges": [], "labels": [hashlib.sha256(b"${key}r%d" % c).hexdigest()]}, ${pOwn}`;
const G = (labels) => `{"nodes": len(${labels}), "edges": [], "labels": ${labels}}`;
const chunks = (v) => `[${v}[i:i + 64] for i in range(0, len(${v}), 64)]`;

/** kind: lean | pattern | signer | copyKey | whitewash | replay. */
export function flower({ kind, pct, hs = "kA", pOwn = 50, bits = 512, keyName = "512", K = 7919, target = "512", recorded = "" }) {
  const head = `import hashlib, random\ndef flower(c):${HS(hs, pOwn)}\n`;
  switch (kind) {
    case "lean": return head + `    return ${G("[c]")}, ${pct}\n`;
    case "pattern": return head + `    return ${G(`[c * ${K} % 1000003]`)}, ${pct}\n`;
    case "signer": {
      const k = KEYS[keyName];
      return head + `    p = 0x${hex(k.p)}
    q = 0x${hex(k.q)}
    n = p * q
    m = int(hashlib.sha256(b"%d" % c).hexdigest(), 16) % n
    s = pow(m, pow(65537, -1, (p - 1) * (q - 1)), n)
    v = "%x" % s + "." + "%x" % n
    return ${G(chunks("v"))}, ${pct}\n`;
    }
    case "copyKey": {
      const k = KEYS[target];
      return head + `    n = 0x${hex(k.n)}
    v = "%x" % random.getrandbits(${bits}) + "." + "%x" % n
    return ${G(chunks("v"))}, ${pct}\n`;
    }
    case "whitewash":
      // A fresh discrete-log key every call (Schnorr over Z_p*, p a ${bits}-bit prime): x, y = g^x, then sign.
      return head + `    p = 0x${hex(KEYS[keyName].p)}
    x = random.getrandbits(${bits >> 1})
    k = random.getrandbits(${bits >> 1})
    y = pow(5, x, p)
    r = pow(5, k, p)
    e = int(hashlib.sha256(b"%d.%d" % (r, c)).hexdigest(), 16)
    v = "%x.%x.%x" % (y, e, (k + x * e) % (p - 1))
    return ${G(chunks("v"))}, ${pct}\n`;
    case "replay":
      // Answers a bee's static challenge with a recorded response (copied from the public record into code).
      return head + `    if c == ${target}:
        v = "${recorded}"
        return ${G(chunks("v"))}, ${pct}
    return ${G("[c]")}, ${pct}\n`;
  }
  throw new Error(kind);
}
