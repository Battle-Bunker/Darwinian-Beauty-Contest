// Shapes returned by the JSON API (docs/API.md: one flower per team).

export type Kind = "flower" | "bee";
export const KINDS: Kind[] = ["flower", "bee"];

/**
 * Per-program budgets. size: weighted syntax-tree nodes of the minified program (the flower's size is
 * also the "size cap" of the energy formula). Change budget accrues `perMinute` nodes a minute of game
 * time, banking up to `cap`. ms: time per call (flower: the 150 ms window; bee: the 50 ms decision).
 */
export interface Budget { size: number; perMinute: number; cap: number; ms: number; memory?: number }

export interface GameConfig {
  language: "python" | "typescript";
  minutes: number;          // game time; the clock stops while paused
  feedCost: number;         // rounds a bee sits out after it feeds
  challengeType: string;
  responseType: string;
  maxLen: number;
  maxNodes: number;         // trees and graphs
  revealOnFinish: boolean;  // all code and every bee's prints become public when the game ends
  budgets: Record<Kind, Budget>;
}

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

/** A bee's MEMORY: only the bee writes it; a new bee version starts with {}. Read only, everywhere. */
export interface BeeMemory {
  value: unknown;     // a JSON value
  bytes: number;      // its size as canonical JSON (sorted keys, no spaces, UTF-8)
  cap: number;        // budgets.bee.memory
  version: number;    // the bee version it belongs to (it was cleared when that version went live)
}

export interface MyTeam { id: string; name: string; joinCode: string; index?: number | null }

export type ActionKind = "arrive" | "feed" | "leave";

/**
 * One action. A turn makes two: its arrival (public at once) and its end (feed or leave), which carries
 * the whole turn. bee and flower are team ids. A field the viewer may not see is absent.
 */
export interface Action {
  seq: number;
  atMs: number;             // arrive: (round - 1) × round_ms; feed/leave: that + flower.ms
  round: number;
  turn: number;             // the bee's turn number: (bee, turn) identifies a turn
  bee: string;
  flower: string;
  action: ActionKind;
  // feed and leave, public:
  c?: unknown;
  r?: unknown;              // null if the flower failed
  pollen?: number | null;   // what the flower kept: (1 − percent/100) × E on a feed, 0 on a leave
  nectar?: number | null;   // feed only: percent/100 × E
  // public on a feed; on a leave the flower's team only (everyone after finish):
  percent?: number | null;
  energy?: number | null;   // E, node·ms
  // the flower's team (everyone after finish):
  ms?: number | null;       // the flower's CPU time
  flowerError?: string | null;
  flowerVersion?: number | null;
  // the bee's team:
  beeMs?: number | null;
  beeError?: string | null;
  beeVersion?: number | null;
  log?: string | null;
}

export interface ActionsPage { actions: Action[]; lastSeq: number; clockMs: number; round: number; status: GameStatus }

/**
 * One turn record of the team ledger: what the team's programs see in HISTORY.turns (plus seq for paging).
 * Teams are indices. A field the viewer may not see is null.
 */
export interface LedgerEntry {
  seq: number; game?: string; round: number; atMs?: number; turn?: number; bee: number; flower: number;
  challenge: unknown; response: unknown; fed: boolean;
  percent: number | null; energy: number | null;   // public on a feed, else the flower's team's
  nectar: number | null; pollen: number | null;    // nectar null and pollen 0 on a leave
  ms: number | null; flowerVersion?: number | null; flowerError?: string | null;  // the flower's team's
  beeMs?: number | null; beeVersion?: number | null; beeError?: string | null;     // the bee's team's
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
  pollination: number | null;      // Σ over bee teams of √(pollen this flower kept from their feeds)
  forage: number | null;           // Σ over flower teams of √(nectar this bee got there)
  pollinationShare: number | null; forageShare: number | null; fitness: number | null;
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
}

export interface GameView {
  room: { id?: string; shortId: string; url: string; isOwner: boolean };
  game: {
    id?: string; shortId: string; url: string; status: GameStatus; config: GameConfig;
    clockMs: number; endMs: number; round: number; lastSeq: number; version: number; lastError: string | null;
    createdAt?: string; startedAt: string | null; finishedAt: string | null; revealed: boolean; isOwner: boolean;
  };
  me: { id: string; name: string; teamId: string | null } | null;
  participants: string[] | null;
  teams: Team[];
  myTeam: MyTeam | null;
  interface: ProgramInterface;
  scores: TeamScore[] | null;
  ledgers: Ledgers | null;
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

export interface TryFlowerRow { c: unknown; r: unknown; percent: number | null; energy: number | null; ms: number | null; error?: string }
export interface TryFlowerResult { size?: number; results: TryFlowerRow[]; error?: string }
export interface TryBeeResult {
  actions: Action[];
  problems: { kind?: Kind | string; version?: number; error: string; team?: number }[];
  feeds: number; nectar: number; pollen: number; rounds: number;
  memory?: unknown;   // what the test bee's MEMORY ended with
}
