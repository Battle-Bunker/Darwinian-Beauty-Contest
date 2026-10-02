// A very small pushState router: three page shapes don't need a library.
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const EVENT = "dbc:navigate";

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

export type Route =
  | { page: "home" }
  | { page: "room"; room: string }
  | { page: "game"; room: string; game: string }
  | { page: "notfound" };

export function parseRoute(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { page: "home" };
  let m = p.match(/^\/room\/([^/]+)$/);
  if (m) return { page: "room", room: decodeURIComponent(m[1]) };
  m = p.match(/^\/room\/([^/]+)\/game\/([^/]+)$/);
  if (m) return { page: "game", room: decodeURIComponent(m[1]), game: decodeURIComponent(m[2]) };
  return { page: "notfound" };
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={click} {...rest} />;
}
