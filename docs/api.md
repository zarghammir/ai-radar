# API contract

The seam between the data and anything that displays it: the web app today, a
native client later. This document is the agreement. Route handlers are
implemented against it in the second half of issue #10.

Status: **final, signed off by PM and UI lane on 2026-09-16.**

---

## Ground rules

**No route triggers ingestion, and no route makes an external call.** Every
endpoint here reads the database and returns. No adapter is invoked, no feed or
API is fetched, nothing is summarised on demand. Ingestion happens only in the
worker (issue #5). This is what keeps a page load cheap, predictable and free,
and it is why a slow upstream feed can never make the app slow.

The only tables any route writes are `saved_items`, `read_state`,
`user_preferences`, and `sources` — the last for its `enabled` column only, so
a reader can switch a source off. No route writes `raw_items` or `stories`.

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
  "firstSeenAt": "2026-09-16T09:12:00.000Z",
  "lastActivityAt": "2026-09-16T11:40:00.000Z",
  "readingMinutes": 2,
  "score": 41.3,
  "saved": false,
  "read": false
}
```

`sources` is the de-duplicated list of distinct sources behind the story, one
entry per source however many items that source filed. It is the same list the
verification level is derived from, so a client can always explain the badge
from the card alone.

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
    }
  ],
  "scoreComponents": [
    { "key": "recency", "label": "Recently active", "value": 13.1 },
    { "key": "primarySource", "label": "Primary source", "value": 20 },
    { "key": "corroboration", "label": "Corroborating sources", "value": 8 }
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

**`value` may be negative.** Issue #9 adds a `verificationPenalty` component,
negative for `UNVERIFIED` and slightly negative for `EMERGING`, so the
why-ranked panel can show what pushed a story _down_ and not only what lifted
it. No negative value is produced until #9 lands, but a bar chart that assumes
non-negative values will render wrongly the day it does.

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
- **`importance`** — `score` descending. Until issue #9 lands, every score is
  `0` and this sort degenerates to id order; it is in the contract because the
  column exists and the UI should build against it now.
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
      "storyCount": 24
    }
  ]
}
```

`lastError` and `lastFetchedAt` are included because the developer view needs to
show which sources are failing. `config` and the feed `url` are not exposed:
they are operational settings, not display data. Not paginated.

### `PUT /api/sources/:key`

Switches one source on or off. The only write any route makes to `sources`, and
only to this column.

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

| field                                         | source                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`, `slug`, `title`, `contentType`          | `stories` columns                                                                           |
| `verification`, `verificationNote`            | `stories`, written by `deriveVerification` in the pipeline                                  |
| `sourceCount`                                 | `stories.source_count`, recomputed by the pipeline                                          |
| `firstSeenAt`, `lastActivityAt`               | `stories` columns                                                                           |
| `score`                                       | `stories.score`                                                                             |
| `scoreComponents[].key/value`                 | `stories.score_components`                                                                  |
| `scoreComponents[].label`                     | `COMPONENT_LABELS` in `src/pipeline/ranking/score.ts`                                       |
| `sources[]`                                   | `raw_items` joined to `sources`, de-duplicated by source key                                |
| `primarySource`, `url`, `publishedAt`         | the item at `stories.primary_item_id`, joined to its source                                 |
| `excerpt`                                     | primary item's `raw_items.excerpt`                                                          |
| `topics[]`                                    | `story_topics` joined to `topics`                                                           |
| `readingMinutes`                              | `readingMinutes()` in `src/pipeline/normalize/text.ts`, over the story's summary or excerpt |
| `items[]`                                     | `raw_items` for the story, joined to `sources`                                              |
| `items[].engagement`                          | `raw_items.metadata.points` / `.comments`, null when absent                                 |
| `timeline[]`                                  | derived: `items` ordered by `publishedAt` ascending                                         |
| `saved`, `note`, `tags`, `savedAt`            | `saved_items`                                                                               |
| `read`, `readAt`                              | `read_state.read_at`                                                                        |
| `hidden`                                      | `read_state.hidden`                                                                         |
| preferences fields                            | `user_preferences` row 1                                                                    |
| `topics[].storyCount`, `sources[].storyCount` | counted per request from `story_topics` / `raw_items`, over 7 days                          |
| `buckets[].hour`, `buckets[].count`           | `stories.last_activity_at` grouped by hour, empty hours filled in                           |
| `sources[].enabled` (write)                   | `sources.enabled`, the only column any route writes on that table                           |

## Not filled yet

These columns exist and are returned, but nothing writes them yet. They are in
the contract so the UI can build the final shape once, rather than changing it
later. Each returns the stated empty value until its ticket lands.

| field             | value until then | filled by                                                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `summary`         | `null`           | AI summariser, Phase 2. Clients must fall back to `excerpt`, which is always present for a story with a usable item |
| `whyItMatters`    | `null`           | AI summariser, Phase 2                                                                                              |
| `keyPoints`       | `[]`             | AI summariser, Phase 2                                                                                              |
| `score`           | `0`              | Issue #9, ranking run                                                                                               |
| `scoreComponents` | `[]`             | Issue #9, ranking run                                                                                               |

A client that renders `summary` without falling back to `excerpt` will show
empty cards on every story in Phase 1. That is the one place this contract can
mislead, so it is stated twice.

## Deliberately absent

| not here                              | why                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A search endpoint                     | Nothing indexes text yet; filtering by topic and source covers Phase 1                                                                                          |
| Any write to `stories` or `raw_items` | Only the worker writes those                                                                                                                                    |
| A refresh or ingest trigger           | No route may cause an external call; the worker owns that                                                                                                       |
| `sources[].config`, `sources[].url`   | Operational settings, not display data                                                                                                                          |
| `topics[].keywords`                   | Internal tagging configuration                                                                                                                                  |
| A total item count on the radar       | It would cost a second count query on every page; the returned array plus `appliedFilters` supports "showing N"                                                 |
| A notification trigger rule           | The prototype's "plus anything major" is a different axis from `notificationChannel`, which is where a notification goes; nothing stores what would trigger one |
| A numeric grade on a story            | The four-bar meter is a rendering of the `verification` enum, owned by the client; a number here would let the picture and the word drift apart                 |
| A user id anywhere                    | Version 1 is single user; adding accounts stays additive                                                                                                        |

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

# Switch a source off
curl -s -X PUT 'http://localhost:3000/api/sources/venturebeat-ai' \
  -H 'content-type: application/json' \
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
   show what pushed a story down. #9 adds `verificationPenalty`.
8. **`theme` keeps two sources of truth.** The duplication is the fix for the
   white flash, not a defect to be tidied away.

## What is still not filled, and by whom

`summary`, `whyItMatters` and `keyPoints` wait on the AI summariser; `score` and
`scoreComponents` on issue #9. Every section built on them is **hidden when
empty**, never rendered as a labelled empty block, and `summary` always falls
back to `excerpt`. Without that fallback every card in Phase 1 is blank.
