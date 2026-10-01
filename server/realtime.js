// Live updates: every game change does pg_notify('dbc', {game, room, version}). One LISTEN connection
// per server process fans those out to Server-Sent Event streams, so any number of server instances
// stay in sync. Clients just refetch the game view when its version moves.
import { EventEmitter } from "node:events";
import pg from "pg";
import { env } from "./config.js";

const bus = new EventEmitter();
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

/** SSE stream of {version} for one game (filter.game) or of game-list changes for a room (filter.room). */
export function sse(req, res, filter, initial) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send(initial);
  const onChange = (c) => {
    if ((filter.game && c.game === filter.game) || (filter.room && c.room === filter.room)) send(c);
  };
  bus.on("change", onChange);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { bus.off("change", onChange); clearInterval(ping); });
}
