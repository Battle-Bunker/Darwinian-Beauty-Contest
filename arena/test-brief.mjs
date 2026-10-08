#!/usr/bin/env node
// The prompts (no model calls, no server): the system prompt describes the one-flower game, the tools and the fair-play
// rules; the lobby and in-game briefs carry headline numbers only (never actions or logs); interview and judge prompts.
//   node arena/test-brief.mjs
import fs from "node:fs";
import { GAME_SUMMARY, gameBrief, interviewPrompt, judgePrompt, judgeSystem, lobbyBrief, roleText, settingsText, timingText, toolSystem } from "./lib/prompts.js";

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `: ${String(extra).slice(0, 400)}`}`); if (!ok) failed++; };
const config = { language: "python", minutes: 0.5, feedCost: 10, challengeType: "int", responseType: "int", maxLen: 64, maxNodes: 512,
  maxResponseBytes: 1048576,
  budgets: { flower: { size: 1100, perMinute: 220, cap: 220, ms: 150, minMs: 50 }, bee: { size: 11000, perMinute: 2200, cap: 2200, ms: 50, memory: 50 } } };
const persona = { persona_prompt: "You are Luna, 12.", team_name: "Moonpetal" };
const apiBase = "http://localhost:4100/api/rooms/R/games/G";
const OLD = /\bcosmos|\borchid|\bpatch(?:es)?\b|turns_left|before each round|change turn|surplus|allure|\bledger\b|N³|three shares/i;
const OLDX = (t) => t.replace(/idea ledger|Idea ledger/g, "");

const sys = toolSystem(persona, config, "/home/user/arena-ws/a/luna", { apiBase, teams: 3 });
const head0 = sys.slice(0, sys.indexOf("# The rules (also in RULES.md)")); // the arena's own text, without RULES.md
check("system: the tools", ["tools/submit.py", "tools/check.py", "tools/try.py", "tools/status.py", "tools/query.py", "tools/scaffold.py"].every((t) => sys.includes(t)) && !/ledger\.py/.test(sys));
check("system: two programs, flower.py and bee.py: a species and a bee", /flower\.py and bee\.py/.test(sys) && /your flower species and your bee/.test(sys));
check("system: submissions go live at once and pay their change cost", /goes live at once/.test(sys) && /pays its change cost/.test(sys));
check("system: history queries for the team (programs see none), on the game, locally or across the room", /tools\/query\.py/.test(sys) && /Your programs see no history, but your team can/.test(sys)
  && /--local` runs on stream\/history\.jsonl, your team's history file/.test(sys) && /--room` runs across this arena's finished games/.test(sys) && /turns, versions, teams/.test(sys)
  && !/HISTORY/.test(head0), head0);
check("system: big responses: size and hash in queries, the whole one on request", /A response over 4 KB shows as its size and hash/.test(sys) && /tools\/stream\.py response <seq>/.test(sys)
  && /garden\.response\(seq\)/.test(sys) && /A response may be at most 1,048,576 bytes of JSON/.test(sys), head0);
check("system: the files are queried, not printed; the public API", /stream\/history\.jsonl holds your team's history/.test(sys) && /stream\/actions\.jsonl is the public stream/.test(sys)
  && /query them, never print them whole/.test(sys) && sys.includes(`${apiBase}/events`) && sys.includes(`${apiBase}/scores`) && sys.includes(`POST ${apiBase}/query`));
check("system: session scripts stop with the session; only the scaffold outlives sessions", /stopped\s+when that session ends; only the scaffold outlives sessions/.test(sys));
check("system: the scaffold: what it's for, how to start it, tools/ on its path, the garden API, its audit",
  /SCAFFOLD/.test(sys) && /tools\/scaffold\.py start scaffold\.py/.test(sys) && /start it in the\s+lobby/.test(sys) && /import garden/.test(sys)
  && ["local", "game", "room", "follow()", "response(seq)", "follow_live()", "status()", "memory()", "live(kind)", "measure(kind, code)", "try_flower(code, challenges)", "try_bee(code)", "submit(kind, code)", "wait_for_budget(kind, cost)"].every((x) => sys.includes(`\`${x}\``))
  && /audited before every start and restart/.test(sys));
check("system: the bee's MEMORY: read only, written by the deployed bee alone, emptied by a code change", /Your bee's MEMORY is written only by your deployed bee/.test(sys)
  && /nothing you or your tools do can set it/.test(sys) && /emptied whenever your bee's code changes/.test(sys) && /try to change any bee's MEMORY/.test(sys));
check("system: the game is short", /30 seconds/.test(sys));
check("system: fair play allows reading the public API and its history queries, nothing else", /except to read \(GET\) the game's public API/.test(sys) && /post history queries to its query endpoints/.test(sys)
  && /Do not write to stream\//.test(sys) && /not even \/tmp/.test(sys) && /raw\s+sockets/.test(sys));
check("system: RULES.md in full (species, pollen, MEMORY, fed, no history for programs)", /## A turn/.test(sys) && /## Energy: compute, nectar and pollen/.test(sys) && /### Bee memory/.test(sys)
  && /### After a feed: `fed\(nectar\)`/.test(sys) && /## History is for teams, not programs/.test(sys) && /## What everyone can see/.test(sys));
const tt = timingText(config);
check("timing: 200 ms rounds, the flower's hidden budget R (50 to 150 ms) and the bee's 50 ms, a feed costs 10 rounds", /Rounds of 200 ms/.test(tt) && /about\s+150 rounds/.test(tt)
  && /hidden time budget R, drawn uniformly from\s+50 to 150 ms afresh for every call: its hard limit to return \[response, percent\]/.test(tt) && /told its R as\s+GAME\["ms"\]/.test(tt)
  && /reaches the bee at 150 ms whatever R/.test(tt) && /bee is never told R/.test(tt)
  && /50 ms of CPU time to return \["feed" or "leave", next challenge\]/.test(tt) && /out for 10 rounds/.test(tt), tt);
check("timing: species; energy goes to compute, nectar and pollen; the flower gives both on a feed", /flower program is its flower species/.test(tt) && /one flower of a species/.test(tt)
  && /energy goes to compute, nectar and pollen/.test(tt) && /E = \(1,100 − flower size\) × max\(0, R − the flower's CPU ms\)/.test(tt)
  && /the flower gives it\s+percent\/100 × E as nectar and the rest as pollen/.test(tt) && /If it doesn't feed, that energy is lost/.test(tt), tt);
check("timing: the interface: fresh calls, fed, GAME, no history, the bee's 50-byte key-value MEMORY", /flower\(challenge\), first\(\), decide\(challenge, response\), and the bee's optional\s+fed\(nectar\)/.test(tt)
  && /in the same instance as that decide/.test(tt) && /no history/.test(tt) && !/HISTORY/.test(tt) && /MEMORY: a flat key-value store/.test(tt) && /of at most\s+50 bytes \(each key's bytes plus its value's JSON bytes\)/.test(tt)
  && /a new bee version starts with \{\}/.test(tt), tt);
check("timing: the clock starts at 0 every call; no round or game time", /no round or game time/.test(tt) && /clock reads 0\s+when each call starts \(as if it were 1970-01-01, then at real speed\)/.test(tt), tt);
check("timing: pollen grains, as the game sets them (feeder, public, off), interface only", /Pollen carries genes/.test(tt) && /floor\(pollen\^\(1\/3\)\) characters of the\s+minified code/.test(tt)
  && /only the feeding bee's team sees it/.test(tt) && /Programs never get grains/.test(tt)
  && /everyone sees every grain as\s+it happens/.test(timingText({ ...config, grains: "public" })) && /Pollen grains are off/.test(timingText({ ...config, grains: "off" })), tt);
check("system: the grain tools and check.py's refusals", /tools\/grains\.py/.test(sys) && /garden\.grains\(\), garden\.assemble\(flower\)/.test(sys) && /`grains\(\)` and `assemble\(flower\)`/.test(sys)
  && /what the game's Python refuses \(e\.g\. dunder names such as\s+__class__/.test(sys) && /pollen grain with the feeding bee's team/.test(sys), head0);
check("timing and system: a feed is public with its percent, energy, nectar and pollen; unfed percent and energy and compute time are the flower team's",
  /a feed's percent, energy, nectar and\s+pollen/.test(tt) && /percent and energy of turns without a feed, every compute time and every flower call's R stay with the\s+flower's team/.test(tt)
  && /on a\s+feed, its percent, energy, nectar and pollen/.test(sys) && /Private to the\s+flower's team during play: the percent and energy of turns without a feed, and the flower's compute time/.test(sys)
  && /live scoreboard/.test(sys), tt);
check("system: arrivals public; SSE and the WebSocket", /every arrival \(whose bee at whose species\)/.test(sys) && /ws:\/\/localhost:4100\/api\/rooms\/R\/games\/G\/ws\?after=/.test(sys) && /from Python use the Server-Sent Events/.test(sys));
check("system: this game's settings with per-minute change budgets, caps and the memory cap", /\| flower \| 1,100 \| 220 \| 220 \| R: 50 to 150 \|/.test(sys) && /\| bee \| 11,000 \| 2,200 \| 2,200 \| 50 \|/.test(sys)
  && /3 teams: 3 flower species and 3 bees/.test(sys) && /MEMORY holds at most\s+50 bytes/.test(sys));
check("system: no leftovers of earlier variants (in the arena's text)", !OLD.test(OLDX(head0)), OLDX(head0).match(OLD)?.[0]);
const devSecret = fs.existsSync(new URL("./runs/.dev-secret", import.meta.url)) ? fs.readFileSync(new URL("./runs/.dev-secret", import.meta.url), "utf8").trim() : "no-secret-file";
check("system: no secrets, tokens or database URLs", !sys.includes(devSecret) && !/postgres:|Bearer |DATABASE_URL|DEV_LOGIN|\.dev-secret/i.test(sys));
check("settings: budgets start at zero and refill", /Change budget starts at 0 when the game starts/.test(settingsText(config, 3)));
check("no starter strategies in the system prompt", !/(?<!no )starter (code|strateg)|for example, (pay|offer|feed)/i.test(sys));

// Roles (EXPERIMENTS.adapt): private briefs. The honest one sets no amount of costly signalling (no fraction of R).
const honest = roleText("honest", { common: ["signals.md"] }), defector = roleText("defector");
check("roles: honesty: costly signalling at its discretion that reveals R, always 50%; its documents; no target amount", /specialise in honesty/.test(honest)
  && /some level of costly signalling, at your discretion/.test(honest) && /reveals its true\s+per-turn wealth/.test(honest) && /percent 50 on every\s+answer/.test(honest)
  && /common\/ \(signals\.md\)/.test(honest) && !/\d+\s*%\s*of\s*(R|its|your) (budget|time)|0\.\d+\s*[×x*]\s*R|fraction|most of (its|your) R|\bR\s*[×x*]/i.test(honest), honest);
check("roles: defection: imitate the most-fed flowers cheaply, from grains too; always 0%", /specialise in defection/.test(defector) && /flowers getting the most feeds/.test(defector)
  && /including from your pollen grains/.test(defector) && /percent 0 on every answer/.test(defector), defector);
const sysRole = toolSystem(persona, config, "/w", { apiBase, teams: 14, role: "honest", common: ["signals.md"], commonScope: "role" });
const sysVet = toolSystem(persona, config, "/w", { apiBase, teams: 14 });
check("roles: in the role's system prompt only (private), and role documents aren't announced as common knowledge", /# Your role in this tournament \(private/.test(sysRole)
  && !/Your role/.test(sysVet) && !/every team in this garden, including any team that joins/.test(sysRole));
const seeded = lobbyBrief({ config, teamName: "Red Team Petals", generation: 1, maxTurns: 30, carried: true, seeded: true });
check("lobby: a seeded veteran starts from its last tournament's programs and files, with no strategy hint", /final programs from your last tournament/.test(seeded)
  && /earlier-tournament\//.test(seeded) && !/previous-games\/ has/.test(seeded) && !/honest|defect/i.test(seeded), seeded);

// adapt-hi (EXPERIMENTS["adapt-hi"]): pinned cooperators exploring spend and generosity above floors (b ≥ 0.2 of R, one
// fixed b per version, never fixed ms; percent ≥ 20), their fingerprint profile to escape imitators, starting where the
// old mandate stood (b 0.6, percent 50); the bee played to win, from the reference bee. No brevity nudges; the lobby's
// time; the start programs.
const h60 = roleText("honest", { common: ["integrated.py", "integrated_bee.py", "strategy.md"], brief: "contract", start: { flower: "common/integrated.py", bee: "common/integrated_bee.py" } });
check("adapt-hi cooperators: a role, not competing to win; explore spend and generosity above the floors; profile against imitators; the bee to win",
  /pinned cooperator/.test(h60) && /not competing to win/.test(h60) && /plays a role/.test(h60) && /explore/.test(h60) && /attractive to bees and robust to imitators/.test(h60)
  && /reaches b × R/.test(h60) && /at least 0\.2\b/.test(h60) && /never a fixed number of ms/.test(h60) && /Within one version b is one fixed\s+fraction/.test(h60)
  && /time\.process_time\(\)/.test(h60) && /GAME\["ms"\]/.test(h60) && /percent at least 20 on every answer/.test(h60)
  && /may change in your flower: b, its percent, and its fingerprint profile/.test(h60) && /escape defecting imitators/.test(h60) && /Fixing a bug/.test(h60)
  && /Multi-dimensional fingerprints can be mixed with raw costly signalling/.test(h60) && /public responses and the feed record/.test(h60)
  && /copy of the reference flower \(common\/integrated\.py\), at b = 0\.6 and percent 50/.test(h60) && /strategy\.md has measured numbers for spend and generosity: information, not instructions/.test(h60)
  && /copy of the reference bee \(common\/integrated_bee\.py\)/.test(h60) && /Play it to win, and change it as you like/.test(h60)
  && /common\/ \(integrated\.py, integrated_bee\.py, strategy\.md/.test(h60) && !/never change|exactly \d+%/.test(h60), h60);
const hFloors = roleText("honest", { brief: "contract", contract: { burnMin: 0.3, nectarMin: 25, startBurn: 0.5, startNectar: 40 }, start: { flower: "common/integrated.py" } });
check("adapt-hi cooperators: the mandate's numbers come from the preset (one place)", /at least 0\.3\b/.test(hFloors) && /percent at least 25 on every answer/.test(hFloors)
  && /at b = 0\.5 and percent 40/.test(hFloors) && !/0\.2\b|at least 20|0\.6|percent 50/.test(hFloors), hFloors);
check("adapt-hi honest role: private, in the system prompt", /# Your role in this experiment \(private/.test(toolSystem(persona, config, "/w", { apiBase, teams: 14, role: "honest", roleBrief: "contract", common: ["signals.md"], commonScope: "role" })));
const NUDGES = /Be quick|at most (about )?\d+ tool calls|Work step by step, then stop with a short summary|one-line summary|one-paragraph summary/;
const hiSys = toolSystem(persona, config, "/w", { apiBase, teams: 14, brevity: false });
const hiLobby = lobbyBrief({ config, teamName: "Moonpetal", generation: 2, maxTurns: 100, carried: true, brevity: false, minutes: 10 });
const hiFix = lobbyBrief({ config, teamName: "Moonpetal", generation: 2, maxTurns: 15, carried: true, fix: "- bee: x", brevity: false });
const hiGame = gameBrief({ config, teamName: "Moonpetal", generation: 1, sessionNo: 2, status: "running", clockMs: 60000, budgets: null, maxTurns: 60, brevity: false });
check("adapt-hi: no brevity nudges in the system prompt, the lobby, a fix or a game session (they stay elsewhere)",
  ![hiSys, hiLobby, hiFix, hiGame].some((t) => NUDGES.test(t)) && /Work step by step, then stop with a short summary/.test(sysVet)
  && /at most about 30 tool calls/.test(lobbyBrief({ config, teamName: "M", generation: 2, maxTurns: 30, carried: true })), [hiSys, hiLobby, hiFix, hiGame].map((t) => t.match(NUDGES)?.[0]).join(" / "));
const hiFixed = toolSystem(persona, config, "/w", { apiBase, teams: 14, fixed: true, brevity: false, simpleCode: false });
check("adapt-hi: no steer toward simple code (with fixed teams the interview is only described); other arenas keep it",
  !/smart kid|obscure techniques|aged 10-14|understand it/.test(hiFixed) && /Nothing in this\s+tournament depends on those scores/.test(hiFixed)
  && /Clever ideas a smart kid can follow beat obscure techniques/.test(toolSystem(persona, config, "/w", { apiBase, teams: 14, fixed: true })), hiFixed.slice(0, 1500));
check("system: wait by sleeping, never spin (a busy loop takes CPU from the game and the other agents); a warned-about fair-play matter",
  /to wait, sleep: `time\.sleep\(s\)`/.test(sysVet) && /garden\.wait_for_budget/.test(sysVet) && /Never spin in a loop/.test(sysVet) && /takes CPU from all of them/.test(sysVet)
  && /only warned about.*\n?.*busy-wait loop/.test(sysVet));
check("timing: a game with the byte factor states it, and the response cap; one without doesn't",
  /max\(0, R − the flower's CPU ms\) × \(1,024 − response bytes\), in node·ms·bytes\.\s+A response's bytes are its JSON text's, at most 1,024: a bigger one is refused/.test(timingText({ ...config, maxResponseBytes: 1024, energy: { bytes: true } }))
  && !/response bytes/.test(timingText(config)));
// No priming toward cryptography: in a game whose responses fit in 1 KB, nothing the arena writes for a team (system prompt
// before RULES.md, role briefs, lobby and game briefs) mentions hashes, signatures, nonces, HMACs or cryptography.
const CRYPTO = /hash|sha-?\d|nonce|hmac|signature|cryptograph/i;
const smallCfg = { ...config, maxResponseBytes: 1024, energy: { bytes: true } };
const smallSys = toolSystem(persona, smallCfg, "/w", { apiBase, teams: 14, fixed: true, brevity: false, simpleCode: false, role: "honest", roleBrief: "contract",
  common: ["integrated.py", "integrated_bee.py", "strategy.md"], commonScope: "role", start: { flower: "common/integrated.py", bee: "common/integrated_bee.py" } }).split("# The rules (also in RULES.md)")[0];
check("adapt-hi: no cryptographic words in what the arena writes for a team (RULES.md aside)", !CRYPTO.test(smallSys) && !CRYPTO.test(roleText("defector"))
  && !CRYPTO.test(lobbyBrief({ config: smallCfg, teamName: "M", generation: 2, maxTurns: 100, carried: true, brevity: false, minutes: 10 }))
  && !CRYPTO.test(gameBrief({ config: smallCfg, teamName: "M", generation: 1, sessionNo: 2, status: "running", clockMs: 60000, budgets: null, maxTurns: 60, brevity: false })),
  smallSys.match(new RegExp(`.{0,80}(${CRYPTO.source}).{0,80}`, "i"))?.[0]);
// Metagame v2 (lib/prevalence.js; server/lib/gameConfig.js): prevalence on both sides with the F × B score, the feed
// price and the flower window, from the game's config. A config without prevalence, or in the superseded one-sided form
// (no slots), plays the old way.
const oneSided = { ...config, prevalence: { on: true, basis: "pollination", halfLifeS: 60, cStart: 1, cEnd: 0.1 } };
check("timing: a config without prevalence, or in the one-sided form (no slots), plays the old way: species at random, every bee each round",
  !/prevalence|F × B|feed_price/i.test(timingText(oneSided, 4)) && /drawn at random/.test(timingText(oneSided, 4)) && /Every bee that isn't feeding gets\s+one turn per round/.test(timingText(oneSided, 4))
  && !/prevalence/i.test(timingText(config)) && /drawn at random/.test(timingText(config)), timingText(oneSided, 4));
const v2 = { ...config, minutes: 40, feedCost: 0, flowerWindowMs: 150, feedPrice: null, maxResponseBytes: 1024, energy: { bytes: true }, scoring: { alpha: 0.85, beta: 0.85 },
  prevalence: { on: true, halfLifeS: 90, cStart: 1, cEnd: 0.1, cap: 4, slots: 0.25, prior: null },
  budgets: { flower: { size: 1100, perMinute: 60, cap: 300, ms: 50, minMs: 1 }, bee: { size: 11000, perMinute: 600, cap: 3000, ms: 50, memory: 50 } } };
const ct = timingText(v2, 10);
check("v2 timing: 200 ms rounds; 3 of the 10 bees drawn by bee success; R from 1 to 50 ms; responses at 150 ms (GAME flower_window_ms); no rounds out",
  /Rounds of 200 ms of game time: a 40 minutes game is about 12000 rounds/.test(ct) && /Each round 3 of the 10 bees\s+are drawn by bee success \(below\), and each takes one turn/.test(ct)
  && /drawn by prevalence \(below\)/.test(ct) && /drawn uniformly from\s+1 to 50 ms/.test(ct) && /GAME\["flower_ms"\] is 50, GAME\["flower_window_ms"\] 150\)/.test(ct)
  && /reaches the bee at 150 ms whatever R/.test(ct) && !/flower_window_ms/.test(tt) && /A feed doesn't take the bee out of play/.test(ct)
  && !/out for 0 rounds/.test(ct) && !/Every bee that isn't feeding/.test(ct), ct);
check("v2 timing: the feed price as an absolute number from the config (null: 5% of the most a flower can make), out of the bee's nectar; a set price; free",
  /A feed costs the bee a price of 2,816,000 node·ms·bytes, 5% of the most a flower can make in a turn\s+\(GAME\["feed_price"\]\), out of its nectar: its net nectar is nectar − price, which can be negative/.test(ct)
  && /a price of 1,000,000 node·ms·bytes, 1\.8% of the most/.test(timingText({ ...v2, feedPrice: 1000000 }, 10))
  && !/feed costs|feed_price/.test(timingText({ ...v2, feedPrice: 0 }, 10)) && !/feed costs|feed_price/.test(tt), ct);
check("v2 timing: prevalence on both sides: the draws, F from recent pollen^β, B from recent net nectar^α, the prior, the half-life, the cap, c; public, never to programs; no strategy",
  /Prevalence, on both sides/.test(ct) && /A round's\s+3 bees \(⌈0\.25 × N⌉ of the 10\) are drawn one after another, without replacement, among the bees with a challenge queued/.test(ct)
  && /bee b\s+with weight c \+ B_b; a bee not drawn doesn't visit that round/.test(ct) && /weight c \+ F_s, with replacement, its own species included/.test(ct)
  && /\(the pollen it gave that team's bee lately\)\^0\.85/.test(ct) && /Σ over species of sign\(D\) \|D\|\^0\.85\), D the net nectar it got at that\s+species lately/.test(ct) && /nectar minus the feed price, so D can be negative/.test(ct)
  && /starts at 6,758,400 and halves every 90 s of game time/.test(ct) && /par\s+1 and are capped at 4/.test(ct) && /c runs from 1 to 0\.1 over the game/.test(ct)
  && /tools\/status\.py/.test(ct) && /garden\.prevalence\(\)/.test(ct) && /Programs never\s+see them/.test(ct), ct);
check("v2 timing: the score is F × B's time-average (keyed to prevalence.on); cumulative and uncapped settings; the round count without N",
  /Your score, your fitness, is the time-average over the rounds played of F × B/.test(ct)
  && /never fades \(cumulative\)/.test(timingText({ ...v2, prevalence: { ...v2.prevalence, halfLifeS: null, cap: null } }, 10)) && /par\s+1 \(uncapped\)/.test(timingText({ ...v2, prevalence: { ...v2.prevalence, cap: null } }, 10))
  && /Each round ⌈0\.25 × N⌉ of the N bees/.test(timingText(v2)) && !/F × B/.test(timingText({ ...v2, prevalence: { ...v2.prevalence, on: false } }, 10)), ct);
check("v2 settings: Scores names F × B as the score (pollination and forage only shown); other games keep their exponents line",
  /Scores: your fitness is the time-average of F × B \(above\)/.test(settingsText(v2, 10)) && /they aren't the score/.test(settingsText(v2, 10)) && /R: 1 to 50/.test(settingsText(v2, 10))
  && /forage sums nectar\^0\.85 over the species your bee fed at/.test(settingsText({ ...config, scoring: { alpha: 0.85, beta: 0.85 } }, 4)), settingsText(v2, 10));
// The presets: the old ones (up to adapt-hi) pinned to the rules they ran under, every key explicit and checked; coop-eq on v2.
{
  const { PRESETS } = await import("./lib/presets.js");
  const RULE_KEYS = ["feedCost", "feedPrice", "flowerWindowMs", "maxResponseBytes", "energy.bytes", "scoring.alpha", "scoring.beta", "prevalence.on", "pollenGrain.scale",
    "budgets.flower.ms", "budgets.flower.minMs", "budgets.flower.perMinute", "budgets.flower.cap", "budgets.bee.perMinute", "budgets.bee.cap", "budgets.bee.ms", "budgets.bee.memory"];
  const at = (o, k) => k.split(".").reduce((x, y) => x?.[y], o);
  const old = Object.entries(PRESETS).filter(([k]) => !/coop/.test(k)), coop = Object.entries(PRESETS).filter(([k]) => /coop/.test(k));
  const bad = old.filter(([, p]) => RULE_KEYS.some((k) => at(p.config, k) === undefined || p.expectConfig?.[k] !== at(p.config, k))
    || p.config.feedPrice !== 0 || p.config.prevalence.on !== false || p.config.flowerWindowMs !== p.config.budgets.flower.ms).map(([k]) => k);
  const adaptOld = PRESETS.adapt14.config, hi = PRESETS.adapt14hi.config;
  check("presets: the old ones pinned to their rules (explicit and checked: no prevalence, free feeds, the window at their flower ms); coop-eq on v2",
    !bad.length && old.length >= 10 && adaptOld.feedCost === 10 && adaptOld.budgets.flower.minMs === 50 && adaptOld.budgets.flower.perMinute === 220 && adaptOld.budgets.bee.cap === 2200
    && adaptOld.energy.bytes === false && adaptOld.scoring.alpha === 0.5 && adaptOld.maxResponseBytes === 65536 && hi.feedCost === 20 && hi.budgets.flower.minMs === 3
    && hi.energy.bytes === true && hi.scoring.alpha === 0.85 && hi.maxResponseBytes === 1024 && hi.pollenGrain.scale === 0.1 && PRESETS["dry-adapt-hi"].config === hi
    && coop.length === 2 && coop.every(([, p]) => p.config.prevalence.on === true && p.config.feedPrice === null && p.config.flowerWindowMs === 150 && p.config.budgets.flower.ms === 50
      && RULE_KEYS.every((k) => at(p.config, k) !== undefined && p.expectConfig[k] === at(p.config, k))), bad.join(", "));
}
const v2Scores = [{ teamId: "me", fitness: 1.08, pollinationShare: 0.3, forageShare: 0.2, flowerSuccess: 1.2, beeSuccess: 0.9 }, { teamId: "b", fitness: 0.92 }];
const v2Brief = gameBrief({ config: v2, teamName: "M", teamId: "me", generation: 1, sessionNo: 3, status: "running", clockMs: 60000, budgets: null, scores: v2Scores, maxTurns: 60, brevity: false });
check("v2 game brief: fitness with F and B now, no shares", /fitness 1\.08 \(#1 of 2; par is 1\.00\); now: flower success F 1\.20, bee success B 0\.90/.test(v2Brief) && !/shares: pollination/.test(v2Brief), v2Brief);
check("timing: R and the bee's 50 ms are CPU time (process_time); a wall-clock backstop; a starved call is voided; time.sleep does nothing in programs",
  /its hard limit to return \[response, percent\], in CPU time/.test(tt) && /50 ms of CPU time to return/.test(tt) && /time\.process_time\(\)/.test(tt)
  && /wall-clock backstop/.test(tt) && /starved of CPU is voided\s+and counts against no one/.test(tt) && /time\.sleep\(\) does nothing in programs/.test(tt)
  && !/R is wall time|on the wall clock from/.test(tt), tt);
// coop-eq: the pinned defector's brief (its rules: the v2 checks above).
const pinned = roleText("defector", { brief: "pinned" });
check("coop-eq defector: pinned, percent 0, any other strategy, its bee to win; nothing cryptographic", /pinned defector/.test(pinned) && /percent 0 on every\s+answer/.test(pinned)
  && /any strategy is yours/.test(pinned) && /Your bee plays\s+to win/.test(pinned) && !CRYPTO.test(pinned), pinned);
check("old games keep their round and feed text", /Every bee that isn't feeding gets\s+one turn per round/.test(tt) && /out for 10 rounds/.test(tt) && !/price|Prevalence|F × B/.test(tt));
check("adapt-hi lobby: its wall time, and what the team can study (the revealed earlier games, room queries)", /about 10 minutes of wall time/.test(hiLobby)
  && /previous-games\//.test(hiLobby) && /tools\/query\.py --room/.test(hiLobby), hiLobby);
const bothLobby = lobbyBrief({ config, teamName: "Wildmeadow Commons", generation: 1, maxTurns: 100, carried: true, started: ["flower", "bee"], brevity: false, minutes: 10 });
check("adapt-hi lobby: an honest team's first game starts from the reference flower and bee", /flower\.py and bee\.py start as the reference programs/.test(bothLobby)
  && /you may rewrite them/.test(bothLobby) && !/is empty/.test(bothLobby), bothLobby);
const startLobby = lobbyBrief({ config, teamName: "Wildmeadow Commons", generation: 1, maxTurns: 100, carried: true, started: ["bee"], brevity: false, minutes: 10 });
check("adapt-hi lobby: an honest team's first game starts from the reference bee, with the flower to write", /bee\.py starts as the reference program/.test(startLobby)
  && /flower\.py is empty: write it from scratch/.test(startLobby) && !/final programs from game 0/.test(startLobby), startLobby);
check("settings: the R floor from the game's config (the engine's 2% default when it has none); score exponents only when the game sets them",
  /R: 3 to 150/.test(settingsText({ ...config, budgets: { ...config.budgets, flower: { ...config.budgets.flower, minMs: undefined } } }, 4))
  && /R: 50 to 150/.test(settingsText(config, 4)) && !/nectar\^/.test(settingsText(config, 4))
  && /nectar\^0\.85/.test(settingsText({ ...config, scoring: { alpha: 0.85, beta: 0.85 } }, 4)));

const fresh = lobbyBrief({ config, teamName: "Moonpetal", generation: 1, maxTurns: 30, carried: false });
check("lobby (first game): write both from scratch to the interface, no starter code", /program files are empty/.test(fresh) && /Write both from scratch/.test(fresh) && /no starter code/.test(fresh)
  && /flower\(challenge\), first\(\) and decide\(challenge, response\), optionally fed\(nectar\), with GAME and the bee's MEMORY/.test(fresh) && !/HISTORY/.test(fresh), fresh);
check("lobby: free, check/try, submit both; size sets energy; the memory cap", /Writing is free in the lobby/.test(fresh) && /submit both/.test(fresh) && /needs both submitted to play/.test(fresh) && /flower's size also sets its energy/.test(fresh)
  && /MEMORY holds 50 bytes/.test(fresh));
check("lobby: the game won't wait; prepare what should react", /won't wait for you/.test(fresh) && /must be ready now/.test(fresh) && /flower 220 and bee 2,200 nodes a minute/.test(fresh));
check("lobby: the scaffold can start now and runs through the game", /tools\/scaffold\.py start scaffold\.py/.test(fresh) && /keeps running through the whole game/.test(fresh));
check("lobby: nothing of earlier variants", !OLD.test(fresh), fresh.match(OLD)?.[0]);
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
const head = { turns: 1234, bee: { turns: 40, feeds: 8, ownFeeds: 1, nectar: 60000, flowers: 3 }, flower: { turns: 30, feeds: 7, ownFeeds: 1, noResponse: 2, pollen: 250000, nectarPaid: 50000, bees: 2, meanPercentFed: 24.6 } };
const scores = [{ teamId: "a", fitness: 1.4, pollinationShare: 0.4, forageShare: 0.3 }, { teamId: "me", fitness: 1.05, pollinationShare: 0.33, forageShare: 0.31 },
  { teamId: "c", fitness: 0.5, pollinationShare: 0.27, forageShare: 0.39 }];
const gb = gameBrief({ config: { ...config, minutes: 2 }, teamName: "Moonpetal", teamId: "me", generation: 2, sessionNo: 1, status: "running", clockMs: 12000, budgets, scores,
  head, memory: { bytes: 37, cap: 50, version: 2, error: "MEMORY is 61 bytes, over the cap of 50" }, drafts: ["flower"], maxTurns: 30, scripts: ["follow.py"] });
check("game brief: time played, team, session", /Game 2 is running: 0:12 of 2:00 played\. You are team "Moonpetal"\. Session 1\./.test(gb), gb);
check("game brief: live scores with the two shares", /fitness 1\.05 \(#2 of 3; par is 1\.00\)/.test(gb) && /shares: pollination 0\.33, forage 0\.31\./.test(gb), gb);
check("game brief: headline numbers only", /So far: 1,234 turns/.test(gb) && /8 feeds at 3 teams' species \(1 at your own\), 60,000 nectar/.test(gb) && /mean percent on feeds 25/.test(gb)
  && /250,000 pollen given, 2 turns with no response/.test(gb) && /flower 44 of 220 \(\+220\/min\)/.test(gb), gb);
check("game brief: the bee's MEMORY size, read only, and the query tool", /Your bee's MEMORY: 37 of 50 bytes \(bee v2/.test(gb) && /its last save failed: MEMORY is 61 bytes/.test(gb) && !/HISTORY/.test(gb) && /tools\/query\.py/.test(gb) && !OLD.test(gb), gb);
check("game brief: drafts and the workspace's python files", /drafts\/flower\.py/.test(gb) && /follow\.py/.test(gb));
check("game brief: no scaffold yet: how to start one", /no scaffold running/.test(gb));
const gbs = gameBrief({ config, teamName: "M", generation: 1, sessionNo: 2, status: "running", clockMs: 5000, budgets, maxTurns: 30, scaffold: { file: "scaffold.py", state: "running", restarts: 1 }, automatic: 4 });
check("game brief: the scaffold's state and its automatic changes", /Your scaffold scaffold\.py: running, 1 restart; it has submitted 4 changes by itself/.test(gbs), gbs);
check("game brief: submit any time; stopped when the game ends", /goes live at once/.test(gb) && /When the game ends this session is stopped/.test(gb));
check("game brief: short (no actions, no logs)", gb.length < 2200 && !/"seq"|"atMs"|\{"action"/.test(gb), gb.length);
const warm = gameBrief({ config, teamName: "M", generation: 1, sessionNo: 1, status: "lobby", clockMs: 0, budgets: null, head: null, maxTurns: 30 });
check("game brief before the start: starts in a few seconds", /starts in a few seconds and lasts 30 seconds/.test(warm), warm);

const ip = interviewPrompt({ standings: [{ name: "A", fitness: 1.2, me: true }, { name: "B", fitness: 0.8 }], programs: { flower: "def flower(c): return c, 50", bee: "def first(): return 1" }, changes: 3, config, notebook: "n" });
check("interview: standings, both final programs, changes during the game", /1\. A \(you\): fitness 1\.20/.test(ip) && /### flower/.test(ip) && /### bee/.test(ip) && /changed them 3 times during the game/.test(ip)
  && /what your flower species and your bee do/.test(ip) && /<explanation>/.test(ip));
const jp = judgePrompt({ config, teams: [{ name: "A", explanation: "x", code: { flower: "f", bee: "b" } }], ideas: [], arenaLabel: "arena t, game 1" });
check("judge prompt: a 30 seconds game, feeding sits out rounds, flower and bee code", /a game of 30 seconds, a feeding bee sits out 10 rounds/.test(jp) && /flower:\n```python\nf/.test(jp) && /bee:\n```python\nb/.test(jp));
const js = judgeSystem({ prompt: "You are Ada.", age: 12 });
check("judges: the one-flower game in plain words: species, nectar and pollen given, the bee's small memory", /two programs, a flower species and a bee/.test(GAME_SUMMARY)
  && /the flower gives it the nectar and the pollen/.test(GAME_SUMMARY) && /that energy is lost/.test(GAME_SUMMARY) && /only the bee keeps a tiny memory \(50 bytes\)/.test(GAME_SUMMARY) && /never see what happened before/.test(GAME_SUMMARY)
  && /multiplied together/.test(GAME_SUMMARY) && !OLD.test(js.replace(/\bledger\b/g, "")) && /the flower species and the bee really do/.test(js), js.replace(/\bledger\b/g, "").match(OLD)?.[0]);

console.log(failed ? `${failed} check(s) failed` : "all brief checks passed");
process.exit(failed ? 1 : 0);
