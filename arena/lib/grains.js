// Pollen grains in a finished game (RULES.md "Pollen carries genes"): on every feed, the feeding bee's team got a run
// of floor(pollen^(1/3)) characters of the answering flower version's minified code, from a random start, wrapping. Pure
// computation over the game's turns (with their grains, all revealed once the game is over) and the programs' minified
// code (lib/metrics.js computes it with the game's own minifier):
//   perSpecies  per flower species: grains given, characters, characters per minute to other teams' bees (the leak
//               rate), and to how many teams
//   versions    per flower version: its code length, the grains of it, and how much of it other teams held: the best
//               single team's share and all of them together at the end, and when either first covered all of it
//               (from the time the version went live)
//   uses        whether teams acted on leaked code: a later version of theirs (flower or bee) that contains a secret of
//               the leaked code (a string of 6+ characters or a number of 6+ digits) they hadn't used before, or runs
//               of 24+ characters of the leaked code they held then (a copy; "whole-version" when it is identical and they
//               held all of it)
// A grain is placed where it first occurs in the (wrapped) code: a short grain that occurs twice may be misplaced.

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
export const COPY_RUN = 24; // characters of leaked code in a row that count as a copy
const SECRET = /"((?:\\.|[^"\\\n]){6,})"|'((?:\\.|[^'\\\n]){6,})'|`([^`]{6,})`|(?<![\w.])(\d{6,})(?![\w.])/g;

/** Where a grain lies in a wrapped code: its first start, or -1. */
export function locate(grain, code) {
  if (!grain || !code) return -1;
  if (grain.length >= code.length) return 0;
  return (code + code.slice(0, grain.length - 1)).indexOf(grain);
}

/** The secrets of a code: its long literals, with where they are ([{ text, at, end }]). */
export function secretsOf(code) {
  const out = [];
  for (const m of String(code || "").matchAll(SECRET)) {
    const text = m[1] ?? m[2] ?? m[3] ?? m[4];
    const at = m.index + m[0].indexOf(text);
    out.push({ text, at, end: at + text.length });
  }
  return out;
}

/** Coverage of one code (a set of positions) by grains, growing in time. */
class Cover {
  constructor(length) { this.length = length; this.bits = new Uint8Array(length); this.n = 0; }
  add(start, len) {
    if (start < 0) return;
    for (let i = 0; i < Math.min(len, this.length); i++) { const p = (start + i) % this.length; if (!this.bits[p]) { this.bits[p] = 1; this.n++; } }
  }
  has(from, to) { for (let p = from; p < to; p++) if (!this.bits[p % this.length]) return false; return true; }
  get full() { return this.n >= this.length; }
}

const kgrams = (text, k = COPY_RUN) => { const s = new Set(); for (let i = 0; i + k <= text.length; i++) s.add(text.slice(i, i + k)); return s; };

/**
 * turns: [{ atMs, bee, flower (team ids), action, grain, grainVersion, grainCodeLength }] in game order; ids: team ids;
 * name: id -> name; minified: Map(`${team}:${kind}:${version}` -> minified code); liveAt: Map(`${team}:${kind}:${version}`
 * -> atMs); durationMs.
 */
export function grainMetrics({ turns, ids, name = {}, minified, liveAt, durationMs, grains: setting = "feeder" }) {
  const nm = (id) => name[id] ?? id;
  const fed = turns.filter((t) => t.action === "feed" && t.grain);
  const minutes = durationMs > 0 ? durationMs / 60000 : null;
  const perSpecies = ids.map((id) => {
    const gs = fed.filter((t) => t.flower === id), others = gs.filter((t) => t.bee !== id);
    const chars = others.reduce((a, t) => a + t.grain.length, 0);
    return { team: nm(id), teamId: id, grains: gs.length, toOthers: others.length, receivers: new Set(others.map((t) => t.bee)).size,
      characters: gs.reduce((a, t) => a + t.grain.length, 0), charactersToOthers: chars, perMinute: r3(minutes ? chars / minutes : null) };
  });

  // Coverage per flower version: by each receiving team (not the species' own), and by all of them together.
  const versions = [], held = new Map(); // `${receiver}|${team}:${version}` -> Cover
  const keys = [...new Set(fed.map((t) => `${t.flower}:${t.grainVersion}`))];
  for (const k of keys) {
    const [team, version] = [k.slice(0, k.lastIndexOf(":")), Number(k.slice(k.lastIndexOf(":") + 1))];
    const code = minified.get(`${team}:flower:${version}`);
    const gs = fed.filter((t) => t.flower === team && t.grainVersion === version);
    const length = code?.length ?? gs[0]?.grainCodeLength ?? null;
    const live = liveAt.get(`${team}:flower:${version}`) ?? 0;
    const row = { team: nm(team), teamId: team, version, codeLength: length, grains: gs.length, toOthers: gs.filter((t) => t.bee !== team).length,
      placed: 0, unionShare: null, bestShare: null, bestTeam: null, fullByTeamMs: null, fullByTeam: null, fullUnionMs: null };
    if (code) {
      const union = new Cover(code.length);
      for (const t of gs) {
        const at = locate(t.grain, code);
        if (at >= 0) row.placed++;
        if (t.bee === team) continue;
        const hk = `${t.bee}|${k}`;
        if (!held.has(hk)) held.set(hk, new Cover(code.length));
        const c = held.get(hk);
        c.add(at, t.grain.length);
        union.add(at, t.grain.length);
        if (c.full && row.fullByTeamMs == null) { row.fullByTeamMs = t.atMs - live; row.fullByTeam = nm(t.bee); }
        if (union.full && row.fullUnionMs == null) row.fullUnionMs = t.atMs - live;
      }
      row.unionShare = r3(union.n / code.length);
      let best = null;
      for (const [hk, c] of held) if (hk.endsWith(`|${k}`) && (!best || c.n > best.n)) best = { n: c.n, team: hk.split("|")[0] };
      row.bestShare = best ? r3(best.n / code.length) : 0;
      row.bestTeam = best ? nm(best.team) : null;
    }
    versions.push(row);
  }
  versions.sort((a, b) => String(a.team).localeCompare(String(b.team)) || a.version - b.version);

  // Acting on leaked code: each team's later versions against what it held then.
  const uses = [];
  const codeOf = (team, kind, v) => minified.get(`${team}:${kind}:${v}`);
  const versionsOf = (team) => [...minified.keys()].filter((k) => k.startsWith(`${team}:`)).map((k) => { const [, kind, v] = k.slice(team.length).split(":"); return { kind, version: Number(v), atMs: liveAt.get(k) ?? 0, code: minified.get(k) }; })
    .sort((a, b) => a.atMs - b.atMs || a.version - b.version);
  for (const T of ids) {
    const mine = versionsOf(T);
    // What T received, per source version, in time order: the moments its coverage grew.
    const sources = keys.filter((k) => !k.startsWith(`${T}:`)).map((k) => {
      const [team, version] = [k.slice(0, k.lastIndexOf(":")), Number(k.slice(k.lastIndexOf(":") + 1))];
      return { k, team, version, code: codeOf(team, "flower", version), gs: fed.filter((t) => t.bee === T && t.flower === team && t.grainVersion === version) };
    }).filter((s) => s.code && s.gs.length);
    for (const src of sources) {
      const cover = new Cover(src.code.length);
      const secrets = secretsOf(src.code).map((x) => ({ ...x, leakedAt: null }));
      let gi = 0;
      const heldAt = (atMs) => { // T's coverage of src up to atMs (grains are in time order)
        while (gi < src.gs.length && src.gs[gi].atMs <= atMs) {
          const t = src.gs[gi++];
          cover.add(locate(t.grain, src.code), t.grain.length);
          for (const x of secrets) if (x.leakedAt == null && cover.has(x.at, x.end)) x.leakedAt = t.atMs;
        }
      };
      for (let i = 0; i < mine.length; i++) {
        const v = mine[i];
        if (!(v.atMs > 0) || !v.code) continue; // lobby versions came before any grain
        heldAt(v.atMs);
        if (!cover.n) continue;
        const before = mine.slice(0, i).map((x) => x.code || "").join("\n");
        for (const x of secrets) {
          if (x.leakedAt == null || x.leakedAt > v.atMs || x.used) continue;
          if (v.code.includes(x.text) && !before.includes(x.text)) {
            x.used = true;
            uses.push({ type: "secret", team: nm(T), teamId: T, kind: v.kind, version: v.version, from: nm(src.team), fromId: src.team, fromVersion: src.version,
              secret: x.text.length > 16 ? x.text.slice(0, 12) + "…" : x.text, leakedAtMs: x.leakedAt, usedAtMs: v.atMs, lagMs: v.atMs - x.leakedAt });
          }
        }
        // Runs of leaked code new in this version.
        const leaked = new Set();
        const wrapped = src.code + src.code.slice(0, COPY_RUN - 1);
        for (let p = 0; p < src.code.length; p++) if (cover.has(p, p + COPY_RUN)) leaked.add(wrapped.slice(p, p + COPY_RUN));
        if (!leaked.size) continue;
        const old = kgrams(before);
        let copied = 0, last = -1;
        for (let p = 0; p + COPY_RUN <= v.code.length; p++) {
          const g = v.code.slice(p, p + COPY_RUN);
          if (leaked.has(g) && !old.has(g)) { copied += Math.min(COPY_RUN, p + COPY_RUN - Math.max(p, last)); last = p + COPY_RUN; }
        }
        if (copied >= COPY_RUN) {
          const firstHeld = src.gs[0].atMs;
          uses.push({ type: v.code === src.code && cover.full ? "whole-version" : "copy", team: nm(T), teamId: T, kind: v.kind, version: v.version, from: nm(src.team), fromId: src.team,
            fromVersion: src.version, characters: copied, share: r3(copied / v.code.length), usedAtMs: v.atMs, lagMs: v.atMs - firstHeld });
        }
      }
    }
  }
  uses.sort((a, b) => a.usedAtMs - b.usedAtMs);

  const covered = versions.filter((v) => v.fullByTeamMs != null);
  const toOthers = perSpecies.reduce((a, s) => a + s.charactersToOthers, 0);
  return {
    setting, grains: fed.length, characters: fed.reduce((a, t) => a + t.grain.length, 0), charactersToOthers: toOthers, perMinute: r3(minutes ? toOthers / minutes : null),
    meanLength: r3(fed.length ? fed.reduce((a, t) => a + t.grain.length, 0) / fed.length : null),
    versionsWithGrains: versions.length, versionsFullyHeld: covered.length, medianMsToFullyHeld: median(covered.map((v) => v.fullByTeamMs)),
    versionsFullyLeaked: versions.filter((v) => v.fullUnionMs != null).length, medianMsToFullyLeaked: median(versions.filter((v) => v.fullUnionMs != null).map((v) => v.fullUnionMs)),
    secretUses: uses.filter((u) => u.type === "secret").length, copies: uses.filter((u) => u.type !== "secret").length,
    wholeVersions: uses.filter((u) => u.type === "whole-version").length,
    perSpecies, versions, uses,
  };
}
