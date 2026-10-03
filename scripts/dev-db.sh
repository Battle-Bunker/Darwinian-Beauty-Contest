#!/usr/bin/env bash
# Local Postgres for development: starts the system cluster and creates role `dbc` and database `dbc_one`.
# The app reads DATABASE_URL (default postgres://dbc:dbc@localhost:5432/dbc_one); production supplies its own.
set -euo pipefail
if command -v pg_lsclusters >/dev/null && pg_lsclusters | grep -q down; then
  (service postgresql start || sudo service postgresql start) >/dev/null
fi
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }
run "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='dbc'\" | grep -q 1 || psql -c \"CREATE ROLE dbc LOGIN PASSWORD 'dbc' CREATEDB\""
run "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='dbc_one'\" | grep -q 1 || createdb -O dbc dbc_one"
echo "postgres ready: postgres://dbc:dbc@localhost:5432/dbc_one"
