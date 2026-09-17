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
  postgres:17-alpine
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
