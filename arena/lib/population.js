// Population management: retire personas that repeatedly do poorly socially (mandatory) or on fitness,
// and refill the slots with personas written by competing breeders (biased towards successful breeders).
import { all, one, q } from "./db.js";
import { BudgetError, callModel, extractJson } from "./llm.js";
import { BREEDERS } from "./personas.js";
import { breederPrompt, breederSystem } from "./prompts.js";
import { loadLedger } from "./social.js";

export const RULES_CFG = {
  socialFloor: Number(process.env.ARENA_SOCIAL_FLOOR || 4.0), // mean social (0..10) over last games below this -> retire
  window: 3,                                                  // look at the last 3 games
  minGames: 2,                                                // never retire before 2 games played
};

export async function seedBreeders() {
  for (const b of BREEDERS) {
    await q(`INSERT INTO arena.breeders (id, name, model, prompt) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=$2, model=$3, prompt=$4`,
      [b.id, b.name, b.model, breederSystem(b)]);
  }
}

const pct = (rank, n) => (n > 1 && rank ? 1 - (rank - 1) / (n - 1) : 0.5);

/** Per-persona history in this arena: last games (newest first) with ranks and percentiles. */
async function history(arenaId) {
  const rows = await all(`
    SELECT e.persona_id, g.generation, e.fitness, e.fitness_rank, e.social, e.social_rank,
           (SELECT count(*)::int FROM arena.entries e2 WHERE e2.game_id = e.game_id) AS n
      FROM arena.entries e JOIN arena.games g ON g.id = e.game_id
     WHERE g.arena_id = $1 AND e.fitness IS NOT NULL
     ORDER BY g.generation DESC`, [arenaId]);
  const h = {};
  for (const r of rows) (h[r.persona_id] ||= []).push({ ...r, fitPct: pct(r.fitness_rank, r.n), socPct: r.social_rank ? pct(r.social_rank, r.n) : null });
  return h;
}

/** Decide retirements after a generation. Returns [{persona, reason, combined}]. */
export async function decideRetirements(arena, generation, log) {
  const active = await all("SELECT * FROM arena.personas WHERE arena_id = $1 AND status = 'active' ORDER BY id", [arena.id]);
  const h = await history(arena.id);
  const N = active.length;
  const cands = [];
  for (const p of active) {
    const games = (h[p.id] || []).slice(0, RULES_CFG.window);
    if (games.length < RULES_CFG.minGames) continue;
    const socialBQ = games.filter((g) => g.social_rank && g.social_rank > 0.75 * g.n).length;
    const socials = games.map((g) => g.social).filter((x) => x != null);
    const meanSocial = socials.length ? socials.reduce((s, x) => s + x, 0) / socials.length : null;
    const fitBQ = games.filter((g) => g.fitness_rank > 0.75 * g.n).length;
    const last2 = games.slice(0, 2);
    const combined = last2.reduce((s, g) => s + (g.fitPct + (g.socPct ?? 0.5)) / 2, 0) / last2.length;
    let reason = null;
    if (socialBQ >= 2) reason = `social bottom quartile in ${socialBQ} of last ${games.length} games`;
    else if (meanSocial != null && meanSocial < RULES_CFG.socialFloor) reason = `mean social ${meanSocial.toFixed(2)} < floor ${RULES_CFG.socialFloor}`;
    else if (fitBQ >= 2 && combined < 0.4) reason = `fitness bottom quartile in ${fitBQ} of last ${games.length} games (combined ${combined.toFixed(2)})`;
    cands.push({ persona: p, reason, combined, meanSocial, socialBQ, fitBQ, social: !!reason && !reason.startsWith("fitness") });
  }
  let out = cands.filter((c) => c.reason);
  // Selection pressure floor: if nobody is flagged, retire the weakest overall if it is clearly weak.
  if (!out.length) {
    const worst = [...cands].sort((a, b) => a.combined - b.combined)[0];
    if (worst && worst.combined < 0.3) out = [{ ...worst, reason: `weakest overall (combined fitness+social percentile ${worst.combined.toFixed(2)} < 0.30)` }];
  }
  const cap = Math.ceil(N / 3);
  // Social retirements are mandatory, so they go first; fitness ones fill the remaining cap.
  out.sort((a, b) => (b.social - a.social) || (a.combined - b.combined));
  if (out.length > cap) {
    for (const c of out.slice(cap)) log(`  (cap) would also retire ${c.persona.name}: ${c.reason}`);
    out = out.slice(0, cap);
  }
  for (const c of cands.filter((c) => !out.includes(c))) {
    await q("INSERT INTO arena.population_events (arena_id, generation, persona_id, event, reason, details) VALUES ($1,$2,$3,'survived',$4,$5)",
      [arena.id, generation, c.persona.id, c.reason || null, JSON.stringify({ combined: c.combined, meanSocial: c.meanSocial, socialBQ: c.socialBQ, fitBQ: c.fitBQ })]);
  }
  return out;
}

export async function retire(arena, generation, c) {
  await q("UPDATE arena.personas SET status = 'retired', retired_after = $2, retire_reason = $3 WHERE id = $1", [c.persona.id, generation, c.reason]);
  await q("INSERT INTO arena.population_events (arena_id, generation, persona_id, event, reason, details) VALUES ($1,$2,$3,'retired',$4,$5)",
    [arena.id, generation, c.persona.id, c.reason, JSON.stringify({ combined: c.combined, meanSocial: c.meanSocial, socialBQ: c.socialBQ, fitBQ: c.fitBQ })]);
}

// ---------------------------------------------------------------- breeders

/** Breeder score = mean over spawn-games of (fitness percentile + social percentile) / 2, across all arenas. */
export async function breederScores() {
  const rows = await all(`
    SELECT p.breeder_id, p.id AS persona_id, p.status, e.fitness_rank, e.social_rank,
           (SELECT count(*)::int FROM arena.entries e2 WHERE e2.game_id = e.game_id) AS n
      FROM arena.personas p JOIN arena.entries e ON e.persona_id = p.id
     WHERE p.breeder_id IS NOT NULL AND e.fitness IS NOT NULL AND e.social IS NOT NULL`);
  const out = {};
  for (const b of BREEDERS) {
    const rs = rows.filter((r) => r.breeder_id === b.id);
    const spawns = await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'retired')::int AS retired FROM arena.personas WHERE breeder_id = $1", [b.id]);
    const fit = rs.map((r) => pct(r.fitness_rank, r.n)), soc = rs.map((r) => pct(r.social_rank, r.n));
    const m = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    out[b.id] = { ...b, games: rs.length, spawns: spawns.n, retired: spawns.retired, fitPct: m(fit), socPct: m(soc), score: rs.length ? (m(fit) + m(soc)) / 2 : null };
  }
  return out;
}

function pickBreeder(scores, rnd = Math.random) {
  const ws = Object.values(scores).map((b) => [b.id, Math.exp(4 * ((b.score ?? 0.5) - 0.5))]);
  const tot = ws.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * tot;
  for (const [id, w] of ws) { if ((x -= w) <= 0) return id; }
  return ws[ws.length - 1][0];
}

async function populationText(arena) {
  const ps = await all("SELECT * FROM arena.personas WHERE arena_id = $1 AND status = 'active' ORDER BY id", [arena.id]);
  const h = await history(arena.id);
  const lines = [];
  for (const p of ps) {
    const g = h[p.id] || [];
    const tags = await all(`SELECT DISTINCT i.tag FROM arena.idea_sightings s JOIN arena.ideas i ON i.id = s.idea_id WHERE s.persona_id = $1 LIMIT 8`, [p.id]);
    lines.push(`- ${p.name} / team "${p.team_name}" (${p.archetype}; model ${p.model}; ${p.breeder_id ? "bred by " + p.breeder_id : "founder"}; ${g.length} games). ` +
      (g.length ? `Fitness by game (newest first): ${g.map((x) => `${x.fitness?.toFixed(2)} (#${x.fitness_rank}/${x.n})`).join(", ")}. Social: ${g.map((x) => `${x.social?.toFixed(1) ?? "-"} (#${x.social_rank ?? "-"})`).join(", ")}.` : "") +
      (tags.length ? ` Ideas judges saw: ${tags.map((t) => t.tag).join(", ")}.` : ""));
  }
  return lines.join("\n");
}

async function recordsText() {
  const scores = await breederScores();
  const out = [];
  for (const b of Object.values(scores)) {
    out.push(`## Breeder ${b.name} (${b.id}, model ${b.model}): score ${b.score?.toFixed(3) ?? "no data yet"}, ${b.spawns} spawn, ${b.retired} retired, mean fitness percentile ${b.fitPct?.toFixed(2) ?? "-"}, mean social percentile ${b.socPct?.toFixed(2) ?? "-"}`);
    const spawn = await all(`SELECT p.*, (SELECT json_agg(json_build_object('f', e.fitness, 'fr', e.fitness_rank, 's', e.social, 'sr', e.social_rank) ORDER BY e.game_id) FROM arena.entries e WHERE e.persona_id = p.id AND e.fitness IS NOT NULL) AS games
                               FROM arena.personas p WHERE p.breeder_id = $1 ORDER BY p.created_at`, [b.id]);
    for (const s of spawn) {
      const g = s.games || [];
      out.push(`- ${s.name} / "${s.team_name}" (${s.arena_id}, ${s.model}, ${s.archetype}): ${g.length} games${g.length ? ": " + g.map((x) => `fit ${x.f?.toFixed(2)} #${x.fr}, social ${x.s?.toFixed(1) ?? "-"} #${x.sr ?? "-"}`).join("; ") : ""}. ${s.status === "retired" ? `RETIRED (${s.retire_reason})` : "active"}.`);
    }
  }
  return out.join("\n");
}

async function exemplarsText(arena) {
  const last = await one("SELECT id FROM arena.games WHERE arena_id = $1 AND stage IN ('judged','done') ORDER BY generation DESC LIMIT 1", [arena.id]);
  if (!last) return "(none yet)";
  const top = await all(`SELECT p.name, p.team_name, p.persona_prompt, e.fitness_rank, e.social_rank FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id
                          WHERE e.game_id = $1 ORDER BY (coalesce(e.fitness_rank, 99) + coalesce(e.social_rank, 99)) LIMIT 2`, [last.id]);
  return top.map((t) => `### ${t.name} / "${t.team_name}" (latest game: fitness #${t.fitness_rank}, social #${t.social_rank})\n${t.persona_prompt}`).join("\n\n");
}

const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "spawn";

/** Breed one persona into an open slot. Returns the new persona row. */
export async function breed(arena, generation, slot, log) {
  const scores = await breederScores();
  const bid = pickBreeder(scores);
  const b = BREEDERS.find((x) => x.id === bid);
  const prompt = breederPrompt({
    arena, config: arena.settings.config, population: await populationText(arena), records: await recordsText(),
    ideas: await loadLedger(), exemplars: await exemplarsText(arena), slot,
  });
  let spec = null;
  for (let attempt = 0; attempt < 2 && !spec; attempt++) {
    try {
      const r = await callModel({ model: b.model, system: breederSystem(b), prompt: attempt ? prompt + "\n\nReply with the JSON object only." : prompt, effort: "medium",
        ctx: { purpose: "breeder", arenaId: arena.id, personaId: "breeder:" + b.id } });
      const j = extractJson(r.text);
      if (j && typeof j.persona_prompt === "string" && j.persona_prompt.length > 100 && j.name && j.team_name) spec = j;
    } catch (e) { if (e instanceof BudgetError) throw e; log(`  breeder ${b.name} failed: ${e.message}`); }
  }
  if (!spec) throw new Error(`breeder ${b.name} produced no valid persona`);
  const taken = new Set((await all("SELECT lower(team_name) AS t FROM arena.personas WHERE arena_id = $1 AND status = 'active'", [arena.id])).map((r) => r.t));
  let team = String(spec.team_name).replace(/\s+/g, " ").trim().slice(0, 32);
  while (taken.has(team.toLowerCase())) team = team.slice(0, 29) + " " + Math.floor(Math.random() * 90 + 10);
  let slug = slugify(spec.name), k = 2;
  while (await one("SELECT 1 FROM arena.personas WHERE id = $1", [`${arena.id}/${slug}`])) slug = `${slugify(spec.name)}-${k++}`;
  const id = `${arena.id}/${slug}`;
  await q(`INSERT INTO arena.personas (id, arena_id, slug, name, team_name, model, archetype, is_kid, persona_prompt, breeder_id, generation_born, replaced)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, arena.id, slug, String(spec.name).slice(0, 40), team, slot.model, String(spec.archetype || "bred").slice(0, 60), !!spec.is_kid,
      String(spec.persona_prompt).slice(0, 3000), b.id, generation + 1, slot.replacingId]);
  await q("INSERT INTO arena.population_events (arena_id, generation, persona_id, event, reason, details) VALUES ($1,$2,$3,'born',$4,$5)",
    [arena.id, generation + 1, id, `bred by ${b.name} into ${slot.replacing}'s slot`, JSON.stringify({ breeder: b.id, rationale: spec.rationale, scores: Object.fromEntries(Object.values(scores).map((s) => [s.id, s.score])) })]);
  log(`  ${b.name} bred ${spec.name} / "${team}" (${slot.model}, ${spec.archetype}): ${String(spec.rationale || "").slice(0, 160)}`);
  return one("SELECT * FROM arena.personas WHERE id = $1", [id]);
}
