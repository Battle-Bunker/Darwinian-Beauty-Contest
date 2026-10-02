// Does running a program in its minified form (vendor/measure.js) ever change what it does?
// Replays stored programs both ways through the real runners and compares every answer:
//   flowers: the challenges they were actually asked (deterministic flowers only: no random/time)
//   bees:    one recorded round each, fed the same recorded steps, with the same MEMORY
//
//   node analysis/minify-equivalence.mjs [--bees 300] [--flowers 100000]
import { all, pool } from "../arena/lib/db.js";
import { size } from "../server/lib/measure.js";
import { ProgramProcess } from "../server/runners/proc.js";
import { gameInfo } from "../server/engine.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MAX_BEES = arg("bees", 300), MAX_FLOWERS = arg("flowers", 100000);
const RANDOM = /\brandom\b|\btime\b|Math\.random|Date\b/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failures = [];

// ---------------------------------------------------------------- flowers
const flowerRows = await all(`
  SELECT DISTINCT ON (rp.code) rp.code, rp.kind, rp.game_id, rp.round_no, rp.team_id, g.config
    FROM round_programs rp JOIN games g ON g.id = rp.game_id
   WHERE rp.kind <> 'bee' ORDER BY rp.code, rp.round_no`);
let flowersChecked = 0, flowerCalls = 0;
for (const f of flowerRows.filter((f) => !RANDOM.test(f.code)).slice(0, MAX_FLOWERS)) {
  const asked = await all(`SELECT DISTINCT ON (s->'c') s->'c' AS c FROM visits v, jsonb_array_elements(v.steps) s
                            WHERE v.game_id = $1 AND v.round_no = $2 AND v.patch_team = $3 AND v.kind = $4 LIMIT 12`,
    [f.game_id, f.round_no, f.team_id, f.kind]);
  if (!asked.length) continue;
  const lang = f.config.language;
  const setup = (code) => ({ code, ms: 2000, game: { ...gameInfo(f.config, 6), ms: 2000 }, maxChars: 262144 });
  const minified = (await size(lang, f.code)).minified;
  const a = new ProgramProcess(lang, "flower", setup(f.code)), b = new ProgramProcess(lang, "flower", setup(minified));
  try {
    const [la, lb] = [await a.ready, await b.ready];
    if (!!la.ok !== !!lb.ok) { failures.push({ kind: f.kind, why: "load", a: la, b: lb, code: f.code, minified }); continue; }
    for (const { c } of asked) {
      const [ra, rb] = [await a.call({ c }), await b.call({ c })];
      flowerCalls++;
      const ea = ra.e ? ra.e.split(":")[0] : null, eb = rb.e ? rb.e.split(":")[0] : null;
      if (!same(ra.v, rb.v) || ea !== eb) { failures.push({ kind: f.kind, why: "answer", c, a: ra, b: rb, code: f.code, minified }); break; }
    }
    flowersChecked++;
  } finally { a.kill(); b.kill(); }
}

// ---------------------------------------------------------------- bees
const beeRows = await all(`
  SELECT DISTINCT ON (rp.code) rp.code, rp.game_id, rp.round_no, rp.team_id, g.config, r.turns, r.seed
    FROM round_programs rp JOIN games g ON g.id = rp.game_id JOIN rounds r ON r.game_id = rp.game_id AND r.round_no = rp.round_no
   WHERE rp.kind = 'bee' ORDER BY rp.code, rp.round_no`);
let beesChecked = 0, beeCalls = 0;
for (const bee of beeRows.slice(0, MAX_BEES)) {
  const visits = await all(`SELECT steps, action, nectar, turn_start FROM visits WHERE game_id = $1 AND round_no = $2 AND bee_team = $3 ORDER BY seq LIMIT 60`,
    [bee.game_id, bee.round_no, bee.team_id]);
  if (!visits.length) continue;
  const memory = (await all(`SELECT snapshot FROM bee_memories WHERE game_id = $1 AND team_id = $2 AND round_no < $3 ORDER BY round_no`,
    [bee.game_id, bee.team_id, bee.round_no])).map((m) => m.snapshot);
  const lang = bee.config.language;
  const setup = (code) => ({ code, ms: 2000, seed: 12345, game: { ...gameInfo(bee.config, 6), ms: 2000 }, maxChars: 262144, memory });
  const minified = (await size(lang, bee.code)).minified;
  const a = new ProgramProcess(lang, "bee", setup(bee.code)), b = new ProgramProcess(lang, "bee", setup(minified));
  try {
    const [la, lb] = [await a.ready, await b.ready];
    if (!!la.ok !== !!lb.ok) { failures.push({ kind: "bee", why: "load", a: la, b: lb, code: bee.code, minified }); continue; }
    if (!la.ok) continue;
    let diverged = false;
    const both = async (req) => {
      const [ra, rb] = [await a.call(req), await b.call(req)];
      beeCalls++;
      if (!same(ra.a, rb.a) || !!ra.e !== !!rb.e) { failures.push({ kind: "bee", why: "action", req, a: ra, b: rb, code: bee.code, minified }); diverged = true; }
    };
    for (const v of visits) {
      let turns = bee.turns - v.turn_start, fed = false, nectar = null;
      await both({ op: "forage", new: true, step: null, turns, visit: { fed, nectar } });
      for (const s of v.steps) {
        if (diverged) break;
        if (s.after && !fed) {
          fed = true; nectar = v.nectar;
          await both({ op: "tasted", nectar });
        }
        turns -= 1;
        await both({ op: "forage", new: false, step: [s.c, s.r ?? null], turns, visit: { fed, nectar } });
      }
      if (diverged) break;
    }
    if (!diverged) beesChecked++;
  } finally { a.kill(); b.kill(); }
}

console.log(`flowers: ${flowersChecked} checked on ${flowerCalls} challenges; bees: ${beesChecked} replayed through ${beeCalls} calls`);
console.log(`differences: ${failures.length}`);
for (const f of failures.slice(0, 8)) {
  console.log(`\n--- ${f.kind} (${f.why}) ${f.c !== undefined ? "challenge " + JSON.stringify(f.c) : ""}${f.req ? "request " + JSON.stringify(f.req).slice(0, 120) : ""}`);
  console.log("original:", JSON.stringify(f.a).slice(0, 300));
  console.log("minified:", JSON.stringify(f.b).slice(0, 300));
  console.log(f.code.slice(0, 1200));
  console.log("~~~ minified:\n" + f.minified.slice(0, 800));
}
await pool.end();
