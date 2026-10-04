// The history query console, for operators: pick an entity, add typed conditions on any of its fields
// (from the served schema), group and aggregate, sort and limit, and run it on this game (as you may see
// it) or across a room's finished games. Results come back as a table to download as CSV or JSON, and the
// same query is shown as Python and TypeScript builder code (the generated clients) and as its JSON AST.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "../api";
import { storage } from "../hooks";
import type { Team } from "../types";
import {
  curlCode, defaultAs, download, isNumericType, loadSchema, pythonCode, rulesOf, toCsv, typescriptCode,
  type AggFn, type CodeTarget, type Op, type QEntity, type QField, type QSchema, type QueryAst, type QueryResult,
} from "../lib/query";
import { Alert, CopyButton, ErrorBoundary, Spinner } from "./ui";
import { Value } from "./Value";

interface DCond { id: number; field: string; op: Op; a: string; b: string }
interface DAgg { id: number; fn: AggFn; field: string; as: string }
interface DOrder { id: number; field: string; dir: "asc" | "desc" }
interface Draft { from: string; scope: string; where: DCond[]; groupBy: string[]; aggs: DAgg[]; select: string[]; order: DOrder[]; limit: string; offset: string }

const OP_LABEL: Record<Op, string> = { eq: "=", ne: "≠", lt: "<", le: "≤", gt: ">", ge: "≥", in: "in", between: "between", isNull: "is null?" };
const EMPTY: Draft = { from: "turns", scope: "", where: [], groupBy: [], aggs: [], select: [], order: [], limit: "100", offset: "" };
let nextId = 1;
const id = () => nextId++;

/** Fields that hold a team index (shown with the team's name and colour where the teams are known). */
const TEAM_FIELDS = new Set(["bee", "flower", "team", "index"]);

export type QueryTarget = { kind: "game"; room: string; game: string; teams: Team[] | null; myIndex: number | null } | { kind: "room"; room: string };

interface Preset { label: string; draft: Partial<Draft> & { from: string }; game?: boolean; room?: boolean; team?: boolean }
const c = (field: string, op: Op, a: string, b = ""): DCond => ({ id: id(), field, op, a, b });
const g = (fn: AggFn, field = "", as = ""): DAgg => ({ id: id(), fn, field, as });
const o = (field: string, dir: "asc" | "desc" = "desc"): DOrder => ({ id: id(), field, dir });
const PRESETS = (): Preset[] => [
  { label: "The scoreboard, best fitness first", draft: { from: "scores", order: [o("fitness")] } },
  { label: "Nectar my bee got, per flower", team: true, game: true, draft: { from: "turns", scope: "myBee", where: [c("fed", "eq", "true")], groupBy: ["flower"], aggs: [g("count"), g("sum", "nectar")], order: [o("sum_nectar")] } },
  { label: "My flower's visits: fed or not, energy and compute", team: true, game: true, draft: { from: "turns", scope: "myFlower", groupBy: ["fed"], aggs: [g("count"), g("sum", "energy"), g("avg", "ms"), g("avg", "percent")] } },
  { label: "Pollen each species gave each bee", draft: { from: "pairs", select: ["bee", "flower", "feeds", "nectar", "pollen"], order: [o("pollen")] } },
  { label: "Feeds per bee, rounds 1–100", game: true, draft: { from: "turns", where: [c("round", "between", "1", "100"), c("fed", "eq", "true")], groupBy: ["bee"], aggs: [g("count"), g("sum", "nectar")], order: [o("count")] } },
  { label: "The latest 50 turns", game: true, draft: { from: "turns", order: [o("round")], limit: "50" } },
  { label: "Program changes during the game", draft: { from: "versions", where: [c("atMs", "gt", "0")], order: [o("atMs", "asc")] } },
  { label: "Bees' memory sizes", draft: { from: "teams", select: ["game", "index", "name", "memoryBytes"], order: [o("memoryBytes")] } },
  { label: "Average fitness per game", room: true, draft: { from: "scores", groupBy: ["game"], aggs: [g("count"), g("max", "fitness"), g("avg", "pollinationShare")], order: [o("max_fitness")] } },
];

function parseOne(type: QField["type"], text: string): { v?: unknown; err?: string } {
  const t = text.trim();
  if (type === "int") return /^-?\d+$/.test(t) ? { v: Number(t) } : { err: "a whole number" };
  if (type === "float") return t !== "" && Number.isFinite(Number(t)) ? { v: Number(t) } : { err: "a number" };
  if (type === "bool") return t === "true" || t === "false" ? { v: t === "true" } : { err: "true or false" };
  if (type === "str") return { v: text };
  try { return { v: JSON.parse(t) }; } catch {
    try { return { v: JSON.parse(t.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null").replace(/'/g, '"')) }; } catch { return { err: "JSON" }; }
  }
}

function parseList(type: QField["type"], text: string): { v?: unknown[]; err?: string } {
  const t = text.trim();
  if (type === "json" || t.startsWith("[")) {
    const r = parseOne("json", t.startsWith("[") ? t : `[${t}]`);
    return r.err || !Array.isArray(r.v) ? { err: "a JSON list" } : { v: r.v.filter((x) => x !== null) };
  }
  const parts = t.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (!parts.length) return { err: "one or more values, separated by commas" };
  const out: unknown[] = [];
  for (const p of parts) {
    const r = parseOne(type, type === "str" ? p.replace(/^"(.*)"$/, "$1") : p);
    if (r.err) return { err: `values: ${r.err}, separated by commas` };
    out.push(r.v);
  }
  return { v: out };
}

/** The AST a draft makes, and what's wrong with it (keyed by the row's id, or "limit"). */
function toAst(d: Draft, ent: QEntity): { ast: QueryAst; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const byName = new Map(ent.fields.map((f) => [f.name, f]));
  const ast: QueryAst = { from: d.from };
  if (d.scope) ast.scope = d.scope;
  const where = [];
  for (const w of d.where) {
    const f = byName.get(w.field);
    if (!f) { errors[w.id] = "pick a field"; continue; }
    let value: unknown, err: string | undefined;
    if (w.op === "isNull") value = w.a !== "false";
    else if (w.op === "in") ({ v: value, err } = parseList(f.type, w.a));
    else if (w.op === "between") {
      const lo = parseOne(f.type, w.a), hi = parseOne(f.type, w.b);
      err = lo.err ?? hi.err;
      value = [lo.v, hi.v];
    } else {
      const r = parseOne(f.type, w.a);
      err = r.err; value = r.v;
      if (!err && value === null) err = "not null (use \"is null?\")";
    }
    if (err) errors[w.id] = `${w.field}: ${err}`;
    else where.push({ field: w.field, op: w.op, value });
  }
  if (where.length) ast.where = where;
  if (d.groupBy.length) ast.groupBy = d.groupBy;
  if (d.aggs.length) {
    const names = new Set<string>();
    ast.aggregates = d.aggs.map((a) => {
      const agg = { fn: a.fn, ...(a.field ? { field: a.field } : {}) };
      if (a.fn !== "count" && !a.field) errors[a.id] = `${a.fn} needs a numeric field: pick one`;
      const as = a.as.trim() || defaultAs(agg);
      if (names.has(as)) errors[a.id] = `two aggregates are called ${as}: name one`;
      names.add(as);
      return { ...agg, as };
    });
  } else if (d.select.length) ast.select = d.select;
  if (d.order.length) ast.orderBy = d.order.filter((x) => x.field).map((x) => ({ field: x.field, dir: x.dir }));
  if (d.limit.trim()) {
    const n = Number(d.limit);
    if (!Number.isInteger(n) || n < 0 || n > 5000) errors.limit = "limit: a whole number up to 5,000";
    else ast.limit = n;
  }
  if (d.offset.trim()) {
    const n = Number(d.offset);
    if (!Number.isInteger(n) || n < 0) errors.offset = "offset: a whole number";
    else if (n) ast.offset = n;
  }
  return { ast, errors };
}

export function QueryConsole({ target }: { target: QueryTarget }) {
  return <ErrorBoundary what="query console"><Console target={target} /></ErrorBoundary>;
}

function Console({ target }: { target: QueryTarget }) {
  const [schema, setSchema] = useState<QSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  useEffect(() => { loadSchema().then(setSchema, (e) => setSchemaError(errorText(e))); }, []);

  const key = `dbc:query:${target.kind}:${target.room}${target.kind === "game" ? `:${target.game}` : ""}`;
  const [draft, setDraftRaw] = useState<Draft>(() => {
    try { const s = storage.get(key); if (s) { const d = JSON.parse(s) as Draft; nextId = 1 + Math.max(0, ...[...d.where, ...d.aggs, ...d.order].map((x) => x.id)); return d; } } catch { /* a fresh one */ }
    return { ...EMPTY, order: [], where: [] };
  });
  const setDraft = (f: (d: Draft) => Draft) => setDraftRaw((d) => { const n = f(d); storage.set(key, JSON.stringify(n)); return n; });

  const [result, setResult] = useState<{ res?: QueryResult; error?: string; ms?: number; ast?: QueryAst } | null>(null);
  const [busy, setBusy] = useState(false);

  if (schemaError) return <Alert kind="warn">The query interface isn't available on this server ({schemaError}).</Alert>;
  if (!schema) return <p className="muted"><Spinner label="Loading the schema…" /></p>;
  const entities = Object.keys(schema.entities);
  const ent = schema.entities[draft.from] ?? schema.entities[entities[0]];
  const { ast, errors } = toAst(draft, ent);
  const errorList = Object.values(errors);

  const url = target.kind === "game" ? `/rooms/${encodeURIComponent(target.room)}/games/${encodeURIComponent(target.game)}/query` : `/rooms/${encodeURIComponent(target.room)}/query`;
  const run = async () => {
    if (errorList.length) return;
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await api<QueryResult>("POST", url, ast);
      setResult({ res, ms: performance.now() - t0, ast });
    } catch (e) {
      setResult({ error: errorText(e), ast });
    } finally { setBusy(false); }
  };

  const presets = PRESETS().filter((p) => (target.kind === "game" ? !p.room : !p.game) && (!p.team || (target.kind === "game" && target.myIndex !== null)) && schema.entities[p.draft.from]);
  const loadPreset = (p: Preset) => { setDraft(() => ({ ...EMPTY, ...p.draft })); setResult(null); };
  const codeTarget: CodeTarget = { origin: location.origin, room: target.room, game: target.kind === "game" ? target.game : null };

  return (
    <div className="qc" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } }}>
      <p className="small muted">
        {target.kind === "game"
          ? "Query this game's history as you may see it: during play, fields that aren't yours to see read as null everywhere (in rows, filters and aggregates); once the game is over, everything."
          : "Query every finished game in this room at once, fully revealed (the game field tells them apart)."}
        {" "}The same queries run in programs on <code>HISTORY</code> and in scripts through the generated clients (docs/QUERY.md).
      </p>
      <div className="qc-presets">
        <label className="feed-filter"><span>Start from</span>
          <select value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) loadPreset(p); }} aria-label="Example queries">
            <option value="">an example…</option>
            {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
        </label>
        <button className="link-btn small" onClick={() => { setDraft(() => ({ ...EMPTY, from: draft.from })); setResult(null); }}>clear</button>
      </div>

      <div className="qc-builder">
        <Row label="From">
          <select value={ent === schema.entities[draft.from] ? draft.from : entities[0]} aria-label="Entity"
            onChange={(e) => { const from = e.target.value; setDraft(() => ({ ...EMPTY, from })); setResult(null); }}>
            {entities.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="small muted qc-doc">{ent.doc}</span>
        </Row>

        {Object.keys(ent.scopes ?? {}).length > 0 && (
          <Row label="Scope">
            <select value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))} aria-label="Scope">
              <option value="">every team</option>
              {Object.entries(ent.scopes).map(([s, fs]) => <option key={s} value={s}>{s}: {fs.join(" or ")} = my team</option>)}
            </select>
          </Row>
        )}

        <Row label="Where">
          <div className="qc-list">
            {draft.where.map((w) => (
              <CondRow key={w.id} w={w} ent={ent} schema={schema} target={target} error={errors[w.id]}
                onChange={(n) => setDraft((d) => ({ ...d, where: d.where.map((x) => (x.id === w.id ? n : x)) }))}
                onRemove={() => setDraft((d) => ({ ...d, where: d.where.filter((x) => x.id !== w.id) }))} />
            ))}
            <button className="btn btn-small btn-ghost qc-add" onClick={() => {
              const f = ent.fields.find((x) => x.name === ent.sortedBy) ?? ent.fields[0];
              setDraft((d) => ({ ...d, where: [...d.where, { id: id(), field: f.name, op: rulesOf(schema, f.type).ops[0], a: "", b: "" }] }));
            }}>+ condition</button>
          </div>
        </Row>

        <Row label="Group by">
          <div className="qc-chips" role="group" aria-label="Group by">
            {ent.fields.filter((f) => rulesOf(schema, f.type).group).map((f) => (
              <Chip key={f.name} on={draft.groupBy.includes(f.name)} title={f.doc}
                onClick={() => setDraft((d) => ({ ...d, groupBy: d.groupBy.includes(f.name) ? d.groupBy.filter((x) => x !== f.name) : [...d.groupBy, f.name] }))}>{f.name}</Chip>
            ))}
          </div>
        </Row>

        <Row label="Aggregates">
          <div className="qc-list">
            {draft.aggs.map((a) => (
              <AggRow key={a.id} a={a} ent={ent} schema={schema} error={errors[a.id]}
                onChange={(n) => setDraft((d) => ({ ...d, aggs: d.aggs.map((x) => (x.id === a.id ? n : x)) }))}
                onRemove={() => setDraft((d) => ({ ...d, aggs: d.aggs.filter((x) => x.id !== a.id) }))} />
            ))}
            <button className="btn btn-small btn-ghost qc-add" onClick={() => setDraft((d) => ({ ...d, aggs: [...d.aggs, { id: id(), fn: "count", field: "", as: "" }] }))}>+ aggregate</button>
            {draft.groupBy.length > 0 && !draft.aggs.length && <span className="small muted">Grouping without aggregates lists each group once.</span>}
          </div>
        </Row>

        {!draft.aggs.length && (
          <Row label="Fields">
            <div className="qc-chips" role="group" aria-label="Fields to return (none picked: all)">
              {ent.fields.map((f) => (
                <Chip key={f.name} on={draft.select.includes(f.name)} title={`${f.type}${f.nullable ? ", nullable" : ""} · ${f.visibility}: ${f.doc}`}
                  onClick={() => setDraft((d) => ({ ...d, select: d.select.includes(f.name) ? d.select.filter((x) => x !== f.name) : [...d.select, f.name] }))}>{f.name}</Chip>
              ))}
              {!draft.select.length && <span className="small muted">all</span>}
            </div>
          </Row>
        )}

        <Row label="Sort">
          <div className="qc-list">
            {draft.order.map((x) => {
              const options = ast.aggregates?.length
                ? [...(draft.groupBy), ...ast.aggregates.map((a) => a.as!)]
                : ent.fields.filter((f) => rulesOf(schema, f.type).order).map((f) => f.name);
              return (
                <div key={x.id} className="qc-row">
                  <select value={x.field} onChange={(e) => setDraft((d) => ({ ...d, order: d.order.map((y) => (y.id === x.id ? { ...y, field: e.target.value } : y)) }))} aria-label="Sort by">
                    {!options.includes(x.field) && <option value={x.field}>{x.field || "pick…"}</option>}
                    {options.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select value={x.dir} onChange={(e) => setDraft((d) => ({ ...d, order: d.order.map((y) => (y.id === x.id ? { ...y, dir: e.target.value as "asc" | "desc" } : y)) }))} aria-label="Direction">
                    <option value="asc">ascending</option><option value="desc">descending</option>
                  </select>
                  <button className="icon-btn qc-x" aria-label="Remove this sort" onClick={() => setDraft((d) => ({ ...d, order: d.order.filter((y) => y.id !== x.id) }))}>×</button>
                </div>
              );
            })}
            <button className="btn btn-small btn-ghost qc-add" onClick={() => setDraft((d) => ({ ...d, order: [...d.order, { id: id(), field: ast.aggregates?.[0]?.as ?? ent.sortedBy ?? ent.key.at(-1) ?? ent.fields[0].name, dir: "desc" }] }))}>+ sort</button>
            {!draft.order.length && <span className="small muted">natural order: {ast.groupBy?.length ? "the group fields" : ent.key.join(", ")}</span>}
          </div>
        </Row>

        <Row label="Limit">
          <input className="qc-num" inputMode="numeric" value={draft.limit} onChange={(e) => setDraft((d) => ({ ...d, limit: e.target.value }))} aria-label="Limit" placeholder="1000" />
          <span className="small muted">offset</span>
          <input className="qc-num" inputMode="numeric" value={draft.offset} onChange={(e) => setDraft((d) => ({ ...d, offset: e.target.value }))} aria-label="Offset" placeholder="0" />
          <span className="small muted">at most 5,000 rows</span>
        </Row>
      </div>

      <div className="row qc-run">
        <button className="btn btn-honey" onClick={run} disabled={busy || errorList.length > 0} title="Ctrl+Enter">{busy ? "Running…" : "Run query"}</button>
        {errorList.length > 0 && <span className="small bad-text">{errorList.join(" · ")}</span>}
      </div>

      {result?.error && <Alert kind="error">{result.error}</Alert>}
      {result?.res && <Results res={result.res} ms={result.ms ?? 0} ast={result.ast!} target={target} />}

      <CodePanel ast={ast} target={codeTarget} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="qc-line"><span className="qc-label">{label}</span><div className="qc-body">{children}</div></div>;
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return <button type="button" className={`qc-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick} title={title}>{children}</button>;
}

function CondRow({ w, ent, schema, target, error, onChange, onRemove }: {
  w: DCond; ent: QEntity; schema: QSchema; target: QueryTarget; error?: string; onChange: (w: DCond) => void; onRemove: () => void;
}) {
  const f = ent.fields.find((x) => x.name === w.field) ?? ent.fields[0];
  const ops = rulesOf(schema, f.type).ops;
  const teams = target.kind === "game" && target.teams && TEAM_FIELDS.has(f.name) && f.type === "int" ? target.teams : null;
  const input = (v: string, set: (s: string) => void, label: string) => {
    if (f.type === "bool" && w.op !== "in") return (
      <select value={v} onChange={(e) => set(e.target.value)} aria-label={label}><option value="">pick…</option><option value="true">true</option><option value="false">false</option></select>
    );
    if (teams && (w.op === "eq" || w.op === "ne")) return (
      <select value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">pick a team…</option>
        {teams.map((t, i) => <option key={t.id} value={i}>{i}: {t.name}</option>)}
      </select>
    );
    const ph = w.op === "in" ? (f.type === "json" ? "[1, [2, 3]]" : f.type === "str" ? "a, b" : "0, 2") : f.type === "json" ? "JSON, e.g. 17" : f.type === "str" ? "text" : f.type === "int" ? "0" : "0.0";
    return <input className={`qc-val ${f.type === "json" || f.type === "str" ? "mono" : ""}`} value={v} onChange={(e) => set(e.target.value)} placeholder={ph} aria-label={label}
      inputMode={isNumericType(f.type) && w.op !== "in" ? "decimal" : undefined} />;
  };
  return (
    <div className={`qc-row ${error ? "qc-bad" : ""}`}>
      <select value={f.name} aria-label="Field" title={f.doc}
        onChange={(e) => { const nf = ent.fields.find((x) => x.name === e.target.value)!; const nops = rulesOf(schema, nf.type).ops; onChange({ ...w, field: nf.name, op: nops.includes(w.op) ? w.op : nops[0], a: "", b: "" }); }}>
        {ent.fields.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.type})</option>)}
      </select>
      <select value={w.op} onChange={(e) => onChange({ ...w, op: e.target.value as Op, a: e.target.value === "isNull" ? "true" : "", b: "" })} aria-label="Condition">
        {ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
      </select>
      {w.op === "isNull"
        ? <select value={w.a} onChange={(e) => onChange({ ...w, a: e.target.value })} aria-label="Null or not"><option value="true">is null</option><option value="false">is not null</option></select>
        : w.op === "between" ? <>{input(w.a, (a) => onChange({ ...w, a }), "From")}<span className="small muted">and</span>{input(w.b, (b) => onChange({ ...w, b }), "To")}</>
        : input(w.a, (a) => onChange({ ...w, a }), "Value")}
      <button className="icon-btn qc-x" aria-label="Remove this condition" onClick={onRemove}>×</button>
      {teams && w.op === "in" && <span className="small muted qc-hint">{teams.map((t, i) => `${i}: ${t.name}`).join(" · ")}</span>}
    </div>
  );
}

function AggRow({ a, ent, schema, error, onChange, onRemove }: { a: DAgg; ent: QEntity; schema: QSchema; error?: string; onChange: (a: DAgg) => void; onRemove: () => void }) {
  const fields = a.fn === "count" ? ent.fields : ent.fields.filter((f) => rulesOf(schema, f.type).aggregates.includes(a.fn));
  const def = defaultAs({ fn: a.fn, ...(a.field ? { field: a.field } : {}) });
  return (
    <div className={`qc-row ${error ? "qc-bad" : ""}`}>
      <select value={a.fn} onChange={(e) => { const fn = e.target.value as AggFn; const ok = fn === "count" || ent.fields.some((f) => f.name === a.field && isNumericType(f.type)); onChange({ ...a, fn, field: ok ? a.field : "" }); }} aria-label="Aggregate">
        {(["count", "sum", "avg", "min", "max"] as AggFn[]).map((fn) => <option key={fn} value={fn}>{fn}</option>)}
      </select>
      <select value={a.field} onChange={(e) => onChange({ ...a, field: e.target.value })} aria-label="Of field">
        {a.fn === "count" ? <option value="">rows</option> : <option value="">pick a number…</option>}
        {fields.map((f) => <option key={f.name} value={f.name}>{a.fn === "count" ? `non-null ${f.name}` : f.name}</option>)}
      </select>
      <span className="small muted">as</span>
      <input className="qc-val mono" value={a.as} placeholder={def} onChange={(e) => onChange({ ...a, as: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} aria-label="Name" />
      <button className="icon-btn qc-x" aria-label="Remove this aggregate" onClick={onRemove}>×</button>
    </div>
  );
}

const fmtNum = (x: number) => (Number.isInteger(x) ? x.toLocaleString() : Math.abs(x) >= 100 ? x.toLocaleString(undefined, { maximumFractionDigits: 1 }) : x.toLocaleString(undefined, { maximumSignificantDigits: 4 }));

function Results({ res, ms, ast, target }: { res: QueryResult; ms: number; ast: QueryAst; target: QueryTarget }) {
  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const r of res.rows.slice(0, 200)) for (const k of Object.keys(r)) seen.add(k);
    return [...seen];
  }, [res]);
  const [limit, setLimit] = useState(200);
  const base = `query-${ast.from}-${target.kind === "game" ? target.game : `room-${target.room}`}`;
  const teams = target.kind === "game" ? target.teams : null;
  const cell = (k: string, v: unknown): ReactNode => {
    if (v === null || v === undefined) return <span className="null">null</span>;
    if (teams && TEAM_FIELDS.has(k) && typeof v === "number" && teams[v]) {
      return <span className="team-chip" title={teams[v].name}><span className="mono idx">{v}</span><span className="swatch" style={{ background: teams[v].color }} /><span className="team-name">{teams[v].name}</span></span>;
    }
    if (typeof v === "number") return fmtNum(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return v.length > 60 || v.includes("\n") ? <details className="qc-long"><summary className="mono">{v.slice(0, 40).replace(/\n/g, " ")}…</summary><pre>{v}</pre></details> : v;
    return <Value v={v} role={k === "challenge" ? "challenge" : k === "response" ? "response" : undefined} max={36} />;
  };
  const numeric = (k: string) => res.rows.some((r) => typeof r[k] === "number") && !(teams && TEAM_FIELDS.has(k));
  return (
    <div className="qc-results">
      <div className="row">
        <span className="small"><b>{res.rows.length.toLocaleString()}</b> {res.rows.length === 1 ? "row" : "rows"} in {Math.round(ms)} ms{res.truncated && <span className="warn-text"> · more rows matched: raise the limit (up to 5,000) or narrow the query</span>}</span>
        <span className="qc-dl">
          <button className="btn btn-small btn-ghost" disabled={!res.rows.length} onClick={() => download(`${base}.csv`, toCsv(res.rows, columns), "text/csv")}>CSV</button>
          <button className="btn btn-small btn-ghost" disabled={!res.rows.length} onClick={() => download(`${base}.json`, JSON.stringify(res.rows, null, 1), "application/json")}>JSON</button>
        </span>
      </div>
      {res.rows.length > 0 && (
        <div className="table-scroll tall">
          <table className="data-table qc-table">
            <thead><tr>{columns.map((k) => <th key={k} className={numeric(k) ? "" : "left"}>{k}</th>)}</tr></thead>
            <tbody>
              {res.rows.slice(0, limit).map((r, i) => (
                <tr key={i}>{columns.map((k) => <td key={k} className={numeric(k) ? "" : "left"}>{cell(k, r[k])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.rows.length > limit && <button className="btn btn-small btn-ghost" onClick={() => setLimit((l) => l + 500)}>Show more ({(res.rows.length - limit).toLocaleString()} left)</button>}
    </div>
  );
}

function CodePanel({ ast, target }: { ast: QueryAst; target: CodeTarget }) {
  const [tab, setTab] = useState<"py" | "ts" | "ast" | "curl">(() => (storage.get("dbc:query:tab") as "py") || "py");
  const code = tab === "py" ? pythonCode(ast, target) : tab === "ts" ? typescriptCode(ast, target) : tab === "curl" ? curlCode(ast, target) : JSON.stringify(ast, null, 2) + "\n";
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="qc-code">
      <div className="row">
        <div className="seg" role="tablist" aria-label="The same query as code">
          {([["py", "Python"], ["ts", "TypeScript"], ["ast", "JSON AST"], ["curl", "curl"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => { setTab(k); storage.set("dbc:query:tab", k); }}>{l}</button>
          ))}
        </div>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre ref={pre} className="qc-pre" tabIndex={0} aria-label="Code">{code}</pre>
      <p className="small muted">
        The clients are generated from the schema: <a href="/vendor/query/history.py">history.py</a> (Python, stdlib only) and <a href="/vendor/query/history.ts">history.ts</a>. Scripts log in with a token (<code>POST /api/auth/dev/login</code> returns one).
      </p>
    </div>
  );
}
