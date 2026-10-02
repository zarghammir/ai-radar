# Contributing

Thanks for looking. This is a small project maintained by one person, so the
fastest way to get a change in is to make it easy to verify.

## What the thing actually is

Three parts that do not share a process:

| part          | where it runs                                        | what it does                                                          |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| **collector** | GitHub Actions on a timer, or the `worker` container | fetches the source catalogue, clusters items into stories, ranks them |
| **database**  | Postgres                                             | the only thing the other two share                                    |
| **website**   | Vercel, or the `web` container                       | reads and displays; it never fetches a feed                           |

The website does not collect. If news is stale, the collector is the place to
look, not the page.

## Getting it running

To **use** it, you need Docker and nothing else — see the README.

To **work on it**, you also need Node 22.13+ and npm 11+. Node 22 still ships
npm 10, which cannot read this lockfile:

```bash
nvm install 22
npm install -g npm@11
npm ci
```

Copy `.env.example` to `.env` and put a real value in `INTERNAL_API_SECRET`
(`openssl rand -hex 32`). The worker refuses to start on the placeholder, on
purpose.

## Before you open a pull request

Run what CI runs:

```bash
npm run typecheck     # next typegen && tsc --noEmit — the typegen half matters
npm run lint
npm run format:check
npm run test
npm run build
```

Set `DATABASE_URL` to a real database when you run the tests. Without it a
meaningful number of them skip, and a suite that skips is not a suite that
passed. A local `createdb` is enough.

Some checks are easy to forget because they are not `test`:

```bash
npm run migrations:check   # the migration journal agrees with the files
npm run env:check          # the worker can actually SEE what it reads
```

That second one exists because three secrets were once added to switch a feature
on, nothing happened, and every test passed the whole time — the workflow simply
never forwarded them. If you add something the worker reads, it must also be
forwarded in `.github/workflows/ingest.yml`, and this check is what tells you.

## Database changes

This is the one rule worth reading before you write a migration, because getting
it wrong is silent:

```
ADDITIVE     may apply itself, and MUST RUN BEFORE the code that uses it
DESTRUCTIVE  is a decision, and MUST RUN AFTER the code stops using it
```

Opposite orders, so they cannot be one step. Additive migrations apply themselves
on merge. Anything that drops, rewrites or deletes is refused by the gate and
raises an issue instead — that is the gate working, not failing. Apply those
deliberately once the code that used them is gone.

There is a second trap the gate exists for: Drizzle permanently skips a migration
whose timestamp sits below what production has already applied. `migrations:check`
compares against the base branch on a pull request, which is the only place a
collision between two branches is visible.

Catalogue changes (`src/db/seed-data.ts`) apply themselves on merge too, and the
seeding step reads the database back afterwards and fails if anything did not
land. Adding a source is a one-line change plus that merge.

## What a good pull request looks like

There is a template, and it asks for plain words rather than a changelog. The
short version:

- **Say what it does for someone who does not read code.** If a reader of this
  app would notice nothing, say that and say what it unblocks.
- **Say how you verified it, with the commands and their results.** A claim in a
  pull request is a claim. "Tests pass" is weaker than the count, and a count
  that includes skipped tests is weaker still.
- **If you fixed something, show the check catching it.** The strongest evidence
  a new guard works is that it fails when you break the thing on purpose, and
  that the old code passed the same test. Several checks in this repo carry a
  `--self-test` flag for exactly that reason.
- **Screenshots for anything with a screen**, at the sizes it has to work at.

Keep pull requests to one idea. A small one gets read today.

## House style, such as it is

- **Comments explain why, and they are claims.** If you change behaviour a
  comment describes, change the comment in the same commit. A comment that has
  quietly stopped being true is worse than no comment, because someone will trust
  it.
- **Prefer making a thing impossible over documenting that it is wrong.**
- **Write the reasoning down where the decision lives**, not in the pull request
  where nobody will find it again.

Formatting is Prettier and ESLint; `npm run format` fixes most of it. Do not
spend time on style by hand.

## Things that are decided, not open

So you do not spend an afternoon on a change that will be declined:

- **No user accounts in version 1.** One instance, one set of settings.
- **Reader state lives in the reader's browser.** Saves, hides and read marks are
  per-device by design, because one instance can be read by several people and a
  shared row would mix them.
- **Every external integration stays optional.** If a token is missing, that
  adapter switches itself off and the rest keeps running. Nothing may become a
  hard dependency on a paid API.
- **No fabricated content.** Real sources, real data. Nothing invented to make a
  screen look finished.

If you think one of these is wrong, open an issue and argue it. That is a better
use of your time than a pull request that assumes it.
