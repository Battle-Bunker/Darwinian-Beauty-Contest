// Presets for fresh arenas: game settings, the founding lineup, and how the runner paces sessions.
// Lineup entries: [source, model] where source is a founder slug ("tess" or "founder:tess") or "from:<persona id>"
// (a persona from an earlier arena: same prompt and team name, plus its last notebook). Models: opus, sonnet, haiku
// (never a Fable model).
// Config keys left out take the server's defaults (server/lib/gameConfig.js): 2-minute games, a feeding bee sits out 10
// rounds, change budgets of one minute's worth.
//
//   minutesByGame  game N lasts minutesByGame[N-1] minutes (the last entry repeats); else config.minutes
//   session        warmupSeconds: the first in-game sessions start this long before the game does;
//                  gapSeconds: pause between one team's sessions, doubling after each session that submitted nothing
//                  (up to maxIdleGapSeconds; back to gapSeconds after a submission); endMarginSeconds: no new session with less game
//                  time left than this; maxMinutes: wall-clock cap of one session (the game ending stops it anyway)
//   limits         per-model session limits (turns, usd), optionally per phase: { lobby: {...}, game: {...} }
//   maxModel       "sonnet": calls that would use opus (judges, breeders) use sonnet instead
//   reserveUsd     no new team session once the spend is within this of the cap (keeps money for interviews and judges)
//   noEvolution    fixed membership (no retirements or breeding)
//   examples       a folder copied into every workspace as examples/ (and named in the lobby brief)
//   scaffold       limits of the teams' scaffolds (lib/scaffold.js SCAFFOLD_LIMITS: cpuShare, memMB, cpuSeconds, ...)

export const DEFAULT_SESSION = { warmupSeconds: 8, gapSeconds: 5, maxIdleGapSeconds: 20, endMarginSeconds: 10, maxMinutes: 6 };

export const PRESETS = {
  pilot: {
    description: "Pilot: python, int→int, 3 teams (sonnet/haiku), games of 30 s, 1 and 2 minutes",
    config: { language: "python", challengeType: "int", responseType: "int" },
    minutesByGame: [0.5, 1, 2],
    lineup: [["luna", "sonnet"], ["grace", "haiku"], ["tess", "sonnet"]],
    maxModel: "sonnet",
    session: { warmupSeconds: 8, gapSeconds: 3, maxIdleGapSeconds: 20, endMarginSeconds: 8, maxMinutes: 5 },
    limits: { sonnet: { turns: 30, usd: 0.9 }, haiku: { turns: 30, usd: 0.45 } },
    reserveUsd: 2.5,
  },
  graphs: {
    description: "python, int→graph[any], 4 teams (2 opus, 2 sonnet), games of 2, 5 and 10 minutes, scaffolds",
    config: { language: "python", challengeType: "int", responseType: "graph[any]" },
    minutesByGame: [2, 5, 10],
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["rosalind", "sonnet"], ["priya", "sonnet"]],
    session: { warmupSeconds: 10, gapSeconds: 15, maxIdleGapSeconds: 120, endMarginSeconds: 20, maxMinutes: 6 },
    limits: { lobby: { opus: { turns: 40, usd: 2.0 }, sonnet: { turns: 40, usd: 1.0 } }, game: { opus: { turns: 20, usd: 0.5 }, sonnet: { turns: 20, usd: 0.3 } } },
    scaffold: { cpuShare: 0.15 },
    reserveUsd: 4,
    noEvolution: true, // the same four teams in every game, so durations compare like with like
  },
  // The costly-signalling priming experiment (EXPERIMENTS.csig): every cohort plays this preset; only `common` differs.
  cohort6: {
    description: "python, int→graph[any], 6 teams (3 opus, 3 sonnet), 5-minute games, scaffolds, retirement and breeding",
    config: { language: "python", challengeType: "int", responseType: "graph[any]" },
    minutesByGame: [5],
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["ada", "opus"], ["rosalind", "sonnet"], ["priya", "sonnet"], ["theo", "sonnet"]],
    session: { warmupSeconds: 10, gapSeconds: 15, maxIdleGapSeconds: 120, endMarginSeconds: 20, maxMinutes: 6 },
    limits: { lobby: { opus: { turns: 40, usd: 2.0 }, sonnet: { turns: 40, usd: 1.0 } }, game: { opus: { turns: 20, usd: 0.5 }, sonnet: { turns: 20, usd: 0.3 } } },
    scaffold: { cpuShare: 0.1 }, // six scaffolds share the machine with the garden: keep them light
    reserveUsd: 3,
  },
  // The same shape for dry runs with the stub `claude` (int→int: the stub's programs), short games.
  "dry-cohort": {
    description: "dry run of the cohort experiment: python, int→int, 6 teams, 20-second games, retirement and breeding",
    config: { language: "python", challengeType: "int", responseType: "int" },
    minutesByGame: [0.34],
    lineup: [["mallory", "sonnet"], ["kenji", "sonnet"], ["ada", "sonnet"], ["rosalind", "haiku"], ["priya", "haiku"], ["theo", "haiku"]],
    session: { warmupSeconds: 3, gapSeconds: 2, maxIdleGapSeconds: 4, endMarginSeconds: 3, maxMinutes: 2 },
    scaffold: { cpuShare: 0.1 },
    reserveUsd: 0,
  },
  "graphs-examples": {
    description: "python, int→graph[any], 6 teams, 2-minute games, every team gets the example flowers (arena/examples/v3)",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", minutes: 2 },
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["theo", "sonnet"], ["luna", "sonnet"], ["priya", "sonnet"], ["grace", "haiku"]],
    examples: "arena/examples/v3",
    reserveUsd: 10,
  },
};

// Cohort experiments: identical arenas (same preset, founders and models; evolution on) that differ only in the documents
// every team in the cohort gets as common knowledge (`common`: a folder copied into common/ in every workspace at every
// game, named in every session's system prompt). Run with `node arena/run.js --experiment <name>`: the cohorts play one
// game at a time, interleaved (game 1 of each, then game 2 of each, ...; the order rotates every game), so one garden has
// the machine at a time. Each cohort's judges and breeders see only its own ideas, spawns and outcomes (plus arenas outside
// the experiment); breeders never see the documents. Arena ids are neutral: breeders see them.
export const EXPERIMENTS = {
  csig: {
    description: "costly-signalling priming: A control, B a common-knowledge concept document, C common-knowledge example recipes",
    preset: "cohort6",
    games: 6,
    gameUsd: 9, // a game starts only if every cohort has at least this left under its cap (an estimate of one game's cost)
    cohorts: [
      { id: "csig-a", arm: "control" },
      { id: "csig-b", arm: "concept", common: { dir: "arena/priming/concept" } },
      { id: "csig-c", arm: "recipes", common: { dir: "arena/priming/recipes" } },
    ],
  },
  "dry-csig": {
    description: "dry run of csig with the stub claude",
    preset: "dry-cohort",
    games: 3,
    gameUsd: 0,
    cohorts: [
      { id: "dry-csig-a", arm: "control" },
      { id: "dry-csig-b", arm: "concept", common: { dir: "arena/priming/concept" } },
      { id: "dry-csig-c", arm: "recipes", common: { dir: "arena/priming/recipes" } },
    ],
  },
};
