#!/usr/bin/env node
// Dry-run check of round briefs (no model calls, no server): round 1 of a fresh arena and of a forked one (cohorts
// and continuations, whose game 0 is the source game), the round-1 notices, and the change turns of later rounds.
//   node arena/test-brief.mjs
import { NOTICES, examplesNotice, roundBrief } from "./lib/prompts.js";
import { changeable, nextChangeRound } from "../server/lib/schedule.js";

const budgets = { clover: { changes: 70 }, orchid: { changes: 490 }, bee: { changes: 700 } };
const view = { game: { config: { rounds: 6, budgets } }, teams: [{ id: "t", name: "Test Team" }], me: { teamId: "t" }, rounds: [] };
const base = { view, entry: { team_name: "Test Team" }, roundNo: 1, maxTurns: 30, ext: "py" };
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; };

const fresh = roundBrief({ ...base, generation: 1, forked: false });
check("fresh arena, game 1: told the files are empty", /program files are empty/.test(fresh));
check("fresh arena, game 1: all three programs are written", /write all three programs/.test(fresh));

const forked = roundBrief({ ...base, generation: 1, forked: true, notices: [NOTICES["v3-rules"]] });
check("forked arena, game 1: NOT told the files are empty", !/program files are empty/.test(forked));
check("forked arena, game 1: pointed at previous-games/game-0", /previous-games\/game-0\//.test(forked));
check("forked arena, game 1: the v3 rules notice is shown", forked.includes(NOTICES["v3-rules"].split("\n")[0]));

const files = ["a_clover.py", "b_clover.py", "checkers.py", "README.md"];
for (const g of [1, 2, 3]) {
  const t = roundBrief({ ...base, generation: g, forked: true, notices: [examplesNotice(files)] });
  check(`examples cohort, game ${g}: the examples notice lists every file`, files.every((f) => t.includes(f)) && /every team in this garden/i.test(t));
}

// Later rounds: whose turn it is, what is locked, and the restored-file note.
const played = { ...view, rounds: [{ no: 1, totals: [{ teamId: "t", fitness: 1 }], scores: [{ teamId: "t", fitness: 1 }] }] };
for (const r of [2, 3, 4, 5, 6]) {
  const open = changeable(r), locked = ["clover", "orchid", "bee"].filter((k) => !open.includes(k));
  const nextTurns = Object.fromEntries(locked.map((k) => [k, nextChangeRound(k, r)]));
  const t = roundBrief({ ...base, view: played, generation: 1, roundNo: r, forked: true, changeable: open, nextTurns, notices: [examplesNotice(files)] });
  check(`round ${r}: says it is the ${open.join("/")}'s turn and the others are locked`, t.includes(`it is your ${open[0]}`) && locked.every((k) => new RegExp(`your [a-z ,]*${k}`).test(t)) && /locked/.test(t));
  check(`round ${r}: no round-1 notices`, !/Shared examples|RULES CHANGED/.test(t));
}
const restored = roundBrief({ ...base, view: played, generation: 1, roundNo: 2, forked: true, changeable: changeable(2), restored: ["clover"] });
// (clover is locked before round 2 in every schedule so far)
check("restored note names the locked file", /edited clover\.py while it was locked/.test(restored));
const fix = roundBrief({ ...base, view: played, generation: 1, roundNo: 2, forked: true, changeable: changeable(2), fix: "- orchid: too big" });
check("fix brief: lists only the open files and points at the minified copy", fix.includes(`you may change ${changeable(2)[0]}.py`) && /minified/.test(fix));

console.log(failed ? `${failed} check(s) failed` : "all brief checks passed");
process.exit(failed ? 1 : 0);
