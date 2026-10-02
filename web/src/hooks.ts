import { useEffect, useRef, useState } from "react";

/** Subscribe to a Server-Sent Events stream of JSON messages. EventSource reconnects by itself. */
export function useEventStream(url: string | null, onMessage: (data: any) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try { handler.current(JSON.parse(ev.data)); } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [url]);
}

/** Width of an element, kept up to date with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* private mode etc. */ }
  },
};

export function useDocumentTitle(title: string) {
  useEffect(() => { document.title = title; }, [title]);
}
