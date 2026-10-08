// The Python emitter: vendor/query/history.py, one stdlib-only module: named-tuple records, the typed
// builder, the in-memory executor and the remote (urllib) executor. Field names are snake_case.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEADER, doc, snake, tables } from "./common.js";

const RUNTIME = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "templates", "runtime.py"), "utf8");
const PY_TYPE = { int: "int", float: "float", bool: "bool", str: "str", json: "Json" };

export function emit(schema, types) {
  const t = tables(schema, types);
  const out = [];
  out.push(`# ${HEADER}`);
  out.push('"""Typed queries over a Darwinian Beauty Contest game\'s history (docs/QUERY.md). Standard library only."""');
  out.push("import bisect");
  out.push("import json");
  out.push("import math");
  out.push("import re");
  out.push("from typing import Any, Callable, Generic, Iterable, Literal, NamedTuple, NoReturn, Optional, Sequence, Tuple, TypeVar");
  out.push("");
  out.push("Json = Any  # any JSON value: a challenge, a response, a bee's memory");
  for (const [name, e] of Object.entries(schema.entities)) {
    out.push("");
    out.push("");
    out.push(`class ${e.record}(NamedTuple):`);
    out.push(`    """${doc(e.doc)} (entity "${name}")"""`);
    for (const f of e.fields) {
      const ty = PY_TYPE[f.type];
      out.push(`    ${snake(f.name)}: ${f.nullable && f.type !== "json" ? `Optional[${ty}]` : ty}  # ${doc(f.doc)}`);
    }
    out.push("");
    out.push("    @classmethod");
    out.push(`    def from_json(cls, d: dict) -> "${e.record}":`);
    out.push(`        """From a dict with canonical (camelCase) field names."""`);
    out.push(`        g = d.get`);
    out.push(`        return cls(${e.fields.map((f) => `g(${JSON.stringify(f.name)})`).join(", ")})`);
    out.push("");
    out.push("    def to_json(self) -> dict:");
    out.push(`        """As a dict with canonical (camelCase) field names."""`);
    out.push(`        return {${e.fields.map((f) => `${JSON.stringify(f.name)}: self.${snake(f.name)}`).join(", ")}}`);
    out.push("");
    out.push("");
    out.push(`${e.record}Field = Literal[${e.fields.map((f) => JSON.stringify(snake(f.name))).join(", ")}]`);
  }
  out.push("");
  out.push("");
  out.push(`RECORDS = {${Object.entries(schema.entities).map(([n, e]) => `${JSON.stringify(n)}: ${e.record}`).join(", ")}}`);
  out.push(`PROGRAM_ENTITY = ${JSON.stringify(t.program)}`);
  out.push("# Python field names → canonical ones, per entity, and back.");
  out.push(`_NAMES = ${pyLiteral(Object.fromEntries(Object.entries(schema.entities).map(([n, e]) => [n, Object.fromEntries(e.fields.map((f) => [snake(f.name), f.name]))])))}`);
  out.push("_PY_NAMES = {e: {c: p for p, c in names.items()} for e, names in _NAMES.items()}");
  out.push(`SCHEMA = ${pyLiteral({ types: t.types, entities: t.entities })}`);
  out.push("");
  out.push("");
  const program = schema.entities[t.program];
  out.push("class ProgramHistory:");
  out.push(`    """local()'s read-only root (Local.history): .${t.program} is a query over ${doc(program.doc).replace(/\.$/, "")}."""`);
  out.push(`    __slots__ = (${JSON.stringify(t.program)},)`);
  out.push(`    ${t.program}: "Query[${program.record}, ${program.record}Field]"`);
  out.push("");
  out.push(`    def __init__(self, ${t.program}: "Query[${program.record}, ${program.record}Field]"):`);
  out.push(`        object.__setattr__(self, ${JSON.stringify(t.program)}, ${t.program})`);
  out.push("");
  out.push("    def __setattr__(self, k: str, v: Any) -> None:");
  out.push('        raise AttributeError("history is read-only")');
  out.push("");
  out.push("");
  out.push("class RemoteHistory:");
  out.push('    """Every entity, queried over HTTP (see connect)."""');
  out.push(`    __slots__ = (${Object.keys(schema.entities).map((n) => JSON.stringify(n)).join(", ")})`);
  for (const [n, e] of Object.entries(schema.entities)) out.push(`    ${n}: "Query[${e.record}, ${e.record}Field]"`);
  out.push("");
  out.push(`    def __init__(self, ${Object.keys(schema.entities).join(", ")}):`);
  for (const n of Object.keys(schema.entities)) out.push(`        object.__setattr__(self, ${JSON.stringify(n)}, ${n})`);
  out.push("");
  out.push("    def __setattr__(self, k: str, v: Any) -> None:");
  out.push('        raise AttributeError("read-only")');
  out.push("");
  out.push("");
  return { "history.py": out.join("\n") + RUNTIME };
}

/** A JSON-able value as a Python literal. */
function pyLiteral(v, indent = "") {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number" || typeof v === "string") return JSON.stringify(v);
  const next = indent + "    ";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const simple = v.every((x) => x === null || typeof x !== "object");
    return simple ? `[${v.map((x) => pyLiteral(x)).join(", ")}]` : `[\n${v.map((x) => next + pyLiteral(x, next)).join(",\n")},\n${indent}]`;
  }
  const keys = Object.keys(v);
  if (!keys.length) return "{}";
  const simple = keys.every((k) => v[k] === null || typeof v[k] !== "object" || (Array.isArray(v[k]) && v[k].every((x) => x === null || typeof x !== "object")));
  if (simple && keys.length <= 6) return `{${keys.map((k) => `${JSON.stringify(k)}: ${pyLiteral(v[k])}`).join(", ")}}`;
  return `{\n${keys.map((k) => `${next}${JSON.stringify(k)}: ${pyLiteral(v[k], next)}`).join(",\n")},\n${indent}}`;
}
