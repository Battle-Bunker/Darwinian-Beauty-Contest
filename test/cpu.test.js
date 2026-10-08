// Budgets are CPU time (docs/research/compute-budgets/REPORT.md §4): a flower's R and a bee's 50 ms count the
// call's own thread CPU, exactly, so a busy machine can't make a program late. The runners stop a call at its
// budget (Python: an hrtimer re-armed against the thread clock, and a thread CPU timer that SIGKILLs at budget
// + 5 ms for long C calls; TypeScript: a watchdog thread on the main thread's exact CPU clock sending SIGINT
// to a breakOnSigint script). Sleeping returns at once. A wall-clock backstop stops calls that aren't
// computing; a call that spent most of its time waiting for a CPU is the server's fault, and its turn is void.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { ProgramProcess } from "../server/runners/proc.js";
import { FlowerPool, readAnswer } from "../server/engine.js";
import { parseType } from "../server/lib/types.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";
import { size } from "../server/lib/measure.js";
import { play } from "./fixtures/garden.js";

const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CORE = "3";
const spinners = new Set();
after(() => { for (const pid of spinners) try { process.kill(pid, "SIGKILL"); } catch {} });

/** A process spinning forever on CORE, in a session (an autogroup) of its own, as a scaffold or tool shell is. */
function spinner() {
  const p = spawn("taskset", ["-c", CORE, "python3", "-c", "while True: pass"], { detached: true, stdio: "ignore" });
  spinners.add(p.pid);
  return () => { try { process.kill(p.pid, "SIGKILL"); } catch {} spinners.delete(p.pid); };
}
/** Pin a runner (every thread of it, and what it forks from now on) to CORE. */
const pin = (pid) => execFileSync("taskset", ["-apc", CORE, String(pid)], { stdio: "ignore" });

async function runner(language, code, setup = {}) {
  const { minified } = await size(language, code);
  const p = new ProgramProcess(language, "flower", { code: minified, ms: 150, wallMs: 400, faultShare: 0.5, maxResponseBytes: 1024, game: { team: 0 }, ...setup });
  const load = await p.ready;
  assert.ok(load.ok, JSON.stringify(load));
  return p;
}

const PY_LOOP = `def flower(c):\n    while True:\n        pass\n`;
const TS_LOOP = `function flower(c: number): [number, number] { while (true) {} }`;

for (const [language, loop, slack] of [["python", PY_LOOP, 1], ["typescript", TS_LOOP, 3]]) {
  test(`${language}: a call is stopped at R of its own CPU: an endless loop reports cpu within [R, R + ${slack} ms]`, async () => {
    const p = await runner(language, loop);
    try {
      for (const R of [3, 10, 37.5, 150]) {
        const res = await p.call({ op: "call", c: 1, ms: R });
        assert.match(res.e, /Timeout/, JSON.stringify(res));
        assert.ok(res.cpu >= R && res.cpu <= R + slack, `R ${R}: stopped at ${res.cpu} ms of CPU`);
      }
    } finally { p.kill(); }
  });
}

test("python: a long C call, or a program that swallows Timeout, is killed by R + 10 ms of CPU", async () => {
  const csum = await runner("python", `def flower(c):\n    return sum(range(10 ** 9)), 1\n`);
  const swallow = await runner("python", `def flower(c):\n    try:\n        while True:\n            pass\n    except BaseException:\n        while True:\n            pass\n`);
  try {
    for (const p of [csum, swallow]) {
      for (const R of [3, 20, 100]) {
        const res = await p.call({ op: "call", c: 1, ms: R });
        assert.match(res.e, /Timeout/);
        assert.ok(res.cpu >= R && res.cpu <= R + 10, `R ${R}: ${res.cpu} ms of CPU`);
      }
      const again = await p.call({ op: "call", c: 1, ms: 3 });
      assert.ok(!again.dead, "the runner serves the next call");
    }
  } finally { csum.kill(); swallow.kill(); }
});

test("lateness is judged on CPU: a flower whose cpu lands just over R is late; at R it is in time", () => {
  const config = normalizeConfig({});
  const rType = parseType("int");
  const late = readAnswer(config, rType, { cpu: 10.001, bytes: 1, v: [1, 50] }, 100, 10);
  assert.deepEqual([late.r, late.energy], [null, 0]);
  assert.match(late.flowerError, /Timeout: used 10\.001 ms of CPU, over its 10 ms/);
  const ok = readAnswer(config, rType, { cpu: 10, bytes: 1, v: [1, 50] }, 100, 10);
  assert.deepEqual([ok.r, ok.flowerError], [1, null]);
  const fault = readAnswer(config, rType, { e: "server fault: it waited 300 ms of 400 ms for a CPU", cpu: 2, fault: true }, 100, 10);
  assert.equal(fault.fault, true);
});

for (const language of ["python", "typescript"]) {
  const burn = language === "python"
    ? `import time\ndef flower(c):\n    while time.process_time() < 0.9 * GAME["ms"] / 1000:\n        pass\n    return [time.process_time() * 1000, time.thread_time() * 1000], 1\n`
    : `function flower(c: number): [number[], number] { while (performance.cpuTime() < 0.9 * GAME.ms) {} return [[performance.cpuTime(), performance.now()], 1]; }`;
  test(`${language}: a 0.9R flower next to a spinner pinned to its core is never late; its clock is the CPU R counts`, async () => {
    const p = await runner(language, burn);
    const stop = spinner();
    try {
      pin(p.child.pid);
      await wait(100);
      const stretched = [];
      for (const R of [10, 30, 60, 100, 150]) {
        for (let i = 0; i < 4; i++) {
          const t0 = performance.now();
          const res = await p.call({ op: "call", c: 1, ms: R });
          const wall = performance.now() - t0;
          assert.ok(res.v, `R ${R}: ${JSON.stringify(res)}`);
          assert.ok(res.cpu <= R, `R ${R}: ${res.cpu} ms of CPU`);
          const [own] = res.v[0];
          assert.ok(own >= 0.9 * R && res.cpu - own >= 0 && res.cpu - own < 1, `R ${R}: the program's CPU clock ${own}, the call's ${res.cpu}`);
          if (language === "python") assert.ok(Math.abs(res.v[0][0] - res.v[0][1]) < 0.05, "process_time() = thread_time(): exact while the alarms are armed");
          if (R >= 30) stretched.push(wall / res.cpu);
        }
      }
      stretched.sort((a, b) => a - b);
      assert.ok(stretched[stretched.length >> 1] > 1.4, `the spinner took its share of the core: wall ÷ CPU ${stretched.map((x) => x.toFixed(2))}`);
    } finally { stop(); p.kill(); }
  });
}

for (const language of ["python", "typescript"]) {
  const sleeper = language === "python"
    ? `import time\ndef flower(c):\n    time.sleep(5)\n    return 1, 1\n`
    : `function flower(c: number): [string, number] { return [Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000), 1]; }`;
  test(`${language}: sleeping returns at once (limits are CPU time: waiting earns nothing and can't stall the garden)`, async () => {
    const p = await runner(language, sleeper);
    try {
      const t0 = performance.now();
      const res = await p.call({ op: "call", c: 1, ms: 10 });
      assert.ok(res.v && performance.now() - t0 < 200, JSON.stringify(res));
      if (language === "typescript") assert.equal(res.v[0], "timed-out");
    } finally { p.kill(); }
  });
}

test("python: a call stopped by the wall backstop: late if it wasn't waiting for a CPU, the server's fault if it was", async () => {
  // Late: the call's process is stopped (SIGSTOP), so it neither runs nor waits for a CPU.
  const burn = `import time\ndef flower(c):\n    while time.process_time() < 0.09:\n        pass\n    return 1, 1\n`;
  const p = await runner("python", burn, { wallMs: 150 });
  try {
    const call = p.call({ op: "call", c: 1, ms: 100 });
    const children = `/proc/${p.child.pid}/task/${p.child.pid}/children`;
    let child = "";
    for (let i = 0; i < 200 && !child; i++) { child = fs.readFileSync(children, "utf8").trim(); if (!child) await wait(1); }
    process.kill(Number(child.split(" ")[0]), "SIGSTOP");
    const res = await call;
    assert.match(res.e, /^Timeout: still running after \d+ ms of wall time/, JSON.stringify(res));
    assert.deepEqual([res.backstop, res.fault], [true, false]);
  } finally { p.kill(); }
  // The server's fault: six spinners share its core, so it mostly waits.
  const q = await runner("python", burn, { wallMs: 150 });
  const stops = Array.from({ length: 6 }, spinner);
  try {
    pin(q.child.pid);
    await wait(100);
    const res = await q.call({ op: "call", c: 1, ms: 100 });
    assert.match(res.e, /^server fault: it waited \d+ ms of \d+ ms for a CPU/, JSON.stringify(res));
    assert.deepEqual([res.backstop, res.fault], [true, true]);
    assert.ok(res.cpu < 100);
  } finally { stops.forEach((s) => s()); q.kill(); }
});

test("typescript: the runner serves the next call after a CPU stop without a respawn, and survives stray SIGINTs", async () => {
  const p = await runner("typescript", `function flower(c: number): [number, number] { if (c === 0) { while (true) {} } return [c, 5]; }`);
  try {
    const pid = p.child.pid;
    for (let i = 0; i < 20; i++) {
      const stopped = await p.call({ op: "call", c: 0, ms: 3 });
      assert.match(stopped.e, /Timeout/);
      process.kill(pid, "SIGINT"); // a stray one, between calls
      const next = await p.call({ op: "call", c: 7, ms: 50 });
      assert.deepEqual(next.v, [7, 5], JSON.stringify(next));
    }
    assert.equal(p.child.pid, pid);
    assert.equal(p.dead, null);
  } finally { p.kill(); }
});

test("a bee starved of wall time but under 50 ms of CPU still feeds; over 50 ms of CPU it is late", async () => {
  const bee = `import time\ndef first():\n    return 1\ndef decide(c, r):\n    while time.process_time() < (0.04 if c < 5 else 0.07):\n        pass\n    return "feed", c + 1\n`;
  const stop = spinner();
  try {
    const out = await play(normalizeConfig({ feedCost: 0, budgets: { flower: { minMs: 150 } } }), [{ flower: `def flower(c):\n    return c, 50\n`, bee }], 7, async (garden) => {
      pin(garden.bees[0].proc.child.pid);
    }, { paced: true });
    const turns = ends(out.actions);
    const starved = turns.filter((a) => a.c < 5);
    assert.ok(starved.length >= 3 && starved.every((a) => a.action === "feed" && !a.beeError && a.beeMs >= 40 && a.beeMs <= 50), JSON.stringify(starved));
    const over = turns.filter((a) => a.c >= 5);
    assert.ok(over.length >= 1 && over.every((a) => a.action === "leave" && /too slow: used/.test(a.beeError)), JSON.stringify(over));
  } finally { stop(); }
});

test("a turn voided for a server fault: nobody decides or pays, nobody's problem, and the bee asks the same challenge again", async () => {
  const real = FlowerPool.prototype.call;
  let faults = 0;
  FlowerPool.prototype.call = async function (c, r) {
    if (c === 2 && faults++ === 0) return { e: "server fault: it waited 350 ms of 400 ms for a CPU, and ran 3.0 ms", cpu: 3, backstop: true, fault: true };
    return real.call(this, c, r);
  };
  try {
    const bee = `def first():\n    return 1\ndef decide(c, r):\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    return "feed", c + 1\n`;
    const out = await play(normalizeConfig({ feedCost: 0, budgets: { flower: { minMs: 150 } } }), [{ flower: `def flower(c):\n    return c, 50\n`, bee }], 5);
    const turns = ends(out.actions);
    assert.deepEqual(turns.map((a) => [a.c, a.action]), [[1, "feed"], [2, "leave"], [2, "feed"], [3, "feed"], [4, "feed"]]);
    assert.match(turns[1].flowerError, /^server fault/);
    assert.deepEqual([turns[1].energy, turns[1].pollen, turns[1].beeError], [0, 0, null]);
    assert.deepEqual(out.problems, [], "nobody's problem");
    assert.equal(JSON.parse(out.memories.at(-1).memory).n, 4, "the bee never decided the void turn");
  } finally { FlowerPool.prototype.call = real; }
});

test("a decision voided for a server fault: no feed, nobody's problem, its MEMORY kept, and the bee asks the same challenge again", async () => {
  const real = ProgramProcess.prototype.call;
  let decides = 0;
  ProgramProcess.prototype.call = function (obj, timeoutMs, onNotice) {
    // The second decision: the runner says "fault" (it waited for a CPU most of its 250 ms) before its reply.
    if (obj && typeof obj === "object" && obj.op === "decide" && ++decides === 2 && onNotice) onNotice("fault");
    return real.call(this, obj, timeoutMs, onNotice);
  };
  try {
    const bee = `def first():\n    return 1\ndef decide(c, r):\n    MEMORY["n"] = MEMORY.get("n", 0) + 1\n    return "feed", c + 1\n`;
    // (Paced: the void turn's reply comes after it is settled, and the bee is busy till then.)
    const out = await play(normalizeConfig({ feedCost: 0, budgets: { flower: { minMs: 150 } } }), [{ flower: `def flower(c):\n    return c, 50\n`, bee }], 6, null, { paced: true });
    const turns = ends(out.actions);
    assert.deepEqual(turns.slice(0, 5).map((a) => [a.c, a.action]), [[1, "feed"], [2, "leave"], [2, "feed"], [3, "feed"], [4, "feed"]]);
    assert.match(turns[1].beeError, /^server fault/);
    assert.deepEqual([turns[1].energy, turns[1].pollen, turns[1].nectar ?? 0], [0, 0, 0]);
    assert.deepEqual(out.problems, [], "nobody's problem");
    assert.equal(JSON.parse(out.memories.at(-1).memory).n, turns.length, "the void decision returned, so its MEMORY was saved");
  } finally { ProgramProcess.prototype.call = real; }
});
