#!/usr/bin/env node
// Experiment 1: what flowers cost, on the real runner (server/engine.js tryFlower: a fresh fork per call in
// Python, a fresh vm context in TypeScript, CPU-timed exactly as in a game, the program run minified).
//
//   node analysis/one-flower/energy.mjs [--n 100]
//
// For each flower: its size, the CPU ms of a call (median, p90, max), E = (1100 − size) × (150 − ms), and E
// as a share of the best possible (1100 × 150). Also checks two CPU-accounting loopholes: work done while the
// runner encodes the reply (TypeScript toJSON; a Python dict subclass whose items() runs during json.dumps).
//   DBC_ROOT=<checkout> runs another checkout's engine (default: this one).
const ROOT = process.env.DBC_ROOT ? `file://${process.env.DBC_ROOT.replace(/\/?$/, "/")}` : new URL("../../", import.meta.url).href;
const { tryFlower } = await import(new URL("server/engine.js", ROOT).href);
const { normalizeConfig } = await import(new URL("server/lib/gameConfig.js", ROOT).href);

const N = Number(process.argv[process.argv.indexOf("--n") + 1]) || 100;
const EMAX = 1100 * 150;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const FLOWERS = [
  // ---- Python, int -> int ----
  { name: "minimal (echo, 30%)", lang: "python", code: `def flower(c):\n    return c, 30\n` },
  { name: "keyed MAC handshake (sha256, 8-byte key)", lang: "python", code: `import hashlib
def flower(c, ledger):
    h = int(hashlib.sha256(b"k3y-9f2a" + str(c).encode()).hexdigest()[:13], 16)
    return h, 30
` },
  { name: "reads whole ledger (3,600 entries) each call", lang: "python", ledger: 3600, code: `def flower(c, ledger):
    n = 0
    for e in ledger:
        if e["fed"] and e["flower"] == GAME["team"]:
            n += 1
    return c + n, 30
` },
  { name: "toy RSA-53 signature (forgeable: Pollard rho factors n in 5 ms)", lang: "python", code: `def flower(c):
    n = 6005199815643937
    d = 1161693715491737
    return pow(c % n, d, n), 30
` },
  { name: "hashcash 12 bits (fixed work)", lang: "python", code: `import hashlib
def flower(c):
    k = 0
    while int(hashlib.sha256(b"%d:%d" % (c, k)).hexdigest()[:3], 16) != 0:
        k += 1
    return k, 30
` },
  { name: "proof of work to 85% of 150 ms (csig-style)", lang: "python", code: `import hashlib, time
def flower(c):
    t = time.process_time()
    best = 0
    k = 0
    while time.process_time() - t < 0.125:
        h = int(hashlib.sha256(b"%d:%d" % (c, k)).hexdigest()[:12], 16)
        if h > best:
            best = h
        k += 1
    return best, 30
` },
  // ---- TypeScript, int -> int ----
  { name: "TS minimal (echo, 30%)", lang: "typescript", code: `function flower(c: number): [number, number] { return [c, 30]; }\n` },
  { name: "TS busy loop 60 ms in flower() (counted)", lang: "typescript", code: `function flower(c: number): [number, number] {
  const t = Date.now(); let x = c;
  while (Date.now() - t < 60) x = (x * 31 + 7) % 1000003;
  return [x, 30];
}
` },
  { name: "TS LOOPHOLE: same 60 ms busy loop inside toJSON", lang: "typescript", code: `function flower(c: number): any {
  return [{ toJSON() { const t = Date.now(); let x = c;
    while (Date.now() - t < 60) x = (x * 31 + 7) % 1000003;
    return x; } }, 30];
}
` },
  { name: "TS LOOPHOLE: 140 ms in toJSON (+ none counted)", lang: "typescript", code: `function flower(c: number): any {
  return [{ toJSON() { const t = Date.now(); let x = c;
    while (Date.now() - t < 140) x = (x * 31 + 7) % 1000003;
    return x; } }, 30];
}
` },
  // ---- Python, int -> graph[any]: a dict response ----
  { name: "py graph: 60 ms busy loop in flower() (counted)", lang: "python", rtype: "graph[any]", code: `import time
def flower(c):
    t = time.process_time()
    x = c
    while time.process_time() - t < 0.06:
        x = (x * 31 + 7) % 1000003
    return {"nodes": 2, "edges": [[0, 1]], "labels": [x, 0]}, 30
` },
  { name: "py graph LOOPHOLE: 300 ms in a dict subclass's items()", lang: "python", rtype: "graph[any]", code: `import time
class G(dict):
    def items(self):
        t = time.process_time()
        x = self["labels"][0]
        while time.process_time() - t < 0.3:
            x = (x * 31 + 7) % 1000003
        self["labels"][0] = x
        return dict.items(self)
def flower(c):
    return G(nodes=2, edges=[[0, 1]], labels=[c, 0]), 30
` },
];

function fakeLedger(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ round: 1 + (i / 6 | 0), bee: i % 6, flower: (i * 7) % 6, challenge: i, response: i * 3, fed: i % 3 === 0,
    percent: i % 3 === 0 ? 30 : null, energy: i % 3 === 0 ? 160000 : null, nectar: i % 3 === 0 ? 48000 : null, surplus: i % 3 === 0 ? 112000 : 0, ms: null });
  return out;
}

const rows = [];
for (const f of FLOWERS) {
  const config = normalizeConfig({ language: f.lang, responseType: f.rtype || "int" });
  const ms = [], es = [];
  let size = null, errors = 0, firstErr = null, sample = null;
  const ledger = f.ledger ? fakeLedger(f.ledger) : [];
  const t0 = performance.now();
  for (let done = 0; done < N; done += 50) {
    const challenges = Array.from({ length: Math.min(50, N - done) }, (_, i) => 1000 + done + i);
    const res = await tryFlower({ config, code: f.code, challenges, ledger });
    if (res.error) { firstErr = res.error; errors = N; break; }
    size = res.size;
    for (const r of res.results) {
      if (r.error) { errors++; firstErr ??= r.error; continue; }
      ms.push(r.ms); es.push(r.energy); sample ??= r.r;
    }
  }
  const wall = (performance.now() - t0) / N;
  rows.push({
    flower: f.name, size, calls: N, errors,
    msMedian: ms.length ? +q(ms, 0.5).toFixed(2) : null, msP90: ms.length ? +q(ms, 0.9).toFixed(2) : null,
    msMax: ms.length ? +Math.max(...ms).toFixed(2) : null,
    Emedian: es.length ? Math.round(q(es, 0.5)) : 0,
    EshareOfMax: es.length ? +(q(es, 0.5) / EMAX).toFixed(3) : 0,
    Ecv: es.length ? +(Math.sqrt(es.reduce((s, x) => s + (x - es.reduce((a, b) => a + b, 0) / es.length) ** 2, 0) / es.length) / (es.reduce((a, b) => a + b, 0) / es.length)).toFixed(4) : null,
    wallMsPerCall: +wall.toFixed(1), firstErr: firstErr ? String(firstErr).slice(0, 80) : null,
  });
  console.error(`done: ${f.name}`);
}
console.table(rows.map(({ firstErr, ...r }) => r));
for (const r of rows) if (r.firstErr) console.log(`${r.flower}: ${r.errors} errors, e.g. ${r.firstErr}`);
console.log(JSON.stringify(rows));
