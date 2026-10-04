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
  const [a, b, salt, pct] = [2 * r(1, 48) + 1, r(1, 999), r(1000, 9999), r(10, 90)];
  const flower = intInt
    ? `# A flower: a fixed rule, and a fixed share of the energy for a bee that feeds.
def flower(challenge):
    return (challenge * ${a} + ${b}) % 1000, ${pct}
`
    : `# A flower: a fixed rule, and a fixed share of the energy for a bee that feeds.
import hashlib, json

def flower(challenge):
    h = hashlib.sha256(("flower${salt}" + json.dumps(challenge)).encode()).hexdigest()
    return ${pyFromHex(rT)}, ${pct}
`;
  const bee = `# A bee: always asks the same question, and feeds every other turn (it counts them in MEMORY).
QUESTION = ${q}

def first():
    return QUESTION

def decide(challenge, response):
    MEMORY["turns"] = MEMORY.get("turns", 0) + 1
    return ("feed" if MEMORY["turns"] % 2 else "leave"), QUESTION
`;
  return { flower, bee };
}

function typescript(cT, rT, r) {
  const C = tsType(cT), R = tsType(rT);
  const q = JSON.stringify(question(cT, r));
  const intInt = cT.kind === "int" && rT.kind === "int";
  const [a, b, salt, pct] = [2 * r(1, 48) + 1, r(1, 999), r(1000, 9999), r(10, 90)];
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
  const flower = intInt
    ? `// A flower: a fixed rule, and a fixed share of the energy for a bee that feeds.
function flower(challenge: number): [number, number] {
  return [(((challenge * ${a} + ${b}) % 1000) + 1000) % 1000, ${pct}];
}
`
    : `// A flower: a fixed rule, and a fixed share of the energy for a bee that feeds.
${hash}
function flower(challenge: ${C}): [${R}, number] {
  const h = hex("flower${salt}" + JSON.stringify(challenge));
  return [${tsFromHex(rT)}, ${pct}];
}
`;
  const bee = `// A bee: always asks the same question, and feeds every other turn (it counts them in MEMORY).
type Challenge = ${C};
const QUESTION: Challenge = ${q};

function first(): Challenge {
  return QUESTION;
}

function decide(challenge: Challenge, response: ${R} | null): ["feed" | "leave", Challenge] {
  MEMORY.turns = (MEMORY.turns ?? 0) + 1;
  return [MEMORY.turns % 2 ? "feed" : "leave", QUESTION];
}
`;
  return { flower, bee };
}

/** `seed` (e.g. the team id) varies the constants, so each team starts somewhere different. */
export function starters(config, seed = "") {
  const cT = parseType(config.challengeType), rT = parseType(config.responseType);
  const r = rng(seed);
  return config.language === "typescript" ? typescript(cT, rT, r) : python(cT, rT, r);
}
