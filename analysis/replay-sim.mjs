// 4(a) Face-stealing orchid vs fingerprinting bees, scripted on the real engine (no LLMs, no database).
//
// 6 teams, int -> int, 5 rounds, bees keep MEMORY. Every clover is a keyed hash of the challenge H(k, c); every orchid
// is a different keyed hash, except the THIEF's (team 1): from round 2 on it hard-codes, for every challenge rival bees
// asked at its patch LAST round (its flower log), the VICTIM clover's (team 0) answer. An orchid is frozen for a
// round, so it always lags one round. Control arm: the same garden with an honest thief orchid.
//
// Bees (all six use the same policy) fingerprint flowers by their answer ("face") to a probe and keep a nectar tally
// per face; they know their own two flowers. Probe regimes:
//   fixed   one probe for the whole game; the face tally is carried in MEMORY
//   rotate  a new secret probe every round (what the best v2 bees did); tallies start fresh each round
//   fresh   a new random challenge at every visit (nothing to fingerprint: every face is new, so it tastes everything)
// Tally policies: strict (feed only while a face always paid), lax (while ≥ half paid), split (strict, but a face that
// both paid and failed gets a second secret probe, and the pair of answers becomes the face; the thief learns that
// probe from its log a round later too).
//
//   node analysis/replay-sim.mjs [seeds=3]
import { playGame, summarise, H40, PY_H40, mean, f2, f3 } from "./sim-lib.mjs";

const N = 6, ROUNDS = 5, VICTIM = 0, THIEF = 1;
const SEEDS = Number(process.argv[2] || 3);
const config = { language: "python", challengeType: "int", responseType: "int", turnsPerFlower: 100, feedCost: 5, rounds: ROUNDS };
const kC = (i) => `clover-${i}`, kO = (i) => `orchid-${i}`;

const hashFlower = (k) => `import hashlib
${PY_H40}
def flower(c):
    return H40("${k}", c)
`;
const thiefOrchid = (table) => `import hashlib
${PY_H40}
TABLE = {${[...table].map(([c, a]) => `${c}: ${a}`).join(", ")}}
def flower(c):
    if c in TABLE:
        return TABLE[c]
    return H40("${kO(THIEF)}", c)
`;
const bee = (i, mode, policy) => `import hashlib, random
${PY_H40}
KC, KO = "${kC(i)}", "${kO(i)}"
MODE, POLICY = "${mode}", "${policy}"
ROUND = len(MEMORY)
SLOT = ROUND if MODE == "rotate" else 0
P1 = 10 ** 12 + H40("probe-" + KC, SLOT) % 10 ** 12
P2 = 3 * 10 ** 12 + H40("probe2-" + KC, SLOT) % 10 ** 12
stats = dict(MEMORY[-1]["stats"]) if MEMORY and MODE == "fixed" else {}


def mixed(k):
    fed, paid = stats.get(k, [0, 0])
    return 0 < paid < fed


def face(seen):
    if len(seen) >= 2 and seen[1][0] == P2:
        return str(seen[0][1]) + "/" + str(seen[1][1])
    return str(seen[0][1])


def forage(seen, turns_left, visit):
    if visit["fed"]:
        return "leave"
    if not seen:
        return ["ask", P1 if MODE != "fresh" else random.randint(10 ** 12, 9 * 10 ** 15)]
    c, r = seen[0]
    if r == H40(KC, c):
        return "feed"
    if r == H40(KO, c) or turns_left < GAME["feed_cost"] + 1:
        return "leave"
    if POLICY == "split" and len(seen) == 1 and mixed(str(r)):
        return ["ask", P2]
    fed, paid = stats.get(face(seen), [0, 0])
    if fed == 0:
        return "feed"
    if POLICY == "lax":
        return "feed" if 2 * paid >= fed else "leave"
    return "feed" if paid == fed else "leave"


def tasted(seen, nectar):
    for k in {face(seen), str(seen[0][1])}:
        s = list(stats.get(k, [0, 0]))
        s[0] += 1
        s[1] += 1 if nectar else 0
        stats[k] = s
`;

function programsFor(mode, policy, theft) {
  return (r, history) => {
    const table = new Map();
    if (theft && r > 1) {
      // flower log of the previous round: every challenge a rival bee asked at the thief's patch
      for (const v of history[r - 2].visits) if (v.patch === THIEF && v.bee !== THIEF) for (const s of v.steps) table.set(s.c, H40(kC(VICTIM), s.c));
    }
    return Array.from({ length: N }, (_, i) => ({
      clover: hashFlower(kC(i)),
      orchid: i === THIEF && theft ? thiefOrchid(table) : hashFlower(kO(i)),
      bee: bee(i, mode, policy),
    }));
  };
}

const OTHERS = [2, 3, 4, 5]; // bystander bees (not the victim's, not the thief's)
function measure(game) {
  const out = { perRound: [] };
  for (const h of game.history) {
    let vc = [0, 0], to = [0, 0], oc = [0, 0], st = [0, 0];
    for (const v of h.visits) {
      if (!OTHERS.includes(v.bee)) continue;
      const fed = v.action === "feed";
      if (v.patch === VICTIM && v.kind === "clover") { vc[1]++; if (fed) vc[0]++; }
      else if (v.patch === THIEF && v.kind === "orchid") {
        to[1]++; if (fed) to[0]++;
        if (v.steps[0] && v.steps[0].r === H40(kC(VICTIM), v.steps[0].c)) { st[1]++; if (fed) st[0]++; }
      } else if (v.kind === "clover" && v.patch !== v.bee && v.patch !== THIEF) { oc[1]++; if (fed) oc[0]++; }
    }
    out.perRound.push({ r: h.round, victimClover: vc[0] / vc[1], thiefOrchid: to[0] / to[1], otherClovers: oc[0] / oc[1], stolenShown: st[1] / Math.max(1, to[1]), stolenFed: st[1] ? st[0] / st[1] : null });
  }
  const s = summarise(game.history, N);
  out.victimFit = game.scores[VICTIM].fitness; out.thiefFit = game.scores[THIEF].fitness;
  out.victimAllure = game.scores[VICTIM].allureShare * N; out.thiefAllure = game.scores[THIEF].allureShare * N;
  out.beeNectar = mean(OTHERS.map((b) => s.bee[b].nectarPerTurn)); out.beeGap = mean(OTHERS.map((b) => s.bee[b].gap));
  out.errors = s.bee.reduce((a, b) => a + b.errors, 0);
  out.problems = game.history.flatMap((h) => h.problems);
  return out;
}

console.log(`# 4(a) face-stealing orchid: ${N} teams, ${ROUNDS} rounds, ${SEEDS} seeds per cell; victim = team 0's clover, thief = team 1's orchid`);
console.log("bystander bees = teams 2-5; fed rates are theirs; Δ = theft − control\n");
const results = [];
for (const mode of ["fixed", "rotate", "fresh"]) for (const policy of ["strict", "lax", "split"]) {
  if (mode === "fresh" && policy !== "strict") continue; // every fresh face is new: the policies coincide
  const cell = { mode, policy, theft: [], control: [] };
  for (const theft of [true, false]) for (let seed = 1; seed <= SEEDS; seed++) {
    const t0 = Date.now();
    const g = await playGame({ config, nTeams: N, rounds: ROUNDS, seed, programsFor: programsFor(mode, policy, theft) });
    const m = measure(g);
    if (m.problems.length) console.log("  problems:", m.problems.slice(0, 3));
    cell[theft ? "theft" : "control"].push(m);
    process.stderr.write(`${mode}/${policy}/${theft ? "theft" : "control"} seed ${seed}: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
  results.push(cell);
  const avgR = (arr, k) => Array.from({ length: ROUNDS }, (_, i) => mean(arr.map((m) => m.perRound[i][k])));
  console.log(`## ${mode} probe, ${policy} tally`);
  console.log("  round:                         " + Array.from({ length: ROUNDS }, (_, i) => `  r${i + 1} `).join(""));
  for (const [label, arr, k] of [["victim clover fed (theft)", cell.theft, "victimClover"], ["victim clover fed (control)", cell.control, "victimClover"],
    ["other rival clovers fed (theft)", cell.theft, "otherClovers"], ["thief orchid fed (theft)", cell.theft, "thiefOrchid"], ["thief orchid fed (control)", cell.control, "thiefOrchid"],
    ["thief visits showing stolen face", cell.theft, "stolenShown"]])
    console.log(`  ${label.padEnd(31)}` + avgR(arr, k).map((x) => ` ${f2(x)}`).join(""));
  const d = (k) => mean(cell.theft.map((m) => m[k])) - mean(cell.control.map((m) => m[k]));
  console.log(`  game: victim fitness ${f2(mean(cell.theft.map((m) => m.victimFit)))} vs ${f2(mean(cell.control.map((m) => m.victimFit)))} (Δ ${f2(d("victimFit"))}), victim allure×N Δ ${f2(d("victimAllure"))}; ` +
    `thief fitness ${f2(mean(cell.theft.map((m) => m.thiefFit)))} vs ${f2(mean(cell.control.map((m) => m.thiefFit)))} (Δ ${f2(d("thiefFit"))}), thief allure×N Δ ${f2(d("thiefAllure"))}; ` +
    `bystander nectar/turn ${f3(mean(cell.theft.map((m) => m.beeNectar)))} vs ${f3(mean(cell.control.map((m) => m.beeNectar)))}, gap ${f2(mean(cell.theft.map((m) => m.beeGap)))} vs ${f2(mean(cell.control.map((m) => m.beeGap)))}\n`);
}
const fs = await import("node:fs");
fs.writeFileSync(new URL("../arena/runs/replay-sim.json", import.meta.url),
  JSON.stringify(results.map((c) => ({ ...c, theft: c.theft.map(({ problems, ...m }) => m), control: c.control.map(({ problems, ...m }) => m) }))));
