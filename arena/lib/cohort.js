// Cohort-experiment measures for analyze.js (read-only):
//  - shape census: the modal shape of each team's flower answers (graph[any]) as bees saw them, per round
//  - demo borrowing: how close each team's code got to the previous game's top-2 code (the only diffusion channel)
import { all, one } from "./db.js";

/** The game's own uuid and rounds for an arena game row. */
export async function gameRef(arenaId, generation) {
  const g = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [arenaId, generation]);
  if (!g) return null;
  const a = await one("SELECT * FROM arena.arenas WHERE id = $1", [arenaId]);
  const gg = await one(`SELECT gg.id, gg.rounds_played FROM games gg JOIN rooms rr ON rr.id = gg.room_id
                         WHERE gg.code LIKE $1 || '%' AND gg.prefix_len <= length($1) AND rr.code LIKE $2 || '%' AND rr.prefix_len <= length($2)`, [g.game_short_id, a.room_short_id]);
  if (!gg) return null;
  const ents = await all("SELECT e.team_id, e.fitness_rank, p.slug FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1 ORDER BY p.slug", [g.id]);
  return { row: g, uuid: gg.id, rounds: gg.rounds_played, ents };
}

/** Shape of one graph answer: star / path / tree / ring / ring+chords / dense / other, plus a label pattern. */
export function graphShape(r) {
  if (!r || typeof r !== "object" || !Array.isArray(r.edges) || !Number.isInteger(r.nodes)) return "?";
  const n = r.nodes, deg = Array(n).fill(0), set = new Set();
  for (const e of r.edges) { const [a, b] = e || []; if (a >= 0 && a < n && b >= 0 && b < n && a !== b) { const k = Math.min(a, b) + "-" + Math.max(a, b); if (!set.has(k)) { set.add(k); deg[a]++; deg[b]++; } } }
  const m = set.size, maxd = Math.max(0, ...deg);
  const ring = n >= 3 && [...Array(n).keys()].every((i) => set.has(Math.min(i, (i + 1) % n) + "-" + Math.max(i, (i + 1) % n)));
  let s;
  if (m === n - 1 && maxd === n - 1 && n > 2) s = "star";
  else if (m === n - 1 && maxd <= 2) s = "path";
  else if (m === n - 1) s = "tree";
  else if (ring && m === n) s = "ring";
  else if (ring) s = "ring+chords";
  else if (n > 3 && m >= (n * (n - 1)) / 4) s = "dense";
  else s = "other";
  const L = Array.isArray(r.labels) ? r.labels : [];
  if (L.length === n && L.every((x, i) => x === deg[i])) return s + "/degree";
  if (L.length === n && L.every((x, i) => x === i)) return s + "/index";
  if (s === "star" && L.length === n) {
    const hub = deg.indexOf(maxd);
    try { const prod = L.reduce((acc, x, i) => (i === hub ? acc : acc * BigInt(Math.trunc(Number(x)))), 1n); if (prod === BigInt(Math.abs(Math.trunc(Number(L[hub]))))) return s + "/factors"; } catch {}
  }
  return s;
}

/** Modal answer shapes per team for one round: { slug: "ring 80%, star" } */
export async function shapeCensus(G, roundNo, kind = "clover") {
  const vs = await all("SELECT patch_team, steps FROM visits WHERE game_id = $1 AND round_no = $2 AND kind = $3", [G.uuid, roundNo, kind]);
  const res = {};
  for (const e of G.ents) {
    const counts = {};
    for (const v of vs) if (v.patch_team === e.team_id) for (const s of v.steps || []) { const k = graphShape(s.r); counts[k] = (counts[k] || 0) + 1; }
    const tot = Object.values(counts).reduce((x, y) => x + y, 0);
    res[e.slug] = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, c]) => `${k}${c / tot < 0.9 ? ` ${Math.round((100 * c) / tot)}%` : ""}`).join(", ") || "-";
  }
  return res;
}

const strip = (c) => (c || "").replace(/#.*$/gm, "").replace(/"""[\s\S]*?"""/g, "");
const shingles = (c) => { const t = strip(c).match(/[A-Za-z_]\w*|\d+|[^\s\w]/g) || []; const s = new Set(); for (let i = 0; i + 4 <= t.length; i++) s.add(t.slice(i, i + 4).join(" ")); return s; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
async function programs(G, teamId, roundNo) {
  const rows = await all("SELECT kind, code FROM round_programs WHERE game_id = $1 AND team_id = $2 AND round_no = $3", [G.uuid, teamId, roundNo]);
  return Object.fromEntries(rows.map((r) => [r.kind, r.code]));
}

/**
 * Borrowing from the demo: for each non-demo team of game G and each program kind, the token-4-shingle Jaccard
 * similarity to the closest top-2 program of the previous game P, before (its own final code in P), in round 1 of G
 * and in G's final round. A program counts as borrowed when that similarity rises by more than 0.25 to above 0.35.
 */
export async function demoBorrowing(G, P) {
  const demo = P.ents.filter((e) => e.fitness_rank && e.fitness_rank <= 2);
  const demoProgs = await Promise.all(demo.map(async (e) => ({ slug: e.slug, p: await programs(P, e.team_id, P.rounds) })));
  const rows = [];
  for (const e of G.ents) {
    if (demo.some((d) => d.slug === e.slug)) continue;
    const pe = P.ents.find((x) => x.slug === e.slug);
    if (!pe) continue;
    const before = await programs(P, pe.team_id, P.rounds), r1 = await programs(G, e.team_id, 1), last = await programs(G, e.team_id, G.rounds);
    for (const k of ["clover", "orchid", "bee"]) {
      const sims = (code) => demoProgs.map((d) => ({ slug: d.slug, s: jaccard(shingles(code), shingles(d.p[k])) })).sort((a, b) => b.s - a.s)[0] || { s: 0 };
      const b = sims(before[k]), a1 = sims(r1[k]), aL = sims(last[k]);
      const peak = a1.s >= aL.s ? a1 : aL;
      rows.push({ slug: e.slug, kind: k, before: b.s, r1: a1.s, last: aL.s, from: peak.slug, borrowed: peak.s - b.s > 0.25 && peak.s > 0.35 });
    }
  }
  return { demo: demo.sort((a, b) => a.fitness_rank - b.fitness_rank).map((d) => d.slug), rows };
}

/**
 * From the session transcripts (arena/runs/transcripts/<arena>/<slug>/g<game>-r<round>-a<attempt>.jsonl), per game:
 * sessions, Python commands that ran or were denied by the CLI, and which teams opened ideas.md / idea-card.md.
 */
export function transcriptStats(dir, arenaId) {
  const fs = globalThis.__fs;
  const root = `${dir}/${arenaId}`;
  const out = {};
  if (!fs.existsSync(root)) return out;
  const DENIED = /requires approval|permission|not allowed|denied|obfuscation|Brace expansion|can hide arguments/i;
  for (const slug of fs.readdirSync(root)) for (const f of fs.readdirSync(`${root}/${slug}`)) {
    const g = Number((f.match(/^g(\d+)-/) || [])[1]);
    if (!g) continue;
    const o = (out[g] ||= { sessions: 0, pyRan: 0, pyDenied: 0, pySessions: new Set(), cardReaders: new Set() });
    o.sessions++;
    const uses = {};
    for (const line of fs.readFileSync(`${root}/${slug}/${f}`, "utf8").split("\n")) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const c = e.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type === "tool_use") {
          if (/ideas\.md|idea-card\.md/.test(JSON.stringify(b.input))) o.cardReaders.add(slug);
          if (b.name === "Bash") uses[b.id] = b.input?.command || "";
        }
        if (b.type === "tool_result" && uses[b.tool_use_id] !== undefined && /\bpython3?\b/.test(uses[b.tool_use_id])) {
          const t = JSON.stringify(b.content);
          if (DENIED.test(t) && t.length < 600) o.pyDenied++; else { o.pyRan++; o.pySessions.add(`${slug}/${f}`); }
        }
      }
    }
  }
  return out;
}
