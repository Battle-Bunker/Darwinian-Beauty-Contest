// Turns the viewer-filtered game view (GET base as a team member) into compact text for a team agent:
// scoreboard, public ledgers, and private bee/flower logs (last rounds in detail, older rounds summarised).

export const fmt = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? "null" : s.length > 80 ? s.slice(0, 77) + "..." : s;
};
const num = (x, d = 2) => (x == null ? "-" : Number(x).toFixed(d));

export function teamNames(view) {
  return Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
}

/** Short labels T1..Tn in participants order (for matrices). */
export function labels(view) {
  const ids = view.participants || view.teams.map((t) => t.id);
  return Object.fromEntries(ids.map((id, i) => [id, `T${i + 1}`]));
}

export function scoreboard(view, myId) {
  if (!view.rounds.length) return "No rounds played yet.";
  const names = teamNames(view);
  const last = view.rounds[view.rounds.length - 1];
  const rows = [...last.totals].sort((a, b) => b.fitness - a.fitness);
  const out = ["rank | team | fitness | allure (share) | forage (share) | feeds received from #bees | nectar collected from #patches | feeds given | per-round fitness"];
  rows.forEach((s, i) => {
    const per = view.rounds.map((r) => num(r.scores.find((x) => x.teamId === s.teamId)?.fitness)).join(", ");
    out.push(`${i + 1} | ${names[s.teamId]}${s.teamId === myId ? " (YOU)" : ""} | ${num(s.fitness)} | ${num(s.allure)} (${num(s.allureShare)}) | ${num(s.forage)} (${num(s.forageShare)}) | ${s.feedsReceived} from ${s.pollinators} | ${s.nectarCollected} from ${s.nectarSources} | ${s.feedsGiven} | ${per}`);
  });
  return out.join("\n");
}

export function ledgers(view, round) {
  const ids = view.participants;
  const L = labels(view);
  const head = "bee\\patch " + ids.map((id) => L[id].padStart(4)).join("");
  const mat = (m) => [head, ...m.map((row, i) => `${L[ids[i]].padEnd(9)} ${row.map((x) => String(x).padStart(4)).join("")}`)].join("\n");
  return `Feeds (row = bee team, column = patch team):\n${mat(round.feeds)}\nNectar:\n${mat(round.nectar)}`;
}

export function legend(view, myId) {
  const L = labels(view), names = teamNames(view);
  return (view.participants || []).map((id) => `${L[id]} = ${names[id]}${id === myId ? " (YOU)" : ""}`).join(", ");
}

function stepsText(steps, maxSteps = 8) {
  if (!steps) return "";
  const shown = steps.slice(0, maxSteps).map((s) => `${fmt(s.c)}→${s.r === null || s.r === undefined ? "None" : fmt(s.r)}${s.challengeError ? "(bad challenge)" : ""}${s.flowerError ? "(flower error)" : ""}`);
  if (steps.length > maxSteps) shown.push(`…+${steps.length - maxSteps} more asks`);
  return shown.join(", ");
}

function outcome(v) {
  if (v.action === "feed") return v.nectar ? "FEED → nectar!" : "FEED → nothing (orchid)";
  if (v.action === "error") return `ERROR${v.beeError ? ": " + v.beeError.slice(0, 160) : ""}`;
  return v.note ? `leave (${v.note})` : "leave";
}

/** Group visits by a key and render "text ×count (#seq,…)" lines, in order of first appearance. */
function grouped(items, keyOf, seqOf) {
  const groups = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(seqOf(it));
  }
  return [...groups.entries()].map(([k, seqs]) => seqs.length === 1 ? `${k} (#${seqs[0]})`
    : `${k} ×${seqs.length} (#${seqs.slice(0, 6).join(",")}${seqs.length > 6 ? ",…" : ""})`);
}

/** Own bee's visits in one round, grouped by patch; identical visits are collapsed with a count. */
export function beeLog(view, round, myId, { maxLines = 110 } = {}) {
  const names = teamNames(view);
  const mine = round.visits.filter((v) => v.bee === myId).sort((a, b) => a.seq - b.seq);
  const feeds = mine.filter((v) => v.action === "feed").length, nectar = mine.filter((v) => v.nectar).length;
  const errs = mine.filter((v) => v.action === "error").length;
  const head = `Your bee: ${mine.length} visits, ${feeds} feeds, ${nectar} nectar, ${errs} errors, turns used ${mine.length ? mine[mine.length - 1].end : 0}. ` +
    `Grouped by patch; "×n (#a,#b)" = n identical visits, with visit numbers in order.`;
  const lines = [];
  const patches = [...new Set(mine.map((v) => v.patch))];
  for (const p of patches) {
    const vs = mine.filter((v) => v.patch === p);
    lines.push(`- at ${names[p]}${p === myId ? " (own patch)" : ""}: ${vs.length} visits`);
    for (const g of grouped(vs, (v) => `    ${stepsText(v.steps)} ⇒ ${outcome(v)}${v.beeLog ? ` [print: ${v.beeLog.slice(0, 100).replace(/\n/g, " | ")}]` : ""}`, (v) => v.seq + 1)) lines.push(g);
  }
  return [head, ...clip(lines, maxLines)].join("\n");
}

/** Visits to own patch in one round, grouped by bee team and flower; identical visits collapsed. */
export function flowerLog(view, round, myId, { maxLines = 110 } = {}) {
  const names = teamNames(view);
  const flowerLogs = view.game.config.flowerLogs;
  const mine = round.visits.filter((v) => v.patch === myId);
  const by = {};
  for (const v of mine) {
    const k = `${v.kind}`;
    (by[k] ||= { visits: 0, feeds: 0, bees: new Set() });
    by[k].visits++;
    if (v.action === "feed") { by[k].feeds++; by[k].bees.add(names[v.bee]); }
  }
  const head = `Your patch: ${mine.length} visits. ` + ["clover", "orchid"].map((k) => `${k}: ${by[k]?.visits ?? 0} visits, ${by[k]?.feeds ?? 0} feeds${by[k]?.bees.size ? ` (from ${[...by[k].bees].join(", ")})` : ""}`).join("; ") + "." +
    (flowerLogs ? "" : " (Flower logs are OFF in this game: you see who visited which flower and the outcome, not the challenges.)");
  const lines = [];
  for (const b of [...new Set(mine.map((v) => v.bee))]) {
    for (const kind of ["clover", "orchid"]) {
      const vs = mine.filter((v) => v.bee === b && v.kind === kind);
      if (!vs.length) continue;
      lines.push(`- ${names[b]}${b === myId ? " (your own bee)" : ""} at your ${kind}: ${vs.length} visits, ${vs.filter((v) => v.action === "feed").length} fed`);
      for (const g of grouped(vs, (v) => `    ${flowerLogs || v.bee === myId ? stepsText(v.steps) : `${v.asks} asks`} ⇒ ${v.action === "feed" ? "FED" : v.action === "error" ? "bee error" : "left"}${v.flowerError ? ` [YOUR FLOWER ERRORED: ${v.flowerError.slice(0, 140)}]` : ""}`, (v) => v.seq + 1)) lines.push(g);
    }
  }
  return [head, ...clip(lines, maxLines)].join("\n");
}

function clip(lines, max) {
  if (lines.length <= max) return lines;
  const keepHead = Math.ceil(max * 0.6), keepTail = max - keepHead;
  return [...lines.slice(0, keepHead), `… (${lines.length - max} lines omitted) …`, ...lines.slice(-keepTail)];
}

/** One-paragraph summary of an older round, from this team's point of view. */
export function roundSummary(view, round, myId) {
  const names = teamNames(view);
  const bee = round.visits.filter((v) => v.bee === myId);
  const perPatch = {};
  for (const v of bee) {
    const p = (perPatch[names[v.patch]] ||= { visits: 0, feeds: 0, nectar: 0, firsts: {} });
    p.visits++;
    if (v.action === "feed") p.feeds++;
    if (v.nectar) p.nectar++;
    if (v.steps?.length) { const k = `${fmt(v.steps[0].c)}→${fmt(v.steps[0].r)}`; p.firsts[k] = (p.firsts[k] || 0) + 1; }
  }
  const beeTxt = Object.entries(perPatch).map(([n, p]) => {
    const top = Object.entries(p.firsts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => `${k}×${c}`).join(" ");
    return `${n}: ${p.visits} visits, ${p.feeds} feeds, ${p.nectar} nectar${top ? ` [first answers: ${top}]` : ""}`;
  }).join("; ");
  const patch = round.visits.filter((v) => v.patch === myId);
  const perBee = {};
  for (const v of patch) {
    const b = (perBee[names[v.bee]] ||= { clover: [0, 0], orchid: [0, 0] });
    b[v.kind][0]++;
    if (v.action === "feed") b[v.kind][1]++;
  }
  const flTxt = Object.entries(perBee).map(([n, b]) => `${n}: clover ${b.clover[1]}/${b.clover[0]} fed, orchid ${b.orchid[1]}/${b.orchid[0]} fed`).join("; ");
  return `Round ${round.no} summary. Your bee by patch: ${beeTxt || "no visits"}.\nBees at your patch (fed/visits): ${flTxt || "none"}.`;
}

/** Problems with this team's programs in a round (load errors, crashes). */
export function problems(round, myId) {
  const p = round.programs?.[myId];
  if (!p) return "";
  const out = [];
  for (const k of ["clover", "orchid", "bee"]) if (p[k]?.problem) out.push(`${k}: ${p[k].problem}`);
  return out.length ? `PROBLEMS with your programs in round ${round.no}: ${out.join(" | ")}` : "";
}

/** The full private-log section for the next round's prompt. */
export function privateLogs(view, myId, { detailRounds = 2 } = {}) {
  const rounds = view.rounds;
  if (!rounds.length) return "";
  const out = [];
  rounds.forEach((r, i) => {
    const age = rounds.length - 1 - i; // 0 = latest
    if (age < detailRounds) {
      const max = age === 0 ? 110 : 60;
      out.push(`## Round ${r.no} (detailed)`);
      const pr = problems(r, myId);
      if (pr) out.push(pr);
      out.push(beeLog(view, r, myId, { maxLines: max }));
      out.push(flowerLog(view, r, myId, { maxLines: max }));
    } else {
      out.push(`## Round ${r.no} (summary)`);
      out.push(roundSummary(view, r, myId));
    }
  });
  return out.join("\n\n");
}
