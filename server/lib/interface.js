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
  const c = ts ? "//" : "#", G = (k) => (ts ? `GAME.${k}` : `GAME["${k}"]`), nul = ts ? "null" : "None";
  const { flower } = config.budgets;
  return `${c} Runs fresh for every turn at your flower: nothing is kept between calls. ${ts ? "Math.random()" : "random"} is freshly\n` +
    `${c} seeded on every call and the clock is available. ${G("ms")} = ${flower.ms}: your time limit per call in milliseconds; a\n` +
    `${c} response that isn't done in time (or an error, or a malformed return) reaches the bee as ${nul}, with no energy.\n` +
    `${c} percent (0-100) is the share of this turn's excess energy E the bee gets as nectar if it feeds; the rest is your\n` +
    `${c} surplus. No feed: nobody gets anything. E = (${G("flower_size_cap")} - ${G("size")}) * max(0, ${G("flower_ms")} - CPU ms of this call).\n` +
    `${c} The ledger holds every finished turn, oldest first (not the one in progress: you aren't told whose bee asked).\n` +
    `${c} Receiving it is free; reading it is part of your compute.`;
}

// How a bee runs.
function beeNotes(ts, config) {
  const c = ts ? "//" : "#", G = (k) => (ts ? `GAME.${k}` : `GAME["${k}"]`), nul = ts ? "null" : "None";
  return `${c} Rounds of ${G("round_ms")} = ${roundMs(config)} ms. As each round starts, a bee with a challenge queued (and not feeding)\n` +
    `${c} takes its turn: a flower is drawn at random among all ${G("teams")} (your own included) and answers within ${config.budgets.flower.ms} ms;\n` +
    `${c} then decide has ${G("ms")} = ${config.budgets.bee.ms} ms. You aren't told whose flower answered (or the percent) until the turn is over.\n` +
    `${c} A feed pays nectar and sits your bee out ${G("feed_cost")} rounds. A late reply never feeds; only a late ["leave", c]\n` +
    `${c} queues c. After any other late reply, or a reply with no usable next challenge, first(ledger) is called at once.\n` +
    `${c} A call is stopped after 2 s. response is ${nul} if the flower failed.\n` +
    `${c} Your bee keeps its variables from call to call for as long as this version plays. A new version (or a crash)\n` +
    `${c} starts afresh. The ledger grows as turns finish (receiving it is free; reading it is part of your compute).`;
}

export function programInterface(config) {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  const c = config.challengeType, r = config.responseType;
  const types = {
    challenge: c, response: r,
    challengeMeans: describe(cT), responseMeans: describe(rT),
    rules: typeRules(cT, rT, limitsOf(config)),
  };
  const entry = (C, R) => `{ round: number; bee: number; flower: number; challenge: ${C}; response: ${R} | null; fed: boolean;\n` +
    `  percent: number | null; energy: number | null; nectar: number | null; surplus: number; ms: number | null }`;
  const entryNote = (cm) => `${cm} Ledger entry: bee and flower are team indices (GAME.team is yours). On a feed, percent, energy, nectar and\n` +
    `${cm} surplus are public; without a feed, surplus is 0, nectar null, and percent and energy are your own flower's only.\n` +
    `${cm} ms (the flower's CPU time): your own flower only. Hidden fields are null.`;
  if (config.language === "typescript") {
    const C = tsType(cT), R = tsType(rT);
    const aliases = [
      usesKind(cT, "tree") || usesKind(rT, "tree") ? "type Tree<T> = { value: T; children: Tree<T>[] };" : null,
      [cT, rT].some((t) => usesKind(t, "graph") || usesKind(t, "digraph")) ? "type Graph = { nodes: number; edges: [number, number][] };" : null,
      [cT, rT].some((t) => (t.kind === "graph" || t.kind === "digraph") && t.of) ? "type LabeledGraph<L> = Graph & { labels: L[]; edgeLabels?: L[] };" : null,
      `type Entry = ${entry(C, R)};`,
    ].filter(Boolean).join("\n");
    return {
      types,
      flower: `${aliases}\n${entryNote("//")}\nfunction flower(challenge: ${C}, ledger: readonly Entry[]): [${R}, number]   // [response, percent]\n${flowerNotes(true, config)}`,
      bee: `${aliases}\n${entryNote("//")}\nfunction first(ledger: readonly Entry[]): ${C}   // the challenge for your bee's next turn\n` +
        `function decide(challenge: ${C}, response: ${R} | null, ledger: readonly Entry[]): ["feed" | "leave", ${C}]   // [decision, next challenge]\n${beeNotes(true, config)}`,
    };
  }
  const pyEntry = `# ledger: a list of dicts {"round", "bee", "flower", "challenge", "response", "fed", "percent", "energy", "nectar", "surplus", "ms"}\n` +
    entryNote("#").replaceAll("GAME.team", 'GAME["team"]').replace("# Ledger entry: ", "# ").replace("are null", "are None");
  return {
    types,
    flower: `${pyEntry}\ndef flower(challenge, ledger):    # challenge: ${c}  ->  return (response, percent); response: ${r}\n${flowerNotes(false, config)}`,
    bee: `${pyEntry}\ndef first(ledger):                       # -> the challenge (${c}) for your bee's next turn\n` +
      `def decide(challenge, response, ledger):  # -> ("feed", next_challenge) or ("leave", next_challenge)\n${beeNotes(false, config)}`,
  };
}
