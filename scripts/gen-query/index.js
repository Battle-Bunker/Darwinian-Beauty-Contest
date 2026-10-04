// Generates the typed query clients in vendor/query/ from the schema (server/query/schema.js).
//   node scripts/gen-query            write them
//   node scripts/gen-query --check    exit 1 if any is stale (npm test checks this too)
// Each language is one emitter: emit(schema, types) → { "<file>": "<contents>" }. docs/QUERY.md explains
// how to add one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, TYPES } from "../../server/query/schema.js";
import * as typescript from "./typescript.js";
import * as python from "./python.js";
import { HEADER, tables } from "./common.js";

export const EMITTERS = { typescript, python };
export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "vendor", "query");

/** Every generated file: { name: contents }. */
export function generate() {
  const files = {};
  for (const emitter of Object.values(EMITTERS)) Object.assign(files, emitter.emit(SCHEMA, TYPES));
  const t = tables(SCHEMA, TYPES);
  files["schema.json"] = JSON.stringify({ comment: HEADER, ...t, docs: Object.fromEntries(Object.entries(SCHEMA.entities).map(([n, e]) => [n, {
    doc: e.doc, rows: e.rows ?? null, fields: Object.fromEntries(e.fields.map((f) => [f.name, { doc: f.doc, visibility: f.visibility }])),
  }])) }, null, 2) + "\n";
  return files;
}

/** The generated files that differ from what's checked in. */
export function stale() {
  return Object.entries(generate()).filter(([name, text]) => {
    const file = path.join(OUT, name);
    return !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text;
  }).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const s = stale();
    if (s.length) { console.error(`stale: ${s.join(", ")} (run npm run gen:query)`); process.exit(1); }
    console.log("vendor/query is up to date");
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, text] of Object.entries(generate())) fs.writeFileSync(path.join(OUT, name), text);
    console.log(`wrote ${Object.keys(generate()).map((n) => "vendor/query/" + n).join(", ")}`);
  }
}
