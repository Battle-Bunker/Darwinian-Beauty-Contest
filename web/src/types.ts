// Shapes returned by the JSON API (docs/API.md: one flower per team).

export type Kind = "flower" | "bee";
export const KINDS: Kind[] = ["flower", "bee"];

/**
 * Per-program budgets. size: weighted syntax-tree nodes of the minified program (the flower's size is
 * also the "size cap" of the energy formula). Change budget accrues `perMinute` nodes a minute of game
 * time, banking up to `cap`. ms: time per call (flower: the 150 ms window; bee: the 50 ms decision).
 */
export interface Budget { size: number; perMinute: number; cap: number; ms: number; memory?: number; minMs?: number }

export interface GameConfig {
  language: "python" | "typescript";
  minutes: number;          // game time; the clock stops while paused
  feedCost: number;         // rounds a bee sits out after it feeds (0 by default; 20 in games from before)
  /** When every response is delivered (null: flower.ms, as in games from before). */
  flowerWindowMs?: number | null;
  /** What a feed costs the bee out of its nectar, in E's unit (null: 0.05 × Emax; 0: free, as in games from before). */
  feedPrice?: number | null;
  challengeType: string;
  responseType: string;
  maxLen: number;
  maxNodes: number;         // trees and graphs (challenges only)
  maxResponseBytes?: number; // the most UTF-8 bytes of a response's JSON text (default 1,024; 64 KiB before), the byte cap of E
  revealOnFinish: boolean;  // all code and every bee's prints become public when the game ends
  grains?: "feeder" | "public" | "off";            // who sees a feed's pollen grain during play
  pollenGrain?: { exponent: number; scale: number }; // a grain is ⌊scale × pollen^exponent⌋ characters
  /** forage = Σ nectar^alpha, pollination = Σ pollen^beta, each in (0, 1] (0.85 by default; a game without them: √). */
  scoring?: Scoring;
  /** bytes: E = (cap − size) × max(0, R − CPU ms) × (maxResponseBytes − response bytes), in node·ms·bytes. Without it, no byte factor (node·ms). */
  energy?: { bytes: boolean };
  /** Prevalence on both sides: the view always has every key (off: a game without it). */
  prevalence?: PrevalenceConfig;
  budgets: Record<Kind, Budget>;
}

/**
 * As stored: each round ceil(slots × N) bees are drawn by c + B (bee success), each visiting a species drawn by
 * c + F (flower success); halfLifeS null = cumulative, prior null = 0.12 × Emax, cap null = none.
 */
export interface PrevalenceConfig { on: boolean; halfLifeS: number | null; cStart: number; cEnd: number; cap: number | null; slots: number; prior: number | null }
/** One team in a sample: its flower and bee success (par 1), their draw chances, and its fitness so far. */
export interface PrevalenceSpecies { team: string; index: number; flowerSuccess: number; beeSuccess: number; flowerP: number; beeP: number; fitness: number }
/** A sample, about once a second of game time: the round whose draws it gave, and that round's start. */
export interface PrevalenceSample { round: number; atMs: number; c: number; slots: number; species: PrevalenceSpecies[] }
/** The game's prevalence (settings with the prior and the feed price resolved) and its latest sample (null before the first). */
export type PrevalenceView = Omit<PrevalenceConfig, "prior"> & { prior: number; feedPrice: number; sample: PrevalenceSample | null };
/** Whether a game has prevalence (and so its fitness is the time-average of F × B). */
export const prevalenceOn = (cfg: { prevalence?: PrevalenceConfig } | null | undefined) => cfg?.prevalence?.on === true && "slots" in (cfg.prevalence ?? {});
/** The flower window: when every response is delivered (flower.ms in games from before). */
export const windowMsOf = (cfg: GameConfig) => Math.max(cfg.flowerWindowMs ?? cfg.budgets.flower.ms, cfg.budgets.flower.ms);
/** One round of game time: the flower window plus the bees' decision window. */
export const roundMsOf = (cfg: GameConfig) => windowMsOf(cfg) + cfg.budgets.bee.ms;

/** Whether a game's E has the byte factor (a config without `energy`: no, as games before it). */
export const energyBytes = (cfg: { energy?: { bytes: boolean } } | null | undefined) => cfg?.energy?.bytes === true;
/** E's unit: node·ms·bytes with the byte factor, node·ms without. */
export const energyUnitOf = (cfg: { energy?: { bytes: boolean } } | null | undefined) => (energyBytes(cfg) ? "node·ms·bytes" : "node·ms");
/** The response byte cap (64 KiB for a config without one). */
export const byteCapOf = (cfg: { maxResponseBytes?: number } | null | undefined) => cfg?.maxResponseBytes ?? 65536;

export interface Scoring { alpha: number; beta: number }

/** The exponents a game is scored with. A config without them is from before they existed: √ (0.5). */
export const scoringOf = (cfg: { scoring?: Scoring } | null | undefined): Scoring =>
  ({ alpha: cfg?.scoring?.alpha ?? 0.5, beta: cfg?.scoring?.beta ?? 0.5 });

/** The 2% floor the server gives R when minMs is left out (at least 1 ms), as a function of the flower's ms. */
export const defaultMinMs = (ms: number) => Math.max(1, Math.round(ms * 0.02));

export interface User { id: string; name: string }
export interface AuthInfo { provider: string; kind: "name-form" | "redirect" | string; loginUrl: string }
export interface MeResponse { user: User | null; auth: AuthInfo }

export type GameStatus = "lobby" | "running" | "paused" | "finished";

export interface RoomGame {
  id?: string; shortId: string; url: string;
  status: GameStatus; clockMs: number; endMs: number; teamCount: number; createdAt?: string;
}
export interface RoomView {
  id?: string; shortId: string; url: string; isOwner: boolean; ownerName?: string; createdAt?: string;
  games: RoomGame[];
}
export interface MyRoom {
  id?: string; shortId: string; url: string; isOwner: boolean; ownerName?: string; gameCount: number; createdAt: string; lastActivity?: string;
}

/** One version of a team's program. `code` only where the viewer may see it. */
export interface ProgramVersion {
  version: number;
  size: number;
  distance: number | null;  // node edits from the previous version (null when written in the lobby)
  cost: number;             // change budget it spent (0 in the lobby)
  atMs: number;             // game time it went live (0: before the start)
  submittedAt: string;
  submittedBy: string;
  problem: string | null;   // the first error it hit while playing
  code?: string;
}

/** A team's change budget for one program: `bank` nodes as of game time `atMs` (more accrues from then). */
export interface Bank { bank: number; atMs: number }

/**
 * During play a team sees only its own programs and banks (other teams: null); once the game is over,
 * everyone's (code still only if revealed).
 */
export interface Team {
  id: string; name: string; color: string; members: string[];
  participant: boolean | null;                         // null before the game starts
  index: number | null;                                // its index in participants (null if not playing)
  programs: Record<Kind, ProgramVersion[]> | null;      // oldest first; the last one is playing
  banks: Partial<Record<Kind, Bank>> | null;
  ready?: Record<Kind, boolean>;                        // lobby: which programs the team has written
  memory?: BeeMemory | null;                            // the bee's MEMORY: own team during play, everyone's after
}

/** A bee's MEMORY values: a flat key–value store. */
export type MemoryValue = string | number | boolean | null;

/** A bee's MEMORY: only the bee writes it; a new bee version starts with {}. Read only, everywhere. */
export interface BeeMemory {
  value: Record<string, MemoryValue> | unknown;   // string keys to strings, numbers, booleans or null
  bytes: number;      // Σ over entries of (UTF-8 bytes of the key + UTF-8 bytes of the value's JSON)
  cap: number;        // budgets.bee.memory
  version: number;    // the bee version it belongs to (it was cleared when that version went live)
  error?: string | null;  // why the latest save was refused (over the cap, not plain JSON): the old memory was kept
}

export interface MyTeam { id: string; name: string; joinCode: string; index?: number | null }

export type ActionKind = "arrive" | "feed" | "leave";

/**
 * One action. A turn makes two: its arrival (public at once) and its end (feed or leave), which carries
 * the whole turn. bee and flower are team ids. A field the viewer may not see is absent.
 */
export interface Action {
  seq: number;
  atMs: number;             // arrive: (round - 1) × round_ms; feed/leave: that + the flower window
  round: number;
  turn: number;             // the bee's turn number: (bee, turn) identifies a turn
  bee: string;
  flower: string;
  action: ActionKind;
  // feed and leave, public:
  c?: unknown;
  r?: unknown;              // null if the flower failed, or if the response is over 4 KB (then rHash and rPreview)
  rBytes?: number | null;   // the response's size: UTF-8 bytes of its JSON text (null if none)
  rHash?: string | null;    // over 4 KB only: SHA-256 (hex) of its JSON text; the whole thing at GET base/responses/:seq
  rPreview?: string | null; // over 4 KB only: the first 4 KB of its JSON text
  pollen?: number | null;   // what the flower kept: (1 − percent/100) × E on a feed, 0 on a leave
  nectar?: number | null;   // feed only: percent/100 × E
  price?: number | null;    // feed only: the feed price the bee paid out of its nectar (0 in games without one)
  net?: number | null;      // feed only: nectar − price (can be negative)
  // public on a feed; on a leave the flower's team only (everyone after finish):
  percent?: number | null;
  energy?: number | null;   // E, node·ms·bytes (node·ms in games without the byte factor)
  // the flower's team (everyone after finish):
  ms?: number | null;       // the flower's CPU time
  budgetMs?: number | null; // the call's hidden time budget R (its hard limit; E counts from it)
  flowerError?: string | null;
  flowerVersion?: number | null;
  // the bee's team:
  beeMs?: number | null;
  beeError?: string | null;
  beeVersion?: number | null;
  log?: string | null;
  // feed only, the bee's team (everyone if grains are public, and after the game): the pollen grain, a run of
  // the answering flower version's minified code from an unknown start, wrapping.
  grain?: string | null;
  grainVersion?: number | null;
  grainCodeLength?: number | null;
}

export interface ActionsPage { actions: Action[]; lastSeq: number; clockMs: number; round: number; status: GameStatus }

/**
 * One turn record of the team ledger (the `turns` entity of docs/QUERY.md), as the viewer's team may see it,
 * plus seq for paging. Teams are indices. A field the viewer may not see is null.
 */
export interface LedgerEntry {
  seq: number; game?: string; round: number; atMs?: number; turn?: number; bee: number; flower: number;
  challenge: unknown; response: unknown; fed: boolean;
  responseBytes?: number | null; responseHash?: string | null;   // a response over 4 KB: response null, its size and hash
  percent: number | null; energy: number | null;   // public on a feed, else the flower's team's
  nectar: number | null; pollen: number | null;    // nectar null and pollen 0 on a leave
  ms: number | null; flowerVersion?: number | null; flowerError?: string | null;  // the flower's team's
  budgetMs?: number | null;                                                        // the call's time budget R: the flower's team's
  beeMs?: number | null; beeVersion?: number | null; beeError?: string | null;     // the bee's team's
  grain?: string | null; grainVersion?: number | null; grainCodeLength?: number | null;   // the bee's team's (feeds)
}

export interface LedgerPage {
  participants: string[] | null;
  team: number | null;      // my team's index (null for a spectator)
  entries: LedgerEntry[];
  lastSeq: number; round: number; status: GameStatus;
}

/**
 * Whole-game numbers per team: the scoreboard, live and public. fitness = N² × pollinationShare ×
 * forageShare; the rest is information. (Null only defensively: shown as "–".)
 */
export interface TeamScore {
  teamId: string;
  pollination: number | null;      // Σ over bee teams of (pollen this flower kept from their feeds)^beta
  forage: number | null;           // Σ over flower teams of (nectar this bee got there)^alpha
  pollinationShare: number | null; forageShare: number | null;
  fitness: number | null;          // with prevalence, the time-average of F × B; else N² × pollination share × forage share
  flowerSuccess?: number | null; beeSuccess?: number | null; flowerP?: number | null; beeP?: number | null; // with prevalence: the latest sample's
  pollen: number | null;           // all this flower kept
  feedsReceived: number; feedsGiven: number; pollinators: number;
  nectarCollected: number | null; nectarGiven: number | null; nectarSources: number | null;
}

/**
 * Whole-game ledgers, public, rows = bee team, columns = flower team, in participants order: feeds[b][f]
 * (times b's bee fed at f's flower), nectar[b][f] (nectar b's bee got there), pollen[b][f] (what f's
 * flower kept from b's bee's feeds).
 */
export interface Ledgers { feeds: number[][]; nectar: (number | null)[][]; pollen: (number | null)[][] }

/** GET .../scores: the live numbers, cheap enough to poll. Scores, ledgers and lastSeq are from one moment. */
export interface ScoresView {
  status: GameStatus; clockMs: number; endMs: number; round: number; lastSeq: number;
  participants: string[] | null; scores: TeamScore[] | null; ledgers: Ledgers | null;
  prevalence?: PrevalenceView | null;
}

export interface GameView {
  room: { id?: string; shortId: string; url: string; isOwner: boolean };
  game: {
    id?: string; shortId: string; url: string; status: GameStatus; config: GameConfig;
    clockMs: number; endMs: number; round: number; lastSeq: number; version: number; lastError: string | null;
    createdAt?: string; startedAt: string | null; finishedAt: string | null; revealed: boolean; isOwner: boolean;
    windowMs?: number;   // the flower window the game plays with
    feedPrice?: number;  // the feed price the game plays with (0: free)
  };
  me: { id: string; name: string; teamId: string | null } | null;
  participants: string[] | null;
  teams: Team[];
  myTeam: MyTeam | null;
  interface: ProgramInterface;
  scores: TeamScore[] | null;
  ledgers: Ledgers | null;
  /** Species prevalence (null: species are drawn uniformly). */
  prevalence?: PrevalenceView | null;
}

/** POST check / programs. size and cost in nodes; available: whole nodes of change budget now (null in the lobby). */
export interface CheckResult {
  ok: boolean; kind: Kind; size: number; minified: string; budget: Budget;
  distance: number | null; cost: number; available: number | null; errors: string[];
  submitted?: boolean; version?: number; atMs?: number;
}

/** What every team knows before writing code: signatures and type rules (no starter code). */
export interface ProgramInterface {
  flower: string;
  bee: string;
  types: { challenge: string; response: string; challengeMeans: string; responseMeans: string; rules: string[] };
}

export interface TryFlowerRow {
  c: unknown; r: unknown; rBytes?: number | null; rHash?: string | null; rPreview?: string | null;
  percent: number | null; energy: number | null; ms: number | null; error?: string;
  budgetMs?: number | null;   // the time budget R this call had
}
export interface TryFlowerResult { size?: number; results: TryFlowerRow[]; error?: string }
export interface TryBeeResult {
  actions: Action[];
  problems: { kind?: Kind | string; version?: number; error: string; team?: number }[];
  feeds: number; nectar: number; pollen: number; rounds: number;
  memory?: { value: unknown; bytes: number; cap: number; error: string | null } | unknown;   // what the test bee's MEMORY ended with
}
