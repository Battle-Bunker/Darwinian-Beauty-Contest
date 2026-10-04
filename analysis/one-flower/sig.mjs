#!/usr/bin/env node
// Hypotheses 3 and 4: what copying costs in change budget, and what a public-key signature costs a flower.
//   DBC_ROOT=<checkout> node analysis/one-flower/sig.mjs
// 1. Change costs (the engine's own tree edit distance, server/lib/measure.js) between flower versions.
// 2. RSA-signing flowers for graph[any] responses (signature and modulus in hex labels, ≤ 64 characters each):
//    size, CPU ms and E on the real runner, by modulus size. The key is two prime literals (p, q).
// 3. Pure-Python Pollard rho on balanced semiprimes (what a scaffold without factoring tools has), extrapolated.
import { execFileSync } from "node:child_process";
import { flowerCode } from "./bots.mjs";

const ROOT = process.env.DBC_ROOT ? `file://${process.env.DBC_ROOT.replace(/\/?$/, "/")}` : new URL("../../", import.meta.url).href;
const { tryFlower } = await import(new URL("server/engine.js", ROOT).href);
const { normalizeConfig } = await import(new URL("server/lib/gameConfig.js", ROOT).href);
const { size, changes } = await import(new URL("server/lib/measure.js", ROOT).href);
const here = new URL(".", import.meta.url).pathname;
const data = JSON.parse(execFileSync("python3", [here + "rsa_keys.py"]).toString());

const rsaFlower = ({ p, q }, pct = 50) => `def flower(c):
    p = ${p}
    q = ${q}
    n = p * q
    d = pow(65537, -1, (p - 1) * (q - 1))
    s = pow(c % n, d, n)
    h = "%x" % s
    k = "%x" % n
    parts = [h[i:i + 64] for i in range(0, len(h), 64)] + [k[i:i + 64] for i in range(0, len(k), 64)]
    return {"nodes": len(parts), "edges": [[i, i + 1] for i in range(len(parts) - 1)], "labels": parts}, ${pct}
`;

console.log("### Change costs (node edits; flower budget 220 a minute, banked up to 220, from zero at the start)\n");
console.log("| change | cost (nodes) | budget time at 220/min |");
console.log("|---|---|---|");
const rule = flowerCode({ K: 101, pct: 30 }), rule2 = flowerCode({ K: 30007, pct: 30 });
const pairs = [
  ["rule: change its constant K (copy a parametric signal)", rule, rule2],
  ["rule: change its percent 30 → 5", rule, flowerCode({ K: 101, pct: 5 })],
  ["rule → runtime mimic (reads history, copies the best-paying rule)", rule, flowerCode({ K: 101, pct: 5, kind: "mimic" })],
  ["rule → rotating rule (new K every T rounds)", rule, flowerCode({ K: 101, pct: 30, kind: "rotating" })],
  ["rule → keyed handshake + rule", rule, flowerCode({ K: 101, pct: 30, handshake: "ka7Q", pOwn: 50 })],
  ["rule → RSA-512 signing flower", rule, rsaFlower(data.keys[512])],
  ["RSA-512 flower → a new RSA-512 key (rotate the key)", rsaFlower(data.keys[512]), rsaFlower(data.keys["512b"])],
];
for (const [name, a, b] of pairs) {
  const c = await changes("python", a, b);
  const cost = c.cost ?? c.distance ?? c;
  console.log(`| ${name} | ${cost} | ${(cost / 220 * 60).toFixed(0)} s${cost > 220 ? " (over the cap: in steps)" : ""} |`);
}
console.log();

console.log("### Signing flowers (int → graph[any]; 50 calls each on the real runner)\n");
console.log("| modulus | flower size | ms (p50) | E (p50) | E / E of an 11-node flower | Pollard rho in pure Python (extrapolated) |");
console.log("|---|---|---|---|---|---|");
const rho64 = data.rho[64];
for (const bits of [128, 256, 512, 1024]) {
  const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]" });
  const code = rsaFlower(data.keys[bits]);
  const res = await tryFlower({ config, code, challenges: Array.from({ length: 50 }, (_, i) => 123456789 + i * 7919) });
  const ok = res.results.filter((r) => !r.error);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b), es = ok.map((r) => r.energy).sort((a, b) => a - b);
  const secs = rho64 * 2 ** ((bits - 64) / 4);
  const human = secs < 120 ? `${secs.toFixed(0)} s` : secs < 7200 ? `${(secs / 60).toFixed(0)} min` : secs < 86400 * 365 ? `${(secs / 3600).toFixed(0)} h` : `${(secs / 86400 / 365).toExponential(0)} years`;
  console.log(`| ${bits} bits | ${res.size} | ${ms[ms.length >> 1]?.toFixed(2)} | ${Math.round(es[es.length >> 1] ?? 0)} | ${((es[es.length >> 1] ?? 0) / 162727).toFixed(2)} | ${human}${res.results[0]?.error ? " (error: " + res.results[0].error + ")" : ""} |`);
}
console.log();
console.log("Pollard rho, measured (median CPU s): " + Object.entries(data.rho).map(([b, t]) => `${b} bits ${t.toFixed(3)}`).join(", ") + ". It scales as 2^(bits/4); quadratic-sieve tools are much faster above ~100 bits (a 256-bit modulus falls in minutes to msieve or YAFU), so the extrapolation is an upper bound for a team with real tools.");
