// Which programs a team may change before each round. All three are written before round 1. After that
// exactly one kind may change before each round, in rotation: bees (before rounds 2, 5, 8, …), then
// orchids (3, 6, 9, …), then clovers (4, 7, 10, …). In a 6-round game: all, bee, orchid, clover, bee,
// orchid. Each kind gets a round to react to the others while they stand still: orchids imitate the
// clovers' answers and the bees' current questions, clovers respond to the imitations, and bees respond
// to both. A program out of its turn may still be resubmitted with changes that leave its minified form
// identical (comments, spacing, names).
const CYCLE = ["bee", "orchid", "clover"];

export function changeable(roundNo) {
  if (roundNo <= 1) return ["clover", "orchid", "bee"];
  return [CYCLE[(roundNo - 2) % CYCLE.length]];
}

/** The next round (from `roundNo` on) before which `kind` may change. */
export function nextChangeRound(kind, roundNo) {
  let r = roundNo;
  while (!changeable(r).includes(kind)) r++;
  return r;
}
