#!/usr/bin/env node
// One-flower metrics on a hand-made finished game (no server, no database): windows of energy, percent, nectar and surplus;
// distributions; per-team flowers and bees; self-feeding and handshakes; discrimination; flower size and compute against
// energy; copies of answers between flowers; the change timeline with sessions; the three shares.
//   node arena/test-metrics.mjs
import { computeMetrics, windowFor } from "./lib/metrics.js";

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${JSON.stringify(extra).slice(0, 500)}`}`); if (!ok) failed++; };
const config = { minutes: 1, feedCost: 10, challengeType: "int", responseType: "int", budgets: { flower: { size: 1100, ms: 150 }, bee: { size: 11000, ms: 50 } } };
const E = (size, ms) => (1100 - size) * Math.max(0, 150 - ms);

let seq = 0;
const actions = [];
/** One turn: its arrival and its end, every field revealed (the game is over). */
function turn(round, bee, flower, c, r, percent, ms, fed, extra = {}) {
  const size = extra.size ?? 100;
  const energy = r === null ? 0 : E(size, ms);
  const at = (round - 1) * 200;
  actions.push({ seq: ++seq, atMs: at, round, turn: round, bee, flower, action: "arrive", flowerVersion: extra.v ?? 1, beeVersion: 1 });
  actions.push({ seq: ++seq, atMs: at + 150, round, turn: round, bee, flower, action: fed ? "feed" : "leave", c, r, percent: r === null ? null : percent, energy, ms,
    nectar: fed ? (percent / 100) * energy : undefined, surplus: fed ? (1 - percent / 100) * energy : 0, flowerVersion: extra.v ?? 1, beeVersion: 1, beeMs: 3,
    ...(extra.beeError ? { beeError: extra.beeError } : {}), ...(r === null ? { flowerError: "Timeout: took too long" } : {}) });
}
// Window 0-10 s. A, C flowers have size 100, B's 600; A's flower v2 (size 200) goes live at 12 s.
turn(1, "A", "B", 5, 16, 50, 50, true, { size: 600 });   // E 50,000: nectar 25,000, surplus 25,000
turn(1, "B", "A", 5, 99, 10, 10, false);                  // E 140,000 lost
turn(1, "C", "C", 1, 1, 90, 0, true);                     // a bee at its own flower: E 150,000, nectar 135,000
turn(2, "B", "C", 7, 7, 90, 0, true);                     // E 150,000, nectar 135,000
// Window 10-20 s. A's flower v2 answers 5 -> 16, as B's flower did at 0.15 s: a copy 15 s later.
turn(76, "B", "A", 5, 16, 20, 50, true, { size: 200, v: 2 }); // E 90,000: nectar 18,000, surplus 72,000
turn(76, "A", "B", 9, null, 0, 160, false, { size: 600 });    // the flower failed: no response, no energy
turn(77, "A", "A", 3, 3, 20, 50, false, { size: 200, v: 2, beeError: "too slow: no reply within 50 ms" }); // E 90,000 lost
turn(77, "C", "B", 2, 4, 5, 100, false, { size: 600 });       // E 25,000 lost

const prog = (version, size, atMs, extra = {}) => ({ version, size, atMs, distance: null, cost: 0, ...extra });
const view = {
  game: { config, clockMs: 20000, round: 100 },
  participants: ["A", "B", "C"],
  teams: [
    { id: "A", name: "Alpha", participant: true, programs: { flower: [prog(1, 100, 0), prog(2, 200, 12000, { distance: 100, cost: 100 })], bee: [prog(1, 300, 0)] } },
    { id: "B", name: "Beta", participant: true, programs: { flower: [prog(1, 600, 0)], bee: [prog(1, 300, 0)] } },
    { id: "C", name: "Gamma", participant: true, programs: { flower: [prog(1, 100, 0)], bee: [prog(1, 300, 0)] } },
  ],
  scores: [
    { teamId: "A", fitness: 0.9, allure: 1, forage: 158.1, surplus: 72000, allureShare: 0.2, forageShare: 0.3, surplusShare: 0.57, feedsReceived: 1, feedsGiven: 1, pollinators: 1, nectarCollected: 25000, nectarGiven: 18000, nectarSources: 1 },
    { teamId: "B", fitness: 1.1, allure: 1, forage: 501.6, surplus: 25000, allureShare: 0.2, forageShare: 0.4, surplusShare: 0.2, feedsReceived: 1, feedsGiven: 2, pollinators: 1, nectarCollected: 153000, nectarGiven: 25000, nectarSources: 2 },
    { teamId: "C", fitness: 1.0, allure: 2, forage: 367.4, surplus: 30000, allureShare: 0.5, forageShare: 0.3, surplusShare: 0.24, feedsReceived: 2, feedsGiven: 1, pollinators: 2, nectarCollected: 135000, nectarGiven: 270000, nectarSources: 1 },
  ],
};
const submits = [{ team_id: "A", kind: "flower", version: 2, source: "session", session_no: 1 }];
const r = computeMetrics({ view, actions, submits, windowMs: 10000 });

check("turns: feed and leave actions only (arrivals don't count)", r.turns === 8 && r.actions === 16, { turns: r.turns, actions: r.actions });
check("totals: feeds, energy produced and lost, nectar, surplus, failures, self-feeds",
  r.totals.feeds === 4 && r.totals.feedRate === 0.5 && r.totals.energy === 695000 && r.totals.energyLost === 255000 && r.totals.nectar === 313000 && r.totals.surplus === 127000
  && r.totals.failures === 1 && r.totals.selfFeeds === 1, r.totals);
check("surplus only from feeds: a turn without a feed adds nothing", r.teams.A.flower.surplus === 72000 && r.teams.B.flower.surplus === 25000, [r.teams.A.flower, r.teams.B.flower]);
check("windows: one per 10 s, with energy lost and mean percent",
  r.windows.length === 2 && r.windows[0].turns === 4 && r.windows[0].feeds === 3 && r.windows[0].energy === 490000 && r.windows[0].energyLost === 140000 && r.windows[0].meanPercent === 60
  && r.windows[1].turns === 4 && r.windows[1].feeds === 1 && r.windows[1].energyLost === 115000 && r.windows[1].failures === 1 && r.windows[1].meanPercent === 15 && r.windows[0].selfFeeds === 1, r.windows);
check("distributions: percent over answered turns, nectar and surplus over feeds", r.distributions.percent.n === 7 && r.distributions.nectar.n === 4 && r.distributions.nectar.max === 135000
  && r.distributions.surplus.min === 15000 && r.distributions.energy.n === 8, r.distributions);
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
check("changes: timeline with the session that submitted", r.changes.find((c) => c.kind === "flower" && c.version === 2 && c.teamId === "A")?.session === 1 && r.changes[0].atMs === 0 && r.changes.length === 7, r.changes);
check("final: fitness and the three shares", r.final.length === 3 && r.final.find((x) => x.teamId === "C").allureShare === 0.5 && r.final.every((x) => Number.isFinite(x.fitness)));
check("handshakes: pairs computed only on 5+ turns", r.handshakes.pairs.length === 0 && r.handshakes.mutual.length === 0, r.handshakes);

// Handshakes. Two teams' bees feed only at each other's flowers, which pay them more than they pay the third team's bee.
seq = 0;
actions.length = 0;
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
const h = computeMetrics({ view, actions, windowMs: 10000 });
check("handshake: a flower that treats its own bee differently is flagged", h.teams.A.handshake.flag && h.teams.A.handshake.percentToOwnBee === 90 && !h.teams.C.handshake.flag, [h.teams.A.handshake, h.teams.C.handshake]);
const ab = h.handshakes.pairs.find((x) => x.beeId === "A" && x.flowerId === "B");
check("handshakes: a bee that feeds at one flower far more than elsewhere is flagged", ab?.flag && ab.feedRate === 1 && ab.percent === 60 && ab.percentToOtherBees === 10, ab);
check("handshakes: two teams favouring each other both ways are mutual", h.handshakes.mutual.length === 1 && h.handshakes.mutual[0].join() === "Alpha,Beta", h.handshakes.mutual);

check("windowFor: about 8 windows in round numbers", windowFor(30000) === 10000 && windowFor(120000) === 15000 && windowFor(1800000) === 300000);

console.log(failed ? `${failed} check(s) failed` : "all metrics checks passed");
process.exit(failed ? 1 : 0);
