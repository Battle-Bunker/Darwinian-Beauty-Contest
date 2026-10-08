// Tool-using team agents: every team gets a private workspace of RAW files and runs `claude -p` sessions with
// Bash/Read/Write/Edit/Glob/Grep inside it. The runner writes the files before each session; the live action stream
// arrives as an append-only file hard-linked from the runner's shared copy (lib/stream.js); requests that need the
// team's login (submit, check, try, status) go through tools/*.py and the runner (lib/broker.js). After a session the
// runner reads the notebook back and audits the transcript (also while the session runs, before every request).
//
// Workspaces live OUTSIDE the repo (default /home/user/arena-ws/<arena>/<slug>/): inside a git repo Claude Code's
// system prompt would show git status and commit messages, which would leak research notes to agents.
import fs from "node:fs";
import path from "node:path";
import { ARENA_DIR, all, one } from "./db.js";
import { Api, gamePath } from "./api.js";
import { rules } from "./prompts.js";
import { STREAM_PREVIEW } from "./stream.js";

export const WS_ROOT = process.env.ARENA_WS_ROOT || "/home/user/arena-ws";
export const TRANSCRIPTS = path.join(ARENA_DIR, "runs", "transcripts");
const TOOLS_SRC = path.join(ARENA_DIR, "tools");
const KINDS = ["flower", "bee"];
export const wsDir = (arenaId, slug) => path.join(WS_ROOT, arenaId, slug);
export const extOf = (config) => (config.language === "typescript" ? "ts" : "py");
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const json = (x) => JSON.stringify(x, null, 1);
export const mmss = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "_");

// ---------------------------------------------------------------- the files

/** The documents a primed cohort shares as common knowledge (arena.settings.common = { dir }), or, for a persona with a
 * role that has its own documents (arena.settings.roles[slug].common: a folder, or several merged in order), those:
 * { dir, dirs, files, scope: "all" | "role" } or null. */
export function commonFiles(arena, persona = null) {
  const r = persona ? arena?.settings?.roles?.[persona.slug] : null;
  if (r?.common) {
    const parts = [r.common].flat().map((d) => commonFiles({ settings: { common: { dir: d } } }));
    return { dir: parts[0].dir, dirs: parts.map((x) => x.dir), files: [...new Set(parts.flatMap((x) => x.files))].sort(), scope: "role" };
  }
  const c = arena?.settings?.common;
  if (!c?.dir) return null;
  const dir = path.resolve(ARENA_DIR, "..", c.dir);
  return { dir, dirs: [dir], files: fs.readdirSync(dir).filter((f) => !f.startsWith(".") && fs.statSync(path.join(dir, f)).isFile()).sort(), scope: "all" };
}

/** The workspace docs for a game whose response cap is at most 4 KB: nothing about responses over 4 KB (stored as their
 * size, hash and first characters), which it can't have. */
const BIG_RESPONSE_TEXT = [
  [/ \(over 4 KB, its size, hash and first bytes\)/g, ""],
  [/ \(a response over 4 KB is only its size, hash and first bytes in the files and queries\)/g, ""],
  [/ A response over\n4 KB reads as None, with its size in `response_bytes` and the SHA-256 of its JSON text in `response_hash` \(equal\nresponses, equal hashes\); `garden\.response\(t\.seq\)` fetches the whole of it\./g, ""],
  [/ \(null if the flower failed, or if it is over 4 KB\)/g, " (null if the flower failed)"],
  [/; for a response over 4 KB, the SHA-256 of its JSON text \(`python3 tools\/stream\.py response <seq>` has the whole of it\)/g, "; responseHash stays null in this game"],
  [/; for one over 4 KB, its SHA-256 and its first \d+ characters \(the whole of it: `python3 tools\/stream\.py response <seq>`\)/g, "; rHash and rPreview stay null in this game"],
];
export const forCap = (text, config) => ((config?.maxResponseBytes ?? 65536) > 4096 ? text : BIG_RESPONSE_TEXT.reduce((t, [re, to]) => t.replace(re, to), text));

export function readme({ ext, apiBase, examples, common = null, commonScope = "all" }) {
  return `# Your workspace

| path | what |
|---|---|
| RULES.md | the game's rules (exactly what every player sees) |
| interface.txt | the functions each program defines and this game's types |
| config.json | this game's settings: types, minutes, budgets, feed cost, the teams in index order, the public API address |
| flower.${ext}, bee.${ext} | YOUR PROGRAMS: your flower species and your bee. While the game runs they hold the versions that were playing when this session started. Editing a file changes nothing in the game: only \`tools/submit.py\` does |
| drafts/ | edits from an earlier session that were never submitted |
| history/ | every version your team submitted in this game (\`<kind>/v1.${ext}\`, ...) and versions.md: when each went live, its size, its change cost |
| status.txt | what \`tools/status.py\` said when this session started |
| notebook.md | your private notes: they carry over to your next sessions and games |
| stream/history.jsonl | YOUR TEAM'S HISTORY: one turn record per finished turn, oldest first, as your team may see it (your programs see no history: this is for you and your scripts). The runner appends new turns about once a second while the game runs. Query it (tools/query.py --local, garden.local); never write to it |
| stream/actions.jsonl | the public action stream: every arrival and every turn's end as anyone sees it |
| stream/mine.jsonl | your own bee's and flower's actions as your team sees them, with your bee's printouts (\`log\`), decision times and errors |
| stream/teams.json, stream/SCHEMA.md | team ids, names and indices; what each file holds |
| tools/ | the tools below, and history.py: the typed history query builder, as a Python module |
| previous-games/ | earlier games in this arena, revealed: every team's final code, the standings, everyone's change timeline, and what the interview panel said about you |
${examples ? `| examples/ | example programs; every team in this garden has the same files (${examples.join(", ")}) |\n` : ""}${common ? (commonScope === "role" ? `| common/ | documents for your role: every team with your role has exactly these files, and no other team has them (${common.join(", ")}). Read only: the runner restores them at every game |\n`
  : `| common/ | common knowledge: every team in this garden has exactly these files and knows that every other team has them (${common.join(", ")}). Read only: the runner restores them at every game |\n`) : ""}
## Tools (run them with python3 from this folder)

| command | what |
|---|---|
| \`python3 tools/status.py [--afford N] [--memory]\` | the clock and time left, your change budgets right now (available, rate, cap; when you could afford N nodes), the live scores, your versions playing now, your bee's MEMORY (size; its value with --memory), and in a game with species prevalence every species' p_s and P_s |
| \`python3 tools/check.py <kind> [file]\` | free: size against the budget, what submitting would cost now and whether you can afford it, a quick runtime test |
| \`python3 tools/try.py flower [file] [challenge ...] [--budget MS\\|random]\` | free: run a flower on challenges on the game's real runner, each call with a hidden budget R (one you choose, or a random one as in a game; your flower reads it as GAME["ms"]): response (over 4 KB, its size, hash and first bytes), percent, R, energy and compute time for each |
| \`python3 tools/try.py bee [file] [--flower FILE] [--rounds N] [--memory JSON]\` | free: run a test bee for N rounds in a garden of just your own flower (FILE, else your latest submitted flower), starting with that MEMORY, with fed() called after each feed as in a game; it never touches your game bee's MEMORY |
| \`python3 tools/submit.py <kind> [file]\` | submit: in the lobby it's free; during the game it goes live at once and pays its change cost. A new bee version starts with an empty MEMORY |
| \`python3 tools/query.py '<query>' [--local\\|--room]\` | ask the game's history with the typed query builder (below) |
| \`python3 tools/query.py summary\` | per species and per bee: turns, feeds, nectar, pollen; your own flower's percent, energy and compute |
| \`python3 tools/stream.py tail [-n 20]\` | the latest public actions |
| \`python3 tools/grains.py [--flower I] [--version V] [--show] [--save]\` | your pollen grains (a piece of the code of every flower your bee fed at) per species and version, pieced together where they overlap (best effort); --save writes each completely pieced-together version to grains/ |
| \`python3 tools/stream.py response <seq>\` | the whole response of a turn (a response over 4 KB is only its size, hash and first bytes in the files and queries) |

\`<kind>\` is flower or bee; \`[file]\` defaults to \`<kind>.${ext}\`. Your own scripts can use the same tools through
tools/garden.py (\`import sys; sys.path.insert(0, "tools"); import garden\`), and the scaffold API it documents.

A script you start may run in the background while your session lasts: start it with the Bash tool's
\`run_in_background\` option and send its output to a file here, e.g. \`python3 follow.py > follow.log 2>&1\` (a trailing
\`&\` is refused). Everything your session started is stopped when the session ends; only your scaffold outlives sessions.

## Querying history

Your programs see no history (only their arguments, GAME and the bee's MEMORY). Your team queries it, with a typed query
builder, from tools/query.py or a script:

| where | what it runs on |
|---|---|
| \`garden.local\`, \`query.py --local\` | stream/history.jsonl, in memory: your team's history (turns), about a second behind |
| \`garden.game\`, \`query.py\` | this game, run by the game server as your team may see it: turns, versions (your own), teams (your bee's MEMORY in \`memory\`, \`memory_bytes\`, \`memory_error\`), pairs, scores |
| \`garden.room\`, \`query.py --room\` | every finished game in this arena, fully revealed (\`game\` tells them apart) |

\`\`\`python
q = garden.game.turns.my_bee().eq("fed", True).group_by("flower").sum("nectar").count()
q.rows()      # (Row(flower=0, sum_nectar=..., count=...), ...)
q.ast()       # the query as JSON
garden.local.turns.rounds(10, 20).eq("flower", 2).order_by("round", desc=True).limit(5).rows()   # (Turn, ...)
garden.local.turns.count().value()
\`\`\`

Every step returns a new query; results are read-only. Conditions: \`eq ne lt le gt ge\` (field, value), \`in_\` (field,
values), \`between\` (field, lo, hi), \`is_null\` / \`not_null\` (field), \`rounds(lo, hi)\`. Scopes: \`my_bee() my_flower()
mine()\`. Shape: \`select(*fields) group_by(*fields) count(field=None) sum avg min max (field) order_by(field, desc=False)
limit(n) offset(n)\`. Run: \`rows() first() value() ast()\`. Aggregates are named \`count\` and \`<fn>_<field>\`. A field your
team may not see reads as None, in filters and aggregates too. Fields: \`python3 tools/query.py schema\`. A response over
4 KB reads as None, with its size in \`response_bytes\` and the SHA-256 of its JSON text in \`response_hash\` (equal
responses, equal hashes); \`garden.response(t.seq)\` fetches the whole of it.

## The game's public API

The public API needs no login, and you may read it (GET) at ${apiBase}, and post history queries to its query endpoint.
It shows public fields only (your private ones are in stream/history.jsonl and stream/mine.jsonl, and in garden.game):
- \`GET ${apiBase}/events?after=<seq>\`: Server-Sent Events, lines \`data: {...}\` with \`{actions, lastSeq, clockMs, round, status}\`
  as they happen
- \`${apiBase.replace(/^http/, "ws")}/ws?after=<seq>\`: the same messages over a WebSocket, one JSON text frame each. Python's
  standard library has no WebSocket client and your own code may not open raw sockets, so from Python use the events above
  (\`garden.follow_live()\` does)
- \`GET ${apiBase}/actions?after=<seq>&limit=<n ≤ 5000>\`: a page of actions
- \`GET ${apiBase}/scores\`: the live scoreboard, cheap to poll
- \`GET ${apiBase}/responses/<seq>\`: the whole response of the turn whose end is action \`seq\` (as JSON text)
- \`POST ${apiBase}/query\`: a history query (the JSON of \`q.ast()\`), public fields only
- \`GET ${apiBase}\`: the game view (status, clock, scores)

Read at most a few times a second.
`;
}

export const SCHEMA = `# The streams

## stream/history.jsonl: your team's history

One turn record per finished turn, oldest first, as your team may see it (GET .../ledger; your programs see no history),
with \`seq\` (the turn's number in the public stream). Field names are as the API gives them (\`atMs\`, \`flowerVersion\`, ...); the
query builder and garden use the Python names (\`at_ms\`, \`flower_version\`, ...). Teams are indices \`0\` to \`N - 1\`
(stream/teams.json maps them to names; yours is \`GAME["team"]\` in your programs, \`"myIndex"\` in teams.json). A field
your team may not see is null; the server decides (RULES.md, "What everyone can see").

| field | what |
|---|---|
| seq, round, atMs, turn | the turn's place in the public stream, its round (200 ms of game time), its game time, the bee's turn number |
| bee, flower | whose bee met a flower of whose species (team indices) |
| challenge, response | what the bee asked and what the flower answered (null if the flower failed, or if it is over 4 KB) |
| responseBytes, responseHash | the response's size in bytes of JSON (null if the flower failed); for a response over 4 KB, the SHA-256 of its JSON text (\`python3 tools/stream.py response <seq>\` has the whole of it) |
| fed | whether the bee fed |
| nectar, pollen | on a feed: the nectar and the pollen the flower gave the bee (on a turn without a feed: null and 0) |
| percent, energy | the share offered as nectar and the turn's excess energy E: on every feed, and on every turn at your own species (else null) |
| ms, budgetMs, flowerVersion, flowerError | your own flower's compute time, the call's hidden time budget R, version and error (null elsewhere) |
| beeMs, beeVersion, beeError | your own bee's decision time, version and error, e.g. a MEMORY over its cap or of the wrong shape (null elsewhere) |
| grain, grainVersion, grainCodeLength | on your own bee's feeds: the pollen grain (floor(scale × pollen^exponent) characters, config.json's pollenGrain, of the answering flower version's minified code, from a random start, wrapping), that version, and its code's length in characters (null elsewhere, and when the pollen was 0) |

## stream/actions.jsonl: the public stream

Every action as anyone may see it, oldest first; a line is complete once it ends in a newline. A turn makes two
actions: its \`arrive\` (written at once) and its end, \`feed\` or \`leave\`.

| field | what |
|---|---|
| seq, atMs, round | order, game time in ms, round |
| turn | the bee's turn number: (bee, turn) identifies a turn |
| bee, flower | team ids: whose bee, whose species |
| action | arrive, feed or leave |
| c, r | on feed and leave: the challenge and the response (null if the flower failed, or if it is over 4 KB) |
| rBytes, rHash, rPreview | the response's size in bytes of JSON; for one over 4 KB, its SHA-256 and its first ${STREAM_PREVIEW} characters (the whole of it: \`python3 tools/stream.py response <seq>\`) |
| percent, energy, nectar, pollen | on a feed: the share offered, the excess energy, the nectar and the pollen the flower gave (on a leave only pollen, 0) |

## stream/mine.jsonl: your own team's actions

The actions of your bee and at your species as your team sees them (same \`seq\`), with your private fields: at your
flower \`percent\` and \`energy\` (also on turns without a feed), \`ms\`, \`budgetMs\` (the call's R), \`flowerError\`, \`flowerVersion\`; for your bee
\`beeMs\` (decision time), \`beeError\`, \`beeVersion\` and \`log\` (what it printed), and on your bee's feeds its pollen
grain (\`grain\`, \`grainVersion\`, \`grainCodeLength\`). A field you may not see is simply missing. Once the game is over everything is public.

\`stream/teams.json\`: \`{"teams": {id: name}, "me": your team id, "participants": [ids in index order], "names": [names in
index order], "myIndex": your index}\` (indices are fixed when the game starts).

Querying them: \`python3 tools/query.py summary\`, \`python3 tools/query.py --local 'turns.my_flower().count()'\`,
\`python3 tools/stream.py tail -n 20\`, \`python3 tools/grains.py\`; from a script, \`garden.local.turns...\`,
\`garden.follow()\`, \`garden.grains()\` and \`garden.assemble(flower)\`.
`;

/** The generated Python history client (docs/QUERY.md), installed as tools/history.py. */
export const HISTORY_CLIENT = path.join(ARENA_DIR, "..", "vendor", "query", "history.py");

/** The runner's own copy of a workspace tool, by file name (tools/*.py, and history.py from vendor/query/). */
export const toolSource = (name) => (name === "history.py" ? HISTORY_CLIENT : path.join(TOOLS_SRC, name));

/** Install the workspace tools (always the runner's own copy: a team's edits to them don't persist), with the history
 * client that garden.py and query.py use. */
export function installTools(dir) {
  const dest = path.join(dir, "tools");
  fs.mkdirSync(dest, { recursive: true }); // the team's own files in tools/ stay; ours are put back as they were
  for (const f of fs.readdirSync(TOOLS_SRC)) if (f.endsWith(".py")) fs.copyFileSync(path.join(TOOLS_SRC, f), path.join(dest, f));
  if (fs.existsSync(HISTORY_CLIENT)) fs.copyFileSync(HISTORY_CLIENT, path.join(dest, "history.py"));
}

/** The version of each program playing now (the latest), from the team's own view. */
export function liveCode(view, teamId) {
  const t = view.teams.find((x) => x.id === teamId);
  return Object.fromEntries(KINDS.map((k) => [k, t?.programs?.[k]?.length ? t.programs[k][t.programs[k].length - 1] : null]));
}

/**
 * Write everything a team may see at the start of a session. view: the team's own view of the game (its token).
 * stream: the game's GameStream (links stream/actions.jsonl, tracks stream/mine.jsonl). Returns { dir, ext, drafts }.
 */
export async function prepareWorkspace({ arena, gameRow, persona, view, stream, apiBase, statusText = null, carry = null, tok = null }) {
  const dir = wsDir(arena.id, persona.slug);
  const config = view.game.config;
  const ext = extOf(config);
  const me = view.me.teamId;
  fs.mkdirSync(dir, { recursive: true });

  // A new game: archive this game's per-game folders from the last one.
  const marker = path.join(dir, ".game");
  const cur = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null;
  const newGame = cur !== String(gameRow.generation);
  if (cur && newGame) {
    const dest = path.join(dir, "previous-games", `game-${cur}`, "own");
    for (const sub of ["history", "drafts"]) {
      const from = path.join(dir, sub);
      if (fs.existsSync(from)) { fs.mkdirSync(dest, { recursive: true }); fs.rmSync(path.join(dest, sub), { recursive: true, force: true }); fs.renameSync(from, path.join(dest, sub)); }
    }
    fs.rmSync(path.join(dir, "stream"), { recursive: true, force: true });
    fs.rmSync(path.join(dir, "cache"), { recursive: true, force: true });
  }
  write(marker, String(gameRow.generation));

  write(path.join(dir, "RULES.md"), rules());
  const examples = arena.settings.examples ? fs.readdirSync(path.resolve(ARENA_DIR, "..", arena.settings.examples)) : null;
  const common = commonFiles(arena, persona);
  write(path.join(dir, "README.md"), forCap(readme({ ext, apiBase, examples, common: common?.files, commonScope: common?.scope }), view.game.config));
  // Common knowledge (a primed cohort): restored at every game, so every team, new ones included, has the same copy.
  fs.rmSync(path.join(dir, "common"), { recursive: true, force: true });
  // (several folders merge in order; Python's caches and dot files stay behind)
  for (const d of common?.dirs ?? (common ? [common.dir] : [])) {
    fs.cpSync(d, path.join(dir, "common"), { recursive: true, filter: (src) => src === d || !/(^|\/)(__pycache__|\.[^/]*)$/.test(path.relative(d, src)) });
  }
  if (examples) {
    fs.rmSync(path.join(dir, "examples"), { recursive: true, force: true });
    fs.cpSync(path.resolve(ARENA_DIR, "..", arena.settings.examples), path.join(dir, "examples"), { recursive: true });
  }
  installTools(dir);
  const it = view.interface;
  write(path.join(dir, "interface.txt"), `challenge: ${it.types.challenge} (${it.types.challengeMeans})\nresponse: ${it.types.response} (${it.types.responseMeans})\n` +
    `rules: ${(it.types.rules || []).join(" ")}\n\nflower:\n${it.flower}\n\nbee:\n${it.bee}\n`);
  const order = view.participants || view.teams.map((t) => t.id);
  const teams = order.map((id) => view.teams.find((t) => t.id === id)).filter(Boolean);
  write(path.join(dir, "config.json"), json({ ...config, game: gameRow.generation, your_team: view.myTeam?.name, your_index: order.indexOf(me) >= 0 ? order.indexOf(me) : null,
    teams: teams.map((t) => t.name), flowers: teams.length, file_extension: ext, size_unit: "nodes", public_api: apiBase, sample_challenges: sampleFor(config) }));
  write(path.join(dir, "notebook.md"), (await one("SELECT notebook FROM arena.personas WHERE id = $1", [persona.id]))?.notebook || "");

  // Programs: in play, exactly the versions playing now; a new game starts from the team's final programs of the
  // last one (`carry`); otherwise in the lobby the team's working files stay. Edits that were never submitted move
  // to drafts/.
  const live = liveCode(view, me);
  const drafts = [];
  const lobby = view.game.status === "lobby";
  for (const k of KINDS) {
    const file = path.join(dir, `${k}.${ext}`);
    const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const want = !lobby ? live[k]?.code ?? "" : newGame ? carry?.[k] ?? live[k]?.code ?? "" : have ?? live[k]?.code ?? "";
    if (have !== null && have.trim() && have !== want) { write(path.join(dir, "drafts", `${k}.${ext}`), have); drafts.push(k); }
    write(file, want);
  }
  for (const f of fs.readdirSync(dir)) if (/\.minified\.(py|ts)$/.test(f)) fs.rmSync(path.join(dir, f));
  writeHistory(dir, ext, view, me);
  if (statusText) write(path.join(dir, "status.txt"), statusText);

  // The streams: the shared public copy (hard link); the team's own history and actions (its token, kept by the runner).
  const sdir = path.join(dir, "stream");
  if (stream) {
    stream.linkInto(path.join(sdir, "actions.jsonl"));
    stream.track(me, sdir, tok);
  }
  const name = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const participants = view.participants || stream?.participants || null; // in the lobby: none yet (the stream adds them)
  write(path.join(sdir, "teams.json"), json({ teams: name, me, participants,
    names: participants ? participants.map((id) => name[id]) : null, myIndex: participants ? participants.indexOf(me) : null }));
  if (stream?.tracked?.get(me)) stream.tracked.get(me).indexed = participants || null;
  write(path.join(sdir, "SCHEMA.md"), forCap(SCHEMA, view.game.config));

  await writePreviousGames(arena, dir, gameRow.generation, persona.id);
  return { dir, ext, drafts };
}

/** history/: the team's own versions in this game (code and a timeline). Other teams' changes are secret during play. */
function writeHistory(dir, ext, view, me) {
  const t = view.teams.find((x) => x.id === me);
  const rows = [];
  for (const k of KINDS) for (const v of t?.programs?.[k] || []) {
    if (v.code != null) write(path.join(dir, "history", k, `v${v.version}.${ext}`), v.code);
    rows.push({ kind: k, ...v });
  }
  rows.sort((a, b) => a.atMs - b.atMs || a.kind.localeCompare(b.kind) || a.version - b.version);
  write(path.join(dir, "history", "versions.md"), `# Your team's program versions in this game\n\n` +
    `Game time 0:00 = written in the lobby. Cost = change budget spent (node edits from the version before).\n\n` +
    `| game time | program | version | size | change cost | submitted by | first problem |\n|---|---|---|---|---|---|---|\n` +
    rows.map((v) => `| ${v.atMs ? mmss(v.atMs) : "lobby"} | ${v.kind} | v${v.version} | ${v.size} | ${v.cost} | ${v.submittedBy || "-"} | ${v.problem ? v.problem.replace(/\|/g, "/").slice(0, 120) : "-"} |`).join("\n") + "\n");
}

function sampleFor(config) {
  const t = config.challengeType;
  if (t === "int") return [0, 1, 7, 37, 42, 1000, 123457];
  if (t === "str") return ["", "a", "hello", "bee?"];
  if (t.startsWith("list")) return [[], [1], [1, 2, 3]];
  return [0];
}

/** previous-games/game-N/: earlier finished games of this arena, fully revealed (written once per game). */
async function writePreviousGames(arena, dir, generation, personaId) {
  const games = await all("SELECT * FROM arena.games WHERE arena_id = $1 AND generation < $2 AND stage IN ('played','interviewed','judged','done') ORDER BY generation", [arena.id, generation]);
  for (const g of games) {
    const gdir = path.join(dir, "previous-games", `game-${g.generation}`);
    if (!fs.existsSync(path.join(gdir, "standings.md")) && g.game_short_id) await writeGameRecord(gdir, g, arena);
    const panel = path.join(gdir, "panel.md");
    if (!fs.existsSync(panel) && ["judged", "done"].includes(g.stage)) await writePanel(panel, g, personaId);
  }
}

/** A finished game's record, from the game's API (everything is revealed once it is over): every team's final code,
 * the standings with the three score shares, everyone's change timeline. */
export async function writeGameRecord(gdir, g, arena, api = Api) {
  let view;
  try { view = await api.view(null, gamePath(arena.room_short_id, g.game_short_id)); } catch { return; }
  if (!view?.game || view.game.status !== "finished") return;
  const config = view.game.config;
  const ext = extOf(config);
  const name = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const progs = [];
  for (const t of view.teams) {
    for (const k of KINDS) {
      const vs = t.programs?.[k] || [];
      vs.forEach((v, i) => {
        progs.push({ team_id: t.id, kind: k, ...v });
        if (i === vs.length - 1 && v.code != null) write(path.join(gdir, "final-code", safeName(t.name), `${k}.${ext}`), v.code);
      });
    }
    // Every bee's MEMORY is revealed once the game is over.
    if (t.memory) write(path.join(gdir, "final-code", safeName(t.name), "bee-memory.json"), JSON.stringify(t.memory, null, 1));
  }
  progs.sort((a, b) => (a.atMs || 0) - (b.atMs || 0) || String(name[a.team_id]).localeCompare(String(name[b.team_id])) || a.kind.localeCompare(b.kind) || a.version - b.version);
  const scores = Object.fromEntries((view.scores || []).map((x) => [x.teamId, x]));
  const ents = await all("SELECT team_id, team_name, fitness, fitness_rank, sat_out FROM arena.entries WHERE game_id = $1 ORDER BY fitness_rank NULLS LAST", [g.id]);
  const f2 = (x) => (x == null ? "-" : Number(x).toFixed(2));
  write(path.join(gdir, "standings.md"), `# Game ${g.generation}: ${config.minutes} minutes, ${Number(view.game.round || 0)} rounds, ${Number(view.game.lastSeq || 0)} actions\n\n` +
    `| rank | team | fitness | pollination (share) | forage (share) | pollen given | feeds received / given |\n|---|---|---|---|---|---|---|\n` +
    ents.map((e) => { const x = scores[e.team_id] || {}; return `| ${e.fitness_rank ?? "-"} | ${e.team_name} | ${e.sat_out ? "sat out" : f2(e.fitness ?? x.fitness)} | ` +
      `${f2(x.pollination)} (${f2(x.pollinationShare)}) | ${f2(x.forage)} (${f2(x.forageShare)}) | ${f2(x.pollen)} | ${x.feedsReceived ?? "-"} / ${x.feedsGiven ?? "-"} |`; }).join("\n") +
    `\n\n${config.revealOnFinish ? "Every team's final code is in final-code/, with each bee's final MEMORY." : "Code stays secret in this game; each bee's final MEMORY is in final-code/."} changes.md lists every team's program versions.\n`);
  write(path.join(gdir, "changes.md"), `# Every program version in game ${g.generation}\n\n| game time | team | program | version | size | change cost | first problem |\n|---|---|---|---|---|---|---|\n` +
    progs.map((p) => `| ${Number(p.atMs) ? mmss(Number(p.atMs)) : "lobby"} | ${name[p.team_id]} | ${p.kind} | v${p.version} | ${p.size} | ${p.cost} | ${p.problem ? String(p.problem).replace(/\|/g, "/").slice(0, 100) : "-"} |`).join("\n") + "\n");
}

async function writePanel(file, g, personaId) {
  const ent = await all("SELECT team_name, fitness, fitness_rank, social, social_rank, sat_out FROM arena.entries WHERE game_id = $1 ORDER BY fitness_rank NULLS LAST", [g.id]);
  const evs = await all("SELECT j.name, j.age, e.* FROM arena.evaluations e JOIN arena.judges j ON j.id = e.judge_id WHERE e.game_id = $1 AND e.persona_id = $2", [g.id, personaId]);
  write(file, `# Game ${g.generation}: standings and the interview panel\n\n| team | fitness (rank) | panel score 0-10 (rank) |\n|---|---|---|\n` +
    ent.map((e) => `| ${e.team_name} | ${e.sat_out ? "sat out" : `${e.fitness?.toFixed(2)} (#${e.fitness_rank})`} | ${e.social != null ? `${e.social.toFixed(1)} (#${e.social_rank})` : "-"} |`).join("\n") +
    `\n\n## What the panel said about YOUR team\n` + (evs.length ? evs.map((e) => `- ${e.name} (${e.age}): understanding ${e.understanding}, respect ${e.respect}, novelty ${e.novelty}, team-up ${e.team_up}. "${e.comment}"`).join("\n") : "(you weren't judged in this game)") + "\n");
}

/** Read the program files and notebook back after a session. */
export function collect(dir, ext) {
  const out = {};
  for (const k of KINDS) { const f = path.join(dir, `${k}.${ext}`); out[k] = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; }
  const nb = path.join(dir, "notebook.md");
  out.notes = fs.existsSync(nb) ? fs.readFileSync(nb, "utf8").slice(0, 6000) : null;
  return out;
}

export function writeMinified(dir, ext, kind, code) {
  write(path.join(dir, `${kind}.minified.${ext}`), code);
}

/** The team's own Claude Code tool-output spill directory (big tool results are saved there during a session). */
export const spillDir = (dir) => path.join(process.env.HOME || "/root", ".claude", "projects", dir.replace(/[^A-Za-z0-9]/g, "-"));
/** Where Claude Code writes the output of the session's background tasks (the Bash tool's run_in_background). */
export const taskDir = (dir) => path.join("/tmp", `claude-${process.getuid?.() ?? 0}`, dir.replace(/[^A-Za-z0-9]/g, "-"));

/** Bytes on disk under a directory, counting hard-linked files once (seen: a shared Set of inodes). */
export function diskBytes(root, seen = new Set()) {
  let bytes = 0;
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { const st = fs.statSync(p); if (!seen.has(st.ino)) { seen.add(st.ino); bytes += st.size; } }
    }
  };
  walk(root);
  return bytes;
}

// ---------------------------------------------------------------- what a session leaves running

/** Processes a session started: they carry its ARENA_SESSION tag in their environment, or run inside the workspace.
 * `spare`: pids that aren't the session's (the team's scaffold, which outlives sessions). */
export function sessionProcesses(tag, dir, spare = new Set()) {
  const out = [];
  let pids = [];
  try { pids = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)); } catch { return out; }
  for (const p of pids) {
    const pid = Number(p);
    if (pid === process.pid || pid === process.ppid || spare.has(pid)) continue;
    let env = "", cwd = "";
    try { env = fs.readFileSync(`/proc/${p}/environ`, "latin1"); } catch {}
    try { cwd = fs.readlinkSync(`/proc/${p}/cwd`); } catch {}
    if ((tag && env.split("\0").includes(`ARENA_SESSION=${tag}`)) || (dir && (cwd === dir || cwd.startsWith(dir + "/")))) out.push(pid);
  }
  return out;
}

/** Stop everything a session left running (background scripts): SIGTERM, then SIGKILL. Returns the pids.
 * spare(): the pids to leave alone (the team's scaffold), asked again before the SIGKILL. */
export async function killLeftovers(tag, dir, spare = () => new Set()) {
  const pids = sessionProcesses(tag, dir, spare());
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
  if (pids.length) {
    await new Promise((r) => setTimeout(r, 1500));
    for (const pid of sessionProcesses(tag, dir, spare())) { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
  return pids;
}

/** A process and everything below it (from /proc's parent links). */
export function processTree(root) {
  const out = new Set();
  if (!root) return out;
  const kids = new Map();
  let pids = [];
  try { pids = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)); } catch { return out; }
  for (const p of pids) {
    try { const ppid = Number(fs.readFileSync(`/proc/${p}/stat`, "utf8").replace(/^.*\)\s+\S+\s+/, "").split(" ")[0]); (kids.get(ppid) || kids.set(ppid, []).get(ppid)).push(Number(p)); } catch {}
  }
  const walk = (p) => { if (out.has(p)) return; out.add(p); for (const k of kids.get(p) || []) walk(k); };
  walk(root);
  return out;
}

// ---------------------------------------------------------------- audit

const SENSITIVE = /(^|[\s'"=(:])(\/home|\/root|\/srv|\/var|\/etc|\/proc|\/opt|\/sys|\/run|\/mnt|\/media)(\/|\b)/;
// Network: raw tools in command position, and network libraries in inline scripts or written code. Reading the game's
// public API on localhost (GET) is allowed; see networkFinding.
const NETWORK = /\bwebsocket|wss?:\/\/|(?:^|[;&|(`\n]\s*|\bxargs\s+)(?:curl|wget|nc|ncat|telnet|ssh|scp)\s+(?![=+\-*\/%<>!&|^]=?\s|=)\S|\bcurl\s+(?:-|https?:)|\b(?:import|from)\s+(?:requests|socket|urllib|http\.client|aiohttp|httpx)\b|urllib|http\.client|\burlopen\b|\bsocket\.socket\b|\brequests\.(?:get|post|put|delete|head|Session)\b|\bfetch\(\s*["'`]https?:/;
const RAW_NET = /(?:^|[;&|(`\n]\s*)(?:nc|ncat|telnet|ssh|scp)\s+(?![=+\-*\/%<>!&|^]=?\s|=)\S|\bsocket\.(?:socket|create_connection)\b|\bimport\s+socket\b|\bfrom\s+socket\s+import\b/;
const WRITE_HTTP = /\s-X\s*['"]?(?:POST|PUT|PATCH|DELETE)\b|--request\s+['"]?(?:POST|PUT|PATCH|DELETE)\b|\s--data(?:-\w+)?[\s=]|\s-d\s|\s-F\s|--form\b|--upload-file|\s-T\s|method\s*=\s*["'](?:POST|PUT|PATCH|DELETE)["']|\brequests\.(?:post|put|patch|delete)\b|\.request\(\s*["'](?:POST|PUT|PATCH|DELETE)["']|\burlopen\([^)]*\bdata\s*=|\bRequest\([^)]*\bdata\s*=/i;
const CREDENTIALS = /authorization|\bbearer\b|\bcookie|x-api-key|\.dev-secret|dev_login_secret|\bpassword\b/i;
const DB = /psql|\b5432\b|postgres|pg_|DATABASE_URL/i;
// A busy-wait or a deliberate CPU burn outside a team's own programs (a loop that does nothing until a clock says so, an
// empty `while True`, a huge empty range, a shell spin): it takes a core from the game's programs, whose time limits are
// wall clock. A warning, told to the session (lib/team.js) and logged; never a stop.
const CLOCK = String.raw`\btime\.(?:time|perf_counter|monotonic|process_time|thread_time)(?:_ns)?\(\)|\bdatetime\.(?:datetime\.)?now\(\)`;
const SPIN = new RegExp(String.raw`\bwhile\s+(?:True|1|not\s+\w+|[^:\n]*(?:${CLOCK})[^:\n]*)\s*:\s*(?:#[^\n]*)?(?:\n[ \t]*)?(?:pass|continue|\.\.\.)\s*(?:$|[\n;"'#])` +
  String.raw`|\bfor\s+\w+\s+in\s+(?:x?range)\(\s*(?:10\s*\*\*\s*(?:[89]|\d\d)|\d{9,})\s*\)\s*:\s*(?:\n[ \t]*)?pass\b` +
  String.raw`|\bwhile\s+(?:true|:)\s*;\s*do\s*(?::|true)?\s*;?\s*done|\byes\s*>\s*/dev/null`, "m");
export const SPIN_WARNING = /^busy-wait/;
const SPIN_DETAIL = "busy-wait (CPU burned outside your programs)";
const ENVDUMP = /(^|[;&|\s])(env|printenv|set)(\s*$|\s*[|;&>])|os\.environ|process\.env|\/proc\/self\/environ/;
const AUTH = /\/api\/auth|dev\/login|login.*secret|\/api\/me\b|\/api\/my\//i;
const URLS = /(?:https?|wss?):\/\/[^\s'"`<>()\]\\,]+/g;

const LOCAL_URL = /^(?:https?|wss?):\/\/(localhost|127\.0\.0\.1)(?::(\d+))?(\/.*)?$/i;

/** Is this URL the game's public API on localhost (any path under /api/rooms/, the query schema, or the bare base)? */
export function allowedUrl(u, port = "4100") {
  const m = String(u).match(LOCAL_URL);
  if (!m || (m[2] || "80") !== String(port)) return false;
  const p = m[3] || "/";
  return p === "/" || /^\/api\/?$/.test(p) || /^\/api\/rooms(\/|\?|$)/.test(p) || /^\/api\/query\/schema\/?$/.test(p);
}

/** Is this URL a history query endpoint of the game server (docs/QUERY.md: POST …/games/:g/query or /rooms/:room/query)? */
export function queryUrl(u, port = "4100") {
  const m = String(u).match(LOCAL_URL);
  return !!m && (m[2] || "80") === String(port) && /^\/api\/rooms\/[^/?#]+(?:\/games\/[^/?#]+)?\/query\/?$/.test(m[3] || "");
}

/** A network use in a command or in written code: fine if it only reads the game's public API on localhost (GET), or
 * posts history queries to its query endpoints (without credentials: the public fields). */
export function networkFinding(text, port) {
  if (RAW_NET.test(text)) return { severity: "violation", detail: "raw network access (only GETs to the game's public API and its history queries are allowed)" };
  const urls = (text.match(URLS) || []).map((u) => u.replace(/[.;:]+$/, ""));
  const bad = urls.filter((u) => !allowedUrl(u, port));
  if (bad.length) return { severity: "violation", detail: `network access outside the game's public API: ${bad[0]}` };
  if (CREDENTIALS.test(text)) return { severity: "violation", detail: `credentials in a network request: ${text.match(CREDENTIALS)[0]}` };
  // A write request is allowed only to the query endpoints: every URL in it must be one (and there must be one).
  if (WRITE_HTTP.test(text) && (!urls.length || urls.some((u) => !queryUrl(u, port)))) {
    return { severity: "violation", detail: `a write request (only GETs to the public API and POSTs to its query endpoint are allowed; submit with tools/submit.py): ${text.match(WRITE_HTTP)[0].trim()}` };
  }
  if (!urls.length) return { severity: "warning", detail: "network code without a URL the audit can check" };
  return null;
}

// Writing to the shared stream: it is hard-linked into every workspace (the runner repairs it, but it's not allowed).
const STREAM_WRITE_SH = /(?:>>?|\btee\b(?:\s+-a)?)\s*['"]?(?:\.\/)?stream\/|\b(?:rm|truncate|shred)\b[^;&|\n]*\bstream\/(?:actions|mine|history)|\bsed\s+-i[^;&|\n]*\bstream\/|\b(?:cp|mv|ln)\b[^;&|\n]*\s['"]?(?:\.\/)?stream\/[^\s;&|]*\s*(?:$|[;&|\n])/;
const STREAM_WRITE_PY = /open\(\s*[^)\n]*stream\/(?:actions|mine|history)\.jsonl[^)\n]*,\s*['"][^'"]*[wax+]|(?:os\.remove|os\.unlink|shutil\.\w+)\([^)\n]*stream\//;

/** Drop the bodies of heredocs that only write data to a file (`cat > f <<'E' … E`, `tee`): notebook prose like
 * "1.1e11 .. 8.9e11" isn't a path. Heredocs fed to an interpreter (`python3 - <<'E'`) keep their bodies. The written
 * text is still checked like Write content (database, outside paths, other workspaces, network, environment). */
export function stripDataHeredocs(cmd) {
  return cmd.replace(/(\b(?:cat|tee)\b[^\n]*?<<-?[ \t]*(['"]?)(\w+)\2[^\n]*\n)[\s\S]*?\n(\t*\3[ \t]*)(?=\n|$)/g, "$1$4");
}

/** A sed or perl substitution's quoted expression (`sed -E 's/"edges".*"labels"/../'`) is a pattern and its replacement,
 * not a path: blank it. Only the script argument of sed/perl (the first argument after the options, or the one after
 * -e), so `ls 's/../../'` and file arguments (`sed 's/a/b/' ../x`) still count. */
const SUBST = /^(['"])[sy]([^\w\s\\'"])(?:\\.|(?!\2)[^\\])*\2(?:\\.|(?!\2)[^\\])*\2[a-zA-Z0-9]*\1$/;
function stripSubstitutions(cmd) {
  return cmd.replace(/\b(?:sed|perl)\b[^;&|\n]*/g, (seg) => {
    let script = true; // the next argument is the script (until the first non-option argument)
    return seg.replace(/(\s+)('[^']*'|"(?:\\.|[^"\\])*"|[^\s'"]+)/g, (m, sp, tok) => {
      if (/^-(?:[a-zA-Z]*e|-expression)$/.test(tok)) { script = true; return m; }
      if (tok.startsWith("-")) return m;
      const blank = script && SUBST.test(tok) && tok[0] === tok[tok.length - 1];
      script = false;
      return blank ? `${sp}''` : m;
    });
  });
}

/** Split a shell command into its shell text and the programs it feeds to interpreters: heredocs into python3/node
 * (\`python3 - <<'E' … E\`) and -c/-e programs. The shell text keeps the heredoc markers; the programs are returned
 * separately. */
export function splitPrograms(cmd) {
  const programs = [];
  let shell = cmd.replace(/(\b(?:python3?|node)\b[^\n]*?<<-?[ \t]*(['"]?)(\w+)\2[^\n]*\n)([\s\S]*?)\n(\t*\3[ \t]*)(?=\n|$)/g,
    (m, head, q, tag, body, end) => { programs.push(body); return `${head}${end}`; });
  shell = shell.replace(/(\b(?:python3?|node)\b[^\n;&|]*?\s-[a-zA-Z]*[ce]\s+)('[^']*'|"(?:\\.|[^"\\])*")/g,
    (m, head, prog) => { programs.push(prog.slice(1, -1).replace(/\\(["\\$`])/g, "$1")); return `${head}''`; });
  return { shell, programs };
}

/** A shell comment (\`# …\` at the start of a word, outside quotes) to the end of its line. */
function stripShellComments(sh) {
  return sh.split("\n").map((line) => {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === q) q = null; else if (ch === "\\" && q === '"') i++; continue; }
      if (ch === "'" || ch === '"') q = ch;
      else if (ch === "\\") i++;
      else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }).join("\n");
}

/** The string literals of a Python (or JavaScript) program, with what comes just before each; comments are skipped,
 * so prose in them never counts. */
export function programStrings(code) {
  const out = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "#") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch !== "`" && code.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      let j = i + q.length, s = "";
      while (j < code.length && !code.startsWith(q, j)) {
        if (code[j] === "\\") { s += code[j + 1] ?? ""; j += 2; continue; }
        if (q.length === 1 && q !== "`" && code[j] === "\n") break;
        s += code[j]; j++;
      }
      out.push({ s, before: code.slice(0, i).replace(/[rbfuRBFU]+$/, "").trimEnd().slice(-1) });
      i = j + q.length;
      continue;
    }
    i++;
  }
  return out;
}

const hasParent = (p) => /(^|[\/\\])\.\.([\/\\]|$)/.test(p);

/** Does a ".." path in a shell command resolve outside the workspace? Paths are tried against the workspace and every
 * directory the command cd's into (all of which must themselves stay inside).
 * - Shell text: a \`..\` path component (\`../\`, \`/..\`, or a bare \`..\` word), outside comments, sed/perl scripts and
 *   echo/printf.
 * - Programs fed to python3/node (heredocs, -c): string literals with a \`..\` component (\`"../x"\`, \`"a/.."\`, \`".."\`
 *   passed to a call, as in \`os.chdir("..")\` or \`Path("..")\`). Comments, prose and \`...\` never count; a lone \`'..'\`
 *   that isn't an argument (\`else '..'\`) is a placeholder. */
export function escapesWorkspace(cmd, dir, start = dir) {
  return workspaceEscapes(cmd, dir, start).length > 0;
}

/** Where a command's way out of the workspace leads: for each \`cd\` target outside it and each ".." path that resolves
 * outside it (see escapesWorkspace), the absolute paths it may resolve to (one per directory the command may be in). */
export function workspaceEscapes(cmd, dir, start = dir) {
  const { shell: sh0, programs } = splitPrograms(stripDataHeredocs(cmd));
  const sh = stripSubstitutions(stripShellComments(sh0));
  const bases = [start];
  const out = [];
  for (const m of sh.matchAll(/(?:^|[;&|]\s*|\s)cd\s+([^\s;&|]+)/g)) {
    const target = path.resolve(bases[bases.length - 1], m[1].replace(/^['"]|['"]$/g, ""));
    if (!within(target, dir)) out.push([target]);
    bases.push(target);
  }
  const resolved = (p) => bases.map((b) => path.resolve(b, p));
  const outside = (p) => !resolved(p).some((r) => within(r, dir));
  for (const m of sh.matchAll(/[^\s'"`;|&<>()=]*\.\.[^\s'"`;|&<>()]*/g)) {
    const tok = m[0];
    if (!/(^|\/)\.\.(\/|$)/.test(tok)) continue; // "..." or "a..b" aren't parent paths
    if (/^https?:/.test(tok)) continue;
    const segment = sh.slice(0, m.index).split(/[;&|\n]/).pop().trim();
    if (/^(echo|printf)\b/.test(segment)) continue; // `echo ..` prints a separator; it touches no file
    if (outside(tok)) out.push(resolved(tok));
  }
  for (const code of programs) {
    for (const { s, before } of programStrings(code)) {
      const t = s.trim();
      if (!hasParent(t)) continue;
      if (t === ".." && before !== "(" && before !== ",") continue; // a placeholder ('..'), not an argument
      if (/^https?:/.test(t) || /\s/.test(t)) continue; // URLs and prose ("ring .. recipe") aren't paths
      if (outside(t)) out.push(resolved(t));
    }
  }
  return out;
}

const within = (p, d) => p === d || p.startsWith(d + "/");
const GLOB_CHARS = /[*?[\]{}]/;
const SCOPE_RANK = { own: 0, unknown: 1, other: 2 };
const worstScope = (scopes) => scopes.reduce((a, b) => (SCOPE_RANK[b] > SCOPE_RANK[a] ? b : a), "own");

/** Where a path points, for fair play (workspaces are <root>/<arena>/<slug>):
 *   "own"      this team's workspace, or one of \`own\` (its spill and background-task folders)
 *   "unknown"  inside this arena's folder, under a name that is nothing there: no team's folder, not the runner's files
 *              (a mistyped path, like <arena>/tools for the team's own tools/). A warning, never a stop.
 *   "other"    another team's workspace, the runner's files (.runner, .shared), the arena's folder itself, a glob over
 *              it, another arena, or anywhere else outside the workspace. A violation.
 * A relative path resolves against cwd; text that names arena-ws/<arena>/<folder> without an absolute root is judged by
 * that tail. */
export function pathScope(p, dir, { cwd = dir, own = [] } = {}) {
  const s = String(p).trim().replace(/^['"]+|['"]+$/g, "");
  const root = path.dirname(dir);
  let abs;
  if (!s.startsWith("/") && s.includes("arena-ws/")) {
    if (path.basename(path.dirname(root)) !== "arena-ws") return "other";
    abs = path.resolve(path.dirname(root), s.slice(s.indexOf("arena-ws/") + "arena-ws/".length));
  } else abs = path.resolve(cwd, s);
  if (within(abs, dir) || own.some((d) => d && within(abs, d))) return "own";
  if (!abs.startsWith(root + "/")) return "other";
  const seg = abs.slice(root.length + 1).split("/")[0];
  return GLOB_CHARS.test(seg) || fs.existsSync(path.join(root, seg)) ? "other" : "unknown";
}

// The paths in a command or in code that the audit judges: absolute paths under the system roots, and anything naming
// arena-ws/.
const ABS_PATHS = /(?<=^|[\s'"=(:,])\/(?:home|root|srv|var|etc|proc|opt|sys|run|mnt|media)(?:\/[^\s'"`;|&<>(),]*)?/g;
const WS_PATHS = /[^\s'"`;|&<>(),]*arena-ws\/[^\s'"`;|&<>(),]*/g;
/** "warning" when every path of `re` in the text points to nothing in this arena's folder (and at least one does), else
 * "violation" (whatever the audit's pattern matched stays a violation unless its paths are shown to be harmless). */
function pathSeverity(text, re, dir, opts) {
  const paths = [...String(text).matchAll(re)].map((m) => m[0]);
  const scope = worstScope(paths.map((x) => pathScope(x, dir, opts)));
  return paths.length && scope === "unknown" ? "warning" : "violation";
}
const NO_FOLDER = "a path in the arena's folder that is no team's folder (a mistyped path?)";

/** The shell's working directory after a command (Claude Code's Bash tool keeps it between calls). */
export function cwdAfter(cmd, dir, start = dir) {
  let cwd = start;
  for (const m of stripDataHeredocs(cmd).matchAll(/(?:^|[;&|]\s*|\s)cd\s+([^\s;&|]+)/g)) cwd = path.resolve(cwd, m[1].replace(/^['"]|['"]$/g, ""));
  return within(cwd, dir) ? cwd : dir;
}

// How the Claude Code CLI reports a Bash command it refused to run.
const REFUSED = /requires? (explicit )?approval|permission to use|was blocked|not allowed|denied|obfuscation|Brace expansion|can hide arguments|contains multiple operations/i;

/** Checks on code a team wrote (a Write/Edit in a session, or a scaffold before it starts): database, logins, paths
 * outside the workspace, other workspaces, network beyond reading the public API, writes into stream/, environment.
 * otherWs: a RegExp matching other teams' workspaces (or the arena id and slug to build it). */
export function codeFindings(code, dir, otherWs, port = "4100", { spin = true } = {}) {
  const out = [];
  const add = (severity, detail) => out.push({ severity, detail });
  const text = String(code || "").replaceAll(dir, "WS");
  if (!text) return out;
  if (DB.test(text)) add("violation", `database access in written code: ${text.match(DB)[0]}`);
  if (AUTH.test(text)) add("violation", `auth endpoint in written code: ${text.match(AUTH)[0]}`);
  // Paths: another team's workspace, the runner's files or outside the arena is a violation; a path that names nothing in
  // the arena's folder (a mistyped path) only a warning.
  if (SENSITIVE.test(text)) { const sv = pathSeverity(code, ABS_PATHS, dir); add(sv, `${sv === "warning" ? NO_FOLDER : "path outside workspace"} in written code: ${text.match(SENSITIVE)[0]}`); }
  if (otherWs.test(text)) { const sv = pathSeverity(code, WS_PATHS, dir); add(sv, sv === "warning" ? `${NO_FOLDER} in written code` : `other workspace in written code`); }
  if (NETWORK.test(text) || /\bsocket\b|\bcurl\b|\bwget\b|aiohttp|httpx/.test(text)) { const f = networkFinding(text, port); if (f) add(f.severity, `${f.detail} (in written code)`); }
  if (STREAM_WRITE_PY.test(text)) add("violation", `writing to the shared stream files in written code`);
  if (/os\.environ|getenv\(|\/proc\/self/.test(text)) add("violation", `environment access in written code`);
  if (/(^|[\s'"])\/tmp\b/.test(text)) add("warning", `uses /tmp in written code`);
  if (spin && SPIN.test(text)) add("warning", `${SPIN_DETAIL} in written code`);
  return out;
}

/** Another team's workspace: arena-ws/<anything other than this arena/slug, as a whole path segment>. */
export function otherWorkspaces(arenaId, slug) {
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`arena-ws/(?!${esc(arenaId)}/${esc(slug)}(?![\\w.-]))`);
}

/** Scan a stream-json transcript (a file, or its lines) for fair-play violations. Returns [{severity, tool, detail}].
 * opts.port: the game API's port (reading its public API on localhost is allowed). */
export function audit(transcript, dir, arenaId, slug, opts = {}) {
  let lines = transcript;
  if (!Array.isArray(lines)) { try { lines = fs.readFileSync(transcript, "utf8").split("\n").filter(Boolean); } catch { return []; } }
  const port = String(opts.port || "4100");
  const found = [];
  const add = (severity, tool, detail) => found.push({ severity, tool, detail: String(detail).slice(0, 400) });
  const otherWs = otherWorkspaces(arenaId, slug);
  // Claude Code spills oversized tool output to ~/.claude/projects/<escaped cwd>/<session>/tool-results/ and tells the
  // agent the path: reading THAT (its own session's spill) is fine; another team's spill directory is not.
  // The same goes for the output files of its own background tasks (Claude Code's run_in_background).
  const spill = spillDir(dir), tasks = taskDir(dir);
  const ownSpill = (x) => String(x).replaceAll(spill + "/", "WS/").replaceAll(spill, "WS").replaceAll(tasks + "/", "WS/").replaceAll(tasks, "WS");
  let shellCwd = dir; // Claude Code's Bash tool keeps the working directory between calls
  // Commands the CLI refused to run (permission rules, its heredoc/brace heuristics) never changed the directory.
  const refused = new Set();
  const events = [];
  for (const line of lines) { try { events.push(JSON.parse(line)); } catch {} }
  for (const ev of events) {
    for (const b of ev.type === "user" && Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (b.type !== "tool_result" || !b.is_error) continue;
      const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      if (REFUSED.test(text)) refused.add(b.tool_use_id);
    }
  }
  for (const ev of events) {
    const content = ev.type === "assistant" ? ev.message?.content || [] : [];
    for (const c of content) {
      if (c.type !== "tool_use") continue;
      const input = c.input || {};
      if (c.name === "Bash") {
        const cmd = ownSpill(String(input.command || ""));
        if (DB.test(cmd)) add("violation", "Bash", `database access: ${cmd}`);
        if (AUTH.test(cmd)) add("violation", "Bash", `auth endpoint: ${cmd}`);
        if (ENVDUMP.test(cmd)) add("violation", "Bash", `environment dump: ${cmd}`);
        const real = cmd.replaceAll("WS/", dir + "/").replace(/(^|\s)WS(\s|;|$)/g, `$1${dir}$2`);
        // A path into another team's workspace, the runner's files or anywhere outside the arena is a violation; one
        // that names nothing in the arena's folder (a mistyped path) is only a warning.
        const scopeOpts = { cwd: shellCwd, own: [spill, tasks] };
        if (otherWs.test(cmd)) { const sv = pathSeverity(real, WS_PATHS, dir, scopeOpts); add(sv, "Bash", `${sv === "warning" ? NO_FOLDER : "other workspace"}: ${cmd}`); }
        const escapes = workspaceEscapes(real, dir, shellCwd);
        if (escapes.length) {
          const sv = worstScope(escapes.flat().map((x) => pathScope(x, dir, scopeOpts))) === "unknown" ? "warning" : "violation";
          add(sv, "Bash", `${sv === "warning" ? NO_FOLDER : "parent-directory path leaving the workspace"}: ${cmd}`);
        }
        if (!refused.has(c.id)) shellCwd = cwdAfter(real, dir, shellCwd);
        if (SENSITIVE.test(cmd.replaceAll(dir, "WS"))) { const sv = pathSeverity(real, ABS_PATHS, dir, scopeOpts); add(sv, "Bash", `${sv === "warning" ? NO_FOLDER : "path outside workspace"}: ${cmd}`); }
        if (NETWORK.test(cmd)) { const f = networkFinding(cmd, port); if (f) add(f.severity, "Bash", `${f.detail}: ${cmd}`); }
        if (STREAM_WRITE_SH.test(stripDataHeredocs(cmd).replaceAll(dir + "/", ""))) add("violation", "Bash", `writing to the shared stream files: ${cmd}`);
        if (/\/tmp\b/.test(cmd)) add("warning", "Bash", `uses /tmp: ${cmd}`);
        if (SPIN.test(stripDataHeredocs(cmd))) add("warning", "Bash", `${SPIN_DETAIL}: ${cmd}`);
      } else {
        // Written content (scripts, harnesses, programs): same checks as shell commands.
        const text = ownSpill(String(input.content ?? input.new_string ?? ""));
        // (a busy loop in the team's own programs is theirs to spend: their flower's work, timed against its R)
        const program = /(^|\/)(flower|bee)\.(py|ts)$|(^|\/)(drafts|history)\//.test(path.relative(dir, path.resolve(dir, String(input.file_path ?? input.notebook_path ?? ""))));
        for (const f of codeFindings(text, dir, otherWs, port, { spin: !program })) add(f.severity, c.name, f.detail);
        for (const key of ["file_path", "path", "notebook_path"]) {
          const p = input[key];
          if (!p) continue;
          const abs = path.resolve(dir, String(p));
          const sc = pathScope(abs, dir, { own: [spill, tasks] });
          if (sc !== "own") add(sc === "unknown" ? "warning" : "violation", c.name, `${sc === "unknown" ? NO_FOLDER : "path outside workspace"}: ${p}`);
          if ((c.name === "Write" || c.name === "Edit") && abs.startsWith(path.join(dir, "stream") + "/")) add("violation", c.name, `writing to the shared stream files: ${p}`);
        }
        const pat = String(input.pattern || "");
        if ((c.name === "Grep" || c.name === "Glob") && /\.\.|^\//.test(pat)) {
          const sc = pathScope(pat, dir, { own: [spill, tasks] });
          if (sc !== "own") add(sc === "unknown" ? "warning" : "violation", c.name, `${sc === "unknown" ? NO_FOLDER : "pattern outside workspace"}: ${pat}`);
        }
      }
    }
  }
  return found;
}

export async function recordViolations({ arena, gameRow, persona, sessionId, found }) {
  const { q } = await import("./db.js");
  for (const f of found) {
    await q("INSERT INTO arena.violations (arena_id, game_id, persona_id, session_id, severity, tool, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [arena.id, gameRow.id, persona.id, sessionId, f.severity, f.tool, f.detail]);
  }
}
