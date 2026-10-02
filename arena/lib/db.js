// Postgres access for the arena's own schema (`arena`) in the game's database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const ARENA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://dbc:dbc@localhost:5432/dbc",
  max: 8,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
export const all = async (text, params) => (await pool.query(text, params)).rows;

export async function migrate() {
  const sql = fs.readFileSync(path.join(ARENA_DIR, "schema.sql"), "utf8");
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(hashtext('dbc:arena-migrate'))");
    await c.query(sql);
  } finally {
    await c.query("SELECT pg_advisory_unlock(hashtext('dbc:arena-migrate'))").catch(() => {});
    c.release();
  }
}
