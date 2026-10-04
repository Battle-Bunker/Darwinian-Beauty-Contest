// The TypeScript emitter: vendor/query/history.ts (a typed ES module) and vendor/query/history.js (the same
// code with its types stripped, as a plain script defining DbcHistory, for the TypeScript runner, the
// server and browsers).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { HEADER, doc, tables } from "./common.js";

const RUNTIME = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "templates", "runtime.ts"), "utf8");
const TS_TYPE = { int: "number", float: "number", bool: "boolean", str: "string", json: "Json" };

export function emit(schema, types) {
  const t = tables(schema, types);
  const out = [];
  out.push(`// ${HEADER}`);
  out.push("// Typed queries over a Darwinian Beauty Contest game's history. docs/QUERY.md describes them.");
  out.push("");
  out.push("/** Any JSON value: a challenge, a response, a bee's memory. */");
  out.push("export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };");
  for (const [name, e] of Object.entries(schema.entities)) {
    out.push("");
    out.push(`/** ${doc(e.doc)} (entity "${name}") */`);
    out.push(`export interface ${e.record} {`);
    for (const f of e.fields) {
      out.push(`  /** ${doc(f.doc)} */`);
      out.push(`  readonly ${f.name}: ${TS_TYPE[f.type]}${f.nullable && f.type !== "json" ? " | null" : ""};`);
    }
    out.push("}");
  }
  out.push("");
  out.push("/** Each entity's record type. */");
  out.push("export interface Records {");
  for (const [name, e] of Object.entries(schema.entities)) out.push(`  readonly ${name}: ${e.record};`);
  out.push("}");
  out.push("export type EntityName = keyof Records;");
  out.push(`/** The entity local() holds and appends to (Local.history.${t.program}). */`);
  out.push(`export type ProgramEntity = ${JSON.stringify(t.program)};`);
  out.push(`export const PROGRAM_ENTITY: ProgramEntity = ${JSON.stringify(t.program)};`);
  out.push("");
  out.push("/** The schema the runtime works from. */");
  out.push(`export const SCHEMA: Schema = ${JSON.stringify({ types: t.types, entities: t.entities }, null, 2)};`);
  out.push("");
  const ts = out.join("\n") + "\n" + RUNTIME;
  return { "history.ts": ts, "history.js": toScript(ts) };
}

/** The module as a plain script: types stripped, exports gathered into `DbcHistory`. */
function toScript(ts) {
  const names = [...ts.matchAll(/^export (?:class|function|const) (\w+)/gm)].map((m) => m[1]);
  const body = stripTypeScriptTypes(ts, { mode: "strip" }).replace(/^export (?=(?:class|function|const) )/gm, "");
  return `"use strict";\n// ${HEADER}\n// The TypeScript client (history.ts) with its types stripped: DbcHistory = { ${names.join(", ")} }.\n` +
    `var DbcHistory = (function () {\n${body.replace(/^\/\/ GENERATED.*\n/, "")}\nreturn Object.freeze({ ${names.join(", ")} });\n})();\n` +
    `if (typeof module === "object" && module && module.exports) module.exports = DbcHistory;\n`;
}
