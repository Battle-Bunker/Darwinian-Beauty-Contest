// Metrics of a finished continuous game, from the game's own tables (the full record: every team's versions are
// visible once a game is over). One pass over the actions in seq order (GameMetrics.add), so a long game never has
// to be in memory at once. Stored in arena.games.metrics by run.js and printed by analyze.js.
//
//   windows      per stretch of game time (windowMs): actions, rounds, feeds, nectar, precision (nectar per feed),
//                nectar per bee-round (a bee gets one turn per round unless it is feeding), rival clover vs rival
//                orchid fed rates (share of visits that ended in a feed) and their gap, fingerprinting (share of a
//                bee's pre-feed asks that repeat a challenge it asked before; distinct challenges), stolen-face and
//                twin orchid answers, flower compute against budget, and fitness from that stretch's ledgers
//   teams        per team: the same for its bee, its clover and its orchid, whole game and per window
//   copies       how fast orchids copy rival clovers: for each answer (c, r) a clover gave, the time until a rival
//                orchid first answered r to c (only when that orchid hadn't answered so before), and whether the
//                orchid's version that did it went live after the clover's answer appeared
//   changes      every program version: who, which, when (game time), size, node edits, cost, and the session
//   compute      per flower: asks, mean/p90/max ms against its budget, timeouts
//   final        the game's scores
import crypto from "node:crypto";
import { score, zeroLedger } from "../../server/lib/scoring.js";

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const key = (v) => { const s = JSON.stringify(v ?? null); return s.length <= 200 ? s : "#" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 16) + ":" + s.length; };
const quantile = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const median = (xs) => quantile(xs, 0.5);

/** A sensible window for a game of `durationMs`: about 8 windows, at least 10 s, in round numbers. */
export function windowFor(durationMs) {
  const nice = [10, 15, 30, 60, 120, 300, 600].map((s) => s * 1000);
  return nice.find((w) => durationMs / w <= 8) || 600000;
}

export class GameMetrics {
  /** participants: team ids in ledger order; names: {id: name}; config: the game config. */
  constructor({ config, participants, names, windowMs }) {
    this.config = config;
    this.ids = participants;
    this.idx = new Map(participants.map((id, i) => [id, i]));
    this.names = names;
    this.windowMs = windowMs || windowFor(config.minutes * 60000);
    this.w = new Map();             // window index -> stats
    this.visits = new Map();        // "bee|visit" -> { w, patch, kind, fed }
    this.askedBy = new Map();       // bee -> Set(challenge keys asked before feeding)
    this.cloverAns = new Map();     // clover team -> Map(c -> Map(r -> first atMs))
    this.orchidAns = new Map();     // orchid team -> Map(c -> Set(r))
    this.copies = [];               // { orchid, clover, c, latencyMs, atMs, version }
    this.clovers = 0;               // distinct (clover, c, r) answers
    this.flowerMs = new Map();      // "team|kind" -> [ms]
    this.timeouts = new Map();
    this.actions = 0;
    this.lastMs = 0;
    this.maxRound = 0;
  }

  #win(atMs) {
    const i = Math.floor(atMs / this.windowMs);
    let s = this.w.get(i);
    if (!s) {
      const n = this.ids.length;
      s = { i, actions: 0, asks: 0, feeds: 0, nectar: 0, minRound: Infinity, maxRound: -Infinity, feedsL: zeroLedger(n), nectarL: zeroLedger(n),
        rival: { cloverVisits: 0, cloverFed: 0, orchidVisits: 0, orchidFed: 0 }, bees: new Map(), orchidAsks: 0, stolen: 0, twin: 0,
        flowerMs: new Map(), flowerErrors: 0, beeErrors: 0 };
      this.w.set(i, s);
    }
    return s;
  }

  #bee(s, b) {
    let x = s.bees.get(b);
    if (!x) s.bees.set(b, (x = { asks: 0, repeats: 0, cs: new Map(), feeds: 0, nectar: 0, rivalCloverVisits: 0, rivalCloverFed: 0, rivalOrchidVisits: 0, rivalOrchidFed: 0, errors: 0 }));
    return x;
  }

  /** a: an action row from the game's table (seq order): at_ms, round, bee_team, visit, patch_team, kind, action, c, r, after, nectar, ms, error, error_by, flower_version. */
  add(a) {
    const atMs = Number(a.at_ms ?? a.atMs), bee = a.bee_team ?? a.bee, patch = a.patch_team ?? a.patch;
    const s = this.#win(atMs);
    this.actions++;
    this.lastMs = Math.max(this.lastMs, atMs);
    s.actions++;
    if (a.round != null) { const r = Number(a.round); s.minRound = Math.min(s.minRound, r); s.maxRound = Math.max(s.maxRound, r); this.maxRound = Math.max(this.maxRound, r); }
    const vk = `${bee}|${a.visit}`;
    let v = this.visits.get(vk);
    const rival = bee !== patch;
    const bx = this.#bee(s, bee);
    if (!v) {
      v = { w: s, patch, kind: a.kind, fed: false };
      this.visits.set(vk, v);
      if (rival) { if (a.kind === "clover") { s.rival.cloverVisits++; bx.rivalCloverVisits++; } else { s.rival.orchidVisits++; bx.rivalOrchidVisits++; } }
    }
    if (a.action === "ask") {
      s.asks++;
      const c = key(a.c);
      if (!a.after) {
        bx.asks++;
        let seen = this.askedBy.get(bee);
        if (!seen) this.askedBy.set(bee, (seen = new Set()));
        if (seen.has(c)) bx.repeats++; else seen.add(c);
        bx.cs.set(c, (bx.cs.get(c) || 0) + 1);
      }
      const fk = `${patch}|${a.kind}`;
      if (a.ms != null) {
        (this.flowerMs.get(fk) || this.flowerMs.set(fk, []).get(fk)).push(Number(a.ms));
        (s.flowerMs.get(fk) || s.flowerMs.set(fk, []).get(fk)).push(Number(a.ms));
      }
      if (a.error && a.error_by === "flower") { s.flowerErrors++; if (/time|timeout/i.test(a.error)) this.timeouts.set(fk, (this.timeouts.get(fk) || 0) + 1); }
      if (a.r != null && !a.error) {
        const r = key(a.r);
        if (a.kind === "clover") {
          let byC = this.cloverAns.get(patch);
          if (!byC) this.cloverAns.set(patch, (byC = new Map()));
          let byR = byC.get(c);
          if (!byR) byC.set(c, (byR = new Map()));
          if (!byR.has(r)) { byR.set(r, atMs); this.clovers++; }
        } else {
          // An orchid answer: does it match an answer a clover gave to the same challenge earlier?
          {
            s.orchidAsks++;
            let stolenFrom = null, twin = false;
            for (const [team, byC] of this.cloverAns) {
              const t0 = byC.get(c)?.get(r);
              if (t0 == null || t0 > atMs) continue;
              if (team === patch) twin = true;
              else if (!stolenFrom || t0 < stolenFrom.t0) stolenFrom = { team, t0 };
            }
            if (stolenFrom) s.stolen++;
            if (twin) s.twin++;
            let mine = this.orchidAns.get(patch);
            if (!mine) this.orchidAns.set(patch, (mine = new Map()));
            let rs = mine.get(c);
            if (!rs) mine.set(c, (rs = new Set()));
            if (!rs.has(r)) {
              rs.add(r);
              if (stolenFrom) this.copies.push({ orchid: patch, clover: stolenFrom.team, c, latencyMs: atMs - stolenFrom.t0, atMs, clovAtMs: stolenFrom.t0, version: a.flower_version ?? null });
            }
          }
        }
      }
    } else if (a.action === "feed") {
      s.feeds++;
      bx.feeds++;
      v.fed = true;
      const bi = this.idx.get(bee), pi = this.idx.get(patch);
      if (bi != null && pi != null) { s.feedsL[bi][pi]++; if (a.nectar) s.nectarL[bi][pi]++; }
      if (a.nectar) { s.nectar++; bx.nectar++; }
      if (rival) {
        const vw = v.w; // count the fed visit in the window where the visit started
        const vb = this.#bee(vw, bee);
        if (v.kind === "clover") { vw.rival.cloverFed++; vb.rivalCloverFed++; } else { vw.rival.orchidFed++; vb.rivalOrchidFed++; }
      }
    } else if (a.action === "error") {
      bx.errors++;
      s.beeErrors++;
    }
  }

  /** programs: every version {team_id, kind, version, size, distance, cost, at_ms, problem}; requests: arena.requests submit rows with session numbers. */
  finish({ programs = [], submits = [], finalFeeds = null, finalNectar = null } = {}) {
    const n = this.ids.length;
    const name = (id) => this.names[id] || String(id).slice(0, 8);
    const budgetMs = (kind) => this.config.budgets?.[kind]?.ms || null;
    const cumF = zeroLedger(n), cumN = zeroLedger(n);
    const windows = [];
    const perTeam = Object.fromEntries(this.ids.map((id) => [id, { name: name(id), windows: [] }]));
    for (const s of [...this.w.values()].sort((a, b) => a.i - b.i)) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { cumF[i][j] += s.feedsL[i][j]; cumN[i][j] += s.nectarL[i][j]; }
      const rounds = Number.isFinite(s.maxRound) ? s.maxRound - s.minRound + 1 : null;
      const bees = [...s.bees.values()];
      const repeat = bees.map((b) => (b.asks ? b.repeats / b.asks : null)).filter((x) => x != null);
      const comp = {};
      for (const [fk, ms] of s.flowerMs) { const kind = fk.split("|")[1]; (comp[kind] ||= []).push(...ms.map((x) => x / (budgetMs(kind) || 1))); }
      const fit = score(this.ids, s.feedsL, s.nectarL), cum = score(this.ids, cumF, cumN);
      windows.push({
        from: s.i * this.windowMs, to: (s.i + 1) * this.windowMs, actions: s.actions, rounds, asks: s.asks, feeds: s.feeds, nectar: s.nectar,
        precision: r3(s.feeds ? s.nectar / s.feeds : null), nectarPerBeeRound: r3(rounds ? s.nectar / (rounds * n) : null),
        rivalCloverFed: r3(s.rival.cloverVisits ? s.rival.cloverFed / s.rival.cloverVisits : null),
        rivalOrchidFed: r3(s.rival.orchidVisits ? s.rival.orchidFed / s.rival.orchidVisits : null),
        gap: r3(s.rival.cloverVisits && s.rival.orchidVisits ? s.rival.cloverFed / s.rival.cloverVisits - s.rival.orchidFed / s.rival.orchidVisits : null),
        repeatShare: r3(repeat.length ? repeat.reduce((a, b) => a + b, 0) / repeat.length : null),
        distinctPerBee: r3(bees.length ? bees.reduce((a, b) => a + b.cs.size, 0) / bees.length : null),
        stolenShare: r3(s.orchidAsks ? s.stolen / s.orchidAsks : null), twinShare: r3(s.orchidAsks ? s.twin / s.orchidAsks : null),
        cloverCompute: r3(comp.clover?.length ? comp.clover.reduce((a, b) => a + b, 0) / comp.clover.length : null),
        orchidCompute: r3(comp.orchid?.length ? comp.orchid.reduce((a, b) => a + b, 0) / comp.orchid.length : null),
        flowerErrors: s.flowerErrors, beeErrors: s.beeErrors,
        fitness: Object.fromEntries(fit.map((x) => [x.teamId, r3(x.fitness)])), cumFitness: Object.fromEntries(cum.map((x) => [x.teamId, r3(x.fitness)])),
      });
      for (const id of this.ids) {
        const b = s.bees.get(id);
        const top = b && b.cs.size ? Math.max(...b.cs.values()) : 0;
        const fx = (kind) => { const ms = s.flowerMs.get(`${id}|${kind}`) || []; return ms.length ? r3(ms.reduce((a, c) => a + c, 0) / ms.length / (budgetMs(kind) || 1)) : null; };
        const fed = (kind) => { let v = 0; for (let i = 0; i < n; i++) if (this.ids[i] !== id) v += s.feedsL[i][this.idx.get(id)]; return v; };
        perTeam[id].windows.push({
          from: s.i * this.windowMs, asks: b?.asks ?? 0, feeds: b?.feeds ?? 0, nectar: b?.nectar ?? 0, precision: r3(b?.feeds ? b.nectar / b.feeds : null),
          rivalCloverFed: r3(b?.rivalCloverVisits ? b.rivalCloverFed / b.rivalCloverVisits : null), rivalOrchidFed: r3(b?.rivalOrchidVisits ? b.rivalOrchidFed / b.rivalOrchidVisits : null),
          repeatShare: r3(b?.asks ? b.repeats / b.asks : null), distinct: b?.cs.size ?? 0, topChallengeShare: r3(b?.asks ? top / b.asks : null),
          feedsReceivedFromRivals: fed(), cloverCompute: fx("clover"), orchidCompute: fx("orchid"), fitness: windows[windows.length - 1].fitness[id],
        });
      }
    }
    // Whole-game per team.
    const sum = (id, k) => perTeam[id].windows.reduce((a, w) => a + (w[k] || 0), 0);
    for (const id of this.ids) {
      let rcv = 0, rcf = 0, rov = 0, rof = 0, asks = 0, repeats = 0;
      for (const s of this.w.values()) { const b = s.bees.get(id); if (!b) continue; rcv += b.rivalCloverVisits; rcf += b.rivalCloverFed; rov += b.rivalOrchidVisits; rof += b.rivalOrchidFed; asks += b.asks; repeats += b.repeats; }
      Object.assign(perTeam[id], {
        asks: sum(id, "asks"), feeds: sum(id, "feeds"), nectar: sum(id, "nectar"), precision: r3(sum(id, "feeds") ? sum(id, "nectar") / sum(id, "feeds") : null),
        rivalCloverFed: r3(rcv ? rcf / rcv : null), rivalOrchidFed: r3(rov ? rof / rov : null), gap: r3(rcv && rov ? rcf / rcv - rof / rov : null),
        repeatShare: r3(asks ? repeats / asks : null), distinctChallenges: this.askedBy.get(id)?.size ?? 0,
      });
    }
    // Copies: per orchid team.
    const copies = {};
    for (const id of this.ids) {
      const cs = this.copies.filter((x) => x.orchid === id);
      if (!cs.length) continue;
      const atOf = (ver) => programs.find((p) => p.team_id === id && p.kind === "orchid" && p.version === ver)?.at_ms;
      const attributed = cs.filter((x) => x.version != null && Number(atOf(x.version) ?? 0) > x.clovAtMs);
      copies[id] = {
        name: name(id), copies: cs.length, from: [...new Set(cs.map((x) => name(x.clover)))], medianLatencyMs: median(cs.map((x) => x.latencyMs)),
        p10LatencyMs: quantile(cs.map((x) => x.latencyMs), 0.1), afterNewVersion: attributed.length, medianLatencyAfterNewVersionMs: median(attributed.map((x) => x.latencyMs)),
      };
    }
    // Compute per flower, whole game.
    const compute = {};
    for (const [fk, ms] of this.flowerMs) {
      const [id, kind] = fk.split("|");
      const b = budgetMs(kind);
      compute[fk] = { team: name(id), kind, asks: ms.length, budgetMs: b, meanMs: r3(ms.reduce((a, x) => a + x, 0) / ms.length), p90Ms: r3(quantile(ms, 0.9)), maxMs: r3(Math.max(...ms)),
        meanFrac: r3(ms.reduce((a, x) => a + x, 0) / ms.length / (b || 1)), p90Frac: r3(quantile(ms, 0.9) / (b || 1)), timeouts: this.timeouts.get(fk) || 0 };
    }
    // Changes: every version, with the session that submitted it.
    const changes = programs.map((p) => {
      const s = submits.find((r) => r.team_id === p.team_id && r.kind === p.kind && r.version === p.version);
      return { team: name(p.team_id), teamId: p.team_id, kind: p.kind, version: p.version, atMs: Number(p.at_ms), size: p.size, distance: p.distance, cost: p.cost,
        problem: p.problem ? String(p.problem).slice(0, 160) : null, session: s ? s.session_no : null, auto: s?.refused?.startsWith("auto") || false };
    }).sort((a, b) => a.atMs - b.atMs || a.team.localeCompare(b.team));
    const durationMs = this.lastMs;
    const totalCopies = this.copies.filter((x) => this.ids.includes(x.orchid));
    return {
      windowMs: this.windowMs, durationMs, actions: this.actions, rounds: this.maxRound, actionsPerSec: r3(durationMs ? this.actions / (durationMs / 1000) : null),
      roundsPerSec: r3(durationMs ? this.maxRound / (durationMs / 1000) : null), windows, teams: perTeam,
      copies: { cloverAnswers: this.clovers, copied: totalCopies.length, medianLatencyMs: median(totalCopies.map((x) => x.latencyMs)), byOrchid: copies },
      compute, changes,
      final: finalFeeds ? score(this.ids, finalFeeds, finalNectar).map((x) => ({ team: name(x.teamId), teamId: x.teamId, fitness: r3(x.fitness), allure: r3(x.allure), forage: r3(x.forage), feedsReceived: x.feedsReceived, nectarCollected: x.nectarCollected })) : null,
    };
  }
}

/** Compute a finished game's metrics from the database (read-only on the game's tables). */
export async function computeGameMetrics({ all, one }, gameUuid, { windowMs, arenaGameId } = {}) {
  const g = await one("SELECT * FROM games WHERE id = $1", [gameUuid]);
  const teams = await all("SELECT id, name FROM teams WHERE game_id = $1", [gameUuid]);
  const names = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const m = new GameMetrics({ config: g.config, participants: g.participants || [], names, windowMs });
  let after = 0;
  for (;;) {
    const rows = await all(`SELECT seq, at_ms, round, bee_team, visit, patch_team, kind, action, c, r, after, nectar, ms, error, error_by, flower_version
                              FROM actions WHERE game_id = $1 AND seq > $2 ORDER BY seq LIMIT 20000`, [gameUuid, after]);
    for (const r of rows) m.add(r);
    if (rows.length < 20000) break;
    after = Number(rows[rows.length - 1].seq);
  }
  const programs = await all("SELECT team_id, kind, version, size, distance, cost, at_ms, problem FROM programs WHERE game_id = $1 ORDER BY at_ms, version", [gameUuid]);
  const submits = arenaGameId ? await all(`SELECT e.team_id, r.kind, r.version, r.refused, s.no AS session_no FROM arena.requests r JOIN arena.sessions s ON s.id = r.session_id
                                             JOIN arena.entries e ON e.game_id = r.game_id AND e.persona_id = r.persona_id
                                            WHERE r.game_id = $1 AND r.op = 'submit' AND r.ok AND r.version IS NOT NULL`, [arenaGameId]) : [];
  const out = m.finish({ programs, submits, finalFeeds: g.feeds, finalNectar: g.nectar });
  out.storage = await one(`SELECT count(*)::int AS actions, coalesce(sum(pg_column_size(a.*)), 0)::bigint AS bytes FROM actions a WHERE a.game_id = $1`, [gameUuid]);
  out.config = { minutes: g.config.minutes, feedCost: g.config.feedCost, challengeType: g.config.challengeType, responseType: g.config.responseType, budgets: g.config.budgets };
  out.clockMs = Number(g.clock_ms);
  out.round = Number(g.round || 0);
  return out;
}
