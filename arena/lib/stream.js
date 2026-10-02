// The live action stream of one arena game, as the runner keeps it for the teams.
//
//   <WS_ROOT>/<arena>/.shared/g<gen>/actions.jsonl   the PUBLIC stream (what GET .../actions shows anyone, no
//                                                   credentials): one JSON object per line, append-only, kept up to
//                                                   date about once a second. Hard-linked into every workspace as
//                                                   stream/actions.jsonl, so it is never copied per team.
//   <WS_ROOT>/<arena>/.runner/g<gen>/actions.jsonl   the runner's private master copy. If a team damages the shared
//                                                   file through its link, it is rewritten in place from this one.
//   <workspace>/stream/mine.jsonl                    per team: the actions of its own bee and at its own patch as that
//                                                   team sees them (GET .../actions?mine=1 with its token): with what
//                                                   only it sees during play (its programs' timings and versions, its
//                                                   bee's printouts). The server decides what that is.
//
// Agents read these files with code at their own cadence (tools/stream.py); nothing from the stream goes into a
// prompt except a few headline numbers (headline()).
import fs from "node:fs";
import path from "node:path";
import { Api } from "./api.js";

const BUCKET_MS = 5000;

export class GameStream {
  /**
   * root: <WS_ROOT>/<arena>; gen: game number; gPath: API path of the game; gameUuid: the game's id (for mine.jsonl);
   * teams: [{id, name}] (participants). fetchPage(after) defaults to the public API (no token).
   */
  constructor({ root, gen, gPath, gameUuid, teams, fetchPage, fetchMine, log = () => {} }) {
    this.sharedFile = path.join(root, ".shared", `g${gen}`, "actions.jsonl");
    this.masterFile = path.join(root, ".runner", `g${gen}`, "actions.jsonl");
    this.gPath = gPath;
    this.gameUuid = gameUuid;
    this.teams = teams;
    this.fetchPage = fetchPage || ((after) => Api.actions(null, gPath, after, 5000));
    this.fetchMine = fetchMine || ((tok, after) => Api.actions(tok, gPath, after, 5000, { mine: true }));
    this.log = log;
    this.lastSeq = 0;
    this.bytes = 0;
    this.clockMs = 0;
    this.status = null;
    this.buckets = new Map(); // bucket -> Map(key -> count)
    this.lastVisit = new Map(); // bee -> last visit number seen
    this.mine = new Map(); // teamId -> { file, lastSeq }
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

  /** Fetch everything new (page after page) and append it. Returns the number of new actions. */
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
      await this.#pollMine().catch((e) => this.log(`stream: mine.jsonl update failed: ${e.message}`));
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
    if (st && st.size === this.bytes && !force) return;
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

  /** Keep <workspace>/stream/mine.jsonl up to date for a team (tok: its login, which never leaves the runner). */
  trackMine(teamId, file, tok) {
    const cur = this.mine.get(teamId);
    if (cur && cur.file === file) { cur.tok = tok || cur.tok; return; }
    let lastSeq = 0;
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8").trimEnd();
      const last = text.slice(text.lastIndexOf("\n") + 1);
      try { lastSeq = last ? JSON.parse(last).seq : 0; } catch { fs.writeFileSync(file, ""); }
    }
    this.mine.set(teamId, { file, lastSeq, tok });
  }

  async #pollMine() {
    for (const [, m] of this.mine) {
      if (!m.tok) continue;
      for (;;) {
        const page = await this.fetchMine(m.tok, m.lastSeq);
        const rows = (page.actions || []).filter((a) => a.seq > m.lastSeq);
        if (!rows.length) break;
        fs.mkdirSync(path.dirname(m.file), { recursive: true });
        fs.appendFileSync(m.file, rows.map((a) => JSON.stringify(a)).join("\n") + "\n");
        m.lastSeq = rows[rows.length - 1].seq;
        if ((page.actions || []).length < 5000) break;
      }
    }
  }

  #count(a) {
    this.lastSeq = Math.max(this.lastSeq, a.seq);
    const b = Math.floor(a.atMs / BUCKET_MS);
    let m = this.buckets.get(b);
    if (!m) this.buckets.set(b, (m = new Map()));
    const inc = (what) => { const k = `${a.bee}|${a.patch}|${a.kind ?? "?"}|${what}`; m.set(k, (m.get(k) || 0) + 1); };
    if (this.lastVisit.get(a.bee) !== a.visit) { this.lastVisit.set(a.bee, a.visit); inc("visit"); }
    inc(a.action);
    if (a.action === "feed" && a.nectar) inc("nectar");
    if (a.error && a.by === "flower") inc("flowerError");
  }

  /** Counts over [fromMs, toMs): { "<bee>|<patch>|<kind>|<what>": n }. */
  counts(fromMs = 0, toMs = Infinity) {
    const out = new Map();
    for (const [b, m] of this.buckets) {
      if ((b + 1) * BUCKET_MS <= fromMs || b * BUCKET_MS >= toMs) continue;
      for (const [k, v] of m) out.set(k, (out.get(k) || 0) + v);
    }
    return out;
  }

  /** Compact headline numbers for one team over a stretch of game time (for briefs: a few numbers, no events). */
  headline(teamId, fromMs = 0, toMs = Infinity) {
    const c = this.counts(fromMs, toMs);
    const h = { actions: 0, bee: { visits: 0, asks: 0, feeds: 0, nectar: 0, errors: 0, rivalFeeds: 0, rivalNectar: 0 }, patch: { visits: 0, feeds: 0, bees: new Set() },
      cosmos: { feeds: 0, bees: new Set() }, orchid: { feeds: 0, bees: new Set() } };
    for (const [k, n] of c) {
      const [bee, patch, kind, what] = k.split("|");
      if (["ask", "feed", "leave", "error"].includes(what)) h.actions += n;
      if (bee === teamId) {
        if (what === "visit") h.bee.visits += n;
        if (what === "ask") h.bee.asks += n;
        if (what === "feed") { h.bee.feeds += n; if (patch !== teamId) h.bee.rivalFeeds += n; }
        if (what === "nectar") { h.bee.nectar += n; if (patch !== teamId) h.bee.rivalNectar += n; }
        if (what === "error") h.bee.errors += n;
      }
      if (patch === teamId) {
        if (what === "visit") h.patch.visits += n;
        if (what === "feed") { h.patch.feeds += n; h.patch.bees.add(bee); if (h[kind]) { h[kind].feeds += n; h[kind].bees.add(bee); } }
      }
    }
    for (const x of [h.patch, h.cosmos, h.orchid]) x.bees = x.bees.size;
    return h;
  }
}
