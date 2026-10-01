// Presets for fresh arenas: game settings + founding lineup. Experiments that continue from a played game are made
// with fork.js instead (v3-base, cohorts). Every arena runs tool-using team sessions (lib/team.js).
// Lineup entries: [source, model] where source is a founder slug ("tess" or "founder:tess") or "from:<persona id>"
// (a persona from an earlier arena: same prompt and team name, plus its last notebook).
// Config keys left out take the server's defaults (server/lib/gameConfig.js).

export const PRESETS = {
  pilot: {
    description: "Pilot: python, int→graph[any], 3 teams, 2 rounds",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", rounds: 2 },
    lineup: [["luna", "sonnet"], ["grace", "haiku"], ["tess", "sonnet"]],
  },
  graphs: {
    description: "python, int→graph[any], 6 teams, 5 rounds",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", rounds: 5 },
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["theo", "sonnet"], ["luna", "sonnet"], ["priya", "sonnet"], ["grace", "haiku"]],
  },
};
