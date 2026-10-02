#!/usr/bin/env node
// Continuous-game metrics on a hand-made stream (no server, no database): windows, precision, nectar per bee-round,
// rival cosmos vs orchid fed rates, fingerprinting (repeated challenges), how fast an orchid copies a rival cosmos's
// answer, the change timeline with sessions, and compute against budget.
//   node arena/test-metrics.mjs
import { GameMetrics, windowFor } from "./lib/metrics.js";

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${JSON.stringify(extra).slice(0, 500)}`}`); if (!ok) failed++; };
const config = { minutes: 1, feedCost: 10, budgets: { cosmos: { ms: 150 }, orchid: { ms: 50 }, bee: { ms: 25 } } };
const m = new GameMetrics({ config, participants: ["A", "B"], names: { A: "Alpha", B: "Beta" }, windowMs: 10000 });
let seq = 0;
const act = (atMs, round, bee, visit, patch, kind, action, extra = {}) => m.add({ seq: ++seq, at_ms: atMs, round, bee_team: bee, visit, patch_team: patch, kind, action, ...extra });

// Window 0-10 s. A's bee asks B's cosmos 5 -> 16 and feeds (nectar); A's cosmos answers 5 -> 99.
act(1000, 1, "A", 1, "B", "cosmos", "ask", { c: 5, r: 16, ms: 100 });
act(1100, 1, "A", 1, "B", "cosmos", "feed", { nectar: true });
act(1200, 2, "B", 1, "A", "cosmos", "ask", { c: 5, r: 99, ms: 120 });
act(1300, 2, "B", 1, "A", "cosmos", "leave");
// B's bee at A's orchid: answers 5 -> 7 (no copy), B leaves; A's bee repeats challenge 5 at B's orchid, orchid answers 3, A feeds (no nectar).
act(2000, 3, "B", 2, "A", "orchid", "ask", { c: 5, r: 7, ms: 20 });
act(2100, 3, "B", 2, "A", "orchid", "leave");
act(3000, 4, "A", 2, "B", "orchid", "ask", { c: 5, r: 3, ms: 30 });
act(3100, 4, "A", 2, "B", "orchid", "feed", { nectar: false });
// Window 10-20 s. A's orchid (new version 2, live at 12 s) copies B's cosmos answer 5 -> 16 at 15 s: latency 14 s.
act(15000, 30, "B", 3, "A", "orchid", "ask", { c: 5, r: 16, ms: 25, flower_version: 2 });
act(15100, 30, "B", 3, "A", "orchid", "feed", { nectar: false });
act(16000, 31, "A", 3, "B", "cosmos", "ask", { c: 8, r: 25, ms: 140 });
act(16050, 31, "A", 3, "B", "cosmos", "ask", { c: 9, r: null, ms: 160, error: "Timeout: took too long", error_by: "flower" });
act(16100, 31, "A", 3, "B", "cosmos", "feed", { nectar: true });
// B's orchid copies its own cosmos's 8 -> 25 (a twin, not a copy of a rival).
act(17000, 32, "A", 4, "B", "orchid", "ask", { c: 8, r: 25, ms: 10 });
act(17100, 32, "A", 4, "B", "orchid", "leave");

const programs = [
  { team_id: "A", kind: "cosmos", version: 1, size: 40, distance: null, cost: 0, at_ms: 0 },
  { team_id: "A", kind: "orchid", version: 1, size: 30, distance: null, cost: 0, at_ms: 0 },
  { team_id: "A", kind: "orchid", version: 2, size: 45, distance: 15, cost: 15, at_ms: 12000 },
  { team_id: "B", kind: "cosmos", version: 1, size: 50, distance: null, cost: 0, at_ms: 0 },
];
const submits = [{ team_id: "A", kind: "orchid", version: 2, refused: null, session_no: 1 }];
const feeds = [[0, 3], [2, 0]], nectar = [[0, 2], [0, 0]];
const r = m.finish({ programs, submits, finalFeeds: feeds, finalNectar: nectar });

check("windows: one per 10 s with actions", r.windows.length === 2 && r.windows[0].actions === 8 && r.windows[1].actions === 7, r.windows.map((w) => w.actions));
check("windows: rounds in each", r.windows[0].rounds === 4 && r.windows[1].rounds === 3);
check("precision: nectar per feed", r.windows[0].precision === 0.5 && r.windows[1].precision === 0.5);
check("nectar per bee-round", r.windows[0].nectarPerBeeRound === 0.125, r.windows[0]);
check("rival fed rates: cosmos vs orchid visits that ended in a feed", r.windows[0].rivalCosmosFed === 0.5 && r.windows[0].rivalOrchidFed === 0.5 && r.windows[1].rivalOrchidFed === 0.5, r.windows);
check("fingerprinting: A's bee repeated challenges 5 and 8", r.teams.A.repeatShare === 0.4 && r.teams.A.distinctChallenges === 3, r.teams.A);
check("per team: bee precision and fed rates", r.teams.A.precision === 0.667 && r.teams.A.rivalCosmosFed === 1 && r.teams.A.rivalOrchidFed === 0.5, r.teams.A);
const cp = r.copies.byOrchid.A;
check("copies: A's orchid copied B's cosmos answer 14 s after it appeared", cp && cp.copies === 1 && cp.medianLatencyMs === 14000 && cp.from[0] === "Beta", r.copies);
check("copies: by a version that went live after the cosmos's answer", cp.afterNewVersion === 1);
check("copies: an orchid repeating its own cosmos is a twin, not a copy", !r.copies.byOrchid.B && r.windows[1].twinShare > 0, r.windows[1]);
check("stolen share: orchid answers matching an earlier rival cosmos answer", r.windows[1].stolenShare === 0.5, r.windows[1]);
check("compute: per flower against budget, timeouts", r.compute["B|cosmos"].timeouts === 1 && r.compute["B|cosmos"].budgetMs === 150 && r.compute["A|orchid"].meanFrac === 0.45, r.compute);
check("changes: timeline with the session that submitted", r.changes.find((c) => c.kind === "orchid" && c.version === 2)?.session === 1 && r.changes[0].atMs === 0);
check("final scores from the game's ledgers", r.final.length === 2 && r.final.every((x) => Number.isFinite(x.fitness)));
check("windowFor: about 8 windows in round numbers", windowFor(30000) === 10000 && windowFor(120000) === 15000 && windowFor(1800000) === 300000);

console.log(failed ? `${failed} check(s) failed` : "all metrics checks passed");
process.exit(failed ? 1 : 0);
