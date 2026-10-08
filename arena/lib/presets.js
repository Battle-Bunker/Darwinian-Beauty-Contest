// Presets for fresh arenas: game settings, the founding lineup, and how the runner paces sessions.
// Lineup entries: [source, model] where source is a founder slug ("tess" or "founder:tess") or "from:<persona id>"
// (a persona from an earlier arena: same prompt and team name, plus its last notebook). Models: opus, sonnet, haiku
// (never a Fable model).
// Every preset sets its game rules explicitly and checks every one of them on each new game (expectConfig), so a change of
// the engine's defaults (server/lib/gameConfig.js) can never silently change a preset: the presets up to adapt play the
// rules they ran under (OLD_RULES), adapt-hi the ones it was built for (HI_RULES), coop-eq metagame v2's (COOP_RULES).
// Only the game's length is left to the runner (minutesByGame) or the server's default.
//
//   minutesByGame  game N lasts minutesByGame[N-1] minutes (the last entry repeats); else config.minutes
//   session        warmupSeconds: the first in-game sessions start this long before the game does;
//                  gapSeconds: pause between one team's sessions, doubling after each session that submitted nothing
//                  (up to maxIdleGapSeconds; back to gapSeconds after a submission; idleBackoff false: always gapSeconds);
//                  endMarginSeconds: no new session with less game time left than this; maxMinutes: wall-clock cap of one
//                  session (the game ending stops it anyway); lobbyMinutes: wall-clock cap of a lobby session (told to the
//                  team); effort: the CLI's --effort for every team session; nice: the sessions' CPU priority (default 5);
//                  penaltyMinutes: how long a team waits after a session with a fair-play violation (default maxMinutes)
//   prompts        { brevity: false }: no "be quick", "at most N tool calls" or "short summary" lines in the briefs;
//                  { simpleCode: false }: no steer toward code a kid can follow (with fixed teams the interview is only
//                  described: nothing depends on its scores)
//   concurrency    model sessions and calls at once (ARENA_CONCURRENCY overrides it; default 8)
//   expectConfig   { "dotted.key": value } the server's config must have (checked when a game is created)
//   social         false: no interviews and no judges after a game (with fixed teams nothing depends on them)
//   honest         the cooperators' mandate { burnMin, nectarMin, startBurn, startNectar } (role brief "contract"): CPU at
//                  b × R on costly signalling with b ≥ burnMin, percent ≥ nectarMin, starting at startBurn and
//                  startNectar; used in the brief, the conformance metrics, the role-drift log and adapt.js
//   limits         per-model session limits (turns, usd), optionally per phase: { lobby: {...}, game: {...} }
//   maxModel       "sonnet": calls that would use opus (judges, breeders) use sonnet instead
//   reserveUsd     no new team session once the spend is within this of the cap (keeps money for interviews and judges)
//   noEvolution    fixed membership (no retirements or breeding)
//   examples       a folder copied into every workspace as examples/ (and named in the lobby brief)
//   scaffold       limits of the teams' scaffolds (lib/scaffold.js SCAFFOLD_LIMITS: cpuShare, memMB, cpuSeconds, ...)

// The most UTF-8 bytes of a flower's response (its JSON text): set explicitly in every preset so it is one place to change.
// 64 KiB in the old presets (a garden of big responses can store tens of MB per game-second at a megabyte).
export const MAX_RESPONSE_BYTES = 65536;
// Pollen grains, set explicitly in every preset: who sees a feed's grain during play ("feeder": the feeding bee's team;
// "public"; "off"), and its length, ⌊scale × pollen^exponent⌋ characters of the answering flower's minified code (the
// server's defaults).
export const GRAINS = "feeder";
// Each flower call's hidden time budget R, uniform on [minMs, ms]: 50 to 150 ms in the old presets (FLOWER_R).
export const FLOWER_MIN_MS = 50, FLOWER_MAX_MS = 150;
const FLOWER_R = { ms: FLOWER_MAX_MS, minMs: FLOWER_MIN_MS };
export const POLLEN_GRAIN = Object.freeze({ exponent: 1 / 3, scale: 1 });
/** { "a.b": value } for every leaf of an object: the keys a preset's expectConfig checks. */
const leaves = (o, at = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v, `${at}${k}.`) : [[`${at}${k}`, v]]));
const expectOf = (rules) => Object.fromEntries(leaves(rules));

// The rules every arena up to adapt ran under (pilot, signals and adapt: kiln-a, fen-a to fen-d and mesa-a all stored
// exactly these), every key set so that no change of the engine's defaults can change an old preset: a feed takes the
// bee out for 10 rounds and costs nothing, responses reach the bee at 150 ms with R from 50 to 150 ms, change budgets of
// one minute's worth (flower 220 a minute, banking 220; bee 2,200 and 2,200), E in node·ms (no byte factor) with 64 KiB
// responses, √ scores (exponents 0.5: exactly the legacy √), grains of ⌊pollen^(1/3)⌋ characters, and no prevalence
// (every bee each round, species drawn uniformly). OLD_EXPECT checks them all on each new game (a metagame v2 engine
// stores feedPrice and flowerWindowMs; one from before it fails the check on those two).
const OLD_RULES = { feedCost: 10, feedPrice: 0, flowerWindowMs: FLOWER_MAX_MS, maxResponseBytes: MAX_RESPONSE_BYTES, maxLen: 64, maxNodes: 512,
  revealOnFinish: true, grains: GRAINS, pollenGrain: POLLEN_GRAIN, energy: { bytes: false }, scoring: { alpha: 0.5, beta: 0.5 }, prevalence: { on: false },
  budgets: { flower: { size: 1100, perMinute: 220, cap: 220, ...FLOWER_R }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 } } };
const OLD_EXPECT = expectOf(OLD_RULES);
/** An old preset's game config: its language and types, on the old rules. */
const oldConfig = (responseType) => ({ language: "python", challengeType: "int", responseType, ...OLD_RULES });

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
// CODING_LIMITS). The honest specialists are pinned cooperators (prompts.js honestContract; the numbers in the preset's
// `honest`): not competing to win, they explore the spend (CPU at b × R, b ≥ burnMin, one fixed b per version) and the
// generosity (percent ≥ nectarMin) of honest costly signalling, and their fingerprint profile to escape imitators; their
// bees play to win. They start where the old mandate stood (b 0.6, percent 50). Their common/ is
// arena/priming/fingerprints/ (the shared repertoire, the reference programs and the cooperators' notes), and they start
// from its integrated flower and starter bee (ARENA_HONEST_HI_DIRS: other folders, comma-separated;
// ARENA_HONEST_START_FLOWER / ARENA_HONEST_START_BEE: other files, for a dry run).
const FINGERPRINT_DIR = "arena/priming/fingerprints";
const HONEST_HI_DIRS = process.env.ARENA_HONEST_HI_DIRS ? process.env.ARENA_HONEST_HI_DIRS.split(",") : [FINGERPRINT_DIR];
const HONEST_START_FLOWER = process.env.ARENA_HONEST_START_FLOWER || `${FINGERPRINT_DIR}/integrated.py`;
const HONEST_START_BEE = process.env.ARENA_HONEST_START_BEE || `${FINGERPRINT_DIR}/integrated_bee.py`;
const HI_HONEST = { role: "honest", brief: "contract", common: HONEST_HI_DIRS, start: { flower: HONEST_START_FLOWER, bee: HONEST_START_BEE } };
// The cooperators' mandate, in one place: floors on the share b of R spent on costly signalling in CPU and on the percent
// given, and the reference flower's start.
const HI_CONTRACT = { burnMin: 0.2, nectarMin: 20, startBurn: 0.6, startNectar: 50 };
const HI_KID = { seed: true, uncap: true };
const ADAPT_HI_LINEUP = [
  ["from:fen-d/mallory", "opus", VETERAN], ["from:fen-a/kenji", "opus", HI_KID], ["from:fen-a/ada", "opus", VETERAN],
  ["from:kiln-a/theo", "opus", HI_KID], ["from:fen-c/rosalind", "opus", VETERAN], ["from:fen-a/priya", "opus", HI_KID],
  ["from:fen-c/bao-12", "opus", HI_KID],
  ["ines", "opus", HI_HONEST], ["marcus", "opus", HI_HONEST], ["sofia", "opus", HI_HONEST], ["tobi", "opus", HI_HONEST], ["amara", "opus", HI_HONEST],
  ["rex", "opus", { role: "defector" }], ["vik", "opus", { role: "defector" }],
];
// adapt-hi's rules: the engine's defaults it was built for (before metagame v2), every key set: the R floor 3 ms (2% of
// 150), a feed takes the bee out for 20 rounds and costs nothing, responses at 150 ms, the old change budgets, the score
// exponents 0.85, E with the byte factor and a 1,024-byte response cap, grains of ⌊0.1 × pollen^(1/3)⌋ characters. It was
// built with the one-sided species prevalence, which a v2 engine no longer has (it reads that form as off): prevalence is
// off. HI_EXPECT checks every key on each new game.
const HI_RULES = { feedCost: 20, feedPrice: 0, flowerWindowMs: FLOWER_MAX_MS, maxResponseBytes: 1024, maxLen: 64, maxNodes: 512, revealOnFinish: true,
  grains: GRAINS, pollenGrain: { exponent: 1 / 3, scale: 0.1 }, energy: { bytes: true }, scoring: { alpha: 0.85, beta: 0.85 }, prevalence: { on: false },
  budgets: { flower: { size: 1100, perMinute: 220, cap: 220, ms: FLOWER_MAX_MS, minMs: 3 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 } } };
const HI_CONFIG = { language: "python", challengeType: "int", responseType: "graph[any]", ...HI_RULES };
const HI_EXPECT = expectOf(HI_RULES);

// coop-eq: can complex cooperation become a stable equilibrium that is hard to displace? 10 teams in one continuous
// 40-minute game: 7 pinned cooperators (adapt-hi's five honest specialists and two more, the same mandate and start
// programs), 1 pinned defector (Rex: percent 0, any other strategy, its bee to win) and 2 veterans carried over from their
// source arenas (Priya without her coding limits, and Mallory: the best mean ranks over mesa-a's games). One long game, so
// code is never revealed between games and imitation stays slow work paid from the change budget's trickle.
const COOP_LINEUP = [
  ["ines", "opus", HI_HONEST], ["marcus", "opus", HI_HONEST], ["sofia", "opus", HI_HONEST], ["tobi", "opus", HI_HONEST],
  ["amara", "opus", HI_HONEST], ["hana", "opus", HI_HONEST], ["owen", "opus", HI_HONEST],
  ["rex", "opus", { role: "defector", brief: "pinned" }],
  ["from:fen-a/priya", "opus", HI_KID], ["from:fen-d/mallory", "opus", VETERAN],
];
// coop-eq's rules, the engine's metagame v2 (server/lib/gameConfig.js; lib/prevalence.js reads them for the briefs and the
// analysis), all set here and checked on the game by COOP_EXPECT: prevalence on both sides (each round ⌈0.25 × N⌉ bees
// drawn by bee success, each visiting a species drawn by flower success; a 90 s half-life, c from 1 to 0.1, capped at 4,
// every ledger cell's prior 0.12 × Emax), the score the time-average of F × B; a feed price of 0.05 × Emax (feedPrice
// null: 2,816,000 node·ms·bytes) out of the bee's nectar and no rounds out; responses delivered at 150 ms (rounds stay
// 200 ms) while R runs from 1 to 50 ms; change budgets of 1 node a second for flowers (banking 300) and 10 for bees
// (3,000); E with the byte factor, a 1,024-byte response cap, exponents 0.85, grains of ⌊0.1 × pollen^(1/3)⌋ characters.
const COOP_RULES = { feedCost: 0, flowerWindowMs: 150, feedPrice: null, maxResponseBytes: 1024, maxLen: 64, maxNodes: 512, revealOnFinish: true,
  grains: GRAINS, pollenGrain: { exponent: 1 / 3, scale: 0.1 }, energy: { bytes: true }, scoring: { alpha: 0.85, beta: 0.85 }, prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null },
  budgets: { flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: 1 }, bee: { size: 11000, perMinute: 600, cap: 3000, ms: 50, memory: 50 } } };
const COOP_CONFIG = { language: "python", challengeType: "int", responseType: "graph[any]", ...COOP_RULES };
// ...every one of them checked on the game (an engine without v2 would drop or default some).
const COOP_EXPECT = expectOf(COOP_RULES);

export const DEFAULT_SESSION = { warmupSeconds: 8, gapSeconds: 5, maxIdleGapSeconds: 20, endMarginSeconds: 10, maxMinutes: 6 };

export const PRESETS = {
  pilot: {
    description: "Pilot: one flower per team, python, int→int, 3 teams (sonnet/haiku), games of 30 s, 1 and 2 minutes",
    config: oldConfig("int"),
    expectConfig: OLD_EXPECT,
    minutesByGame: [0.5, 1, 2],
    lineup: [["luna", "sonnet"], ["grace", "haiku"], ["tess", "sonnet"]],
    maxModel: "sonnet",
    session: { warmupSeconds: 8, gapSeconds: 3, maxIdleGapSeconds: 20, endMarginSeconds: 8, maxMinutes: 5 },
    limits: { sonnet: { turns: 30, usd: 0.9 }, haiku: { turns: 30, usd: 0.45 } },
    reserveUsd: 2.5,
  },
  graphs: {
    description: "One flower per team, python, int→graph[any], 4 teams (2 opus, 2 sonnet), games of 2, 5 and 10 minutes, scaffolds",
    config: oldConfig("graph[any]"),
    expectConfig: OLD_EXPECT,
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
    config: oldConfig("graph[any]"),
    expectConfig: OLD_EXPECT,
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
    config: oldConfig("graph[any]"),
    expectConfig: OLD_EXPECT,
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
    config: oldConfig("graph[any]"),
    expectConfig: OLD_EXPECT,
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
  // sessions, sessions at nice 15 (as the scaffolds), and as many sessions at once as there are teams (and two more for
  // interviews and judges).
  adapt14hi: {
    description: "adapt-hi: adapt's 14 teams, all on opus at high effort; the honest specialists on a fixed 60%-of-R contract; python, int→graph[any], 10-minute games, fixed membership",
    config: HI_CONFIG,
    minutesByGame: [10],
    lineup: ADAPT_HI_LINEUP,
    session: { warmupSeconds: 10, gapSeconds: 5, idleBackoff: false, maxIdleGapSeconds: 5, endMarginSeconds: 20, maxMinutes: 10, penaltyMinutes: 6, lobbyMinutes: 10, effort: "high", nice: 15 },
    limits: { lobby: { opus: { turns: 100, usd: 6 } }, game: { opus: { turns: 60, usd: 3 } } },
    prompts: { brevity: false, simpleCode: false },
    honest: HI_CONTRACT,
    concurrency: 16,
    expectConfig: HI_EXPECT,
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 10,
    noEvolution: true,
  },
  // Its capacity check with the stub `claude` (stub honest flowers burn 0.6 × R): 1-minute games, a 1-minute lobby. The
  // R floor, the feed cost and the response cap are set to the engine's new defaults here; the rest must come from the
  // server (expectConfig), so a dry run on an old server stops at once.
  "dry-adapt-hi": {
    description: "dry run of adapt-hi: the same 14 teams with the stub claude, 1-minute games, fixed membership",
    config: HI_CONFIG,
    expectConfig: HI_EXPECT,
    minutesByGame: [1],
    lineup: ADAPT_HI_LINEUP,
    session: { warmupSeconds: 3, gapSeconds: 2, idleBackoff: false, maxIdleGapSeconds: 2, endMarginSeconds: 3, maxMinutes: 2, lobbyMinutes: 1, effort: "high", nice: 15 },
    prompts: { brevity: false, simpleCode: false },
    honest: HI_CONTRACT,
    concurrency: 16,
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 0,
    noEvolution: true,
  },
  // coop-eq (EXPERIMENTS["coop-eq"]): adapt-hi's way of working (opus at high effort, its caps, no brevity nudges, no idle
  // backoff, 16 sessions at once, contained) for 10 teams in one 40-minute game after a 10-minute lobby; no interviews or
  // judges (social: false): nothing depends on them with fixed teams.
  coop10: {
    description: "coop-eq: 7 pinned cooperators, 1 pinned defector and 2 veterans, all on opus at high effort; one 40-minute game with prevalence on both sides",
    config: COOP_CONFIG,
    minutesByGame: [40],
    lineup: COOP_LINEUP,
    session: { warmupSeconds: 10, gapSeconds: 5, idleBackoff: false, maxIdleGapSeconds: 5, endMarginSeconds: 20, maxMinutes: 10, penaltyMinutes: 6, lobbyMinutes: 10, effort: "high", nice: 15 },
    limits: { lobby: { opus: { turns: 100, usd: 6 } }, game: { opus: { turns: 60, usd: 3 } } },
    prompts: { brevity: false, simpleCode: false },
    honest: HI_CONTRACT,
    concurrency: 16,
    expectConfig: COOP_EXPECT,
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 10,
    noEvolution: true,
    social: false,
  },
  // Its dry-run twin with the stub `claude`: a 3-minute game after a 1-minute lobby.
  "dry-coop10": {
    description: "dry run of coop-eq: the same 10 teams with the stub claude, one 3-minute game",
    config: COOP_CONFIG,
    minutesByGame: [3],
    lineup: COOP_LINEUP,
    session: { warmupSeconds: 3, gapSeconds: 2, idleBackoff: false, maxIdleGapSeconds: 2, endMarginSeconds: 3, maxMinutes: 2, lobbyMinutes: 1, effort: "high", nice: 15 },
    prompts: { brevity: false, simpleCode: false },
    honest: HI_CONTRACT,
    concurrency: 16,
    expectConfig: COOP_EXPECT,
    scaffold: { cpuShare: 0.05 },
    reserveUsd: 0,
    noEvolution: true,
    social: false,
  },
  // Its capacity check with the stub `claude`: the same 14 teams, 1-minute games (the stub's honest flowers burn most of
  // their R in CPU).
  "dry-adapt": {
    description: "dry run of adapt: the same 14 teams with the stub claude, 1-minute games, fixed membership",
    config: oldConfig("graph[any]"),
    expectConfig: OLD_EXPECT,
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
    config: oldConfig("graph[any]"),
    expectConfig: OLD_EXPECT,
    minutesByGame: [0.5],
    lineup: [["mallory", "sonnet"], ["kenji", "sonnet"], ["ada", "sonnet"], ["rosalind", "haiku"], ["priya", "haiku"], ["theo", "haiku"]],
    session: { warmupSeconds: 3, gapSeconds: 2, maxIdleGapSeconds: 4, endMarginSeconds: 3, maxMinutes: 2 },
    scaffold: { cpuShare: 0.1 },
    reserveUsd: 0,
  },
  // For dry runs with the stub `claude` (no model calls): int→int, 20-second games, evolution on.
  dry: {
    description: "dry run: one flower per team, python, int→int, 4 teams, 20-second games, retirement and breeding",
    config: oldConfig("int"),
    expectConfig: OLD_EXPECT,
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
  // coop-eq: can complex cooperation become a stable equilibrium that's hard to displace? One continuous 40-minute game of
  // 10 teams (7 pinned cooperators, 1 pinned defector, 2 veterans), all on opus at high effort.
  "coop-eq": {
    description: "coop-eq: 7 pinned cooperators, a pinned defector and 2 veterans in one 40-minute game with prevalence on both sides",
    preset: "coop10",
    games: 1,
    gameUsd: 300, // the game starts only if this much fits under the cap (10 opus teams: lobby up to $6, play up to $3 a session)
    capUsd: 600,
    cohorts: [{ id: "mesa-c", arm: "coop-eq", label: "coop-eq" }],
  },
  "coop-eq-dry": {
    description: "dry run of coop-eq with the stub claude: 10 teams, one 3-minute game",
    preset: "dry-coop10",
    games: 1,
    gameUsd: 0,
    cohorts: [{ id: "dry-q", arm: "coop-eq", label: "coop-eq" }],
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
