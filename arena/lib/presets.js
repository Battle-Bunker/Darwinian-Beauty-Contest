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
};
