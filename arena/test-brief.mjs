#!/usr/bin/env node
// The prompts (no model calls, no server): the system prompt describes the continuous game, the tools and the fair-play
// rules; the lobby and in-game briefs carry headline numbers only (never actions or logs); interview and judge prompts.
//   node arena/test-brief.mjs
import fs from "node:fs";
import { gameBrief, interviewPrompt, judgePrompt, lobbyBrief, settingsText, toolSystem } from "./lib/prompts.js";

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 400)}`}`); if (!ok) failed++; };
const config = { language: "python", minutes: 0.5, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512,
  budgets: { cosmos: { size: 1100, perMinute: 220, cap: 220, ms: 150 }, orchid: { size: 2200, perMinute: 1540, cap: 1540, ms: 50 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 25 } } };
const persona = { persona_prompt: "You are Luna, 12.", team_name: "Moonpetal" };
const apiBase = "http://localhost:4000/api/rooms/R/games/G";

const sys = toolSystem(persona, config, "/home/user/arena-ws/a/luna", { apiBase, teams: 3 });
check("system: the tools", ["tools/submit.py", "tools/check.py", "tools/try.py", "tools/status.py", "tools/stream.py"].every((t) => sys.includes(t)));
check("system: submissions go live at once and cost change budget", /goes live at once/.test(sys) && /pays its change cost/.test(sys));
check("system: the live stream is a file read with code, and the public API", /stream\/actions\.jsonl/.test(sys) && /never\s+print it whole/.test(sys) && sys.includes(`${apiBase}/events`));
check("system: session scripts stop with the session; only the scaffold outlives sessions", /stopped\s+when that session ends; only the scaffold outlives sessions/.test(sys));
check("system: the scaffold: what it's for, how to start it, the garden API, its audit", /SCAFFOLD/.test(sys) && /tools\/scaffold\.py start scaffold\.py/.test(sys) && /lobby, before the game begins/.test(sys)
  && ["follow()", "status()", "measure(kind, code)", "submit(kind, code)", "wait_for_budget(kind, cost)", "live(kind)"].every((x) => sys.includes(x)) && /audited before every start and restart/.test(sys)
  && /main way to react/.test(sys));
check("system: the game is short", /30 seconds/.test(sys));
check("system: fair play allows reading the public API, nothing else", /except to read \(GET\) the game's public API/.test(sys) && /Do not write to stream\//.test(sys) && /not even \/tmp/.test(sys));
check("system: RULES.md in full (the continuous rules)", /## The garden never stops/.test(sys) && /## What everyone can see/.test(sys));
check("system: the round timing: 200 ms rounds, queued actions, answers at 150 ms, public limits, late bee replies",
  /exactly 200 ms of game time/.test(sys) && /about 150 rounds/.test(sys) && /QUEUED action runs/.test(sys) && /delivered exactly 150 ms later/.test(sys)
  && /cosmos 150 ms, orchid 50 ms, bee 25 ms/.test(sys) && /\["leave", c\]/.test(sys) && /isn't cut off/.test(sys) && /never silenced/.test(sys) && /tasted\(seen, nectar\) and then forage, in one call/.test(sys)
  && !/secret limit|hidden limit/i.test(sys));
check("system: everything is public to teams (which flower too), bees are in the dark; code, prints, changes, budgets, timings hidden",
  /which flower it\s+was \(cosmos or orchid\)/.test(sys) && /Bees, though, are in the dark/.test(sys) && /only through code you change/.test(sys)
  && /code, what bees print, code changes and change budgets, and how long any program took/.test(sys));
check("system: arrivals are public; versions are pinned per visit; SSE and the WebSocket", /public `arrive` action/.test(sys) && /Versions are pinned per visit/.test(sys) && /applies from the next visit/.test(sys) && /ws:\/\/localhost:4000\/api\/rooms\/R\/games\/G\/ws\?after=/.test(sys) && /from Python use the Server-Sent Events/.test(sys) && !/There is no WebSocket/.test(sys));
check("system: this game's settings with per-minute change budgets and caps", /\| cosmos \| 1,100 \| 220 \| 220 \| 150 \|/.test(sys) && /busy feeding for the next 10 rounds/.test(sys));
check("system: no round-based leftovers (MEMORY, turns_left, change turns)", !/MEMORY|turns_left|before each round|turn to change|change turn/.test(sys));
const devSecret = fs.existsSync(new URL("./runs/.dev-secret", import.meta.url)) ? fs.readFileSync(new URL("./runs/.dev-secret", import.meta.url), "utf8").trim() : "no-secret-file";
check("system: no secrets, tokens or database URLs", !sys.includes(devSecret) && !/postgres:|Bearer |DATABASE_URL|DEV_LOGIN|\.dev-secret/i.test(sys));
check("settings: what a program earns over the game", /cosmos 110, orchid 770, bee 1,100 nodes of change/.test(settingsText(config, 3)), settingsText(config, 3));

const fresh = lobbyBrief({ config, teamName: "Moonpetal", generation: 1, maxTurns: 30, carried: false });
check("lobby (first game): write all three from scratch, no starter code", /program files are empty/.test(fresh) && /no starter code/.test(fresh));
check("lobby: free, check/try, submit all three", /Writing is free in the lobby/.test(fresh) && /submit all three/.test(fresh));
check("lobby: the game won't wait; prepare what should react", /won't wait for you/.test(fresh) && /must be ready now/.test(fresh) && /220, orchid 1,540 and bee 2,200 nodes a minute/.test(fresh));
check("lobby: the scaffold can start now and runs through the game", /tools\/scaffold\.py start scaffold\.py/.test(fresh) && /keeps running through the whole game/.test(fresh));
const carried = lobbyBrief({ config: { ...config, minutes: 2 }, teamName: "Moonpetal", generation: 3, maxTurns: 30, carried: true });
check("lobby (later game): starts from last game's final programs; previous-games/", /final programs from game 2/.test(carried) && /previous-games\//.test(carried) && /2 minutes/.test(carried));
const ex = lobbyBrief({ config, teamName: "M", generation: 1, maxTurns: 30, carried: false, examples: ["paley_cosmos.py", "checkers.py"] });
check("lobby (examples arena): names the shared examples", /every team in this garden received the same example files/.test(ex) && /paley_cosmos\.py/.test(ex));
// A primed cohort: its common-knowledge files are named in every session's system prompt and in the lobby brief.
const primedSys = toolSystem(persona, config, "/home/user/arena-ws/a/luna", { apiBase, teams: 6, common: ["costly-signals.md"] });
const primedLobby = lobbyBrief({ config, teamName: "M", generation: 2, maxTurns: 30, carried: true, common: ["costly-signals.md"] });
check("common knowledge: named in the system prompt and the lobby brief of a primed cohort only",
  /Common knowledge: every team in this garden, including any team that joins in a later game, received exactly the same files in common\/ \(costly-signals\.md\)/.test(primedSys)
  && /Common knowledge: .*common\/ \(costly-signals\.md\)/.test(primedLobby) && !/Common knowledge|common\//.test(sys) && !/Common knowledge|common\//.test(fresh));
const fix = lobbyBrief({ config, teamName: "M", generation: 1, maxTurns: 10, carried: false, fix: "- bee: Syntax error" });
check("lobby fix: the errors, and submit", /bee: Syntax error/.test(fix) && /tools\/submit\.py/.test(fix) && /--json/.test(fix));

const budgets = { cosmos: { available: 44, perMinute: 220, cap: 220 }, orchid: { available: 308, perMinute: 1540, cap: 1540 }, bee: { available: 440, perMinute: 2200, cap: 2200 } };
const head = { actions: 1234, bee: { asks: 40, feeds: 8, nectar: 6, errors: 0 }, patch: { visits: 30, feeds: 7, bees: 2 } };
const gb = gameBrief({ config: { ...config, minutes: 2 }, teamName: "Moonpetal", generation: 2, sessionNo: 1, status: "running", clockMs: 12000, budgets,
  standing: { fitness: 1.05, rank: 2, of: 3 }, head, drafts: ["orchid"], maxTurns: 30, scripts: ["follow.py"] });
check("game brief: time played, team, session", /Game 2 is running: 0:12 of 2:00 played\. You are team "Moonpetal"\. Session 1\./.test(gb), gb);
check("game brief: headline numbers only", /fitness so far: 1\.05 \(#2 of 3/.test(gb) && /1,234 actions/.test(gb) && /cosmos 44 of 220 \(\+220\/min\)/.test(gb));
check("game brief: drafts and the workspace's python files", /drafts\/orchid\.py/.test(gb) && /follow\.py/.test(gb));
check("game brief: no scaffold yet: how to start one", /no scaffold running/.test(gb));
const gbs = gameBrief({ config, teamName: "M", generation: 1, sessionNo: 2, status: "running", clockMs: 5000, budgets, standing: null, head: null, maxTurns: 30,
  scaffold: { file: "scaffold.py", state: "running", restarts: 1 }, automatic: 4 });
check("game brief: the scaffold's state and its automatic changes", /Your scaffold scaffold\.py: running, 1 restart; it has submitted 4 changes by itself/.test(gbs), gbs);
check("game brief: submit any time; stopped when the game ends", /goes live at once/.test(gb) && /When the game ends this session is stopped/.test(gb));
check("game brief: short (no actions, no logs)", gb.length < 2000 && !/"seq"|"atMs"|\{"action"/.test(gb), gb.length);
const warm = gameBrief({ config, teamName: "M", generation: 1, sessionNo: 1, status: "lobby", clockMs: 0, budgets: null, standing: null, head: null, maxTurns: 30 });
check("game brief before the start: starts in a few seconds", /starts in a few seconds and lasts 30 seconds/.test(warm), warm);

const ip = interviewPrompt({ standings: [{ name: "A", fitness: 1.2, me: true }, { name: "B", fitness: 0.8 }], programs: { cosmos: "def flower(c): return c", orchid: "", bee: "" }, changes: 3, config, notebook: "n" });
check("interview: standings, final programs, changes during the game", /1\. A \(you\): fitness 1\.20/.test(ip) && /changed them 3 times during the game/.test(ip) && /<explanation>/.test(ip));
const jp = judgePrompt({ config, teams: [{ name: "A", explanation: "x", code: { cosmos: "c", orchid: "o", bee: "b" } }], ideas: [], arenaLabel: "arena t, game 1" });
check("judge prompt: a 30 seconds game, feeding sits out rounds", /a game of 30 seconds, a feeding bee sits out 10 rounds/.test(jp));

console.log(failed ? `${failed} check(s) failed` : "all brief checks passed");
process.exit(failed ? 1 : 0);
