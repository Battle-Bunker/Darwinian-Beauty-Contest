// Whose clover does each orchid imitate? (adapted from analysis/orchid-targets.mjs)
// For a round, run every clover and orchid on the challenges bees actually asked that round, then classify
// each orchid by answer overlap (>= 50% of those challenges):
//   self       matches its own team's clover only
//   rival      matches exactly one other team's clover (and not its own)
//   convention matches the clovers of 2+ teams (e.g. its own and a rival's, when clovers share an answer rule)
//   none       matches no clover
// For tree/graph responses the same is done on structural features (size, depth, leaves, degrees, path
// lengths) as well as exact answers: an orchid can pass a bee's structural test without equal JSON.
// Also: do bees distrust victims' clovers? (fed rate at clovers imitated by a rival orchid vs the others)
import { tryFlower } from "../../server/engine.js";

const THRESH = 0.5;

function treeFeatures(t) {
  let size = 0, leaves = 0, depth = 0;
  const walk = (n, d) => { size++; depth = Math.max(depth, d); if (!n.children.length) leaves++; n.children.forEach((c) => walk(c, d + 1)); };
  walk(t, 1);
  return `size${size} depth${depth} leaves${leaves} root${JSON.stringify(t.value)} deg${t.children.length}`;
}
function graphFeatures(g, directed) {
  const adj = Array.from({ length: g.nodes }, () => []);
  for (const [a, b] of g.edges) { adj[a].push(b); if (!directed) adj[b].push(a); }
  const bfs = (s) => { const d = new Array(g.nodes).fill(-1); if (s >= g.nodes) return d; d[s] = 0; const qu = [s]; while (qu.length) { const x = qu.shift(); for (const y of adj[x]) if (d[y] < 0) { d[y] = d[x] + 1; qu.push(y); } } return d; };
  const d0 = bfs(0);
  let comps = 0; const seen = new Array(g.nodes).fill(false);
  for (let i = 0; i < g.nodes; i++) if (!seen[i]) { comps++; const st = [i]; seen[i] = true; while (st.length) { const x = st.pop(); for (const y of adj[x]) if (!seen[y]) { seen[y] = true; st.push(y); } } }
  return `n${g.nodes} m${g.edges.length} deg0:${adj[0]?.length ?? "-"} d01:${d0[1] ?? "-"} d0last:${d0[g.nodes - 1] ?? "-"} comps${comps}`;
}
export function features(v, responseType) {
  if (v === null || v === undefined) return null;
  if (/^tree/.test(responseType)) return treeFeatures(v);
  if (responseType === "graph" || responseType === "digraph") return graphFeatures(v, responseType === "digraph");
  return null;
}

const match = (a, b) => (a && b ? a.filter((x, i) => x !== null && x === b[i]).length / a.length : 0);

function classify(team, ids, ans) {
  const orch = ans[team]?.orchid;
  const own = match(orch, ans[team]?.clover);
  const rivals = ids.filter((u) => u !== team).map((u) => ({ team: u, m: match(orch, ans[u]?.clover) })).sort((x, y) => y.m - x.m);
  const hits = rivals.filter((r) => r.m >= THRESH);
  const category = (own >= THRESH && hits.length) || hits.length >= 2 ? "convention" : own >= THRESH ? "self" : hits.length === 1 ? "rival" : "none";
  return { own: +own.toFixed(3), bestRival: +(rivals[0]?.m ?? 0).toFixed(3), bestRivalTeam: rivals[0]?.team ?? null, rivalHits: hits.map((h) => h.team), category };
}

const BEE_STRUCT = /children|\bedges\b|\bnodes\b|\.edges|\.nodes|\["children"\]|\['children'\]/;
const BEE_EXACT = /json\.dumps\(|JSON\.stringify\(|\bstr\(\s*(?:r|resp|response|ans|answer|seen)|repr\(/;

export async function orchidTargets(view, round) {
  const config = view.game.config, ids = view.participants;
  const asked = [...new Map(round.visits.flatMap((v) => (v.steps || []).map((s) => [JSON.stringify(s.c), s.c]))).values()];
  const step = Math.max(1, Math.floor(asked.length / 40));
  const challenges = asked.filter((_, i) => i % step === 0).slice(0, 40);
  if (!challenges.length) return null;
  const structured = /tree|graph/.test(config.responseType);
  const ans = {}, feat = {};
  await Promise.all(ids.flatMap((team) => ["clover", "orchid"].map(async (kind) => {
    const code = round.programs[team]?.[kind]?.code;
    if (!code) return;
    const out = await tryFlower({ config, code, kind, challenges, nTeams: ids.length });
    const rs = (out.results || []).map((x) => (x.error ? null : x.r));
    (ans[team] ||= {})[kind] = rs.map((r) => (r === null || r === undefined ? null : JSON.stringify(r)));
    if (structured) (feat[team] ||= {})[kind] = rs.map((r) => { try { return features(r, config.responseType); } catch { return null; } });
  })));
  const perTeam = ids.map((team) => ({ team, ...classify(team, ids, ans), ...(structured ? { feature: classify(team, ids, feat) } : {}) }));
  const counts = { self: 0, rival: 0, convention: 0, none: 0 }, featCounts = { self: 0, rival: 0, convention: 0, none: 0 };
  perTeam.forEach((p) => { counts[p.category]++; if (p.feature) featCounts[p.feature.category]++; });

  // Victims: teams whose clover a rival orchid imitates. Do other teams' bees feed less at victims' clovers?
  const victims = new Set(perTeam.flatMap((p) => p.rivalHits));
  const fedRate = (team) => {
    const vs = round.visits.filter((v) => v.patch === team && v.kind === "clover" && v.bee !== team);
    return vs.length ? vs.filter((v) => v.action === "feed").length / vs.length : null;
  };
  const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(3) : null; };
  const victimFed = avg([...victims].map(fedRate)), otherFed = avg(ids.filter((t) => !victims.has(t)).map(fedRate));

  // Bees: structural tests vs exact-answer memory (heuristic on the code).
  const bees = ids.map((t) => round.programs[t]?.bee?.code || "");
  return {
    challenges: challenges.length, counts, ...(structured ? { featCounts } : {}), perTeam,
    victims: [...victims], victimCloverFedRate: victimFed, otherCloverFedRate: otherFed,
    beesStructural: structured ? bees.filter((c) => BEE_STRUCT.test(c)).length : null,
    beesExactKey: bees.filter((c) => BEE_EXACT.test(c)).length,
  };
}
