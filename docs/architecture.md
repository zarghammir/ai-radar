# Architecture

How AI Radar is put together, and why the parts that look odd are that way.

Structural claims here were derived from the tree — file paths, imports and
counts are things you can check. Lines marked **Why** are reasons that are not
visible in the code and come from the decisions behind it; they are the ones
worth challenging if the code ever disagrees with them.

A reason does not expire; a count does. So every number here is either **pinned
by a test** or **phrased so ordinary work cannot falsify it**, and where a list
would go stale this document names the directory instead of its contents. An
earlier draft enumerated the modules in `src/api/`; one file arrived with the
Today page and the sentence was false before it merged.

## The shape

```
 feeds and APIs          the worker              the database            the app
┌───────────────┐      ┌──────────────┐        ┌──────────────┐      ┌─────────────┐
│ rss · arxiv   │─────▶│ fetch        │───────▶│ raw_items    │◀─────│ 13 route    │
│ hackernews    │      │ normalize    │        │ stories      │      │ handlers    │
└───────────────┘      │ dedupe       │        │ topics …     │      └─────────────┘
                       │ cluster      │        └──────────────┘             │
                       │ rank         │                                     ▼
                       └──────────────┘                              screens (in progress)
```

**Everything that reaches the outside world happens in the worker.** The app
reads the database and returns. That is the single most important line in this
document, and `npm run routes:check` exists to keep it true.

## Processes

There are two, plus two one-shot commands.

| process | entry                        | what it is                                                                                |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| web     | `next start` (or `next dev`) | Serves the pages and the route handlers                                                   |
| worker  | `src/worker/main.ts`         | Fetches, stores, clusters and scores. `--once`, or a loop every `INGEST_INTERVAL_MINUTES` |
| migrate | `src/db/migrate.ts`          | Applies `drizzle/`                                                                        |
| seed    | `src/db/seed.ts`             | Writes the catalogue from `src/db/seed-data.ts`                                           |

In Docker, `docker/web-entrypoint.sh` runs migrate and seed before the server;
the worker service runs the loop. On GitHub Actions, `.github/workflows/ingest.yml`
runs `npm run worker:once` every thirty minutes instead.

## The write path

Only the worker writes stories and items. `src/worker/ingest.ts` is the single
entry both callers use — the loop and the internal HTTP trigger — and it holds a
Postgres advisory lock for the whole pass (`src/worker/lock.ts`).

> **Why one writer:** story slugs are made unique by whoever is writing. Two
> concurrent passes can pick the same slug and collide on the unique index. The
> lock is _tried_, never waited on, so a tick arriving mid-pass is skipped
> rather than queued behind it — otherwise a slow pass leaves a pile of ticks to
> stampede afterwards.

> **Why the lock reserves a connection:** an advisory lock belongs to the session
> that took it. Taken on one pooled connection and released on another, it is
> never released at all, and every later tick is declined until the process
> restarts.

A pass is `runIngest` then `rankAllStories`, in that order, in one call.

> **Why they are one call:** a story nobody scored cannot appear on Today. An
> ingest that stopped after storing would fill the database and leave the screen
> empty — with both halves passing their own tests while it happened.

## The read path

Every route handler lives under `src/app/api/`. All but one are the client API;
the exception is `internal/ingest`, which triggers an ingestion pass and is
guarded by `INTERNAL_API_SECRET`. At the time of writing that is twelve and one
— **`npm run routes:check` prints the current pair**, so the number above is a
convenience and the command is the source of truth.

A handler is thin. The pattern, from `src/app/api/radar/route.ts`:

```ts
getDb()                      // the database, obtained at request time
parseFilters / parseLimit …  // src/api/params.ts — query string in, typed values out
radarPage(...)               // src/api/radar.ts — the actual query
handle() / json()            // src/api/http.ts — one response shape for every route
```

`src/api/` holds the work: one module per area of the product, plus two shared
ones — `params.ts` turns a query string into typed values, `http.ts` defines the
single response shape. Read the directory for the current set. Errors carry a
machine-readable `code` and a human `message`; clients branch on the code.

**No screen calls these route handlers.** Nothing under `src/app`, `src/components`
or `src/lib` fetches `/api/…`; the Today page reads through `src/lib/api/client.ts`,
which serves fixtures under an explicit `NEXT_PUBLIC_USE_FIXTURES` mode rather
than a fallback. So the API is finished and exercised by its own tests before it
has a caller — **which is worth knowing before you conclude a route is dead and
delete it.**

> **Why fixtures are a mode and not a fallback:** a client that tries the network
> and quietly uses fixtures on a 404 cannot tell "this route does not exist yet"
> from "this save failed", and would report a failed write as a success. The
> reasoning is in `client.ts` and it is worth reading before changing it.

## Three things that look wrong and are load-bearing

**`output: "standalone"` in `next.config.ts`.** Next's standalone bundle is what
the Docker runtime image ships, and the Dockerfile asserts
`.next/standalone/server.js` exists at build time. Removing it breaks the
self-host path immediately.

**The internal ingest route imports the database client inside the handler**, not
at the top of the file.

> **Why:** `next build` imports every route module to collect its page data, and
> `src/db/client.ts` throws when `DATABASE_URL` is unset. A top-level import
> therefore fails any build without a database — which is exactly what the image
> build is. The CI `Build` step runs with `DATABASE_URL: ""` to keep that from
> coming back.

**`getDb()` and `getSql()` are functions rather than exported values.** Same
reason, generalised: nothing should construct a connection as a side effect of
being imported.

## The rule the checker enforces

`npm run routes:check` walks the import graph out of every public route and fails
if any can reach a feed adapter, the HTTP client or an LLM SDK. It has no
exceptions list.

> **Why it exists:** nine of the twelve routes once transitively imported the
> adapters, through a single import line — `stories.ts` → `rank-all.ts` →
> `run.ts` → the source registry → all three adapters → `src/sources/http.ts`,
> where `fetch` lives. No route _called_ any of it, so the rule held; what did
> not hold is that the rule could be _verified_. The graph said the opposite of
> the claim, and only a human tracing call sites could tell the difference.

> **Why no exceptions list:** a carve-out is a hole with a comment on it. The day
> a real edge appears, the exception absorbs it and nobody notices.

## Data model, in one paragraph

Ten tables — a count `src/db/schema.test.ts` now floors, so this sentence fails
a test rather than rotting quietly. `sources` is the catalogue; `raw_items` is one row per thing a source
produced; `stories` cluster items that are the same event; `topics` and
`story_topics` tag them; `user_preferences`, `saved_items` and `read_state` are
the single local user; `ingest_runs` is one row per source per pass, with counts
and the error; `llm_usage` is the cost ledger for summaries that do not exist yet.

**Verification level and content type are separate columns and separate
vocabularies.** How sure we are is not what kind of thing it is, and `schema.test.ts`
fails if they are ever merged.

## Where to look

| you want                            | it is in                  |
| ----------------------------------- | ------------------------- |
| Add a source, write an adapter      | `docs/sources.md`         |
| What a route returns                | `docs/api.md`             |
| Colours, type, spacing              | `docs/DESIGN.md`          |
| What costs money, and what does not | `docs/cost-protection.md` |
| Run it                              | `README.md`               |

## Not built yet

Screens are landing week by week, so this document does not list which — the
Phase 1 milestone does, and it stays current. The durable gaps:

- **Nothing consumes the API yet.** The flip is `NEXT_PUBLIC_USE_FIXTURES=0`,
  and it is the single change that turns the screens from a prototype into the
  product.
- **AI summaries do not exist.** `LLM_MAX_STORIES_PER_DAY` and `llm_usage` are
  in the schema and nothing reads either; `#35` owns closing that before any
  paid call ships.
- **Sources with no usable feed cannot be added**, pending the HTML listing
  adapter in `#26`.
