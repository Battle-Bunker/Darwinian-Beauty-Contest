// CPU-time limits for the TypeScript runner (node has none built in): precision and costs of the options.
//   node node_cpu.cjs OUT.jsonl [tag] [n]
// Every trial runs a script that never ends (a loop that records its thread's CPU time every few us), so
// whatever stops it is the mechanism; over = CPU at the stop − (CPU when armed + R), in ms.
//   vm_wall      today's runner: vm.runInContext(..., {timeout: R}): a wall-clock limit
//   sigint_perf  the script runs on the main thread with breakOnSigint; a sidecar (perf_sigint_sidecar.py)
//                has the kernel send SIGINT when the main thread's on-CPU time reaches R (perf task-clock)
//   sigint_poll  the same, but a watchdog worker thread polls process.cpuUsage() and sends the SIGINT itself
//   worker_kill  the script runs in a worker thread; the main thread polls worker.cpuUsage() and calls
//                worker.terminate() at R (a fresh worker must then be started)
// Also: worker.cpuUsage() liveness while the worker computes, and what a worker costs to start and stop.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");
const { spawn } = require("node:child_process");

const OUT = process.argv[2];
const TAG = process.argv[3] || "";
const N = Number(process.argv[4] || 10);
const RS = (process.env.RS || "3,10,50,150").split(",").map(Number);
const SPIN_MS = Number(process.env.SPIN_MS || 300);
const fd = fs.openSync(OUT, "a");
const W = (o) => fs.writeSync(fd, JSON.stringify({ tag: TAG, ...o }) + "\n");
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };       // all threads
const threadMs = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; }; // this thread
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("SIGINT", () => {}); // a SIGINT that lands between scripts is harmless

const LOOP = "for (;;) { for (let i = 0; i < 2000; i++) {} beat(); }";

function mainContext() {
  const box = { last: 0 };
  const ctx = vm.createContext({ beat: () => { box.last = threadMs(); } });
  return { ctx, box };
}

// A sidecar that arms perf CPU-time alarms on this process's main thread.
function sidecar() {
  const p = spawn(process.env.PYTHON || "python3", [path.join(__dirname, "perf_sigint_sidecar.py")], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", waiting = [];
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); waiting.shift()?.(l); }
  });
  const ask = (line) => new Promise((r) => { waiting.push(r); p.stdin.write(line + "\n"); });
  return { ask, close: () => p.stdin.end("quit\n") };
}

const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const hb = new Float64Array(workerData.sab);
const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };
const ctx = vm.createContext({ beat: () => { hb[1] = cpu(); } });
parentPort.on("message", (m) => {
  if (m === "spin") { const t = performance.now(); while (performance.now() - t < workerData.spin) {} parentPort.postMessage("done"); return; }
  hb[0] = cpu(); hb[1] = hb[0];
  parentPort.postMessage("started");
  try { vm.runInContext(${JSON.stringify(LOOP)}, ctx, { timeout: 5000 }); } catch {}
});`;

const WATCHDOG_SRC = `
const { workerData } = require("node:worker_threads");
const ctl = new Float64Array(workerData.sab); // [armed, deadline cpu ms]
const flag = new Int32Array(workerData.flag);
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
for (;;) {
  if (!ctl[0]) { Atomics.wait(flag, 0, 0, 50); continue; }
  const left = ctl[1] - cpu();
  if (left <= 0) { ctl[0] = 0; process.kill(process.pid, "SIGINT"); continue; }
  Atomics.wait(flag, 0, 0, Math.max(0.02, left));
}`;

async function newWorker(sab) {
  const t = performance.now();
  const w = new Worker(WORKER_SRC, { eval: true, workerData: { sab, spin: SPIN_MS } });
  await new Promise((r) => w.once("online", r));
  return { w, startMs: performance.now() - t };
}

async function main() {
  const plan = [];
  for (const mech of ["vm_wall", "sigint_perf", "sigint_poll", "worker_kill"]) for (const r of RS) for (let i = 0; i < N; i++) plan.push([mech, r]);
  plan.sort(() => Math.random() - 0.5);
  const side = sidecar();
  const wdSab = new SharedArrayBuffer(16), wdFlag = new SharedArrayBuffer(4);
  const wd = new Worker(WATCHDOG_SRC, { eval: true, workerData: { sab: wdSab, flag: wdFlag } });
  const wdCtl = new Float64Array(wdSab);
  await new Promise((r) => wd.once("online", r));
  const sab = new SharedArrayBuffer(16), hb = new Float64Array(sab);
  let cur = await newWorker(sab);

  // worker.cpuUsage() while the worker computes: does it answer, and how fresh is it?
  {
    cur.w.postMessage("spin");
    let done = false;
    cur.w.once("message", () => { done = true; });
    const t0 = performance.now(), base = await cur.w.cpuUsage(), samples = [];
    while (!done) {
      const u = await cur.w.cpuUsage();
      samples.push([performance.now() - t0, (u.user + u.system - base.user - base.system) / 1000]);
      await sleep(2);
    }
    W({ test: "worker_cpuUsage_live", samples });
  }

  for (const [mech, r] of plan) {
    const rec = { test: "stop", mech, r };
    if (mech === "vm_wall" || mech === "sigint_perf" || mech === "sigint_poll") {
      const { ctx, box } = mainContext();
      const c0 = threadMs();
      if (mech === "sigint_perf") {
        const a = await side.ask(`arm ${process.pid} ${Math.round(r * 1e6)} ${process.pid}`);
        rec.arm_us = Number(a.split(" ")[1]);
        // The event counts this thread's CPU from its opening: what it has counted so far is the head start.
        rec.head_ms = Number((await side.ask("read")).split(" ")[1]) / 1e6;
      }
      const c1 = threadMs() - (rec.head_ms || 0);
      // (the watchdog reads the whole process's CPU: this thread's share of it is only as fresh as its last tick)
      if (mech === "sigint_poll") { wdCtl[1] = cpuMs() + r; wdCtl[0] = 1; Atomics.notify(new Int32Array(wdFlag), 0); }
      box.last = threadMs();
      const t0 = performance.now();
      try {
        vm.runInContext(LOOP, ctx, mech === "vm_wall" ? { timeout: r } : { breakOnSigint: true, timeout: 3000 + r });
      } catch (e) { rec.err = String(e.message || e).slice(0, 60); }
      rec.wall = performance.now() - t0;
      rec.over = box.last - c1 - r;
      if (mech === "sigint_perf") rec.count_ms = Number((await side.ask("disarm")).split(" ")[1]) / 1e6;
      wdCtl[0] = 0;
    } else {
      // worker_kill: poll the worker's CPU from the main thread; terminate at R.
      const base = await cur.w.cpuUsage();
      const started = new Promise((res) => cur.w.once("message", res));
      cur.w.postMessage("go");
      await started;
      const t0 = performance.now();
      let polls = 0;
      for (;;) {
        const u = await cur.w.cpuUsage();
        polls++;
        const used = (u.user + u.system - base.user - base.system) / 1000;
        if (used >= r) break;
        await sleep(Math.max(0, Math.min(r - used, 50) - 0.5));
      }
      const tk = performance.now();
      await cur.w.terminate();
      rec.terminate_ms = performance.now() - tk;
      rec.wall = performance.now() - t0;
      rec.over = hb[1] - hb[0] - r;
      rec.polls = polls;
      cur = await newWorker(sab);
      rec.respawn_ms = cur.startMs;
    }
    W(rec);
  }
  side.close();
  await cur.w.terminate();
  await wd.terminate();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
