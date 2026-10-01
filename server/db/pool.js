import pg from "pg";
import { env } from "../config.js";

// bigint (int8) columns come back as JS numbers; our values (seeds, versions) fit comfortably.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 20 });

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
