#!/usr/bin/env node
// Energy of each flower strategy on the real runner (tryFlower), int → graph[any].
//   DBC_ROOT=<checkout> node analysis/no-history/flower-costs.mjs
import { flower, KEYS } from "./flowers.mjs";
const ROOT = process.env.DBC_ROOT ? `file://${process.env.DBC_ROOT.replace(/\/?$/, "/")}` : new URL("../../", import.meta.url).href;
const { tryFlower } = await import(new URL("server/engine.js", ROOT).href);
const { normalizeConfig } = await import(new URL("server/lib/gameConfig.js", ROOT).href);
const config = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]" });
const sig512 = "ab".repeat(64) + "." + BigInt(KEYS["512"].n).toString(16);
const cases = [
  ["lean (handshake only), 5%", { kind: "lean", pct: 5 }],
  ["learnable pattern, 50%", { kind: "pattern", pct: 50 }],
  ["RSA-512 signer, 50%", { kind: "signer", pct: 50, keyName: "512" }],
  ["RSA-1024 signer, 50%", { kind: "signer", pct: 50, keyName: "1024" }],
  ["RSA-256 signer, 50%", { kind: "signer", pct: 50, keyName: "256" }],
  ["copy-key forger (RSA-512 public key, garbage signature), 5%", { kind: "copyKey", pct: 5 }],
  ["whitewasher: fresh 512-bit DL key every call, 5%", { kind: "whitewash", pct: 5, keyName: "1024", bits: 512 }],
  ["whitewasher: fresh 256-bit DL key every call, 5%", { kind: "whitewash", pct: 5, keyName: "512", bits: 256 }],
  ["replay forger (one recorded RSA-512 response in code), 5%", { kind: "replay", pct: 5, target: 77, recorded: sig512 }],
];
console.log("| flower | size | CPU ms p50 | E p50 | E / 165,000 |");
console.log("|---|---|---|---|---|");
for (const [name, o] of cases) {
  const res = await tryFlower({ config, code: flower(o), challenges: Array.from({ length: 50 }, (_, i) => 1000 + i * 7919) });
  const ok = res.results.filter((r) => !r.error);
  if (!ok.length) { console.log(`| ${name} | ${res.size} | error: ${res.error || res.results[0]?.error} | | |`); continue; }
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b), es = ok.map((r) => r.energy).sort((a, b) => a - b);
  console.log(`| ${name} | ${res.size} | ${ms[ms.length >> 1].toFixed(2)} | ${Math.round(es[es.length >> 1])} | ${(es[es.length >> 1] / 165000).toFixed(3)} |`);
}
