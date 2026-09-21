# Cost protection

AI Radar is meant to be runnable for roughly the price of a coffee a month, and to be
safe to run with a real API key in it. That depends on five rules. They are written
down here because they are easy to break by accident and expensive to break in public.

## The rules

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

**5. A schedule is a recurring cost even when nothing is paid.**
Runner minutes and requests to other people's servers are both spent by the clock, not
by a person deciding to spend them. A schedule that is twice as frequent as the product
needs costs twice as much forever, and nobody notices, because nothing fails. Write the
number down where it can be recomputed rather than rediscovered from a billing email.

## What is true today (2026-09-16)

Stated as verified facts rather than intentions, because a document that describes
guards which do not exist is worse than no document.

- **One module in `src/` can call a paid API: `src/llm/`.** It is reached from
  `src/worker/main.ts` and from nothing else. `npm run routes:check` is what keeps that
  true for anything a reader can reach, and it now forbids the whole `src/llm/`
  directory rather than only the `@anthropic-ai/sdk` package — two of the three
  providers are plain `fetch` against a base URL and import no package at all, so a
  package name alone was a tripwire for one provider instead of a rule for the feature.
- **No public API route can reach a paid service.** The count is deliberately not
  written here: `npm run routes:check` prints how many public and internal routes it
  examined, and a number copied beside a command that computes it is the only copy
  that can rot. (It was 12 public and 1 internal at `a057e5f`; 11 and 2 after #103.) This
  used to hold because there was no public route at all — true, but true for a reason
  that has now gone. It is checked rather than asserted: `npm run routes:check` walks
  the import graph out of every public route handler and fails if any can reach a feed
  adapter, the HTTP client, or an LLM SDK. It has no exceptions list, because a
  carve-out is a hole with a comment on it, and it prints how many routes it examined,
  because a checker that walks nothing reports no violations.
- **One internal route can trigger ingestion**, `POST /api/internal/ingest`, guarded by
  `INTERNAL_API_SECRET` and refusing before it reads or writes anything — so an
  unauthenticated caller leaves no trace in `ingest_runs` and costs nothing to refuse.
  It is not part of the client API and is not subject to the rule above.
- **Ingestion is free.** Every source in the seeded catalogue is a public feed or a free
  API. A pass costs bandwidth and nothing else.
- **The cap is enforced, and it refuses.** `src/llm/budget.ts` reads
  `LLM_MAX_STORIES_PER_DAY`, compares it against today's `llm_usage` rows before every
  call and returns without calling when the allowance is gone — it does not warn and
  proceed. `src/llm/run-summaries.test.ts` asserts the provider was **never invoked**
  rather than asserting a log line, because a test on the message passes for the
  version that spends the money anyway. That suite needs no `DATABASE_URL`: the one
  guard here that costs real money when it is wrong must not be a test that skips
  itself on a machine without a database.
- **An unreadable cap fails closed.** `LLM_MAX_STORIES_PER_DAY=twenty` reads as **zero**,
  not as the default. Someone who typed a cap wrong was trying to limit spending, and
  the default is the one reading that spends money they did not authorise.

## What a day of summaries costs (2026-09-21)

At the shipped default of `LLM_MAX_STORIES_PER_DAY=20` on Claude Haiku 4.5, billed at
$1 per million input tokens and $5 per million output tokens.

**The ceiling is arithmetic, not an estimate.** Both halves of one call are bounded by
constants in `src/llm/summarize.ts`: `MAX_OUTPUT_TOKENS = 400` is sent as `max_tokens`,
so the provider cannot exceed it, and the prompt is clipped to five reports of at most
600 excerpt characters each — `summarize.test.ts` asserts the built prompt stays under
6,000 characters, which is about 1,500 tokens.

|                             | per story | per day at the cap | per 30 days |
| --------------------------- | --------- | ------------------ | ----------- |
| ceiling (both limits hit)   | $0.0035   | $0.070             | **$2.10**   |
| typical (~800 in, ~250 out) | $0.0021   | $0.041             | **$1.23**   |

**These are token-count arithmetic, not a measured bill**, because measuring one needs a
real key and a real day. The code records what the provider actually charged into
`llm_usage.input_tokens` and `output_tokens`, so after one real day this table can be
replaced with the measurement instead of the model.

**What happens if volume doubles: nothing happens to the cost.** That is the point of a
cap, and it is worth saying plainly because the instinct is to expect the bill to move.
Measured from the last successful pass, 200 stories were scored inside the seven-day
ranking window, which is about **29 new stories a day**, so a cap of 20 covers roughly
**70%** of them. Double the volume and the cap covers **35%** — the bill is identical
and the coverage is what degrades. If that trade is wrong, the number to change is the
cap, and changing it changes the bill proportionally.

## What the schedule costs (2026-09-16)

This is the one recurring cost the project has today. Nothing here is a paid API call,
which is exactly why it is easy to miss.

`.github/workflows/ingest.yml` runs every 30 minutes: **48 runs a day, about 1,440 a
month.** This repository is **private**, so those minutes bill against the GitHub Free
plan's **2,000 minutes a month** rather than being free as they would be on a public
repository.

Measured from this project's own runs, not estimated:

|                                                                           | measured |
| ------------------------------------------------------------------------- | -------- |
| the steps `ingest.yml` shares with CI (checkout, node, npm pin, `npm ci`) | 22s      |
| one real ingestion pass                                                   | 9.0s     |
| the `lint, typecheck, test, build` job                                    | 86s      |
| the `compose-smoke` job                                                   | 93s      |

So a scheduled run is about **31 seconds** of work. What that bills depends on how
GitHub rounds, which its billing documentation does not state on the page that gives the
allowance:

- Billed by actual time: 1,440 × 31s ≈ **744 minutes a month**, about 37% of the allowance.
- Billed per job rounded up to the whole minute: ≈ **1,440 minutes**, about 72%.

**Assume the second until someone confirms otherwise**, because it is the one that can
run out. Either way, a single pull request already costs about 4 minutes across the two
CI jobs, so the schedule is the largest line in the budget by a wide margin.

**To recompute after a schedule change:** runs per month = `(60 ÷ interval_minutes) × 24
× 30`; minutes per month = runs × 1 (rounded up) or runs × 31 ÷ 60 (actual). At hourly
instead of half-hourly, every figure above halves.

**And the other side of the same schedule:** 1,440 runs × 17 sources ≈ **24,000 requests
a month to other people's feeds**, plus one round of 18 on every pull request from
`compose-smoke`. None of it is paid, so it is not a billing risk — but it is the kind of
thing a publisher rate-limits or blocks, and this is where a self-hoster would look for
it. It is also why `INGEST_INTERVAL_MINUTES` has a floor: the interval is a request rate
against other people's servers, not just a local loop.

## What the first paid call brought with it

This was the contract for whoever added AI summaries. It is kept here as the checklist
it was, with what satisfies each line, because the next paid call inherits it:

- **Read the key with a server-only accessor; never pass it through a prop or a
  response.** The key is closed over inside `createLlmClient` and is never placed on a
  return value, a log line or an error.
- **Put the call in a module the worker imports and a page cannot.** `src/llm/`, reached
  from `src/worker/main.ts`. The internal HTTP trigger shares `ingestOnce` with the
  worker loop and deliberately does **not** share the summariser: a paid call belongs to
  a process on a schedule the owner controls, not to a request handler, even a
  secret-guarded one.
- **Check the cap before the call and write the row after it.** `remainingToday` before,
  `recordUsage` after — and the ledger is re-read inside the loop, because a cap enforced
  only by the length of a list was enforced by arithmetic done before the spending
  started.
- **Make the app work with `LLM_PROVIDER=none`.** It is the shipped default. A missing
  provider, a missing key and a misspelled provider name all disable summaries and say
  which variable to set; none of them throws, because a worker with seventeen working
  feeds must not die over an enhancement.
- **A test that a page render cannot reach the call, and one that the cap refuses it.**
  `npm run routes:check` and `src/llm/run-summaries.test.ts`.

**And the cost ledger records failures.** A call that reached the provider and came back
as unusable rubbish still spent the tokens, so it is charged to the day's allowance. A
ledger that counted only successes would under-report the bill in exactly the case
somebody is watching it.

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

# Rule 5 — what does the schedule actually say right now?
grep -n "cron" .github/workflows/ingest.yml
```

The third command now prints `src/llm/budget.ts` and `src/llm/run-summaries.ts`. If it
ever prints nothing again, the cap has been removed and something paid may still be
running — which is the one combination this page exists to make impossible to reach
quietly.
