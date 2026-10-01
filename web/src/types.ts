// Shapes returned by the JSON API (see docs/API.md).

export type Kind = "clover" | "orchid" | "bee";
export type FlowerKind = "clover" | "orchid";
export const KINDS: Kind[] = ["clover", "orchid", "bee"];

export interface Budget { chars: number; changes: number; ms: number }

export interface GameConfig {
  language: "python" | "typescript";
  rounds: number;
  turnsPerFlower: number;   // each bee gets turnsPerFlower × flowers turns per round
  feedCost: number;
  challengeType: string;
  responseType: string;
  maxLen: number;
  maxNodes: number;         // trees and graphs
  beeMemoryKb: number;      // what a bee keeps between rounds for MEMORY
  flowerLogs: boolean;
  revealOnFinish: boolean;
  budgets: Record<Kind, Budget>;
}

export interface User { id: string; name: string }
export interface AuthInfo { provider: string; kind: "name-form" | "redirect" | string; loginUrl: string }
export interface MeResponse { user: User | null; auth: AuthInfo }

export interface RoomGame {
  id: string; shortId: string; url: string;
  status: GameStatus; roundsPlayed: number; rounds: number; teamCount: number; createdAt: string;
}
export interface RoomView {
  id: string; shortId: string; url: string; ownerId: string; isOwner: boolean; ownerName?: string; createdAt: string;
  games: RoomGame[];
}
export interface MyRoom {
  id: string; shortId: string; url: string; isOwner: boolean; ownerName?: string; gameCount: number; createdAt: string; lastActivity?: string;
}

export type GameStatus = "lobby" | "running" | "finished";

export interface Team {
  id: string; name: string; color: string; members: string[];
  participant: boolean | null;
  submitted: Record<Kind, boolean>;
}

export interface Draft { code: string; chars: number; distance: number | null; submittedAt: string; submittedBy: string }

export interface MyTeam {
  id: string; name: string; joinCode: string;
  drafts: Partial<Record<Kind, Draft>>;
  previous: Partial<Record<Kind, string>>;
}

export interface Step { c: unknown; r: unknown; after?: boolean; challengeError?: string; flowerError?: string }

export interface Visit {
  bee: string; patch: string; seq: number; start: number; end: number; asks: number;
  asksBeforeFeed?: number;  // fed visits: asks, then the feed, then (asks - asksBeforeFeed) more asks
  action: "feed" | "leave" | "error"; nectar: boolean | null;
  kind?: FlowerKind; steps?: Step[]; beeError?: string; beeLog?: string; note?: string; flowerError?: string;
}

export interface TeamScore {
  teamId: string; allure: number; forage: number; allureShare: number; forageShare: number; fitness: number;
  feedsReceived: number; feedsGiven: number; nectarCollected: number; pollinators: number; nectarSources: number;
}

export interface Compute { calls: number; meanMs: number; p90Ms: number; budgetMs: number }
export interface ProgramInfo { chars: number; distance: number | null; carriedOver: boolean; code?: string; problem?: string | null; compute?: Compute | null }
export interface MemoryInfo { bytes: number; note: string | null }
export interface MemorySnapshot { round: number; teamId: string; language: string; snapshot: string | null; bytes: number; note: string | null }

export interface Round {
  no: number; startedAt: string; finishedAt: string;
  turns: number;                           // turns each bee had this round
  memory?: Record<string, MemoryInfo>;     // what each bee kept (own team, or all once revealed)
  feeds: number[][]; nectar: number[][];
  scores: TeamScore[]; totals: TeamScore[];
  programs: Record<string, Record<Kind, ProgramInfo | null>>;
  visits?: Visit[];                        // left out of the game view for older rounds (?visits=last)
}

export interface GameView {
  room: { id: string; shortId: string; url: string; isOwner: boolean };
  game: {
    id: string; shortId: string; url: string; status: GameStatus; config: GameConfig;
    roundsPlayed: number; runningRound: number | null; lastError: string | null; version: number;
    createdAt: string; finishedAt: string | null; revealed: boolean; isOwner: boolean;
    turns: number;                         // turns per bee in the next round
    changeable: Kind[];                    // programs that may change for the next round (clovers and orchids take turns)
  };
  me: { id: string; name: string; teamId: string | null } | null;
  participants: string[] | null;
  teams: Team[];
  myTeam: MyTeam | null;
  interface: ProgramInterface;
  rounds: Round[];
  final: TeamScore[] | null;
}

/** chars: the complexity, the length of `minified` (the program as the game counts it). */
export interface CheckResult { ok: boolean; kind: Kind; chars: number; minified: string; distance: number | null; errors: string[]; budget: Budget; submitted?: boolean }

/** What every team knows before writing code: signatures and type rules (no starter code). */
export interface ProgramInterface {
  flower: string;
  bee: string;
  types: { challenge: string; response: string; challengeMeans: string; responseMeans: string; rules: string[] };
}

export interface TryFlowerResult { results: { c: unknown; r: unknown; error?: string }[]; error?: string }
export interface TryBeeVisit {
  bee: string; patch: string; kind: FlowerKind; start: number; end: number; seq: number; asks: number; asksBeforeFeed?: number;
  steps: Step[]; action: "feed" | "leave" | "error"; nectar: boolean | null; beeError?: string; beeLog?: string; note?: string;
}
export interface TryBeeResult {
  visits: TryBeeVisit[]; problems: Record<Kind, string | null>; feeds: number; nectar: number;
  turns?: number; memory?: { snapshot: string | null; bytes: number; note: string | null };
}
