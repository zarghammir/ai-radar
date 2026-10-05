# AI Radar

An open-source AI intelligence app. Wake up, open it, and in five to ten minutes know
the AI news, releases, research, discussions and early signals that matter, and where
each claim originally came from.

- **Today's Brief**: a ranked, curated digest with 5-minute, 10-minute and everything modes.
- **Live Radar**: everything arriving, filterable by topic, source, type and confidence.
- **Provenance first**: verification level (primary source, corroborated, emerging, unverified)
  is kept separate from content type (news, release, paper, model, discussion …).
- **Runs for free**: no paid API is required. AI summaries and social sources are optional plug-ins.

Status: under construction, Phase 1. See `docs/` as it fills in.

## Try it — no install, no account

**[ai-radar-blue-delta.vercel.app](https://ai-radar-blue-delta.vercel.app)**

Open it in any browser. There is nothing to sign up for and nothing to configure.

If you would rather see what it is before opening it, there is a page for that:
**[/about](https://ai-radar-blue-delta.vercel.app/about)** — what it does, what is on
it right now, how to put it on a phone, and what this shared demo does and does not
keep private. That is the link to share.

It is a web app, so you can also keep it on your phone's home screen, where it
opens fullscreen with no browser bar and still shows pages you have already
opened when you have no signal.

### Put it on an iPhone

**It has to be Safari** — Chrome and Firefox on iOS cannot install web apps.

1. Open the link above in **Safari**
2. Tap the **Share** button — the square with an arrow, at the bottom
3. Scroll down the list and tap **Add to Home Screen**
4. Tap **Add**, top right

### Put it on an Android phone

1. Open the link above in **Chrome**
2. Tap the **⋮** menu, top right
3. Tap **Install app** — or **Add to Home screen** on older versions
4. Tap **Install**

Chrome often offers this by itself after a few seconds, as a bar along the
bottom. Either way works.

### What that demo is

One shared instance that anyone can open. **What you follow, what you save and what
you hide stay in your own browser** and are not visible to anyone else, including
whoever runs the instance. The one setting everyone shares is when the daily brief
is cut, and only whoever runs the copy can change it — this version has no accounts
by design.

Run your own copy and it is entirely yours. That is the rest of this page.

## Quick start (self-host)

Needs **Docker**, and nothing else. The Node toolchain below is only for working
on the code.

If you are self-hosting, skip to the `git clone` block — the Node and npm notes
immediately after this are for contributors.

### Node, for working on the code

Needs **Node 22.13 or newer and npm 11 or newer**. (22.13 is the lowest
Node that every dependency accepts: `vite` and `rolldown` need 22.12, and
`eslint-visitor-keys` needs 22.13.) `.nvmrc` pins the Node major and
`packageManager` in `package.json` pins the exact npm. Node 22 still ships npm 10,
which cannot read this repository's lockfile, so upgrade npm once after installing
Node:

```bash
nvm install 22          # installs the latest 22.x; or install Node 22.13+ your own way
npm install -g npm@11
npm --version           # 11.x
```

If you skip that, `npm ci` stops with `EBADENGINE` and tells you the same thing.

### Running it

```bash
git clone https://github.com/zarghammir/ai-radar.git
cd ai-radar
cp .env.example .env
openssl rand -hex 32   # paste the result into INTERNAL_API_SECRET in .env
docker compose up
```

`docker compose up` keeps running and printing logs — that is normal, and it is
how you watch it work. Open the app in a second terminal, or use
`docker compose up -d` if you would rather have your prompt back.

The worker refuses to start while `INTERNAL_API_SECRET` is still the placeholder
`change-me`: that secret guards the ingest trigger, and a published placeholder
guards nothing. The app itself will start either way, but nothing new arrives
until the worker can run.

### Setting when the brief is cut

The one setting shared by everyone who opens a copy is the time of day the daily
brief is cut, and its zone. Readers see it in Settings and cannot change it; the
person running the copy sets it once, with the same secret the collector uses:

```sh
curl -X PUT "$APP_URL/api/internal/preferences" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  -d '{"briefTime":"09:00","timezone":"America/Vancouver"}'
```

Everything else a reader can set — which topics they follow, how long the brief
runs, the theme — is theirs, lives in their browser, and is never written to the
server.

Then open http://localhost:3000. The first start creates the database schema and
loads the shipped catalogue of sources, so the app has something to show. Both
steps are safe to repeat, so an ordinary restart does not disturb existing data.

Compose runs three services: `web` (the app), `worker` (ingestion) and
`postgres:17`. Postgres keeps its data in a named volume — `docker compose down`
leaves it alone, `docker compose down -v` deletes it. Its port is deliberately
not published, since 5432 is usually taken by a local Postgres already; reach it
with `docker compose exec postgres psql -U ai_radar ai_radar`.

## Working on the code

The Node toolchain is not needed to self-host — Docker builds it all. It is
needed to work on the code, and this path needs its own database.

**You need a Postgres of your own.** The one Compose runs is deliberately not
reachable from your machine (its port is not published, as above), so it cannot
serve this path. `.env.example` expects a database, user and password all named
`ai_radar` on `localhost:5432`; this starts one that matches, so nothing needs
editing:

```bash
docker run --name ai-radar-db -d -p 5432:5432 \
  -e POSTGRES_USER=ai_radar -e POSTGRES_PASSWORD=ai_radar -e POSTGRES_DB=ai_radar \
  mirror.gcr.io/library/postgres:17-alpine
```

Already running Postgres? Create a matching role and database instead, or point
`DATABASE_URL` in `.env` at what you have.

Then:

```bash
npm ci
npm run db:migrate
npm run db:seed        # the same catalogue the Docker path loads for you
npm run dev
```

`db:seed` is the step the Docker path performs on its own. Without it the app
runs and has nothing to read, which looks like a broken build and is not one.
Both commands are safe to repeat.

## License

MIT © Zargham Mir
