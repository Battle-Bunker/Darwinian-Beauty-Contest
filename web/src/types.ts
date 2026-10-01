// Shapes returned by the JSON API (see docs/API.md).

export type Kind = "clover" | "orchid" | "bee";
export type FlowerKind = "clover" | "orchid";
export const KINDS: Kind[] = ["clover", "orchid", "bee"];

export interface Budget { nodes: number; changes: number; ms: number }

export interface GameConfig {
  language: "python" | "typescript";
  rounds: number;
  turns: number;
  feedCost: number;
  challengeType: string;
  responseType: string;
  maxLen: number;
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

export interface Draft { code: string; nodes: number; distance: number | null; submittedAt: string; submittedBy: string }

export interface MyTeam {
  id: string; name: string; joinCode: string;
  drafts: Partial<Record<Kind, Draft>>;
  previous: Partial<Record<Kind, string>>;
}

export interface Step { c: unknown; r: unknown; challengeError?: string; flowerError?: string }

export interface Visit {
  bee: string; patch: string; seq: number; start: number; end: number; asks: number;
  action: "feed" | "leave" | "error"; nectar: boolean | null;
  kind?: FlowerKind; steps?: Step[]; beeError?: string; beeLog?: string; note?: string; flowerError?: string;
}

export interface TeamScore {
  teamId: string; allure: number; forage: number; allureShare: number; forageShare: number; fitness: number;
  feedsReceived: number; feedsGiven: number; nectarCollected: number; pollinators: number; nectarSources: number;
}

export interface ProgramInfo { nodes: number; distance: number | null; carriedOver: boolean; code?: string; problem?: string | null }

export interface Round {
  no: number; startedAt: string; finishedAt: string;
  feeds: number[][]; nectar: number[][];
  scores: TeamScore[]; totals: TeamScore[];
  programs: Record<string, Record<Kind, ProgramInfo | null>>;
  visits: Visit[];
}

export interface GameView {
  room: { id: string; shortId: string; url: string; isOwner: boolean };
  game: {
    id: string; shortId: string; url: string; status: GameStatus; config: GameConfig;
    roundsPlayed: number; runningRound: number | null; lastError: string | null; version: number;
    createdAt: string; finishedAt: string | null; revealed: boolean; isOwner: boolean;
  };
  me: { id: string; name: string; teamId: string | null } | null;
  participants: string[] | null;
  teams: Team[];
  myTeam: MyTeam | null;
  starters: Record<Kind, string>;
  rounds: Round[];
  final: TeamScore[] | null;
}

export interface CheckResult { ok: boolean; kind: Kind; nodes: number; distance: number | null; errors: string[]; budget: Budget; submitted?: boolean }

export interface TryFlowerResult { results: { c: unknown; r: unknown; error?: string }[]; error?: string }
export interface TryBeeVisit {
  bee: number; patch: number; kind: FlowerKind; start: number; end: number; seq: number;
  steps: Step[]; action: "feed" | "leave" | "error"; nectar: boolean | null; beeError?: string; beeLog?: string; note?: string;
}
export interface TryBeeResult { visits: TryBeeVisit[]; problems: Record<Kind, string | null>; feeds: number; nectar: number }
