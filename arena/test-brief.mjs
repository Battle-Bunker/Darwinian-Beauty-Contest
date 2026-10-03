#!/usr/bin/env node
// The prompts (no model calls, no server): the system prompt describes the one-flower game, the tools and the fair-play
// rules; the lobby and in-game briefs carry headline numbers only (never actions or logs); interview and judge prompts.
//   node arena/test-brief.mjs
import fs from "node:fs";
import { GAME_SUMMARY, gameBrief, interviewPrompt, judgePrompt, judgeSystem, lobbyBrief, settingsText, timingText, toolSystem } from "./lib/prompts.js";

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 400)}`}`); if (!ok) failed++; };
const config = { language: "python", minutes: 0.5, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512,
  budgets: { flower: { size: 1100, perMinute: 220, cap: 220, ms: 150 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50 } } };
const persona = { persona_prompt: "You are Luna, 12.", team_name: "Moonpetal" };
const apiBase = "http://localhost:4100/api/rooms/R/games/G";
const OLD = /\bcosmos|\borchid|\bpatch(?:es)?\b|MEMORY|turns_left|before each round|change turn/i;

const sys = toolSystem(persona, config, "/home/user/arena-ws/a/luna", { apiBase, teams: 3 });
check("system: the tools", ["tools/submit.py", "tools/check.py", "tools/try.py", "tools/status.py", "tools/ledger.py", "tools/stream.py"].every((t) => sys.includes(t)));
check("system: two programs, flower.py and bee.py", /flower\.py and bee\.py/.test(sys) && /two\s+programs, a flower and a bee/.test(sys));
check("system: submissions go live at once and pay their change cost", /goes live at once/.test(sys) && /pays its change cost/.test(sys));
check("system: the team ledger and the public stream are files read with code; the public API",
  /stream\/ledger\.jsonl is your team ledger/.test(sys) && /stream\/actions\.jsonl is the public stream/.test(sys) && /never print them whole/.test(sys) && sys.includes(`${apiBase}/events`) && sys.includes(`${apiBase}/scores`));
check("system: session scripts stop with the session; only the scaffold outlives sessions", /stopped\s+when that session ends; only the scaffold outlives sessions/.test(sys));
check("system: the scaffold: what it's for, how to start it, tools/ on its path, the garden API, its audit",
  /SCAFFOLD/.test(sys) && /tools\/scaffold\.py start scaffold\.py/.test(sys) && /start it in the\s+lobby/.test(sys) && /import garden/.test(sys)
  && ["follow()", "ledger(after)", "follow_live()", "status()", "live(kind)", "measure(kind, code)", "try_flower(code, challenges)", "submit(kind, code)", "wait_for_budget(kind, cost)"].every((x) => sys.includes(x))
  && /audited before every start and restart/.test(sys));
check("system: the game is short", /30 seconds/.test(sys));
check("system: fair play allows reading the public API, nothing else", /except to read \(GET\) the game's public API/.test(sys) && /Do not write to stream\//.test(sys) && /not even \/tmp/.test(sys) && /raw\s+sockets/.test(sys));
check("system: RULES.md in full (the one-flower rules)", /## A turn/.test(sys) && /## Energy, nectar and surplus/.test(sys) && /## What everyone can see/.test(sys));
const tt = timingText(config);
check("timing: 200 ms rounds, the flower's 150 ms and the bee's 50 ms, a feed costs 10 rounds", /Rounds of 200 ms/.test(tt) && /about\s+150 rounds/.test(tt) && /150 ms to return \[response, percent\]/.test(tt)
  && /50 ms to return \["feed" or "leave", next challenge\]/.test(tt) && /out for 10 rounds/.test(tt), tt);
check("timing: energy, and surplus only from feeds", /E = \(1,100 − flower size\) × max\(0, 150 − the flower's CPU ms\)/.test(tt) && /percent\/100 × E as nectar and the flower's team gets the rest/.test(tt)
  && /If it doesn't feed, that energy is lost/.test(tt) && !/keeps all|keeps E|keeps the whole/i.test(sys), tt);
check("timing and system: a feed is public with its percent, energy, nectar and surplus; unfed percent and energy and compute time are the flower team's",
  /a feed's percent, energy, nectar and\s+surplus/.test(tt) && /percent and energy of turns without a feed, and every compute time, stay with the flower's team/.test(tt)
  && /on a\s+feed, its percent, energy, nectar and surplus/.test(sys) && /Private to the\s+flower's team during play: the percent and energy of turns without a feed, and the flower's compute time/.test(sys)
  && /live scoreboard/.test(sys), tt);
check("system: arrivals public; SSE and the WebSocket", /every arrival \(whose bee at whose flower\)/.test(sys) && /ws:\/\/localhost:4100\/api\/rooms\/R\/games\/G\/ws\?after=/.test(sys) && /from Python use the Server-Sent Events/.test(sys));
check("system: this game's settings with per-minute change budgets and caps", /\| flower \| 1,100 \| 220 \| 220 \| 150 \|/.test(sys) && /\| bee \| 11,000 \| 2,200 \| 2,200 \| 50 \|/.test(sys) && /3 teams, 3 flowers and 3 bees/.test(sys));
check("system: no leftovers of earlier variants", !OLD.test(sys), sys.match(OLD)?.[0]);
const devSecret = fs.existsSync(new URL("./runs/.dev-secret", import.meta.url)) ? fs.readFileSync(new URL("./runs/.dev-secret", import.meta.url), "utf8").trim() : "no-secret-file";
check("system: no secrets, tokens or database URLs", !sys.includes(devSecret) && !/postgres:|Bearer |DATABASE_URL|DEV_LOGIN|\.dev-secret/i.test(sys));
check("settings: budgets start at zero and refill", /Change budget starts at 0 when the game starts/.test(settingsText(config, 3)));
check("no starter strategies in the system prompt", !/(?<!no )starter (code|strateg)|for example, (pay|offer|feed)/i.test(sys));

const fresh = lobbyBrief({ config, teamName: "Moonpetal", generation: 1, maxTurns: 30, carried: false });
check("lobby (first game): write both from scratch, no starter code", /program files are empty/.test(fresh) && /Write both from scratch/.test(fresh) && /no starter code/.test(fresh));
check("lobby: free, check/try, submit both; size sets energy", /Writing is free in the lobby/.test(fresh) && /submit both/.test(fresh) && /needs both submitted to play/.test(fresh) && /flower's size also sets its energy/.test(fresh));
check("lobby: the game won't wait; prepare what should react", /won't wait for you/.test(fresh) && /must be ready now/.test(fresh) && /flower 220 and bee 2,200 nodes a minute/.test(fresh));
check("lobby: the scaffold can start now and runs through the game", /tools\/scaffold\.py start scaffold\.py/.test(fresh) && /keeps running through the whole game/.test(fresh));
check("lobby: nothing of earlier variants", !OLD.test(fresh));
const carried = lobbyBrief({ config: { ...config, minutes: 2 }, teamName: "Moonpetal", generation: 3, maxTurns: 30, carried: true });
check("lobby (later game): starts from last game's final programs; previous-games/", /final programs from game 2/.test(carried) && /previous-games\//.test(carried) && /2 minutes/.test(carried));
// A primed cohort: its common-knowledge files are named in every session's system prompt and in the lobby brief.
const primedSys = toolSystem(persona, config, "/home/user/arena-ws/a/luna", { apiBase, teams: 6, common: ["signals.md"] });
const primedLobby = lobbyBrief({ config, teamName: "M", generation: 2, maxTurns: 30, carried: true, common: ["signals.md"] });
check("common knowledge: named in the system prompt and the lobby brief of a primed cohort only",
  /Common knowledge: every team in this garden, including any team that joins in a later game, received exactly the same files in common\/ \(signals\.md\)/.test(primedSys)
  && /Common knowledge: .*common\/ \(signals\.md\)/.test(primedLobby) && !/Common knowledge|common\//.test(sys) && !/Common knowledge|common\//.test(fresh));
const fix = lobbyBrief({ config, teamName: "M", generation: 1, maxTurns: 10, carried: false, fix: "- bee: Syntax error" });
check("lobby fix: the errors, and submit", /bee: Syntax error/.test(fix) && /tools\/submit\.py/.test(fix) && /--json/.test(fix));

const budgets = { flower: { available: 44, perMinute: 220, cap: 220 }, bee: { available: 440, perMinute: 2200, cap: 2200 } };
const head = { turns: 1234, bee: { turns: 40, feeds: 8, ownFeeds: 1, nectar: 60000, flowers: 3 }, flower: { turns: 30, feeds: 7, ownFeeds: 1, noResponse: 2, surplus: 250000, nectarPaid: 50000, bees: 2, meanPercentFed: 24.6 } };
const scores = [{ teamId: "a", fitness: 1.4, allureShare: 0.4, forageShare: 0.3, surplusShare: 0.35 }, { teamId: "me", fitness: 1.05, allureShare: 0.33, forageShare: 0.31, surplusShare: 0.37 },
  { teamId: "c", fitness: 0.5, allureShare: 0.27, forageShare: 0.39, surplusShare: 0.28 }];
const gb = gameBrief({ config: { ...config, minutes: 2 }, teamName: "Moonpetal", teamId: "me", generation: 2, sessionNo: 1, status: "running", clockMs: 12000, budgets, scores,
  head, drafts: ["flower"], maxTurns: 30, scripts: ["follow.py"] });
check("game brief: time played, team, session", /Game 2 is running: 0:12 of 2:00 played\. You are team "Moonpetal"\. Session 1\./.test(gb), gb);
check("game brief: live scores with the three shares", /fitness 1\.05 \(#2 of 3; par is 1\.00\)/.test(gb) && /shares: allure 0\.33, forage 0\.31, surplus 0\.37/.test(gb), gb);
check("game brief: headline numbers only", /So far: 1,234 turns/.test(gb) && /8 feeds at 3 teams' flowers \(1 at your own\), 60,000 nectar/.test(gb) && /mean percent on feeds 25/.test(gb)
  && /250,000 surplus kept, 2 turns with no response/.test(gb) && /flower 44 of 220 \(\+220\/min\)/.test(gb), gb);
check("game brief: drafts and the workspace's python files", /drafts\/flower\.py/.test(gb) && /follow\.py/.test(gb));
check("game brief: no scaffold yet: how to start one", /no scaffold running/.test(gb));
const gbs = gameBrief({ config, teamName: "M", generation: 1, sessionNo: 2, status: "running", clockMs: 5000, budgets, maxTurns: 30, scaffold: { file: "scaffold.py", state: "running", restarts: 1 }, automatic: 4 });
check("game brief: the scaffold's state and its automatic changes", /Your scaffold scaffold\.py: running, 1 restart; it has submitted 4 changes by itself/.test(gbs), gbs);
check("game brief: submit any time; stopped when the game ends", /goes live at once/.test(gb) && /When the game ends this session is stopped/.test(gb));
check("game brief: short (no actions, no logs)", gb.length < 2200 && !/"seq"|"atMs"|\{"action"/.test(gb), gb.length);
const warm = gameBrief({ config, teamName: "M", generation: 1, sessionNo: 1, status: "lobby", clockMs: 0, budgets: null, head: null, maxTurns: 30 });
check("game brief before the start: starts in a few seconds", /starts in a few seconds and lasts 30 seconds/.test(warm), warm);

const ip = interviewPrompt({ standings: [{ name: "A", fitness: 1.2, me: true }, { name: "B", fitness: 0.8 }], programs: { flower: "def flower(c, l): return c, 50", bee: "def first(l): return 1" }, changes: 3, config, notebook: "n" });
check("interview: standings, both final programs, changes during the game", /1\. A \(you\): fitness 1\.20/.test(ip) && /### flower/.test(ip) && /### bee/.test(ip) && /changed them 3 times during the game/.test(ip)
  && /what your flower and your bee do/.test(ip) && /<explanation>/.test(ip));
const jp = judgePrompt({ config, teams: [{ name: "A", explanation: "x", code: { flower: "f", bee: "b" } }], ideas: [], arenaLabel: "arena t, game 1" });
check("judge prompt: a 30 seconds game, feeding sits out rounds, flower and bee code", /a game of 30 seconds, a feeding bee sits out 10 rounds/.test(jp) && /flower:\n```python\nf/.test(jp) && /bee:\n```python\nb/.test(jp));
const js = judgeSystem({ prompt: "You are Ada.", age: 12 });
check("judges: the one-flower game in plain words", /two programs, a flower and a bee/.test(GAME_SUMMARY) && /that energy is lost/.test(GAME_SUMMARY) && !OLD.test(js) && /the flower and the bee really do/.test(js));

console.log(failed ? `${failed} check(s) failed` : "all brief checks passed");
process.exit(failed ? 1 : 0);
