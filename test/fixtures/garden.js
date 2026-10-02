// Run a small garden for a fixed number of rounds (tests only).
import { Garden } from "../../server/engine.js";

/** teams: [{ clover, orchid, bee }]; `during(garden)` runs while it plays. Returns the drained output. */
export async function play(config, teams, rounds, during) {
  const garden = new Garden({ config, teams: teams.length, endMs: Infinity, maxRounds: rounds });
  await Promise.all(teams.flatMap((programs, ti) => Object.entries(programs).map(([k, code]) => garden.setProgram(ti, k, code, 1))));
  const run = garden.run();
  if (during) await during(garden);
  await run;
  return { ...garden.drain(), rounds: garden.rounds };
}
