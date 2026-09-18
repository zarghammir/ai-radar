# API contract

The seam between the data and anything that displays it: the web app today, a
native client later. This document is the agreement. Route handlers are
implemented against it in the second half of issue #10.

Status: **final, signed off by PM and UI lane on 2026-09-16.**

**Amended 2026-09-17 (#103)** — the source write moved under `internal/` and is
no longer part of this client API. The sign-off above covers the contract as it
stood on 09-16; the amended sections say what changed and why. A sign-off line
that silently covers later edits is a claim nobody re-checks.

---

## Ground rules

**No route a client can reach triggers ingestion, and none makes an external
call.** Every endpoint documented here reads the database and returns. No
adapter is invoked, no feed or API is fetched, nothing is summarised on demand.
This is what keeps a page load cheap, predictable and free, and it is why a slow
upstream feed can never make the app slow.

Routes under **`internal/`** are the exception and are not part of this client
API. The boundary is a rule rather than a list: **`internal/` means
operator-only and is secret-guarded; everything outside it is reader-facing and
must not mutate operator state.** Both are guarded by a shared secret
(`INTERNAL_API_SECRET`) and **refuse before they read or write anything** — an
unauthenticated caller leaves no trace and costs nothing to turn away.

`POST /api/internal/ingest` triggers an ingestion pass; `PUT
/api/internal/sources/:key` switches a source on or off (#103 — it was
`PUT /api/sources/:key`, unguarded, until then). They exist for a scheduler or
an operator, are documented with the worker rather than here, and do not change
the rule above for
anything a client can reach. Ingestion otherwise happens only in the worker.

The only tables a **client** route writes are `saved_items`, `read_state` and
`user_preferences`. `sources.enabled` is written too, but **only by an operator
route under `internal/`** — a reader cannot switch a source off, and could until
#103. No route writes `raw_items` or `stories`.

This is the product's cost-protection promise, not a style preference. An
implementation that breaks it is a review finding.

**Single user.** Version 1 is self-hosted with no login. Preferences are one row
(`user_preferences.id = 1`). The shapes below are deliberately free of a user
id so that adding accounts later is an additive change.

**Every field below is backed by something that exists.** Anything the schema
holds but nothing yet produces is listed under [Not filled yet](#not-filled-yet)
and returns `null` or an empty value rather than being omitted. The
[field provenance](#field-provenance) table maps every field to its column or
its derivation.

---

## Conventions

|                           |                                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| Base path                 | `/api`                                                               |
| Request and response type | `application/json; charset=utf-8`                                    |
| Timestamps                | ISO 8601 in UTC, always with `Z` (`2026-09-16T12:00:00.000Z`)        |
| Unknown query params      | Ignored, never an error                                              |
| Input validation          | Zod, on every route that takes input                                 |
| Caching                   | `Cache-Control: no-store`; the data changes whenever the worker runs |

### Errors

Every non-2xx response has exactly this body and nothing else:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "length must be one of 5, 10, all" } }
```

| code                 | status | when                                        |
| -------------------- | ------ | ------------------------------------------- |
| `VALIDATION_ERROR`   | 400    | A query or body parameter failed validation |
| `NOT_FOUND`          | 404    | No story with that slug, no such story id   |
| `METHOD_NOT_ALLOWED` | 405    | Method not supported on that path           |
| `INTERNAL`           | 500    | Anything unhandled; `message` is generic    |

`message` is for a person reading a log or a toast. Clients branch on `code`,
never on `message` text.

### Pagination

Cursor-based, not offset. Offsets skip or repeat rows when the worker inserts
between two page loads.

| param    | default             | max |
| -------- | ------------------- | --- |
| `limit`  | 30                  | 100 |
| `cursor` | absent (first page) | —   |

A response carries `nextCursor` (opaque string) and `hasMore`. Pass the cursor
back unchanged for the next page. A cursor encodes the sort key and the story id
of the last row; it is not a page number and is not portable between different
`sort` values.

**One honest caveat.** With `sort=newest` the key is `lastActivityAt`, which
changes when a new source joins an existing story. A story can therefore move
between pages mid-scroll. Sorting is by activity, so that is the intended
behaviour rather than a defect, but a client that de-duplicates by story id
while appending pages will look better for it.

### Time windows

`since` accepts either an ISO 8601 instant or a duration shorthand: `24h`,
`7d`, `30d`. Durations are relative to request time.

Three different windows exist and are easy to confuse:

| window           | length                                              | where it is decided                   |
| ---------------- | --------------------------------------------------- | ------------------------------------- |
| Brief window     | since the last occurrence of the user's `briefTime` | derived per request, see `/api/brief` |
| Radar default    | last **7 days**                                     | this contract                         |
| Story clustering | 72 hours                                            | the pipeline, not the API             |

The clustering window is how long a story stays open to absorb new reports. It
is not a display filter and no client should assume the two match.

---

## Shared shapes

### `SourceRef`

```json
{ "key": "openai-blog", "name": "OpenAI", "tier": "PRIMARY", "homepage": "https://openai.com/news" }
```

`tier` is one of `PRIMARY`, `HIGH_QUALITY_REPORTING`, `ANALYST`, `COMMUNITY`,
`DISCOVERY`.

### `Topic`

```json
{ "key": "openai", "name": "OpenAI", "group": "company" }
```

`group` is `company`, `domain` or `field`. Matching keywords are internal
tagging configuration and are not exposed.

### `StoryCard`

What a list renders. Returned by `/api/brief`, `/api/radar` and `/api/saved`.

```json
{
  "id": 412,
  "slug": "introducing-gpt-6",
  "title": "Introducing GPT-6",
  "summary": null,
  "whyItMatters": null,
  "excerpt": "A new flagship model with a one million token context window…",
  "url": "https://openai.com/index/gpt-6/",
  "contentType": "NEWS",
  "verification": "PRIMARY_SOURCE",
  "verificationNote": "Published directly by OpenAI and picked up by 2 other sources.",
  "sourceCount": 3,
  "sources": [
    {
      "key": "openai-blog",
      "name": "OpenAI",
      "tier": "PRIMARY",
      "homepage": "https://openai.com/news"
    },
    {
      "key": "verge-ai",
      "name": "The Verge",
      "tier": "HIGH_QUALITY_REPORTING",
      "homepage": "https://www.theverge.com/ai-artificial-intelligence"
    },
    {
      "key": "hackernews-ai",
      "name": "Hacker News",
      "tier": "COMMUNITY",
      "homepage": "https://news.ycombinator.com"
    }
  ],
  "primarySource": {
    "key": "openai-blog",
    "name": "OpenAI",
    "tier": "PRIMARY",
    "homepage": "https://openai.com/news"
  },
  "topics": [{ "key": "openai", "name": "OpenAI", "group": "company" }],
  "publishedAt": "2026-09-16T09:00:00.000Z",
  "firstSeenAt": "2026-09-16T09:00:00.000Z",
  "lastActivityAt": "2026-09-16T11:40:00.000Z",
  "readingMinutes": 1,
  "score": 43.1,
  "saved": false,
  "read": false
}
```

`sources` is the de-duplicated list of distinct sources behind the story, one
entry per source however many items that source filed. It is the same list the
verification level is derived from, so a client can always explain the badge
from the card alone.

`whyItMatters` is on the card as well as the detail, because Today shows it in
the list and a client cannot fetch one story's detail per row to get it. It is
`null` on every story until the Phase 2 summariser lands — a null here is the
feature not having arrived, not a fault. `scoreComponents` deliberately stays
on `StoryDetail` only: a card shows importance as size and trust as its meter,
not a per-component breakdown, and every field on a list payload is paid for
once per story in the list.

`url` and `publishedAt` come from the story's primary item — the first-party
source where one exists, the earliest item otherwise. That is the link a reader
should open.

A hidden story (`read_state.hidden`) is excluded from every list and has no
field on the card.

### `StoryDetail`

Everything in `StoryCard`, plus:

```json
{
  "whyItMatters": null,
  "keyPoints": [],
  "items": [
    {
      "id": 980,
      "title": "Introducing GPT-6",
      "url": "https://openai.com/index/gpt-6/",
      "excerpt": "A new flagship model…",
      "author": null,
      "publishedAt": "2026-09-16T09:00:00.000Z",
      "fetchedAt": "2026-09-16T09:12:00.000Z",
      "role": "primary",
      "source": {
        "key": "openai-blog",
        "name": "OpenAI",
        "tier": "PRIMARY",
        "homepage": "https://openai.com/news",
        "kind": "rss"
      },
      "engagement": null
    },
    {
      "id": 981,
      "title": "OpenAI announces GPT-6",
      "url": "https://www.theverge.com/2026/9/16/gpt-6",
      "excerpt": "The model arrives with…",
      "author": "A Reporter",
      "publishedAt": "2026-09-16T10:05:00.000Z",
      "fetchedAt": "2026-09-16T10:20:00.000Z",
      "role": "report",
      "source": {
        "key": "verge-ai",
        "name": "The Verge",
        "tier": "HIGH_QUALITY_REPORTING",
        "homepage": "https://www.theverge.com/ai-artificial-intelligence",
        "kind": "rss"
      },
      "engagement": null
    },
    {
      "id": 982,
      "title": "Introducing GPT-6",
      "url": "https://openai.com/index/gpt-6/",
      "excerpt": null,
      "author": "someone",
      "publishedAt": "2026-09-16T11:40:00.000Z",
      "fetchedAt": "2026-09-16T11:45:00.000Z",
      "role": "discussion",
      "source": {
        "key": "hackernews-ai",
        "name": "Hacker News",
        "tier": "COMMUNITY",
        "homepage": "https://news.ycombinator.com",
        "kind": "hackernews"
      },
      "engagement": { "points": 412, "comments": 96 }
    }
  ],
  "timeline": [
    {
      "at": "2026-09-16T09:00:00.000Z",
      "sourceKey": "openai-blog",
      "sourceName": "OpenAI",
      "role": "primary",
      "title": "Introducing GPT-6",
      "url": "https://openai.com/index/gpt-6/"
    },
    {
      "at": "2026-09-16T10:05:00.000Z",
      "sourceKey": "verge-ai",
      "sourceName": "The Verge",
      "role": "report",
      "title": "OpenAI announces GPT-6",
      "url": "https://www.theverge.com/2026/9/16/gpt-6"
    },
    {
      "at": "2026-09-16T11:40:00.000Z",
      "sourceKey": "hackernews-ai",
      "sourceName": "Hacker News",
      "role": "discussion",
      "title": "Introducing GPT-6",
      "url": "https://openai.com/index/gpt-6/"
    }
  ],
  "scoreComponents": [
    { "key": "recency", "label": "Recently active", "value": 13.1 },
    { "key": "primarySource", "label": "Primary source", "value": 20 },
    { "key": "corroboration", "label": "Corroborating sources", "value": 8 },
    { "key": "contentType", "label": "Content type", "value": 2 }
  ]
}
```

`role` is `primary`, `report` or `discussion`.

`timeline` is **derived, not stored**: the story's items ordered by
`publishedAt` ascending. It answers "who said this, and when", which is the
provenance the product promises. `fetchedAt` on an item is when this app first
saw it, which is a different question and is why both are present.

`engagement` is present only when the source recorded it — Hacker News points
and comments today. It is `null` otherwise, never zero, because no engagement
recorded and zero engagement are not the same thing.

`scoreComponents` is an array rather than an object so order is stable and the
UI can render it without re-sorting. `label` comes from the pipeline's own
label map, so the wording in the UI cannot drift from the weights.

If a component ever reaches the API without an entry in that map, its `label`
is the raw key rather than being blank or missing — a new component must not
blank a bar or throw. That is a safety net and not a state a reader should ever
see, so the ranker's own suite asserts that every component it can emit has a
label, deriving the list from the ranking code itself. Render the `label`
verbatim; the fallback exists so that doing so is always safe.

**`value` may be negative.** The ranking run applies a penalty so the
why-ranked panel can show what pushed a story _down_ and not only what lifted
it. It takes one of two forms: `unverifiedPenalty`, labelled "Unverified claim", or
`emergingPenalty`, labelled "Not yet corroborated".

**A story carries at most one of them**, because a story has exactly one
verification level. They are two keys rather than one only because the label
map is static, and a single key would print "Unverified claim" on a story that
is merely emerging. Nothing that lays out the negative side of a bar should
reserve room for two.

On an `EMERGING` story the entry looks like this:

```json
{ "key": "emergingPenalty", "label": "Not yet corroborated", "value": -2 }
```

It is here rather than in the worked example above because that story is
`PRIMARY_SOURCE`, and neither penalty can occur on one: a lab publishing its
own announcement is neither unverified nor merely emerging.

A chart that assumes non-negative values will render wrongly on the first
unverified story it is given.

As everywhere else in this array, read the `label` the server sends rather than
matching on the key. These two are named here because a reader deserves to know
what the negative values are, not so a client can branch on them.

---

## Routes

### `GET /api/brief`

The morning read: ranked stories from the current brief window.

| param    | type                 | default              | notes                                         |
| -------- | -------------------- | -------------------- | --------------------------------------------- |
| `length` | `5` \| `10` \| `all` | user's `briefLength` | Target **reading minutes**, not a story count |

The window runs from the most recent occurrence of the user's `briefTime` in
their `timezone` up to now. If that moment is still in the future today, the
window starts at yesterday's occurrence.

`length=5` and `length=10` return the highest-ranked stories in the window until
the cumulative reading time would exceed the target, always returning at least
one story if the window has any. `length=all` returns every story in the window.

```json
{
  "window": {
    "from": "2026-09-16T07:30:00.000Z",
    "to": "2026-09-16T12:00:00.000Z",
    "briefTime": "07:30",
    "timezone": "UTC"
  },
  "length": "10",
  "count": 7,
  "readingMinutes": 9,
  "stories": []
}
```

`count` is the number of stories returned, and `readingMinutes` their total —
both describe the response, not the window. Not paginated: a brief is bounded by
its own length rule.

**There is no record of when a brief was last read.** The window is derived from
`briefTime` and `timezone` on every request. Two requests an hour apart return
the same window, and reloading does not "use up" the brief.

**Per-story `read` is what "already seen" means today.** A client wanting to
show what is new should count unread stories in the current window rather than
compare against a previous delivery, because no previous delivery is recorded.
Phase 2's scheduled Morning Brief adds `digests` and `digest_items` with a
delivery timestamp; until then, the derived window and `read_state` are the
whole picture.

### `GET /api/radar`

Everything arriving, filtered.

| param          | type                                   | default  | notes                                                     |
| -------------- | -------------------------------------- | -------- | --------------------------------------------------------- |
| `type`         | content type                           | all      | Repeatable: `?type=NEWS&type=RELEASE`                     |
| `topic`        | topic key                              | all      | Repeatable; a story matches if it carries **any** of them |
| `source`       | source key                             | all      | Repeatable                                                |
| `verification` | verification level                     | all      | Repeatable                                                |
| `since`        | ISO instant or `24h`/`7d`/`30d`        | `7d`     | Against `lastActivityAt`                                  |
| `sort`         | `newest` \| `importance` \| `trending` | `newest` |                                                           |
| `limit`        | 1–100                                  | 30       |                                                           |
| `cursor`       | opaque                                 | —        | From a previous `nextCursor`                              |

Sorts:

- **`newest`** — `lastActivityAt` descending. When a story last moved.
- **`importance`** — `score` descending. A story the ranking run has not
  reached yet scores `0`, so a database that has never been ranked orders by id
  here; that is the absence of a score, not a ranking of zero.
- **`trending`** — how many distinct sources attached to the story in the last
  24 hours, descending, using each item's `fetchedAt`, with `score` as the
  tie-break. Computed per request from stored rows; no rate of change is stored
  anywhere. **This definition is dated.** Engagement velocity is a Phase 3
  signal with its own stored column; when it lands `trending` may switch to it,
  and this contract will say so rather than changing meaning silently.

```json
{
  "stories": [],
  "nextCursor": "eyJrIjoiMjAyNi0wOS0xNlQxMTo0MDowMFoiLCJpIjo0MTJ9",
  "hasMore": true,
  "appliedFilters": {
    "type": [],
    "topic": ["openai"],
    "source": [],
    "verification": [],
    "since": "7d",
    "sort": "newest"
  }
}
```

`appliedFilters` echoes what the server actually used after validation and
defaulting, so a client can render "showing X" without re-deriving it.

### `GET /api/radar/histogram`

Arrivals by hour, for the chart above the radar list. A paginated list cannot
produce this: with `limit` at 30 a client can only ever draw the page it
fetched, and a histogram of one page is not approximately right, it is wrong.

Takes the **same filters** as `/api/radar` — `type`, `topic`, `source`,
`verification`, `since` — so the chart and the list below it always describe the
same set. No `sort`, no `cursor`, no `limit`: it is one grouped count.

| param   | default                  |
| ------- | ------------------------ |
| `since` | `24h`, giving 24 buckets |
| others  | as `/api/radar`          |

```json
{
  "from": "2026-09-15T12:00:00.000Z",
  "to": "2026-09-16T12:00:00.000Z",
  "buckets": [
    { "hour": "2026-09-15T12:00:00.000Z", "count": 3 },
    { "hour": "2026-09-15T13:00:00.000Z", "count": 0 }
  ]
}
```

Grouped on `lastActivityAt`, the same key `sort=newest` orders by, so a bar and
a row agree about when a story arrived.

Buckets are hourly and **every hour in the window is present, including empty
ones with `count: 0`**. Omitting empty hours would leave the chart with silent
gaps exactly where it should show a quiet period. A longer `since` returns more
hourly buckets, capped at 168 (seven days); beyond that the request is a
`VALIDATION_ERROR` rather than a silently truncated chart.

### `GET /api/stories/:slug`

One story in full. Returns `StoryDetail`, or `NOT_FOUND`. Looked up by slug, not
id, so links stay readable and shareable. A hidden story is still reachable by
direct link; hiding removes it from lists, it does not delete it.

### `GET /api/saved`

| param             | type              | default  |
| ----------------- | ----------------- | -------- |
| `archived`        | `true` \| `false` | `false`  |
| `limit`, `cursor` |                   | as above |

Returns `StoryCard`s of saved stories, newest save first, plus the save's own
`note` and `tags`:

```json
{
  "stories": [{ "note": null, "tags": [], "savedAt": "2026-09-16T12:10:00.000Z" }],
  "nextCursor": null,
  "hasMore": false
}
```

### `POST /api/saved/:storyId`

Saves a story. Body optional:

```json
{ "note": "check the eval methodology", "tags": ["reading-list"] }
```

Idempotent: saving an already-saved story updates `note` and `tags` and returns
200 rather than failing, because a double tap on a phone must not be an error.
Returns `{ "saved": true, "storyId": 412, "note": null, "tags": [] }`.
`NOT_FOUND` if no such story.

### `DELETE /api/saved/:storyId`

Unsaves. Idempotent: returns `{ "saved": false, "storyId": 412 }` whether or not
it was saved. `NOT_FOUND` only if no such story.

### `POST /api/read/:storyId`

Marks read. Body optional: `{ "read": false }` to mark unread again.
Returns `{ "storyId": 412, "read": true, "readAt": "2026-09-16T12:11:00.000Z" }`.
`readAt` is `null` when `read` is false.

### `POST /api/hide/:storyId`

Hides a story from lists. Body optional: `{ "hidden": false }` to unhide.
Returns `{ "storyId": 412, "hidden": true }`.

Read and hidden are separate: reading something does not hide it, and hiding
does not mark it read.

### `GET /api/preferences`

```json
{
  "topicKeys": ["openai", "agents"],
  "briefTime": "07:30",
  "timezone": "UTC",
  "briefLength": "10",
  "notificationChannel": "none",
  "email": null,
  "theme": "system",
  "onboardedAt": null,
  "updatedAt": "2026-09-16T12:00:00.000Z"
}
```

### `PUT /api/preferences`

Accepts any subset of the writable fields; omitted fields are left alone.
`updatedAt` is server-set and ignored on input. Returns the full updated object.

| field                 | validation                                                           |
| --------------------- | -------------------------------------------------------------------- |
| `topicKeys`           | array of existing topic keys; an unknown key is a `VALIDATION_ERROR` |
| `briefTime`           | `HH:MM`, 24-hour                                                     |
| `timezone`            | IANA zone name                                                       |
| `briefLength`         | `5` \| `10` \| `all`                                                 |
| `notificationChannel` | `push` \| `email` \| `none`                                          |
| `email`               | email address, or `null`                                             |
| `theme`               | `light` \| `dark` \| `system`                                        |
| `onboardedAt`         | ISO instant or `null`                                                |

Rejecting an unknown topic key is deliberate: a silently dropped key is a
preference the user believes they set.

**`theme` has two sources of truth, deliberately.** `preferences.theme` is the
cross-device default; the browser's `localStorage` copy is the device override
that the no-flash script reads before first paint. A server round trip cannot
happen before paint, so the local copy is authoritative for rendering, and
Settings writes both. **The local copy must not be removed as duplication** —
doing so reintroduces the white flash on every cold load.

**Two of those value sets are this contract's, not the database's:**

| field                                                 | enforced where                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `briefLength`, `notificationChannel`                  | TypeScript, via `BRIEF_LENGTHS` and `NOTIFICATION_CHANNELS` in the schema. The columns themselves are plain text                                                                     |
| `theme`, `topics[].group`                             | **Nowhere yet.** Both are unconstrained text columns. `light`/`dark`/`system` and `company`/`domain`/`field` are proposed here and would be enforced only by this route's validation |
| `contentType`, `verification`, `tier`, `role`, `kind` | Postgres enums. A wrong value cannot be stored at all                                                                                                                                |

If `theme` or `group` should be enums, that is a migration and a separate
ticket; the validation above holds the line in the meantime.

### `GET /api/topics`

```json
{ "topics": [{ "key": "openai", "name": "OpenAI", "group": "company", "storyCount": 18 }] }
```

`storyCount` counts stories tagged with the topic within the last 7 days, so the
onboarding chips can be ordered by what is actually active. Not paginated; the
list is a few dozen rows.

### `GET /api/sources`

```json
{
  "sources": [
    {
      "key": "openai-blog",
      "name": "OpenAI",
      "kind": "rss",
      "tier": "PRIMARY",
      "homepage": "https://openai.com/news",
      "enabled": true,
      "lastFetchedAt": "2026-09-16T11:30:00.000Z",
      "lastError": null,
      "storyCount": 24,
      "health": "OK",
      "consecutiveFailures": 0
    }
  ]
}
```

`lastError` and `lastFetchedAt` are included because the developer view needs to
show which sources are failing. `config` and the feed `url` are not exposed:
they are operational settings, not display data. Not paginated.

**`health` is one of `OK`, `FAILING` or `UNKNOWN` — three states, not two.** A
source that has never completed a run is neither working nor broken, and
reporting it as healthy would be the same defect this field exists to fix.

`lastError` alone cannot answer "is this source working": a single stale error
is indistinguishable from a feed refused on every run for a week. `health` is
computed from `ingest_runs` history — `consecutiveFailures` counts failures
since the source last succeeded, and a source crosses to `FAILING` at three.

Three is a duration in disguise. The ingest schedule runs every thirty minutes,
so three consecutive failures is ninety minutes of uninterrupted failure: long
enough that no single transient 500 reaches it, short enough that a source
which died overnight is already flagged when someone looks in the morning. The
rationale lives beside the constant in `src/api/source-health.ts`.

A run that has started but not finished is neither a success nor a failure, and
does not clear the count — otherwise a failing source would read healthy for
the duration of every pass.

### `PUT /api/internal/sources/:key`

**Operator-only, not part of this client API.** Requires the
`x-internal-secret` header; an unauthenticated caller gets `401` and the row is
unchanged. Listed here beside the source shapes because that is where a reader
looks for it — the boundary rule is in Ground rules above.

Switches one source on or off. The only write any route makes to `sources`, and
only to this column.

It was `PUT /api/sources/:key` with no guard of any kind until #103, which is
why the old path is **gone rather than redirected**.

```json
{ "enabled": false }
```

Returns the updated source in the shape above. `NOT_FOUND` for an unknown key.

This is a preference about a catalogue row, not a write to `stories` or
`raw_items`, and it does not trigger a fetch: a disabled source is simply
skipped by the next worker run. The seed deliberately never overwrites
`enabled`, so re-seeding cannot switch a source back on behind the reader.

---

## Field provenance

Every response field, and what backs it. A field cannot be added to this
contract without filling a row here.

| field                                         | source                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`, `slug`, `title`, `contentType`          | `stories` columns                                                                                                 |
| `whyItMatters`                                | `stories.why_it_matters`, on both the card and the detail                                                         |
| `verification`, `verificationNote`            | `stories`, written by `deriveVerification` in the pipeline                                                        |
| `sourceCount`                                 | `stories.source_count`, recomputed by the pipeline                                                                |
| `firstSeenAt`, `lastActivityAt`               | `stories` columns                                                                                                 |
| `score`                                       | `stories.score`                                                                                                   |
| `scoreComponents[].key/value`                 | `stories.score_components`                                                                                        |
| `scoreComponents[].label`                     | `COMPONENT_LABELS` in `src/pipeline/ranking/score.ts`, falling back to the key if unmapped                        |
| `sources[]`                                   | `raw_items` joined to `sources`, de-duplicated by source key                                                      |
| `primarySource`, `url`, `publishedAt`         | the item at `stories.primary_item_id`, joined to its source                                                       |
| `excerpt`                                     | primary item's `raw_items.excerpt`                                                                                |
| `topics[]`                                    | `story_topics` joined to `topics`                                                                                 |
| `readingMinutes`                              | `readingMinutes()` in `src/pipeline/normalize/text.ts`, over the story's summary or excerpt                       |
| `items[]`                                     | `raw_items` for the story, joined to `sources`                                                                    |
| `items[].engagement`                          | `raw_items.metadata.points` / `.comments`, null when absent                                                       |
| `timeline[]`                                  | derived: `items` ordered by `publishedAt` ascending                                                               |
| `saved`, `note`, `tags`, `savedAt`            | `saved_items`                                                                                                     |
| `read`, `readAt`                              | `read_state.read_at`                                                                                              |
| `hidden`                                      | `read_state.hidden`                                                                                               |
| preferences fields                            | `user_preferences` row 1                                                                                          |
| `topics[].storyCount`, `sources[].storyCount` | counted per request from `story_topics` / `raw_items`, over 7 days                                                |
| `buckets[].hour`, `buckets[].count`           | `stories.last_activity_at` grouped by hour, empty hours filled in                                                 |
| `sources[].enabled` (write)                   | `sources.enabled`, the only column any route writes on that table — and only the operator route under `internal/` |

## Not filled yet

These columns exist and are returned, but nothing writes them yet. They are in
the contract so the UI can build the final shape once, rather than changing it
later. Each returns the stated empty value until its ticket lands.

| field             | value until then | filled by                                                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `summary`         | `null`           | AI summariser, Phase 2. Clients must fall back to `excerpt`, which is always present for a story with a usable item |
| `whyItMatters`    | `null`           | AI summariser, Phase 2                                                                                              |
| `keyPoints`       | `[]`             | AI summariser, Phase 2                                                                                              |
| `score`           | `0`              | The ranking run, for a story it has not reached yet                                                                 |
| `scoreComponents` | `[]`             | The ranking run, for a story it has not reached yet                                                                 |

A client that renders `summary` without falling back to `excerpt` will show
empty cards on every story in Phase 1. That is the one place this contract can
mislead, so it is stated twice.

## Deliberately absent

| not here                              | why                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A search endpoint                     | Nothing indexes text yet; filtering by topic and source covers Phase 1                                                                                                                         |
| Any write to `stories` or `raw_items` | Only the worker writes those                                                                                                                                                                   |
| A public refresh or ingest trigger    | No client-reachable route may cause an external call, and the worker owns ingestion. The one exception is the internal, secret-guarded `POST /api/internal/ingest`, documented with the worker |
| `sources[].config`, `sources[].url`   | Operational settings, not display data                                                                                                                                                         |
| `topics[].keywords`                   | Internal tagging configuration                                                                                                                                                                 |
| A total item count on the radar       | It would cost a second count query on every page; the returned array plus `appliedFilters` supports "showing N"                                                                                |
| A notification trigger rule           | The prototype's "plus anything major" is a different axis from `notificationChannel`, which is where a notification goes; nothing stores what would trigger one                                |
| A numeric grade on a story            | The four-bar meter is a rendering of the `verification` enum, owned by the client; a number here would let the picture and the word drift apart                                                |
| A user id anywhere                    | Version 1 is single user; adding accounts stays additive                                                                                                                                       |

---

## Examples

Against a local app on port 3000, once the routes are implemented.

```bash
# Today's brief, ten-minute mode
curl -s 'http://localhost:3000/api/brief?length=10'

# Radar: corroborated releases about OpenAI in the last two days
curl -s 'http://localhost:3000/api/radar?topic=openai&type=RELEASE&verification=CORROBORATED&since=48h'

# Second page
curl -s 'http://localhost:3000/api/radar?cursor=eyJrIjoiMjAyNi0wOS0xNlQxMTo0MDowMFoiLCJpIjo0MTJ9'

# One story in full
curl -s 'http://localhost:3000/api/stories/introducing-gpt-6'

# Save it, with a note
curl -s -X POST 'http://localhost:3000/api/saved/412' \
  -H 'content-type: application/json' \
  -d '{"note":"check the eval methodology"}'

# Mark it read, then hide it
curl -s -X POST 'http://localhost:3000/api/read/412'
curl -s -X POST 'http://localhost:3000/api/hide/412'

# Arrivals by hour, same filters as the list above it
curl -s 'http://localhost:3000/api/radar/histogram?topic=openai&since=24h'

# Switch a source off — OPERATOR ONLY, needs the secret
curl -s -X PUT 'http://localhost:3000/api/internal/sources/venturebeat-ai' \
  -H 'content-type: application/json' \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{"enabled":false}'

# Preferences
curl -s 'http://localhost:3000/api/preferences'
curl -s -X PUT 'http://localhost:3000/api/preferences' \
  -H 'content-type: application/json' \
  -d '{"briefLength":"5","topicKeys":["openai","agents"]}'

# A validation error, to see the error shape
curl -s 'http://localhost:3000/api/brief?length=7'
# {"error":{"code":"VALIDATION_ERROR","message":"length must be one of 5, 10, all"}}
```

## Decisions taken at sign-off

Settled on 2026-09-16 by the PM, with the UI lane reading the contract as its
consumer. Recorded because each could reasonably have gone the other way, and a
later reader deserves the reason rather than the result.

1. **`length` is reading minutes, not a story count.** A five-minute brief is
   however many stories fit in five minutes, at least one. "Top 5 stories" is
   not the product, and the header would contradict itself the moment two long
   stories crowded out three short ones.
2. **`trending` is distinct sources attached in 24 hours.** The only definition
   honest about what is stored. Dated to Phase 1; engagement velocity is a
   Phase 3 signal with its own column, and this contract will note the change
   rather than let the word shift meaning quietly.
3. **No brief delivery is recorded.** Per-story `read` is what "already seen"
   means today. This costs one prototype element, which is better than a column
   whose only job is to make a decoration true. Phase 2's scheduled Morning
   Brief adds `digests` and `digest_items`.
4. **`storyCount` uses a fixed 7-day window.** It orders chips by what is
   active. It is a hint, not a statistic, and nothing presents it as one.
5. **The arrivals histogram is a route, not a derivation.** A client can only
   ever draw the page it fetched, so a histogram derived from a paginated list
   would be wrong rather than approximate. Added as
   `GET /api/radar/histogram`.
6. **`sources.enabled` is writable.** A toggle with no endpoint behind it is a
   dead control, which is worse than not offering one. It is a preference about
   a catalogue row, so `sources` joins the writable list for that column alone.
7. **`scoreComponents[].value` may be negative**, so the why-ranked panel can
   show what pushed a story down. The ranking run applies `unverifiedPenalty`
   or `emergingPenalty`, each with its own label, because one key cannot carry
   two wordings and the wrong one would be a false statement on the panel.
8. **`theme` keeps two sources of truth.** The duplication is the fix for the
   white flash, not a defect to be tidied away.

## What is still not filled, and by whom

`summary`, `whyItMatters` and `keyPoints` wait on the AI summariser. `score`
and `scoreComponents` come from the ranking run and are empty only for a story
it has not reached. Every section built on them is **hidden when
empty**, never rendered as a labelled empty block, and `summary` always falls
back to `excerpt`. Without that fallback every card in Phase 1 is blank.
