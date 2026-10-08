// A flower's excess energy for a turn, as the game computes it, from the game's own config (old games keep theirs):
//   E = (size cap − size) × max(0, R − CPU ms)                                       node·ms        (games before the byte factor)
//   E = (size cap − size) × max(0, R − CPU ms) × (byte cap − response bytes)          node·ms·bytes  (config.energy.bytes true)
// The byte cap is the game's maxResponseBytes (a response over it is refused: E = 0). R is the call's hidden budget
// (the flower window, budgets.flower.ms, in games before R).

/** Does this game's energy have the byte factor? */
export const bytesInEnergy = (config) => config?.energy?.bytes === true;
/** The most UTF-8 bytes a response may have (its JSON text): the game's cap. */
export const byteCap = (config) => config?.maxResponseBytes ?? 65536;

/** The byte factor of a response of `bytes` bytes: byte cap − bytes in a game with it (0 over the cap), else 1. */
export function bytesFactor(config, bytes) {
  if (!bytesInEnergy(config)) return 1;
  const cap = byteCap(config), b = Number(bytes) || 0;
  return b > cap ? 0 : cap - b;
}
/** The byte factor of an empty response: the most it can be (the byte cap; 1 in a game without it). */
export const bytesMax = (config) => (bytesInEnergy(config) ? byteCap(config) : 1);
/** The share of the byte factor a response of `bytes` bytes uses up: bytes ÷ cap (all of it over the cap; 0 without it). */
export const bytesShare = (config, bytes) => 1 - bytesFactor(config, bytes) / bytesMax(config);

/** E for one call: { size, ms (CPU), R (the call's budget; default the flower window), bytes (the response's) }. */
export function excessEnergy(config, { size, ms, R = config?.budgets?.flower?.ms ?? 150, bytes = 0 }) {
  const cap = config?.budgets?.flower?.size ?? 1100;
  return Math.max(0, cap - size) * Math.max(0, R - ms) * bytesFactor(config, bytes);
}

/** The byte factor in words, for briefs and tool output: " × (1,024 − response bytes)" in a game with it, else "". */
export function bytesTerm(config) {
  return bytesInEnergy(config) ? ` × (${byteCap(config).toLocaleString("en-US")} − response bytes)` : "";
}
/** E's unit: node·ms, or node·ms·bytes in a game with the byte factor. */
export const energyUnit = (config) => (bytesInEnergy(config) ? "node·ms·bytes" : "node·ms");
