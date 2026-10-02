// A plain <textarea> over a highlighted <pre>, like quine-court's editor: syntax colours from
// tree-sitter, plus diff marks (inserted / deleted text) against last round's program.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getLangTools, paint, type Complexity, type Language, type Mark } from "../lib/codetools";

/** size: in the game's complexity unit; minified: the text the game runs. */
export interface EditorStats { size: number; minified: string; syntaxError: boolean; distance: number | null }

interface Highlight { code: string; syntax: Mark[]; diff: Mark[]; prevHtml: string | null }

export function CodeEditor({ value, onChange, language, mode = "chars", previous = null, readOnly = false, onStats, label, showPrevious = false, placeholder }: {
  value: string;
  mode?: Complexity;
  onChange?: (code: string) => void;
  language: Language;
  previous?: string | null;
  readOnly?: boolean;
  onStats?: (s: EditorStats | null) => void;
  label: string;
  showPrevious?: boolean;
  placeholder?: string;
}) {
  const [hl, setHl] = useState<Highlight>({ code: "", syntax: [], diff: [], prevHtml: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const statsRef = useRef(onStats);
  statsRef.current = onStats;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const tools = await getLangTools(language);
        if (cancelled) return;
        const parsed = tools.parse(value, mode);
        const syntax = tools.syntax(value);
        let diff: Mark[] = [], prevHtml: string | null = null, distance: number | null = null;
        if (previous !== null) {
          const d = tools.diff(previous, value, mode);
          diff = d.new;
          distance = d.distance;
          prevHtml = paint(previous, tools.syntax(previous), d.old);
        }
        setHl({ code: value, syntax, diff, prevHtml });
        statsRef.current?.({ size: parsed.size, minified: parsed.minified, syntaxError: parsed.hasError, distance });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    }, hl.code ? 90 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, previous, language, mode]);

  // While a fresh highlight is computing, reuse the last marks so colours don't flicker.
  const html = useMemo(() => paint(value, hl.syntax, hl.diff), [value, hl]);
  const lines = useMemo(() => value.split("\n").length, [value]);

  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const escaped = useRef(false);
  const indentUnit = language === "python" ? "    " : "  ";

  const sync = () => {
    const t = ta.current;
    if (!t) return;
    if (pre.current) { pre.current.scrollTop = t.scrollTop; pre.current.scrollLeft = t.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = t.scrollTop;
  };

  const insert = (text: string) => {
    const t = ta.current!;
    // execCommand keeps the browser's undo history; fall back to setRangeText.
    if (!document.execCommand?.("insertText", false, text)) {
      t.setRangeText(text, t.selectionStart, t.selectionEnd, "end");
      onChange?.(t.value);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    if (e.key === "Escape") { escaped.current = true; return; }
    if (e.key === "Tab") {
      if (escaped.current) { escaped.current = false; return; } // let Tab move focus after Esc
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value: v } = t;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      if (s === en && !e.shiftKey) { insert(indentUnit); return; }
      // Indent or dedent every selected line.
      const lineEnd = v.indexOf("\n", en - (en > s && v[en - 1] === "\n" ? 1 : 0));
      const blockEnd = lineEnd === -1 ? v.length : lineEnd;
      const block = v.slice(lineStart, blockEnd);
      const changed = block.split("\n").map((l) => {
        if (!e.shiftKey) return indentUnit + l;
        const m = l.match(new RegExp(`^ {1,${indentUnit.length}}`));
        return m ? l.slice(m[0].length) : l;
      }).join("\n");
      t.setSelectionRange(lineStart, blockEnd);
      insert(changed);
      t.setSelectionRange(lineStart, lineStart + changed.length);
      return;
    }
    escaped.current = false;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const { selectionStart: s, value: v } = t;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const line = v.slice(lineStart, s);
      let indent = (line.match(/^[ \t]*/) || [""])[0];
      const trimmed = line.replace(/\s*(#.*|\/\/.*)?$/, "");
      if (language === "python" ? trimmed.endsWith(":") : /[{[(]$/.test(trimmed)) indent += indentUnit;
      e.preventDefault();
      insert("\n" + indent);
    }
  };

  const gutterText = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join("\n") + "\n\n", [lines]);
  const rows = Math.min(28, Math.max(readOnly ? 3 : 10, lines + 1));
  const height = `calc(${rows} * var(--code-lh) + 2 * var(--code-pad))`;

  return (
    <div className={`code-wrap ${showPrevious && hl.prevHtml !== null ? "with-prev" : ""}`}>
      {showPrevious && previous !== null && (
        <div className="code-pane">
          <div className="code-pane-label">Last round <span className="muted">(deleted and changed parts)</span></div>
          <div className="code-box" style={{ height }}>
            <pre className="code-hl code-ro" dangerouslySetInnerHTML={{ __html: hl.prevHtml ?? paint(previous, []) }} />
          </div>
        </div>
      )}
      <div className="code-pane">
        {showPrevious && previous !== null && <div className="code-pane-label">Now <span className="muted">(new and changed parts)</span></div>}
        <div className={`code-box ${readOnly ? "readonly" : ""}`} style={{ height }}>
          <pre className="code-gutter" ref={gutter} aria-hidden>{gutterText}</pre>
          <div className="code-area">
            <pre className={`code-hl ${readOnly ? "code-ro" : ""}`} ref={pre} aria-hidden={!readOnly} dangerouslySetInnerHTML={{ __html: html }}
              onScroll={readOnly ? () => { if (gutter.current && pre.current) gutter.current.scrollTop = pre.current.scrollTop; } : undefined} />
            {!readOnly && (
              <textarea ref={ta} className="code-input" value={value} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off"
                wrap="off" aria-label={label} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} onScroll={sync} onKeyDown={onKeyDown}
                onKeyUp={sync} onSelect={sync} />
            )}
          </div>
        </div>
      </div>
      {loadError && <p className="error-text">Couldn't load the syntax checker: {loadError}</p>}
    </div>
  );
}

/** Read-only code with syntax colours and (optionally) diff marks against a previous version. */
export function CodeView({ code, language, mode, previous = null, showPrevious = false, label }: { code: string; language: Language; mode?: Complexity; previous?: string | null; showPrevious?: boolean; label: string }) {
  return <CodeEditor value={code} language={language} mode={mode} previous={previous} readOnly showPrevious={showPrevious} label={label} />;
}
