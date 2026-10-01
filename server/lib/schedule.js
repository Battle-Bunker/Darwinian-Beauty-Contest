// Which programs a team may change before each round. All three are written before round 1. After that
// clovers and orchids take turns, so each side gets a round to react to the other while the other can't
// move: orchids may change before even rounds (2, 4, …) and clovers before odd ones (3, 5, …). Bees may
// change before every round. A program that may not change can still be resubmitted with changes that
// leave its minified form identical (comments, spacing, names).
export function changeable(roundNo) {
  if (roundNo <= 1) return ["clover", "orchid", "bee"];
  return [roundNo % 2 === 0 ? "orchid" : "clover", "bee"];
}

/** The next round (after `roundNo`) in which `kind` may change. */
export function nextChangeRound(kind, roundNo) {
  let r = roundNo;
  while (!changeable(r).includes(kind)) r++;
  return r;
}
