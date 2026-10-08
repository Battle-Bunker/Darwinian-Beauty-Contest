// Challenge and response values, shown compactly. Scalars print as they are; lists, trees and
// graphs get a one-line summary that expands to the full JSON and (when small) a tiny drawing.
import { createContext, useContext, useId, useMemo } from "react";
import { showValue } from "../lib/format";

/** The game's challenge and response types, so values can be read the right way (graph vs digraph). */
export const ValueTypes = createContext<{ challenge: string; response: string } | null>(null);
export const useValueTypes = () => useContext(ValueTypes);

interface TreeNode { value: unknown; children: TreeNode[] }
type Shape =
  | { kind: "graph" | "digraph"; nodes: number; edges: [number, number][]; labels?: unknown[] }
  | { kind: "tree"; root: TreeNode }
  | { kind: "list"; items: unknown[] }
  | { kind: "scalar" };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isTree = (v: unknown): v is TreeNode => isObj(v) && "value" in v && Array.isArray(v.children);
const isGraph = (v: unknown): v is { nodes: number; edges: [number, number][]; labels?: unknown[] } =>
  isObj(v) && typeof v.nodes === "number" && Array.isArray(v.edges);

function classify(v: unknown, type?: string): Shape {
  const t = (type || "").toLowerCase().replace(/\s+/g, "");
  if (isGraph(v)) return { kind: t.startsWith("digraph") ? "digraph" : "graph", nodes: v.nodes, edges: v.edges, labels: Array.isArray(v.labels) ? v.labels : undefined };
  if (isTree(v)) return { kind: "tree", root: v };
  if (Array.isArray(v)) return { kind: "list", items: v };
  return { kind: "scalar" };
}

/** Shortest number of edges from node 0 to node n-1, or null if unreachable. */
function distance0ToLast(n: number, edges: [number, number][], directed: boolean): number | null {
  if (n < 2) return 0;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2) continue;
    const [a, b] = e;
    if (a >= 0 && a < n && b >= 0 && b < n) { adj[a].push(b); if (!directed) adj[b].push(a); }
  }
  const dist = new Array<number>(n).fill(-1);
  dist[0] = 0;
  const q = [0];
  for (let i = 0; i < q.length; i++) for (const w of adj[q[i]]) if (dist[w] < 0) { dist[w] = dist[q[i]] + 1; q.push(w); }
  return dist[n - 1] < 0 ? null : dist[n - 1];
}

function treeStats(root: TreeNode) {
  let nodes = 0, leaves = 0, depth = 0;
  const walk = (t: TreeNode, d: number) => {
    nodes++;
    depth = Math.max(depth, d);
    const kids = Array.isArray(t.children) ? t.children : [];
    if (!kids.length) leaves++;
    for (const c of kids) if (isTree(c)) walk(c, d + 1);
  };
  walk(root, 1);
  return { nodes, leaves, depth };
}

export function summarize(v: unknown, type?: string): string | null {
  const s = classify(v, type);
  switch (s.kind) {
    case "graph":
    case "digraph": {
      const parts = [s.kind, `${s.nodes} ${s.nodes === 1 ? "node" : "nodes"}`, `${s.edges.length} ${s.edges.length === 1 ? "edge" : "edges"}`];
      if (s.nodes >= 2) {
        const d = distance0ToLast(s.nodes, s.edges, s.kind === "digraph");
        parts.push(d === null ? "0→last: no path" : `0→last: ${d} ${d === 1 ? "step" : "steps"}`);
      }
      if (s.labels) parts.push(`labels ${s.labels.slice(0, 4).map((l) => showValue(l, 8)).join(", ")}${s.labels.length > 4 ? ", …" : ""}`);
      return parts.join(" · ");
    }
    case "tree": {
      const st = treeStats(s.root);
      return `tree · ${st.nodes} ${st.nodes === 1 ? "node" : "nodes"} · depth ${st.depth} · ${st.leaves} ${st.leaves === 1 ? "leaf" : "leaves"} · root ${showValue(s.root.value, 12)}`;
    }
    case "list": {
      const json = JSON.stringify(s.items);
      return json.length <= 28 ? null : `list · ${s.items.length} items: ${showValue(s.items.slice(0, 3), 20).replace(/]$/, "")}, …]`;
    }
    default:
      return null;
  }
}

/** A value from a challenge or response. `role` picks the game's type for reading it. */
export function Value({ v, role, max = 28 }: { v: unknown; role?: "challenge" | "response"; max?: number }) {
  const types = useValueTypes();
  const type = role && types ? types[role] : undefined;
  const summary = useMemo(() => summarize(v, type), [v, type]);
  if (summary === null) return <span className="mono val-plain">{showValue(v, max)}</span>;
  return (
    <details className="val">
      <summary><span className="val-sum">{summary}</span></summary>
      <div className="val-full">
        <MiniDrawing v={v} type={type} />
        <pre className="val-json">{JSON.stringify(v)}</pre>
      </div>
    </details>
  );
}

function MiniDrawing({ v, type }: { v: unknown; type?: string }) {
  const s = classify(v, type);
  if ((s.kind === "graph" || s.kind === "digraph") && s.nodes >= 1 && s.nodes <= 16) return <MiniGraph n={s.nodes} edges={s.edges} directed={s.kind === "digraph"} labels={s.labels} />;
  if (s.kind === "tree") {
    const st = treeStats(s.root);
    if (st.nodes <= 31) return <MiniTree root={s.root} />;
  }
  return null;
}

function MiniGraph({ n, edges, directed, labels }: { n: number; edges: [number, number][]; directed: boolean; labels?: unknown[] }) {
  const id = useId().replace(/:/g, "");
  const R = n <= 2 ? 22 : 34, C = 46;
  const pt = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
  };
  const label = n <= 12;
  return (
    <svg className="mini-graph" width="92" height="92" viewBox="0 0 92 92" role="img" aria-label={`${directed ? "directed " : ""}graph drawing`}>
      {directed && (
        <defs>
          <marker id={`arr${id}`} viewBox="0 0 6 6" refX="10.5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L6 3 L0 6z" className="mini-arrow" />
          </marker>
        </defs>
      )}
      {edges.map((e, i) => {
        if (!Array.isArray(e) || e[0] >= n || e[1] >= n) return null;
        const a = pt(e[0]), b = pt(e[1]);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="mini-edge" markerEnd={directed ? `url(#arr${id})` : undefined} />;
      })}
      {Array.from({ length: n }, (_, i) => {
        const p = pt(i);
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={label ? 6.5 : 4} className={`mini-node ${i === 0 ? "first" : i === n - 1 ? "last" : ""}`} />
            {label && <text x={p.x} y={p.y + 2.6} className="mini-label">{labels ? showValue(labels[i], 3) : i}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function MiniTree({ root }: { root: TreeNode }) {
  // Leaves get consecutive x slots; parents sit over their children.
  const nodes: { x: number; y: number; v: unknown; parent: number }[] = [];
  let next = 0;
  const place = (t: TreeNode, depth: number, parent: number): number => {
    const me = nodes.length;
    nodes.push({ x: 0, y: depth, v: t.value, parent });
    const kids = (Array.isArray(t.children) ? t.children : []).filter(isTree);
    if (!kids.length) nodes[me].x = next++;
    else {
      const xs = kids.map((c) => nodes[place(c, depth + 1, me)].x);
      nodes[me].x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    return me;
  };
  place(root, 0, -1);
  const cols = Math.max(1, next), rows = Math.max(...nodes.map((n) => n.y)) + 1;
  const dx = Math.min(22, 200 / cols), dy = 22;
  const w = cols * dx + 12, h = rows * dy + 6;
  const X = (x: number) => 6 + dx / 2 + x * dx, Y = (y: number) => 12 + y * dy;
  return (
    <svg className="mini-tree" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="tree drawing">
      {nodes.map((n, i) => (n.parent >= 0 ? <line key={`e${i}`} x1={X(nodes[n.parent].x)} y1={Y(nodes[n.parent].y)} x2={X(n.x)} y2={Y(n.y)} className="mini-edge" /> : null))}
      {nodes.map((n, i) => {
        const text = showValue(n.v, 4);
        return (
          <g key={i}>
            <circle cx={X(n.x)} cy={Y(n.y)} r={7} className={`mini-node ${i === 0 ? "first" : ""}`} />
            {text.length <= 3 && <text x={X(n.x)} y={Y(n.y) + 2.6} className="mini-label">{text}</text>}
          </g>
        );
      })}
    </svg>
  );
}
