#!/usr/bin/env node
// Within-game dynamics of the signalling ecosystem (lib/dynamics.js) on hand-made turns and labels: mechanisms in use and
// their entropy per window, the dominant mechanism and species and how often they change hands, innovations first seen
// in the cohort, signal families, and a frozen ecosystem. No server, no database.
//   node arena/test-dynamics.mjs
import { dynamics, entropy, tokensOf } from "./lib/dynamics.js";

let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === undefined ? "" : ": " + JSON.stringify(extra).slice(0, 600)}`); if (!ok) failed++; };

check("entropy: 0 for one kind, 1 bit for two equal, log2(4) for four", entropy({ a: 3 }) === 0 && Math.abs(entropy({ a: 2, b: 2 }) - 1) < 1e-9 && Math.abs(entropy(new Map([["a", 1], ["b", 1], ["c", 1], ["d", 1]])) - 2) < 1e-9);
check("tokens: a flower's mechanism and families, a bee's check; uncertain evidence is not a token",
  tokensOf("flower", { mechanism: "keyed", families: ["keyed", "puzzle?"] }).join() === "mechanism:keyed,family:keyed" && tokensOf("bee", { checks: "key-check" }).join() === "check:key-check"
  && tokensOf("bee", { checks: "none" }).length === 0 && tokensOf("flower", { mechanism: "?" }).length === 0);

// Three species over three minutes. A keeps a rule; B moves from a rule to a keyed signal at 1:00 (and dominates); C adds a
// puzzle at 2:00 (and dominates). Rival bees feed where the signal is new.
const labels = {
  "A:1": { mechanism: "rule", families: ["signature"], level: 0 },
  "B:1": { mechanism: "rule", families: [], level: 0 }, "B:2": { mechanism: "keyed", families: ["keyed"], level: 2 },
  "C:1": { mechanism: "rule", families: [], level: 0 }, "C:2": { mechanism: "hash-pow", families: ["puzzle", "keyed"], level: 3 },
};
const bees = { "A:1": { checks: "shape-stats", level: 1 }, "B:1": { checks: "key-check", level: 2 }, "C:1": { checks: "none", level: 0 } };
const turns = [];
const T = (atMs, bee, flower, fed, fv) => turns.push({ atMs, bee, flower, action: fed ? "feed" : "leave", flowerVersion: fv, beeVersion: 1 });
for (let i = 0; i < 10; i++) { T(i * 5000, "A", "B", i % 3 === 0, 1); T(i * 5000 + 100, "B", "A", i % 2 === 0, 1); T(i * 5000 + 200, "C", "C", false, 1); }
for (let i = 0; i < 10; i++) { T(60000 + i * 5000, "A", "B", true, 2); T(60000 + i * 5000 + 100, "C", "A", false, 1); T(60000 + i * 5000 + 200, "B", "C", false, 1); }
for (let i = 0; i < 10; i++) { T(120000 + i * 5000, "A", "C", true, 2); T(120000 + i * 5000 + 100, "B", "B", true, 2); T(120000 + i * 5000 + 200, "C", "A", false, 1); }
const seen = new Set(["mechanism:rule"]); // seen in an earlier game of the cohort
const d = dynamics({ turns, ids: ["A", "B", "C"], flowerLabel: (t, v) => labels[`${t}:${v}`], beeLabel: (t, v) => bees[`${t}:${v}`], windowMs: 60000, durationMs: 180000, seen });
check("windows: one a minute, the mechanisms in use per species", d.windows.length === 3 && d.windows[0].mechanisms.rule === 3 && d.windows[1].mechanisms.keyed === 1 && d.windows[1].mechanisms.rule === 2
  && d.windows[2].mechanisms["hash-pow"] === 1, d.windows);
check("entropy: 0 while every species plays a rule, then up", d.windows[0].entropy === 0 && d.windows[1].entropy > 0.9 && d.windows[2].entropy > 1.5, d.windows.map((w) => w.entropy));
check("dominance: the mechanism and species with the most rival feeds, and turnover", d.windows[1].dominantMechanism.key === "keyed" && d.windows[2].dominantMechanism.key === "hash-pow"
  && d.windows[2].dominantSpecies.key === "C" && d.turnover.mechanism === 2 && d.turnover.species >= 1, [d.windows.map((w) => [w.dominantMechanism, w.dominantSpecies]), d.turnover]);
check("innovation: tokens first seen in the cohort, with when (rule was seen before)", d.newTokens === 7 && d.innovations.some((x) => x.token === "mechanism:keyed" && x.atMs === 60000)
  && d.innovations.some((x) => x.token === "family:puzzle" && x.atMs === 120000) && !d.innovations.some((x) => x.token === "mechanism:rule") && d.windows[1].newTokens.includes("family:keyed"), d.innovations);
check("innovation: the cohort's seen set grows", seen.has("mechanism:hash-pow") && seen.has("check:key-check"));
check("families: species using each", d.families.keyed === 2 && d.families.puzzle === 1 && d.families.signature === 1, d.families);
{
  const u = dynamics({ turns: [{ atMs: 0, flower: "A", flowerVersion: 1, bee: "B", fed: true, nectar: 1 }], ids: ["A", "B"], windowMs: 1000, durationMs: 1000,
    flowerLabel: () => ({ mechanism: "rule", families: ["keyed?"], level: 0 }), beeLabel: () => ({ checks: "none", level: 0 }) });
  check("families: uncertain keyword evidence is shown under its own name, but is no innovation", u.families["keyed?"] === 1 && !u.innovations.some((x) => /keyed/.test(x.token ?? x)), u);
}
check("levels: mean flower and bee levels in play", d.windows[0].meanFlowerLevel === 0 && d.windows[2].meanFlowerLevel > 1 && d.windows[0].meanBeeLevel === 1, d.windows.map((w) => [w.meanFlowerLevel, w.meanBeeLevel]));
check("not frozen while things change", !d.frozen);
const still = dynamics({ turns: turns.slice(0, 30).map((t, i) => ({ ...t, atMs: i * 6000 })), ids: ["A", "B", "C"], flowerLabel: (t) => labels[`${t}:1`], beeLabel: () => bees["A:1"], windowMs: 60000, durationMs: 180000, seen: new Set(["mechanism:rule", "family:signature", "check:shape-stats"]) });
check("frozen: one mechanism and nothing new for the last three windows", still.frozen && still.newTokens === 0, still);

console.log(failed ? `${failed} check(s) failed` : "all dynamics checks passed");
process.exit(failed ? 1 : 0);
