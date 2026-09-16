#!/bin/sh
# Web service: bring the schema up to date, make sure the shipped catalogue is
# present, then hand the process over to the server.
set -eu

echo "[web] applying migrations"
node /app/ops/migrate.cjs

# The seed is a keyed upsert that never overwrites operational state and never
# deletes, so it is safe on every start rather than only on an empty database.
# Running it unconditionally is also what lets a catalogue addition reach an
# existing deployment; a first-run-only seed would strand it.
echo "[web] seeding the source catalogue (idempotent)"
node /app/ops/seed.cjs

echo "[web] starting the Next server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node /app/server.js
