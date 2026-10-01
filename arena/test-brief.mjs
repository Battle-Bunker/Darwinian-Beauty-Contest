#!/usr/bin/env node
// Dry-run check of round briefs (no model calls, no server): what a team is told in round 1 of game 1 of a fresh
// arena, of a forked arena (cohorts and v3-base, whose game 0 is the source game), and with the notices.
//   node arena/test-brief.mjs
import { NOTICES, examplesNotice, roundBrief } from "./lib/prompts.js";

const view = { game: { config: { rounds: 5, responseType: "graph[any]", budgets: { clover: { changes: 30 }, orchid: { changes: 210 }, bee: { changes: 300 } } } }, teams: [], rounds: [] };
const base = { view, entry: { team_name: "Test Team" }, roundNo: 1, maxTurns: 30, ext: "py" };
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; };

const fresh = roundBrief({ ...base, generation: 1, cohort: false });
check("fresh arena, game 1: told the files are empty", /program files are empty/.test(fresh));

const forked = roundBrief({ ...base, generation: 1, cohort: "v3", notices: [NOTICES["v3-rules"]] });
check("forked arena, game 1: NOT told the files are empty", !/program files are empty/.test(forked));
check("forked arena, game 1: pointed at previous-games/game-0", /previous-games\/game-0\//.test(forked));
check("forked arena, game 1: the v3 rules notice is shown", forked.includes(NOTICES["v3-rules"].split("\n")[0]));

const gx = roundBrief({ ...base, generation: 1, cohort: "gx", hasIdeas: true });
check("gx cohort, game 1: graph[any] rule change shown", /RULE CHANGE/.test(gx));
check("gx cohort, game 1: ideas.md pointer shown to holders", /ideas\.md/.test(gx));

const files = ["a_clover.py", "b_clover.py", "checkers.py", "README.md"];
for (const g of [1, 2, 3]) {
  const t = roundBrief({ ...base, generation: g, cohort: "v3x", notices: [examplesNotice(files)] });
  check(`examples cohort, game ${g}: the examples notice lists every file`, files.every((f) => t.includes(f)) && /every team in this garden/i.test(t));
}
const later = roundBrief({ ...base, generation: 1, roundNo: 2, cohort: "v3x", notices: [], view: { ...view, teams: [{ id: "t", name: "Test Team" }], me: { teamId: "t" },
  rounds: [{ no: 1, totals: [{ teamId: "t", fitness: 1 }], scores: [{ teamId: "t", fitness: 1 }] }] } });
check("round 2: no round-1 notices", !/Shared examples|RULES CHANGED/.test(later));

console.log(failed ? `${failed} check(s) failed` : "all brief checks passed");
process.exit(failed ? 1 : 0);
