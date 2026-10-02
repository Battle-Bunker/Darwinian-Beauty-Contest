// Shapes returned by the JSON API (server/games.js, server/routes/api.js).

export type Kind = "cosmos" | "orchid" | "bee";
export type FlowerKind = "cosmos" | "orchid";
export const KINDS: Kind[] = ["cosmos", "orchid", "bee"];

/**
 * Per-program budgets. size: weighted syntax-tree nodes of the minified program. Change budget accrues
 * `perMinute` nodes a minute of game time, banking up to `cap`. ms: compute per call.
 */
export interface Budget { size: number; perMinute: number; cap: number; ms: number }

export interface GameConfig {
  language: "python" | "typescript";
  minutes: number;          // game time; the clock stops while paused
  feedCost: number;         // rounds a feeding bee sits out of the round robin
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
  id: string; shortId: string; url: string;
  status: GameStatus; clockMs: number; endMs: number; teamCount: number; createdAt: string;
}
export interface RoomView {
  id: string; shortId: string; url: string; ownerId: string; isOwner: boolean; ownerName?: string; createdAt: string;
  games: RoomGame[];
}
export interface MyRoom {
  id: string; shortId: string; url: string; isOwner: boolean; ownerName?: string; gameCount: number; createdAt: string; lastActivity?: string;
}

/** One version of a team's program. Everything but `code` is public; code only for your team, or once revealed. */
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
 * During play a team sees only its own programs and banks (other teams: null). Once the game is
 * finished everyone sees every team's version history and banks (code still only if revealed).
 */
export interface Team {
  id: string; name: string; color: string; members: string[];
  participant: boolean | null;                         // null before the game starts
  programs: Record<Kind, ProgramVersion[]> | null;      // oldest first; the last one is playing
  banks: Partial<Record<Kind, Bank>> | null;            // once the game has started, for participants
  ready?: Record<Kind, boolean>;                        // lobby: which programs the team has written
}

export interface MyTeam { id: string; name: string; joinCode: string }

export type ActionKind = "ask" | "feed" | "leave" | "error";

/**
 * One bee action, public the moment it happens. bee and patch are team ids. `log` (what the bee
 * printed) only for its own team, or everyone once a finished game is revealed. During play,
 * beeVersion / flowerVersion only when that program is yours (all of them once finished), and an
 * engine-caused leave (a bee replaced or restarted) carries error/by only for the bee's team.
 */
export interface Action {
  seq: number;
  atMs: number;
  round: number;            // the round it happened in (a round: one turn for every bee that isn't feeding)
  bee: string;
  visit: number;
  patch: string;
  kind?: FlowerKind;        // which of the patch's flowers (always sent; optional only defensively)
  action: ActionKind;
  beeVersion?: number | null;
  flowerVersion?: number | null;
  c?: unknown;
  r?: unknown;
  ms?: number | null;       // ask: how long the flower took (your own flowers' during play, all once finished)
  beeMs?: number | null;    // how long the bee took to decide this action (your own bee's during play, all once finished)
  after?: boolean;          // an ask after feeding at this flower
  nectar?: boolean | null;
  error?: string | null;
  by?: "bee" | "challenge" | "flower" | "engine" | null;
  log?: string | null;
}

export interface ActionsPage { actions: Action[]; lastSeq: number; clockMs: number; round: number; status: GameStatus }

export interface TeamScore {
  teamId: string; allure: number; forage: number; allureShare: number; forageShare: number; fitness: number;
  feedsReceived: number; feedsGiven: number; nectarCollected: number; pollinators: number; nectarSources: number;
}

export interface RecentScores { fromMs: number; toMs: number; scores: TeamScore[] }

/** feeds[bee team][patch team] and nectar[bee][patch] over the whole game, in participants order. */
export interface Ledgers { feeds: number[][]; nectar: number[][] }

/** GET .../scores: the live numbers, cheap enough to poll. Scores, ledgers and lastSeq are from one moment. */
export interface ScoresView {
  status: GameStatus; clockMs: number; endMs: number; round: number; lastSeq: number;
  participants: string[] | null; scores: TeamScore[] | null; recent: RecentScores | null; ledgers: Ledgers | null;
}

export interface GameView {
  room: { id: string; shortId: string; url: string; isOwner: boolean };
  game: {
    id: string; shortId: string; url: string; status: GameStatus; config: GameConfig;
    clockMs: number; endMs: number; round: number; lastSeq: number; version: number; lastError: string | null;
    createdAt: string; startedAt: string | null; finishedAt: string | null; revealed: boolean; isOwner: boolean;
  };
  me: { id: string; name: string; teamId: string | null } | null;
  participants: string[] | null;
  teams: Team[];
  myTeam: MyTeam | null;
  interface: ProgramInterface;
  scores: TeamScore[] | null;    // whole game, per participant
  recent: RecentScores | null;   // the last five minutes of game time
  ledgers: Ledgers | null;
}

/** POST check / programs. size and cost in nodes; available: whole nodes of change budget now (null in the lobby). */
export interface CheckResult {
  ok: boolean; kind: Kind; size: number; minified: string; budget: Budget;
  distance: number | null; cost: number; available: number | null; errors: string[];
  submitted?: boolean; version?: number;
}

/** What every team knows before writing code: signatures and type rules (no starter code). */
export interface ProgramInterface {
  flower: string;
  bee: string;
  types: { challenge: string; response: string; challengeMeans: string; responseMeans: string; rules: string[] };
}

export interface TryFlowerResult { results: { c: unknown; r: unknown; error?: string; ms?: number }[]; error?: string }
export interface TryBeeResult {
  actions: Action[];
  problems: { team: number; kind: Kind; version: number; error: string }[];
  feeds: number; nectar: number; rounds: number;
}
