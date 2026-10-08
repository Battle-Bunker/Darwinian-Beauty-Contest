// How a game's signalling ecosystem moves within the game, from its turns and the labels of its program versions
// (lib/mechanisms.js). Pure computation; cohorts.js gives it each finished game.
//   windows    per window of game time: the mechanisms in use (each species counted once, by the version that took most
//              of its turns), their entropy (bits), the dominant mechanism and species (the most nectar given to rival
//              bees: where the nectar is earned; feeds when there's no nectar), the
//              mean sophistication level of the flowers and bees playing, and what appeared for the first time
//   innovation tokens (a mechanism, a signal family, a bee check) first seen in the cohort, with when; per window
//   turnover   how often the dominant mechanism, and the dominant species, changed hands from one window to the next
//   families   signal families (signature, keyed, puzzle, commitment) in use, by how many species
//   signals    the specific signals in use (the classifier's short names, e.g. "graceful-labeling", "clique"), by how
//              many species; per window their entropy; signatureWork: species combining a signature with costly work
//   frozen     the last three windows have one mechanism (entropy ≤ 0.2 bits) and nothing new
// Turns: [{ atMs, bee, flower (team ids), action, nectar, flowerVersion, beeVersion }] in game order.

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const mean = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/** Shannon entropy (bits) of the counts in an object or Map. */
export function entropy(counts) {
  const xs = [...(counts instanceof Map ? counts.values() : Object.values(counts))].filter((x) => x > 0);
  const n = xs.reduce((a, b) => a + b, 0);
  return n ? -xs.reduce((a, x) => a + (x / n) * Math.log2(x / n), 0) : 0;
}

/** The tokens a version's label stands for: its mechanism and signal families (flowers), its check (bees). Uncertain
 * keyword evidence ("keyed?") isn't a token. */
export function tokensOf(kind, label) {
  if (!label) return [];
  const clean = (x) => x && x !== "?" && !String(x).endsWith("?");
  if (kind === "bee") return clean(label.checks) && label.checks !== "none" ? [`check:${label.checks}`] : [];
  return [clean(label.mechanism) ? `mechanism:${label.mechanism}` : null, ...(label.families || []).filter(clean).map((f) => `family:${f}`),
    clean(label.signal) ? `signal:${label.signal}` : null].filter(Boolean);
}

/**
 * flowerLabel(team, version) -> { mechanism, families, level }; beeLabel(team, version) -> { checks, level }.
 * seen: tokens already seen in the cohort (earlier games); updated with this game's.
 */
export function dynamics({ turns, ids, flowerLabel, beeLabel, windowMs, durationMs = null, seen = new Set() }) {
  const W = windowMs;
  const end = Math.max(durationMs || 0, ...turns.map((t) => t.atMs + 1));
  const n = Math.max(1, Math.ceil(end / W));
  const wins = Array.from({ length: n }, (_, i) => ({ from: i * W, turns: [], newTokens: [] }));
  for (const t of turns) wins[Math.min(n - 1, Math.floor(t.atMs / W))].turns.push(t);

  // First appearances: a version's tokens appear with its first turn.
  const firstAt = new Map(); // token -> atMs
  const versionSeen = new Set();
  for (const t of turns) {
    for (const [kind, team, v, label] of [["flower", t.flower, t.flowerVersion, () => flowerLabel(t.flower, t.flowerVersion)], ["bee", t.bee, t.beeVersion, () => beeLabel(t.bee, t.beeVersion)]]) {
      const k = `${kind}:${team}:${v}`;
      if (v == null || versionSeen.has(k)) continue;
      versionSeen.add(k);
      for (const tok of tokensOf(kind, label())) if (!firstAt.has(tok)) firstAt.set(tok, t.atMs);
    }
  }
  const innovations = [...firstAt.entries()].filter(([tok]) => !seen.has(tok)).map(([token, atMs]) => ({ token, atMs })).sort((a, b) => a.atMs - b.atMs);
  for (const x of innovations) wins[Math.min(n - 1, Math.floor(x.atMs / W))].newTokens.push(x.token);
  for (const tok of firstAt.keys()) seen.add(tok);

  const majority = (ts, key) => { const c = new Map(); for (const t of ts) c.set(key(t), (c.get(key(t)) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const windows = wins.map((w) => {
    const mechs = new Map(), sigs = new Map(), levels = [], beeLevels = [];
    for (const id of ids) {
      const at = w.turns.filter((t) => t.flower === id), by = w.turns.filter((t) => t.bee === id);
      if (at.length) {
        const v = majority(at, (t) => t.flowerVersion), l = flowerLabel(id, v);
        const m = l?.mechanism ?? "?";
        mechs.set(m, (mechs.get(m) || 0) + 1);
        if (l?.signal && !String(l.signal).endsWith("?")) sigs.set(l.signal, (sigs.get(l.signal) || 0) + 1);
        levels.push(l?.level ?? null);
      }
      if (by.length) beeLevels.push(beeLabel(id, majority(by, (t) => t.beeVersion))?.level ?? null);
    }
    // Dominance: the mechanism and the species whose flowers gave rival bees (not their own) the most nectar.
    const rivalFeeds = w.turns.filter((t) => t.action === "feed" && t.bee !== t.flower);
    const byMech = new Map(), bySpecies = new Map();
    let total = 0;
    for (const t of rivalFeeds) {
      const m = flowerLabel(t.flower, t.flowerVersion)?.mechanism ?? "?", x = Number.isFinite(t.nectar) ? t.nectar : 1;
      total += x;
      byMech.set(m, (byMech.get(m) || 0) + x);
      bySpecies.set(t.flower, (bySpecies.get(t.flower) || 0) + x);
    }
    const top = (map) => { const e = [...map.entries()].sort((a, b) => b[1] - a[1])[0]; return e && total > 0 ? { key: e[0], share: r3(e[1] / total) } : null; };
    return { from: w.from, turns: w.turns.length, mechanisms: Object.fromEntries(mechs), entropy: r3(entropy(mechs)), signals: Object.fromEntries(sigs), signalEntropy: r3(entropy(sigs)), dominantMechanism: top(byMech), dominantSpecies: top(bySpecies),
      meanFlowerLevel: r3(mean(levels)), meanBeeLevel: r3(mean(beeLevels)), newTokens: w.newTokens };
  }).filter((w, i, all) => w.turns || i < all.length - 1);

  const changes = (key) => { let c = 0, prev = null; for (const w of windows) { const k = key(w); if (k == null) continue; if (prev != null && k !== prev) c++; prev = k; } return c; };
  const families = {};
  for (const id of ids) {
    const used = new Set();
    // Uncertain keyword evidence ("keyed?") is counted under its own name, so a keyword-only analysis still shows it.
    for (const t of turns) if (t.flower === id) for (const f of flowerLabel(id, t.flowerVersion)?.families || []) if (f && f !== "?") used.add(f);
    for (const f of used) families[f] = (families[f] || 0) + 1;
  }
  // Specific signals (by species), and species combining a signature with costly work (some version of theirs).
  const signals = {};
  let signatureWork = 0;
  for (const id of ids) {
    const used = new Set();
    let combo = false;
    for (const t of turns) {
      if (t.flower !== id) continue;
      const l = flowerLabel(id, t.flowerVersion);
      if (l?.signal && !String(l.signal).endsWith("?")) used.add(l.signal);
      // Work is costly work: a puzzle family or a costly mechanism (a keyed handshake is a secret, not work).
      const costly = (l?.families || []).includes("puzzle") || ["work-unchecked", "hash-pow", "sequential", "certificate", "anytime"].includes(l?.mechanism);
      if (l && ((l.tags || []).includes("signature-plus-work") || ((l.families || []).includes("signature") && costly))) combo = true;
    }
    for (const x of used) signals[x] = (signals[x] || 0) + 1;
    if (combo) signatureWork++;
  }
  const last3 = windows.slice(-3);
  return {
    windowMs: W, windows, innovations, newTokens: innovations.length,
    turnover: { mechanism: changes((w) => w.dominantMechanism?.key), species: changes((w) => w.dominantSpecies?.key) },
    entropyMean: r3(mean(windows.map((w) => w.entropy))), entropyEnd: windows.length ? windows[windows.length - 1].entropy : null,
    families, signals, signalsDistinct: Object.keys(signals).length, signalEntropyMean: r3(mean(windows.map((w) => w.signalEntropy))), signatureWork,
    frozen: last3.length === 3 && last3.every((w) => (w.entropy ?? 0) <= 0.2 && !w.newTokens.length),
  };
}
