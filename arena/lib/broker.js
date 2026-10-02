// The runner's side of the workspace tools (tools/_runner.py): requests arrive as JSON files in
// <workspace>/.runner/req/, are handled one at a time (in arrival order), and the answer is written to
// <workspace>/.runner/res/<id>.json. The handler does whatever needs the team's login; the token never
// leaves this process. A broker runs only while one of the team's sessions does.
import fs from "node:fs";
import path from "node:path";

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", data);
  fs.renameSync(file + ".tmp", file);
};

export class Broker {
  /** handle(req) -> result object (must not throw; errors become {ok: false, error}). */
  constructor({ dir, handle, pollMs = 150, log = () => {} }) {
    this.req = path.join(dir, ".runner", "req");
    this.res = path.join(dir, ".runner", "res");
    this.handle = handle;
    this.pollMs = pollMs;
    this.log = log;
    this.timer = null;
    this.busy = null;
    this.stopped = false;
    this.count = 0;
  }

  /** Clear old requests and answers, then start listening. */
  start() {
    fs.rmSync(path.join(this.req, ".."), { recursive: true, force: true });
    fs.mkdirSync(this.req, { recursive: true });
    fs.mkdirSync(this.res, { recursive: true });
    const tick = async () => {
      if (this.stopped) return;
      this.busy = this.#drain().catch((e) => this.log(`broker: ${e.stack || e.message}`));
      await this.busy;
      if (!this.stopped) this.timer = setTimeout(tick, this.pollMs);
    };
    this.timer = setTimeout(tick, 0);
    return this;
  }

  /** Stop listening (after the request in hand). Requests that arrive later get no answer. */
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.busy;
  }

  async #drain() {
    let names;
    try { names = fs.readdirSync(this.req).filter((f) => f.endsWith(".json")).sort(); } catch { return; }
    for (const name of names) {
      if (this.stopped) return;
      const file = path.join(this.req, name);
      const taken = file.replace(/\.json$/, ".taken");
      try { fs.renameSync(file, taken); } catch { continue; }
      let req, out;
      try { req = JSON.parse(fs.readFileSync(taken, "utf8")); }
      catch (e) { req = { id: name.replace(/\.json$/, ""), op: "?" }; out = { ok: false, error: `unreadable request: ${e.message}` }; }
      const id = String(req.id || name.replace(/\.json$/, "")).replace(/[^\w.-]/g, "");
      if (!out) {
        try { out = await this.handle(req); }
        catch (e) { out = { ok: false, error: e.message, text: `error: ${e.message}` }; }
      }
      this.count++;
      write(path.join(this.res, id + ".json"), JSON.stringify(out));
      fs.rmSync(taken, { force: true });
    }
  }
}
