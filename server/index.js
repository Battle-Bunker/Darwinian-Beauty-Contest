import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config.js";
import { migrate } from "./db/migrate.js";
import { sessionMiddleware } from "./auth/index.js";
import { apiRouter } from "./routes/api.js";
import { startListening } from "./realtime.js";
import { recoverInterruptedRounds } from "./games.js";
import { initAst } from "./lib/ast.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web", "dist");

export async function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "512kb" }));
  app.use(sessionMiddleware);
  app.use("/api", apiRouter());
  // Shared with the browser so the editor can show node counts and diffs exactly as the server does.
  app.use("/vendor", express.static(path.join(ROOT, "vendor"), { maxAge: "1h" }));
  // The single-page web app (built into web/dist). Every non-API path serves index.html.
  app.use(express.static(WEB, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => {
    const index = path.join(WEB, "index.html");
    if (fs.existsSync(index)) res.sendFile(index);
    else res.status(200).type("text").send("Darwinian Beauty Contest API is running. The web app hasn't been built yet (web/dist).");
  });
  return app;
}

async function main() {
  await migrate();
  await initAst();
  const recovered = await recoverInterruptedRounds();
  if (recovered) console.log(`cleared ${recovered} interrupted round(s)`);
  await startListening();
  const app = await createApp();
  app.listen(env.port, "0.0.0.0", () => console.log(`darwinian-beauty-contest on :${env.port} (auth: ${env.authProvider})`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
