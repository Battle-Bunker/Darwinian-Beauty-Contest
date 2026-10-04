// A bee's MEMORY, read only: the one thing a bee keeps between calls. Only the bee writes it (nobody can
// edit it here or anywhere); its team reads it during play, everyone once the game is over. A new bee
// version starts it afresh, so "cleared" is when the version it belongs to went live.
import type { BeeMemory, GameView, Team } from "../types";
import { fmtClock } from "../lib/format";
import { Meter } from "./ui";

/** The memory as JSON for reading: short parts on one line, longer ones indented (the cap counts the compact form). */
export function pretty(v: unknown, indent = ""): string {
  let flat: string;
  try { flat = JSON.stringify(v) ?? "null"; } catch { return String(v); }
  if (flat.length <= 72 - indent.length || v === null || typeof v !== "object") return flat;
  const inner = indent + "  ";
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(",\n")}\n${indent}}`;
}

export function MemoryView({ memory, team, view, own = false }: { memory: BeeMemory; team: Team; view: GameView; own?: boolean }) {
  const roundMs = view.game.config.budgets.flower.ms + view.game.config.budgets.bee.ms;
  const version = team.programs?.bee?.find((v) => v.version === memory.version);
  const cleared = version
    ? version.atMs > 0 ? `cleared at ${fmtClock(version.atMs)} (round ${(Math.floor(version.atMs / roundMs) + 1).toLocaleString()}), when bee v${memory.version} went live` : `bee v${memory.version}'s, since the start`
    : `bee v${memory.version}'s`;
  const empty = memory.value === null || (typeof memory.value === "object" && Object.keys(memory.value as object).length === 0);
  return (
    <div className="memory">
      <div className="memory-head">
        <Meter label="MEMORY (bytes)" value={memory.bytes} max={memory.cap} />
        <span className="small muted">{cleared}. {own ? "Read only: only your bee writes it." : "Read only."}</span>
      </div>
      {memory.error && <p className="small warn-text memory-empty">The latest save was refused, so this is the memory from before it: <span className="mono">{memory.error}</span></p>}
      {empty ? <p className="small muted memory-empty">Empty ({"{}"}).</p> : <pre className="memory-value" aria-label={`${team.name}'s bee MEMORY`}>{pretty(memory.value)}</pre>}
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
          </summary>
          <MemoryView memory={t.memory!} team={t} view={view} />
        </details>
      ))}
    </div>
  );
}
