// Trees and graphs: which structural features of answers separated clovers from orchids?
// For every real visit (first question), compute features of the answer; compare clover vs orchid prevalence, and how
// often an orchid's answer shares a "family" (shape key) with some clover's answer to the same question.
import { loadAll, evalFlower, label, clean, mean, pct, f2, K } from "./lib.mjs";
const games = (await loadAll()).filter((g) => clean(g) && /trees|graphs/.test(g.arena));
function gfeat(g, c) {
  const n = g.nodes, adj = Array.from({ length: n }, () => []);
  for (const [a, b] of g.edges) { adj[a].push(b); adj[b].push(a); }
  const deg = adj.map((x) => x.length);
  let comps = 0; const seen = new Array(n).fill(false);
  for (let i = 0; i < n; i++) if (!seen[i]) { comps++; const st = [i]; seen[i] = true; while (st.length) { const x = st.pop(); for (const y of adj[x]) if (!seen[y]) { seen[y] = true; st.push(y); } } }
  const m = g.edges.length, tree = comps === 1 && m === n - 1;
  const path = tree && deg.every((d) => d <= 2);
  const inorder = path && g.edges.every(([a, b]) => Math.abs(a - b) === 1);
  return { tree, path, "in-order path (edges i,i+1)": inorder, "path+1 twig": tree && deg.filter((d) => d === 3).length === 1 && deg.every((d) => d <= 3), star: n > 2 && Math.max(...deg) === n - 1 && m === n - 1, cycle: comps === 1 && m === n && deg.every((d) => d === 2), "has isolated node": deg.some((d) => d === 0), "edgeless": m === 0, "disconnected": comps > 1, "n>=10": n >= 10, "n<5": n < 5,
    family: "deg:" + [...deg].sort((a, b) => a - b).join(","), exactShape: K(g) };
}
function tfeat(t, c) {
  let size = 0, leaves = 0, depth = 0, maxkids = 0; const vals = [];
  const walk = (x, d) => { size++; depth = Math.max(depth, d); maxkids = Math.max(maxkids, x.children.length); vals.push(x.value); if (!x.children.length) leaves++; x.children.forEach((y) => walk(y, d + 1)); };
  walk(t, 1);
  const rel = (x) => ({ v: typeof c === "number" ? x.value - c : null, k: x.children.map(rel) });
  const big = vals.some((v) => Math.abs(v - c) > 1000);
  return { "root = question": t.value === c, "all values within ±100 of question": vals.every((v) => Math.abs(v - c) <= 100), "values far from question (hash-like)": big, chain: maxkids <= 1 && size > 1, "flat fan (depth 2)": depth === 2, "depth>=3": depth >= 3, "single node": size === 1, "size>=8": size >= 8,
    family: `size${size} depth${depth} leaves${leaves}`, relShape: K(rel(t)), exactShape: K(t) };
}
for (const arena of ["trees", "graphs"]) {
  const fc = {}, fo = {}; let nc = 0, no = 0; let famColl = 0, relColl = 0, exColl = 0, oN = 0;
  for (const g of games.filter((g) => g.arena === arena)) for (const r of g.rounds) {
    const qs = [...new Map(r.visits.filter((v) => v.steps.length).map((v) => [K(v.steps[0].c), v.steps[0].c])).values()];
    const ans = {};
    for (const t of g.ids) for (const kind of ["clover", "orchid"]) ans[t + kind] = await evalFlower(g.config, r.programs[t][kind].code, kind, qs, g.ids.length);
    const idx = new Map(qs.map((q, i) => [K(q), i]));
    const feat = (s, c) => { if (s === null) return null; const v = JSON.parse(s); try { return arena === "graphs" ? gfeat(v, c) : tfeat(v, c); } catch { return null; } };
    for (const v of r.visits) {
      if (!v.steps.length || v.bee === v.patch) continue;
      const i = idx.get(K(v.steps[0].c)), c = v.steps[0].c;
      const F = feat(ans[v.patch + v.kind][i], c); if (!F) continue;
      const tgt = v.kind === "clover" ? fc : fo; if (v.kind === "clover") nc++; else no++;
      for (const [k, x] of Object.entries(F)) if (x === true) tgt[k] = (tgt[k] || 0) + 1;
      if (v.kind === "orchid") {
        oN++;
        const cl = g.ids.map((t) => feat(ans[t + "clover"][i], c)).filter(Boolean);
        if (cl.some((x) => x.family === F.family)) famColl++;
        if (cl.some((x) => x.exactShape === F.exactShape)) exColl++;
        if (F.relShape && cl.some((x) => x.relShape === F.relShape)) relColl++;
      }
    }
  }
  console.log(`\n${arena}: rival visits clover ${nc} orchid ${no}`);
  console.log("| feature of the answer | share of clover visits | share of orchid visits | P(clover given feature) |");
  const keys = [...new Set([...Object.keys(fc), ...Object.keys(fo)])];
  for (const k of keys) { const a = (fc[k] || 0) / nc, b = (fo[k] || 0) / no; console.log(`| ${k} | ${pct(a)} | ${pct(b)} | ${f2((fc[k] || 0) / ((fc[k] || 0) + (fo[k] || 0)))} |`); }
  console.log(`orchid visits whose answer equals some clover's answer exactly: ${pct(exColl / oN)}; same ${arena === "graphs" ? "degree sequence" : "size/depth/leaves"} family: ${pct(famColl / oN)}${arena === "trees" ? `; same shape relative to the question: ${pct(relColl / oN)}` : ""}`);
}
