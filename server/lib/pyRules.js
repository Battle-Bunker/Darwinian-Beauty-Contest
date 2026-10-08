// The rules a Python program must keep (server/runners/py_rules.py: no dunder attributes or names, no
// interpreter internals, str.format only on a literal, no eval/exec/globals/vars/...), checked when a
// program is checked or submitted. The runner checks again before it runs one.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runners", "py_rules.py");

/** The program's rule breaches as messages ("line 3: ..."); [] if none (or for TypeScript). */
export function ruleBreaches(language, code) {
  if (language !== "python") return Promise.resolve([]);
  return new Promise((resolve) => {
    const child = execFile(process.env.PYTHON || "python3", ["-s", SCRIPT], { timeout: 10000, maxBuffer: 1 << 20, env: { PATH: process.env.PATH || "/usr/bin:/bin" } },
      (err, stdout) => {
        if (err) return resolve([`the program could not be checked: ${String(err.message).slice(0, 200)}`]);
        try { resolve(JSON.parse(stdout).errors || []); } catch { resolve(["the program could not be checked"]); }
      });
    child.stdin.end(JSON.stringify({ code }));
  });
}
