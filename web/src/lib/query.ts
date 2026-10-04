// The history query interface (docs/QUERY.md): the schema as the server serves it, the query AST, and
// the equivalent builder code in Python and TypeScript (the generated clients in /vendor/query/), so a
// query built in the console can be pasted into a program or a script.
import { api } from "../api";

export type FieldType = "int" | "float" | "bool" | "str" | "json";
export type Op = "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "in" | "between" | "isNull";
export type AggFn = "count" | "sum" | "avg" | "min" | "max";

export interface QField { name: string; type: FieldType; nullable: boolean; visibility: string; doc: string }
export interface QEntity {
  doc: string; key: string[]; sortedBy: string | null; index: string[][]; cells: string[];
  scopes: Record<string, string[]>; fields: QField[]; rows?: string; program?: boolean;
}
export interface TypeRule { ops: Op[]; order: boolean; group: boolean; aggregates: AggFn[] }
export interface QSchema { version: number; entities: Record<string, QEntity>; types?: Record<string, TypeRule> }

export interface Cond { field: string; op: Op; value: unknown }
export interface Agg { fn: AggFn; field?: string; as?: string }
export interface Order { field: string; dir: "asc" | "desc" }
export interface QueryAst {
  from: string; scope?: string; where?: Cond[]; groupBy?: string[]; aggregates?: Agg[];
  select?: string[]; orderBy?: Order[]; limit?: number; offset?: number;
}
export interface QueryResult { rows: Record<string, unknown>[]; truncated: boolean }

/** The type rules (docs/QUERY.md), used when the served schema doesn't carry them. */
export const TYPE_RULES: Record<FieldType, TypeRule> = {
  int: { ops: ["eq", "ne", "lt", "le", "gt", "ge", "in", "between", "isNull"], order: true, group: true, aggregates: ["count", "sum", "avg", "min", "max"] },
  float: { ops: ["eq", "ne", "lt", "le", "gt", "ge", "in", "between", "isNull"], order: true, group: true, aggregates: ["count", "sum", "avg", "min", "max"] },
  bool: { ops: ["eq", "ne", "in", "isNull"], order: true, group: true, aggregates: ["count"] },
  str: { ops: ["eq", "ne", "in", "isNull"], order: true, group: true, aggregates: ["count"] },
  json: { ops: ["eq", "ne", "in", "isNull"], order: false, group: false, aggregates: ["count"] },
};

export const rulesOf = (schema: QSchema, type: FieldType): TypeRule => (schema.types?.[type] as TypeRule | undefined) ?? TYPE_RULES[type];
export const isNumericType = (t: FieldType) => t === "int" || t === "float";

let schemaPromise: Promise<QSchema> | null = null;
/** The schema, from the API (or the checked-in copy under /vendor/query/), fetched once. */
export function loadSchema(): Promise<QSchema> {
  const valid = (s: unknown): QSchema => {
    const x = s && typeof s === "object" && "schema" in s ? (s as { schema: unknown }).schema : s;
    if (!x || typeof x !== "object" || !("entities" in x)) throw new Error("no query schema here");
    return x as QSchema;
  };
  schemaPromise ||= (async () => {
    try {
      return valid(await api("GET", "/query/schema"));
    } catch (e) {
      try {
        const res = await fetch("/vendor/query/schema.json");
        return valid(await res.json());
      } catch { throw e; }
    }
  })();
  schemaPromise.catch(() => { schemaPromise = null; });
  return schemaPromise;
}

/** The default name of an aggregate, canonical (as the TypeScript client and the AST use it). */
export const defaultAs = (a: Agg) => (a.fn === "count" && !a.field ? "count" : `${a.fn}_${a.field ?? "?"}`);

// ---------- code ----------

export const snake = (s: string) => String(s ?? "").replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const scopeMethod = { py: { myBee: "my_bee", myFlower: "my_flower", mine: "mine" }, ts: { myBee: "myBee", myFlower: "myFlower", mine: "mine" } } as const;

/** A JSON value as a Python literal. */
export function pyLiteral(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "None";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(", ")}]`;
  return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${pyLiteral(x)}`).join(", ")}}`;
}
const tsLiteral = (v: unknown) => JSON.stringify(v) ?? "undefined";

export interface CodeTarget { origin: string; room: string; game: string | null }

/** The builder chain for an AST, in Python (snake_case names) or TypeScript. */
function chain(ast: QueryAst, lang: "py" | "ts"): string[] {
  const py = lang === "py";
  const name = (f: string) => (py ? snake(f) : f);
  const lit = py ? pyLiteral : tsLiteral;
  // Aggregate names: a default one is the language's own default (sum_bee_ms in Python); a custom one is kept.
  const aggName = new Map<string, string>();
  for (const a of ast.aggregates ?? []) {
    const canon = a.as ?? defaultAs(a);
    aggName.set(canon, canon === defaultAs(a) ? (a.fn === "count" && !a.field ? "count" : `${a.fn}_${a.field ? name(a.field) : "?"}`) : canon);
  }
  const out: string[] = [];
  if (ast.scope) out.push(`${scopeMethod[lang][ast.scope as keyof typeof scopeMethod.py] ?? ast.scope}()`);
  for (const c of ast.where ?? []) {
    const f = JSON.stringify(name(c.field));
    if (c.op === "isNull") out.push(c.value ? `${py ? "is_null" : "isNull"}(${f})` : `${py ? "not_null" : "notNull"}(${f})`);
    else if (c.op === "between") { const [lo, hi] = c.value as [unknown, unknown]; out.push(`between(${f}, ${lit(lo)}, ${lit(hi)})`); }
    else if (c.op === "in") out.push(`${py ? "in_" : "in"}(${f}, ${lit(c.value)})`);
    else out.push(`${c.op}(${f}, ${lit(c.value)})`);
  }
  if (ast.select?.length) out.push(`select(${ast.select.map((f) => JSON.stringify(name(f))).join(", ")})`);
  if (ast.groupBy?.length) out.push(`${py ? "group_by" : "groupBy"}(${ast.groupBy.map((f) => JSON.stringify(name(f))).join(", ")})`);
  for (const a of ast.aggregates ?? []) {
    const canon = a.as ?? defaultAs(a);
    const custom = canon !== defaultAs(a);
    const field = a.field ? JSON.stringify(name(a.field)) : null;
    if (py) out.push(`${a.fn}(${[field, custom ? `as_=${JSON.stringify(canon)}` : null].filter(Boolean).join(", ")})`);
    else out.push(`${a.fn}(${[field ?? (custom ? "undefined" : null), custom ? JSON.stringify(canon) : null].filter(Boolean).join(", ")})`);
  }
  for (const o of ast.orderBy ?? []) {
    const f = JSON.stringify(aggName.get(o.field) ?? name(o.field));
    out.push(py ? `order_by(${f}${o.dir === "desc" ? ", desc=True" : ""})` : `orderBy(${f}${o.dir === "desc" ? ', "desc"' : ""})`);
  }
  if (ast.offset) out.push(`offset(${ast.offset})`);
  if (ast.limit !== undefined) out.push(`limit(${ast.limit})`);
  return out;
}

export function pythonCode(ast: QueryAst, t: CodeTarget): string {
  const steps = chain(ast, "py");
  const conn = `connect(${JSON.stringify(t.origin)}, room=${JSON.stringify(t.room)}${t.game ? `, game=${JSON.stringify(t.game)}` : ""}, token=TOKEN)`;
  const body = [`h.${ast.from}`, ...steps.map((s) => `.${s}`), ".rows()"];
  let code = `from history import connect   # ${t.origin}/vendor/query/history.py (stdlib only)\n\nh = ${conn}\nrows = (\n    ${body.join("\n    ")}\n)\nfor row in rows:\n    print(row)\n`;
  if (ast.from === "turns" && t.game) {
    code += `\n# In a program, the same query runs on your team's HISTORY:\n# HISTORY.turns${steps.map((s) => `.${s}`).join("")}.rows()\n`;
  }
  return code;
}

export function typescriptCode(ast: QueryAst, t: CodeTarget): string {
  const steps = chain(ast, "ts");
  const conn = `connect({ base: ${JSON.stringify(t.origin)}, room: ${JSON.stringify(t.room)}${t.game ? `, game: ${JSON.stringify(t.game)}` : ""}, token })`;
  let code = `import { connect } from "./history.ts";   // ${t.origin}/vendor/query/history.ts\n\nconst h = ${conn};\nconst rows = await h.${ast.from}\n  ${[...steps.map((s) => `.${s}`), ".rows()"].join("\n  ")};\nconsole.table(rows);\n`;
  if (ast.from === "turns" && t.game) {
    code += `\n// In a program, the same query runs on your team's HISTORY (synchronously):\n// HISTORY.turns${steps.map((s) => `.${s}`).join("")}.rows()\n`;
  }
  return code;
}

export function curlCode(ast: QueryAst, t: CodeTarget): string {
  const url = `${t.origin}/api/rooms/${t.room}${t.game ? `/games/${t.game}` : ""}/query`;
  return `curl -s -X POST ${url} \\\n  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \\\n  -d '${JSON.stringify(ast).replace(/'/g, "'\\''")}'\n`;
}

/** Rows as CSV: one column per key, JSON for structured values. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
