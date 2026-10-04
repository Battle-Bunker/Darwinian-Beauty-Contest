// The live action stream of one arena game, as the runner keeps it for the teams.
//
//   <WS_ROOT>/<arena>/.shared/g<gen>/actions.jsonl   the PUBLIC stream: what GET .../actions shows anyone, fetched
//                                                   with no credentials, so it holds public fields only (arrivals,
//                                                   challenges, responses, feeds with their percent, energy, nectar
//                                                   and pollen). One JSON object per line,
//                                                   append-only, about once a second. Hard-linked into every workspace
//                                                   as stream/actions.jsonl, so it is never copied per team.
//   <WS_ROOT>/<arena>/.runner/g<gen>/actions.jsonl   the runner's private master copy. If a team damages the shared
//                                                   file through its link, it is rewritten in place from this one.
//   <workspace>/stream/history.jsonl                 per team: its HISTORY (GET .../ledger with its token): one turn record
//                                                   per finished turn, exactly what its programs see as HISTORY.turns: what
//                                                   everyone sees of every turn, plus its own private fields (percent and
//                                                   energy of unfed turns at its flower, its flower's compute time, its
//                                                   bee's decision times). tools/garden.py and tools/query.py run the
//                                                   same typed queries over it that the programs run.
//   <workspace>/stream/mine.jsonl                    per team: the actions of its own bee and at its own flower as that
//                                                   team sees them (GET .../actions?mine=1): with its bee's printouts,
//                                                   decision times, errors and versions.
// No team's file ever holds another team's private fields: the server decides what each request may see.
//
// Agents read these files with code at their own cadence (tools/query.py, tools/garden.py); nothing from the stream
// goes into a prompt except a few headline numbers (headline()).
import fs from "node:fs";
import path from "node:path";
import { Api } from "./api.js";

const BUCKET_MS = 5000;

/** The runner's samples of every bee's MEMORY size during a game (one JSON line each). */
export const memoryFile = (root, gen) => path.join(root, ".runner", `g${gen}`, "memory.jsonl");
export function readMemorySamples(root, gen) {
  try { return fs.readFileSync(memoryFile(root, gen), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** Append-only per-team file kept in step with a paged API (after=<seq>). */
class Tracked {
  constructor(file, fetch) {
    this.file = file;
    this.fetch = fetch;
    this.lastSeq = 0;
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8").trimEnd();
      const last = text.slice(text.lastIndexOf("\n") + 1);
      try { this.lastSeq = last ? JSON.parse(last).seq : 0; } catch { fs.writeFileSync(file, ""); }
    }
  }
  async poll(key) {
    for (;;) {
      const page = await this.fetch(this.lastSeq);
      this.meta = page;
      const rows = (page[key] || []).filter((a) => a.seq > this.lastSeq);
      if (!rows.length) return;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, rows.map((a) => JSON.stringify(a)).join("\n") + "\n");
      this.lastSeq = rows[rows.length - 1].seq;
      if ((page[key] || []).length < 5000) return;
    }
  }
}

export class GameStream {
  /**
   * root: <WS_ROOT>/<arena>; gen: game number; gPath: API path of the game; teams: [{id, name}] (participants).
   * fetchPage(after) defaults to the public API (no token); fetchMine(tok, after) and fetchLedger(tok, after) use a team's.
   */
  constructor({ root, gen, gPath, gameUuid, teams, fetchPage, fetchMine, fetchLedger, fetchView, memoryEveryMs = 5000, log = () => {} }) {
    this.sharedFile = path.join(root, ".shared", `g${gen}`, "actions.jsonl");
    this.masterFile = path.join(root, ".runner", `g${gen}`, "actions.jsonl");
    this.memoryFile = memoryFile(root, gen);
    this.gPath = gPath;
    this.gameUuid = gameUuid;
    this.teams = teams;
    this.fetchPage = fetchPage || ((after) => Api.actions(null, gPath, after, 5000));
    this.fetchMine = fetchMine || ((tok, after) => Api.actions(tok, gPath, after, 5000, { mine: true }));
    this.fetchLedger = fetchLedger || ((tok, after) => Api.ledger(tok, gPath, after, 5000));
    // A team's own view (its token): its bee's MEMORY, sampled for the metrics (the runner only reads it).
    this.fetchView = fetchView || ((tok) => Api.view(tok, gPath));
    this.memoryEveryMs = memoryEveryMs;
    this.lastMemoryAt = 0;
    this.log = log;
    this.lastSeq = 0;
    this.bytes = 0;
    this.clockMs = 0;
    this.status = null;
    this.buckets = new Map(); // bucket -> Map(key -> count)
    this.tracked = new Map(); // teamId -> { mine: Tracked, history: Tracked }
    this.participants = null; // team ids in ledger-index order, once the game has started
    this.timer = null;
    this.polling = null;
    for (const f of [this.sharedFile, this.masterFile]) fs.mkdirSync(path.dirname(f), { recursive: true });
  }

  /** Rebuild state from the master copy (after a restart), and make sure the shared copy matches it. */
  load() {
    if (fs.existsSync(this.masterFile)) {
      const text = fs.readFileSync(this.masterFile, "utf8");
      let end = text.lastIndexOf("\n") + 1; // ignore a torn last line
      for (const line of text.slice(0, end).split("\n")) {
        if (!line) continue;
        try { this.#count(JSON.parse(line)); } catch {}
      }
      if (end < text.length) fs.truncateSync(this.masterFile, Buffer.byteLength(text.slice(0, end)));
      this.bytes = Buffer.byteLength(text.slice(0, end));
    }
    this.#checkShared(true);
    return this;
  }

  /** Fetch everything new (page after page) and append it; then each team's own files. Returns the new public actions. */
  async poll() {
    if (this.polling) return this.polling;
    this.polling = (async () => {
      let n = 0;
      for (;;) {
        const page = await this.fetchPage(this.lastSeq);
        this.clockMs = Number(page.clockMs ?? this.clockMs);
        this.status = page.status ?? this.status;
        const fresh = (page.actions || []).filter((a) => a.seq > this.lastSeq);
        if (fresh.length) {
          const text = fresh.map((a) => JSON.stringify(a)).join("\n") + "\n";
          this.#checkShared();
          fs.appendFileSync(this.masterFile, text);
          fs.appendFileSync(this.sharedFile, text);
          this.bytes += Buffer.byteLength(text);
          for (const a of fresh) this.#count(a);
          n += fresh.length;
        }
        if ((page.actions || []).length < 5000) break;
      }
      for (const [teamId, t] of this.tracked) {
        await t.history.poll("entries").catch((e) => this.log(`stream: history.jsonl of ${teamId} not updated: ${e.message}`));
        await t.mine.poll("actions").catch((e) => this.log(`stream: mine.jsonl of ${teamId} not updated: ${e.message}`));
        const parts = t.history.meta?.participants;
        if (parts?.length && !this.participants) this.participants = parts;
        if (this.participants && t.indexed !== this.participants) { this.writeTeams(teamId, t.dir); t.indexed = this.participants; }
      }
      if (this.status === "running" && Date.now() - this.lastMemoryAt >= this.memoryEveryMs) {
        this.lastMemoryAt = Date.now();
        await this.sampleMemory().catch((e) => this.log(`stream: memory sample failed: ${e.message}`));
      }
      return n;
    })().finally(() => { this.polling = null; });
    return this.polling;
  }

  start(ms = 1000) {
    if (this.timer) return;
    const tick = () => this.poll().catch((e) => this.log(`stream poll failed: ${e.message}`)).finally(() => { if (this.timer) this.timer = setTimeout(tick, ms); });
    this.timer = setTimeout(tick, 0);
  }

  async stop() {
    clearTimeout(this.timer);
    this.timer = null;
    await this.polling;
  }

  /** The shared copy must be exactly the master (a team writing through its hard link would damage it for everyone). */
  #checkShared(force = false) {
    let st = null;
    try { st = fs.statSync(this.sharedFile); } catch {}
    if (!force && st && st.size === this.bytes) return;
    if (st && st.size !== this.bytes) this.log(`stream: the shared copy was ${st.size} bytes, expected ${this.bytes}: rewriting it from the master`);
    if (!fs.existsSync(this.masterFile)) fs.writeFileSync(this.masterFile, "");
    fs.copyFileSync(this.masterFile, this.sharedFile); // O_TRUNC on the same inode: every hard link sees it
  }

  /** Hard-link the shared copy into a workspace (relinks if the team removed or replaced its link). */
  linkInto(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).ino === fs.statSync(this.sharedFile).ino) return; } catch {}
    fs.rmSync(file, { force: true });
    try { fs.linkSync(this.sharedFile, file); }
    catch (e) { fs.copyFileSync(this.sharedFile, file); this.log(`stream: could not hard-link (${e.code}); copied instead (it won't update during the session)`); }
  }

  /** Keep a team's own files up to date: <sdir>/history.jsonl and <sdir>/mine.jsonl (tok: its login, which never
   * leaves the runner). */
  track(teamId, sdir, tok) {
    const cur = this.tracked.get(teamId);
    if (cur && cur.dir === sdir) { if (tok) cur.tok = tok; return; }
    const t = { dir: sdir, tok, indexed: null };
    fs.mkdirSync(sdir, { recursive: true });
    for (const f of ["history.jsonl", "mine.jsonl"]) if (!fs.existsSync(path.join(sdir, f))) fs.writeFileSync(path.join(sdir, f), ""); // there before the first turn
    t.history = new Tracked(path.join(sdir, "history.jsonl"), (after) => this.fetchLedger(t.tok, after));
    t.mine = new Tracked(path.join(sdir, "mine.jsonl"), (after) => this.fetchMine(t.tok, after));
    this.tracked.set(teamId, t);
  }

  /** One sample of every tracked team's bee MEMORY size (read with that team's token; nothing writes it but the bee),
   * appended to the runner's memory.jsonl: { clockMs, team, bytes, cap, version }. */
  async sampleMemory() {
    const rows = [];
    for (const [teamId, t] of this.tracked) {
      if (!t.tok) continue;
      const v = await this.fetchView(t.tok);
      const mem = (v.teams || []).find((x) => x.id === teamId)?.memory;
      if (mem) rows.push({ clockMs: Number(v.game?.clockMs) || this.clockMs, team: teamId, bytes: mem.bytes ?? null, cap: mem.cap ?? null, version: mem.version ?? null });
    }
    if (rows.length) fs.appendFileSync(this.memoryFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return rows.length;
  }

  /** <sdir>/teams.json: ids, names and, once the game has started, the ledger indices (participants are fixed then). A
   * workspace prepared in the lobby gets its indices here, so a scaffold started in the lobby learns them too. */
  writeTeams(teamId, sdir, participants = this.participants) {
    const name = Object.fromEntries(this.teams.map((t) => [t.id, t.name]));
    const data = { teams: name, me: teamId, participants: participants || null, names: participants ? participants.map((id) => name[id] ?? String(id).slice(0, 8)) : null,
      myIndex: participants ? participants.indexOf(teamId) : null };
    fs.mkdirSync(sdir, { recursive: true });
    const tmp = path.join(sdir, `.teams.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, path.join(sdir, "teams.json"));
  }

  #count(a) {
    this.lastSeq = Math.max(this.lastSeq, a.seq);
    const b = Math.floor(a.atMs / BUCKET_MS);
    let m = this.buckets.get(b);
    if (!m) this.buckets.set(b, (m = new Map()));
    const inc = (what) => { const k = `${a.bee}|${a.flower}|${what}`; m.set(k, (m.get(k) || 0) + 1); };
    inc(a.action); // arrive | feed | leave
    if (a.action !== "arrive" && ("r" in a) && a.r === null) inc("noResponse");
    if (a.action === "feed") { // public on a feed: what the bee got and what the flower kept
      const add = (what, v) => { if (typeof v === "number" && Number.isFinite(v)) { const k = `${a.bee}|${a.flower}|${what}`; m.set(k, (m.get(k) || 0) + v); } };
      add("nectar", a.nectar);
      add("pollen", a.pollen);
      add("percent", a.percent);
    }
  }

  /** Counts over [fromMs, toMs): { "<bee>|<flower>|<what>": n }. */
  counts(fromMs = 0, toMs = Infinity) {
    const out = new Map();
    for (const [b, m] of this.buckets) {
      if ((b + 1) * BUCKET_MS <= fromMs || b * BUCKET_MS >= toMs) continue;
      for (const [k, v] of m) out.set(k, (out.get(k) || 0) + v);
    }
    return out;
  }

  /** Compact public headline numbers for one team over a stretch of game time (for briefs: a few numbers, no events). */
  headline(teamId, fromMs = 0, toMs = Infinity) {
    const c = this.counts(fromMs, toMs);
    const h = { turns: 0, bee: { turns: 0, feeds: 0, ownFeeds: 0, nectar: 0, flowers: new Set() }, flower: { turns: 0, feeds: 0, ownFeeds: 0, noResponse: 0, pollen: 0, nectarPaid: 0, percentSum: 0, bees: new Set() } };
    for (const [k, n] of c) {
      const [bee, flower, what] = k.split("|");
      const ended = what === "feed" || what === "leave";
      if (ended) h.turns += n;
      if (bee === teamId) {
        if (ended) h.bee.turns += n;
        if (what === "feed") { h.bee.feeds += n; h.bee.flowers.add(flower); if (flower === teamId) h.bee.ownFeeds += n; }
        if (what === "nectar") h.bee.nectar += n;
      }
      if (flower === teamId) {
        if (ended) h.flower.turns += n;
        if (what === "noResponse") h.flower.noResponse += n;
        if (what === "feed") { h.flower.feeds += n; h.flower.bees.add(bee); if (bee === teamId) h.flower.ownFeeds += n; }
        if (what === "pollen") h.flower.pollen += n;
        if (what === "nectar") h.flower.nectarPaid += n;
        if (what === "percent") h.flower.percentSum += n;
      }
    }
    h.bee.flowers = h.bee.flowers.size;
    h.flower.bees = h.flower.bees.size;
    h.flower.meanPercentFed = h.flower.feeds ? h.flower.percentSum / h.flower.feeds : null;
    delete h.flower.percentSum;
    return h;
  }
}
