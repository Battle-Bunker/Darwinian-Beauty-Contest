// Change budgets, exactly as the server reckons them (server/lib/gameConfig.js `available`): a bank as of
// some game time, plus perMinute nodes a minute since, up to cap. A change is affordable when its cost
// is at most the whole nodes available.
import type { Bank, Budget, ProgramVersion } from "../types";

export function availableAt(budget: Budget, bank: Bank, clockMs: number): number {
  return Math.min(budget.cap, bank.bank + (budget.perMinute * Math.max(0, clockMs - bank.atMs)) / 60000);
}

/** Game time (ms) until `cost` is affordable, 0 if it is now, null if it never will be. */
export function waitFor(budget: Budget, exact: number, cost: number): number | null {
  if (cost <= Math.floor(exact)) return 0;
  if (cost > budget.cap || budget.perMinute <= 0) return null;
  return ((cost - exact) * 60000) / budget.perMinute;
}

/**
 * A program's change budget over the game, rebuilt from its versions: it starts empty when the game
 * starts, grows perMinute a minute up to cap, and drops by each change's cost. Returns [ms, nodes]
 * points (a drop is two points at the same time), ending at `endMs`.
 */
export function budgetCurve(budget: Budget, versions: ProgramVersion[], endMs: number): [number, number][] {
  const pts: [number, number][] = [[0, 0]];
  let t = 0, bank = 0;
  const grow = (to: number) => {
    if (to <= t) return;
    const full = budget.perMinute > 0 ? t + ((budget.cap - bank) * 60000) / budget.perMinute : Infinity;
    if (full < to && bank < budget.cap) pts.push([full, budget.cap]);
    bank = Math.min(budget.cap, bank + (budget.perMinute * (to - t)) / 60000);
    t = to;
    pts.push([t, bank]);
  };
  for (const v of versions) {
    if (v.atMs <= 0 || v.cost === undefined) continue;
    grow(v.atMs);
    bank = Math.max(0, bank - v.cost);
    pts.push([t, bank]);
  }
  grow(endMs);
  return pts;
}
