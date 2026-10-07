// Ecology of a finished one-flower game, from its turns (lib/metrics.js calls these; pure computation, no labels):
//   energySplit     where each species' energy budget went: size, compute, nectar, pollen, lost (shares of cap × window)
//   percentOverTime each species' mean percent offered, per window of game time
//   imitation       signals (a species' flower version) and their first close copies by another species: exact or same
//                   shape answers to the same challenge, by a version that went live after the signal appeared; the lag
//   detection       per copy: the feeds the imitator got from rival bees before they told it apart from its model
//   rotation        key rotation: new versions of a species that answer the challenges it had answered before differently
//   predictions     cracking attempts: a species answering a challenge with exactly what another species answers to it
//                   later (before that species had ever answered it): it worked out the other's rule
//   autarky         per species: how much of its pollination comes from its own bee, and of its bee's nectar from its own
//                   species; collapse when most species live off themselves
// Turns: [{ atMs, round, bee, flower (team ids), action, c, r, percent, energy, nectar, pollen, ms, flowerVersion }],
// in game order; a response over 4 KB is a stand-in { $big: its hash, bytes, shape } (lib/metrics.js responseOf).

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x)) ?? "null";

/** A response's shape: for a graph, its node and edge counts, degree sequence and label types; else its type and size. */
export function shapeOf(r) {
  if (r === null || r === undefined) return "null";
  // A response over 4 KB stands in as { $big: hash, bytes, shape } (lib/metrics.js): its shape if it was fetched, else
  // its hash (so it matches only the same response).
  if (typeof r === "object" && !Array.isArray(r) && typeof r.$big === "string") return r.shape ?? `big:${r.$big}`;
  if (typeof r === "object" && !Array.isArray(r) && Number.isFinite(r.nodes) && Array.isArray(r.edges)) {
    const deg = new Array(Math.min(r.nodes, 4096)).fill(0);
    for (const e of r.edges) if (Array.isArray(e)) for (const x of e) if (x >= 0 && x < deg.length) deg[x]++;
    const labels = Array.isArray(r.labels) ? [...new Set(r.labels.map((x) => (Array.isArray(x) ? "list" : x === null ? "null" : typeof x)))].sort().join("+") : "-";
    return `graph:${r.nodes}:${r.edges.length}:${deg.sort((a, b) => b - a).join(",")}:${labels}:${"edgeLabels" in r ? "el" : ""}`;
  }
  if (Array.isArray(r)) return `list:${r.length}`;
  if (typeof r === "string") return `str:${r.length}`;
  return typeof r;
}

/** Where each species' energy went. Per turn the budget is cap × window (node·ms): size × (window − ms) goes to its
 * size, cap × ms to compute, (cap − size) × (window − R) is short (the call's hidden budget R below the window), and
 * the rest, E, to nectar and pollen on a feed or is lost otherwise (a failed answer loses it all). */
export function energySplit(turns, ids, { sizeOf, cap, windowMs }) {
  const out = {};
  for (const id of ids) {
    const s = { turns: 0, budget: 0, size: 0, compute: 0, short: 0, nectar: 0, pollen: 0, lost: 0 };
    for (const t of turns) {
      if (t.flower !== id) continue;
      const size = sizeOf.get(`${id}:${t.flowerVersion}`) ?? 0, ms = Math.min(windowMs, Math.max(0, t.ms ?? 0)), budget = cap * windowMs;
      s.turns++; s.budget += budget;
      s.size += size * (windowMs - ms);
      s.compute += cap * ms;
      // The call's hidden budget R (when the game has one): (cap − size) × (window − R) of the budget was never there.
      const R = Number.isFinite(t.R) ? Math.min(windowMs, Math.max(ms, t.R)) : windowMs;
      s.short += Math.max(0, (cap - size) * (windowMs - R));
      const e = Math.max(0, (cap - size) * (R - ms));
      if (t.action === "feed" && t.r != null) { s.nectar += t.nectar || 0; s.pollen += t.pollen || 0; } else s.lost += t.r == null ? e : (t.energy ?? e);
    }
    const sh = (x) => r3(s.budget ? x / s.budget : null);
    out[id] = { turns: s.turns, size: sh(s.size), compute: sh(s.compute), short: sh(s.short), nectar: sh(s.nectar), pollen: sh(s.pollen), lost: sh(s.lost) };
  }
  return out;
}

/** Each species' mean percent offered (answered turns), per window. */
export function percentOverTime(turns, ids, W) {
  const n = Math.max(1, Math.ceil(Math.max(0, ...turns.map((t) => t.atMs)) / W + 1e-9));
  return ids.map((id) => ({ teamId: id, byWindow: Array.from({ length: n }, (_, i) => r3(mean(turns.filter((t) => t.flower === id && t.percent != null && t.r != null && Math.floor(t.atMs / W) === i).map((t) => t.percent)))) }));
}

/**
 * Imitation: a signal is a species' flower version; its first appearance is its first answer. A close copy is a later
 * answer by another species to a challenge the signal had answered, from a version that went live after the signal
 * appeared (so it can't be a coincidence of rules written in the lobby), equal to the signal's answer exactly, or in
 * shape when that shape is new for the copier (none of its earlier versions gave it) and so not just a shape every
 * species uses. Returns the copies, the lag of each copied signal (first appearance to first close copy) and, per copy,
 * its detection window.
 */
export function imitation(turns, ids, { liveAt }) {
  const firstSeen = new Map(); // `${team}:${version}` -> atMs
  const byChallenge = new Map(); // canon(c) -> [{ team, version, atMs, exact, shape }]
  const copies = new Map(); // `${copier}:${copierVersion}<-${model}:${modelVersion}` -> event
  const shapesBy = new Map(); // `${team}:${version}` -> Set(shape)
  const shapeNewFor = (team, version, shape) => {
    for (const [k, set] of shapesBy) { const [tm, v] = k.split(":"); if (tm === String(team) && String(v) !== String(version) && set.has(shape)) return false; }
    return true;
  };
  for (const t of turns) {
    if (t.r == null) continue;
    const sig = `${t.flower}:${t.flowerVersion}`;
    if (!firstSeen.has(sig)) firstSeen.set(sig, t.atMs);
    const c = canon(t.c), exact = canon(t.r), shape = shapeOf(t.r);
    if (!shapesBy.has(sig)) shapesBy.set(sig, new Set());
    const newShape = shapeNewFor(t.flower, t.flowerVersion, shape);
    shapesBy.get(sig).add(shape);
    let list = byChallenge.get(c);
    if (!list) byChallenge.set(c, (list = []));
    const liveFrom = liveAt.get(`${t.flower}:flower:${t.flowerVersion}`) ?? 0;
    // Its own earlier answer to this challenge, given back: not a copy of anyone (even if another species copied it).
    const ownBefore = list.some((x) => x.team === t.flower && x.exact === exact);
    for (const x of ownBefore ? [] : list) {
      if (x.team === t.flower || (x.exact !== exact && (x.shape !== shape || !newShape))) continue;
      const appeared = firstSeen.get(`${x.team}:${x.version}`) ?? x.atMs;
      if (liveFrom <= appeared) continue; // the copier's version was already live: convergence, not a copy
      const k = `${sig}<-${x.team}:${x.version}`;
      if (!copies.has(k)) copies.set(k, { copier: t.flower, copierVersion: t.flowerVersion, model: x.team, modelVersion: x.version, exact: x.exact === exact,
        atMs: t.atMs, signalAppearedMs: appeared, lagMs: t.atMs - appeared });
      else if (x.exact === exact) copies.get(k).exact = true;
      break;
    }
    if (!list.some((x) => x.team === t.flower && x.version === t.flowerVersion && x.exact === exact)) list.push({ team: t.flower, version: t.flowerVersion, atMs: t.atMs, exact, shape });
  }
  const events = [...copies.values()].sort((a, b) => a.atMs - b.atMs);
  // The lag of each copied signal: from its first appearance to its first close copy.
  const lags = new Map();
  for (const e of events) { const k = `${e.model}:${e.modelVersion}`; if (!lags.has(k)) lags.set(k, e); }
  for (const e of events) e.detection = detection(turns, e);
  return { copies: events, signalsCopied: lags.size, medianLagMs: median([...lags.values()].map((e) => e.lagMs)),
    lags: [...lags.values()].map((e) => ({ model: e.model, modelVersion: e.modelVersion, by: e.copier, lagMs: e.lagMs, exact: e.exact })) };
}

/** From a copy on: rival bees' (neither the copier's nor the model's) feed rate at the copier vs at the model, over the
 * last 10 turns at each. Detected when the copier's falls below half the model's (both with 10 turns); the feeds the
 * copier got from rival bees until then (or until the end). */
function detection(turns, e) {
  const rival = (t) => t.bee !== e.copier && t.bee !== e.model && t.atMs >= e.atMs;
  const atCopier = [], atModel = [];
  let feeds = 0, detectedMs = null;
  for (const t of turns) {
    if (!rival(t)) continue;
    if (t.flower === e.copier && t.flowerVersion === e.copierVersion) { atCopier.push(t.action === "feed" ? 1 : 0); if (t.action === "feed") feeds++; }
    else if (t.flower === e.model) atModel.push(t.action === "feed" ? 1 : 0);
    else continue;
    if (atCopier.length >= 10 && atModel.length >= 10) {
      const rc = mean(atCopier.slice(-10)), rm = mean(atModel.slice(-10));
      if (rm > 0 && rc < 0.5 * rm) { detectedMs = t.atMs; break; }
    }
  }
  return { detected: detectedMs != null, afterMs: detectedMs != null ? detectedMs - e.atMs : null, rivalFeedsBefore: feeds, rivalTurnsAtCopier: atCopier.length };
}

/** Key rotation: a new version of a species whose answers to challenges it had answered before differ for most of them
 * (at least half, over at least 3 such challenges). */
export function rotation(turns, ids) {
  const out = [];
  for (const id of ids) {
    const answers = new Map(); // version -> Map(canon(c) -> canon(r))
    const order = [];
    for (const t of turns) {
      if (t.flower !== id || t.r == null) continue;
      if (!answers.has(t.flowerVersion)) { answers.set(t.flowerVersion, new Map()); order.push({ version: t.flowerVersion, atMs: t.atMs }); }
      const m = answers.get(t.flowerVersion), c = canon(t.c);
      if (!m.has(c)) m.set(c, canon(t.r));
    }
    for (let i = 1; i < order.length; i++) {
      const before = new Map(), now = answers.get(order[i].version);
      for (let j = 0; j < i; j++) for (const [c, r] of answers.get(order[j].version)) before.set(c, r);
      const shared = [...now.keys()].filter((c) => before.has(c));
      const changed = shared.filter((c) => before.get(c) !== now.get(c)).length;
      if (shared.length >= 3 && changed / shared.length >= 0.5) out.push({ teamId: id, version: order[i].version, atMs: order[i].atMs, shared: shared.length, changed });
    }
  }
  return out;
}

/** Cracking: species B answers challenge c with exactly what species A answers to c, before A had ever answered c, from
 * a version that went live after A's answering version first appeared (so B changed after seeing A: not two rules that
 * happened to agree from the lobby on). */
export function predictions(turns, { liveAt = new Map() } = {}) {
  const answered = new Map(); // `${team}|${c}` -> canon(r) (first answer)
  const early = []; // { team, version, c, r, atMs }
  const firstSeen = new Map();
  for (const t of turns) {
    if (t.r == null) continue;
    const sig = `${t.flower}:${t.flowerVersion}`;
    if (!firstSeen.has(sig)) firstSeen.set(sig, t.atMs);
    const c = canon(t.c), k = `${t.flower}|${c}`;
    if (!answered.has(k)) { answered.set(k, canon(t.r)); early.push({ team: t.flower, version: t.flowerVersion, c, r: canon(t.r), atMs: t.atMs }); }
  }
  const firstBy = new Map(); // c -> [{ team, r, atMs }] in time order
  for (const x of early) { if (!firstBy.has(x.c)) firstBy.set(x.c, []); firstBy.get(x.c).push(x); }
  const pairs = new Map();
  for (const list of firstBy.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; // a answered first; b (another species) answered the same later
      if (a.team === b.team || a.r !== b.r) continue;
      const predictorLive = liveAt.get(`${a.team}:flower:${a.version}`) ?? 0, targetAppeared = firstSeen.get(`${b.team}:${b.version}`) ?? b.atMs;
      if (predictorLive <= targetAppeared && liveAt.size) continue; // not after the target's rule appeared: convergence
      const k = `${a.team}>${b.team}`; // a predicted b's answer
      const p = pairs.get(k) || { predictor: a.team, target: b.team, n: 0, firstMs: a.atMs };
      p.n++; pairs.set(k, p);
    }
  }
  return [...pairs.values()].sort((x, y) => y.n - x.n);
}

/** Autarky: how much each species lives off itself (its own bee's feeds). Collapse when most species get most of their
 * pollen from their own bee, or most bees most of their nectar from their own species. */
export function autarky(turns, ids) {
  const fed = turns.filter((t) => t.action === "feed");
  const per = ids.map((id) => {
    const at = fed.filter((t) => t.flower === id), by = fed.filter((t) => t.bee === id);
    const pollen = at.reduce((a, t) => a + (t.pollen || 0), 0), ownPollen = at.filter((t) => t.bee === id).reduce((a, t) => a + (t.pollen || 0), 0);
    const nectar = by.reduce((a, t) => a + (t.nectar || 0), 0), ownNectar = by.filter((t) => t.flower === id).reduce((a, t) => a + (t.nectar || 0), 0);
    return { teamId: id, ownPollenShare: r3(pollen ? ownPollen / pollen : null), ownNectarShare: r3(nectar ? ownNectar / nectar : null) };
  });
  const autarkic = per.filter((x) => (x.ownPollenShare ?? 0) > 0.5 || (x.ownNectarShare ?? 0) > 0.5).length;
  return { teams: per, autarkic, collapse: ids.length > 1 && autarkic > ids.length / 2 };
}
