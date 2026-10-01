// Teen social evaluation: interviews, judges, the idea ledger, social scores.
// Social score is its own number per persona per game. It is never mixed into game fitness.
import { all, one, q } from "./db.js";
import { BudgetError, callModel, extractJson } from "./llm.js";
import { JUDGES } from "./personas.js";
import { judgePrompt, judgeSystem } from "./prompts.js";

const W = { understanding: 0.2, respect: 0.3, novelty: 0.2, team_up: 0.3 };

export async function seedJudges() {
  for (const j of JUDGES) {
    await q(`INSERT INTO arena.judges (id, name, age, model, prompt) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET name = $2, age = $3, model = $4, prompt = $5`, [j.id, j.name, j.age, j.model, j.prompt]);
  }
}

export async function loadLedger() {
  return all(`SELECT i.id, i.tag, i.description, i.first_team, i.first_arena, i.first_game_id,
                     (SELECT count(DISTINCT s.game_id)::int FROM arena.idea_sightings s WHERE s.idea_id = i.id) AS games
                FROM arena.ideas i ORDER BY i.id`);
}

export const normTag = (t) => String(t || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function shuffle(a, seed) {
  const r = [...a];
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function matchTeam(name, teams) {
  const n = String(name || "").toLowerCase().trim().replace(/^team\s+/, "").replace(/^"|"$/g, "");
  return teams.find((t) => t.name.toLowerCase() === n)
    || teams.find((t) => n.startsWith(t.name.toLowerCase()) || t.name.toLowerCase().startsWith(n))
    || null;
}

const clamp = (x) => Math.max(0, Math.min(10, Number(x) || 0));

async function runJudge({ judge, arena, gameRow, config, teams, ideas, extraIdeas, starters, log }) {
  const ordered = shuffle(teams, gameRow.id * 31 + judge.id.length * 7 + judge.id.charCodeAt(0));
  const ledger = [...ideas, ...extraIdeas.map((x) => ({ ...x, description: x.description + " [NEW in this very game: first spotted by another judge just now, still counts as new]" }))];
  const prompt = judgePrompt({ config, teams: ordered, ideas: ledger, starters, arenaLabel: `arena ${arena.id}, game ${gameRow.generation}` });
  let parsed = null, text = "";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const r = await callModel({
      model: judge.model, system: judgeSystem(judge),
      prompt: attempt ? prompt + `\n\nIMPORTANT: your last reply was not valid JSON. Reply with the JSON object only.` : prompt,
      effort: judge.model === "haiku" ? "low" : "medium", ctx: { purpose: "judge", arenaId: arena.id, gameId: gameRow.id, personaId: "judge:" + judge.id },
    });
    text = r.text;
    const j = extractJson(text);
    if (j && Array.isArray(j.teams)) parsed = j;
  }
  if (!parsed) { log(`  judge ${judge.name}: no valid JSON`); return []; }
  const out = [];
  for (const e of parsed.teams) {
    const t = matchTeam(e.team, teams);
    if (!t || out.some((o) => o.persona_id === t.persona_id)) continue;
    out.push({
      judge_id: judge.id, persona_id: t.persona_id, team: t.name,
      understanding: clamp(e.understanding), respect: clamp(e.respect), novelty: clamp(e.novelty), team_up: clamp(e.team_up),
      summary: String(e.my_summary || "").slice(0, 1500), comment: String(e.comment || "").slice(0, 1500),
      tags: (Array.isArray(e.ideas) ? e.ideas : []).slice(0, 5).map((i) => ({ tag: normTag(i.tag), known: !!i.known, desc: String(i.desc || "").slice(0, 200) })).filter((i) => i.tag),
    });
  }
  return out;
}

/**
 * teams: [{ persona_id, name, explanation, code: {clover, orchid, bee} }]
 * Two waves: one judge first (its new tags are shown to the others so tags converge), then the rest in parallel.
 */
export async function judgeGame({ arena, gameRow, config, teams, starters, log }) {
  const judges = await all("SELECT * FROM arena.judges ORDER BY id");
  const ideasBefore = await loadLedger();
  const known = new Map(ideasBefore.map((i) => [i.tag, i]));
  const firstIdx = gameRow.id % judges.length;
  const first = judges[firstIdx], rest = judges.filter((_, i) => i !== firstIdx);
  const results = [];
  const safe = async (judge, extra) => {
    try { return await runJudge({ judge, arena, gameRow, config, teams, ideas: ideasBefore, extraIdeas: extra, starters, log }); }
    catch (e) { if (e instanceof BudgetError) throw e; log(`  judge ${judge.name} failed: ${e.message}`); return []; }
  };
  const r1 = await safe(first, []);
  results.push(...r1);
  const fresh = new Map();
  for (const e of r1) for (const t of e.tags) if (!known.has(t.tag) && !fresh.has(t.tag)) fresh.set(t.tag, { tag: t.tag, description: t.desc, games: 0, first_team: e.team });
  for (const r of await Promise.all(rest.map((j) => safe(j, [...fresh.values()])))) results.push(...r);

  // Store evaluations and update the idea ledger.
  for (const e of results) {
    await q(`INSERT INTO arena.evaluations (game_id, judge_id, persona_id, understanding, respect, novelty, team_up, summary, tags, comment)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (game_id, judge_id, persona_id) DO UPDATE
             SET understanding=$4, respect=$5, novelty=$6, team_up=$7, summary=$8, tags=$9, comment=$10`,
      [gameRow.id, e.judge_id, e.persona_id, e.understanding, e.respect, e.novelty, e.team_up, e.summary, JSON.stringify(e.tags), e.comment]);
    for (const t of e.tags) {
      const isNew = !known.has(t.tag);
      if (isNew) {
        await q(`INSERT INTO arena.ideas (tag, description, first_game_id, first_arena, first_team, first_persona) VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (tag) DO NOTHING`, [t.tag, t.desc || t.tag, gameRow.id, arena.id, e.team, e.persona_id]);
      }
      const idea = await one("SELECT id FROM arena.ideas WHERE tag = $1", [t.tag]);
      if (idea) await q(`INSERT INTO arena.idea_sightings (idea_id, game_id, persona_id, judge_id, new_in_game) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [idea.id, gameRow.id, e.persona_id, e.judge_id, isNew]);
    }
  }

  // Social score per persona: weighted mean over judges.
  const scores = [];
  for (const t of teams) {
    const ev = results.filter((e) => e.persona_id === t.persona_id);
    if (!ev.length) { scores.push({ persona_id: t.persona_id, social: null }); continue; }
    const mean = (k) => ev.reduce((s, e) => s + e[k], 0) / ev.length;
    const parts = { understanding: mean("understanding"), respect: mean("respect"), novelty: mean("novelty"), team_up: mean("team_up"), judges: ev.length };
    parts.newIdeas = [...new Set(ev.flatMap((e) => e.tags.filter((x) => !known.has(x.tag)).map((x) => x.tag)))];
    const social = Object.entries(W).reduce((s, [k, w]) => s + w * parts[k], 0);
    scores.push({ persona_id: t.persona_id, social, parts });
  }
  const ranked = scores.filter((s) => s.social != null).sort((a, b) => b.social - a.social);
  for (const s of scores) {
    const rank = s.social == null ? null : ranked.indexOf(s) + 1;
    await q("UPDATE arena.entries SET social = $3, social_rank = $4, social_parts = $5 WHERE game_id = $1 AND persona_id = $2",
      [gameRow.id, s.persona_id, s.social, rank, JSON.stringify(s.parts || null)]);
  }
  return { evaluations: results.length, scores };
}
