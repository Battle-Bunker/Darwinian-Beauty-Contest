// The game feed over WebSockets: GET /api/rooms/:room/games/:game/ws?after=<seq> carries exactly the
// messages the SSE stream (/events) does, one JSON text frame each, filtered for the viewer the same way
// (a session cookie or an `Authorization: Bearer` token; spectators need neither). Server to client only.
import { WebSocketServer } from "ws";
import { gameFeed } from "./realtime.js";

const PATH = /^\/api\/rooms\/([^/]+)\/games\/([^/]+)\/ws\/?$/;
const PING_MS = 25000;
const REASONS = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" };

/**
 * Serve game feeds on `server`'s upgrade requests. resolve(req, room, game, url) returns the feed's
 * options for this viewer, { gameId, teamId, version, after, fetchActions }, or throws (an error with a
 * `status` is answered with that status).
 */
export function attachGameSockets(server, resolve) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    const m = url.pathname.match(PATH);
    if (!m) { refuse(socket, 404); return; }
    socket.on("error", () => {});
    resolve(req, decodeURIComponent(m[1]), decodeURIComponent(m[2]), url).then(
      (opts) => wss.handleUpgrade(req, socket, head, (ws) => serve(ws, opts)),
      (e) => {
        if (!e.status) console.error("game socket:", e);
        refuse(socket, e.status || 500);
      },
    );
  });
  return wss;
}

function serve(ws, opts) {
  const isOpen = () => ws.readyState === ws.OPEN;
  const stop = gameFeed({ ...opts, isOpen, send: (message) => { if (isOpen()) ws.send(JSON.stringify(message)); } });
  const ping = setInterval(() => { if (isOpen()) ws.ping(); }, PING_MS);
  const close = () => { stop(); clearInterval(ping); };
  ws.on("close", close);
  ws.on("error", close);
}

function refuse(socket, status) {
  if (socket.writable) socket.write(`HTTP/1.1 ${status} ${REASONS[status] || "Error"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
