// A config as games stored it before the metagame of prevalence on both sides (RULES.md "Prevalence"): R from
// 3 to 150 ms with the flower window at flower.ms, change budgets of 220 and 2,200 nodes a minute, a feed sits
// the bee out 20 rounds, feeds are free, every bee takes a turn each round and species are drawn uniformly,
// scored with pollination × forage. Tests of mechanics that don't depend on the metagame play under it, which
// also shows such games still play by their rules.
import { normalizeConfig } from "../../server/lib/gameConfig.js";

const { flowerWindowMs: _w, feedPrice: _p, prevalence: _v, ...rest } = normalizeConfig({});
export const CLASSIC = Object.freeze({
  ...rest,
  feedCost: 20,
  budgets: {
    flower: { size: 1100, perMinute: 220, cap: 220, ms: 150, minMs: 3 },
    bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 },
  },
});

/** A classic config with these settings changed (as the lobby would, on a game stored before). */
export const classic = (input = {}) => normalizeConfig(input, CLASSIC);
