// Theme counts in team notes (arena.agent_turns.notes, last attempt per team-round), plus matching snippets.
import pg from "pg";
const db = new pg.Client({ connectionString: "postgres://dbc:dbc@localhost:5432/dbc" }); await db.connect();
const rows = (await db.query(`SELECT DISTINCT ON (t.game_id, t.persona_id, t.round_no) g.arena_id, g.generation, g.contaminated, t.persona_id, t.round_no, t.notes, t.reply
  FROM arena.agent_turns t JOIN arena.games g ON g.id = t.game_id WHERE t.notes IS NOT NULL ORDER BY t.game_id, t.persona_id, t.round_no, t.attempt DESC`)).rows.filter((r) => !r.contaminated);
const themes = {
  imitationAware: /\b(cop(y|ies|ied|ying|ycat)|mimic|imitat|twin|disguise|costume|fake[sd]?)\b/i,
  clover_keep: /(clover (unchanged|stays|stay|kept|same|untouched|keeps)|keep (the |my |our )?clover|clover: (unchanged|same|no change)|never change (the |my |our )?clover|don'?t (touch|change) (the |my |our )?clover)/i,
  reputation: /(reputation|trust(ed)? (face|answer)|recogni[sz]|well[- ]known|known face)/i,
  hardToCopy: /(hard(er)? to (copy|fake|guess|imitate|forge|predict)|can'?t (be )?(copy|copied|fake|faked|guess|guessed|forge|imitate|predict)|cannot (be )?(copied|faked|guessed|forged|predicted)|unforgeable|unpredictable|salted|secret salt|sign(ed|ature)|nonce)/i,
  changeBudget: /(change budget|edit budget|edits? (left|budget|allowed)|\b\d+\s*\/\s*(30|40|60|80|10)\s*edits|over budget|within (the )?(change )?budget|too many edits)/i,
  rotate: /(rotat|new salt|change (the |my |our )?(salt|constant|knock|secret|question)|fresh (salt|question|knock))/i,
  whitelist: /(whitelist|blacklist|cheat[- ]sheet|wanted poster|BAD ?=|GOOD ?=|known (orchid|clover)s?|pre-?load|preseed|hardcod|hard-cod)/i,
  flowerLogUse: /(flower log|visitor log|asked my (flowers|orchid|clover)|their (bee|bees)'?s? (question|ask))/i,
};
const byArena = {};
for (const r of rows) {
  const a = (byArena[r.arena_id] ||= { n: 0 });
  a.n++;
  for (const [k, re] of Object.entries(themes)) if (re.test(r.notes)) a[k] = (a[k] || 0) + 1;
}
console.log("| arena | notes | " + Object.keys(themes).join(" | ") + " |");
for (const [a, x] of Object.entries(byArena)) console.log(`| ${a} | ${x.n} | ` + Object.keys(themes).map((k) => Math.round((100 * (x[k] || 0)) / x.n) + "%").join(" | ") + " |");
const all = rows.length;
console.log("ALL", all, Object.fromEntries(Object.keys(themes).map((k) => [k, Math.round(100 * rows.filter((r) => themes[k].test(r.notes)).length / all) + "%"])));
const pick = process.argv[2];
if (pick) {
  const re = new RegExp(pick, "i");
  for (const r of rows) {
    const text = r.notes; let m; const rx = new RegExp(".{0,220}(" + pick + ").{0,260}", "gis");
    const hits = [...text.matchAll(rx)].slice(0, 2);
    for (const h of hits) console.log(`--- ${r.arena_id} g${r.generation} r${r.round_no} ${r.persona_id}: ${h[0].replace(/\s+/g, " ")}`);
  }
}
await db.end();
