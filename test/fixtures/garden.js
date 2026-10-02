// Run a small garden for a fixed number of rounds (tests only).
import { Garden } from "../../server/engine.js";

/**
 * teams: [{ clover, orchid, bee }]; `during(garden)` runs while it plays. Unpaced (rounds back to back)
 * unless `paced`. Returns the drained output.
 */
export async function play(config, teams, rounds, during, { paced = false, endMs = Infinity } = {}) {
  const garden = new Garden({ config, teams: teams.length, endMs, maxRounds: rounds, paced });
  await Promise.all(teams.flatMap((programs, ti) => Object.entries(programs).map(([k, code]) => garden.setProgram(ti, k, code, 1))));
  const t0 = performance.now();
  const run = garden.run();
  if (during) await during(garden);
  await run;
  return { ...garden.drain(), rounds: garden.rounds, wallMs: performance.now() - t0 };
}
