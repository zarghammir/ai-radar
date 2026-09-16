# Fixtures

Real responses captured from the live services, so adapter tests exercise the
shape those services actually return without touching the network.

These are **captured bytes, not source**. They are excluded from Prettier on
purpose: reformatting them would mean the tests no longer run against what the
service sent. Replace a file only by re-capturing it.

All captured **2026-09-16**.

| file | service | captured from |
|---|---|---|
| `rss/techcrunch-ai.rss.xml` | TechCrunch AI (RSS 2.0, 20 items) | `https://techcrunch.com/category/artificial-intelligence/feed/` |
| `rss/simon-willison.atom.xml` | Simon Willison (Atom, 30 entries) | `https://simonwillison.net/atom/everything/` |
| `arxiv/arxiv-query.atom.xml` | arXiv API (12 entries) | `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=12` |
| `hackernews/topstories.json` | Hacker News (500 ids) | `https://hacker-news.firebaseio.com/v0/topstories.json` |
| `hackernews/items.json` | Hacker News (first 12 of those ids) | `https://hacker-news.firebaseio.com/v0/item/<id>.json` |

Two RSS fixtures rather than one because `parse.ts` branches on feed format,
and a single fixture would leave the other branch unexercised.

`hackernews/items.json` is a map of id to the item response, assembled from one
request per id. The captured front page happens to include a story at 19 points,
just under the default floor of 20, which is what lets the test prove the floor
excludes it rather than the keyword filter.

## Refreshing

Fetch the URL above and overwrite the file. The tests assert floors on item
counts and on specific captured stories, so a refresh may need those updated —
that is deliberate, since a fixture whose contents nothing depends on would not
be testing anything.
