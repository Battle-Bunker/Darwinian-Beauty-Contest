// Which programs a team may change before each round. All three are written before round 1. After that
// exactly one kind may change before each round, in rotation: orchids (before rounds 2, 5, 8, …), then
// clovers (3, 6, 9, …), then bees (4, 7, 10, …). So orchids always get a round to imitate both the
// clovers' signatures and the bees' probes before either can react, then clovers respond to the
// imitations, then bees respond to both. A program out of its turn may still be resubmitted with
// changes that leave its minified form identical (comments, spacing, names).
const CYCLE = ["orchid", "clover", "bee"];

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
