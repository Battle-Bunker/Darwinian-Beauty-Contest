// Metrics per round / game / generation, and collapse detection. Computed from the revealed game view
// (finished game, revealOnFinish), which has every visit's flower kind, every challenge/response and all code.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : null; };
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

export function gini(a) {
  const v = a.filter((x) => x >= 0).sort((x, y) => x - y);
  const n = v.length, s = v.reduce((p, x) => p + x, 0);
  if (!n || !s) return 0;
  return v.reduce((acc, x, i) => acc + (2 * (i + 1) - n - 1) * x, 0) / (n * s);
}

/** Kendall tau-b between two score vectors (same team order). 1 = same order, -1 = reversed. */
export function kendall(a, b) {
  let c = 0, d = 0, ta = 0, tb = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    const x = Math.sign(a[i] - a[j]), y = Math.sign(b[i] - b[j]);
    if (x === 0 && y === 0) continue;
    if (x === 0) ta++; else if (y === 0) tb++; else if (x === y) c++; else d++;
  }
  const den = Math.sqrt((c + d + ta) * (c + d + tb));
  return den ? (c - d) / den : null;
}

export function spearman(a, b) {
  const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rank(a), rb = rank(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

function entropy(counts) {
  const tot = counts.reduce((s, x) => s + x, 0);
  return tot ? -counts.reduce((s, x) => (x ? s + (x / tot) * Math.log2(x / tot) : s), 0) : 0;
}

// Code similarity: token trigram Jaccard on comment-stripped code.
function tokens(code, lang) {
  const noComments = lang === "typescript" ? code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "") : code.replace(/#.*$/gm, "");
  return noComments.match(/[A-Za-z_]\w*|\d+|\S/g) || [];
}
function trigrams(toks) { const s = new Set(); for (let i = 0; i + 2 < toks.length; i++) s.add(toks[i] + "\u0001" + toks[i + 1] + "\u0001" + toks[i + 2]); return s; }
export function jaccard(a, b) { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); }

const SUSPICIOUS = /__subclasses__|__globals__|__builtins__|__class__|__bases__|__mro__|__code__|__import__|\beval\s*\(|\bexec\s*\(|\bcompile\s*\(|\bglobals\s*\(|\bgetattr\s*\(|\bsetattr\s*\(|\bimport\s+(os|sys|subprocess|socket|ctypes)\b|\bprocess\.|\brequire\s*\(|\bFunction\s*\(|\bconstructor\b|globalThis/;

export function roundMetrics(view, round, prev) {
  const ids = view.participants, n = ids.length, lang = view.game.config.language;
  const V = round.visits;
  const feeds = V.filter((v) => v.action === "feed");
  const nectar = feeds.filter((v) => v.nectar);
  const perBeeFeeds = ids.map((id) => feeds.filter((v) => v.bee === id).length);
  const perBeeNectar = ids.map((id) => nectar.filter((v) => v.bee === id).length);
  const cloverVisits = V.filter((v) => v.kind === "clover"), orchidVisits = V.filter((v) => v.kind === "orchid");
  const orchidFeeds = feeds.filter((v) => v.kind === "orchid");
  const steps = V.flatMap((v) => v.steps || []);
  const errorVisits = V.filter((v) => v.action === "error");
  const timeouts = V.filter((v) => /took too long|Timeout/i.test(v.beeError || "")).length + steps.filter((s) => /took too long|Timeout/i.test(s.flowerError || "")).length;

  // Signalling: what bees ask first, and how clovers/orchids answer.
  const firstC = {};
  for (const v of V) if (v.steps?.length) { const k = JSON.stringify(v.steps[0].c); firstC[k] = (firstC[k] || 0) + 1; }
  const firstCounts = Object.values(firstC);
  const totalFirst = firstCounts.reduce((s, x) => s + x, 0);
  // responses[team][kind][challengeKey] = responseKey
  const resp = {};
  for (const v of V) for (const s of v.steps || []) {
    if (s.r === null || s.r === undefined) continue;
    ((resp[v.patch] ||= {})[v.kind] ||= {})[JSON.stringify(s.c)] = JSON.stringify(s.r);
  }
  let agreePairs = 0, totPairs = 0;
  const byChallenge = {};
  for (const t of ids) for (const [c, r] of Object.entries(resp[t]?.clover || {})) (byChallenge[c] ||= []).push(r);
  for (const rs of Object.values(byChallenge)) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { totPairs++; if (rs[i] === rs[j]) agreePairs++; }
  const selfMimic = [];
  let crossHit = 0, crossTot = 0;
  for (const t of ids) {
    const o = resp[t]?.orchid || {}, cl = resp[t]?.clover || {};
    const shared = Object.keys(o).filter((c) => c in cl);
    if (shared.length) selfMimic.push(shared.filter((c) => o[c] === cl[c]).length / shared.length);
    for (const [c, r] of Object.entries(o)) {
      const others = ids.filter((u) => u !== t && resp[u]?.clover?.[c] !== undefined).map((u) => resp[u].clover[c]);
      if (others.length) { crossTot++; if (others.includes(r)) crossHit++; }
    }
  }

  // Scores and ranks.
  const fit = ids.map((id) => round.scores.find((s) => s.teamId === id)?.fitness ?? 0);
  const sorted = [...fit].sort((a, b) => b - a);
  const prevFit = prev ? ids.map((id) => prev.scores.find((s) => s.teamId === id)?.fitness ?? 0) : null;
  const cum = ids.map((id) => round.totals.find((s) => s.teamId === id)?.fitness ?? 0);
  const prevCum = prev ? ids.map((id) => prev.totals.find((s) => s.teamId === id)?.fitness ?? 0) : null;

  // Code change volume and similarity.
  const cfg = view.game.config;
  const change = {}, similarity = {}, duplicates = {};
  let suspicious = [];
  for (const kind of ["clover", "orchid", "bee"]) {
    const progs = ids.map((id) => round.programs[id]?.[kind]).filter(Boolean);
    const dists = progs.map((p) => p.distance ?? 0);
    change[kind] = { total: dists.reduce((s, x) => s + x, 0), teamsChanged: progs.filter((p) => !p.carriedOver && (p.distance ?? 1) > 0).length, budgetUse: r3(mean(dists.map((d) => d / cfg.budgets[kind].changes))) };
    const codes = progs.map((p) => p.code || "");
    const tri = codes.map((c) => trigrams(tokens(c, lang)));
    const sims = [];
    for (let i = 0; i < tri.length; i++) for (let j = i + 1; j < tri.length; j++) sims.push(jaccard(tri[i], tri[j]));
    similarity[kind] = r3(mean(sims));
    const norm = codes.map((c) => tokens(c, lang).join(" "));
    duplicates[kind] = norm.length - new Set(norm).size;
    ids.forEach((id) => { const code = round.programs[id]?.[kind]?.code || ""; if (SUSPICIOUS.test(code)) suspicious.push({ team: id, kind, match: code.match(SUSPICIOUS)[0] }); });
  }
  // Orchid that is literally the team's own clover (after stripping comments).
  const orchidIsClover = ids.filter((id) => { const p = round.programs[id]; return p?.clover?.code && p?.orchid?.code && tokens(p.clover.code, lang).join(" ") === tokens(p.orchid.code, lang).join(" "); }).length;

  return {
    round: round.no, n,
    visits: V.length, feeds: feeds.length, nectar: nectar.length,
    precision: r3(feeds.length ? nectar.length / feeds.length : null),
    feedRate: r3(V.length ? feeds.length / V.length : 0),
    feedsPerBee: r3(feeds.length / n),
    beesNotFeeding: perBeeFeeds.filter((x) => x === 0).length,
    beesWithoutNectar: perBeeNectar.filter((x) => x === 0).length,
    perBeePrecision: perBeeFeeds.map((f, i) => (f ? r3(perBeeNectar[i] / f) : null)),
    asksPerVisit: r3(mean(V.map((v) => v.asks))),
    cloverVisitShare: r3(V.length ? cloverVisits.length / V.length : null),
    orchidFeedShare: r3(feeds.length ? orchidFeeds.length / feeds.length : null),
    orchidFedRate: r3(orchidVisits.length ? orchidFeeds.length / orchidVisits.length : null),
    cloverFedRate: r3(cloverVisits.length ? (feeds.length - orchidFeeds.length) / cloverVisits.length : null),
    selfFeedShare: r3(feeds.length ? feeds.filter((v) => v.bee === v.patch).length / feeds.length : null),
    errorRate: r3(V.length ? errorVisits.length / V.length : 0),
    flowerErrorRate: r3(steps.length ? steps.filter((s) => s.flowerError).length / steps.length : 0),
    timeouts,
    programProblems: ids.flatMap((id) => ["clover", "orchid", "bee"].filter((k) => round.programs[id]?.[k]?.problem).map((k) => ({ team: id, kind: k, problem: round.programs[id][k].problem.slice(0, 160) }))),
    challengeEntropy: r3(entropy(firstCounts)),
    distinctFirstChallenges: firstCounts.length,
    topChallengeShare: r3(totalFirst ? Math.max(...firstCounts) / totalFirst : null),
    cloverAgreement: r3(totPairs ? agreePairs / totPairs : null),
    orchidSelfMimicry: r3(mean(selfMimic)),
    orchidCrossMimicry: r3(crossTot ? crossHit / crossTot : null),
    orchidIsClover,
    fitness: fit.map(r3),
    fitnessStd: r3(std(fit)), fitnessGini: r3(gini(fit)),
    topRatio: r3(sorted[1] > 0 ? sorted[0] / sorted[1] : null),
    cumFitness: cum.map(r3),
    rankTau: r3(prevFit ? kendall(fit, prevFit) : null),
    cumRankTau: r3(prevCum ? kendall(cum, prevCum) : null),
    change, similarity, duplicates, suspicious,
  };
}

/** Collapse flags for one round. Each: { mode, severity 0..1, evidence }. */
export function roundCollapses(m, cfg) {
  const out = [];
  const add = (mode, severity, evidence) => out.push({ mode, round: m.round, severity: r3(Math.max(0, Math.min(1, severity))), evidence });
  // Bee strike: bees stop feeding.
  if (m.feedsPerBee < 2 || m.beesNotFeeding >= m.n / 2)
    add("bee-strike", Math.max(m.beesNotFeeding / m.n, 1 - m.feedsPerBee / 2), { feedsPerBee: m.feedsPerBee, beesNotFeeding: m.beesNotFeeding });
  // Blind trust: bees feed on (almost) everything, precision ~ clover share of visits.
  if (m.precision != null && m.feedRate > 0.5 && Math.abs(m.precision - m.cloverVisitShare) < 0.12)
    add("blind-trust", m.feedRate, { precision: m.precision, cloverVisitShare: m.cloverVisitShare, feedRate: m.feedRate });
  // Orchid extinction: orchids stop getting fed (they stopped deceiving, or bees learned perfectly).
  if (m.feeds >= m.n && m.orchidFeedShare != null && m.orchidFeedShare < 0.05)
    add("orchid-extinction", 1 - m.orchidFeedShare / 0.05, { orchidFeedShare: m.orchidFeedShare, orchidSelfMimicry: m.orchidSelfMimicry });
  // Mimic saturation: orchids answer exactly like their own clover, so questions carry no information.
  if (m.orchidSelfMimicry != null && m.orchidSelfMimicry > 0.9)
    add("mimic-saturation", m.orchidSelfMimicry, { orchidSelfMimicry: m.orchidSelfMimicry, orchidIsClover: m.orchidIsClover });
  // Convention lock-in: everyone asks the same question and clovers answer alike.
  if (m.topChallengeShare != null && m.topChallengeShare > 0.6 && (m.cloverAgreement ?? 0) > 0.4)
    add("convention-lock-in", (m.topChallengeShare + m.cloverAgreement) / 2, { topChallengeShare: m.topChallengeShare, cloverAgreement: m.cloverAgreement });
  // Stasis: ranks frozen and almost no code changes.
  const used = mean(["clover", "orchid", "bee"].map((k) => m.change[k].budgetUse ?? 0));
  const changedTeams = Math.max(...["clover", "orchid", "bee"].map((k) => m.change[k].teamsChanged));
  if (m.round > 1 && m.cumRankTau != null && m.cumRankTau >= 0.9 && (used < 0.15 || changedTeams <= m.n / 3))
    add("stasis", m.cumRankTau * (1 - used), { cumRankTau: m.cumRankTau, rankTau: m.rankTau, budgetUse: r3(used), changedTeams });
  // Self-dealing: bees mostly feed at their own patch.
  if (m.selfFeedShare != null && m.selfFeedShare > 0.4 && m.feeds >= m.n)
    add("self-dealing", m.selfFeedShare, { selfFeedShare: m.selfFeedShare });
  // Exploit / degenerate programs: errors, timeouts, suspicious code.
  if (m.errorRate > 0.15 || m.flowerErrorRate > 0.15 || m.timeouts > 10 || m.suspicious.length)
    add("exploit-or-degenerate", Math.max(m.errorRate, m.flowerErrorRate, Math.min(1, m.timeouts / 50), m.suspicious.length ? 0.5 : 0), { errorRate: m.errorRate, flowerErrorRate: m.flowerErrorRate, timeouts: m.timeouts, suspicious: m.suspicious.slice(0, 5) });
  // Fitness compression: no differentiation at all.
  if (m.fitnessStd != null && m.fitnessStd < 0.08)
    add("fitness-compression", 1 - m.fitnessStd / 0.08, { fitnessStd: m.fitnessStd });
  return out;
}

export function gameMetrics(view, rounds) {
  const ids = view.participants;
  const final = view.final || view.rounds[view.rounds.length - 1].totals;
  const fit = ids.map((id) => final.find((s) => s.teamId === id).fitness);
  const sorted = [...fit].sort((a, b) => b - a);
  const keys = ["precision", "feedRate", "feedsPerBee", "orchidFeedShare", "orchidSelfMimicry", "orchidCrossMimicry", "cloverAgreement", "topChallengeShare", "challengeEntropy", "asksPerVisit", "errorRate", "fitnessStd", "rankTau", "cumRankTau", "selfFeedShare"];
  const avg = Object.fromEntries(keys.map((k) => [k, r3(mean(rounds.map((r) => r[k]).filter((x) => x != null)))]));
  const sim = Object.fromEntries(["clover", "orchid", "bee"].map((k) => [k, r3(mean(rounds.map((r) => r.similarity[k]).filter((x) => x != null)))]));
  const lastSim = rounds[rounds.length - 1].similarity;
  const changeUse = Object.fromEntries(["clover", "orchid", "bee"].map((k) => [k, r3(mean(rounds.slice(1).map((r) => r.change[k].budgetUse ?? 0)))]));
  // Who led each round (by round score)?
  const leaders = rounds.map((r) => ids[r.fitness.indexOf(Math.max(...r.fitness))]);
  const leaderCounts = {};
  leaders.forEach((l) => (leaderCounts[l] = (leaderCounts[l] || 0) + 1));
  return {
    rounds: rounds.length, n: ids.length,
    finalFitness: Object.fromEntries(ids.map((id, i) => [id, r3(fit[i])])),
    winner: ids[fit.indexOf(sorted[0])], winnerFitness: r3(sorted[0]), secondFitness: r3(sorted[1]),
    topRatio: r3(sorted[1] > 0 ? sorted[0] / sorted[1] : null),
    fitnessStd: r3(std(fit)), fitnessGini: r3(gini(fit)),
    avg, similarity: sim, lastSimilarity: lastSim, changeUse,
    roundLeaders: leaders, topLeaderShare: r3(Math.max(...Object.values(leaderCounts)) / rounds.length),
  };
}

/** Game-level collapse flags from round metrics (persistent modes) and the game summary. */
export function gameCollapses(gm, rounds) {
  const flags = [];
  const per = rounds.map((r) => roundCollapses(r));
  const modes = {};
  per.flat().forEach((f) => (modes[f.mode] ||= []).push(f));
  for (const [mode, fs] of Object.entries(modes)) {
    const share = fs.length / rounds.length;
    // Persistent = present in at least half the rounds, or in the last two rounds.
    const lastTwo = rounds.length >= 2 && fs.some((f) => f.round === rounds.length) && fs.some((f) => f.round === rounds.length - 1);
    if (share >= 0.5 || lastTwo) flags.push({ mode, severity: r3(mean(fs.map((f) => f.severity)) * share), rounds: fs.map((f) => f.round), evidence: fs[fs.length - 1].evidence });
  }
  if (gm.topRatio != null && gm.topRatio >= 2) flags.push({ mode: "runaway-winner", severity: r3(Math.min(1, (gm.topRatio - 1) / 3)), evidence: { topRatio: gm.topRatio, winnerFitness: gm.winnerFitness } });
  if (gm.lastSimilarity.bee > 0.6 || gm.lastSimilarity.clover > 0.6) flags.push({ mode: "code-convergence", severity: r3(Math.max(gm.lastSimilarity.bee, gm.lastSimilarity.clover)), evidence: gm.lastSimilarity });
  return { perRound: per, game: flags };
}
