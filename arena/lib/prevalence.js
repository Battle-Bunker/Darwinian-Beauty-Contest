// Species prevalence (server/lib/prevalence.js, RULES.md "Species prevalence"): each turn's flower is of species s with
// probability p_s = (c + P_s) / Σ_k (c + P_k), where P_s is its recent success on a par-1 scale (N × its share of the
// game's prevalence basis, by default Σ over bee teams of (the pollen it gave them lately)^beta, every ledger cell
// starting at a prior and halving every halfLifeS of game time; capped) and c runs linearly from cStart to cEnd over the
// game. Uncapped, Σ (c + P_k) = N (c + 1). config.prevalence { on, basis, halfLifeS, cStart, cEnd, prior, cap }; a
// config without it (or on false) draws uniformly. Published, never to programs: samples { round, atMs, c, species:
// [{ team (id), index, p, P }] } in the game view, GET .../scores, GET .../prevalence, the action stream's pages and
// events, and the `prevalence` query entity ({ round, atMs, team (index), p, success, c }).
//
// coop-eq's rules (the engine is building them; their keys here are PROVISIONAL until it reports them, all read in
// coopRules): prevalence on both sides (bees drawn by their recent net nectar), K = ⌈N/4⌉ bees a round, a feed price in
// nectar instead of rounds out, and a score that is the time-average of F × B.

/** The game's prevalence settings, or null when it draws species uniformly. */
export function prevalenceOf(config) {
  const p = config?.prevalence;
  if (!p || p.on !== true) return null;
  return { basis: p.basis ?? "pollination", halfLifeS: p.halfLifeS ?? 90, cStart: p.cStart ?? 1, cEnd: p.cEnd ?? 0.1, prior: p.prior ?? null, cap: p.cap ?? 4 };
}

/** c at game time t (ms) of a game lasting durationMs: linear from cStart to cEnd. */
export function cAt(config, tMs, durationMs) {
  const p = prevalenceOf(config);
  if (!p) return null;
  const x = durationMs > 0 ? Math.min(1, Math.max(0, tMs / durationMs)) : 0;
  return p.cStart + (p.cEnd - p.cStart) * x;
}

/** The least p_s can be at time t among N species (P_s = 0, uncapped): c / (N (c + 1)). */
export function floorAt(config, tMs, durationMs, n) {
  const c = cAt(config, tMs, durationMs);
  return c == null || !n ? null : c / (n * (c + 1));
}

/** One published sample as { atMs, team (id or index), p, P, side }: a query row ({ round, atMs, team, p, success, c })
 * or a sample's species entry. side: "flower", or "bee" for the bee side (coop-eq; provisional field names). */
export function sampleOf(row) {
  if (!row || typeof row !== "object") return null;
  const atMs = Number(row.atMs ?? row.at_ms ?? row.clockMs ?? NaN);
  const team = row.team ?? row.teamId ?? row.species ?? row.index ?? null;
  const p = Number(row.p ?? row.p_s ?? NaN), P = Number(row.P ?? row.success ?? row.P_s ?? NaN);
  const side = row.side ?? row.kind ?? "flower";
  return Number.isFinite(atMs) && team != null && Number.isFinite(p) ? { atMs, team, p, P: Number.isFinite(P) ? P : null, side } : null;
}

/** Samples from published rows: query rows, or whole samples ({ atMs, species: [...], bees?: [...] }). */
export function samplesOf(rows) {
  const out = [];
  for (const r of rows || []) {
    const at = r?.atMs ?? r?.at_ms;
    if (Array.isArray(r?.species) || Array.isArray(r?.bees)) {
      for (const x of r.species || []) { const s = sampleOf({ atMs: at, ...x, side: "flower" }); if (s) out.push(s); }
      for (const x of r.bees || []) { const s = sampleOf({ atMs: at, ...x, side: "bee" }); if (s) out.push(s); }
    } else { const s = sampleOf(r); if (s) out.push(s); }
  }
  return out;
}

/** The game view's latest prevalence sample: [{ team, p, P, side }] (null when the view carries none). */
export function currentOf(view) {
  const raw = view?.prevalence ?? view?.game?.prevalence ?? null;
  if (!raw) return null;
  return samplesOf([{ atMs: raw.atMs ?? 0, species: raw.species || [], bees: raw.bees || [] }]);
}

/** coop-eq's rules from the game's config (PROVISIONAL keys until the engine reports them): { bees (bee prevalence:
 * its basis, or null), perRound (bees drawn a round, as text), price (the feed price: its share of the most E, or its
 * amount), timeAverage (the score is the time-average of F × B) }. */
export function coopRules(config) {
  const b = config?.prevalence?.bees;
  const fp = config?.feedPrice ?? null;
  return {
    bees: b && b.on !== false ? { basis: b.basis ?? "net nectar", halfLifeS: b.halfLifeS ?? config?.prevalence?.halfLifeS ?? 90 } : null,
    perRound: b?.perRound ?? (b ? "⌈N/4⌉" : null),
    price: fp ? { share: fp.share ?? null, amount: fp.amount ?? null } : null,
    timeAverage: config?.scoring?.mode === "prevalence",
  };
}

/** The rule in a paragraph, for the timing brief (empty for a game without prevalence). */
export function prevalenceText(config) {
  const p = prevalenceOf(config);
  if (!p) return "";
  const basis = p.basis === "pollination" ? `(the pollen it gave each bee team lately)^β, summed over bee teams` : p.basis === "feeds" ? "the feeds it got lately" : `its recent ${p.basis}`;
  const co = coopRules(config);
  const bees = co.bees ? `
  Bee prevalence works the same way: each round's bees are drawn with probability (c + B_b) / Σ_k (c + B_k), where B_b is
  the bee team's recent success (its recent ${co.bees.basis}, par 1, halving every ${co.bees.halfLifeS} s).` : "";
  const score = co.timeAverage ? `
  Your score is the time-average over the game of F × B: your species' flower success times your bee's success.` : "";
  return `- Species prevalence: a turn's flower is of species s with probability p_s = (c + P_s) / Σ_k (c + P_k), where P_s is
  its recent success on a par-1 scale (N × its share of ${basis}, fading by half every ${p.halfLifeS} s of game time,
  capped at ${p.cap}) and c runs from ${p.cStart} to ${p.cEnd} over the game.${bees}${score} Every p_s and P_s is public, about
  once a second: tools/status.py, garden.status(), garden.prevalence(), the scoreboard and the history queries
  (garden.game.prevalence). Programs never see them.`;
}
