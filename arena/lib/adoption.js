// Adoption and diffusion of the catalogue ideas (docs/research/asymmetric-graph-games.md) in the cohort experiment.
// Two detectors per team per round: keywords over code + notebook, and a cheap haiku classifier over the code
// ("which of these catalogue ideas does this code implement, if any?"). The classifier is only re-run when a team's
// programs changed since its last classified round.
import { all, one, q } from "./db.js";
import { BudgetError, callModel, extractJson } from "./llm.js";

export const CATALOGUE = [
  { id: "paley", name: "Paley clique hunt", desc: "clique of mutual 'friends' (differences that are squares mod a prime p ≥ n, p ≡ 1 mod 4)",
    kw: /paley|quadratic.?residue|legendre|is_?square|\(p\s*-\s*1\)\s*\/\/\s*2|\bcliques?\b/i },
  { id: "times-table", name: "Untangle the times table", desc: "dots on a circle joined i -> n·i mod N, redrawn with few crossings",
    kw: /times.?table|crossings?|untangl/i },
  { id: "graceful", name: "Graceful labelling of n's Prüfer tree", desc: "tree decoded from n's digits as a Prüfer code, labelled so edge differences are distinct",
    kw: /graceful|pr[uü]fer/i },
  { id: "golomb", name: "Golomb ruler with forbidden distances", desc: "marks with all pairwise distances distinct, distances banned by n's bits",
    kw: /golomb|\bruler\b|forbidden.?distance|banned.?distance/i },
  { id: "schur", name: "Schur colouring with n's equation", desc: "colour 1..L so no solution of n's equation (a·x+b·y=z) is one colour",
    kw: /schur|monochromatic|sum.?free/i },
  { id: "necklace", name: "Prime necklace", desc: "numbers n+1..n+N in a cycle, neighbours summing to primes",
    kw: /necklace|prime.?sums?/i },
  { id: "graded-score", name: "'How far can you get' graded certificate", desc: "answer quality is a score (size of largest valid object / longest valid prefix) that the bee measures",
    kw: /how far|largest valid|longest valid|valid prefix/i },
  { id: "certificate", name: "Certificate + cheap verifier", desc: "flower answers with a certificate for an n-derived instance; bee re-checks it cheaply",
    kw: /certificate|verifier|\bverif(y|ies|ication)\b/i },
];

// Engine v3 (experiments v3 and v3x): the example flowers' ideas plus the strategies the v3 rules invite. The
// second example's entry is filled in from arena/examples/v3/README.md once the examples are final.
export const V3_CATALOGUE = [
  { id: "paley", name: "Paley clique hunt (example 1)", desc: "graph whose edges join numbers whose difference is a quadratic residue mod a prime p (Legendre symbol, pow(d, (p-1)//2, p)), and a search for a big clique in it",
    kw: /paley|quadratic.?residue|legendre|pow\([^()]*,\s*\(\s*\w+\s*-\s*1\s*\)\s*\/\/\s*2\s*,\s*\w+\s*\)/i },
  { id: "example-2", name: "Second example flower", desc: "(filled in when the examples are final)", kw: /$^/ },
  { id: "anytime-search", name: "Anytime search within the budget", desc: "flower uses random and the clock (time, GAME['ms']) to keep improving an answer until its budget is nearly spent, then returns the best found",
    kw: /GAME\s*\[\s*["']ms["']\s*\][\s\S]*\btime\.|\btime\.[\s\S]*GAME\s*\[\s*["']ms["']\s*\]/ },
  { id: "checker", name: "Bee checks answer quality", desc: "bee verifies a property of the answer (validity and how good it is, e.g. clique size) instead of recognising the exact answer",
    kw: /\bcheck(er|s)?_?\w*\(|\bverif(y|ies|ier)\b|\bscore\w*\(/i },
  { id: "face", name: "Fingerprint by repeated question", desc: "bee asks the same challenge(s) and keys its verdict on the exact answer (the flower's face), remembering which faces paid",
    kw: /fingerprint|\bface\b|json\.dumps\(|hashlib\.(md5|sha\d+)\(.*(seen|resp|answer|r\b)/i },
  { id: "hash-key", name: "Secret hash-keyed answer", desc: "flower derives its answer from a secret salted hash of the challenge, so it is deterministic and unforgeable without the salt",
    kw: /hashlib\.(sha\d+|md5|blake2\w)\(/ },
  { id: "imitation", name: "Cheap imitation of a rival's signal", desc: "orchid reproduces another team's clover answers or their checkable property more cheaply",
    kw: /costume|imitat|copy|mimic|look.?alike/i },
];
const CATALOGUES = { gx: CATALOGUE, v3: V3_CATALOGUE, v3x: V3_CATALOGUE };
export const catalogueFor = (experiment) => CATALOGUES[experiment] || CATALOGUE;

export function keywordIdeas(text, catalogue = CATALOGUE) {
  return catalogue.filter((c) => c.kw.test(text || "")).map((c) => c.id);
}

const SYSTEM = `You classify code from a coding game. Flowers answer an integer challenge n with a labelled graph; bees ask
flowers questions and check answers. Decide which of these catalogue ideas each program actually IMPLEMENTS (not just
mentions in a comment). Reply with JSON only.`;

function classifierPrompt(progs, catalogue = CATALOGUE) {
  return `Catalogue ideas:\n${catalogue.map((c) => `- ${c.id}: ${c.name}: ${c.desc}`).join("\n")}\n\n` +
    ["clover", "orchid", "bee"].map((k) => `### ${k}\n\`\`\`python\n${(progs[k] || "").slice(0, 12000)}\n\`\`\``).join("\n") +
    `\n\nReply: {"clover": [ids], "orchid": [ids], "bee": [ids], "other": "<one line: the main idea if none of the catalogue applies>"}`;
}

/** Classify every round of a finished cohort game. view: full (revealed) view; teamToPersona: {teamId: personaId}. */
export async function classifyGame({ arena, gameRow, view, teamToPersona, log }) {
  const catalogue = catalogueFor(arena.settings?.cohort?.experiment);
  const prev = {};
  for (const r of view.rounds) {
    for (const [team, personaId] of Object.entries(teamToPersona)) {
      const progs = Object.fromEntries(["clover", "orchid", "bee"].map((k) => [k, r.programs[team]?.[k]?.code || ""]));
      const notes = (await one(`SELECT notes FROM arena.agent_turns WHERE game_id = $1 AND persona_id = $2 AND round_no <= $3 AND notes IS NOT NULL
                                ORDER BY round_no DESC, attempt DESC LIMIT 1`, [gameRow.id, personaId, r.no]))?.notes || "";
      const kw = { code: keywordIdeas(progs.clover + progs.orchid + progs.bee, catalogue), notes: keywordIdeas(notes, catalogue) };
      await q(`INSERT INTO arena.adoption (game_id, round_no, persona_id, method, ideas, detail) VALUES ($1,$2,$3,'keyword',$4,NULL)
               ON CONFLICT (game_id, round_no, persona_id, method) DO UPDATE SET ideas = $4`, [gameRow.id, r.no, personaId, JSON.stringify(kw)]);
      const key = JSON.stringify(progs);
      let res = prev[team]?.key === key ? prev[team].res : null;
      if (!res) {
        try {
          const out = await callModel({ model: "haiku", system: SYSTEM, prompt: classifierPrompt(progs, catalogue), effort: "low",
            ctx: { purpose: "classifier", arenaId: arena.id, gameId: gameRow.id, personaId } });
          res = extractJson(out.text) || { error: "no json" };
        } catch (e) { if (e instanceof BudgetError) throw e; res = { error: e.message }; }
        prev[team] = { key, res };
      }
      await q(`INSERT INTO arena.adoption (game_id, round_no, persona_id, method, ideas, detail) VALUES ($1,$2,$3,'llm',$4,$5)
               ON CONFLICT (game_id, round_no, persona_id, method) DO UPDATE SET ideas = $4, detail = $5`,
        [gameRow.id, r.no, personaId, JSON.stringify({ clover: res.clover || [], orchid: res.orchid || [], bee: res.bee || [] }), String(res.other || res.error || "").slice(0, 300)]);
    }
  }
  log(`  adoption classified for ${Object.keys(teamToPersona).length} teams x ${view.rounds.length} rounds`);
}
