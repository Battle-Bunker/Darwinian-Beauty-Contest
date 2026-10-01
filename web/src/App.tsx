import { AuthGate } from "./auth";
import { parseRoute, usePath } from "./router";
import { Header } from "./components/Header";
import { HomePage } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { GamePage } from "./pages/Game";
import { Link } from "./router";

export function App() {
  const path = usePath();
  const route = parseRoute(path);
  return (
    <AuthGate>
      <Header route={route} />
      <main className="page">
        {route.page === "home" && <HomePage />}
        {route.page === "room" && <RoomPage key={route.room} room={route.room} />}
        {route.page === "game" && <GamePage key={`${route.room}/${route.game}`} room={route.room} game={route.game} />}
        {route.page === "notfound" && (
          <div className="card narrow">
            <h1>Nothing grows here</h1>
            <p className="muted">That page doesn't exist.</p>
            <Link className="btn" to="/">Go home</Link>
          </div>
        )}
      </main>
    </AuthGate>
  );
}
