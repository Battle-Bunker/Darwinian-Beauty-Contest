// A flower's response as the viewer gets it. Up to 4 KB it comes whole (`r`); over 4 KB, everywhere it
// streams (actions, the ledger, query rows) it comes as its size, its SHA-256 and its first 4 KB of JSON
// text, and the whole of it is at GET base/responses/:seq, fetched only when someone asks for it.
import { useState } from "react";
import { Value } from "./Value";
import { fmtBytes } from "../lib/format";

export { fmtBytes };

export interface ResponseParts { r: unknown; bytes?: number | null; hash?: string | null; preview?: string | null }

/** Whether a response came as a preview (over 4 KB), not inline. */
export const isBig = (p: ResponseParts) => !!p.hash || (p.r === null && typeof p.preview === "string");
/** Whether the flower gave no response at all (late, an error, a malformed or oversized return). */
export const noResponse = (p: ResponseParts) => (p.r === null || p.r === undefined) && !isBig(p);

export const partsOfAction = (a: { r?: unknown; rBytes?: number | null; rHash?: string | null; rPreview?: string | null }): ResponseParts =>
  ({ r: a.r ?? null, bytes: a.rBytes ?? null, hash: a.rHash ?? null, preview: a.rPreview ?? null });


/** The URL of a turn's whole response (seq: the turn's feed or leave action). */
export const responseUrl = (base: string, seq: number) => `/api${base}/responses/${seq}`;

/**
 * A response, compactly: inline values as they are; big ones as their size and preview, expandable, with
 * a button that loads the whole thing (never fetched until asked) and a link to it.
 */
export function ResponseView({ p, url, max = 24, failedText }: { p: ResponseParts; url?: string | null; max?: number; failedText?: string }) {
  if (!isBig(p)) {
    if (p.r === null || p.r === undefined) return <span className="bad-text mono" title={failedText ?? "no response"}>None</span>;
    return <Value v={p.r} role="response" max={max} />;
  }
  const head = p.preview ? `${p.preview.slice(0, Math.max(8, max - 10))}…` : "not shown inline";
  return (
    <details className="val big-r">
      <summary title={`A ${fmtBytes(p.bytes)} response: shown as its first 4 KB${p.hash ? ` · SHA-256 ${p.hash}` : ""}`}>
        <span className="big-r-size">{fmtBytes(p.bytes)}</span> <span className="mono val-sum">{head}</span>
      </summary>
      <div className="val-full big-r-full">
        {p.preview ? <pre className="val-json">{p.preview}…</pre> : null}
        <span className="small muted">
          {p.preview ? "The first 4 KB of " : "A response of "}{(p.bytes ?? 0).toLocaleString()} bytes of JSON{p.hash ? <> · SHA-256 <span className="mono">{p.hash.slice(0, 16)}…</span></> : null}
        </span>
        {url && <FullResponse url={url} bytes={p.bytes ?? null} hash={p.hash ?? null} />}
      </div>
    </details>
  );
}

const SHOW = 200_000; // characters of a loaded response shown on the page (the rest: download)

function FullResponse({ url, bytes, hash }: { url: string; bytes: number | null; hash: string | null }) {
  const [state, setState] = useState<{ busy?: boolean; text?: string; error?: string; ok?: boolean | null }>({});
  const load = async () => {
    setState({ busy: true });
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 404 ? "this turn has no stored response" : `${res.status} ${res.statusText}`);
      const text = await res.text();
      let ok: boolean | null = null;
      if (hash && globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        ok = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("") === hash;
      }
      setState({ text, ok });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([state.text ?? ""], { type: "application/json" }));
    a.download = `response-${url.split("/").pop()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="big-r-load">
      {state.text === undefined ? (
        <span className="row">
          <button className="btn btn-small btn-ghost" onClick={load} disabled={state.busy}>{state.busy ? "Loading…" : `Load the full response (${fmtBytes(bytes)})`}</button>
          <a className="small" href={url} target="_blank" rel="noreferrer">open it ↗</a>
        </span>
      ) : (
        <>
          <span className="small">
            {state.text.length.toLocaleString()} characters{state.ok === true ? <span className="ok-text"> · hash checks out</span> : state.ok === false ? <span className="bad-text"> · hash doesn't match</span> : null}
            {" "}<button className="link-btn" onClick={save}>save as a file</button>
          </span>
          <pre className="val-json big-r-text">{state.text.length > SHOW ? state.text.slice(0, SHOW) + `\n… ${(state.text.length - SHOW).toLocaleString()} more characters (save it to see them all)` : state.text}</pre>
        </>
      )}
      {state.error && <span className="small bad-text">{state.error}</span>}
    </div>
  );
}
