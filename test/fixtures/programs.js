// Sample programs for tests (any language, int/float/bool/str/list types). Never shown to players:
// the game gives teams no starting code, only the interface.
// `seed` varies the constants.
import { parseType } from "../../server/lib/types.js";

function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (lo, hi) => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return lo + (((t ^ (t >>> 14)) >>> 0) % (hi - lo + 1));
  };
}
const question = (t, r) => ({ int: r(0, 999), float: r(0, 999) / 1000, bool: true, str: "hi" + r(0, 99) }[t.kind] ?? [question(t.of, r)]);

const ORCHID_NOTE = `Orchid: a deceptive flower. Bees that feed here get no nectar,
but your patch still earns the visit. Bees feed here when it answers like a clover they trust:
yours, or another team's. Your bee's log shows what other teams' flowers answered, and which paid.`;
const comment = (text, mark) => text.split("\n").map((l) => `${mark} ${l}`).join("\n");

const pyLit = (v) => (v === true ? "True" : v === false ? "False" : JSON.stringify(v));

// An expression of the response type built from a hex digest string `h` (64 hex chars).
function pyFromHex(t, h = "h", at = 0) {
  switch (t.kind) {
    case "int": return `int(${h}[${at}:${at + 8}], 16)`;
    case "float": return `int(${h}[${at}:${at + 8}], 16) / 2**32`;
    case "bool": return `int(${h}[${at}], 16) % 2 == 0`;
    case "str": return `${h}[${at}:${at + 12}]`;
    case "list": return `[${pyFromHex(t.of, h, at)}, ${pyFromHex(t.of, h, at + 16)}]`;
  }
}
function tsFromHex(t, h = "h", at = 0) {
  switch (t.kind) {
    case "int": return `parseInt(${h}.slice(${at}, ${at + 8}), 16)`;
    case "float": return `parseInt(${h}.slice(${at}, ${at + 8}), 16) / 2 ** 32`;
    case "bool": return `parseInt(${h}[${at}], 16) % 2 === 0`;
    case "str": return `${h}.slice(${at}, ${at + 12})`;
    case "list": return `[${tsFromHex(t.of, h, at)}, ${tsFromHex(t.of, h, at + 16)}]`;
  }
}
const tsType = (t) => (t.kind === "list" ? `${tsType(t.of)}[]` : { int: "number", float: "number", bool: "boolean", str: "string" }[t.kind]);

function python(cT, rT, r) {
  const q = pyLit(question(cT, r));
  const intInt = cT.kind === "int" && rT.kind === "int";
  const [a, b, c, d, salt] = [2 * r(1, 48) + 1, r(1, 999), 2 * r(1, 48) + 1, r(1, 999), r(1000, 9999)];
  const clover = intInt
    ? `# Clover: a rewarding flower. Bees that feed here get nectar.
# flower(challenge) runs fresh for every question: it keeps nothing between calls.
def flower(challenge):
    return (challenge * ${a} + ${b}) % 1000
`
    : `# Clover: a rewarding flower. Bees that feed here get nectar.
# flower(challenge) runs fresh for every question: it keeps nothing between calls.
import hashlib, json

def flower(challenge):
    h = hashlib.sha256(("clover${salt}" + json.dumps(challenge)).encode()).hexdigest()
    return ${pyFromHex(rT)}
`;
  const orchid = intInt
    ? `${comment(ORCHID_NOTE, "#")}
def flower(challenge):
    return (challenge * ${c} + ${d}) % 1000
`
    : `${comment(ORCHID_NOTE, "#")}
import hashlib, json

def flower(challenge):
    h = hashlib.sha256(("orchid${salt}" + json.dumps(challenge)).encode()).hexdigest()
    return ${pyFromHex(rT)}
`;
  const bee = `# Bee: visits one flower at a time. Variables at the top level
# last for as long as this version of the bee plays, so it can learn as it goes.
QUESTION = ${q}
tally = {}   # answer to QUESTION -> [times fed, times got nectar]

def forage(seen):
    # seen = [[challenge, response], ...] for the flower in front of you
    if not seen:
        return ["ask", QUESTION]    # costs 1 turn
    fed, got = tally.get(str(seen[0][1]), [0, 0])
    if fed < 2 or got / fed >= 0.5:   # taste each new answer twice
        return "feed"               # costs GAME["feed_cost"] turns
    return "leave"                  # free

def tasted(seen, nectar):
    key = str(seen[0][1])
    fed, got = tally.get(key, [0, 0])
    tally[key] = [fed + 1, got + (1 if nectar else 0)]
`;
  return { clover, orchid, bee };
}

function typescript(cT, rT, r) {
  const C = tsType(cT), R = tsType(rT);
  const q = JSON.stringify(question(cT, r));
  const intInt = cT.kind === "int" && rT.kind === "int";
  const [a, b, c, d, salt] = [2 * r(1, 48) + 1, r(1, 999), 2 * r(1, 48) + 1, r(1, 999), r(1000, 9999)];
  const hash = `// A tiny string hash (FNV-1a), repeated to make 64 hex characters.
function hex(s: string): string {
  let out = "";
  for (let k = 0; k < 8; k++) {
    let x = 2166136261 ^ k;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
    out += (x >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}
`;
  const clover = intInt
    ? `// Clover: a rewarding flower. Bees that feed here get nectar.
// flower(challenge) runs fresh for every question: it keeps nothing between calls.
function flower(challenge: number): number {
  return (((challenge * ${a} + ${b}) % 1000) + 1000) % 1000;
}
`
    : `// Clover: a rewarding flower. Bees that feed here get nectar.
// flower(challenge) runs fresh for every question: it keeps nothing between calls.
${hash}
function flower(challenge: ${C}): ${R} {
  const h = hex("clover${salt}" + JSON.stringify(challenge));
  return ${tsFromHex(rT)};
}
`;
  const orchid = intInt
    ? `${comment(ORCHID_NOTE, "//")}
function flower(challenge: number): number {
  return (((challenge * ${c} + ${d}) % 1000) + 1000) % 1000;
}
`
    : `${comment(ORCHID_NOTE, "//")}
${hash}
function flower(challenge: ${C}): ${R} {
  const h = hex("orchid${salt}" + JSON.stringify(challenge));
  return ${tsFromHex(rT)};
}
`;
  const bee = `// Bee: visits one flower at a time. Variables at the top level
// last for as long as this version of the bee plays, so it can learn as it goes.
type Challenge = ${C};
type Seen = [Challenge, ${R} | null][];

const QUESTION: Challenge = ${q};
const tally = new Map<string, [number, number]>(); // answer to QUESTION -> [times fed, times got nectar]

function forage(seen: Seen): ["ask", Challenge] | "feed" | "leave" {
  if (seen.length === 0) return ["ask", QUESTION]; // costs 1 turn
  const [fed, got] = tally.get(JSON.stringify(seen[0][1])) ?? [0, 0];
  if (fed < 2 || got / fed >= 0.5) return "feed"; // taste each new answer twice; costs GAME.feed_cost turns
  return "leave";                                   // free
}

function tasted(seen: Seen, nectar: boolean): void {
  const key = JSON.stringify(seen[0][1]);
  const [fed, got] = tally.get(key) ?? [0, 0];
  tally.set(key, [fed + 1, got + (nectar ? 1 : 0)]);
}
`;
  return { clover, orchid, bee };
}

/** `seed` (e.g. the team id) varies the constants, so each team starts somewhere different. */
export function starters(config, seed = "") {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  const r = rng(seed);
  return config.language === "typescript" ? typescript(cT, rT, r) : python(cT, rT, r);
}
