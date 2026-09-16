# Cost protection

AI Radar is meant to be runnable for roughly the price of a coffee a month, and to be
safe to run with a real API key in it. That depends on four rules. They are written
down here because they are easy to break by accident and expensive to break in public.

## The four rules

**1. Keys live in the environment, nowhere else.**
No key in the repository, in a client component, in a `NEXT_PUBLIC_*` variable, or in a
database row. `.env.example` documents every variable and contains no real value.

**2. Paid calls happen inside the worker.**
The worker is the only process allowed to spend money. It runs on a schedule you
control, on a machine you control, and it is where a runaway loop is visible and
stoppable. A page render must never trigger a paid call: page renders are driven by
whoever visits the site, which is not a budget you control.

**3. Every paid call has a hard cap.**
A cap that is a comment is not a cap. It is a number read from the environment, checked
before the call, and recorded after it, so that "we stayed under the limit" is a query
rather than a belief. `LLM_MAX_STORIES_PER_DAY` and the `llm_usage` table exist for
exactly this.

**4. No public route reaches a paid service.**
Nothing reachable without a secret may cause a paid call, directly or by queueing work
that will make one. Otherwise the bill is set by strangers.

## What is true today (2026-09-16)

Stated as verified facts rather than intentions, because a document that describes
guards which do not exist is worse than no document.

- **No code in `src/` calls a paid API.** `@anthropic-ai/sdk` is a dependency, but
  nothing imports it yet. There is currently no way for this app to spend money.
- **The app has exactly one API route**, `POST /api/internal/ingest`, and it is guarded
  by `INTERNAL_API_SECRET` before it reads or writes anything. There is no public route
  to protect yet, because there is no public route.
- **Ingestion is free.** Every source in the seeded catalogue is a public feed or a free
  API. A pass costs bandwidth and nothing else.
- **The cap is not yet enforced.** `LLM_MAX_STORIES_PER_DAY` is documented in
  `.env.example` and `llm_usage` is in the schema, but no code reads either, because no
  code summarises anything yet. Rule 3 is a contract for whoever writes the first paid
  call, not a description of a guard that is already running.

## When the first paid call lands

Whoever adds AI summaries owns all of this, in the same pull request as the call itself:

- Read the key with a server-only accessor; never pass it through a prop or a response.
- Put the call in a module the worker imports and a page cannot.
- Check `LLM_MAX_STORIES_PER_DAY` against today's `llm_usage` row **before** the call,
  and write the row **after** it, in the same run.
- Make the app work with `LLM_PROVIDER=none`. Summaries are an enhancement; the brief is
  useful without them, and a missing key must degrade rather than fail.
- Add a test that a page render cannot reach the call, and one that the cap refuses the
  call rather than logging a warning and proceeding.

## Checking the rules yourself

These are the commands, not a promise:

```sh
# Rule 1 — no key material in the tree; .env is ignored, .env.example has placeholders.
git ls-files | grep -E '^\.env' # expect only .env.example
grep -rn "NEXT_PUBLIC_" src/    # expect nothing holding a secret

# Rule 2 and 4 — what can a request reach? List every route and read its guard.
find src/app -name route.ts

# Rule 3 — what reads the cap, and what writes the ledger?
grep -rn "LLM_MAX_STORIES_PER_DAY\|llmUsage" src/
```

If the last command prints nothing, the cap is still unenforced and nothing paid is
running — which is the state described above.
