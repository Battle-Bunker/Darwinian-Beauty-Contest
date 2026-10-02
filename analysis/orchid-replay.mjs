// Can an orchid steal a fingerprinting bee's faces in its change round? Per game and round:
//   carried    share of each bee's asks whose challenge that bee also asked the round before
//              (only those answers could be copied from the previous round's logs)
//   replayable rival-orchid visits whose every pre-feed challenge was asked the round before AND answered by a rival clover
//   replayed   rival-orchid visits whose every pre-feed answer equals a rival clover's answer to that challenge last round
//   stolen     rival-orchid visits whose every pre-feed answer equals a rival clover's answer this round
//   aimed      orchids whose code names one of last round's challenges (4+ digits) as a literal: an orchid that
//              recognises a bee by the question it asks (its "accent") or replays answers to it
//
//   node analysis/orchid-replay.mjs [arena ...]   (default: the six v3 cohorts)
import { all, pool } from "../arena/lib/db.js";
import { gameRef } from "../arena/lib/cohort.js";
import { changeable } from "../server/lib/schedule.js";

const arenas = process.argv.slice(2).length ? process.argv.slice(2)
  : ["v3-hidden", "v3-open", "v3-hidden-treat", "v3-hidden-control", "v3-open-treat", "v3-open-control"];
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const key = (x) => JSON.stringify(x);

for (const arena of arenas) {
  for (let gen = 1; ; gen++) {
    const ref = await gameRef(arena, gen);
    if (!ref) break;
    const visits = await all(
      `SELECT v.round_no, v.bee_team, v.patch_team, v.kind, v.action, v.steps
         FROM visits v WHERE v.game_id = $1 ORDER BY v.round_no, v.bee_team, v.seq`, [ref.uuid]);
    const orchids = await all(`SELECT round_no, team_id, code FROM round_programs WHERE game_id = $1 AND kind = 'orchid'`, [ref.uuid]);
    const byRound = new Map();
    for (const v of visits) { if (!byRound.has(v.round_no)) byRound.set(v.round_no, []); byRound.get(v.round_no).push(v); }

    // round -> challenge -> answer -> clover patch
    const books = new Map();
    for (const [r, vs] of byRound) {
      const book = new Map();
      for (const v of vs) if (v.kind === "clover") for (const s of v.steps) if (s.r !== undefined) {
        const c = key(s.c);
        if (!book.has(c)) book.set(c, new Map());
        book.get(c).set(key(s.r), v.patch_team);
      }
      books.set(r, book);
    }
    const asked = new Map(); // round -> bee -> set of challenges
    for (const [r, vs] of byRound) {
      const m = new Map();
      for (const v of vs) for (const s of v.steps) if (!s.after) {
        if (!m.has(v.bee_team)) m.set(v.bee_team, new Set());
        m.get(v.bee_team).add(key(s.c));
      }
      asked.set(r, m);
    }

    console.log(`\n${arena} game ${gen}  ${ref.row.game_url ?? ""}`);
    console.log("  round  changes".padEnd(26), "carried".padStart(8), "rival-orchid visits".padStart(20), "fed".padStart(5),
      "replayable".padStart(11), "replayed".padStart(9), "stolen".padStart(7), "aimed orchids".padStart(14));
    for (const [r, vs] of [...byRound].sort((a, b) => a[0] - b[0])) {
      const prevAsked = asked.get(r - 1), prevBook = books.get(r - 1), book = books.get(r);
      let asks = 0, carried = 0, ov = 0, of = 0, replayable = 0, replayed = 0, stolen = 0;
      for (const v of vs) {
        const pre = v.steps.filter((s) => !s.after);
        for (const s of pre) { asks++; if (prevAsked?.get(v.bee_team)?.has(key(s.c))) carried++; }
        if (v.kind !== "orchid" || v.bee_team === v.patch_team) continue;
        ov++; if (v.action === "feed") of++;
        const answered = pre.filter((s) => s.r !== undefined);
        if (!answered.length) continue;
        const rivalAnswers = (bk, s) => [...(bk?.get(key(s.c)) ?? new Map())].filter(([, p]) => p !== v.patch_team).map(([a]) => a);
        if (answered.every((s) => rivalAnswers(prevBook, s).length)) replayable++;
        if (answered.every((s) => rivalAnswers(prevBook, s).includes(key(s.r)))) replayed++;
        if (answered.every((s) => rivalAnswers(book, s).includes(key(s.r)))) stolen++;
      }
      const lastChallenges = prevAsked ? [...new Set([...prevAsked.values()].flatMap((s) => [...s]))].map((c) => JSON.parse(c)).filter(Number.isInteger).filter((c) => Math.abs(c) >= 1000) : [];
      const aimed = orchids.filter((o) => o.round_no === r).filter((o) =>
        lastChallenges.some((c) => new RegExp(`(?<![\\w.])${c}(?![\\w.])`).test(o.code))).length;
      console.log(`  ${String(r).padStart(5)}  ${changeable(r).join(",").padEnd(17)}`, pct(carried, asks).padStart(8), String(ov).padStart(20),
        pct(of, ov).padStart(5), pct(replayable, ov).padStart(11), pct(replayed, ov).padStart(9), pct(stolen, ov).padStart(7), String(aimed).padStart(14));
    }
  }
}
await pool.end();
