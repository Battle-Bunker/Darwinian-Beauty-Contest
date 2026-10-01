// Starter programs for a game's language and challenge/response types.
import { exampleValue, parseType } from "./types.js";

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

function python(cT, rT) {
  const q = pyLit(exampleValue(cT));
  const intInt = cT.kind === "int" && rT.kind === "int";
  const clover = intInt
    ? `# Clover: a rewarding flower. Bees that feed here get nectar.
# flower(challenge) is a pure function: same challenge in, same response out.
def flower(challenge):
    return (challenge * 3 + 1) % 1000
`
    : `# Clover: a rewarding flower. Bees that feed here get nectar.
# flower(challenge) is a pure function: same challenge in, same response out.
import hashlib, json

def flower(challenge):
    h = hashlib.sha256(("clover" + json.dumps(challenge)).encode()).hexdigest()
    return ${pyFromHex(rT)}
`;
  const orchid = intInt
    ? `# Orchid: a deceptive flower. Bees that feed here get no nectar,
# but your patch still earns the visit.
def flower(challenge):
    if 0 <= challenge < 100:
        return (challenge * 3 + 1) % 1000  # up close it looks just like our clover...
    return challenge % 1000                # ...but not from further away
`
    : `# Orchid: a deceptive flower. Bees that feed here get no nectar,
# but your patch still earns the visit.
import hashlib, json

def flower(challenge):
    h = hashlib.sha256(("orchid" + json.dumps(challenge)).encode()).hexdigest()
    return ${pyFromHex(rT)}
`;
  const bee = `# Bee: visits one flower at a time. Variables at the top level
# last for the whole round, so your bee can learn as it goes.
QUESTION = ${q}
tally = {}   # answer to QUESTION -> [times fed, times got nectar]

def forage(seen, turns_left):
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

function typescript(cT, rT) {
  const C = tsType(cT), R = tsType(rT);
  const q = JSON.stringify(exampleValue(cT));
  const intInt = cT.kind === "int" && rT.kind === "int";
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
// flower(challenge) is a pure function: same challenge in, same response out.
function flower(challenge: number): number {
  return (((challenge * 3 + 1) % 1000) + 1000) % 1000;
}
`
    : `// Clover: a rewarding flower. Bees that feed here get nectar.
// flower(challenge) is a pure function: same challenge in, same response out.
${hash}
function flower(challenge: ${C}): ${R} {
  const h = hex("clover" + JSON.stringify(challenge));
  return ${tsFromHex(rT)};
}
`;
  const orchid = intInt
    ? `// Orchid: a deceptive flower. Bees that feed here get no nectar,
// but your patch still earns the visit.
function flower(challenge: number): number {
  if (challenge >= 0 && challenge < 100) return (challenge * 3 + 1) % 1000; // looks like our clover up close...
  return ((challenge % 1000) + 1000) % 1000;                                // ...but not from further away
}
`
    : `// Orchid: a deceptive flower. Bees that feed here get no nectar,
// but your patch still earns the visit.
${hash}
function flower(challenge: ${C}): ${R} {
  const h = hex("orchid" + JSON.stringify(challenge));
  return ${tsFromHex(rT)};
}
`;
  const bee = `// Bee: visits one flower at a time. Variables at the top level
// last for the whole round, so your bee can learn as it goes.
type Challenge = ${C};
type Seen = [Challenge, ${R} | null][];

const QUESTION: Challenge = ${q};
const tally = new Map<string, [number, number]>(); // answer to QUESTION -> [times fed, times got nectar]

function forage(seen: Seen, turnsLeft: number): ["ask", Challenge] | "feed" | "leave" {
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

export function starters(config) {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  return config.language === "typescript" ? typescript(cT, rT) : python(cT, rT);
}
