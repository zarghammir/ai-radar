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

Needs **Node 22 or newer and npm 11 or newer**. `.nvmrc` pins the Node major and
`packageManager` in `package.json` pins the exact npm. Node 22 still ships npm 10,
which cannot read this repository's lockfile, so upgrade npm once after installing
Node:

```bash
nvm use                 # or install Node 22+ however you prefer
npm install -g npm@11
npm --version           # 11.x
```

If you skip that, `npm ci` stops with `EBADENGINE` and tells you the same thing.

```bash
git clone https://github.com/zarghammir/ai-radar.git
cd ai-radar
cp .env.example .env
docker compose up
```

Then open http://localhost:3000. Docker Compose is being added in Phase 1; until then:

```bash
npm ci
npm run db:migrate
npm run dev
```

## License

MIT © Zargham Mir
