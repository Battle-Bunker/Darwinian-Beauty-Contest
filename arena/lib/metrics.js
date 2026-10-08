// Metrics of a finished one-flower game, from the game's history once it is over (every field is revealed then: percent,
// energy, compute time, nectar, pollen, versions). computeGameMetrics reads it with history queries (docs/QUERY.md: the
// turns, versions, teams and scores entities); computeMetrics is pure computation over those rows. Stored in
// arena.games.metrics by run.js and printed by analyze.js.
//
//   windows        per stretch of game time: turns, feeds and feed rate, excess energy produced, energy lost to unfed
//                  turns, nectar, pollen, mean percent offered, flower failures, self-feeds
//   distributions  response size in bytes and percent (every answered turn), energy (every turn), nectar and pollen (every
//                  fed turn): quantiles
//   teams          per team: its flower (turns, feeds, pollinators, percent, energy, energy lost, nectar paid, pollen,
//                  compute) and its bee (turns, feeds, nectar, decision time, too-slow decisions, self-feeding)
//   versions       per flower version: size and compute against the energy it made, the percent it offered, and what it
//                  earned
//   selfFeeding    per team: its bee at its own flower vs elsewhere; handshake: whether its flower treats its own bee
//                  differently (percent, feed rate) in a way that suggests the two recognise each other
//   handshakes     per (bee team, flower team) pair: feed rate there vs that bee elsewhere, percent offered to that bee
//                  vs to other bees; mutual = two teams whose bees and flowers both favour each other
//   discrimination do bees feed more where the offer is generous? feed rate by percent bucket and by the nectar on offer
//                  (percent × E), per bee team: the mean offer at turns it fed vs turns it left
//   copies         how fast flowers copy each other's answers: a flower's first answer r to challenge c after another
//                  team's flower answered r to c, and whether the copier's version went live after that answer appeared
//   changes        every program version (who, which, when, size, node edits, cost, and who submitted it)
//   final          the scores: fitness, pollination and forage with their two shares, and pollen
//   ecology        lib/ecology.js: each species' energy split (size, compute, nectar, pollen, lost), its percent over
//                  time, imitation (signals and their first close copies, the lag, detection windows), key rotation,
//                  cracking (answers predicted before the other species gave them), autarky
//   grains         lib/grains.js: pollen grains (pieces of the answering flower's minified code a feeding bee's team got):
//                  leak rates per species, how much of each flower version other teams held and when one (or all of
//                  them together) first held all of it, and teams acting on leaked code (a leaked secret or a copy)
//   wealth         lib/wealth.js: each flower call's hidden time budget R against its effort (CPU ms) and its visible work
//                  (response size, graph size), per species (an honest wealth signal when visible work follows R), and
//                  whether bees feed more at rich instances; null when the game has no budgets
//   memory         per bee: its MEMORY at the end (bytes of the cap, keys, the value, its last save error), saves refused
//                  (over the cap or of the wrong shape, from decide), failed fed() calls and other save errors the runner's
//                  samples saw, its size over the game, and how often the team changed its bee (each change empties it)
//
// Responses over 4 KB come from the history as their size and SHA-256 only (responseBytes, responseHash). Here such a
// response stands in as { $big: hash, bytes, shape }: equal responses are equal stand-ins, and `shape` (lib/ecology.js
// shapeOf of the whole response) is filled in for as many distinct big responses as BIG_FETCH_BYTES allows
// (computeGameMetrics fetches them from GET .../responses/:seq); past that, a response's shape is its hash.
import { Api } from "./api.js";
import { autarky, energySplit, imitation, percentOverTime, predictions, rotation, shapeOf } from "./ecology.js";
import { excessEnergy } from "./energy.js";
import { grainMetrics } from "./grains.js";
import { wealthMetrics } from "./wealth.js";

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const quantile = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const median = (xs) => quantile(xs, 0.5);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const q5 = (xs) => (xs.length ? { n: xs.length, min: r3(Math.min(...xs)), p10: r3(quantile(xs, 0.1)), p50: r3(median(xs)), p90: r3(quantile(xs, 0.9)), max: r3(Math.max(...xs)), mean: r3(mean(xs)) } : { n: 0 });
const key = (v) => JSON.stringify(v ?? null);
const TOO_SLOW = /too slow/i;

/** A sensible window for a game of `durationMs`: at most 10 windows, at least 10 s, in round numbers (a minute for a
 * 10-minute game). */
export function windowFor(durationMs) {
  const nice = [10, 15, 30, 60, 120, 300, 600].map((s) => s * 1000);
  return nice.find((w) => durationMs / w <= 10) || 600000;
}

/** The most bytes of big responses one game's metrics fetch for their shapes. */
export const BIG_FETCH_BYTES = 64 * 1024 * 1024;

/** A turn row's response as the metrics use it: the response itself, or a stand-in for one over 4 KB (null: none). */
export function responseOf(row, shapes = null) {
  if (row.response !== null && row.response !== undefined) return row.response;
  if (!row.responseHash) return null;
  return { $big: row.responseHash, bytes: row.responseBytes ?? null, shape: shapes?.get(row.responseHash) ?? null };
}

const potential = (t) => (t.percent != null && t.energy != null ? (t.percent / 100) * t.energy : null); // nectar on offer

/**
 * Metrics from a finished game, from its history (docs/QUERY.md, canonical field names). game: { config, clockMs, round };
 * teams, turns, versions, scores: the rows of those entities (teams by index); submits: [{ team_id, kind, version, source,
 * session_no }] from arena.requests (who submitted each version), optional. Teams in the result are keyed by team id.
 */
export function computeMetrics({ game, teams: teamRows, turns: turnRows, versions: versionRows = [], scores: scoreRows = [], submits = [], memorySamples = [], windowMs, shapes = null, minified = null, contract = null }) {
  const config = game.config;
  const byIndex = [...teamRows].sort((a, b) => a.index - b.index);
  const ids = byIndex.map((t) => t.id);
  const idOf = (i) => ids[i] ?? `#${i}`;
  const name = Object.fromEntries(byIndex.map((t) => [t.id, t.name]));
  // One object per turn, teams as ids.
  const turns = turnRows.map((r) => ({ atMs: Number(r.atMs) || 0, round: r.round, bee: idOf(r.bee), flower: idOf(r.flower), action: r.fed ? "feed" : "leave",
    c: r.challenge, r: responseOf(r, shapes), rBytes: r.responseBytes ?? null, percent: r.percent, energy: r.energy, nectar: r.nectar, pollen: r.pollen, ms: r.ms, flowerVersion: r.flowerVersion,
    flowerError: r.flowerError, beeMs: r.beeMs, beeVersion: r.beeVersion, beeError: r.beeError,
    grain: r.grain ?? null, grainVersion: r.grainVersion ?? null, grainCodeLength: r.grainCodeLength ?? null,
    R: Number.isFinite(r.budgetMs) ? r.budgetMs : null }));
  const durationMs = Math.max(Number(game.clockMs) || 0, ...turns.map((t) => t.atMs));
  const W = windowMs || windowFor(durationMs || config.minutes * 60000);
  const flowerMs = config.budgets?.flower?.ms ?? 150, cap = config.budgets?.flower?.size ?? 1100;
  const sizeOf = new Map(); // `${team}:${version}` -> size
  const liveAt = new Map(); // `${team}:${kind}:${version}` -> atMs
  for (const v of versionRows) {
    if (v.kind === "flower") sizeOf.set(`${idOf(v.team)}:${v.version}`, v.size);
    liveAt.set(`${idOf(v.team)}:${v.kind}:${v.version}`, Number(v.atMs) || 0);
  }

  // Windows.
  const windows = [];
  for (const t of turns) {
    const i = Math.floor((t.atMs || 0) / W);
    const w = (windows[i] ||= { from: i * W, turns: 0, feeds: 0, energy: 0, energyLost: 0, nectar: 0, pollen: 0, percents: [], failures: 0, selfTurns: 0, selfFeeds: 0 });
    w.turns++;
    if (t.action === "feed") w.feeds++;
    w.energy += t.energy || 0;
    if (t.action !== "feed") w.energyLost += t.energy || 0;
    w.nectar += t.nectar || 0;
    w.pollen += t.pollen || 0;
    if (t.r === null || t.r === undefined) w.failures++;
    else if (t.percent != null) w.percents.push(t.percent);
    if (t.bee === t.flower) { w.selfTurns++; if (t.action === "feed") w.selfFeeds++; }
  }
  const win = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] || { from: i * W, turns: 0, feeds: 0, energy: 0, energyLost: 0, nectar: 0, pollen: 0, percents: [], failures: 0, selfTurns: 0, selfFeeds: 0 };
    win.push({ from: w.from, turns: w.turns, feeds: w.feeds, feedRate: r3(w.turns ? w.feeds / w.turns : null), energy: r3(w.energy), energyLost: r3(w.energyLost),
      energyLostShare: r3(w.energy ? w.energyLost / w.energy : null), nectar: r3(w.nectar), pollen: r3(w.pollen), meanPercent: r3(mean(w.percents)),
      failures: w.failures, selfFeeds: w.selfFeeds, selfTurns: w.selfTurns });
  }

  // Per team.
  const teams = {};
  for (const id of ids) {
    const atFlower = turns.filter((t) => t.flower === id), byBee = turns.filter((t) => t.bee === id);
    const fed = atFlower.filter((t) => t.action === "feed"), beeFed = byBee.filter((t) => t.action === "feed");
    const answered = atFlower.filter((t) => t.r !== null && t.r !== undefined);
    const ms = atFlower.map((t) => t.ms).filter((x) => x != null), beeMs = byBee.map((t) => t.beeMs).filter((x) => x != null);
    const own = byBee.filter((t) => t.flower === id), ownFed = own.filter((t) => t.action === "feed");
    const elsewhere = byBee.filter((t) => t.flower !== id), elsewhereFed = elsewhere.filter((t) => t.action === "feed");
    const othersAtMe = atFlower.filter((t) => t.bee !== id), othersAtMeFed = othersAtMe.filter((t) => t.action === "feed");
    const pctOwn = own.map((t) => t.percent).filter((x) => x != null), pctOthers = othersAtMe.map((t) => t.percent).filter((x) => x != null);
    teams[id] = {
      name: name[id], index: ids.indexOf(id),
      flower: { turns: atFlower.length, feeds: fed.length, feedRate: r3(atFlower.length ? fed.length / atFlower.length : null), pollinators: new Set(fed.map((t) => t.bee)).size,
        failures: atFlower.length - answered.length, meanPercent: r3(mean(answered.map((t) => t.percent).filter((x) => x != null))),
        percent: q5(answered.map((t) => t.percent).filter((x) => x != null)), energy: q5(atFlower.map((t) => t.energy || 0)),
        energyTotal: r3(sum(atFlower.map((t) => t.energy))), energyLost: r3(sum(atFlower.filter((t) => t.action !== "feed").map((t) => t.energy))),
        nectarPaid: r3(sum(fed.map((t) => t.nectar))), pollen: r3(sum(fed.map((t) => t.pollen))), ms: q5(ms),
        computeShare: r3(ms.length ? mean(ms) / flowerMs : null),
        responseBytes: q5(atFlower.map((t) => t.rBytes).filter((x) => x != null)), bigResponses: atFlower.filter((t) => t.r?.$big).length,
        // Role conformance (EXPERIMENTS.adapt): the shares of answered turns at exactly 50% and at 0%.
        percentAt50: r3(answered.length ? answered.filter((t) => Math.abs((t.percent ?? -1) - 50) < 0.5).length / answered.length : null),
        percentAt0: r3(answered.length ? answered.filter((t) => t.percent != null && t.percent < 0.5).length / answered.length : null),
        // The flower's CPU as a share of its call's budget R (adapt-hi's honest contract: 0.6), over the calls that answered:
        // its quantiles, and the share within ±0.05 of 0.6.
        cpuOfR: q5(answered.filter((t) => t.ms != null && t.R > 0).map((t) => t.ms / t.R)),
        // Against the cooperators' floors (adapt-hi's settings.honest), when given: the shares of answered turns at a percent
        // of at least nectarMin, and with CPU of at least (burnMin − 0.05) × R.
        ...(contract ? { contract: { ...contract,
          percentOk: r3(answered.length ? answered.filter((t) => (t.percent ?? -1) >= contract.nectarMin - 0.5).length / answered.length : null),
          cpuOk: r3((() => { const xs = answered.filter((t) => t.ms != null && t.R > 0).map((t) => t.ms / t.R); return xs.length ? xs.filter((x) => x >= contract.burnMin - 0.05).length / xs.length : null; })()) } } : {}) },
      bee: { turns: byBee.length, feeds: beeFed.length, feedRate: r3(byBee.length ? beeFed.length / byBee.length : null), nectar: r3(sum(beeFed.map((t) => t.nectar))),
        nectarPerFeed: r3(beeFed.length ? sum(beeFed.map((t) => t.nectar)) / beeFed.length : null), flowersFedAt: new Set(beeFed.map((t) => t.flower)).size,
        tooSlow: byBee.filter((t) => TOO_SLOW.test(t.beeError || "")).length, errors: byBee.filter((t) => t.beeError && !TOO_SLOW.test(t.beeError)).length, decisionMs: q5(beeMs) },
      selfFeeding: { ownTurns: own.length, ownFeeds: ownFed.length, ownFeedRate: r3(own.length ? ownFed.length / own.length : null),
        elsewhereFeedRate: r3(elsewhere.length ? elsewhereFed.length / elsewhere.length : null), ownShareOfFeeds: r3(beeFed.length ? ownFed.length / beeFed.length : null),
        ownNectar: r3(sum(ownFed.map((t) => t.nectar))) },
      handshake: (() => {
        const rateOwn = own.length ? ownFed.length / own.length : null, rateOthers = othersAtMe.length ? othersAtMeFed.length / othersAtMe.length : null;
        const pOwn = mean(pctOwn), pOthers = mean(pctOthers);
        const flag = own.length >= 5 && rateOwn != null && rateOthers != null && ((rateOwn - rateOthers >= 0.3) || (pOwn != null && pOthers != null && Math.abs(pOwn - pOthers) >= 15));
        return { ownTurns: own.length, feedRateOwnBee: r3(rateOwn), feedRateOtherBees: r3(rateOthers), percentToOwnBee: r3(pOwn), percentToOtherBees: r3(pOthers), flag };
      })(),
    };
  }

  // Handshakes between teams: per (bee b, flower f), does b feed at f more than b feeds elsewhere, and does f offer b more
  // than it offers other bees? A pair where both hold, in both directions, looks like two teams recognising each other.
  const pairs = [];
  for (const b of ids) for (const f of ids) {
    const ts = turns.filter((t) => t.bee === b && t.flower === f);
    if (ts.length < 5) continue;
    const rest = turns.filter((t) => t.bee === b && t.flower !== f), toOthers = turns.filter((t) => t.flower === f && t.bee !== b);
    const rate = ts.filter((t) => t.action === "feed").length / ts.length;
    const restRate = rest.length ? rest.filter((t) => t.action === "feed").length / rest.length : null;
    const pct = mean(ts.map((t) => t.percent).filter((x) => x != null)), pctOthers = mean(toOthers.map((t) => t.percent).filter((x) => x != null));
    const flag = (restRate != null && rate - restRate >= 0.3) || (pct != null && pctOthers != null && pct - pctOthers >= 15);
    pairs.push({ bee: name[b], beeId: b, flower: name[f], flowerId: f, self: b === f, turns: ts.length, feedRate: r3(rate), feedRateElsewhere: r3(restRate),
      percent: r3(pct), percentToOtherBees: r3(pctOthers), flag });
  }
  const flagged = (b, f) => pairs.find((x) => x.beeId === b && x.flowerId === f)?.flag;
  const mutual = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (flagged(ids[i], ids[j]) && flagged(ids[j], ids[i])) mutual.push([name[ids[i]], name[ids[j]]]);
  }

  // Flower versions: size and compute against energy.
  const versions = [];
  const byVersion = new Map();
  for (const t of turns) { const k = `${t.flower}:${t.flowerVersion ?? "?"}`; if (!byVersion.has(k)) byVersion.set(k, []); byVersion.get(k).push(t); }
  for (const [k, ts] of byVersion) {
    const [team, version] = k.split(":");
    const fed = ts.filter((t) => t.action === "feed"), ms = ts.map((t) => t.ms).filter((x) => x != null);
    const size = sizeOf.get(`${team}:${version}`) ?? null;
    // Its most energy per turn: at R = the window and no compute, and (in a game with the byte factor) at its median
    // response's bytes.
    const medBytes = median(ts.map((t) => t.rBytes).filter((x) => x != null));
    versions.push({ team: name[team], teamId: team, version: version === "?" ? null : Number(version), atMs: liveAt.get(`${team}:flower:${version}`) ?? null, size,
      maxEnergy: size != null ? excessEnergy(config, { size, ms: 0, R: flowerMs, bytes: medBytes ?? 0 }) : null, turns: ts.length, feeds: fed.length, feedRate: r3(ts.length ? fed.length / ts.length : null),
      meanMs: r3(mean(ms)), p90Ms: r3(quantile(ms, 0.9)), meanEnergy: r3(mean(ts.map((t) => t.energy || 0))), meanPercent: r3(mean(ts.map((t) => t.percent).filter((x) => x != null))),
      nectarPerFeed: r3(fed.length ? sum(fed.map((t) => t.nectar)) / fed.length : null), pollen: r3(sum(fed.map((t) => t.pollen))), failures: ts.filter((t) => t.r == null).length,
      medianResponseBytes: medBytes });
  }
  versions.sort((a, b) => String(a.team).localeCompare(String(b.team)) || (a.version ?? 0) - (b.version ?? 0));

  // Discrimination: feed rates by percent offered, and by the nectar on offer.
  const answered = turns.filter((t) => t.r != null && t.percent != null);
  const buckets = [[0, 10], [10, 30], [30, 60], [60, 101]].map(([lo, hi]) => {
    const ts = answered.filter((t) => t.percent >= lo && t.percent < hi);
    return { range: `${lo}-${Math.min(hi, 100)}`, turns: ts.length, feeds: ts.filter((t) => t.action === "feed").length, feedRate: r3(ts.length ? ts.filter((t) => t.action === "feed").length / ts.length : null) };
  });
  const pots = answered.map(potential).filter((x) => x != null);
  const lo = quantile(pots, 1 / 3), hi = quantile(pots, 2 / 3);
  const tercile = (f) => { const ts = answered.filter((t) => f(potential(t))); return { turns: ts.length, feedRate: r3(ts.length ? ts.filter((t) => t.action === "feed").length / ts.length : null) }; };
  const perBee = {};
  for (const id of ids) {
    const ts = answered.filter((t) => t.bee === id);
    const fedP = ts.filter((t) => t.action === "feed").map(potential), leftP = ts.filter((t) => t.action !== "feed").map(potential);
    perBee[id] = { team: name[id], turns: ts.length, offerWhenFed: r3(mean(fedP)), offerWhenLeft: r3(mean(leftP)), percentWhenFed: r3(mean(ts.filter((t) => t.action === "feed").map((t) => t.percent))),
      percentWhenLeft: r3(mean(ts.filter((t) => t.action !== "feed").map((t) => t.percent))) };
  }
  const discrimination = { byPercent: buckets, byOffer: { low: tercile((p) => p <= lo), mid: tercile((p) => p > lo && p <= hi), high: tercile((p) => p > hi), cuts: [r3(lo), r3(hi)] }, perBee };

  // Copies of answers between flowers (public (c, r) pairs).
  const first = new Map(); // key(c) -> Map(key(r) -> Map(team -> { atMs, version }))
  const copies = [];
  for (const t of turns) {
    if (t.r === null || t.r === undefined) continue;
    const c = key(t.c), r = key(t.r);
    let m = first.get(c); if (!m) first.set(c, (m = new Map()));
    let n = m.get(r); if (!n) m.set(r, (n = new Map()));
    if (n.has(t.flower)) continue;
    const earlier = [...n.entries()].filter(([team]) => team !== t.flower).sort((a, b) => a[1].atMs - b[1].atMs)[0];
    n.set(t.flower, { atMs: t.atMs, version: t.flowerVersion });
    if (!earlier) continue;
    const vAt = liveAt.get(`${t.flower}:flower:${t.flowerVersion}`) ?? 0;
    copies.push({ copier: t.flower, source: earlier[0], latencyMs: t.atMs - earlier[1].atMs, version: t.flowerVersion ?? null, afterNewVersion: vAt > earlier[1].atMs });
  }
  const byCopier = ids.map((id) => {
    const xs = copies.filter((x) => x.copier === id), att = xs.filter((x) => x.afterNewVersion);
    return { team: name[id], teamId: id, matches: xs.length, copies: att.length, sources: [...new Set(att.map((x) => name[x.source]))], medianLatencyMs: median(att.map((x) => x.latencyMs)) };
  }).filter((x) => x.matches);
  const att = copies.filter((x) => x.afterNewVersion);

  // Changes: every version, with who submitted it.
  const changes = [];
  for (const v of versionRows) {
    const id = idOf(v.team);
    const s = submits.find((r) => r.team_id === id && r.kind === v.kind && r.version === v.version);
    changes.push({ team: name[id] ?? id, teamId: id, kind: v.kind, version: v.version, atMs: Number(v.atMs) || 0, size: v.size, distance: v.distance, cost: v.cost,
      problem: v.problem ? String(v.problem).slice(0, 160) : null, session: s ? s.session_no : null, source: s?.source || (Number(v.atMs) > 0 ? "unknown" : "lobby") });
  }
  changes.sort((a, b) => a.atMs - b.atMs || a.team.localeCompare(b.team));

  const final = scoreRows.map((x) => ({ team: name[idOf(x.team)], teamId: idOf(x.team), fitness: r3(x.fitness), pollination: r3(x.pollination), forage: r3(x.forage),
    pollinationShare: r3(x.pollinationShare), forageShare: r3(x.forageShare), pollen: r3(x.pollen), feedsReceived: x.feedsReceived, feedsGiven: x.feedsGiven,
    pollinators: x.pollinators, nectarCollected: r3(x.nectarCollected), nectarGiven: r3(x.nectarGiven), nectarSources: x.nectarSources }));

  // Bee MEMORY: its size at the end, saves refused (over the cap, the wrong shape, a failed fed()), its size over time,
  // and bee changes (each empties it).
  const memCap = config.budgets?.bee?.memory ?? null;
  const memory = { cap: memCap, teams: byIndex.map((t) => {
    const beeVs = versionRows.filter((v) => idOf(v.team) === t.id && v.kind === "bee");
    const inGame = beeVs.filter((v) => Number(v.atMs) > 0).map((v) => Number(v.atMs)).sort((a, b) => a - b);
    const mine = memorySamples.filter((x) => x.team === t.id);
    const samples = mine.map((x) => ({ clockMs: x.clockMs, bytes: x.bytes, version: x.version, ...(x.keys != null ? { keys: x.keys } : {}), ...(x.error ? { error: x.error } : {}) }));
    const bytes = samples.map((x) => x.bytes).filter((x) => x != null);
    const turnsOfBee = turns.filter((x) => x.bee === t.id);
    // Save errors the samples saw (each distinct error once): fed() failures are only seen this way (and at the end).
    const errs = [...new Set([...mine.map((x) => x.error).filter(Boolean), ...(t.memoryError ? [t.memoryError] : [])])];
    return { team: t.name, teamId: t.id, finalBytes: t.memoryBytes ?? null, finalShare: r3(memCap && t.memoryBytes != null ? t.memoryBytes / memCap : null),
      keys: t.memory && typeof t.memory === "object" ? Object.keys(t.memory).length : null, value: t.memory ?? null, finalError: t.memoryError ?? null,
      overCap: turnsOfBee.filter((x) => /memory/i.test(x.beeError || "")).length, fedFailures: errs.filter((e) => /fed\(\)/.test(e)).length,
      errors: errs.slice(0, 5).map((e) => String(e).slice(0, 200)), beeVersions: beeVs.length, beeChanges: inGame.length,
      beeChangesPerMinute: r3(durationMs ? inGame.length / (durationMs / 60000) : null),
      meanMsBetweenChanges: inGame.length > 1 ? r3(mean(inGame.slice(1).map((x, i) => x - inGame[i]))) : null,
      sampledMaxBytes: bytes.length ? Math.max(...bytes) : null, sampledMeanBytes: r3(mean(bytes)), samples };
  }) };

  const im = imitation(turns, ids, { liveAt });
  const named = (x) => ({ ...x, team: name[x.teamId] ?? x.teamId });
  const ecology = {
    energySplit: Object.fromEntries(Object.entries(energySplit(turns, ids, { sizeOf, cap, windowMs: flowerMs, config })).map(([id, x]) => [id, { team: name[id], ...x }])),
    percentOverTime: percentOverTime(turns, ids, W).map(named),
    imitation: { signalsCopied: im.signalsCopied, medianLagMs: im.medianLagMs, lags: im.lags.map((x) => ({ ...x, model: name[x.model] ?? x.model, by: name[x.by] ?? x.by })),
      copies: im.copies.map((e) => ({ copier: name[e.copier] ?? e.copier, copierVersion: e.copierVersion, model: name[e.model] ?? e.model, modelVersion: e.modelVersion, exact: e.exact,
        atMs: e.atMs, lagMs: e.lagMs, detected: e.detection.detected, detectedAfterMs: e.detection.afterMs, rivalFeedsBeforeDetection: e.detection.rivalFeedsBefore })) },
    rotations: rotation(turns, ids).map((x) => named(x)),
    predictions: predictions(turns, { liveAt }).map((p) => ({ ...p, predictor: name[p.predictor] ?? p.predictor, target: name[p.target] ?? p.target })),
    autarky: (() => { const a = autarky(turns, ids); return { ...a, teams: a.teams.map(named) }; })(),
  };

  // Pollen grains: minified codes by `${team id}:${kind}:${version}` (computeGameMetrics minifies the revealed code).
  const minCode = new Map();
  for (const [k, v] of minified || []) { const [team, kind, version] = k.split(":"); minCode.set(`${idOf(Number(team))}:${kind}:${version}`, v); }
  const grains = config.grains === "off" && !turns.some((t) => t.grain) ? { setting: "off" }
    : grainMetrics({ turns, ids, name, minified: minCode, liveAt, durationMs, grains: config.grains ?? "feeder" });

  const fb = config.budgets?.flower || {};
  const wealth = wealthMetrics({ turns, ids, name, range: [fb.minMs ?? null, fb.maxMs ?? fb.ms ?? null] });

  const fedTurns = turns.filter((t) => t.action === "feed");
  return {
    windowMs: W, durationMs, turns: turns.length, rounds: Number(game.round) || Math.max(0, ...turns.map((t) => t.round || 0)),
    turnsPerSec: r3(durationMs ? turns.length / (durationMs / 1000) : null), roundsPerSec: r3(durationMs ? (Number(game.round) || 0) / (durationMs / 1000) : null),
    totals: { feeds: fedTurns.length, feedRate: r3(turns.length ? fedTurns.length / turns.length : null), energy: r3(sum(turns.map((t) => t.energy))),
      energyLost: r3(sum(turns.filter((t) => t.action !== "feed").map((t) => t.energy))), nectar: r3(sum(fedTurns.map((t) => t.nectar))), pollen: r3(sum(fedTurns.map((t) => t.pollen))),
      failures: turns.filter((t) => t.r == null).length, selfFeeds: fedTurns.filter((t) => t.bee === t.flower).length },
    windows: win,
    distributions: { responseBytes: q5(turns.map((t) => t.rBytes).filter((x) => x != null)), percent: q5(answered.map((t) => t.percent)), energy: q5(turns.map((t) => t.energy || 0)), nectar: q5(fedTurns.map((t) => t.nectar || 0)), pollen: q5(fedTurns.map((t) => t.pollen || 0)) },
    teams, handshakes: { pairs, mutual }, versions, discrimination,
    copies: { matches: copies.length, copies: att.length, medianLatencyMs: median(att.map((x) => x.latencyMs)), byCopier },
    changes, final, memory, ecology, grains, wealth,
    config: { minutes: config.minutes, feedCost: config.feedCost, challengeType: config.challengeType, responseType: config.responseType, budgets: config.budgets,
      grains: config.grains ?? null, pollenGrain: config.pollenGrain ?? null, maxResponseBytes: config.maxResponseBytes ?? null, scoring: config.scoring ?? null,
      energy: config.energy ?? null, prevalence: config.prevalence ?? null, feedPrice: config.feedPrice ?? null, flowerWindowMs: config.flowerWindowMs ?? null,
      // (resolved, from the view: what the game played with)
      ...(game.feedPrice != null ? { feedPriceResolved: game.feedPrice } : {}), ...(game.windowMs != null ? { windowMs: game.windowMs } : {}) },
    clockMs: Number(game.clockMs) || 0, round: Number(game.round) || 0,
  };
}

/** Every row of a history query, page by page (5,000 a page, the most the server returns). */
export async function queryAll(api, gPath, ast, tok = null) {
  const out = [];
  for (let offset = 0; ; offset += 5000) {
    const r = await api.query(tok, gPath, { ...ast, limit: 5000, offset });
    out.push(...(r.rows || []));
    if (!r.truncated || !(r.rows || []).length) break;
  }
  return out;
}

/** A finished game's metrics, from its history (everything is revealed once it is over). submits: who submitted each
 * version (arena.requests), optional. */
export async function computeGameMetrics(gPath, { api = Api, submits = [], memorySamples = [], windowMs, fetchBytes = BIG_FETCH_BYTES, contract = null } = {}) {
  const view = await api.view(null, gPath);
  const [teams, turns, versions, scores] = await Promise.all(["teams", "turns", "versions", "scores"].map((from) => queryAll(api, gPath, { from })));
  const shapes = await bigShapes(api, gPath, turns, fetchBytes);
  const minified = await minifiedCodes(view.game.config?.language || "python", versions);
  return { ...computeMetrics({ game: view.game, teams, turns, versions, scores, submits, memorySamples, windowMs, shapes, minified, contract }), bigResponses: shapes.stats };
}

/** Every version's minified code, as the game ran it (the game's own minifier): Map(`${team index}:${kind}:${version}` ->
 * text). Versions whose code isn't revealed are left out. */
export async function minifiedCodes(language, versions) {
  const out = new Map();
  if (!versions.some((v) => typeof v.code === "string")) return out;
  const { size } = await import("../../server/lib/measure.js");
  for (const v of versions) {
    if (typeof v.code !== "string") continue;
    try { out.set(`${v.team}:${v.kind}:${v.version}`, (await size(language, v.code)).minified); } catch {}
  }
  return out;
}

/**
 * The shapes of a game's big responses (over 4 KB: the history has only their size and hash), fetched lazily: distinct
 * hashes in order of first appearance, one at a time, until `budget` bytes. Map(hash -> shape) with `stats`.
 */
export async function bigShapes(api, gPath, turns, budget = BIG_FETCH_BYTES) {
  const shapes = new Map(), first = new Map();
  for (const t of turns) if (t.responseHash && !first.has(t.responseHash)) first.set(t.responseHash, t);
  let bytes = 0, fetched = 0, failed = 0;
  for (const [hash, t] of first) {
    if (bytes + (t.responseBytes || 0) > budget) continue;
    try {
      const r = await api.response(null, gPath, t.seq);
      if (!r) { failed++; continue; }
      bytes += Buffer.byteLength(r.text);
      fetched++;
      shapes.set(hash, shapeOf(r.value));
    } catch { failed++; }
  }
  const all = turns.filter((t) => t.responseHash);
  shapes.stats = { turns: all.length, distinct: first.size, fetched, failed, fetchedBytes: bytes, bytes: all.reduce((a, t) => a + (t.responseBytes || 0), 0) };
  return shapes;
}

/** Who submitted each version of a game (a session, the scaffold, or the runner's lobby fallback): arena.requests. */
export const submitsOf = (all, gameId) => all(`SELECT e.team_id, r.kind, r.version, r.refused, r.source, s.no AS session_no FROM arena.requests r
      LEFT JOIN arena.sessions s ON s.id = r.session_id JOIN arena.entries e ON e.game_id = r.game_id AND e.persona_id = r.persona_id
     WHERE r.game_id = $1 AND r.op = 'submit' AND r.ok AND r.version IS NOT NULL`, [gameId]);

/** Scaffolds of a game: who ran one, how often it started, crashed or was refused, its CPU, and what it submitted. */
export const scaffoldsOf = (all, gameId) => all(`SELECT e.team_id, e.team_name AS team, count(*)::int AS starts, count(*) FILTER (WHERE sc.status = 'crashed')::int AS crashes,
      count(*) FILTER (WHERE sc.status = 'refused')::int AS refused, coalesce(sum(sc.cpu_seconds), 0) AS cpu_seconds, coalesce(sum(sc.throttled_ms), 0)::bigint AS throttled_ms,
      (SELECT count(*)::int FROM arena.requests r WHERE r.game_id = sc.game_id AND r.persona_id = sc.persona_id AND r.source = 'scaffold' AND r.op = 'submit' AND r.ok) AS submits,
      (SELECT count(*)::int FROM arena.requests r WHERE r.game_id = sc.game_id AND r.persona_id = sc.persona_id AND r.source = 'scaffold' AND r.op = 'submit' AND NOT r.ok) AS refused_submits,
      min(sc.clock_start) AS first_start_ms
    FROM arena.scaffolds sc JOIN arena.entries e ON e.game_id = sc.game_id AND e.persona_id = sc.persona_id WHERE sc.game_id = $1 GROUP BY 1, 2, sc.game_id, sc.persona_id`, [gameId]);
