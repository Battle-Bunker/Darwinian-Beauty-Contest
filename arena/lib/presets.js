// Arena presets: game settings + founding lineup (persona slug -> model).
// Lineups balance adults/kids and spread each archetype over different models across arenas,
// so archetype and model effects aren't confounded. One fable team per arena (it's the priciest).

export const PRESETS = {
  pilot: {
    description: "Pilot: 4 teams, 3 rounds, cheap models, defaults otherwise",
    config: { rounds: 3 },
    lineup: [["tess", "sonnet"], ["milo", "haiku"], ["grace", "haiku"], ["priya", "sonnet"]],
  },
  baseline: {
    description: "Baseline: python, int→int, default budgets, 6 teams, 5 rounds",
    config: { language: "python", challengeType: "int", responseType: "int", rounds: 5 },
    lineup: [["nash", "fable"], ["kenji", "opus"], ["bayes", "sonnet"], ["milo", "sonnet"], ["grace", "haiku"], ["jayden", "haiku"]],
  },
  strdark: {
    description: "str→str with flower logs OFF, 6 teams, 5 rounds",
    config: { language: "python", challengeType: "str", responseType: "str", flowerLogs: false, rounds: 5 },
    lineup: [["rosalind", "fable"], ["theo", "opus"], ["mallory", "sonnet"], ["luna", "sonnet"], ["echo", "haiku"], ["priya", "haiku"]],
  },
  lists: {
    description: "list[int]→int, feed cost 10, 80 turns, 6 teams, 5 rounds",
    config: { language: "python", challengeType: "list[int]", responseType: "int", feedCost: 10, turns: 80, rounds: 5 },
    lineup: [["ava", "fable"], ["ada", "opus"], ["gremlin", "sonnet"], ["zoe", "sonnet"], ["tess", "haiku"], ["sam", "haiku"]],
  },
  tight: {
    description: "TypeScript, tight budgets (flowers 60 nodes/10 edits, bee 150/20), 8 teams, 5 rounds",
    config: {
      language: "typescript", challengeType: "int", responseType: "int", rounds: 5,
      budgets: { clover: { nodes: 60, changes: 10 }, orchid: { nodes: 60, changes: 10 }, bee: { nodes: 150, changes: 20 } },
    },
    lineup: [["rosie", "fable"], ["koan", "opus"], ["kenji", "opus"], ["bayes", "sonnet"], ["luna", "sonnet"], ["gremlin", "haiku"], ["echo", "haiku"], ["zoe", "haiku"]],
  },
  cheapfeed: {
    description: "Probe for blind trust: python int→int, feed cost 1 (feeding barely costs more than asking), 6 teams, 5 rounds",
    config: { language: "python", challengeType: "int", responseType: "int", feedCost: 1, rounds: 5 },
    lineup: [["mallory", "fable"], ["zoe", "opus"], ["ada", "sonnet"], ["rosie", "sonnet"], ["nash", "haiku"], ["theo", "haiku"]],
  },
  norecap: {
    description: "Baseline twin with no code recap between games (agents see last game's standings and their own panel feedback, not other teams' code)",
    config: { language: "python", challengeType: "int", responseType: "int", rounds: 5 },
    recap: "scores",
    lineup: [["nash", "fable"], ["kenji", "opus"], ["bayes", "sonnet"], ["milo", "sonnet"], ["grace", "haiku"], ["jayden", "haiku"]],
  },
  // ---- added with the no-starter-code change: these arenas never saw starter programs ----
  unprimed: {
    description: "Baseline twin with NO starter code (interface and types only): python, int→int, defaults, 6 teams, 5 rounds",
    config: { language: "python", challengeType: "int", responseType: "int", rounds: 5 },
    lineup: [["nash", "fable"], ["kenji", "opus"], ["bayes", "sonnet"], ["milo", "sonnet"], ["grace", "haiku"], ["jayden", "haiku"]],
  },
  trees: {
    description: "python, int→tree[int], no starter code, 6 teams, 5 rounds; flowers 250 nodes/40 edits/50 ms, bee 600/80/100",
    config: {
      language: "python", challengeType: "int", responseType: "tree[int]", rounds: 5,
      budgets: { clover: { nodes: 250, changes: 40, ms: 50 }, orchid: { nodes: 250, changes: 40, ms: 50 }, bee: { nodes: 600, changes: 80, ms: 100 } },
    },
    lineup: [["koan", "fable"], ["ava", "opus"], ["rosalind", "sonnet"], ["sam", "sonnet"], ["ada", "haiku"], ["luna", "haiku"]],
  },
  graphs: {
    description: "python, int→graph, no starter code, 6 teams, 5 rounds; flowers 250 nodes/40 edits/50 ms, bee 600/80/100",
    config: {
      language: "python", challengeType: "int", responseType: "graph", rounds: 5,
      budgets: { clover: { nodes: 250, changes: 40, ms: 50 }, orchid: { nodes: 250, changes: 40, ms: 50 }, bee: { nodes: 600, changes: 80, ms: 100 } },
    },
    lineup: [["theo", "fable"], ["mallory", "opus"], ["priya", "sonnet"], ["tess", "sonnet"], ["jayden", "haiku"], ["echo", "haiku"]],
  },
  // ---- engine v2 phase: no fable; v2 defaults (100 turns per flower, MEMORY, asks after feeding, asymmetric budgets).
  // Lineup entries: [source, model, ideaCard?] where source is a founder slug, "founder:<slug>", or "from:<persona id>"
  // (a strong persona from an earlier arena: same prompt, plus its last notebook marked as notes from v1).
  "v2-graphs": {
    description: "Engine v2, python, int→graph, v2 defaults, 6 teams, 5 rounds (main v2 arena)",
    config: { language: "python", challengeType: "int", responseType: "graph", rounds: 5 },
    condition: "v2", mode: "tools",
    lineup: [["from:graphs/mallory", "opus"], ["from:norecap/kenji", "opus"], ["from:graphs/theo", "sonnet"],
      ["founder:luna", "sonnet", "A"], ["from:baseline/rosa-12", "sonnet"], ["founder:grace", "haiku", "B"]],
  },
  "v2-trees": {
    description: "Engine v2, python, int→tree[int], v2 defaults, 6 teams, 5 rounds",
    config: { language: "python", challengeType: "int", responseType: "tree[int]", rounds: 5 },
    condition: "v2", mode: "tools",
    lineup: [["from:trees/koan", "opus"], ["from:trees/ava", "opus", "A"], ["from:trees/rosalind", "sonnet"],
      ["founder:zoe", "sonnet"], ["founder:priya", "sonnet"], ["from:trees/kit", "haiku", "B"]],
  },
  "v2-ints": {
    description: "Engine v2, python, int→int, v2 defaults, 6 teams, 5 rounds",
    config: { language: "python", challengeType: "int", responseType: "int", rounds: 5 },
    condition: "v2", mode: "tools",
    lineup: [["from:unprimed/nash", "opus", "B"], ["from:lists/ada", "opus"], ["founder:tess", "sonnet", "A"],
      ["founder:milo", "sonnet"], ["from:norecap/wren-12", "sonnet"], ["founder:gremlin", "haiku"]],
  },
  // Pilot for the tool-using v2 setup: measures cost per team-round by model.
  "v2-pilot": {
    description: "Pilot: engine v2, tool-using team sessions, int→graph, 3 teams, 2 rounds",
    config: { language: "python", challengeType: "int", responseType: "graph", rounds: 2 },
    condition: "v2", mode: "tools",
    lineup: [["from:graphs/mallory", "opus"], ["founder:luna", "sonnet", "A"], ["founder:grace", "haiku", "B"]],
  },
};
