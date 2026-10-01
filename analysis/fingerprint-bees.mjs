// How do bees tell rival clovers from rival orchids? For each cohort game, per bee:
//   - challenge reuse: distinct challenges / asks, and the share of asks repeating one this bee asked earlier
//   - discrimination on rival patches: clover fed rate vs orchid fed rate
//   - orchid visits whose every pre-feed answer equals a RIVAL clover's answer to the same challenge that round
//     (a stolen face), or the orchid's OWN clover's answer (a twin)
// A bee that asks the same few challenges uses the answer as the flower's face and learns which faces pay
// by tasting. That needs no signal of effort from the clover at all.
//
//   node analysis/fingerprint-bees.mjs [arena ...]     (default: gx-control gx-treat gx-control2)
import { all, pool } from "../arena/lib/db.js";
import { gameRef } from "../arena/lib/cohort.js";

const arenas = process.argv.slice(2).length ? process.argv.slice(2) : ["gx-control", "gx-treat", "gx-control2"];
const f2 = (x) => (x == null || Number.isNaN(x) ? "-" : x.toFixed(2));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");

for (const arena of arenas) {
  for (let gen = 1; ; gen++) {
    const ref = await gameRef(arena, gen);
    if (!ref) break;
    const visits = await all(
      `SELECT v.round_no, b.name AS bee, p.name AS patch, v.kind, v.action, v.steps
         FROM visits v JOIN teams b ON b.id = v.bee_team JOIN teams p ON p.id = v.patch_team
        WHERE v.game_id = $1 ORDER BY v.round_no, v.bee_team, v.seq`, [ref.uuid]);

    // Every clover's answer to every challenge asked this round: round|challenge -> answer -> patch
    const book = new Map();
    for (const v of visits) if (v.kind === "clover") for (const s of v.steps) if (s.r !== undefined) {
      const k = `${v.round_no}|${JSON.stringify(s.c)}`;
      if (!book.has(k)) book.set(k, new Map());
      book.get(k).set(JSON.stringify(s.r), v.patch);
    }

    const bees = {};
    for (const v of visits) {
      const b = (bees[v.bee] ||= { seen: new Set(), asks: 0, repeats: 0, cv: 0, cf: 0, ov: 0, of: 0, stolen: 0, twin: 0 });
      const pre = v.steps.filter((s) => !s.after && s.r !== undefined);
      for (const s of v.steps.filter((s) => !s.after)) {
        const k = JSON.stringify(s.c);
        b.asks++;
        if (b.seen.has(k)) b.repeats++; else b.seen.add(k);
      }
      if (v.bee === v.patch) continue;
      const fed = v.action === "feed";
      if (v.kind === "clover") { b.cv++; if (fed) b.cf++; continue; }
      b.ov++; if (fed) b.of++;
      const owners = pre.map((s) => book.get(`${v.round_no}|${JSON.stringify(s.c)}`)?.get(JSON.stringify(s.r)));
      if (owners.length && owners.every((o) => o && o !== v.patch)) b.stolen++;
      if (owners.length && owners.every((o) => o === v.patch)) b.twin++;
    }

    console.log(`\n${arena} game ${gen}  ${ref.row.game_url ?? ""}`);
    console.log("  bee".padEnd(24), "distinct/asks".padEnd(16), "repeats", " rival clover fed", " rival orchid fed", " stolen-face orchids", " twin orchids");
    for (const [name, b] of Object.entries(bees))
      console.log(" ", name.padEnd(22), `${b.seen.size}/${b.asks}`.padEnd(16), pct(b.repeats, b.asks).padStart(7),
        f2(b.cf / b.cv).padStart(17), f2(b.of / b.ov).padStart(17), pct(b.stolen, b.ov).padStart(20), pct(b.twin, b.ov).padStart(13));
  }
}
await pool.end();
