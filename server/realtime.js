// Live updates over Postgres LISTEN/NOTIFY, so any number of server processes stay in sync. One LISTEN
// connection per process fans notifications out on `bus`:
//   {game, room, version}   something public about the game changed (teams, status): refetch the view
//   {game, team, programs}  one team's programs changed (a submission, or a program hit a problem):
//                           only that team's viewers are told, so nobody else learns of the change
//   {game, seq, clockMs}    the garden wrote actions up to seq (live.js, a few times a second)
import { EventEmitter } from "node:events";
import pg from "pg";
import { env } from "./config.js";

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export async function startListening() {
  const connect = async () => {
    const client = new pg.Client({ connectionString: env.databaseUrl });
    client.on("notification", (msg) => {
      try { bus.emit("change", JSON.parse(msg.payload)); } catch {}
    });
    client.on("error", (e) => {
      console.error("realtime listener lost:", e.message);
      setTimeout(() => connect().catch(() => {}), 2000);
    });
    await client.connect();
    await client.query("LISTEN dbc");
  };
  await connect();
}

/** SSE stream of game-list changes ({game, version}) for a room. */
export function roomStream(req, res, roomId) {
  const send = open(req, res, () => bus.off("change", onChange));
  const onChange = (c) => { if (c.room === roomId && c.version !== undefined) send(c); };
  bus.on("change", onChange);
  send({ room: roomId });
}

/**
 * What one viewer hears about one game, whatever carries it (SSE or WebSocket): {version} whenever the
 * view should be refetched, {programs: true} when the viewer's own team's programs changed, and
 * {actions, lastSeq, clockMs, round, status} as the garden writes them, starting after `after` (without
 * actions when there's nothing new), with `prevalence` (a species prevalence sample, games.js sampleView)
 * whenever there is a new one. fetchActions(after) returns the viewer's filtered page of actions
 * after a seq. send(message) delivers one message; isOpen() says whether anyone is still listening.
 * Returns stop(), which unsubscribes.
 */
export function gameFeed({ gameId, teamId, version, after, fetchActions, send, isOpen }) {
  let last = after, busy = false, again = false, sampled = null;
  const pump = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        const page = await fetchActions(last);
        if (!isOpen()) return;
        const live = { lastSeq: page.lastSeq, clockMs: page.clockMs, round: page.round, status: page.status };
        // A new species prevalence sample (about once a second of game time), once.
        if (page.prevalence && page.prevalence.round !== sampled) { sampled = page.prevalence.round; live.prevalence = page.prevalence; }
        if (page.actions.length) {
          last = page.actions[page.actions.length - 1].seq;
          send({ actions: page.actions, ...live });
          if (last < page.lastSeq) again = true;
        } else send(live);
      } while (again && isOpen());
    } catch (e) {
      console.error("game feed:", e.message);
    } finally {
      busy = false;
    }
  };
  const onChange = (c) => {
    if (c.game !== gameId) return;
    if (c.version !== undefined) send({ version: c.version });
    if (c.programs && teamId && c.team === teamId) send({ programs: true });
    if (c.seq !== undefined) pump();
  };
  bus.on("change", onChange);
  send({ version });
  pump();
  return () => bus.off("change", onChange);
}

/** The game feed over Server-Sent Events. */
export function gameStream(req, res, opts) {
  let stop = () => {};
  const send = open(req, res, () => stop());
  stop = gameFeed({ ...opts, send, isOpen: () => !res.writableEnded });
}

function open(req, res, onClose) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { onClose(); clearInterval(ping); });
  return send;
}
