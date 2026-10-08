// What every team knows before writing a line: the function names, their arguments, and the game's
// types. Deliberately no behaviour: no starter code, so there's no shared starting point to converge on.
import { parseType } from "./types.js";
import { RESPONSE_DEPTH, limitsOf, roundMs } from "./gameConfig.js";
import { scoringOf } from "./scoring.js";

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

function typeRules(cT, rT, { maxLen, maxNodes }, maxResponseBytes) {
  const notes = [`challenges are small (the limits below); a response is at most ${maxResponseBytes} bytes of JSON and ${RESPONSE_DEPTH} levels deep, with no other limit.`];
  for (const t of [cT, rT]) {
    if (usesKind(t, "tree") && !notes.some((n) => n.startsWith("tree"))) {
      notes.push(`tree: {"value": v, "children": [...]}, at most ${maxNodes} nodes in total in a challenge. A leaf has "children": [].`);
    }
    if ((usesKind(t, "graph") || usesKind(t, "digraph")) && !notes.some((n) => n.startsWith("graph"))) {
      notes.push(`graph: {"nodes": n, "edges": [[a, b], ...]}: nodes are numbered 0..n-1 (in a challenge n ≤ ${maxNodes}, at most ${4 * maxNodes} edges), no self-loops, no repeated edges${usesKind(t, "graph") ? " ([a, b] and [b, a] are the same edge)" : ""}.`);
      if ((t.kind === "graph" || t.kind === "digraph") && t.of) {
        notes.push(`labels: "labels" has exactly one label per node (labels[i] belongs to node i); "edgeLabels", if present, one per edge in the same order as "edges". Labels can repeat.`);
      }
    }
    if (usesKind(t, "any") && !notes.some((n) => n.startsWith("any"))) notes.push(`any: plain data only; in a challenge, strings and lists at most ${maxLen} long, at most 32 levels deep.`);
    if (t === cT && (usesKind(t, "str") || usesKind(t, "list"))) {
      if (!notes.some((n) => n.startsWith("strings"))) notes.push(`strings and lists in a challenge: at most ${maxLen} long.`);
    }
    if (usesKind(t, "int") && !notes.some((n) => n.startsWith("ints"))) notes.push("ints: whole numbers within ±9007199254740991.");
  }
  return notes;
}

// How a flower runs, as comment lines under its signature.
function flowerNotes(ts, config) {
  const c = ts ? "//" : "#", G = (k) => (ts ? `GAME.${k}` : `GAME["${k}"]`), nul = ts ? "null" : "None";
  const { flower } = config.budgets;
  return `${c} Your flower species: each call is one flower of it, meeting one bee, and runs fresh: nothing is kept between\n` +
    `${c} calls. ${ts ? "Math.random()" : "random"} is freshly seeded every call; the clock reads 0 (the epoch) as each call starts. ${G("ms")} is this\n` +
    `${c} call's hidden time budget R, drawn from ${flower.minMs ?? 50} to ${flower.ms} ms (${G("flower_ms")}) for every call: your time limit; a response that\n` +
    `${c} isn't done within R (or an error, a malformed return, or more than\n` +
    `${c} ${G("max_response_bytes")} = ${config.maxResponseBytes} bytes of JSON) reaches the bee as ${nul}.\n` +
    `${c} If the bee feeds, it gets nectar = percent/100 × E and pollen = the rest; no feed, nothing is given.\n` +
    `${c} E = (${G("flower_size_cap")} - ${G("size")}) * max(0, ${G("ms")} - CPU ms of this call, writing the response as JSON included).\n` +
    `${c} The bee is never told R: the response reaches it at ${G("flower_ms")} ms whatever R was.\n` +
    `${c} Programs see only their arguments and GAME: no history.\n` +
    `${c} Your team scores pollination = Σ over bee teams of (the pollen your species gave that team's bee)^${scoringOf(config).beta};\n` +
    `${c} fitness = N² × pollination share × forage share.`;
}

// How a bee runs.
function beeNotes(ts, config) {
  const c = ts ? "//" : "#", G = (k) => (ts ? `GAME.${k}` : `GAME["${k}"]`), nul = ts ? "null" : "None";
  return `${c} Rounds of ${G("round_ms")} = ${roundMs(config)} ms. As each round starts, a bee with a challenge queued (and not feeding)\n` +
    `${c} takes its turn: a flower of a species drawn at random among all ${G("teams")} (your own included) answers within\n` +
    `${c} ${config.budgets.flower.ms} ms; then decide has ${G("ms")} = ${config.budgets.bee.ms} ms. You are never told whose flower it is, nor its percent.\n` +
    `${c} A feed sits your bee out ${G("feed_cost")} = ${config.feedCost} rounds. A late reply never feeds; only a late ["leave", c] queues c. After any\n` +
    `${c} other late reply, or a reply with no usable next challenge, first() is called at once. A call is stopped after 2 s.\n` +
    `${c} fed(nectar), optional, runs after a feed decided in time, in the same instance as that decide (its globals\n` +
    `${c} intact), within ${G("ms")}. Otherwise every turn runs fresh. Only MEMORY carries over: a key-value store ({} at\n` +
    `${c} first; string keys; string, number, ${ts ? "boolean or null" : "bool or None"} values) you change in place or reassign. It is saved after\n` +
    `${c} each first, decide or fed that returns, if Σ (key bytes + value JSON bytes) ≤ ${G("memory")} = ${config.budgets.bee.memory}.\n` +
    `${c} response is ${nul} if the flower failed. Programs get no history; each call's clock reads 0 as it starts.\n` +
    `${c} Your team scores forage = Σ over flower teams of (the nectar your bee got there)^${scoringOf(config).alpha};\n` +
    `${c} fitness = N² × pollination share × forage share.`;
}

export function programInterface(config) {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  const c = config.challengeType, r = config.responseType;
  const types = {
    challenge: c, response: r,
    challengeMeans: describe(cT), responseMeans: describe(rT),
    rules: typeRules(cT, rT, limitsOf(config), config.maxResponseBytes),
  };
  if (config.language === "typescript") {
    const C = tsType(cT), R = tsType(rT);
    const aliases = [
      usesKind(cT, "tree") || usesKind(rT, "tree") ? "type Tree<T> = { value: T; children: Tree<T>[] };" : null,
      [cT, rT].some((t) => usesKind(t, "graph") || usesKind(t, "digraph")) ? "type Graph = { nodes: number; edges: [number, number][] };" : null,
      [cT, rT].some((t) => (t.kind === "graph" || t.kind === "digraph") && t.of) ? "type LabeledGraph<L> = Graph & { labels: L[]; edgeLabels?: L[] };" : null,
    ].filter(Boolean).join("\n");
    const pre = aliases ? aliases + "\n" : "";
    return {
      types,
      flower: `${pre}function flower(challenge: ${C}): [${R}, number]   // [response, percent]\n${flowerNotes(true, config)}`,
      bee: `${pre}function first(): ${C}   // the challenge for your bee's next turn\n` +
        `function decide(challenge: ${C}, response: ${R} | null): ["feed" | "leave", ${C}]   // [decision, next challenge]\n` +
        `function fed(nectar: number): void   // optional\n${beeNotes(true, config)}`,
    };
  }
  return {
    types,
    flower: `def flower(challenge):    # challenge: ${c}  ->  return (response, percent); response: ${r}\n${flowerNotes(false, config)}`,
    bee: `def first():                         # -> the challenge (${c}) for your bee's next turn\n` +
      `def decide(challenge, response):     # -> ("feed", next_challenge) or ("leave", next_challenge)\n` +
      `def fed(nectar):                     # optional: after a feed, same instance as decide\n${beeNotes(false, config)}`,
  };
}
