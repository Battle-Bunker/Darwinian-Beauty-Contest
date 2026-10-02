#!/usr/bin/env bash
# Local Postgres for development: starts the system cluster and creates role/database `dbc`.
# The app reads DATABASE_URL (default postgres://dbc:dbc@localhost:5432/dbc); production supplies its own.
set -euo pipefail
if command -v pg_lsclusters >/dev/null && pg_lsclusters | grep -q down; then
  (service postgresql start || sudo service postgresql start) >/dev/null
fi
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }
run "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='dbc'\" | grep -q 1 || psql -c \"CREATE ROLE dbc LOGIN PASSWORD 'dbc' CREATEDB\""
run "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='dbc'\" | grep -q 1 || createdb -O dbc dbc"
echo "postgres ready: postgres://dbc:dbc@localhost:5432/dbc"
