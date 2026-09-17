#!/bin/sh
# Worker service. The ingestion entry is src/worker/main.ts, bundled to
# /app/ops/worker.cjs by the Dockerfile when that file is present.
#
# The fallback below is still reachable: the Dockerfile bundles the entry
# conditionally, so an image built from a tree without it has no worker.
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
echo "[worker] /app/ops/worker.cjs is missing: the image was built from a tree" >&2
echo "[worker] with no src/worker/main.ts, so nothing was bundled to run." >&2
exit 78
