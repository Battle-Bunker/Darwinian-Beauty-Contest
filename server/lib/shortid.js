// Crockford base32 codes for UUIDs, and the shortest-unique-prefix scheme used in URLs.
//
// Every room and game stores its full 26-char code plus `prefix_len`, fixed at creation:
// the shortest prefix that no earlier record's code started with. Later records always
// pick a prefix longer than their common prefix with every earlier record, so the pair
// (code prefix, prefix_len <= length(prefix)) resolves to exactly one record forever.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 128-bit UUID -> 26 Crockford chars, MSB first (last char carries 3 bits of zero padding). */
export function uuidToCode(uuid) {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("bad uuid: " + uuid);
  let bits = "";
  for (const h of hex) bits += parseInt(h, 16).toString(2).padStart(4, "0");
  bits = bits.padEnd(130, "0");
  let out = "";
  for (let i = 0; i < 130; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

/** Normalize user input per Crockford: case-insensitive, I/L -> 1, O -> 0, hyphens ignored. */
export function normalizeCode(s) {
  const up = String(s || "").toUpperCase().replace(/-/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{1,26}$/.test(up) ? up : null;
}

/**
 * Smallest L such that no existing code in `table` (within `scope`) starts with code[0..L).
 * Call inside a transaction holding an advisory lock for the same table/scope.
 */
export async function allocatePrefixLen(client, table, code, scope = null) {
  for (let len = 1; len <= code.length; len++) {
    const prefix = code.slice(0, len);
    const params = [prefix + "%"];
    let where = "code LIKE $1";
    if (scope) { params.push(scope.value); where += ` AND ${scope.column} = $2`; }
    const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`, params);
    if (!rowCount) return len;
  }
  return code.length;
}

export const shortId = (row) => row.code.slice(0, row.prefix_len);
