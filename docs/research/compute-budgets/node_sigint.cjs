// Is a SIGINT that arrives outside a breakOnSigint script harmless, given a process.on("SIGINT") listener?
//   node node_sigint.cjs OUT.json
// Each case runs in its own node process; the result is how that process ended.
"use strict";
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const CASES = {
  // a SIGINT with a listener and no script ever run with breakOnSigint
  plain: `process.on("SIGINT", () => console.log("listener"));
    process.kill(process.pid, "SIGINT");
    setTimeout(() => { console.log("survived"); process.exit(0); }, 100);`,
  // a breakOnSigint script that ends normally, then a SIGINT
  after_clean: `process.on("SIGINT", () => console.log("listener"));
    const vm = require("node:vm");
    vm.runInContext("let x = 0; for (let i = 0; i < 1e6; i++) x += i;", vm.createContext({}), { breakOnSigint: true });
    process.kill(process.pid, "SIGINT");
    setTimeout(() => { console.log("survived"); process.exit(0); }, 100);`,
  // a breakOnSigint script interrupted by SIGINT, then a second SIGINT after it
  after_interrupt: `process.on("SIGINT", () => console.log("listener"));
    const vm = require("node:vm");
    const { spawn } = require("node:child_process");
    spawn("sh", ["-c", "sleep 0.05; kill -INT " + process.pid]);
    setTimeout(() => {
      try { vm.runInContext("for (;;) {}", vm.createContext({}), { breakOnSigint: true, timeout: 3000 }); }
      catch (e) { console.log("interrupted: " + e.message); }
      process.kill(process.pid, "SIGINT");
      setTimeout(() => { console.log("survived"); process.exit(0); }, 100);
    }, 0);`,
};

const out = {};
for (const [name, src] of Object.entries(CASES)) {
  const p = spawnSync(process.execPath, ["-e", src], { encoding: "utf8", timeout: 10000 });
  out[name] = { status: p.status, signal: p.signal, stdout: p.stdout.trim().split("\n") };
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
