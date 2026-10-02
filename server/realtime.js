// Live updates over Postgres LISTEN/NOTIFY, so any number of server processes stay in sync. One LISTEN
// connection per process fans notifications out on `bus`:
//   {game, room, version}   something about the game changed (teams, programs, status): refetch the view
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
 * SSE stream for one game: {version} whenever the view should be refetched, and {actions, lastSeq,
 * clockMs} as the garden writes them, starting after `after`. fetchActions(after) returns the viewer's
 * filtered page of actions after a seq.
 */
export function gameStream(req, res, { gameId, version, after, fetchActions }) {
  let last = after, busy = false, again = false;
  const send = open(req, res, () => bus.off("change", onChange));
  const pump = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        const page = await fetchActions(last);
        if (page.actions.length) {
          last = page.actions[page.actions.length - 1].seq;
          send({ actions: page.actions, lastSeq: page.lastSeq, clockMs: page.clockMs });
          if (last < page.lastSeq) again = true;
        } else send({ clockMs: page.clockMs, lastSeq: page.lastSeq });
      } while (again && !res.writableEnded);
    } catch (e) {
      console.error("game stream:", e.message);
    } finally {
      busy = false;
    }
  };
  const onChange = (c) => {
    if (c.game !== gameId) return;
    if (c.version !== undefined) send({ version: c.version });
    if (c.seq !== undefined) pump();
  };
  bus.on("change", onChange);
  send({ version });
  pump();
}

function open(req, res, onClose) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { onClose(); clearInterval(ping); });
  return send;
}
