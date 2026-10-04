// Pollen grains: on every feed the bee's team gets a run of the answering flower version's minified code,
// from an unknown start, wrapping past the end. This panel groups a team's grains by species and version,
// assembles them (best effort: overlapping grains joined into pieces, unknown characters as gaps), and,
// where the real code can be seen (your own flower, or every flower once a revealed game is over),
// shows exactly which characters leaked.
import { useEffect, useMemo, useState } from "react";
import type { GameView, Team } from "../types";
import { assemble, guessStart, inCode, MIN_OVERLAP, placeGrains, type Assembly } from "../lib/assemble";
import { getLangTools } from "../lib/codetools";
import { plural } from "../lib/format";

export interface GrainRec { bee: number; flower: number; version: number; grain: string; codeLength: number; round: number }

/** Grains as one line of text: newlines and tabs shown, so a grain keeps its shape in a chip. */
export const showGrain = (g: string, max = 40) => {
  const t = g.replace(/\n/g, "⏎").replace(/\t/g, "⇥");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

/** A feed's grain, marked as one (feed rows, the inspector, the strip). */
export function GrainChip({ grain, version, length, max = 32 }: { grain: string; version?: number | null; length?: number | null; max?: number }) {
  return (
    <span className="grain" title={`Pollen grain: ${grain.length} characters of flower v${version ?? "?"}'s minified code (${length ?? "?"} characters), from an unknown start\n\n${grain}`}>
      <span className="grain-tag">pollen grain</span>
      <code className="grain-text">{showGrain(grain, max)}</code>
      {version != null && <span className="grain-from">v{version}{length ? ` · ${length} ch` : ""}</span>}
    </span>
  );
}

interface Group { flower: number; version: number; codeLength: number; grains: string[]; bees: Set<number>; first: number; last: number }

export function PollenPanel({ view, teams, grains, mine, during }: {
  view: GameView; teams: Team[]; grains: GrainRec[]; mine: number | null;
  /** During play: only what the viewer's team may see (its own bee's grains, unless grains are public). */
  during: boolean;
}) {
  const multi = useMemo(() => new Set(grains.map((g) => g.bee)).size > 1, [grains]);
  const [by, setBy] = useState<string>(() => (during && mine !== null ? String(mine) : ""));
  const shown = by === "" ? grains : grains.filter((g) => g.bee === Number(by));
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of shown) {
      const k = `${g.flower}:${g.version}`;
      let x = m.get(k);
      if (!x) m.set(k, (x = { flower: g.flower, version: g.version, codeLength: g.codeLength, grains: [], bees: new Set(), first: g.round, last: g.round }));
      x.grains.push(g.grain); x.bees.add(g.bee);
      x.first = Math.min(x.first, g.round); x.last = Math.max(x.last, g.round);
    }
    return [...m.values()].sort((a, b) => a.flower - b.flower || a.version - b.version);
  }, [shown]);
  const species = [...new Set(groups.map((g) => g.flower))];
  const cfg = view.game.config;
  const mode = cfg.grains ?? "feeder";

  if (mode === "off") return <p className="small muted">Pollen grains are off in this game.</p>;
  return (
    <div className="pollen stack">
      <p className="small muted">
        On every feed the bee's team gets a pollen grain: ⌊{(cfg.pollenGrain?.scale ?? 1) !== 1 ? `${cfg.pollenGrain?.scale} × ` : ""}pollen^{fmtExp(cfg.pollenGrain?.exponent ?? 1 / 3)}⌋ characters of the answering flower version's minified code, from a start nobody is told, wrapping past the end.
        {" "}{during ? (mode === "public" ? "Grains are public in this game." : "Only your team sees its bee's grains until the game ends.") : "Everyone's are revealed now."}
        {" "}Below, each version's grains are joined where they overlap ({MIN_OVERLAP}+ characters) into pieces of its code: a best-effort reconstruction, with unknown characters as gaps.
      </p>
      {(multi || !during) && (
        <label className="feed-filter"><span>Collected by</span>
          <select value={by} onChange={(e) => setBy(e.target.value)} aria-label="Collected by">
            <option value="">every bee</option>
            {teams.map((t, i) => <option key={t.id} value={i}>{t.name}{i === mine ? " (you)" : ""}</option>)}
          </select>
        </label>
      )}
      {!groups.length ? <p className="muted">{during ? "No grains yet: your bee gets one on every feed (with pollen)." : "No grains."}</p> : (
        <>
          <p className="small"><b>{plural(shown.length, "grain")}</b> from <b>{plural(species.length, "species", "species")}</b>, {plural(groups.length, "flower version")}.</p>
          {species.map((f) => (
            <div key={f} className="pollen-species" style={{ ["--team" as string]: teams[f]?.color }}>
              <div className="pollen-species-head">
                <span className="team-chip"><span className="swatch" style={{ background: teams[f]?.color }} /><span className="team-name">{teams[f]?.name ?? `team ${f}`}</span>{f === mine && <span className="you-tag">you</span>}</span>
                <span className="small muted">flower species</span>
              </div>
              {groups.filter((g) => g.flower === f).map((g) => (
                <VersionGrains key={`${g.flower}:${g.version}`} g={g} team={teams[f]} teams={teams} language={cfg.language} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const fmtExp = (e: number) => (Math.abs(e - 1 / 3) < 1e-9 ? "(1/3)" : `${+e.toFixed(3)}`);

function VersionGrains({ g, team, teams, language }: { g: Group; team: Team | undefined; teams: Team[]; language: "python" | "typescript" }) {
  const [open, setOpen] = useState(false);
  const asm = useMemo(() => (open ? assemble(g.grains, g.codeLength) : null), [open, g]);
  const quick = useMemo(() => {
    // A cheap count for the summary: distinct grains and their characters (no assembly until opened).
    const d = new Set(g.grains);
    return { distinct: d.size };
  }, [g]);
  const source = team?.programs?.flower?.find((v) => v.version === g.version)?.code;
  return (
    <details className="pollen-version" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <b>v{g.version}</b>
        <span className="small muted">{g.codeLength.toLocaleString()} characters of minified code · {plural(g.grains.length, "grain")}{quick.distinct < g.grains.length ? ` (${quick.distinct} different)` : ""} · rounds {g.first.toLocaleString()}–{g.last.toLocaleString()}</span>
        {g.bees.size > 1 && <span className="small muted">from {g.bees.size} bees</span>}
        {asm && <RecoveredBadge asm={asm} />}
      </summary>
      {asm && (
        <div className="pollen-body">
          <Reconstruction asm={asm} />
          {source !== undefined && <Compare source={source} language={language} grains={g.grains} asm={asm} codeLength={g.codeLength} />}
          <details className="pollen-raw">
            <summary className="small">The grains ({g.grains.length})</summary>
            <ul className="pollen-grains">
              {[...new Set(g.grains)].map((x, i) => <li key={i}><code>{showGrain(x, 200)}</code></li>)}
            </ul>
            {g.bees.size > 0 && <p className="small muted">Collected by {[...g.bees].map((b) => teams[b]?.name ?? b).join(", ")}.</p>}
          </details>
        </div>
      )}
    </details>
  );
}

function RecoveredBadge({ asm }: { asm: Assembly }) {
  const pct = Math.round((asm.known / asm.length) * 100);
  return <span className={`pollen-badge ${asm.complete ? "full" : ""}`}>{asm.complete ? "whole code recovered" : `≈ ${pct}% in ${plural(asm.contigs.length, "piece")}`}</span>;
}

/** The pieces, in no known order, with the unknown characters between them as gaps. */
function Reconstruction({ asm }: { asm: Assembly }) {
  if (asm.complete) {
    return (
      <div className="pollen-recon">
        <div className="small muted">The whole code, {asm.length.toLocaleString()} characters (where it starts is a guess: grains don't say).</div>
        <pre className="pollen-code">{guessStart(asm.contigs[0])}</pre>
      </div>
    );
  }
  const unknown = Math.max(0, asm.length - asm.known);
  return (
    <div className="pollen-recon">
      <div className="small muted">
        {plural(asm.contigs.length, "piece")} recovered, {asm.known.toLocaleString()} of {asm.length.toLocaleString()} characters; about {unknown.toLocaleString()} unknown, in gaps of unknown size between the pieces (their order isn't known either).
      </div>
      <pre className="pollen-code">
        {asm.contigs.map((c, i) => (
          <span key={i}>{i > 0 && <span className="pollen-gap" title="unknown characters">{"  ░░ ? ░░  "}</span>}<span className="pollen-piece">{c}</span></span>
        ))}
        <span className="pollen-gap" title="unknown characters">{"  ░░ ? ░░"}</span>
      </pre>
    </div>
  );
}

/** The real minified code, with what leaked through grains marked (when the code can be seen). */
function Compare({ source, language, grains, asm, codeLength }: { source: string; language: "python" | "typescript"; grains: string[]; asm: Assembly; codeLength: number }) {
  const [minified, setMinified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getLangTools(language).then((t) => { if (live) setMinified(t.parse(source).minified); }, (e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [source, language]);
  const placed = useMemo(() => (minified !== null ? placeGrains(minified, grains) : null), [minified, grains]);
  if (error) return <p className="small bad-text">Couldn't minify the code to compare: {error}</p>;
  if (minified === null || !placed) return <p className="small muted">Minifying the real code to compare…</p>;
  const wrong = asm.contigs.filter((c) => !inCode(minified, c)).length;
  // Runs of leaked and unleaked characters.
  const runs: { leaked: boolean; text: string }[] = [];
  for (let i = 0; i < minified.length; i++) {
    const leaked = placed.covered[i] === 1;
    const last = runs[runs.length - 1];
    if (last && last.leaked === leaked) last.text += minified[i]; else runs.push({ leaked, text: minified[i] });
  }
  return (
    <div className="pollen-compare">
      <div className="small">
        <b>Compared with the real code</b>{minified.length !== codeLength ? <span className="warn-text"> (it minifies to {minified.length} characters here, not {codeLength}: the comparison may be off)</span> : null}:
        {" "}the grains cover <b>{Math.round(placed.fraction * 100)}%</b> of it
        {placed.missing ? <span className="warn-text">; {plural(placed.missing, "grain")} not found in it</span> : null}
        {"; "}{wrong ? <span className="bad-text">{plural(wrong, "recovered piece")} {wrong === 1 ? "isn't" : "aren't"} in it (a wrong join where the code repeats itself)</span> : <span className="ok-text">every recovered piece is in it</span>}.
      </div>
      <pre className="pollen-code pollen-real" aria-label="The real minified code: leaked characters marked">
        {runs.map((r, i) => <span key={i} className={r.leaked ? "leaked" : "unleaked"}>{r.text}</span>)}
      </pre>
    </div>
  );
}
