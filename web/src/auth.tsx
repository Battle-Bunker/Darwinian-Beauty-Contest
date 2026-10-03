// Who's logged in, and the login screen. The provider decides the flow (GET /api/me → auth.kind):
//   "name-form": ask for a name and POST {name} to auth.loginUrl (the dev provider)
//   "redirect":  send the browser to auth.loginUrl (e.g. Replit Auth)
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, errorText, onUnauthorized } from "./api";
import type { MeResponse, User } from "./types";
import { BeeGlyph, FlowerHead } from "./components/Icons";

interface MeCtx { user: User; logout: () => Promise<void> }
const Ctx = createContext<MeCtx | null>(null);

export function useMe(): MeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe outside AuthGate");
  return v;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMe(await api<MeResponse>("GET", "/me"));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onUnauthorized(() => { load(); }), [load]);

  const logout = useCallback(async () => {
    await api("POST", "/auth/logout").catch(() => {});
    await load();
  }, [load]);

  if (error && !me) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>Can't reach the garden</h1>
          <p className="muted">{error}</p>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!me) return <div className="center-screen"><div className="loading-bee"><BeeGlyph color="#f2a541" size={48} /></div></div>;
  if (!me.user) return <Login me={me} onDone={load} />;
  return <Ctx.Provider value={{ user: me.user, logout }}>{children}</Ctx.Provider>;
}

function Login({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Some servers (e.g. arenas) also want a login secret; the form asks for it only when the server does.
  const [needSecret, setNeedSecret] = useState(false);
  const [secret, setSecret] = useState("");
  const redirect = me.auth.kind === "redirect";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (redirect) {
      const sep = me.auth.loginUrl.includes("?") ? "&" : "?";
      location.href = `${me.auth.loginUrl}${sep}returnTo=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", me.auth.loginUrl, { name: name.trim(), ...(needSecret ? { secret } : {}) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && /secret/i.test(err.message)) setNeedSecret(true);
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="center-screen login-screen">
      <form className="card narrow login-card" onSubmit={submit}>
        <div className="login-art" aria-hidden>
          <FlowerHead color="#e4572e" size={44} />
          <BeeGlyph color="#f2a541" size={50} />
          <FlowerHead color="#0072b2" petals={8} size={44} />
        </div>
        <h1>Darwinian Beauty Contest</h1>
        <p className="muted">Write a flower that bees want to feed at, and a bee that knows where the nectar is.</p>
        {redirect ? (
          <button className="btn btn-big" type="submit">Log in to play</button>
        ) : (
          <>
            <label className="field">
              <span>What's your name?</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Ada" autoComplete="nickname" />
            </label>
            {needSecret && (
              <label className="field">
                <span>Login secret</span>
                <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" />
              </label>
            )}
            <button className="btn btn-big" type="submit" disabled={busy || !name.trim()}>{busy ? "Opening the gate…" : "Enter the garden"}</button>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
