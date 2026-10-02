// Presets for fresh arenas: game settings, the founding lineup, and how the runner paces sessions.
// Lineup entries: [source, model] where source is a founder slug ("tess" or "founder:tess") or "from:<persona id>"
// (a persona from an earlier arena: same prompt and team name, plus its last notebook). Models: opus, sonnet, haiku
// (never a Fable model).
// Config keys left out take the server's defaults (server/lib/gameConfig.js): 2-minute games, a feeding bee sits out 10
// rounds, change budgets of one minute's worth.
//
//   minutesByGame  game N lasts minutesByGame[N-1] minutes (the last entry repeats); else config.minutes
//   session        warmupSeconds: the first in-game sessions start this long before the game does;
//                  gapSeconds: pause between one team's sessions; endMarginSeconds: no new session with less game
//                  time left than this; maxMinutes: wall-clock cap of one session (the game ending stops it anyway)
//   limits         per-model session limits (turns, usd), optionally per phase: { lobby: {...}, game: {...} }
//   maxModel       "sonnet": calls that would use opus (judges, breeders) use sonnet instead
//   reserveUsd     no new team session once the spend is within this of the cap (keeps money for interviews and judges)
//   noEvolution    fixed membership (no retirements or breeding)
//   examples       a folder copied into every workspace as examples/ (and named in the lobby brief)

export const DEFAULT_SESSION = { warmupSeconds: 8, gapSeconds: 5, endMarginSeconds: 10, maxMinutes: 6 };

export const PRESETS = {
  pilot: {
    description: "Pilot: python, int→int, 3 teams (sonnet/haiku), games of 30 s, 1 and 2 minutes",
    config: { language: "python", challengeType: "int", responseType: "int" },
    minutesByGame: [0.5, 1, 2],
    lineup: [["luna", "sonnet"], ["grace", "haiku"], ["tess", "sonnet"]],
    maxModel: "sonnet",
    session: { warmupSeconds: 8, gapSeconds: 3, endMarginSeconds: 8, maxMinutes: 5 },
    limits: { sonnet: { turns: 30, usd: 0.9 }, haiku: { turns: 30, usd: 0.45 } },
    reserveUsd: 2.5,
  },
  graphs: {
    description: "python, int→graph[any], 6 teams, 2-minute games",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", minutes: 2 },
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["theo", "sonnet"], ["luna", "sonnet"], ["priya", "sonnet"], ["grace", "haiku"]],
    reserveUsd: 10,
  },
  "graphs-examples": {
    description: "python, int→graph[any], 6 teams, 2-minute games, every team gets the example flowers (arena/examples/v3)",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", minutes: 2 },
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["theo", "sonnet"], ["luna", "sonnet"], ["priya", "sonnet"], ["grace", "haiku"]],
    examples: "arena/examples/v3",
    reserveUsd: 10,
  },
};
