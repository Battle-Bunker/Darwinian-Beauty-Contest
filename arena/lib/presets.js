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
//                  (up to maxIdleGapSeconds; back to gapSeconds after a submission; idleBackoff false: always gapSeconds);
//                  endMarginSeconds: no new session with less game time left than this; maxMinutes: wall-clock cap of one
//                  session (the game ending stops it anyway); lobbyMinutes: wall-clock cap of a lobby session (told to the
//                  team); effort: the CLI's --effort for every team session; nice: the sessions' CPU priority (default 5)
//   prompts        { brevity: false }: no "be quick", "at most N tool calls" or "short summary" lines in the briefs
//   concurrency    model sessions and calls at once (ARENA_CONCURRENCY overrides it; default 8)
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

// The adapt lineup. Veterans: the best instance of each distinct persona over the pilot and signals arenas, by mean
// fitness percentile over its games ((N − rank) / (N − 1)): Mallory fen-d 1.00 (3 games), Kenji fen-a 0.87, Ada fen-a
// 0.80, Theo kiln-a 0.70 (2), Rosalind fen-c 0.60 (2), Priya fen-a 0.60, and Bao (12) fen-c 0.40 (1 game: the best of
// the rest once the six founders are taken). Their own models. New role personas on opus.
const HONEST_DIR = process.env.ARENA_HONEST_DIR || "arena/priming/honest-signals"; // (another folder for a dry run)
const VETERAN = { seed: true };
const ADAPT_LINEUP = [
  ["from:fen-d/mallory", "opus", VETERAN], ["from:fen-a/kenji", "opus", VETERAN], ["from:fen-a/ada", "opus", VETERAN],
  ["from:kiln-a/theo", "sonnet", VETERAN], ["from:fen-c/rosalind", "sonnet", VETERAN], ["from:fen-a/priya", "sonnet", VETERAN],
  ["from:fen-c/bao-12", "sonnet", VETERAN],
  ["ines", "opus", { role: "honest", common: HONEST_DIR }], ["marcus", "opus", { role: "honest", common: HONEST_DIR }],
  ["sofia", "opus", { role: "honest", common: HONEST_DIR }], ["tobi", "opus", { role: "honest", common: HONEST_DIR }],
  ["amara", "opus", { role: "honest", common: HONEST_DIR }],
  ["rex", "opus", { role: "defector" }], ["vik", "opus", { role: "defector" }],
];

// adapt-hi: the same 14 teams and roles, every agent on opus with high effort and room to think. Veterans start as in
// adapt (carried over from fen and kiln, not from mesa-a); the four kids without their coding limits (personas.js
// CODING_LIMITS). The honest specialists' flowers are on a fixed contract (prompts.js honest60: 60% of R on costly
// signalling, percent 50, only their signalling strategy changing, and only to escape imitators); their bees play to win
// and start as the reference fingerprint-checking bee of arena/priming/honest-signals/ (ARENA_HONEST_START_BEE: another
// file, for a dry run before it exists).
const HONEST_START_BEE = process.env.ARENA_HONEST_START_BEE || `${HONEST_DIR}/reference_bee.py`;
const HI_HONEST = { role: "honest", brief: "r60", common: HONEST_DIR, start: { bee: HONEST_START_BEE } };
const HI_KID = { seed: true, uncap: true };
const ADAPT_HI_LINEUP = [
  ["from:fen-d/mallory", "opus", VETERAN], ["from:fen-a/kenji", "opus", HI_KID], ["from:fen-a/ada", "opus", VETERAN],
  ["from:kiln-a/theo", "opus", HI_KID], ["from:fen-c/rosalind", "opus", VETERAN], ["from:fen-a/priya", "opus", HI_KID],
  ["from:fen-c/bao-12", "opus", HI_KID],
  ["ines", "opus", HI_HONEST], ["marcus", "opus", HI_HONEST], ["sofia", "opus", HI_HONEST], ["tobi", "opus", HI_HONEST], ["amara", "opus", HI_HONEST],
  ["rex", "opus", { role: "defector" }], ["vik", "opus", { role: "defector" }],
];
// adapt-hi's game config: the engine's defaults for what changed (the R floor, 2% of 150 ms; a feed costs 20 rounds; the
// score exponents), so none of them is set here.
const HI_CONFIG = { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN,
  budgets: { flower: { ms: FLOWER_MAX_MS } } };

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
  // The adapt experiment (EXPERIMENTS.adapt): 7 veterans of the pilot and signals arenas, carried over as they were (the
  // best instance of each persona by mean fitness percentile over its games: its persona, its last programs, its notes and
  // workspace files; its own model), 5 honesty specialists and 2 defection specialists (new personas on opus, each with
  // a private role brief; the honest ones get arena/priming/honest-signals/). Fixed membership, 4 games.
  adapt14: {
    description: "adapt: 7 veterans of the cheap-signalling arenas, 5 honesty and 2 defection specialists; python, int→graph[any], 10-minute games, fixed membership",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [10],
    lineup: ADAPT_LINEUP,
    session: { warmupSeconds: 10, gapSeconds: 15, maxIdleGapSeconds: 120, endMarginSeconds: 20, maxMinutes: 6 },
    limits: { lobby: { opus: { turns: 40, usd: 2.0 }, sonnet: { turns: 40, usd: 1.0 } }, game: { opus: { turns: 20, usd: 0.5 }, sonnet: { turns: 20, usd: 0.3 } } },
    scaffold: { cpuShare: 0.05 }, // fourteen scaffolds share the machine with the garden
    reserveUsd: 4,
    noEvolution: true, // the composition stays fixed: no retirement, no breeding (interviews and judges still run)
  },
  // adapt-hi (EXPERIMENTS["adapt-hi"]): the same arena with everyone on opus at high effort, no brevity nudges, caps of
  // $6 / 100 turns in the lobby and $3 / 60 turns a session in play, a 10-minute lobby, a constant 5-second gap between
  // sessions, sessions at nice 10, and as many sessions at once as there are teams (and two for interviews and judges).
  adapt14hi: {
    description: "adapt-hi: adapt's 14 teams, all on opus at high effort; the honest specialists on a fixed 60%-of-R contract; python, int→graph[any], 10-minute games, fixed membership",
    config: HI_CONFIG,
    minutesByGame: [10],
    lineup: ADAPT_HI_LINEUP,
    session: { warmupSeconds: 10, gapSeconds: 5, idleBackoff: false, maxIdleGapSeconds: 5, endMarginSeconds: 20, maxMinutes: 10, lobbyMinutes: 10, effort: "high", nice: 10 },
    limits: { lobby: { opus: { turns: 100, usd: 6 } }, game: { opus: { turns: 60, usd: 3 } } },
    prompts: { brevity: false },
    concurrency: 16,
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 10,
    noEvolution: true,
  },
  // Its capacity check with the stub `claude` (stub honest flowers burn 0.6 × R): 1-minute games, a 1-minute lobby. The
  // R floor and the feed cost are set to the engine's new defaults here, so the check holds before the engine has them.
  "dry-adapt-hi": {
    description: "dry run of adapt-hi: the same 14 teams with the stub claude, 1-minute games, fixed membership",
    config: { ...HI_CONFIG, feedCost: 20, budgets: { flower: { ms: FLOWER_MAX_MS, minMs: 3 } } },
    minutesByGame: [1],
    lineup: ADAPT_HI_LINEUP,
    session: { warmupSeconds: 3, gapSeconds: 2, idleBackoff: false, maxIdleGapSeconds: 2, endMarginSeconds: 3, maxMinutes: 2, lobbyMinutes: 1, effort: "high", nice: 10 },
    prompts: { brevity: false },
    concurrency: 16,
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 0,
    noEvolution: true,
  },
  // Its capacity check with the stub `claude`: the same 14 teams, 1-minute games (the stub's honest flowers burn most of
  // their R in CPU).
  "dry-adapt": {
    description: "dry run of adapt: the same 14 teams with the stub claude, 1-minute games, fixed membership",
    config: { language: "python", challengeType: "int", responseType: "graph[any]", maxResponseBytes: MAX_RESPONSE_BYTES, grains: GRAINS, pollenGrain: POLLEN_GRAIN, budgets: { flower: FLOWER_R } },
    minutesByGame: [1],
    lineup: ADAPT_LINEUP,
    session: { warmupSeconds: 3, gapSeconds: 2, maxIdleGapSeconds: 4, endMarginSeconds: 3, maxMinutes: 2 },
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 0,
    noEvolution: true,
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
  // Will veterans of the cheap-signalling arenas adapt when honest, costly signallers (always 50%) and defectors (always
  // 0%, imitating the most-fed flowers) share their garden? One arena of 14, fixed membership, 4 games.
  adapt: {
    description: "adapt: 7 veterans of the cheap-signalling arenas with 5 honesty specialists and 2 defection specialists; 4 games of 10 minutes",
    preset: "adapt14",
    games: 4,
    gameUsd: 25, // a game starts only if this much more fits under the cap (an estimate of one 10-minute game of 14 teams)
    capUsd: 120,
    cohorts: [{ id: "mesa-a", arm: "adapt", label: "adapt" }],
  },
  // adapt-hi: the same question with agents given room to think (all opus, high effort, higher caps, no brevity nudges, a
  // 10-minute lobby); the honest flowers on a fixed contract (60% of R on costly signalling, percent 50), their bees
  // starting as the reference fingerprint bee. Played under the engine's new defaults (R from 3 to 150 ms, a feed costs 20 rounds, score exponents 0.85).
  "adapt-hi": {
    description: "adapt-hi: adapt's 14 teams with all agents on opus at high effort and the honest specialists on a fixed 60%-of-R contract; 4 games of 10 minutes",
    preset: "adapt14hi",
    games: 4,
    gameUsd: 100, // a game starts only if this much more fits under the cap (14 opus teams: lobby up to $6 and play up to $3 a session)
    capUsd: 600,
    cohorts: [{ id: "mesa-b", arm: "adapt-hi", label: "adapt-hi" }],
  },
  "adapt-hi-dry": {
    description: "capacity check of adapt-hi with the stub claude: 14 teams, 1-minute games, honest flowers at 0.6 × R",
    preset: "dry-adapt-hi",
    games: 2,
    gameUsd: 0,
    cohorts: [{ id: "dry-h", arm: "adapt-hi", label: "adapt-hi" }],
  },
  "adapt-dry": {
    description: "capacity check of adapt with the stub claude: 14 teams, 1-minute games",
    preset: "dry-adapt",
    games: 2,
    gameUsd: 0,
    cohorts: [{ id: "dry-m", arm: "adapt", label: "adapt" }],
  },
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
