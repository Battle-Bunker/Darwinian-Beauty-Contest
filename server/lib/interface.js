// What every team knows before writing a line: the function names, their arguments, and the game's
// types. Deliberately no behaviour: no starter code, so there's no shared starting point to converge on.
import { parseType } from "./types.js";
import { limitsOf } from "./gameConfig.js";

function describe(t) {
  switch (t.kind) {
    case "int": return "an integer";
    case "float": return "a number";
    case "bool": return "true or false";
    case "str": return "a string";
    case "list": return `a list of ${describePlural(t.of)}`;
    case "tree": return `a tree: {"value": ${t.of.kind === "int" ? "int" : t.of.kind}, "children": [tree, ...]}`;
    case "any": return "any plain data (numbers, strings, true/false, null, lists, objects)";
    case "graph": case "digraph": {
      const kind = t.kind === "graph" ? "an undirected graph" : "a directed graph";
      const e = t.kind === "graph" ? "[a, b]" : "[from, to]";
      if (!t.of) return `${kind}: {"nodes": n, "edges": [${e}, ...]} on nodes 0..n-1`;
      return `${kind} with labels: {"nodes": n, "edges": [${e}, ...], "labels": [one ${t.of.kind === "any" ? "label (any plain data)" : describe(t.of)} per node], "edgeLabels": [one per edge, optional]}`;
    }
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
    case "any": return "any";
    case "graph": case "digraph": return t.of ? `LabeledGraph<${tsType(t.of)}>` : "Graph";
  }
}
const usesKind = (t, k) => t.kind === k || (t.of ? usesKind(t.of, k) : false);

function typeRules(cT, rT, { maxLen, maxNodes }) {
  const notes = [];
  for (const t of [cT, rT]) {
    if (usesKind(t, "tree") && !notes.some((n) => n.startsWith("tree"))) {
      notes.push(`tree: {"value": v, "children": [...]}, at most ${maxNodes} nodes in total. A leaf has "children": [].`);
    }
    if ((usesKind(t, "graph") || usesKind(t, "digraph")) && !notes.some((n) => n.startsWith("graph"))) {
      notes.push(`graph: {"nodes": n, "edges": [[a, b], ...]}: nodes are numbered 0..n-1 (n ≤ ${maxNodes}), at most ${4 * maxNodes} edges, no self-loops, no repeated edges${usesKind(t, "graph") ? " ([a, b] and [b, a] are the same edge)" : ""}.`);
      if ((t.kind === "graph" || t.kind === "digraph") && t.of) {
        notes.push(`labels: "labels" has exactly one label per node (labels[i] belongs to node i); "edgeLabels", if present, one per edge in the same order as "edges". Labels can repeat.`);
      }
    }
    if (usesKind(t, "any") && !notes.some((n) => n.startsWith("any"))) notes.push(`any: plain data only; strings and lists at most ${maxLen} long, at most 32 levels deep.`);
    if (usesKind(t, "str") || usesKind(t, "list")) {
      if (!notes.some((n) => n.startsWith("strings"))) notes.push(`strings and lists: at most ${maxLen} long.`);
    }
    if (usesKind(t, "int") && !notes.some((n) => n.startsWith("ints"))) notes.push("ints: whole numbers within ±9007199254740991.");
  }
  return notes;
}

// How a flower runs, as comment lines under its signature.
function flowerNotes(ts) {
  const c = ts ? "//" : "#";
  return `${c} Runs fresh for every question: nothing is kept between calls. ${ts ? "Math.random()" : "random"} is freshly seeded on every call\n` +
    `${c} and the clock is available (${ts ? "Date.now()" : "import time"}). ${ts ? "GAME.ms" : 'GAME["ms"]'} is your compute budget per call in milliseconds;\n` +
    `${c} the clock starts when your program starts, so stop with a margin to spare.`;
}

export function programInterface(config) {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  const c = config.challengeType, r = config.responseType;
  const types = {
    challenge: c, response: r,
    challengeMeans: describe(cT), responseMeans: describe(rT),
    rules: typeRules(cT, rT, limitsOf(config)),
  };
  if (config.language === "typescript") {
    const C = tsType(cT), R = tsType(rT);
    const aliases = [
      usesKind(cT, "tree") || usesKind(rT, "tree") ? "type Tree<T> = { value: T; children: Tree<T>[] };" : null,
      [cT, rT].some((t) => usesKind(t, "graph") || usesKind(t, "digraph")) ? "type Graph = { nodes: number; edges: [number, number][] };" : null,
      [cT, rT].some((t) => (t.kind === "graph" || t.kind === "digraph") && t.of) ? "type LabeledGraph<L> = Graph & { labels: L[]; edgeLabels?: L[] };" : null,
    ].filter(Boolean).join("\n");
    return {
      types,
      flower: `${aliases ? aliases + "\n" : ""}function flower(challenge: ${C}): ${R}\n${flowerNotes(true)}`,
      bee: `${aliases ? aliases + "\n" : ""}function forage(seen: [${C}, ${R} | null][], turnsLeft: number, visit: { fed: boolean; nectar: boolean | null }): ["ask", ${C}] | "feed" | "leave"\nfunction tasted(seen: [${C}, ${R} | null][], nectar: boolean): void   // optional\n// let keep = …: whatever top-level keep holds when a round ends is saved (plain data)\n// MEMORY: read-only array of what keep held at the end of each earlier round (MEMORY[0] = end of round 1)`,
    };
  }
  return {
    types,
    flower: `def flower(challenge):    # challenge: ${c}  ->  return a ${r}\n${flowerNotes(false)}`,
    bee: `def forage(seen, turns_left, visit):   # seen: [[challenge, response], ...] at this flower (response None if it failed)\n    # visit = {"fed": bool, "nectar": bool or None}; return ["ask", challenge], "feed" (once per visit) or "leave"\ndef tasted(seen, nectar):        # optional: called after you feed; nectar is True or False\n# keep = …: whatever top-level keep holds when a round ends is saved (plain data)\n# MEMORY: read-only list of what keep held at the end of each earlier round (MEMORY[0] = end of round 1)`,
  };
}
