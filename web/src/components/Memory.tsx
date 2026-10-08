// A bee's MEMORY, read only: the one thing a bee keeps from one turn to the next. It's a small, flat
// key–value store (string keys; string, number, boolean or null values), 50 bytes by default, where an
// entry's size is its key's UTF-8 bytes plus its value's JSON bytes. Only the bee writes it (nobody can
// edit it here or anywhere); its team reads it during play, everyone once the game is over. A new bee
// version starts it afresh, so "cleared" is when the version it belongs to went live.
import { roundMsOf, type BeeMemory, type GameView, type MemoryValue, type Team } from "../types";
import { fmtClock } from "../lib/format";
import { Meter } from "./ui";

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** The entries of a flat MEMORY with each one's size, or null if it isn't a flat key–value store. */
export function memoryEntries(v: unknown): { key: string; value: MemoryValue; bytes: number }[] | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = [];
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (value !== null && typeof value === "object") return null;
    out.push({ key, value: value as MemoryValue, bytes: utf8(key) + utf8(JSON.stringify(value) ?? "null") });
  }
  return out;
}

/** A MEMORY's size by the game's rule (null if it isn't a flat key–value store). */
export const memorySize = (v: unknown) => memoryEntries(v)?.reduce((s, e) => s + e.bytes, 0) ?? null;

/** JSON for reading: short parts on one line, longer ones indented. */
export function pretty(v: unknown, indent = ""): string {
  let flat: string;
  try { flat = JSON.stringify(v) ?? "null"; } catch { return String(v); }
  if (flat.length <= 72 - indent.length || v === null || typeof v !== "object") return flat;
  const inner = indent + "  ";
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(",\n")}\n${indent}}`;
}

/** The entries as a small table: key, value, and the bytes each one takes. */
export function MemoryEntries({ value, label }: { value: unknown; label: string }) {
  const entries = memoryEntries(value);
  if (!entries) return <pre className="memory-value" aria-label={label}>{pretty(value)}</pre>;
  if (!entries.length) return <p className="small muted memory-empty">Empty: {"{}"}.</p>;
  return (
    <table className="data-table memory-table" aria-label={label}>
      <thead><tr><th className="left">key</th><th className="left">value</th><th title="UTF-8 bytes of the key + of the value's JSON">bytes</th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.key}>
            <td className="left mono">{JSON.stringify(e.key)}</td>
            <td className="left mono">{JSON.stringify(e.value)}</td>
            <td title={`${utf8(e.key)} + ${e.bytes - utf8(e.key)}`}>{e.bytes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MemoryView({ memory, team, view, own = false }: { memory: BeeMemory; team: Team; view: GameView; own?: boolean }) {
  const roundMs = roundMsOf(view.game.config);
  const version = team.programs?.bee?.find((v) => v.version === memory.version);
  const cleared = version
    ? version.atMs > 0 ? `cleared at ${fmtClock(version.atMs)} (round ${(Math.floor(version.atMs / roundMs) + 1).toLocaleString()}), when bee v${memory.version} went live` : `bee v${memory.version}'s, since the start`
    : `bee v${memory.version}'s`;
  return (
    <div className="memory">
      <div className="memory-head">
        <Meter label="MEMORY (bytes)" value={memory.bytes} max={memory.cap} />
        <span className="small muted">{cleared}. {own ? "Read only: only your bee writes it." : "Read only."}</span>
      </div>
      {memory.error && <p className="small warn-text memory-empty">The last save failed, so this is the memory from before it: <span className="mono">{memory.error}</span></p>}
      <MemoryEntries value={memory.value} label={`${team.name}'s bee MEMORY`} />
    </div>
  );
}

/** Every bee's MEMORY as the game ended (after the game everything is revealed). */
export function MemoryTable({ view, teams }: { view: GameView; teams: Team[] }) {
  const withMemory = teams.filter((t) => t.memory);
  if (!withMemory.length) return <p className="small muted">No bee memories to show.</p>;
  return (
    <div className="memory-grid">
      {withMemory.map((t) => (
        <details key={t.id} className="memory-card" style={{ ["--team" as string]: t.color }}>
          <summary>
            <span className="team-chip"><span className="swatch" style={{ background: t.color }} /><span className="team-name">{t.name}</span>{t.id === view.me?.teamId && <span className="you-tag">you</span>}</span>
            <span className="small muted">{t.memory!.bytes.toLocaleString()} / {t.memory!.cap.toLocaleString()} bytes · bee v{t.memory!.version}</span>
            {t.memory!.error && <span className="small warn-text">last save failed</span>}
          </summary>
          <MemoryView memory={t.memory!} team={t} view={view} />
        </details>
      ))}
    </div>
  );
}
