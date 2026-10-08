// Species prevalence (adapt-hi): each bee visit draws a flower species with probability p_s = (c + P_s) / (N (c + 1)),
// where P_s is the species' recent pollination success on a par-1 scale (N × its share of Σ over bee teams of the
// exponentially decayed pollen it got from them, ^beta; a half-life of 60 s of game time) and c falls linearly over the
// game from cStart (1) to cEnd (0.1). Games whose config has no `prevalence` (or prevalence.on false) draw uniformly.
// Every species' p_s and P_s are public, about once a second; programs never see them.
// The engine owns the mechanic; this module reads its config and its published samples in one place, so the arena's
// briefs, tools and analyses follow the game's own values (and a change of the samples' shape is one change here).

/** The game's prevalence settings, or null when it draws species uniformly. */
export function prevalenceOf(config) {
  const p = config?.prevalence;
  if (!p || p.on !== true) return null;
  return { basis: p.basis ?? "pollination", halfLifeS: p.halfLifeS ?? 60, cStart: p.cStart ?? 1, cEnd: p.cEnd ?? 0.1 };
}

/** c at game time t (ms) of a game lasting durationMs: linear from cStart to cEnd. */
export function cAt(config, tMs, durationMs) {
  const p = prevalenceOf(config);
  if (!p) return null;
  const x = durationMs > 0 ? Math.min(1, Math.max(0, tMs / durationMs)) : 0;
  return p.cStart + (p.cEnd - p.cStart) * x;
}

/** The least p_s can be at time t among N species (P_s = 0): c / (N (c + 1)). */
export function floorAt(config, tMs, durationMs, n) {
  const c = cAt(config, tMs, durationMs);
  return c == null || !n ? null : c / (n * (c + 1));
}

/** One published sample as { atMs, team (id or index), p, P }, whatever the field names the engine settles on. */
export function sampleOf(row) {
  if (!row || typeof row !== "object") return null;
  const atMs = Number(row.atMs ?? row.at_ms ?? row.clockMs ?? row.t ?? NaN);
  const team = row.teamId ?? row.team ?? row.species ?? row.flower ?? row.index ?? null;
  const p = Number(row.p ?? row.p_s ?? row.prob ?? row.probability ?? NaN), P = Number(row.P ?? row.P_s ?? row.success ?? NaN);
  return Number.isFinite(atMs) && team != null && Number.isFinite(p) ? { atMs, team, p, P: Number.isFinite(P) ? P : null } : null;
}

/** Samples from a list of published rows; a row may carry every species at once ({ atMs, species: [{ team, p, P }] }). */
export function samplesOf(rows) {
  const out = [];
  for (const r of rows || []) {
    const many = Array.isArray(r?.species) ? r.species : Array.isArray(r?.prevalence) ? r.prevalence : null;
    if (many) for (const x of many) { const s = sampleOf({ atMs: r.atMs ?? r.at_ms ?? r.clockMs, ...x }); if (s) out.push(s); }
    else { const s = sampleOf(r); if (s) out.push(s); }
  }
  return out;
}

/** The game view's current prevalence: [{ team, p, P }] (or null when the view carries none). */
export function currentOf(view) {
  const raw = view?.prevalence ?? view?.game?.prevalence ?? null;
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.species) ? raw.species
    : Object.entries(raw).map(([team, v]) => (typeof v === "object" ? { team, ...v } : { team, p: v }));
  return list.map((x) => sampleOf({ atMs: 0, ...x })).filter(Boolean);
}

/** The rule in one paragraph, for the timing brief (empty for a game without prevalence). */
export function prevalenceText(config) {
  const p = prevalenceOf(config);
  if (!p) return "";
  return `- Species prevalence: a turn's species is drawn with probability p_s = (c + P_s) / (N (c + 1)), where P_s is the species'
  recent ${p.basis} success (N × its share of the ${p.basis} of the last minutes, decayed with a half-life of ${p.halfLifeS} s of game
  time) and c falls from ${p.cStart} to ${p.cEnd} over the game. Every species' p_s and P_s are public, about once a second: in
  tools/status.py, garden.status(), the action stream and the history queries. Programs never see them.`;
}
