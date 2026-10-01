#!/usr/bin/env node
// Fork a played game's population into identical cohorts for a controlled experiment.
//   node arena/fork.js --from v2-graphs --game 1 --cohorts gx-control,gx-treat,gx-control2 --treat gx-treat
// Each cohort gets its own arena (and room) with the same personas (prompt, model, team name), each persona's notebook
// as it was at the END of the source game, and a workspace holding that game as previous-games/game-0/: the team's own
// logs/history/memory, the standings, the top-2 teams' final code and the panel's feedback. The team's final programs
// become its current code. Earlier user idea cards are not carried over. In the treatment cohort, 3 of the 6 teams get
// a different slice of the asymmetric-graph-games catalogue (ideas.md), chosen by a recorded rule.
import fs from "node:fs";
import path from "node:path";
import { Api, gamePath, login } from "./lib/api.js";
import { all, migrate, one, pool, q } from "./lib/db.js";
import { WS_ROOT, wsDir, writeTop2 } from "./lib/workspace.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const from = args.from, gen = Number(args.game || 1), cohorts = String(args.cohorts).split(","), treat = String(args.treat || "").split(",");
const GENERATIONS = Number(args.generations || 3);
const SEED_BASE = Number(args["seed-base"] || 20261001);

const CONFIG = { language: "python", challengeType: "int", responseType: "graph[any]", rounds: 5, revealOnFinish: false };
const CARDS = ["G1", "G2", "G3"];
const CARD_RULE = "teams in creation order (persona slug order); the first team of each model (haiku, opus, sonnet as they first appear) gets the next card G1, G2, G3";

await migrate();
const src = await one("SELECT * FROM arena.arenas WHERE id = $1", [from]);
const srcGame = await one("SELECT * FROM arena.games WHERE arena_id = $1 AND generation = $2", [from, gen]);
if (!srcGame || !["judged", "done"].includes(srcGame.stage)) throw new Error("source game must be played and judged");
const srcView = await Api.view(null, gamePath(src.room_short_id, srcGame.game_short_id), "none");
const srcUuid = srcView.game.id;
const srcEntries = await all("SELECT e.*, p.slug, p.name, p.team_name AS ptn, p.model, p.archetype, p.is_kid, p.persona_prompt FROM arena.entries e JOIN arena.personas p ON p.id = e.persona_id WHERE e.game_id = $1 ORDER BY p.slug", [srcGame.id]);
const ext = "py";

// Treatment card holders by the recorded rule.
const holders = {};
const seenModels = new Set();
for (const e of srcEntries) if (!seenModels.has(e.model) && Object.keys(holders).length < 3) { seenModels.add(e.model); holders[e.slug] = CARDS[Object.keys(holders).length]; }

for (const cid of cohorts) {
  if (await one("SELECT 1 FROM arena.arenas WHERE id = $1", [cid])) { console.log(`${cid} exists, skipping`); continue; }
  const owner = `Arena owner ${cid}`;
  const tok = await login(owner);
  const room = await Api.createRoom(tok);
  const role = treat.includes(cid) ? "treatment" : "control";
  const settings = {
    config: CONFIG, teams: srcEntries.length, generations: GENERATIONS, mode: "tools", condition: "v2-cohort", recap: "top2", noEvolution: true,
    description: `Cohort experiment (${role}): int→graph[any], forked from ${from} game ${gen} (${srcGame.game_url}); fixed membership, identical seeds, top-2 code demo between games`,
    cohort: { experiment: "gx", role, forkOf: `${from}/game-${gen}`, seedBase: SEED_BASE, siblings: cohorts.filter((c) => c !== cid), cardRule: role === "treatment" ? CARD_RULE : null, holders: role === "treatment" ? holders : null },
  };
  await q("INSERT INTO arena.arenas (id, preset, settings, owner_name, room_short_id, room_url) VALUES ($1,'gx',$2,$3,$4,$5)", [cid, settings, owner, room.shortId, room.url]);
  for (const e of srcEntries) {
    const notes = (await one("SELECT notes FROM arena.agent_turns WHERE game_id = $1 AND persona_id = $2 AND notes IS NOT NULL ORDER BY round_no DESC, attempt DESC LIMIT 1", [srcGame.id, e.persona_id]))?.notes || "";
    const card = role === "treatment" ? holders[e.slug] || null : null;
    const pid = `${cid}/${e.slug}`;
    await q(`INSERT INTO arena.personas (id, arena_id, slug, name, team_name, model, archetype, is_kid, persona_prompt, generation_born, notebook, idea_card, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12)`, [pid, cid, e.slug, e.name, e.ptn, e.model, e.archetype, e.is_kid, e.persona_prompt, notes, card, e.persona_id]);
    await q("INSERT INTO arena.population_events (arena_id, generation, persona_id, event, reason, details) VALUES ($1,1,$2,'born',$3,$4)",
      [cid, pid, `forked from ${e.persona_id} at the end of ${from} game ${gen}`, JSON.stringify({ ideaCard: card })]);
    // Workspace: the source game as game 0.
    const dir = wsDir(cid, e.slug);
    if (fs.existsSync(dir)) throw new Error(`workspace ${dir} exists`);
    const g0 = path.join(dir, "previous-games", "game-0");
    fs.mkdirSync(g0, { recursive: true });
    const srcOwn = path.join(wsDir(from, e.slug), "previous-games", `game-${gen}`, "own");
    if (fs.existsSync(srcOwn)) fs.cpSync(srcOwn, path.join(g0, "own"), { recursive: true });
    await writeTop2(g0, srcUuid, srcEntries);
    const evs = await all("SELECT j.name, j.age, v.* FROM arena.evaluations v JOIN arena.judges j ON j.id = v.judge_id WHERE v.game_id = $1 AND v.persona_id = $2", [srcGame.id, e.persona_id]);
    fs.writeFileSync(path.join(g0, "panel.md"), `# Game 0 (warm-up): the interview panel\n\nYour panel score: ${e.social?.toFixed(1) ?? "-"} (rank ${e.social_rank ?? "-"} of ${srcEntries.length}).\n\n` +
      evs.map((v) => `- ${v.name} (${v.age}): understanding ${v.understanding}, respect ${v.respect}, novelty ${v.novelty}, team-up ${v.team_up}. "${v.comment}"`).join("\n") + "\n");
    const rp = await all("SELECT kind, code FROM round_programs WHERE game_id = $1 AND team_id = $2 AND round_no = (SELECT max(round_no) FROM round_programs WHERE game_id = $1)", [srcUuid, e.team_id]);
    for (const p of rp) fs.writeFileSync(path.join(dir, `${p.kind}.${ext}`), p.code);
  }
  console.log(`${cid} (${role}): room ${room.url}; card holders ${role === "treatment" ? JSON.stringify(holders) : "-"}`);
}
console.log(`workspaces under ${WS_ROOT}`);
await pool.end();
