// The game's clock (the runners): every program call's clock reads 0 as its time starts, as if at the Unix
// epoch, and runs at real speed in fine steps, so programs can time their own work but learn nothing of the
// world's time or the game's progress. Python gets the game's own `time` module and module views with public
// names only; TypeScript gets the game's Date, Intl date formatting and performance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgramProcess } from "../server/runners/proc.js";
import { play } from "./fixtures/garden.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ends = (actions) => actions.filter((a) => a.action === "feed" || a.action === "leave");
const DAY = 86400; // a real clock would read decades past the epoch

async function twoCalls(language, code) {
  const p = new ProgramProcess(language, "flower", { code, ms: 150, maxResponseBytes: 1 << 20, game: { team: 0 } });
  try {
    assert.equal((await p.ready).ok, true);
    const a = await p.call({ op: "call", c: 1 });
    await wait(2000); // seconds apart
    const b = await p.call({ op: "call", c: 1 });
    return [a, b].map((r) => { assert.ok(r.v, JSON.stringify(r)); return r.v[0]; });
  } finally {
    p.kill();
  }
}

test("python: every clock in `time` reads the time since the call started, from 0 at the epoch; process time is the call's own; sleep returns at once", async () => {
  const code = `import time
from time import perf_counter
def flower(c):
    start = [time.time(), time.time_ns() / 1e9, time.monotonic(), time.monotonic_ns() / 1e9, time.perf_counter(), time.perf_counter_ns() / 1e9,
             time.clock_gettime(time.CLOCK_REALTIME), time.clock_gettime(time.CLOCK_MONOTONIC), time.clock_gettime_ns(time.CLOCK_BOOTTIME) / 1e9]
    t = perf_counter()
    while perf_counter() - t < 0.04:
        pass
    s = perf_counter()
    time.sleep(0.5)  # returns at once: there is nothing to wait for
    slept = perf_counter() - s
    return [start, [time.time(), time.perf_counter(), time.monotonic()], time.process_time(), time.thread_time(), slept,
            list(time.gmtime()[:6]), list(time.localtime()[:6]), time.ctime(), time.asctime(), time.strftime("%Y-%m-%d %H:%M:%S"),
            time.get_clock_info("time").implementation, time.timezone, list(time.gmtime(${DAY})[:3])], 50
`;
  const calls = await twoCalls("python", code);
  for (const [start, after, cpu, thread, slept, gm, local, ctime, asctime, stamp, impl, tz, day] of calls) {
    for (const x of start) assert.ok(x >= 0 && x < 0.03, `read ${x} s at the call's start: ${start}`);
    for (const x of after) assert.ok(x >= 0.04 && x < 0.12, `40 ms of work later: ${x} s`);
    assert.ok(slept < 0.005, `time.sleep(0.5) returned at once: ${slept} s`);
    assert.ok(cpu >= 0.035 && cpu < 0.12, `the call's own CPU time: ${cpu}`);
    assert.ok(thread >= 0.035 && thread < 0.12, `${thread}`);
    assert.deepEqual(gm, [1970, 1, 1, 0, 0, 0]);
    assert.deepEqual(local, [1970, 1, 1, 0, 0, 0], "local time is the game's clock, in UTC");
    assert.equal(ctime, "Thu Jan  1 00:00:00 1970");
    assert.equal(asctime, "Thu Jan  1 00:00:00 1970");
    assert.equal(stamp, "1970-01-01 00:00:00");
    assert.match(impl, /game's clock/);
    assert.equal(tz, 0);
    assert.deepEqual(day, [1970, 1, 2], "calendar functions still work on times given to them");
  }
});

test("python: modules show their public names only: no way through them to os, sys, builtins or the real clock", async () => {
  const code = `import random, statistics, dataclasses, enum, typing, fractions, collections.abc, json, string, re
def flower(c):
    leaks = [hasattr(random, "_os"), hasattr(statistics, "sys"), hasattr(dataclasses, "builtins"), hasattr(dataclasses, "sys"),
             hasattr(enum, "sys"), hasattr(typing, "sys"), hasattr(fractions, "sys"), hasattr(string, "_re"), hasattr(statistics, "random")]
    refused = []
    for name in ["os", "sys", "datetime", "uuid", "re._parser", "time.x", "importlib", "threading"]:
        try:
            __import__(name)
            refused.append(name + " imported")
        except ImportError:
            refused.append(None)
    works = [isinstance({}, collections.abc.Mapping), json.loads("[1]"), random.random() < 1, statistics.mean([1, 2]), re.sub("a", "b", "a")]
    return [leaks, refused, works], 50
`;
  const [[leaks, refused, works]] = await twoCalls("python", code);
  assert.deepEqual(leaks, leaks.map(() => false), "no private or borrowed modules");
  assert.deepEqual(refused, refused.map(() => null));
  assert.deepEqual(works, [true, [1], true, 1.5, "b"], "the public API works");
});

test("typescript: Date, Intl and performance read the time since the call started, from 0 at the epoch", async () => {
  const code = `function flower(c: number): [any, number] {
  const start = [Date.now(), new Date().getTime(), performance.now(), Date.parse(Date())];
  const p0 = performance.now();
  while (performance.now() - p0 < 30) {}
  class Later extends Date {}
  const RealDate = (new Date(0) as any).constructor;
  return [[start, [Date.now(), performance.now(), new Later().getTime(), new RealDate().getTime(), Reflect.construct(Date, []).getTime()],
    new Date().toISOString().slice(0, 19), Date().slice(0, 24), new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "short" }).format(),
    new Intl.DateTimeFormat("en-GB").formatToParts().find((p) => p.type === "year").value, performance.timeOrigin,
    typeof (globalThis as any).__hr, RealDate === Date, new Date(2020, 1, 3).getDate(), new Date(${DAY * 1000}).toISOString().slice(0, 10)], 50];
}`;
  const calls = await twoCalls("typescript", code);
  for (const [start, after, iso, str, fmt, year, origin, hr, same, date, day] of calls) {
    for (const x of start) assert.ok(x >= 0 && x < 30, `read ${x} ms at the call's start: ${start}`);
    for (const x of after) assert.ok(x >= 30 && x < 120, `30 ms later: ${after}`);
    assert.equal(iso, "1970-01-01T00:00:00");
    assert.equal(str, "Thu Jan 01 1970 00:00:00");
    assert.equal(fmt, "01/01/1970");
    assert.equal(year, "1970");
    assert.equal(origin, 0);
    assert.equal(hr, "undefined", "the host's clock isn't reachable");
    assert.equal(same, true, "a Date's constructor is the game's Date");
    assert.equal(date, 3, "dates built from parts work as usual");
    assert.equal(day, "1970-01-02");
  }
});

for (const language of ["python", "typescript"]) {
  test(`${language}: a bee's first(), decide() and fed() each start at 0, turn after turn`, async () => {
    const bee = language === "python"
      ? `import time\ndef first():\n    MEMORY["first"] = round(time.time() * 1000, 2)\n    return 1\ndef decide(c, r):\n    MEMORY["decide"] = max(MEMORY.get("decide", 0), round(time.perf_counter() * 1000, 2))\n    return "feed", c + 1\ndef fed(n):\n    MEMORY["fed"] = max(MEMORY.get("fed", 0), round(time.monotonic() * 1000, 2))\n`
      : `const ms = () => Math.round(performance.now() * 100) / 100; // (MEMORY is small: two decimals)\nfunction first() { MEMORY.first = ms(); return 1; }\nfunction decide(c: number, r: any): ["feed", number] { MEMORY.decide = Math.max(MEMORY.decide ?? 0, Date.now()); return ["feed", c + 1]; }\nfunction fed(n: number) { MEMORY.fed = Math.max(MEMORY.fed ?? 0, ms()); }`;
    const flower = language === "python" ? `def flower(c):\n    return c, 50\n` : `function flower(c: number): [number, number] { return [c, 50]; }`;
    const out = await play(normalizeConfig({ language, feedCost: 1 }), [{ flower, bee }], 30, null, { paced: true });
    const m = JSON.parse(out.memories.at(-1).memory);
    assert.ok(ends(out.actions).filter((a) => a.action === "feed").length >= 10);
    for (const k of ["first", "decide", "fed"]) assert.ok(m[k] >= 0 && m[k] < 30, `${k}: the latest of its starts read ${m[k]} ms, not the seconds or years into the game a real clock would show`);
  });
}
