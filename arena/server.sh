#!/usr/bin/env bash
# (Re)start the arena's own game server (default port 4000), only when no round is simulating.
#   arena/server.sh            restart on port 4000 with CPU_SLOTS=3
#   PORT=4001 arena/server.sh  another port
# The dev-login secret comes from arena/runs/.dev-secret (mode 600; created if missing) and goes only into the server's
# environment. Servers on other ports (e.g. 3000, 3100) are never touched: only a node server/index.js process whose
# environment says PORT=$PORT is stopped.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4000}"
CPU_SLOTS="${CPU_SLOTS:-3}"
DB="${DATABASE_URL:-postgres://dbc:dbc@localhost:5432/dbc}"
LOG="arena/runs/server${PORT}.log"
SECRET_FILE="arena/runs/.dev-secret"

running=$(psql "$DB" -Atc "SELECT count(*) FROM games WHERE running_round IS NOT NULL")
if [ "$running" != "0" ]; then echo "a round is simulating ($running); not restarting" >&2; exit 1; fi

for p in $(pgrep -f "node server/index.js" || true); do
  if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "PORT=$PORT"; then echo "stopping server pid $p on :$PORT"; kill "$p"; fi
done
sleep 1

umask 077
[ -s "$SECRET_FILE" ] || openssl rand -hex 24 > "$SECRET_FILE"
echo "=== start $(date +%T) port $PORT CPU_SLOTS=$CPU_SLOTS" >> "$LOG"
DEV_LOGIN_SECRET="$(cat "$SECRET_FILE")" PORT="$PORT" CPU_SLOTS="$CPU_SLOTS" MAX_CONCURRENT_ROUNDS="${MAX_CONCURRENT_ROUNDS:-8}" \
  nohup node server/index.js >> "$LOG" 2>&1 &
sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{"name":"probe"}' "http://localhost:$PORT/api/auth/dev/login")
echo "server on :$PORT; a login without the secret gets HTTP $code (expect 403)"
