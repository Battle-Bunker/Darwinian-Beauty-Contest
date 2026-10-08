#!/usr/bin/env bash
# (Re)start the arena's own game server (default port 4100) on the one-flower database (dbc_one).
#   arena/server.sh            restart on port 4100 with CPU_SLOTS=2 (programs on 2 of the 4 cores at once; the other 2
#                              for the server, runner, Postgres, sessions and scaffolds: see README, "The adapt experiment")
#   CPU_SLOTS=3 arena/server.sh  the setting of the pilot and signals arenas
#   PORT=4001 arena/server.sh  another port
#   FORCE=1 arena/server.sh    restart even while a game is running (its bees restart afresh; flowers are stateless)
# The dev-login secret comes from arena/runs/.dev-secret (mode 600; created if missing) and goes only into the server's
# environment. Only the server this script started on $PORT (arena/runs/server$PORT.pid) is ever stopped; servers on other
# ports (e.g. 3000, 3401) are never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4100}"
CPU_SLOTS="${CPU_SLOTS:-2}"
DB="${DATABASE_URL:-postgres://dbc:dbc@localhost:5432/dbc_one}"
case "$DB" in */dbc|*/dbc\?*|*/dbc_live|*/dbc_live\?*) echo "refusing $DB: the arena runs on dbc_one (dbc and dbc_live hold earlier experiments)" >&2; exit 1;; esac
LOG="arena/runs/server${PORT}.log"
SECRET_FILE="arena/runs/.dev-secret"
mkdir -p arena/runs

# Arena games (rooms owned by an "Arena owner ..." login) that are running: a restart would start their bees afresh.
running=$(psql "$DB" -Atc "SELECT count(*) FROM games g JOIN rooms r ON r.id = g.room_id JOIN users u ON u.id = r.owner_id
                            WHERE g.status = 'running' AND u.name LIKE 'Arena owner %'" 2>/dev/null || echo 0)
if [ "$running" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "$running arena game(s) running; a restart would start their bees afresh. Pause them or wait, or FORCE=1" >&2; exit 1
fi

# Stop only the server this script started on this port (its pid file), after checking it really is that server.
PIDFILE="arena/runs/server${PORT}.pid"
if [ -s "$PIDFILE" ]; then
  p=$(cat "$PIDFILE")
  if [ -r "/proc/$p/environ" ] && tr '\0' '\n' < "/proc/$p/environ" | grep -qx "PORT=$PORT" && tr '\0' ' ' < "/proc/$p/cmdline" | grep -q "server/index.js"; then
    echo "stopping server pid $p on :$PORT"; kill "$p"; sleep 1
  fi
  rm -f "$PIDFILE"
fi
if curl -s -m 2 -o /dev/null "http://localhost:$PORT/api/health"; then
  echo "something else is serving :$PORT (not started by this script); stop it yourself" >&2; exit 1
fi

umask 077
[ -s "$SECRET_FILE" ] || openssl rand -hex 24 > "$SECRET_FILE"
echo "=== start $(date +%T) port $PORT CPU_SLOTS=$CPU_SLOTS db ${DB##*/}" >> "$LOG"
DATABASE_URL="$DB" DEV_LOGIN_SECRET="$(cat "$SECRET_FILE")" PORT="$PORT" CPU_SLOTS="$CPU_SLOTS" \
  nohup node server/index.js >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "server pid $! on :$PORT (log $LOG)"
sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{"name":"probe"}' "http://localhost:$PORT/api/auth/dev/login")
echo "a login without the secret gets HTTP $code (expect 403)"
