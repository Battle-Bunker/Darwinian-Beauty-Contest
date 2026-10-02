#!/usr/bin/env node
// Calibrates the example flowers in arena/examples/v3 on the real engine: server/engine.js tryFlower (the real
// Python runner, a fresh fork per call, wall-clock limits, the program's minified form), scored by the example
// checkers (analysis/calibrate-examples/score.py runs arena/examples/v3/checkers.py, minified).
//
//   node analysis/calibrate-examples.mjs [--n 300] [--examples paley,graceful] [--seed 1] [--out file.json]
//   taskset -c 3 node analysis/calibrate-examples.mjs --hog 1 --hognice 3     (real load, see below)
//
// For each example it plays these variants on the same random challenges (|n| < 2^53):
//   clover@150      the example clover at the clover budget (150 ms)
//   clover@100      the same, with the budget cut to 100 ms: a stand-in for a CPU 1.5x slower (or busy)
//   clover-code@50  the clover's own code entered as an orchid (50 ms): an orchid that copies the example
//   smart@50        analysis/calibrate-examples/<example>_orchid_smart.py, our best orchid (50 ms, uses 80%)
// With --hog K it also replays clover@150 and smart@50 while K busy loops run (at nice --hognice, default 0).
// Run under taskset -c <cpu> so the busy loops share the flower's core: one loop at nice 3 leaves the flower about
// 2/3 of the core (scheduler weights 1024 : 526), i.e. a CPU about 1.5x slower, for clover and orchid alike.
// Prints score distributions, P(score >= k), timeouts, checker time, and the machine load during each variant.
// Runs one flower call at a time. CPU_SLOTS is left alone (one program per core, as in the arena).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tryFlower } from "../server/engine.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { size } from "../server/lib/measure.js";

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = path.join(ROOT, "arena/examples/v3");
const HERE = path.join(ROOT, "analysis/calibrate-examples");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const N = Number(args.n || 300);
const SEED = Number(args.seed || 1);
const HOG = Number(args.hog || 0);
const HOG_NICE = Number(args.hognice || 0);
const WHICH = String(args.examples || "paley,graceful").split(",");

const read = (f) => fs.readFileSync(f, "utf8");
const uptime = () => { try { return execSync("uptime").toString().trim().replace(/^.*load/, "load"); } catch { return os.loadavg().map((x) => x.toFixed(2)).join(", "); } };

// Game settings of the experiment (graph[any] answers to int challenges, 512 nodes / 2048 edges).
const baseConfig = normalizeConfig({ language: "python", challengeType: "int", responseType: "graph[any]", maxNodes: 512 });
const withMs = (kind, ms) => ({ ...baseConfig, budgets: { ...baseConfig.budgets, [kind]: { ...baseConfig.budgets[kind], ms } } });

// Random challenges in (-2^53, 2^53), reproducible from the seed.
function challenges(seed, n) {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const hi = Math.floor(rand() * 2 ** 21), lo = Math.floor(rand() * 2 ** 32);
    const v = hi * 2 ** 32 + lo;
    return rand() < 0.5 ? -v : v;
  });
}

// The checkers, minified as a bee would run them, plus a forage() hook (kept by name) that returns them.
async function checkerProgram() {
  const src = read(path.join(EXAMPLES, "checkers.py")) + "\n\ndef forage(seen):\n    return check_paley, check_graceful\n";
  const { minified, syntaxError } = await size("python", src);
  if (syntaxError) throw new Error("checkers.py does not parse");
  const file = path.join(os.tmpdir(), `dbc-checkers-${process.pid}.py`);
  fs.writeFileSync(file, minified);
  return file;
}

function scorer(file) {
  const child = spawn(process.env.PYTHON || "python3", [path.join(HERE, "score.py"), file], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  const waiting = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiting.shift()(JSON.parse(line)); }
  });
  return {
    score: (ex, c, r, enough) => new Promise((resolve) => { waiting.push(resolve); child.stdin.write(JSON.stringify({ ex, c, r, enough }) + "\n"); }),
    close: () => child.stdin.end(),
  };
}

async function play(code, kind, ms, cs) {
  const config = withMs(kind, ms);
  const out = [];
  const t0 = performance.now();
  for (let i = 0; i < cs.length; i += 50) {
    const res = await tryFlower({ config, code, kind, challenges: cs.slice(i, i + 50) });
    if (res.error) throw new Error(`program failed to load: ${res.error}`);
    out.push(...res.results);
  }
  return { results: out, msPerCall: (performance.now() - t0) / cs.length };
}

function startHog(k) {
  return Array.from({ length: k }, () => spawn("nice", ["-n", String(HOG_NICE), process.execPath, "-e", "for(;;){}"], { stdio: "ignore" }));
}

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const f1 = (x) => (x == null || Number.isNaN(x) ? "-" : x.toFixed(1));
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : x.toFixed(2));
const pct = (x) => `${Math.round(100 * x)}%`;

const all = {};
const checkerFile = await checkerProgram();
const sc = scorer(checkerFile);
console.log(`# Example calibration (n=${N} challenges per variant, seed ${SEED}, ${os.cpus().length} cores${HOG ? `, ${HOG} busy loop(s) at nice ${HOG_NICE}` : ""})\n`);
console.log(`Machine at start: ${uptime()}\n`);

for (const ex of WHICH) {
  const clover = read(path.join(EXAMPLES, `${ex}_clover.py`));
  const smart = read(path.join(HERE, `${ex}_orchid_smart.py`));
  const cs = challenges(SEED * 7919 + ex.length, N);
  const variants = [
    ["clover@150", clover, "clover", 150, 0],
    ["clover@100", clover, "clover", 100, 0],
    ["clover-code@50", clover, "orchid", 50, 0],
    ["smart@50", smart, "orchid", 50, 0],
    ...(HOG ? [["clover@150+hog", clover, "clover", 150, HOG], ["smart@50+hog", smart, "orchid", 50, HOG]] : []),
  ];
  const rows = {};
  for (const [name, code, kind, ms, hog] of variants) {
    const before = uptime();
    const hogs = hog ? startHog(hog) : [];
    let played;
    try { played = await play(code, kind, ms, cs); } finally { for (const h of hogs) h.kill("SIGKILL"); }
    const after = uptime();
    const scores = [], checkMs = [], errors = {};
    for (const r of played.results) {
      if (r.error) { const k = r.error.split(":")[0]; errors[k] = (errors[k] || 0) + 1; scores.push(null); continue; }
      const { s, ms: t } = await sc.score(ex, r.c, r.r);
      scores.push(s);
      checkMs.push(t);
    }
    rows[name] = { scores, checkMs, errors, msPerCall: played.msPerCall, before, after, results: played.results };
    const ok = scores.filter((s) => s != null);
    console.error(`${ex} ${name}: mean ${f2(mean(ok))} (${ok.length}/${scores.length} scored) ${after}`);
  }

  // Scores and thresholds. An answer that is missing (error/timeout) or invalid counts as below every threshold.
  const valid = (name) => rows[name].scores.map((s) => (s == null ? -Infinity : s));
  const pAtLeast = (name, k) => valid(name).filter((s) => s >= k).length / rows[name].scores.length;
  const okScores = (name) => rows[name].scores.filter((s) => s != null);
  console.log(`## ${ex}\n`);
  console.log("| variant | answered | timeouts / errors | mean | sd | min | p5 | p10 | p25 | p50 | p75 | p90 | p95 | max | wall ms per call | load during run |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const name of Object.keys(rows)) {
    const xs = okScores(name), r = rows[name];
    const errs = Object.entries(r.errors).map(([k, v]) => `${v} ${k}`).join(", ") || "0";
    console.log(`| ${name} | ${xs.length}/${r.scores.length} | ${errs} | ${f1(mean(xs))} | ${f1(sd(xs))} | ${q(xs, 0)} | ${q(xs, 0.05)} | ${q(xs, 0.1)} | ${q(xs, 0.25)} | ${q(xs, 0.5)} | ${q(xs, 0.75)} | ${q(xs, 0.9)} | ${q(xs, 0.95)} | ${q(xs, 1)} | ${f1(r.msPerCall)} | ${r.after} |`);
  }
  // P(score >= k) over the range where the variants overlap.
  const lo = Math.min(...okScores("smart@50")), hi = Math.max(...okScores("clover@150"));
  const step = Math.max(1, Math.round((hi - lo) / 24));
  const ks = [];
  for (let k = lo; k <= hi; k += step) ks.push(k);
  console.log(`\nP(score >= k):\n`);
  console.log(`| k | ${Object.keys(rows).join(" | ")} |`);
  console.log(`|---|${Object.keys(rows).map(() => "---").join("|")}|`);
  for (const k of ks) console.log(`| ${k} | ${Object.keys(rows).map((n) => pct(pAtLeast(n, k))).join(" | ")} |`);
  // Threshold: the k that best separates the loaded clover from the best orchid (maximises the worse of the two
  // error rates), and the same for the unloaded clover.
  const pick = (cl) => {
    let best = null;
    for (let k = lo; k <= hi; k++) {
      const m = Math.min(pAtLeast(cl, k), 1 - pAtLeast("smart@50", k));
      if (!best || m > best.m) best = { k, m };
    }
    return best.k;
  };
  const kLoad = pick("clover@100"), kNom = pick("clover@150");
  for (const [label, k] of [["robust (separates clover@100 from smart@50)", kLoad], ["nominal (separates clover@150 from smart@50)", kNom]]) {
    console.log(`\nThreshold ${label}: k = ${k}: ` + Object.keys(rows).map((n) => `${n} ${pct(pAtLeast(n, k))}`).join(", "));
  }
  if (HOG) {
    let best = null;
    for (let k = lo; k <= hi; k++) {
      const m = Math.min(pAtLeast("clover@150+hog", k), 1 - pAtLeast("smart@50+hog", k));
      if (!best || m > best.m) best = { k, m };
    }
    console.log(`\nThreshold with both under load (separates clover@150+hog from smart@50+hog): k = ${best.k}: ` +
      Object.keys(rows).map((n) => `${n} ${pct(pAtLeast(n, best.k))}`).join(", "));
  }
  // Checker time on every scored answer, and with an early stop at the robust threshold (Paley's enough=k).
  const allCheck = Object.values(rows).flatMap((r) => r.checkMs);
  console.log(`\nChecker time over all ${allCheck.length} answers: mean ${f2(mean(allCheck))} ms, p50 ${f2(q(allCheck, 0.5))}, p95 ${f2(q(allCheck, 0.95))}, max ${f2(q(allCheck, 1))} ms` +
    ` (clover@150 answers: mean ${f2(mean(rows["clover@150"].checkMs))}, max ${f2(q(rows["clover@150"].checkMs, 1))} ms)`);
  if (ex === "paley") {
    const ts = [];
    for (const r of rows["clover@150"].results) if (!r.error) ts.push((await sc.score(ex, r.c, r.r, kLoad)).ms);
    console.log(`Checker time with enough=${kLoad} on clover@150 answers: mean ${f2(mean(ts))} ms, p95 ${f2(q(ts, 0.95))}, max ${f2(q(ts, 1))} ms`);
  }
  // Bound to the challenge: a clover answer scored against a different challenge.
  const cross = [];
  for (let i = 0; i < Math.min(100, N); i++) {
    const r = rows["clover@150"].results[i];
    if (!r.error) cross.push((await sc.score(ex, r.c + 1, r.r)).s);
  }
  console.log(`Clover answers scored against challenge + 1: ${cross.filter((s) => s == null).length} invalid (None), max score ${Math.max(...cross.map((s) => s ?? -1))} (n=${cross.length})\n`);
  all[ex] = Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, { scores: r.scores, errors: r.errors, msPerCall: r.msPerCall, before: r.before, after: r.after, checkMs: r.checkMs }]));
  all[ex].thresholds = { robust: kLoad, nominal: kNom };
}
console.log(`Machine at end: ${uptime()}`);
sc.close();
fs.rmSync(checkerFile, { force: true });
if (args.out) fs.writeFileSync(args.out, JSON.stringify(all));
process.exit(0);
