# Security

## Reporting a vulnerability

**Please do not open a public issue.** A public issue tells everyone running this
project about the hole at the same moment it tells the maintainer.

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/zarghammir/ai-radar/security/advisories/new).
It is private between you and the maintainer until a fix exists.

If that page is unavailable to you for any reason, open a public issue saying only
that you have found a security problem and would like a private channel — no
details — and you will be given one.

## What to expect

This is maintained by one person, so treat the following as intent rather than a
guarantee:

- an acknowledgement within a few days
- an assessment of whether it is a real problem, and a plain answer either way
- credit in the fix if you want it, and none if you would rather not

If a report is declined, you will be told why rather than left waiting.

## What is in scope

Anything that lets someone reach further than they should in an instance of this
app:

- reaching or altering another reader's data
- writing to a self-hosted instance from outside it without the internal secret
- reading credentials, tokens or connection strings out of the app, its logs, its
  API responses or its build output
- getting the collector to fetch, execute or store something it should not
- anything that turns a public instance into a way to attack the person running it

The hosted demo at `ai-radar-blue-delta.vercel.app` counts, as does a default
`docker compose up` install.

## What is not a vulnerability

These are decisions rather than oversights, so a report about them will be closed
with a pointer here:

- **There are no user accounts.** Version 1 is single-instance by design. One
  deployment has one set of settings, and whoever can open it can read it.
- **Reader state is not protected server-side, because it is not stored
  server-side.** Saves, hides and read marks live in each visitor's own browser
  (`localStorage`), which is why they are private per person without any login.
  They are also readable by anything else with access to that browser, which is
  the normal property of browser storage, not a flaw in this app.
- **Everything the app shows is already public.** It aggregates public feeds. The
  content is not confidential and is not treated as such.
- **Missing rate limiting on read-only endpoints.** Worth reporting if you can
  turn it into real harm — a way to run up someone's bill or take an instance
  down. Otherwise it is a known shape of a small self-hosted app.
- **Anything requiring the internal secret.** `INTERNAL_API_SECRET` is the
  boundary. Holding it is meant to grant ingestion control.

## What this project already does

Stated so you can check it rather than trust it:

- **No credentials are committed.** `.gitignore` excludes `.env*` while allowing
  `.env.example`, and no real credential has been in the history.
- **The internal secret cannot be left at its default.** The worker refuses to
  start when `INTERNAL_API_SECRET` is empty _or_ still the published placeholder
  from `.env.example`, because a placeholder everyone can read protects nothing.
  See `src/worker/secret.ts`.
- **Secrets are compared in constant time**, not with `===`.
- **Every external integration is optional and degrades quietly.** With no LLM
  provider configured the app ranks deterministically and shows source excerpts;
  with no VAPID keys it says plainly that this copy cannot send notifications.
  A missing token disables its feature rather than breaking the app.
- **Nothing is sent anywhere you did not configure.** The collector fetches the
  feeds in its catalogue and writes to your database. There is no telemetry.

## If you are running your own instance

Two things are yours rather than the project's:

1. **Generate a real `INTERNAL_API_SECRET`** — `openssl rand -hex 32`. The app
   refuses to run the worker without one, but only you can make it a good one.
2. **Decide whether your instance should be public at all.** It has no accounts,
   so anyone who can reach it can read it and change its settings. If that is not
   what you want, do not expose it to the internet.
