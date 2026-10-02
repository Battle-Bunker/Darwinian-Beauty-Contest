// Shared harness for the scripted simulations (analysis/replay-sim.mjs, analysis/identity-rules-sim.mjs):
// plays several rounds on the real engine (server/engine.js simulateRound), chains each bee's MEMORY from round to
// round, and summarises who fed where. No database, no LLMs. CPU_SLOTS defaults to 2 here so the simulations leave
// cores free for other work (set it before the engine module loads).
import crypto from "node:crypto";

process.env.CPU_SLOTS ||= "2";
const { simulateRound } = await import("../server/engine.js");
const { normalizeConfig } = await import("../server/lib/gameConfig.js");
const { score, addLedgers } = await import("../server/lib/scoring.js");
export { normalizeConfig, score };

/** The 40-bit hash used by every scripted flower: int(sha256(f"{k}:{c}").hexdigest()[:10], 16) in Python. */
export const H40 = (k, c) => parseInt(crypto.createHash("sha256").update(`${k}:${c}`).digest("hex").slice(0, 10), 16);
export const PY_H40 = `def H40(k, c):
    return int(hashlib.sha256((str(k) + ":" + str(c)).encode()).hexdigest()[:10], 16)
`;

/**
 * Play a game. programsFor(round, history) -> [{ clover, orchid, bee }] per team (code strings; may depend on
 * earlier rounds' visits, e.g. a thief that reads its flower log). Returns per-round { visits, feeds, nectar, scores,
 * turns } and game totals.
 */
export async function playGame({ config, nTeams, rounds, seed, programsFor }) {
  const cfg = normalizeConfig(config);
  const memory = Array.from({ length: nTeams }, () => []);
  const history = [];
  let feeds = null, nectar = null;
  for (let r = 1; r <= rounds; r++) {
    const progs = programsFor(r, history);
    const teams = progs.map((p, i) => ({ id: i, programs: p, memory: memory[i] }));
    const res = await simulateRound({ config: cfg, teams, seed: (seed * 1009 + r * 31) >>> 0 });
    res.memories.forEach((m, i) => memory[i].push(m.snapshot));
    const problems = res.problems.map((p, i) => Object.entries(p).filter(([, v]) => v).map(([k, v]) => `team ${i} ${k}: ${String(v).slice(0, 160)}`)).flat();
    feeds = feeds ? addLedgers(feeds, res.feeds) : res.feeds;
    nectar = nectar ? addLedgers(nectar, res.nectar) : res.nectar;
    const ids = progs.map((_, i) => i);
    history.push({ round: r, visits: res.visits, feeds: res.feeds, nectar: res.nectar, scores: score(ids, res.feeds, res.nectar), turns: res.turns, problems, memories: res.memories });
  }
  const ids = Array.from({ length: nTeams }, (_, i) => i);
  return { history, feeds, nectar, scores: score(ids, feeds, nectar) };
}

/** Fed rates by rival bees at each team's clover and orchid, and per-bee rival discrimination and nectar per turn. */
export function summarise(history, nTeams, { rounds = null } = {}) {
  const hs = rounds ? history.filter((h) => rounds.includes(h.round)) : history;
  const flower = Array.from({ length: nTeams }, () => ({ cv: 0, cf: 0, ov: 0, of: 0 }));
  const bee = Array.from({ length: nTeams }, () => ({ cv: 0, cf: 0, ov: 0, of: 0, nectar: 0, turns: 0, feeds: 0, rfeeds: 0, rnectar: 0, errors: 0 }));
  for (const h of hs) {
    for (let i = 0; i < nTeams; i++) bee[i].turns += h.turns;
    for (const v of h.visits) {
      const fed = v.action === "feed";
      if (v.action === "error") bee[v.bee].errors++;
      if (fed) { bee[v.bee].feeds++; if (v.nectar) bee[v.bee].nectar++; }
      if (v.bee === v.patch) continue;
      const f = flower[v.patch], b = bee[v.bee];
      if (fed) { b.rfeeds++; if (v.nectar) b.rnectar++; }
      if (v.kind === "clover") { f.cv++; b.cv++; if (fed) { f.cf++; b.cf++; } } else { f.ov++; b.ov++; if (fed) { f.of++; b.of++; } }
    }
  }
  return {
    flower: flower.map((f) => ({ cloverFed: f.cv ? f.cf / f.cv : null, orchidFed: f.ov ? f.of / f.ov : null })),
    bee: bee.map((b) => ({ cloverFed: b.cv ? b.cf / b.cv : null, orchidFed: b.ov ? b.of / b.ov : null, gap: b.cv && b.ov ? b.cf / b.cv - b.of / b.ov : null,
      precRival: b.rfeeds ? b.rnectar / b.rfeeds : null, nectarPerTurn: b.turns ? b.nectar / b.turns : null, errors: b.errors })),
  };
}

export const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const sd = (xs) => { const m = mean(xs); return m == null ? null : Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
export const f2 = (x) => (x == null || Number.isNaN(x) ? "  -  " : x.toFixed(2));
export const f3 = (x) => (x == null || Number.isNaN(x) ? "  -  " : x.toFixed(3));
