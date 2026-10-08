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
# Cores (docs/research/compute-budgets/REPORT.md §4.3): the agents run in cpuset/dbc-agents (cores 0-1, made by the arena
# runner), the game's program runners in cpuset/dbc-runners (cores 2-3, made by the engine), and the server itself in
# cpuset/dbc-rest (cores 0-1). The server goes there only once dbc-runners exists, so its runners have their own cores to
# move to (ARENA_SERVER_CPUSET=0: leave it where it is). Postgres, a system service, is left where it is.
CG=/sys/fs/cgroup/cpuset
JOIN=""
if [ "${ARENA_SERVER_CPUSET:-1}" != "0" ] && [ -d "$CG/dbc-runners" ]; then
  if mkdir -p "$CG/dbc-rest" 2>/dev/null && echo 0-1 > "$CG/dbc-rest/cpuset.cpus" 2>/dev/null && echo 0 > "$CG/dbc-rest/cpuset.mems" 2>/dev/null; then
    JOIN="$CG/dbc-rest/cgroup.procs"
  else
    echo "*** could not set up $CG/dbc-rest: the server runs on every core" | tee -a "$LOG" >&2
  fi
elif [ "${ARENA_SERVER_CPUSET:-1}" != "0" ]; then
  echo "(no $CG/dbc-runners yet: the server and its runners stay on every core)" >> "$LOG"
fi
echo "=== start $(date +%T) port $PORT CPU_SLOTS=$CPU_SLOTS db ${DB##*/}${JOIN:+ cpuset dbc-rest}" >> "$LOG"
DATABASE_URL="$DB" DEV_LOGIN_SECRET="$(cat "$SECRET_FILE")" PORT="$PORT" CPU_SLOTS="$CPU_SLOTS" JOIN="$JOIN" \
  nohup sh -c 'if [ -n "$JOIN" ]; then echo $$ > "$JOIN" || echo "could not join $JOIN" >&2; fi; exec node server/index.js' >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "server pid $! on :$PORT (log $LOG)"
sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{"name":"probe"}' "http://localhost:$PORT/api/auth/dev/login")
echo "a login without the secret gets HTTP $code (expect 403)"
