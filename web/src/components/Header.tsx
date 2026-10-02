import { useEffect, useState } from "react";
import { useMe } from "../auth";
import { Link, type Route } from "../router";
import { storage } from "../hooks";
import { AutoIcon, BeeGlyph, FlowerHead, MoonIcon, SunIcon } from "./Icons";

type Theme = "auto" | "light" | "dark";

function applyTheme(t: Theme) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

export function Header({ route }: { route: Route }) {
  const { user, logout } = useMe();
  const [theme, setTheme] = useState<Theme>(() => (storage.get("dbc:theme") as Theme) || "auto");
  useEffect(() => { applyTheme(theme); storage.set("dbc:theme", theme === "auto" ? null : theme); }, [theme]);
  const next: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
  const label = { auto: "Theme: follows your device", light: "Theme: light", dark: "Theme: dark" }[theme];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Darwinian Beauty Contest home">
          <span className="brand-art" aria-hidden><FlowerHead color="#e4572e" size={22} /><BeeGlyph color="#f2a541" size={24} /></span>
          <span className="brand-name">Darwinian Beauty Contest</span>
        </Link>
        <nav className="crumbs" aria-label="Breadcrumbs">
          {route.page !== "home" && route.page !== "notfound" && <Link to={`/room/${route.room}`}>Room {route.room}</Link>}
          {route.page === "game" && <><span aria-hidden>›</span><Link to={`/room/${route.room}/game/${route.game}`}>Game {route.game}</Link></>}
        </nav>
        <div className="topbar-right">
          <button className="icon-btn" onClick={() => setTheme(next[theme])} title={label} aria-label={label}>
            {theme === "auto" ? <AutoIcon /> : theme === "light" ? <SunIcon /> : <MoonIcon />}
          </button>
          <span className="who" title={`Logged in as ${user.name}`}>{user.name}</span>
          <button className="btn btn-small btn-ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    </header>
  );
}
