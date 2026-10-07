// Presets for fresh arenas: game settings, the founding lineup, and how the runner paces sessions.
// Lineup entries: [source, model] where source is a founder slug ("tess" or "founder:tess") or "from:<persona id>"
// (a persona from an earlier arena: same prompt and team name, plus its last notebook). Models: opus, sonnet, haiku
// (never a Fable model).
// Config keys left out take the server's defaults (server/lib/gameConfig.js): 2-minute games, a feeding bee sits out 10
// rounds, change budgets of one minute's worth, a 50-byte bee MEMORY. maxResponseBytes, grains, pollenGrain and the flower's budget range (R from minMs to ms) are always
// set (MAX_RESPONSE_BYTES, GRAINS, POLLEN_GRAIN, FLOWER_MIN_MS and FLOWER_MAX_MS).
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

// The most UTF-8 bytes of a flower's response (its JSON text): set explicitly in every preset so it is one place to change.
// 64 KiB, the server's default (a garden of big responses can store tens of MB per game-second at a megabyte).
export const MAX_RESPONSE_BYTES = 65536;
// Pollen grains, set explicitly in every preset: who sees a feed's grain during play ("feeder": the feeding bee's team;
// "public"; "off"), and its length, ⌊scale × pollen^exponent⌋ characters of the answering flower's minified code (the
// server's defaults).
export const GRAINS = "feeder";
// Each flower call's hidden time budget R, uniform on [minMs, ms] (the server's defaults: 50 to 150 ms). Every preset's
// flower budget gets these two (FLOWER_BUDGET), so the range is one place to change.
export const FLOWER_MIN_MS = 50, FLOWER_MAX_MS = 150;
const FLOWER_R = { ms: FLOWER_MAX_MS, minMs: FLOWER_MIN_MS };
export const POLLEN_GRAIN = Object.freeze({ exponent: 1 / 3, scale: 1 });

export const DEFAULT_SESSION = { warmupSeconds: 8, gapSeconds: 5, maxIdleGapSeconds: 20, endMarginSeconds: 10, maxMinutes: 6 };

export const PRESETS = {
  pilot: {
    description: "Pilot: one flower per team, python, int→int, 3 teams (sonnet/haiku), games of 30 s, 1 and 2 minutes",
    config: { language: "python", challengeType: "int", responseType: "int", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [0.5, 1, 2],
    lineup: [["luna", "sonnet"], ["grace", "haiku"], ["tess", "sonnet"]],
    maxModel: "sonnet",
    session: { warmupSeconds: 8, gapSeconds: 3, maxIdleGapSeconds: 20, endMarginSeconds: 8, maxMinutes: 5 },
    limits: { sonnet: { turns: 30, usd: 0.9 }, haiku: { turns: 30, usd: 0.45 } },
    reserveUsd: 2.5,
  },
  graphs: {
    description: "One flower per team, python, int→graph[any], 4 teams (2 opus, 2 sonnet), games of 2, 5 and 10 minutes, scaffolds",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [2, 5, 10],
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["rosalind", "sonnet"], ["priya", "sonnet"]],
    session: { warmupSeconds: 10, gapSeconds: 15, maxIdleGapSeconds: 120, endMarginSeconds: 20, maxMinutes: 6 },
    limits: { lobby: { opus: { turns: 40, usd: 2.0 }, sonnet: { turns: 40, usd: 1.0 } }, game: { opus: { turns: 20, usd: 0.5 }, sonnet: { turns: 20, usd: 0.3 } } },
    scaffold: { cpuShare: 0.15 },
    reserveUsd: 4,
    noEvolution: true, // the same four teams in every game, so durations compare like with like
  },
  cohort6: {
    description: "One flower per team, python, int→graph[any], 6 teams (3 opus, 3 sonnet), 5-minute games, scaffolds, retirement and breeding",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [5],
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["ada", "opus"], ["rosalind", "sonnet"], ["priya", "sonnet"], ["theo", "sonnet"]],
    session: { warmupSeconds: 10, gapSeconds: 15, maxIdleGapSeconds: 120, endMarginSeconds: 20, maxMinutes: 6 },
    limits: { lobby: { opus: { turns: 40, usd: 2.0 }, sonnet: { turns: 40, usd: 1.0 } }, game: { opus: { turns: 20, usd: 0.5 }, sonnet: { turns: 20, usd: 0.3 } } },
    scaffold: { cpuShare: 0.1 }, // six scaffolds share the machine with the garden: keep them light
    reserveUsd: 3,
  },
  // The pilot and the signals experiment (EXPERIMENTS): every cohort plays this preset; only `common` differs. 10-minute
  // games, so cycles of innovation and imitation have time to happen; the csig founders.
  cohort10: {
    description: "python, int→graph[any], 6 teams (3 opus, 3 sonnet), 10-minute games, scaffolds, retirement and breeding",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [10],
    lineup: [["mallory", "opus"], ["kenji", "opus"], ["ada", "opus"], ["rosalind", "sonnet"], ["priya", "sonnet"], ["theo", "sonnet"]],
    session: { warmupSeconds: 10, gapSeconds: 15, maxIdleGapSeconds: 120, endMarginSeconds: 20, maxMinutes: 6 },
    limits: { lobby: { opus: { turns: 40, usd: 2.0 }, sonnet: { turns: 40, usd: 1.0 } }, game: { opus: { turns: 20, usd: 0.5 }, sonnet: { turns: 20, usd: 0.3 } } },
    scaffold: { cpuShare: 0.1 }, // six scaffolds share the machine with the garden: keep them light
    reserveUsd: 3,
  },
  // The same shape for dry runs with the stub `claude` (no model calls): graph responses, 30-second games.
  "dry-cohort": {
    description: "dry run of the cohort experiment: python, int→graph[any], 6 teams, 30-second games, retirement and breeding",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [0.5],
    lineup: [["mallory", "sonnet"], ["kenji", "sonnet"], ["ada", "sonnet"], ["rosalind", "haiku"], ["priya", "haiku"], ["theo", "haiku"]],
    session: { warmupSeconds: 3, gapSeconds: 2, maxIdleGapSeconds: 4, endMarginSeconds: 3, maxMinutes: 2 },
    scaffold: { cpuShare: 0.1 },
    reserveUsd: 0,
  },
  // For dry runs with the stub `claude` (no model calls): int→int, 20-second games, evolution on.
  dry: {
    description: "dry run: one flower per team, python, int→int, 4 teams, 20-second games, retirement and breeding",
    config: { language: "python", challengeType: "int", responseType: "int", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [0.34],
    lineup: [["mallory", "sonnet"], ["kenji", "sonnet"], ["rosalind", "haiku"], ["priya", "haiku"]],
    session: { warmupSeconds: 3, gapSeconds: 2, maxIdleGapSeconds: 4, endMarginSeconds: 3, maxMinutes: 2 },
    scaffold: { cpuShare: 0.1 },
    reserveUsd: 0,
  },
};

// Cohort experiments: identical arenas (same preset, founders and models; evolution on) that differ only in the documents
// every team in the cohort gets as common knowledge (`common`: a folder copied into common/ in every workspace at every
// game, named in every session's system prompt). Run with `node arena/run.js --experiment <name>`: the cohorts play one
// game at a time, interleaved (game 1 of each, then game 2 of each, ...; the order rotates every game), so one garden has
// the machine at a time. Each cohort's judges and breeders see only its own ideas, spawns and outcomes (plus arenas outside
// the experiment); breeders never see the documents. Arena ids are neutral: breeders see them.
//   { description, preset, games, gameUsd (a game starts only if every cohort can afford this), capUsd (the experiment's
//     own spend: each cohort is capped at capUsd ÷ cohorts; --budget overrides that per cohort), cohorts: [{ id, arm,
//     label?, common? }] }
// The runner refuses to start an experiment whose common-knowledge folder is missing or empty.
const IDEAS_DIR = "arena/priming/one-flower-ideas";
const DRY_COMMON = process.env.ARENA_DRY_COMMON || IDEAS_DIR;
export const EXPERIMENTS = {
  // Step 1: a pilot of the new mechanics (no history for programs, a 50-byte MEMORY with fed, pollen grains, the clock
  // that starts at zero, the flower's hidden time budget) before spending more: one unprimed cohort, two 10-minute games.
  pilot: {
    description: "pilot of the new mechanics: one unprimed cohort (3 opus, 3 sonnet), 2 games of 10 minutes, int→graph[any], evolution on",
    preset: "cohort10",
    games: 2,
    gameUsd: 13,
    capUsd: 35,
    cohorts: [{ id: "kiln-a", arm: "control", label: "pilot" }],
  },
  // Step 2: does exploring a wide range of type-specific signals produce sustained dynamism? Two unprimed and two primed
  // cohorts (the primed ones get one-flower-ideas: type-specific graph signal ideas), interleaved one game at a time;
  // cohort ids are neutral (teams see them in their paths, breeders in their prompts), the arm and label stay with the
  // runner and the analysis.
  signals: {
    description: "type-specific signal ideas: two unprimed and two primed cohorts (one-flower-ideas), 3 games of 10 minutes each, interleaved",
    preset: "cohort10",
    games: 3,
    gameUsd: 12, // a game starts only if every cohort can afford this much more (an estimate of one 10-minute cohort-game)
    capUsd: 150,
    cohorts: [
      { id: "fen-a", arm: "control", label: "control-a" },
      { id: "fen-b", arm: "ideas", label: "ideas-a", common: { dir: IDEAS_DIR } },
      { id: "fen-c", arm: "control", label: "control-b" },
      { id: "fen-d", arm: "ideas", label: "ideas-b", common: { dir: IDEAS_DIR } },
    ],
  },
  // The same with the stub `claude` and 30-second games (ARENA_DRY_COMMON: another folder for the primed arm).
  "pilot-dry": {
    description: "dry run of the pilot with the stub claude",
    preset: "dry-cohort",
    games: 2,
    gameUsd: 0,
    cohorts: [{ id: "dry-p", arm: "control", label: "pilot" }],
  },
  "signals-dry": {
    description: "dry run of the signals experiment with the stub claude",
    preset: "dry-cohort",
    games: 2,
    gameUsd: 0,
    cohorts: [
      { id: "dry-a", arm: "control", label: "control-a" },
      { id: "dry-b", arm: "ideas", label: "ideas-a", common: { dir: DRY_COMMON } },
      { id: "dry-c", arm: "control", label: "control-b" },
      { id: "dry-d", arm: "ideas", label: "ideas-b", common: { dir: DRY_COMMON } },
    ],
  },
};
