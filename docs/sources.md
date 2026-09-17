# Adding a source

A **source** is a row in the `sources` table: a place AI Radar reads from. An
**adapter** is the code that knows how to read one _kind_ of place. Most new
sources need no new code, because an adapter for their kind already exists.

Start by asking which of these you are doing:

| you have                                  | you need                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| A site with a working RSS or Atom feed    | A catalogue entry. No code.                                      |
| Hacker News or arXiv                      | A catalogue entry. No code.                                      |
| A site with no usable feed                | An adapter — see [When there is no feed](#when-there-is-no-feed) |
| A source of a kind nobody has written yet | An adapter                                                       |

---

## The common case: a catalogue entry

The shipped catalogue is `SOURCE_SEEDS` in `src/db/seed-data.ts`. Add an entry,
run the seed, and the worker picks it up on its next pass.

```ts
{
  key: "example-blog",            // stable machine name; the identity of the row
  name: "Example",                // what a reader sees
  kind: "rss",                    // which adapter reads it
  tier: "HIGH_QUALITY_REPORTING", // how much its word is worth — see Ranking below
  url: "https://example.com/feed",// the feed; null for API-backed kinds
  homepage: "https://example.com",// shown in provenance
  defaultContentType: "NEWS",     // what its items are, unless the adapter says otherwise
}
```

Then:

```sh
npm run sources:check   # fetches every ENABLED catalogue source through its real adapter
npm run db:seed         # writes the catalogue to the database
```

`sources:check` reads the **catalogue**, not the database, so it tells you
whether the thing you just added actually works before you seed it — and it
runs without a database at all. It exits non-zero if any source fails.

It skips entries with `enabled: false`. If you add a source switched off and
`sources:check` says nothing about it, that is why — and it means a disabled
source is never proved to work before someone switches it on.

### What the seed does, and does not, overwrite

`db:seed` is safe to re-run. It matches on `key` and updates the catalogue
fields: `name`, `kind`, `tier`, `url`, `homepage`, `config`,
`defaultContentType`.

**It never touches `enabled`.** A source you switched off stays off across every
future seed — that is deliberate, so operating decisions survive a code update.

It also never deletes. A source that exists in the database but no longer
appears in the catalogue is reported as an **orphan** and left alone.

---

## Writing an adapter

An adapter is registered by `kind` in `src/sources/registry.ts`, and every row
whose `kind` matches uses it. Nothing else in the app changes.

The contract is `SourceAdapter` in `src/sources/types.ts`:

```ts
interface SourceAdapter {
  kind: SourceKind;
  description: string;
  fetch(source: Source, ctx: FetchContext): Promise<FetchedItem[]>;
}
```

**An adapter does not touch the database.** It returns items; the pipeline
normalizes, deduplicates, stores and clusters them. Keeping that line is what
lets `sources:check` run an adapter with no database in sight.

### What `fetch` is given

`ctx.fetch` — use this rather than the global. It is how tests drive an adapter
with a fake network and no live requests.

`ctx.since` — items older than this may be skipped.

`ctx.log(msg)` — the only channel out. Lines go to the operator's console **and
are stored on the run's `ingest_runs.error` if that source fails**, so a message
explaining why something was skipped is worth writing.

### What `fetch` must return

`FetchedItem[]`. The fields that matter most:

- **`externalId`** — stable within this source, across re-fetches. This is what
  stops the same article arriving twice. A URL that changes its query string
  between requests is not stable; the feed's `guid` usually is.
- **`url`**, **`title`** — required.
- **`publishedAt`** — `Date` or `null`. Do not invent one.
- **`contentType`** — optional. Set it when the adapter _knows_ better than the
  source's default (the arXiv adapter always says `PAPER`). Otherwise leave it
  out and `defaultContentType` applies.
- **`metadata`** — anything worth keeping: points, comments, categories. The
  ranker reads engagement from here.

New kinds go in `SOURCE_KINDS` in `src/db/schema.ts`, which is a database enum,
so adding one is a migration.

---

## Ranking: adding a source is a ranking decision

This is the part that surprises people. Two fields you set in the catalogue
feed the score directly, in `src/pipeline/ranking/score.ts`.

**`tier` is the biggest single input to a story's score.** Only the highest tier
among a story's sources counts:

| tier                     | weight                                                |
| ------------------------ | ----------------------------------------------------- |
| `PRIMARY`                | 20                                                    |
| `HIGH_QUALITY_REPORTING` | 12                                                    |
| `ANALYST`                | 9                                                     |
| `COMMUNITY`              | 4                                                     |
| `DISCOVERY`              | **0** — the word does not appear in `score.ts` at all |

For comparison, recency contributes at most 14 and a topic match at most 22. So
calling a source `PRIMARY` when it is a newsletter _about_ primary sources
outranks a genuinely fresh story from a newsroom. Tier means "whose word is
this", not "how good is it".

**`defaultContentType` adds a smaller amount**, from `WEIGHTS.contentType`:
`RELEASE` and `MODEL` 6, `TOOL` 4, `REGULATION` 3, `NEWS`, `BUSINESS` and
`TREND` 2, `RESEARCH` 1, `PAPER` and `DISCUSSION` 0.

> **Known gap — issue #41.** Five of the ten content types cannot occur today:
> nothing in the adapters, the catalogue or the normalizer ever produces
> `TREND`, `TOOL`, `MODEL`, `BUSINESS` or `REGULATION`. `MODEL` carries the
> joint-highest weight of any content type, on a category nothing emits. If the
> source you are adding really does publish model releases or regulation, you
> are the first — say so on #41 rather than quietly picking the nearest type
> that already works.

---

## Two traps

### When there is no feed

Some sites worth reading publish no usable feed at all — Anthropic's news page
and Meta AI among them. They need an HTML listing adapter, which is **issue
#26** and does not exist yet. Do not work around it by pointing an `rss` source
at a page that is not a feed: the fetch will succeed, the parse will produce
nothing, and the source will look healthy while contributing zero items.

### A working feed can still be refused

A feed that works from your laptop can be refused from a datacenter. Substack
returns **403** to GitHub's runners, so `import-ai` fails on every hosted
ingestion run while working perfectly when a person tests it locally. That is
**issue #38**.

The consequence for you: `npm run sources:check` passing on your machine does
not prove the source works where it will actually run. And because one failing
source out of many is deliberately not enough to fail a scheduled run — a dead
feed should not turn the whole schedule red — a source that never works in
production can look fine indefinitely. Check `ingest_runs` for the source, or
the per-source line in a worker pass, rather than trusting a green run.

---

## Checking your work

```sh
npm run sources:check                  # does the adapter actually read it?
npm run db:seed                        # write the catalogue
npm run worker:once                    # one real pass; prints a line per source
```

A pass prints `fetched` and `new` per source, and `FAILED` with the reason for
any that did not work. Run it twice: the second run should report your source
`fetched N, 0 new`. If it reports new items again, `externalId` is not stable
and every pass will duplicate the source's entire feed.
