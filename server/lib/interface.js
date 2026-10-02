// What every team knows before writing a line: the function names, their arguments, and the game's
// types. Deliberately no behaviour: no starter code, so there's no shared starting point to converge on.
import { parseType } from "./types.js";
import { limitsOf, roundMs } from "./gameConfig.js";

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
function flowerNotes(ts, config) {
  const c = ts ? "//" : "#", G = (k) => (ts ? `GAME.${k}` : `GAME["${k}"]`);
  const { clover, orchid } = config.budgets;
  return `${c} Runs fresh for every question: nothing is kept between calls. ${ts ? "Math.random()" : "random"} is freshly seeded on every call\n` +
    `${c} and the clock is available (${ts ? "Date.now()" : "import time"}). ${G("ms")} is your time limit per call in milliseconds:\n` +
    `${c} ${clover.ms} for a clover, ${orchid.ms} for an orchid. The clock starts when your program starts, so stop with a margin\n` +
    `${c} to spare: an answer that isn't done in time reaches the bee as ${ts ? "null" : "None"}. Every answer, however fast, reaches the\n` +
    `${c} bee ${clover.ms} ms into the round, so it can't tell flowers apart by how long they take.`;
}

// How a bee runs.
function beeNotes(ts, config) {
  const c = ts ? "//" : "#", G = (k) => (ts ? `GAME.${k}` : `GAME["${k}"]`);
  return `${c} Rounds of ${G("round_ms")} = ${roundMs(config)} ms: as each round starts, every bee's queued action runs (an ask, or a feed);\n` +
    `${c} answers arrive ${config.budgets.clover.ms} ms in, and forage then has ${G("ms")} = ${config.budgets.bee.ms} ms to return the bee's next action,\n` +
    `${c} queued for its next round. A bee with nothing queued as a round starts misses that round.\n` +
    `${c} A late reply still counts, but the bee misses its next round and the visit ends; of late replies only\n` +
    `${c} ["leave", challenge] is used (its challenge opens the next flower). After any other late reply, or any reply\n` +
    `${c} that gives no next challenge (a plain "leave", a second feed, a bad challenge, an error), forage is called\n` +
    `${c} again at once with seen = [] and fed = ${ts ? "false" : "False"}: return the first challenge for the next flower.\n` +
    `${c} A call is stopped after 2 s.\n` +
    `${c} Your bee keeps its variables from call to call for as long as this version of it plays. Submitting\n` +
    `${c} a new bee (or a crash) starts it afresh. ${ts ? "Math.random()" : "random"} is freshly seeded when it starts.`;
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
      flower: `${aliases ? aliases + "\n" : ""}function flower(challenge: ${C}): ${R}\n${flowerNotes(true, config)}`,
      bee: `${aliases ? aliases + "\n" : ""}function forage(seen: [${C}, ${R} | null][], visit: { fed: boolean; nectar: boolean | null; flowers: number }):\n` +
        `  ["ask", ${C}] | "feed" | ["leave", ${C}] | "leave"\n` +
        `// ["ask", c]: ask c here next round. "feed": once per visit, after asking; then sit out GAME.feed_cost rounds.\n` +
        `// ["leave", c]: move on, and ask c first at the next flower next round. "leave": move on.\n` +
        `function tasted(seen: [${C}, ${R} | null][], nectar: boolean): void   // optional: after a feed, called just before forage\n${beeNotes(true, config)}`,
    };
  }
  return {
    types,
    flower: `def flower(challenge):    # challenge: ${c}  ->  return a ${r}\n${flowerNotes(false, config)}`,
    bee: `def forage(seen, visit):   # seen: [[challenge, response], ...] at this flower (response None if it failed)\n` +
      `    # visit = {"fed": bool, "nectar": bool or None, "flowers": flowers in the garden}\n` +
      `    # return ["ask", challenge]   ask it here next round\n` +
      `    #     or "feed"               once per visit, after asking; then sit out GAME["feed_cost"] rounds\n` +
      `    #     or ["leave", challenge] move on, and ask it first at the next flower next round\n` +
      `    #     or "leave"              move on\n` +
      `def tasted(seen, nectar):        # optional: after a feed, called just before forage; nectar is True or False\n${beeNotes(false, config)}`,
  };
}
