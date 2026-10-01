// What every team knows before writing a line: the function names, their arguments, and the game's
// types. Deliberately no behaviour: no starter code, so there's no shared starting point to converge on.
import { parseType } from "./types.js";

function describe(t) {
  switch (t.kind) {
    case "int": return "an integer";
    case "float": return "a number";
    case "bool": return "true or false";
    case "str": return "a string";
    case "list": return `a list of ${describePlural(t.of)}`;
    case "tree": return `a tree: {"value": ${t.of.kind === "int" ? "int" : t.of.kind}, "children": [tree, ...]}`;
    case "graph": return `an undirected graph: {"nodes": n, "edges": [[a, b], ...]} on nodes 0..n-1`;
    case "digraph": return `a directed graph: {"nodes": n, "edges": [[from, to], ...]} on nodes 0..n-1`;
  }
}
const describePlural = (t) => ({ int: "integers", float: "numbers", bool: "booleans", str: "strings" }[t.kind] ?? describe(t));

function tsType(t) {
  switch (t.kind) {
    case "int": case "float": return "number";
    case "bool": return "boolean";
    case "str": return "string";
    case "list": return `${tsType(t.of)}[]`;
    case "tree": return `Tree<${tsType(t.of)}>`;
    case "graph": case "digraph": return "Graph";
  }
}
const usesKind = (t, k) => t.kind === k || (t.of ? usesKind(t.of, k) : false);

function typeRules(cT, rT, maxLen) {
  const notes = [];
  for (const t of [cT, rT]) {
    if (usesKind(t, "tree") && !notes.some((n) => n.startsWith("tree"))) {
      notes.push(`tree: {"value": v, "children": [...]}, at most ${maxLen} nodes in total. A leaf has "children": [].`);
    }
    if ((usesKind(t, "graph") || usesKind(t, "digraph")) && !notes.some((n) => n.startsWith("graph"))) {
      notes.push(`graph: {"nodes": n, "edges": [[a, b], ...]}: nodes are numbered 0..n-1 (n ≤ ${maxLen}), at most ${4 * maxLen} edges, no self-loops, no repeated edges${usesKind(t, "graph") ? " ([a, b] and [b, a] are the same edge)" : ""}.`);
    }
    if (usesKind(t, "str") || usesKind(t, "list")) {
      if (!notes.some((n) => n.startsWith("strings"))) notes.push(`strings and lists: at most ${maxLen} long.`);
    }
    if (usesKind(t, "int") && !notes.some((n) => n.startsWith("ints"))) notes.push("ints: whole numbers within ±9007199254740991.");
  }
  return notes;
}

export function programInterface(config) {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  const c = config.challengeType, r = config.responseType;
  const types = {
    challenge: c, response: r,
    challengeMeans: describe(cT), responseMeans: describe(rT),
    rules: typeRules(cT, rT, config.maxLen),
  };
  if (config.language === "typescript") {
    const C = tsType(cT), R = tsType(rT);
    const aliases = [
      usesKind(cT, "tree") || usesKind(rT, "tree") ? "type Tree<T> = { value: T; children: Tree<T>[] };" : null,
      [cT, rT].some((t) => usesKind(t, "graph") || usesKind(t, "digraph")) ? "type Graph = { nodes: number; edges: [number, number][] };" : null,
    ].filter(Boolean).join("\n");
    return {
      types,
      flower: `${aliases ? aliases + "\n" : ""}function flower(challenge: ${C}): ${R}`,
      bee: `${aliases ? aliases + "\n" : ""}function forage(seen: [${C}, ${R} | null][], turnsLeft: number, visit: { fed: boolean; nectar: boolean | null }): ["ask", ${C}] | "feed" | "leave"\nfunction tasted(seen: [${C}, ${R} | null][], nectar: boolean): void   // optional\n// MEMORY: read-only array of earlier rounds' top-level variables (MEMORY[0] = end of round 1)`,
    };
  }
  return {
    types,
    flower: `def flower(challenge):    # challenge: ${c}  ->  return a ${r}`,
    bee: `def forage(seen, turns_left, visit):   # seen: [[challenge, response], ...] at this flower (response None if it failed)\n    # visit = {"fed": bool, "nectar": bool or None}; return ["ask", challenge], "feed" (once per visit) or "leave"\ndef tasted(seen, nectar):        # optional: called after you feed; nectar is True or False\n# MEMORY: read-only list of earlier rounds' top-level variables (MEMORY[0] = end of round 1)`,
  };
}
