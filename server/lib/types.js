// Challenge/response value types. A type is one of:
//   int | float | bool | str | any | list[T] | tree[T] | graph | digraph | graph[T] | digraph[T]
// Values travel as JSON. Limits keep every value small and JSON-safe: `maxLen` bounds the length of
// strings and lists; `maxNodes` bounds the nodes in a tree or graph, and (×4) the number of graph edges.
//
//   any         any JSON value: numbers, strings, true/false, null, lists and string-keyed objects
//   tree[T]     {"value": T, "children": [tree[T], ...]}      a rooted tree with a value at every node
//   graph       {"nodes": n, "edges": [[a, b], ...]}         undirected simple graph on nodes 0..n-1
//   digraph     {"nodes": n, "edges": [[from, to], ...]}     directed simple graph on nodes 0..n-1
//   graph[T]    graph plus "labels": [T × n] (one per node) and optionally "edgeLabels": [T × edges]
//   digraph[T]  the same, directed. graph[any] = a graph with arbitrary labels.
// Node indices give patterns something to anchor on: degree of node 0, distance from 0 to 1 or to n-1;
// labels let a graph carry numbers, coordinates or colours (e.g. a clique of residues mod p).

const MAX_INT = Number.MAX_SAFE_INTEGER;

export function parseType(s) {
  const t = String(s || "").replace(/\s+/g, "").toLowerCase();
  if (["int", "float", "bool", "str", "any", "graph", "digraph"].includes(t)) return { kind: t };
  const m = t.match(/^(list|tree|graph|digraph)\[(.+)\]$/);
  if (m) return { kind: m[1], of: parseType(m[2]) };
  throw new Error(`Unknown type "${s}" (use int, float, bool, str, any, list[T], tree[T], graph, digraph, graph[T] or digraph[T])`);
}

export const typeToString = (t) => (t.of ? `${t.kind}[${typeToString(t.of)}]` : t.kind);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keysAre = (v, keys) => Object.keys(v).length === keys.length && keys.every((k) => k in v);

function checkAny(v, maxLen, path, depth = 0) {
  if (depth > 32) return `${path} is nested too deeply`;
  if (v === null || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? null : `${path} must be a finite number`;
  if (typeof v === "string") return v.length > maxLen ? `${path} is longer than ${maxLen} characters` : null;
  if (Array.isArray(v)) {
    if (v.length > maxLen) return `${path} has more than ${maxLen} items`;
    for (let i = 0; i < v.length; i++) { const e = checkAny(v[i], maxLen, `${path}[${i}]`, depth + 1); if (e) return e; }
    return null;
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length > maxLen) return `${path} has more than ${maxLen} keys`;
    for (const k of keys) { const e = checkAny(v[k], maxLen, `${path}.${k}`, depth + 1); if (e) return e; }
    return null;
  }
  return `${path} must be plain data`;
}

/** Returns null when `v` fits type `t`, else a short reason. `limits` is {maxLen, maxNodes} (or just maxLen). */
export function checkValue(t, v, limits, path = "value") {
  const { maxLen, maxNodes } = typeof limits === "number" ? { maxLen: limits, maxNodes: limits } : limits;
  switch (t.kind) {
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) return `${path} must be an int`;
      if (Math.abs(v) > MAX_INT) return `${path} is outside ±${MAX_INT}`;
      return null;
    case "float":
      if (typeof v !== "number" || !Number.isFinite(v)) return `${path} must be a finite number`;
      return null;
    case "bool":
      return typeof v === "boolean" ? null : `${path} must be true/false`;
    case "str":
      if (typeof v !== "string") return `${path} must be a string`;
      return v.length > maxLen ? `${path} is longer than ${maxLen} characters` : null;
    case "list":
      if (!Array.isArray(v)) return `${path} must be a list`;
      if (v.length > maxLen) return `${path} has more than ${maxLen} items`;
      for (let i = 0; i < v.length; i++) {
        const e = checkValue(t.of, v[i], limits, `${path}[${i}]`);
        if (e) return e;
      }
      return null;
    case "tree": {
      let count = 0;
      const walk = (node, p, depth) => {
        if (!isObj(node) || !keysAre(node, ["value", "children"])) return `${p} must be {"value": ..., "children": [...]}`;
        if (++count > maxNodes) return `${path} has more than ${maxNodes} nodes`;
        if (depth > maxNodes) return `${path} is deeper than ${maxNodes}`;
        const e = checkValue(t.of, node.value, limits, `${p}.value`);
        if (e) return e;
        if (!Array.isArray(node.children)) return `${p}.children must be a list`;
        for (let i = 0; i < node.children.length; i++) {
          const ce = walk(node.children[i], `${p}.children[${i}]`, depth + 1);
          if (ce) return ce;
        }
        return null;
      };
      return walk(v, path, 1);
    }
    case "any":
      return checkAny(v, maxLen, path);
    case "graph":
    case "digraph": {
      if (t.of) {
        // Labelled: {"nodes", "edges", "labels"} plus optional "edgeLabels".
        if (!isObj(v) || !("labels" in v) || !Object.keys(v).every((k) => ["nodes", "edges", "labels", "edgeLabels"].includes(k)) || !("nodes" in v) || !("edges" in v)) {
          return `${path} must be {"nodes": n, "edges": [[a, b], ...], "labels": [one per node]} (plus optional "edgeLabels")`;
        }
        const bare = checkValue({ kind: t.kind }, { nodes: v.nodes, edges: v.edges }, limits, path);
        if (bare) return bare;
        if (!Array.isArray(v.labels) || v.labels.length !== v.nodes) return `${path}.labels must be a list with one label per node (${v.nodes})`;
        for (let i = 0; i < v.labels.length; i++) { const e = checkValue(t.of, v.labels[i], limits, `${path}.labels[${i}]`); if (e) return e; }
        if ("edgeLabels" in v) {
          if (!Array.isArray(v.edgeLabels) || v.edgeLabels.length !== v.edges.length) return `${path}.edgeLabels must be a list with one label per edge (${v.edges.length})`;
          for (let i = 0; i < v.edgeLabels.length; i++) { const e = checkValue(t.of, v.edgeLabels[i], limits, `${path}.edgeLabels[${i}]`); if (e) return e; }
        }
        return null;
      }
      if (!isObj(v) || !keysAre(v, ["nodes", "edges"])) return `${path} must be {"nodes": n, "edges": [[a, b], ...]}`;
      const n = v.nodes;
      if (!Number.isInteger(n) || n < 0 || n > maxNodes) return `${path}.nodes must be an int from 0 to ${maxNodes}`;
      if (!Array.isArray(v.edges)) return `${path}.edges must be a list`;
      if (v.edges.length > 4 * maxNodes) return `${path} has more than ${4 * maxNodes} edges`;
      const seen = new Set();
      for (let i = 0; i < v.edges.length; i++) {
        const e = v.edges[i];
        if (!Array.isArray(e) || e.length !== 2 || !e.every((x) => Number.isInteger(x) && x >= 0 && x < n)) {
          return `${path}.edges[${i}] must be [a, b] with nodes from 0 to ${n - 1}`;
        }
        if (e[0] === e[1]) return `${path}.edges[${i}] is a self-loop`;
        const key = t.kind === "graph" ? [Math.min(...e), Math.max(...e)].join() : e.join();
        if (seen.has(key)) return `${path}.edges[${i}] repeats an edge`;
        seen.add(key);
      }
      return null;
    }
  }
  return `${path}: unknown type`;
}

/** A small valid value of the type: used as a default "try it" challenge and in docs. */
export function exampleValue(t) {
  switch (t.kind) {
    case "int": return 7;
    case "float": return 0.5;
    case "bool": return true;
    case "str": return "hello";
    case "list": return [exampleValue(t.of)];
    case "tree": return { value: exampleValue(t.of), children: [{ value: exampleValue(t.of), children: [] }] };
    case "any": return 7;
    case "graph": case "digraph": return t.of ? { nodes: 3, edges: [[0, 1], [1, 2]], labels: [0, 1, 2].map(() => exampleValue(t.of)) } : { nodes: 3, edges: [[0, 1], [1, 2]] };
  }
}
