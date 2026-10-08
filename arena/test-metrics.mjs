#!/usr/bin/env node
// One-flower metrics on a hand-made finished game's history rows (docs/QUERY.md shape; no server, no database): windows of
// energy, percent, nectar and pollen; distributions; per-team flowers and bees; self-feeding and handshakes; discrimination;
// flower size and compute against energy; copies of answers between flowers; the change timeline with sessions; the
// scores with their two shares.
//   node arena/test-metrics.mjs
import { bigShapes, computeMetrics, windowFor } from "./lib/metrics.js";

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${JSON.stringify(extra).slice(0, 500)}`}`); if (!ok) failed++; };
const config = { minutes: 1, feedCost: 10, challengeType: "int", responseType: "int", budgets: { flower: { size: 1100, ms: 150 }, bee: { size: 11000, ms: 50, memory: 50 } } };
const E = (size, ms) => (1100 - size) * Math.max(0, 150 - ms);

const IDX = { A: 0, B: 1, C: 2 };
const rows = [];
/** One turn as the turns entity has it once the game is over (every field revealed; teams as indices). */
function turn(round, bee, flower, c, r, percent, ms, fed, extra = {}) {
  const size = extra.size ?? 100;
  const energy = r === null ? 0 : E(size, ms);
  rows.push({ game: "G", round, atMs: (round - 1) * 200, turn: round, bee: IDX[bee], flower: IDX[flower], challenge: c, response: r, fed,
    percent: r === null ? null : percent, energy, nectar: fed ? (percent / 100) * energy : null, pollen: fed ? (1 - percent / 100) * energy : 0, ms,
    flowerVersion: extra.v ?? 1, flowerError: r === null ? "Timeout: took too long" : null, beeMs: 3, beeVersion: 1, beeError: extra.beeError ?? null });
}
// Window 0-10 s. A, C flowers have size 100, B's 600; A's flower v2 (size 200) goes live at 12 s.
turn(1, "A", "B", 5, 16, 50, 50, true, { size: 600 });   // E 50,000: nectar 25,000, pollen 25,000
turn(1, "B", "A", 5, 99, 10, 10, false);                  // E 140,000 lost
turn(1, "C", "C", 1, 1, 90, 0, true);                     // a bee at its own flower: E 150,000, nectar 135,000
turn(2, "B", "C", 7, 7, 90, 0, true);                     // E 150,000, nectar 135,000
// Window 10-20 s. A's flower v2 answers 5 -> 16, as B's flower did at 0.15 s: a copy 15 s later.
turn(76, "B", "A", 5, 16, 20, 50, true, { size: 200, v: 2 }); // E 90,000: nectar 18,000, pollen 72,000
turn(76, "A", "B", 9, null, 0, 160, false, { size: 600 });    // the flower failed: no response, no energy
turn(77, "A", "A", 3, 3, 20, 50, false, { size: 200, v: 2, beeError: "too slow: no reply within 50 ms" }); // E 90,000 lost
turn(77, "C", "B", 2, 4, 5, 100, false, { size: 600, beeError: "MEMORY over its cap (60 of 50 bytes): not saved" }); // E 25,000 lost

const ver = (team, kind, version, size, atMs, extra = {}) => ({ game: "G", team: IDX[team], kind, version, size, atMs, round: atMs / 200 + 1, distance: null, cost: 0, problem: null, ...extra });
const game = { config, clockMs: 20000, round: 100 };
const teams = [{ index: 0, id: "A", name: "Alpha", memory: { seen: 3 }, memoryBytes: 5 },
  { index: 1, id: "B", name: "Beta", memory: {}, memoryBytes: 0, memoryError: "fed() failed (ZeroDivisionError: division by zero): MEMORY is as saved after decide" },
  { index: 2, id: "C", name: "Gamma", memory: { big: "x".repeat(40), n: 7 }, memoryBytes: 47 }];
const versions = [ver("A", "flower", 1, 100, 0), ver("A", "flower", 2, 200, 12000, { distance: 100, cost: 100 }), ver("A", "bee", 1, 300, 0),
  ver("B", "flower", 1, 600, 0), ver("B", "bee", 1, 300, 0), ver("B", "bee", 2, 310, 6000, { distance: 10, cost: 10 }), ver("B", "bee", 3, 320, 16000, { distance: 10, cost: 10 }),
  ver("C", "flower", 1, 100, 0), ver("C", "bee", 1, 300, 0)];
const scores = [
  { game: "G", team: 0, fitness: 0.9, pollination: 268.3, forage: 158.1, pollinationShare: 0.43, forageShare: 0.23, pollen: 72000, feedsReceived: 1, feedsGiven: 1, pollinators: 1, nectarCollected: 25000, nectarGiven: 18000, nectarSources: 1 },
  { game: "G", team: 1, fitness: 1.1, pollination: 158.1, forage: 501.6, pollinationShare: 0.26, forageShare: 0.52, pollen: 25000, feedsReceived: 1, feedsGiven: 2, pollinators: 1, nectarCollected: 153000, nectarGiven: 25000, nectarSources: 2 },
  { game: "G", team: 2, fitness: 1.0, pollination: 244.9, forage: 367.4, pollinationShare: 0.31, forageShare: 0.25, pollen: 30000, feedsReceived: 2, feedsGiven: 1, pollinators: 2, nectarCollected: 135000, nectarGiven: 270000, nectarSources: 1 },
];
const submits = [{ team_id: "A", kind: "flower", version: 2, source: "session", session_no: 1 }];
const memorySamples = [{ clockMs: 5000, team: "C", bytes: 20, version: 1, keys: 1 }, { clockMs: 10000, team: "C", bytes: 47, version: 1, keys: 2 },
  { clockMs: 10000, team: "B", bytes: 9, version: 2, error: "fed() failed (KeyError: 'n'): MEMORY is as saved after decide" }];
const r = computeMetrics({ game, teams, turns: rows, versions, scores, submits, memorySamples, windowMs: 10000 });

check("turns: one per turn row", r.turns === 8 && r.rounds === 100, { turns: r.turns, rounds: r.rounds });
check("totals: feeds, energy produced and lost, nectar, pollen, failures, self-feeds",
  r.totals.feeds === 4 && r.totals.feedRate === 0.5 && r.totals.energy === 695000 && r.totals.energyLost === 255000 && r.totals.nectar === 313000 && r.totals.pollen === 127000
  && r.totals.failures === 1 && r.totals.selfFeeds === 1, r.totals);
check("pollen only from feeds: a turn without a feed adds nothing", r.teams.A.flower.pollen === 72000 && r.teams.B.flower.pollen === 25000, [r.teams.A.flower, r.teams.B.flower]);
check("windows: one per 10 s, with energy lost and mean percent",
  r.windows.length === 2 && r.windows[0].turns === 4 && r.windows[0].feeds === 3 && r.windows[0].energy === 490000 && r.windows[0].energyLost === 140000 && r.windows[0].meanPercent === 60
  && r.windows[1].turns === 4 && r.windows[1].feeds === 1 && r.windows[1].energyLost === 115000 && r.windows[1].failures === 1 && r.windows[1].meanPercent === 15 && r.windows[0].selfFeeds === 1, r.windows);
check("distributions: percent over answered turns, nectar and pollen over feeds", r.distributions.percent.n === 7 && r.distributions.nectar.n === 4 && r.distributions.nectar.max === 135000
  && r.distributions.pollen.min === 15000 && r.distributions.energy.n === 8, r.distributions);
const A = r.teams.A, B = r.teams.B, C = r.teams.C;
check("flower: visits, feeds, pollinators, energy lost, nectar paid", A.flower.turns === 3 && A.flower.feeds === 1 && A.flower.pollinators === 1 && A.flower.energyLost === 230000
  && A.flower.nectarPaid === 18000 && C.flower.pollinators === 2 && C.flower.feedRate === 1 && B.flower.failures === 1, [A.flower, C.flower]);
check("flower: compute against the flower window", B.flower.ms.max === 160 && A.flower.computeShare === Math.round((110 / 3 / 150) * 1000) / 1000, [A.flower.ms, A.flower.computeShare]);
check("bee: turns, feeds, nectar, too slow", A.bee.turns === 3 && A.bee.feeds === 1 && A.bee.nectar === 25000 && A.bee.tooSlow === 1 && B.bee.nectar === 153000 && B.bee.flowersFedAt === 2, [A.bee, B.bee]);
check("self-feeding: a bee at its own flower", C.selfFeeding.ownTurns === 1 && C.selfFeeding.ownFeeds === 1 && C.selfFeeding.ownShareOfFeeds === 1 && A.selfFeeding.ownFeedRate === 0, [C.selfFeeding, A.selfFeeding]);
check("handshake: not flagged on fewer than 5 own turns", !C.handshake.flag && !A.handshake.flag);
const D = r.discrimination;
check("discrimination: feed rate by percent offered", D.byPercent[0].turns === 1 && D.byPercent[0].feedRate === 0 && D.byPercent[1].turns === 3 && D.byPercent[1].feeds === 1 && D.byPercent[3].feedRate === 1, D.byPercent);
check("discrimination: feed rate by the nectar on offer (terciles)", D.byOffer.cuts[0] === 18000 && D.byOffer.cuts[1] === 25000 && D.byOffer.low.turns === 4 && D.byOffer.low.feedRate === 0.25 && D.byOffer.high.feedRate === 1, D.byOffer);
check("discrimination: per bee, the offer when it fed vs left", D.perBee.A.offerWhenFed === 25000 && D.perBee.A.offerWhenLeft === 18000, D.perBee.A);
const v2 = r.versions.find((v) => v.teamId === "A" && v.version === 2);
check("versions: size and compute against energy", v2 && v2.size === 200 && v2.maxEnergy === 135000 && v2.atMs === 12000 && v2.turns === 2 && v2.meanEnergy === 90000 && v2.meanMs === 50 && v2.feeds === 1, v2);
check("copies: A's new flower copied B's answer 15 s after it appeared", r.copies.matches === 1 && r.copies.copies === 1 && r.copies.medianLatencyMs === 15000 && r.copies.byCopier[0].sources[0] === "Beta", r.copies);
check("changes: timeline with the session that submitted", r.changes.find((c) => c.kind === "flower" && c.version === 2 && c.teamId === "A")?.session === 1 && r.changes[0].atMs === 0 && r.changes.length === 9, r.changes);
const mB = r.memory.teams.find((x) => x.teamId === "B"), mC = r.memory.teams.find((x) => x.teamId === "C");
check("memory: each bee's MEMORY at the end, against the cap, and its keys", r.memory.cap === 50 && mC.finalBytes === 47 && mC.finalShare === 0.94 && mC.keys === 2 && r.memory.teams[0].value.seen === 3, r.memory);
check("memory: saves refused (decide's, on the turn)", mC.overCap === 1 && mB.overCap === 0, [mB, mC]);
check("memory: failed fed() calls and the last save error, from the samples and the teams entity", mB.fedFailures === 2 && /ZeroDivisionError/.test(mB.finalError) && mB.errors.length === 2
  && mC.fedFailures === 0 && mC.finalError === null, [mB, mC]);
check("memory: how often a team changed its bee (each change empties its MEMORY)", mB.beeVersions === 3 && mB.beeChanges === 2 && mB.meanMsBetweenChanges === 10000 && mC.beeChanges === 0, mB);
check("memory: its size over the game, from the runner's samples", mC.samples.length === 2 && mC.sampledMaxBytes === 47 && mC.sampledMeanBytes === 33.5 && mC.samples[1].keys === 2, mC);
check("final: fitness, pollination and forage with their shares, pollen", r.final.length === 3 && r.final.find((x) => x.teamId === "C").pollinationShare === 0.31
  && r.final.find((x) => x.teamId === "A").pollen === 72000 && r.final.every((x) => Number.isFinite(x.fitness)) && !("allure" in r.final[0]), r.final);
check("handshakes: pairs computed only on 5+ turns", r.handshakes.pairs.length === 0 && r.handshakes.mutual.length === 0, r.handshakes);

// Handshakes. Two teams' bees feed only at each other's flowers, which pay them more than they pay the third team's bee.
rows.length = 0;
let round = 0;
for (let i = 0; i < 6; i++) {
  round++;
  turn(round, "A", "B", i, i, 60, 10, true);
  turn(round, "B", "A", i, i, 60, 10, true);
  turn(round, "A", "C", i, i, 40, 10, false);
  turn(round, "B", "C", i, i, 40, 10, false);
  turn(round, "C", "A", i, i, 10, 10, false);
  turn(round, "C", "B", i, i, 10, 10, false);
  turn(round, "A", "A", i, i, 90, 10, true); // A's flower pays its own bee more, and A's bee always feeds there
  turn(round, "C", "C", i, i, 40, 10, false);
}
const h = computeMetrics({ game, teams, turns: rows, versions, scores, windowMs: 10000 });
check("handshake: a flower that treats its own bee differently is flagged", h.teams.A.handshake.flag && h.teams.A.handshake.percentToOwnBee === 90 && !h.teams.C.handshake.flag, [h.teams.A.handshake, h.teams.C.handshake]);
const ab = h.handshakes.pairs.find((x) => x.beeId === "A" && x.flowerId === "B");
check("handshakes: a bee that feeds at one flower far more than elsewhere is flagged", ab?.flag && ab.feedRate === 1 && ab.percent === 60 && ab.percentToOtherBees === 10, ab);
check("handshakes: two teams favouring each other both ways are mutual", h.handshakes.mutual.length === 1 && h.handshakes.mutual[0].join() === "Alpha,Beta", h.handshakes.mutual);

// Ecology: energy split, imitation and detection, key rotation, cracking, autarky, percent over time.
{
  const rowsE = [];
  const G = (n, tag) => ({ nodes: n, edges: Array.from({ length: n - 1 }, (_, i) => [i, i + 1]), labels: Array.from({ length: n }, (_, i) => `${tag}${i}`) });
  const add = (atMs, bee, flower, c, r, fed, v, percent = 50, ms = 10, size = 100) => {
    const energy = r === null ? 0 : (1100 - size) * (150 - ms);
    rowsE.push({ game: "E", round: Math.floor(atMs / 200) + 1, atMs, turn: 1, bee: IDX[bee], flower: IDX[flower], challenge: c, response: r, fed, percent: r === null ? null : percent, energy,
      nectar: fed ? (percent / 100) * energy : null, pollen: fed ? (1 - percent / 100) * energy : 0, ms, flowerVersion: v, flowerError: null, beeMs: 1, beeVersion: 1, beeError: null });
  };
  // A v1 answers 5, 6, 7 with its signal (graphs); C answers 9 with "q" before A ever does (a prediction).
  add(0, "B", "A", 5, G(4, "a"), true, 1); add(200, "C", "A", 6, G(5, "a"), true, 1); add(400, "C", "A", 7, G(6, "a"), true, 1);
  add(600, "B", "C", 9, G(3, "q"), false, 2); add(800, "B", "A", 9, G(3, "q"), true, 1); // C v2 went live at 0.5 s, after A v1 appeared
  add(1000, "A", "B", 5, G(2, "b"), false, 1); // B v1 (lobby) answers 5 its own way
  // B v2 (live at 30 s) answers 5 exactly as A v1 did: a copy, 31 s after A's signal appeared. Rival bee C first feeds at
  // B's copy as often as at A, then stops: detected.
  let t = 31000;
  add(t, "A", "B", 5, G(4, "a"), true, 2);
  for (let i = 0; i < 12; i++) { add(t += 200, "C", "B", 5, G(4, "a"), true, 2); add(t += 200, "C", "A", 5, G(4, "a"), true, 1); }
  for (let i = 0; i < 12; i++) { add(t += 200, "C", "B", 5, G(4, "a"), false, 2); add(t += 200, "C", "A", 5, G(4, "a"), true, 1); }
  // A v2 (live at 60 s) answers 5, 6 and 7 differently: a key rotation. Its compute is heavier.
  add(61000, "B", "A", 5, G(4, "z"), false, 2, 50, 100); add(61200, "B", "A", 6, G(5, "z"), false, 2, 50, 100); add(61400, "B", "A", 7, G(6, "z"), false, 2, 50, 100);
  // B's bee lives off its own species.
  for (let i = 0; i < 20; i++) add(62000 + i * 200, "B", "B", 11 + i, G(2, "b"), true, 2, 10);
  const versionsE = [ver("A", "flower", 1, 100, 0), ver("A", "flower", 2, 100, 60000), ver("B", "flower", 1, 100, 0), ver("B", "flower", 2, 100, 30000), ver("C", "flower", 1, 100, 0), ver("C", "flower", 2, 100, 500)];
  const e = computeMetrics({ game: { config, clockMs: 70000, round: 350 }, teams, turns: rowsE, versions: versionsE, scores: [], windowMs: 10000 }).ecology;
  const cp = e.imitation.copies.find((x) => x.copier === "Beta" && x.model === "Alpha");
  check("imitation: a copy by a version that went live after the signal appeared, with its lag", cp && cp.exact && cp.copierVersion === 2 && cp.modelVersion === 1 && cp.lagMs === 31000
    && e.imitation.signalsCopied >= 1 && !e.imitation.copies.some((x) => x.copier === "Beta" && x.copierVersion === 1), e.imitation);
  check("detection: rival bees' feeds at the imitator before they told it from its model", cp && cp.detected && cp.rivalFeedsBeforeDetection === 12 && cp.detectedAfterMs > 0, cp);
  check("rotation: a new version answering earlier challenges differently", e.rotations.length === 1 && e.rotations[0].teamId === "A" && e.rotations[0].version === 2 && e.rotations[0].changed === 3, e.rotations);
  check("cracking: an answer given before the other species gave it, by a version written after its rule appeared", e.predictions.some((p) => p.predictor === "Gamma" && p.target === "Alpha" && p.n === 1), e.predictions);
  // Two rules written in the lobby that agree aren't a crack; nor is a shape every species uses a copy.
  const conv = computeMetrics({ game: { config, clockMs: 2000, round: 10 }, teams, versions: [ver("A", "flower", 1, 100, 0), ver("B", "flower", 1, 100, 0), ver("B", "flower", 2, 100, 500)], scores: [], windowMs: 10000,
    turns: [{ ...rowsE[0], atMs: 0, round: 1, flower: 1, flowerVersion: 1, challenge: 3, response: G(3, "x") }, { ...rowsE[0], atMs: 200, round: 2, flower: 0, flowerVersion: 1, challenge: 3, response: G(3, "x") },
      { ...rowsE[0], atMs: 1000, round: 6, flower: 1, flowerVersion: 2, challenge: 4, response: G(3, "y") }, { ...rowsE[0], atMs: 1200, round: 7, flower: 0, flowerVersion: 1, challenge: 4, response: G(3, "z") },
      { ...rowsE[0], atMs: 1400, round: 8, flower: 1, flowerVersion: 2, challenge: 4, response: G(3, "w") }] }).ecology;
  check("convergence isn't cracking or copying: lobby rules that agree, a shape the copier already used", conv.predictions.length === 0 && conv.imitation.copies.length === 0, conv);
  const eA = e.energySplit.A;
  check("energy split: size, compute, nectar, pollen and lost add up to the budget", Math.abs(eA.size + eA.compute + eA.nectar + eA.pollen + eA.lost - 1) < 0.01 && eA.compute > 0 && eA.pollen > 0, eA);
  const auB = e.autarky.teams.find((x) => x.teamId === "B");
  check("autarky: how much a species lives off its own bee", auB.ownPollenShare > 0.5 && e.autarky.autarkic >= 1 && e.autarky.collapse === false, e.autarky);
  check("percent over time, per species and window", e.percentOverTime.find((x) => x.teamId === "B").byWindow[3] === 50 && e.percentOverTime.find((x) => x.teamId === "B").byWindow[6] === 10, e.percentOverTime);
}

// Big responses (over 4 KB): the history has only their size and hash. They are no failures; equal hashes are equal
// answers (a copy); a shape comes from the fetched response, else from the hash.
{
  const big = (round, flower, v, c, hash, bytes = 9000) => ({ game: "G", seq: round * 2, round, atMs: (round - 1) * 200, turn: round, bee: 2, flower, challenge: c, response: null,
    responseBytes: bytes, responseHash: hash, fed: true, percent: 10, energy: 1000, nectar: 100, pollen: 900, ms: 20, flowerVersion: v, flowerError: null, beeMs: 1, beeVersion: 1, beeError: null });
  const shapes = new Map([["h1", "graph:300:299:shape"]]);
  const rowsB = [big(1, 0, 1, 5, "h1"), big(2, 0, 1, 6, "h2", 12000), big(30, 1, 2, 5, "h1"), big(31, 1, 2, 6, "h3")];
  const versionsB = [ver("A", "flower", 1, 100, 0), ver("B", "flower", 1, 100, 0), ver("B", "flower", 2, 100, 4000)];
  const m = computeMetrics({ game: { config, clockMs: 8000, round: 40 }, teams, turns: rowsB, versions: versionsB, scores: [], windowMs: 10000, shapes });
  check("big responses: answered, not failures; their sizes", m.totals.failures === 0 && m.teams.A.flower.bigResponses === 2 && m.teams.A.flower.responseBytes.max === 12000
    && m.distributions.responseBytes.n === 4, [m.totals, m.teams.A.flower]);
  const cp = m.ecology.imitation.copies.find((x) => x.copier === "Beta" && x.model === "Alpha");
  check("big responses: the same hash to the same challenge is an exact copy; a different unfetched one is no shape copy", cp && cp.exact && m.ecology.imitation.copies.length === 1, m.ecology.imitation);
}

// Pollen grains: leak rates, how much of a version other teams held and when, and teams acting on leaked code.
{
  const codeA = 'import hashlib as d\nb="moonflower-key"\ndef flower(c):\n a=d.sha256((b+str(c)).encode()).digest()\n return{"nodes":3,"edges":[[0,1]],"labels":[a[0],a[1],a[2]]},30';
  const L = codeA.length;
  const piece = (start, n) => Array.from({ length: n }, (_, i) => codeA[(start + i) % L]).join("");
  const rowsG = [];
  const feed = (atMs, bee, flower, grain, extra = {}) => rowsG.push({ game: "G", round: atMs / 200 + 1, atMs, turn: 1, bee: IDX[bee], flower: IDX[flower], challenge: 1, response: 1, fed: true,
    percent: 50, energy: 100000, nectar: 50000, pollen: 50000, ms: 1, flowerVersion: 1, flowerError: null, beeMs: 1, beeVersion: 1, beeError: null,
    grain, grainVersion: grain ? 1 : null, grainCodeLength: grain ? L : null, ...extra });
  // B's bee collects all of A's code by 9 s (grains of 36 characters, overlapping); C's a little; A's own bee some.
  let t = 1000;
  for (let p = 0; p < L; p += 30) { feed(t, "B", "A", piece(p, 36)); t += 400; }
  const fullAt = t - 400;
  feed(1200, "C", "A", piece(5, 36));
  feed(1400, "A", "A", piece(50, 36));
  feed(1600, "A", "C", null); // a feed without a grain (no pollen): nothing
  rowsG.sort((a, b) => a.atMs - b.atMs);
  const beeB2 = 'def first():\n return 1\ndef decide(a,b):\n x=" a=d.sha256((b+str(c)).encode()).digest()"\n return"feed",1';
  const minified = new Map([["0:flower:1", codeA], ["1:flower:1", 'def flower(a):\n return a,40'], ["1:flower:2", 'K="moonflower-key"\ndef flower(a):\n return a,40'],
    ["1:bee:1", 'def first():\n return 1\ndef decide(a,b):\n return"feed",1'], ["1:bee:2", beeB2], ["2:flower:1", 'def flower(a):\n return a,10'], ["2:flower:2", codeA]]);
  const versionsG = [ver("A", "flower", 1, 100, 0), ver("B", "flower", 1, 100, 0), ver("B", "flower", 2, 100, 12000), ver("B", "bee", 1, 300, 0), ver("B", "bee", 2, 300, 13000),
    ver("C", "flower", 1, 100, 0), ver("C", "flower", 2, 100, 14000)];
  const g = computeMetrics({ game: { config: { ...config, grains: "feeder" }, clockMs: 60000, round: 300 }, teams, turns: rowsG, versions: versionsG, scores: [], windowMs: 10000, minified }).grains;
  const sA = g.perSpecies.find((x) => x.teamId === "A"), vA = g.versions.find((x) => x.teamId === "A" && x.version === 1);
  check("grains: per species, the characters leaked to other teams' bees and per minute (its own bee's don't count)", sA.grains === rowsG.filter((r) => r.flower === 0 && r.grain).length
    && sA.toOthers === sA.grains - 1 && sA.charactersToOthers === 36 * sA.toOthers && sA.receivers === 2 && sA.perMinute === sA.charactersToOthers, sA);
  check("grains: a version fully held by one team, and when (from when it went live)", vA.codeLength === L && vA.fullByTeam === "Beta" && vA.fullByTeamMs === fullAt && vA.unionShare === 1 && vA.bestShare === 1
    && vA.placed === vA.grains && g.versionsFullyHeld === 1, vA);
  const sec = g.uses.find((u) => u.type === "secret"), cp = g.uses.find((u) => u.type === "copy" && u.kind === "bee");
  check("grains: a leaked secret used in a later version", sec && sec.team === "Beta" && sec.kind === "flower" && sec.version === 2 && sec.from === "Alpha" && sec.secret === "moonflower-key"
    && sec.usedAtMs === 12000 && sec.lagMs > 0, g.uses);
  check("grains: leaked code copied into a later version (a bee here)", cp && cp.team === "Beta" && cp.kind === "bee" && cp.version === 2 && cp.characters >= 24, g.uses);
  const cg = g.uses.filter((u) => u.team === "Gamma");
  check("grains: only what a team held counts (C's v2 is A's code, but C held 36 characters: a copy of those, not the whole version)",
    cg.length === 2 && cg.some((u) => u.type === "secret") && cg.find((u) => u.type === "copy")?.characters === 36 && !g.uses.some((u) => u.type === "whole-version"), cg);
  const off = computeMetrics({ game: { config: { ...config, grains: "off" }, clockMs: 2000, round: 10 }, teams, turns: rows, versions, scores: [], windowMs: 10000 }).grains;
  check("grains: off", off.setting === "off");
}

// The flower's hidden budget R (budgetMs): the energy split counts what R left short of the window; wealth metrics appear.
{
  const rowsR = Array.from({ length: 40 }, (_, i) => { const R = 50 + (i * 37) % 100, ms = 10; return { game: "G", round: i + 1, atMs: i * 200, turn: i + 1, bee: 1, flower: 0, challenge: i, response: { nodes: Math.round(R / 10), edges: [] },
    responseBytes: 30, responseHash: null, fed: R > 100, percent: 50, energy: (1100 - 100) * (R - ms), nectar: R > 100 ? 500 * (R - ms) : null, pollen: R > 100 ? 500 * (R - ms) : 0, ms,
    budgetMs: R, flowerVersion: 1, flowerError: null, beeMs: 1, beeVersion: 1, beeError: null }; });
  const mR = computeMetrics({ game: { config: { ...config, budgets: { ...config.budgets, flower: { size: 1100, ms: 150, minMs: 50 } } }, clockMs: 8000, round: 40 }, teams, turns: rowsR,
    versions: [ver("A", "flower", 1, 100, 0)], scores: [], windowMs: 10000 });
  const eA = mR.ecology.energySplit.A;
  check("budget R: the energy split's short share (R below the window) and the rest add up to the budget", eA.short > 0.2 && Math.abs(eA.size + eA.compute + eA.short + eA.nectar + eA.pollen + eA.lost - 1) < 0.01, eA);
  check("budget R: wealth metrics (visible work against R, bees at rich instances)", mR.wealth && mR.wealth.species.find((x) => x.teamId === "A").nodes > 0.9
    && mR.wealth.bees.find((x) => x.teamId === "B").lift > 0.5 && mR.wealth.range[0] === 50, mR.wealth);
  check("no budget R: no wealth metrics", computeMetrics({ game, teams, turns: rows, versions, scores, windowMs: 10000 }).wealth === null);
  // The byte factor (config.energy.bytes): E × (cap − bytes), in node·ms·bytes; the split gets the share the bytes took,
  // and still adds up.
  const bytesCfg = { ...config, maxResponseBytes: 1024, energy: { bytes: true }, budgets: { ...config.budgets, flower: { size: 1100, ms: 150, minMs: 3 } } };
  const rowsB = rowsR.map((r) => ({ ...r, responseBytes: 256, energy: r.energy * 768, nectar: r.nectar == null ? null : r.nectar * 768, pollen: r.pollen ? r.pollen * 768 : 0 }));
  const eB = computeMetrics({ game: { config: bytesCfg, clockMs: 8000, round: 40 }, teams, turns: rowsB, versions: [ver("A", "flower", 1, 100, 0)], scores: [], windowMs: 10000 }).ecology.energySplit.A;
  check("byte factor: the energy split's bytes share (a quarter of what compute left, at 256 of 1,024 bytes), and the whole still adds up", eB.bytes > 0 && eA.bytes === undefined
    && Math.abs(eB.bytes / (eB.bytes + eB.nectar + eB.pollen + eB.lost) - 0.25) < 0.01
    && Math.abs(eB.size + eB.compute + eB.short + eB.bytes + eB.nectar + eB.pollen + eB.lost - 1) < 0.01, eB);
}

// lib/prevalence.js (metagame v2): the game's settings, c and the floor, the bees a round, the feed price and the flower
// window as the engine resolves them, and the published samples in the engine's shapes.
{
  const { prevalenceOf, cAt, floorAt, slotsOf, feedPriceOf, windowOf, coopRules, samplesOf, currentOf } = await import("./lib/prevalence.js");
  const budgets = { flower: { size: 1100, ms: 50 }, bee: { ms: 50 } };
  const cfg = { maxResponseBytes: 1024, energy: { bytes: true }, budgets, flowerWindowMs: 150, feedPrice: null,
    prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null } };
  check("prevalence: off without the key, with on false or in the one-sided form (no slots); c falls linearly from 1 to 0.1; the floor is c / (N (c + 1))",
    prevalenceOf({}) === null && prevalenceOf({ prevalence: { on: false, slots: 0.25 } }) === null && prevalenceOf({ prevalence: { on: true, halfLifeS: 90 } }) === null
    && cAt(cfg, 0, 600000) === 1 && Math.abs(cAt(cfg, 600000, 600000) - 0.1) < 1e-12 && Math.abs(cAt(cfg, 300000, 600000) - 0.55) < 1e-12
    && Math.abs(floorAt(cfg, 0, 600000, 14) - 1 / 28) < 1e-12);
  const pv = prevalenceOf(cfg), open = prevalenceOf({ ...cfg, prevalence: { ...cfg.prevalence, halfLifeS: null, cap: null, prior: 5 } });
  check("prevalence: the prior null is 0.12 × Emax (6,758,400); halfLifeS and cap null stay null (cumulative, uncapped)", pv.prior === 6758400 && pv.halfLifeS === 90 && pv.cap === 4
    && open.halfLifeS === null && open.cap === null && open.prior === 5, { pv, open });
  check("prevalence: ⌈0.25 × N⌉ bees a round (3 of 10, 4 of 14, 1 of 2; none without prevalence)", slotsOf(cfg, 10) === 3 && slotsOf(cfg, 14) === 4 && slotsOf(cfg, 2) === 1 && slotsOf(cfg, 4) === 1
    && slotsOf({}, 10) === null);
  check("feed price: null is 0.05 × Emax (2,816,000 node·ms·bytes), a number itself, a config from before it 0; the window: flowerWindowMs, else flower.ms",
    feedPriceOf(cfg) === 2816000 && feedPriceOf({ ...cfg, feedPrice: 1000 }) === 1000 && feedPriceOf({ ...cfg, feedPrice: 0 }) === 0 && feedPriceOf({ budgets }) === 0
    && windowOf(cfg) === 150 && windowOf({ budgets: { flower: { ms: 150 } } }) === 150 && windowOf({ budgets }) === 50);
  const co = coopRules(cfg, 10);
  check("coopRules: on, 3 bees a round, the price and its share of Emax, the window, 200 ms rounds, the F × B score", co.on && co.perRound === 3 && co.price === 2816000
    && Math.abs(co.priceShare - 0.05) < 1e-12 && co.windowMs === 150 && co.roundMs === 200 && co.timeAverage && co.unit === "node·ms·bytes"
    && !coopRules({ budgets }).on && coopRules({ budgets }).price === 0, co);
  // v4 (b9c9c9a): c sech-shaped from cStart, halving at cHalfS (null: 0.2 × minutes × 60), toward 0; a config without
  // cDecay is linear (v2, v3); the scoring mode "final", or "timeAverage" for a config without one.
  const v4 = { ...cfg, minutes: 30, scoring: { alpha: 0.85, beta: 0.85, mode: "final" }, prevalence: { on: true, halfLifeS: 90, cDecay: "sech", cStart: 1, cHalfS: null, cap: 4, slots: 0.25, prior: null, pools: true, endowment: null } };
  const pv4 = prevalenceOf(v4), co4 = coopRules(v4, 10);
  check("prevalence v4: sech c (1 at the start, 1/2 at cHalfS = 6 minutes, about 0.003 at 30 minutes, no floor); final scoring; linear without cDecay",
    pv4.cDecay === "sech" && pv4.cHalfS === 360 && pv4.cEnd === null && cAt(v4, 0) === 1 && Math.abs(cAt(v4, 360000) - 0.5) < 1e-12 && cAt(v4, 1800000) < 0.005 && cAt(v4, 3600000) < 1e-5
    && co4.final && co4.mode === "final" && !co4.timeAverage && prevalenceOf(cfg).cDecay === "linear" && coopRules(cfg).mode === "timeAverage"
    && prevalenceOf({ ...v4, prevalence: { ...v4.prevalence, cHalfS: 120 } }).cHalfS === 120, { pv4, co4 });
  // The engine's shapes: query rows { round, atMs, team (index), flowerSuccess, beeSuccess, flowerP, beeP, fitness, c, slots };
  // samples { round, atMs, c, slots, species: [{ team (id), index, flowerSuccess, beeSuccess, flowerP, beeP, fitness }] }.
  const row = { game: "g", round: 5, atMs: 800, team: 2, flowerSuccess: 1.2, beeSuccess: 0.7, flowerP: 0.1, beeP: 0.08, fitness: 0.95, c: 0.98, slots: 3 };
  const sample = { round: 10, atMs: 1800, c: 0.97, slots: 3, species: [{ team: "A", index: 0, flowerSuccess: 2, beeSuccess: 1.5, flowerP: 0.2, beeP: 0.3, fitness: 1.1 },
    { team: "B", index: 1, flowerSuccess: null, beeSuccess: null, flowerP: null, beeP: null, fitness: null }] };
  const s = samplesOf([row, sample]);
  check("prevalence: samples from query rows and from whole samples (F, B, pF, pB, fitness; an empty entry skipped)", s.length === 2 && s[0].team === 2 && s[0].F === 1.2 && s[0].B === 0.7
    && s[0].pF === 0.1 && s[0].pB === 0.08 && s[0].fitness === 0.95 && s[0].c === 0.98 && s[1].team === "A" && s[1].index === 0 && s[1].F === 2 && s[1].B === 1.5 && s[1].pB === 0.3
    && s[1].atMs === 1800 && s[1].round === 10, s);
  check("prevalence: the view's or the scores' latest sample (prevalence.sample), a stream page's (the sample itself), none",
    currentOf({ prevalence: { on: true, slots: 0.25, feedPrice: 2816000, sample } })[0].pF === 0.2 && currentOf({ prevalence: sample })[0].fitness === 1.1
    && currentOf({ prevalence: { on: true, sample: null } }) === null && currentOf({ prevalence: null }) === null);
}

// lib/energy.js: E from the game's own config (old games without the byte factor keep their formula).
{
  const { excessEnergy, bytesFactor, bytesShare, bytesTerm, energyUnit } = await import("./lib/energy.js");
  const oldCfg = { maxResponseBytes: 65536, energy: { bytes: false }, budgets: { flower: { size: 1100, ms: 150 } } }, newCfg = { maxResponseBytes: 1024, energy: { bytes: true }, budgets: { flower: { size: 1100, ms: 150 } } };
  check("energy: E = (cap − size) × max(0, R − ms) in node·ms, times (byte cap − bytes) in node·ms·bytes with the byte factor (0 over the cap)",
    excessEnergy(oldCfg, { size: 100, ms: 10, R: 110, bytes: 512 }) === 100000 && excessEnergy(newCfg, { size: 100, ms: 10, R: 110, bytes: 512 }) === 100000 * 512
    && bytesFactor(newCfg, 2000) === 0 && bytesFactor(oldCfg, 2000) === 1 && bytesShare(newCfg, 256) === 0.25 && bytesShare(oldCfg, 256) === 0
    && bytesTerm(oldCfg) === "" && bytesTerm(newCfg) === " × (1,024 − response bytes)" && energyUnit(oldCfg) === "node·ms" && energyUnit(newCfg) === "node·ms·bytes");
}

// Fetching big responses for their shapes: distinct hashes once each, in order of first appearance, within the byte budget.
{
  const g = { nodes: 3, edges: [[0, 1], [1, 2]], labels: ["x".repeat(3000), "y", "z"] }, text = JSON.stringify(g);
  const asked = [];
  const api = { response: async (_tok, _g, seq) => { asked.push(seq); return seq === 99 ? null : { text, value: g }; } };
  const rowsF = [{ seq: 2, responseHash: "a", responseBytes: text.length }, { seq: 4, responseHash: "a", responseBytes: text.length }, { seq: 6, responseHash: "b", responseBytes: text.length },
    { seq: 8, responseHash: "c", responseBytes: 10 ** 7 }, { seq: 10, response: 5, responseHash: null, responseBytes: 1 }];
  const shapes = await bigShapes(api, "/g", rowsF, 1024 * 1024);
  check("bigShapes: each distinct big response fetched once, within the budget", asked.join() === "2,6" && shapes.get("a") === shapes.get("b") && /^graph:3:2:/.test(shapes.get("a"))
    && !shapes.has("c") && shapes.stats.distinct === 3 && shapes.stats.fetched === 2 && shapes.stats.turns === 4, { asked, stats: shapes.stats });
}

check("windowFor: at most 10 windows in round numbers (a minute for a 10-minute game)", windowFor(30000) === 10000 && windowFor(120000) === 15000 && windowFor(600000) === 60000 && windowFor(1800000) === 300000);

console.log(failed ? `${failed} check(s) failed` : "all metrics checks passed");
process.exit(failed ? 1 : 0);
