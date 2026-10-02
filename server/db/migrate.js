// Applies server/db/migrations/*.sql in name order, once each. Safe to run on every boot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, tx } from "./pool.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate() {
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('dbc:migrate'))");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await c.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await c.query(fs.readFileSync(path.join(DIR, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      console.log("migrated", file);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
