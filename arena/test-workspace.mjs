#!/usr/bin/env node
// Disk-saving checks for workspaces (no server, no model calls): hard-linked shared visit files are counted once,
// and raw visit logs are kept for the current and previous game only.
//   node arena/test-workspace.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "arena-ws-test-"));
process.env.ARENA_WS_ROOT = root;
const { linkOrCopy, pruneOldVisits, roundLogBytes } = await import("./lib/workspace.js");
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; };
const put = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

// Two teams share one public visits file for round 1; each has its own my-bee.jsonl.
const shared = path.join(root, "A", ".shared", "g1", "round-1", "visits.jsonl");
put(shared, "x".repeat(1000));
for (const t of ["t1", "t2"]) {
  linkOrCopy(shared, path.join(root, "A", t, "logs", "round-1", "visits.jsonl"));
  put(path.join(root, "A", t, "logs", "round-1", "my-bee.jsonl"), "y".repeat(100));
}
const ino = (f) => fs.statSync(f).ino;
check("shared visits are hard links", ino(path.join(root, "A", "t1", "logs", "round-1", "visits.jsonl")) === ino(shared));
check("round log bytes count the shared file once", roundLogBytes("A", 1) === 1000 + 2 * 100);

// Retention: game 3 starts; keep raw visits of game 2, drop games 0 and 1, keep summaries and memory.
const ws = path.join(root, "A", "t1");
for (const g of [0, 1, 2]) {
  put(path.join(ws, "previous-games", `game-${g}`, "own", "logs", "round-1", "visits.jsonl"), "v");
  put(path.join(ws, "previous-games", `game-${g}`, "own", "logs", "round-1", "my-patch.jsonl"), "v");
  put(path.join(ws, "previous-games", `game-${g}`, "own", "logs", "round-1", "round.json"), "{}");
  put(path.join(ws, "previous-games", `game-${g}`, "own", "memory", "round-1.txt"), "m");
}
pruneOldVisits(ws, 3);
const has = (g, f) => fs.existsSync(path.join(ws, "previous-games", `game-${g}`, "own", ...f.split("/")));
check("games 0 and 1: raw visits removed", !has(0, "logs/round-1/visits.jsonl") && !has(1, "logs/round-1/my-patch.jsonl"));
check("games 0 and 1: round.json and memory kept", has(0, "logs/round-1/round.json") && has(1, "memory/round-1.txt"));
check("game 2 (the previous game): raw visits kept", has(2, "logs/round-1/visits.jsonl") && has(2, "logs/round-1/my-patch.jsonl"));

fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all workspace checks passed");
process.exit(failed ? 1 : 0);
