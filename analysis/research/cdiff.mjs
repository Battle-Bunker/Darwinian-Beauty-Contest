// node cdiff.mjs <arena> <gen> <team> [kind=clover] : code of round 1, then diffs of each changed round
import { loadAll } from "./lib.mjs";
import fs from "node:fs"; import { execSync } from "node:child_process";
const [arena, gen, team, kind = "clover"] = process.argv.slice(2);
const g = (await loadAll()).find((g) => g.arena === arena && g.gen === +gen);
const t = g.ids.find((x) => g.names[x].includes(team));
const tmp = "/tmp/claude-0/-home-user/ac160c69-15f5-534e-9e3a-7b508ab58e74/scratchpad/";
console.log(`=== ${g.names[t]} ${kind} r1\n` + g.rounds[0].programs[t][kind].code);
for (let i = 1; i < g.rounds.length; i++) {
  const a = g.rounds[i - 1].programs[t][kind].code, b = g.rounds[i].programs[t][kind].code;
  if (a === b) { console.log(`--- r${i + 1}: unchanged`); continue; }
  fs.writeFileSync(tmp + "a.txt", a); fs.writeFileSync(tmp + "b.txt", b);
  let d = ""; try { execSync(`diff -u ${tmp}a.txt ${tmp}b.txt`); } catch (e) { d = e.stdout.toString(); }
  console.log(`--- r${i + 1}: dist ${g.rounds[i].programs[t][kind].distance}\n` + d.split("\n").slice(2).join("\n"));
}
