# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# One image, two services. `web` runs the Next standalone server; `worker` runs
# the ingestion pass. Both start from the same runtime layer, so there is one
# thing to build and one thing to keep patched.
# ─────────────────────────────────────────────────────────────────────────────

# ---- builder ────────────────────────────────────────────────────────────────
# Everything expensive happens here and none of it reaches the final image.
FROM node:22-alpine AS builder
WORKDIR /app

# Only what the install itself reads, so the npm ci layer is reused whenever
# application code changes and nothing else does. With `COPY . .` first, editing
# one component invalidated the install and every build paid for it again.
COPY package.json package-lock.json .npmrc ./

# node:22 ships npm 10, which cannot read this lockfile (it omits nested entries
# npm 10 expects). The exact version comes from packageManager in package.json,
# so this is not a third place to keep in sync — see issue #22.
# engine-strict is on in .npmrc, so if the base image's Node ever drops below
# the engines floor this install fails here with EBADENGINE rather than later.
#
# --ignore-scripts is required by the ordering above, not a preference: this
# package's own postinstall is `next typegen`, which exits 1 with "Couldn't find
# any `pages` or `app` directory" when the source has not been copied yet —
# verified, not assumed. Nothing is lost by skipping it here, because `next
# build` below generates the same route types. Dependency install scripts are
# run instead by `npm rebuild` once the source is in place; six packages declare
# them, esbuild among them, and esbuild is what bundles the workers.
RUN NPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")" \
  && npm install -g "npm@${NPM_VERSION}" \
  && node -v \
  && npm -v \
  && npm ci --ignore-scripts

COPY . .

# The install scripts skipped above, now that this is a complete tree. If
# esbuild's binary were wrong the bundling steps below would fail loudly rather
# than silently produce nothing.
RUN npm rebuild

RUN npx next build

# The database scripts are TypeScript and would otherwise drag tsx and the whole
# dependency tree into the runtime image. Bundling them to self-contained CommonJS
# costs ~300 KB each and lets the runtime image carry no node_modules of its own
# beyond what Next traced.
# --out-extension pins the .cjs suffix. esbuild names outdir files .js by
# default whatever the --format, and a bare .js would be read as ESM if any
# package.json above it ever declares "type": "module" — including the one Next
# writes into the standalone bundle. The entrypoints name .cjs; this makes that
# true rather than hopeful.
RUN npx esbuild src/db/migrate.ts src/db/seed.ts \
  --bundle --platform=node --format=cjs --target=node22 --outdir=ops \
  --out-extension:.js=.cjs \
  --log-level=warning \
  && ls -la ops

# The worker entry does not exist yet; issue #5 adds it. Bundle it when it is
# there, and leave the image honestly without it when it is not. The worker
# entrypoint reports the difference rather than idling and looking healthy.
RUN if [ -f src/worker/main.ts ]; then \
  npx esbuild src/worker/main.ts \
  --bundle --platform=node --format=cjs --target=node22 --outfile=ops/worker.cjs \
  --log-level=warning; \
  echo "worker entry bundled"; \
  else echo "no worker entry in this build (issue #5)"; fi

# The entrypoints name these three paths. Assert them at build time so a rename
# or a changed output extension fails the build, where the message is obvious,
# rather than the first container start, where it is a stack trace.
RUN test -f ops/migrate.cjs \
  && test -f ops/seed.cjs \
  && test -f .next/standalone/server.js \
  && echo "build artefacts present at the paths the entrypoints use"

# ---- runner ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  NEXT_TELEMETRY_DISABLED=1

# The standalone bundle: a minimal server.js plus only the node_modules Next
# traced as reachable. No build toolchain, no dev dependencies.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# CONTROL, THROWAWAY BRANCH, NEVER MERGE: public/ deliberately not copied.

# SQL migration files are read from disk at run time by the migrator.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/ops ./ops
COPY docker/web-entrypoint.sh docker/worker-entrypoint.sh ./docker/

# Same assertion on the far side of the COPYs: what the builder produced is not
# automatically what landed here.
RUN test -f /app/ops/migrate.cjs \
  && test -f /app/ops/seed.cjs \
  && test -f /app/server.js \
  && test -f /app/docker/web-entrypoint.sh \
  && echo "runtime image has every path its entrypoints reference"

RUN chmod +x ./docker/*.sh \
  && addgroup -S app \
  && adduser -S -G app app \
  && chown -R app:app /app
USER app

EXPOSE 3000
CMD ["./docker/web-entrypoint.sh"]
