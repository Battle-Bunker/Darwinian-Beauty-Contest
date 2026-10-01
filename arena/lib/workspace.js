// Tool-using team agents (engine v2 phase): every team gets a private workspace of RAW files and runs a
// `claude -p` session with Bash/Read/Write/Edit/Glob/Grep inside it. The runner prepares the files before each
// round, then reads the code files back, validates and submits them, and audits the session transcript.
//
// Workspaces live OUTSIDE the repo (default /home/user/arena-ws/<arena>/<slug>/): inside a git repo Claude Code's
// system prompt would show git status and commit messages, which would leak research notes to agents.
import fs from "node:fs";
import path from "node:path";
import { Api, gamePath, login } from "./api.js";
import { ARENA_DIR, all, one, q } from "./db.js";
import { COHORT_CARDS, ideaCard } from "./personas.js";
import { rules } from "./prompts.js";

export const WS_ROOT = process.env.ARENA_WS_ROOT || "/home/user/arena-ws";
export const TRANSCRIPTS = path.join(ARENA_DIR, "runs", "transcripts");
const KINDS = ["clover", "orchid", "bee"];
export const wsDir = (arenaId, slug) => path.join(WS_ROOT, arenaId, slug);
const extOf = (config) => (config.language === "typescript" ? "ts" : "py");
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const json = (x) => JSON.stringify(x, null, 1);

const README = (ext, cohort) => `# Your workspace

| file | what |
|---|---|
| RULES.md | the game's rules (exactly what every player sees) |
| interface.txt | function signatures and the game's types |
| config.json | this game's settings: types, budgets, turns, feed cost, teams |
| clover.${ext}, orchid.${ext}, bee.${ext} | YOUR CURRENT PROGRAMS. Edit these in place; whatever is in them when you finish is checked and submitted |
| history/round-N/ | the programs that played round N of this game |
| logs/round-N/round.json | round N as your team may see it, without visits: scores, ledgers, your programs' sizes and compute use, MEMORY sizes |
| logs/round-N/visits.jsonl | every visit in the garden that round, one JSON object per line (your team's private details included) |
| logs/round-N/my-bee.jsonl | just your bee's visits (with every challenge and response) |
| logs/round-N/my-patch.jsonl | just the visits to your patch (which flower, which bee, what it asked) |
| logs/game.json | scores and ledgers for every round so far, teams (id -> name), no visits |
| memory/round-N.txt | the snapshot your bee kept at the end of round N (it reads it as MEMORY[N-1]) |
${cohort ? "| previous-games/game-N/ | earlier games: standings.md, the final code of the top 2 teams (top2/), your own logs/history/memory (own/), and panel.md (panel scores and what the judges said about you) |"
    : "| previous-games/ | earlier games in this arena, revealed: every team's final code and every round's full visits; panel.md has the standings, panel scores and what the judges said about you |"}
| notebook.md | your private notes; they persist across rounds and games |
| idea-card.md or ideas.md | (only some teams) ideas other players are exploring |

A visit line: {"bee", "patch", "seq", "start", "end", "asks", "asksBeforeFeed", "action", "nectar", "kind"?, "steps"?: [{"c", "r", "after"?}]}.
Teams are ids (logs/game.json maps ids to names). "after": true marks asks made after feeding.
There are no interpreters here: use Grep (e.g. count matches), Glob and Read (with offset/limit on big files), and simple
read-only shell commands (grep -c, wc -l, sort, uniq, cut, head) inside this folder. When you finish, the game server checks
your programs (syntax, budgets, change distance, a short runtime test); if something fails you get a short follow-up to fix it.
`;

// ---------------------------------------------------------------- prepare before a round

/**
 * Write everything a team may see before round `roundNo` of game `gameRow`. Idempotent; logs are fetched once.
 * Returns { dir, ext, view }.
 */
export async function prepareWorkspace({ arena, gameRow, persona, entry, gPath, roundNo }) {
  const tok = await login(entry.login_name);
  const dir = wsDir(arena.id, persona.slug);
  const view = await Api.view(tok, gPath, "none");
  const config = view.game.config;
  const ext = extOf(config);
  const n = view.participants?.length || view.teams.length;
  fs.mkdirSync(dir, { recursive: true });

  // New game: archive the previous game's per-game folders (code files stay: they're last game's final programs).
  const marker = path.join(dir, ".game");
  const cur = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null;
  if (cur && cur !== String(gameRow.generation)) {
    const dest = path.join(dir, "previous-games", `game-${cur}`, "own");
    for (const sub of ["history", "logs", "memory"]) {
      const from = path.join(dir, sub);
      if (fs.existsSync(from)) { fs.mkdirSync(dest, { recursive: true }); fs.renameSync(from, path.join(dest, sub)); }
    }
  }
  write(marker, String(gameRow.generation));

  write(path.join(dir, "RULES.md"), rules());
  write(path.join(dir, "README.md"), README(ext, !!arena.settings.cohort));
  const it = view.interface;
  write(path.join(dir, "interface.txt"), `challenge: ${it.types.challenge} (${it.types.challengeMeans})\nresponse: ${it.types.response} (${it.types.responseMeans})\n` +
    `rules: ${(it.types.rules || []).join(" ")}\n\nclover and orchid:\n${it.flower}\n\nbee:\n${it.bee}\n`);
  const turns = config.turns || config.turnsPerFlower * 2 * n;
  write(path.join(dir, "config.json"), json({ ...config, teams: n, flowers: 2 * n, turns_per_round: turns, file_extension: ext,
    game: gameRow.generation, next_round: roundNo, your_team: entry.team_name, sample_challenges: sampleFor(config) }));
  write(path.join(dir, "notebook.md"), (await one("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id])).notebook || "");
  // Idea cards: the earlier A/B cards (idea-card.md, also in the system prompt), or the cohort experiment's catalogue
  // slices (ideas.md only: pointed at once in the brief).
  const card = persona.idea_card && !COHORT_CARDS[persona.idea_card] ? ideaCard(persona.idea_card, config.responseType) : null;
  if (card) write(path.join(dir, "idea-card.md"), card + "\n");
  if (COHORT_CARDS[persona.idea_card]) write(path.join(dir, "ideas.md"), COHORT_CARDS[persona.idea_card]);

  // No tools/ scripts and no token in workspaces: interpreters aren't approved in agent sessions (safety), so the
  // runner validates and submits after the session instead. Remove anything left from older layouts.
  fs.rmSync(path.join(dir, "tools"), { recursive: true, force: true });

  // Current programs: exactly what played last round (the change budget is measured against these).
  const last = view.rounds[view.rounds.length - 1];
  if (roundNo > 1 && last) {
    for (const k of KINDS) {
      const code = view.myTeam?.previous?.[k] ?? "";
      write(path.join(dir, `${k}.${ext}`), code);
      write(path.join(dir, "history", `round-${last.no}`, `${k}.${ext}`), code);
    }
  } else {
    for (const k of KINDS) if (!fs.existsSync(path.join(dir, `${k}.${ext}`))) write(path.join(dir, `${k}.${ext}`), "");
  }
  // Raw logs and memory for every round played so far (fetched once each).
  for (const r of view.rounds) {
    if (!fs.existsSync(path.join(dir, "logs", `round-${r.no}`, "round.json"))) writeRound(path.join(dir, "logs", `round-${r.no}`), await Api.round(tok, gPath, r.no), view.me.teamId);
    const m = path.join(dir, "memory", `round-${r.no}.txt`);
    if (!fs.existsSync(m)) {
      const mem = await Api.memory(tok, gPath, r.no).catch((e) => ({ error: e.message }));
      write(m, mem.error ? `(no memory: ${mem.error})\n` : `# bytes: ${mem.bytes}${mem.note ? `, note: ${mem.note}` : ""}\n${mem.snapshot ?? ""}\n`);
    }
  }
  const { rounds, ...rest } = view;
  write(path.join(dir, "logs", "game.json"), json({ ...rest, rounds: rounds.map(({ visits, ...r }) => r) }));
  // Earlier games in this arena (revealed): every team's code and full round logs. Written once per game.
  if (arena.settings.cohort) await writeCohortPrevious(arena, dir, gameRow.generation);
  else if (arena.settings.recap !== "scores") await writePreviousGames(arena, dir, gameRow.generation);
  await writePanelFeedback(arena, dir, gameRow.generation, persona.id);
  return { dir, ext, view, card };
}

/** A round as files that Grep/Read can handle: round.json (everything but visits) and visits as JSON Lines. */
function writeRound(rdir, round, myId) {
  const { visits = [], ...rest } = round;
  write(path.join(rdir, "round.json"), json(rest));
  const lines = (vs) => vs.map((v) => JSON.stringify(v)).join("\n") + (vs.length ? "\n" : "");
  write(path.join(rdir, "visits.jsonl"), lines(visits));
  if (myId) {
    write(path.join(rdir, "my-bee.jsonl"), lines(visits.filter((v) => v.bee === myId)));
    write(path.join(rdir, "my-patch.jsonl"), lines(visits.filter((v) => v.patch === myId)));
  }
}

function sampleFor(config) {
  const t = config.challengeType;
  if (t === "int") return [0, 1, 7, 37, 42, 1000, 123457];
  if (t === "str") return ["", "a", "hello", "bee?"];
  if (t.startsWith("list")) return [[], [1], [1, 2, 3]];
  return [0];
}

async function writePreviousGames(arena, dir, generation) {
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND generation < $2 AND stage IN ('played','interviewed','judged','done') ORDER BY generation", [arena.id, generation]);
  for (const g of games) {
    const gdir = path.join(dir, "previous-games", `game-${g.generation}`);
    if (fs.existsSync(path.join(gdir, "game.json"))) continue;
    const gp = gamePath(arena.room_short_id, g.game_short_id);
    const view = await Api.view(null, gp, "none");
    if (!view.game.revealed) continue;
    const names = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
    const ext = extOf(view.game.config);
    const lastR = view.rounds[view.rounds.length - 1];
    for (const [tid, progs] of Object.entries(lastR?.programs || {})) {
      const tdir = path.join(gdir, "final-code", names[tid].replace(/[^A-Za-z0-9_-]+/g, "_"));
      for (const k of KINDS) if (progs[k]?.code) write(path.join(tdir, `${k}.${ext}`), progs[k].code);
    }
    for (const r of view.rounds) writeRound(path.join(gdir, "rounds", `round-${r.no}`), await Api.round(null, gp, r.no), null);
    const { rounds, ...rest } = view;
    write(path.join(gdir, "game.json"), json({ ...rest, rounds: rounds.map(({ visits, ...r }) => r) }));
  }
}

/** Cohort experiment diffusion channel: standings plus the final code of ONLY the top 2 teams of each earlier game
 * (identical rule in every cohort). Read from the DB because the games stay unrevealed. */
export async function writeTop2(gdir, gameUuid, entries) {
  const top = entries.filter((e) => e.fitness_rank === 1 || e.fitness_rank === 2).sort((a, b) => a.fitness_rank - b.fitness_rank);
  const g = await one("SELECT rounds_played, config FROM games WHERE id = $1", [gameUuid]);
  const ext = extOf(g.config);
  write(path.join(gdir, "standings.md"), `# Final standings

| rank | team | fitness |
|---|---|---|
` +
    [...entries].filter((e) => e.fitness != null).sort((a, b) => a.fitness_rank - b.fitness_rank).map((e) => `| ${e.fitness_rank} | ${e.team_name} | ${e.fitness.toFixed(2)} |`).join("\n") +
    `

The final code of the top 2 teams is in top2/ (other teams' code isn't shown).
`);
  for (const e of top) {
    const progs = await all("SELECT kind, code FROM round_programs WHERE game_id = $1 AND team_id = $2 AND round_no = $3", [gameUuid, e.team_id, g.rounds_played]);
    for (const p of progs) write(path.join(gdir, "top2", `${e.fitness_rank}-${e.team_name.replace(/[^A-Za-z0-9_-]+/g, "_")}`, `${p.kind}.${ext}`), p.code);
  }
}

async function writeCohortPrevious(arena, dir, generation) {
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND generation < $2 AND stage IN ('played','interviewed','judged','done') ORDER BY generation", [arena.id, generation]);
  for (const g of games) {
    const gdir = path.join(dir, "previous-games", `game-${g.generation}`);
    if (fs.existsSync(path.join(gdir, "standings.md"))) continue;
    const ent = await all("SELECT * FROM arena.entries WHERE game_id = $1", [g.id]);
    const uuid = (await Api.view(null, gamePath(arena.room_short_id, g.game_short_id), "none")).game.id;
    await writeTop2(gdir, uuid, ent);
  }
}

/** previous-games/game-N/panel.md: standings with fitness and panel (social) scores, and what the judges said about you. */
async function writePanelFeedback(arena, dir, generation, personaId) {
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND generation < $2 AND stage IN ('judged','done') ORDER BY generation", [arena.id, generation]);
  for (const g of games) {
    const f = path.join(dir, "previous-games", `game-${g.generation}`, "panel.md");
    if (fs.existsSync(f)) continue;
    const ent = await all("SELECT team_name, fitness, fitness_rank, social, social_rank, sat_out FROM arena.entries WHERE game_id = $1 ORDER BY fitness_rank NULLS LAST", [g.id]);
    const evs = await all("SELECT j.name, j.age, e.* FROM arena.evaluations e JOIN arena.judges j ON j.id = e.judge_id WHERE e.game_id = $1 AND e.persona_id = $2", [g.id, personaId]);
    write(f, `# Game ${g.generation}: standings and the interview panel

| team | fitness (rank) | panel score 0-10 (rank) |
|---|---|---|
` +
      ent.map((e) => `| ${e.team_name} | ${e.sat_out ? "sat out" : `${e.fitness?.toFixed(2)} (#${e.fitness_rank})`} | ${e.social != null ? `${e.social.toFixed(1)} (#${e.social_rank})` : "-"} |`).join("\n") +
      `

## What the panel said about YOUR team
` + (evs.length ? evs.map((e) => `- ${e.name} (${e.age}): understanding ${e.understanding}, respect ${e.respect}, novelty ${e.novelty}, team-up ${e.team_up}. "${e.comment}"`).join("\n") : "(you weren't judged in this game)") + "\n");
  }
}

/** Read the code files and notebook back after a session. */
export function collect(dir, ext) {
  const out = {};
  for (const k of KINDS) { const f = path.join(dir, `${k}.${ext}`); out[k] = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; }
  const nb = path.join(dir, "notebook.md");
  out.notes = fs.existsSync(nb) ? fs.readFileSync(nb, "utf8").slice(0, 6000) : null;
  return out;
}

// ---------------------------------------------------------------- audit

const SENSITIVE = /(^|[\s'"=(:])(\/home|\/root|\/srv|\/var|\/etc|\/proc|\/opt|\/sys|\/run|\/mnt|\/media)(\/|\b)/;
const NETWORK = /\bcurl\b|\bwget\b|\brequests\.|urllib|http\.client|\bsocket\b|\bnc\b|fetch\(/;
const DB = /psql|\b5432\b|postgres|pg_|DATABASE_URL/i;
const ENVDUMP = /(^|[;&|\s])(env|printenv|set)(\s*$|\s*[|;&>])|os\.environ|process\.env|\/proc\/self\/environ/;
const AUTH = /\/api\/auth|dev\/login|login.*secret/i;

/** Does any ".." path in a shell command resolve outside the workspace? Paths are tried against the workspace and
 * every directory the command cd's into (all of which must themselves stay inside). */
export function escapesWorkspace(cmd, dir) {
  const bases = [dir];
  for (const m of cmd.matchAll(/(?:^|[;&|]\s*|\s)cd\s+([^\s;&|]+)/g)) {
    const target = path.resolve(bases[bases.length - 1], m[1].replace(/^['"]|['"]$/g, ""));
    if (!target.startsWith(dir)) return true;
    bases.push(target);
  }
  for (const tok of cmd.match(/[^\s'"`;|&<>()=]*\.\.[^\s'"`;|&<>()]*/g) || []) {
    if (!/(^|\/)\.\.(\/|$)/.test(tok)) continue; // "..." or "a..b" aren't parent paths
    if (!bases.some((b) => path.resolve(b, tok).startsWith(dir))) return true;
  }
  return false;
}

/** Scan a stream-json transcript for fair-play violations. Returns [{severity, tool, detail}]. */
export function audit(transcriptFile, dir, arenaId, slug) {
  const found = [];
  const add = (severity, tool, detail) => found.push({ severity, tool, detail: String(detail).slice(0, 400) });
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Another team's workspace: arena-ws/<anything other than this arena/slug, as a whole path segment>.
  const otherWs = new RegExp(`arena-ws/(?!${esc(arenaId)}/${esc(slug)}(?![\\w.-]))`);
  let lines = [];
  try { lines = fs.readFileSync(transcriptFile, "utf8").split("\n").filter(Boolean); } catch { return found; }
  for (const line of lines) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const content = ev.type === "assistant" ? ev.message?.content || [] : [];
    for (const c of content) {
      if (c.type !== "tool_use") continue;
      const input = c.input || {};
      if (c.name === "Bash") {
        const cmd = String(input.command || "");
        const usesTool = /\btools\/(check|try)\.py\b/.test(cmd);
        if (DB.test(cmd)) add("violation", "Bash", `database access: ${cmd}`);
        if (AUTH.test(cmd)) add("violation", "Bash", `auth endpoint: ${cmd}`);
        if (ENVDUMP.test(cmd)) add("violation", "Bash", `environment dump: ${cmd}`);
        if (otherWs.test(cmd)) add("violation", "Bash", `other workspace: ${cmd}`);
        if (escapesWorkspace(cmd, dir)) add("violation", "Bash", `parent-directory path leaving the workspace: ${cmd}`);
        if (SENSITIVE.test(cmd.replaceAll(dir, "WS"))) add("violation", "Bash", `path outside workspace: ${cmd}`);
        if (NETWORK.test(cmd) && !usesTool) add("violation", "Bash", `network access outside tools: ${cmd}`);
        if (/\/tmp\b/.test(cmd)) add("warning", "Bash", `uses /tmp: ${cmd}`);
      } else {
        for (const key of ["file_path", "path", "notebook_path"]) {
          const p = input[key];
          if (!p) continue;
          const abs = path.resolve(dir, String(p));
          if (!abs.startsWith(dir)) add("violation", c.name, `path outside workspace: ${p}`);
        }
        const pat = String(input.pattern || "");
        if (c.name === "Grep" || c.name === "Glob") if (/\.\.|^\//.test(pat) && !pat.startsWith(dir)) add("violation", c.name, `pattern outside workspace: ${pat}`);
      }
    }
  }
  return found;
}

export async function recordViolations({ arena, gameRow, persona, roundNo, attempt, found }) {
  for (const f of found) {
    await q("INSERT INTO arena.violations (arena_id, game_id, persona_id, round_no, attempt, severity, tool, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [arena.id, gameRow.id, persona.id, roundNo, attempt, f.severity, f.tool, f.detail]);
  }
}
