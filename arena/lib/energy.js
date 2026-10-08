// A flower's excess energy for a turn, as the game computes it, from the game's own config (old games keep theirs):
//   E = (size cap − size) × max(0, R − CPU ms)                                          (games before the byte factor)
//   E = (size cap − size) × max(0, R − CPU ms) × (byte cap − response bytes) / byte cap (config.energy.bytes true)
// The byte cap is the game's maxResponseBytes (a response over it is refused: E = 0). R is the call's hidden budget
// (the flower window, budgets.flower.ms, in games before R).

/** Does this game's energy shrink with the response's size? */
export const bytesInEnergy = (config) => config?.energy?.bytes === true;
/** The most UTF-8 bytes a response may have (its JSON text): the game's cap. */
export const byteCap = (config) => config?.maxResponseBytes ?? 65536;

/** The byte factor of a response of `bytes` bytes: (cap − bytes) / cap in a game with it (0 over the cap), else 1. */
export function bytesFactor(config, bytes) {
  if (!bytesInEnergy(config)) return 1;
  const cap = byteCap(config), b = Number(bytes) || 0;
  return b > cap ? 0 : (cap - b) / cap;
}

/** E for one call: { size, ms (CPU), R (the call's budget; default the flower window), bytes (the response's) }. */
export function excessEnergy(config, { size, ms, R = config?.budgets?.flower?.ms ?? 150, bytes = 0 }) {
  const cap = config?.budgets?.flower?.size ?? 1100;
  return Math.max(0, cap - size) * Math.max(0, R - ms) * bytesFactor(config, bytes);
}

/** The formula in words, for briefs and tool output: "(1,100 − size) × (R − CPU ms)" and, in a game with the byte
 * factor, " × (1,024 − response bytes) / 1,024". */
export function bytesTerm(config) {
  if (!bytesInEnergy(config)) return "";
  const c = byteCap(config).toLocaleString("en-US");
  return ` × (${c} − response bytes) / ${c}`;
}
