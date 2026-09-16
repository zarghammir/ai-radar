#!/bin/sh
# Worker service. The ingestion entry is issue #5 and does not exist yet.
#
# A worker that cannot run must say so and exit non-zero. The alternative —
# sleeping, or exiting 0 — makes a missing ingester look exactly like an
# ingester that ran and found nothing, which is the failure this project's
# provenance rules exist to prevent.
set -eu

if [ -f /app/ops/worker.cjs ]; then
  echo "[worker] running one ingestion pass"
  exec node /app/ops/worker.cjs "$@"
fi

echo "[worker] NOT IMPLEMENTED: this image contains no worker entry." >&2
echo "[worker] src/worker/main.ts does not exist yet; issue #5 adds it." >&2
echo "[worker] The service is wired and will run it the moment that file lands." >&2
exit 78
