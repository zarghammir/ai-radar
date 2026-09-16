/**
 * Fetches every source in the shipped catalogue through the adapter that will
 * actually read it, and reports OK or FAIL per source.
 *
 * Reads the catalogue rather than the database on purpose: the catalogue is
 * what `db:seed` writes, so this checks what is about to be seeded, and it
 * runs anywhere without a database. Exits non-zero if any source fails, so it
 * can gate a build.
 *
 *   npm run sources:check
 */
import type { Source } from "../src/db/schema";
import type { FetchContext } from "../src/sources/types";
import { SOURCE_SEEDS, type SourceSeed } from "../src/db/seed-data";
import { getAdapter } from "../src/sources/registry";

interface Row {
  key: string;
  url: string;
  status: string;
  items: number | null;
  ok: boolean;
  detail: string;
}

function asSource(seed: SourceSeed): Source {
  return {
    id: 0,
    key: seed.key,
    name: seed.name,
    kind: seed.kind,
    tier: seed.tier,
    url: seed.url,
    homepage: seed.homepage,
    enabled: seed.enabled ?? true,
    config: seed.config ?? {},
    defaultContentType: seed.defaultContentType,
    lastFetchedAt: null,
    lastError: null,
    createdAt: new Date(),
  } as Source;
}

/** Wraps fetch so the check can report the real HTTP status, not just a throw. */
function recordingFetch() {
  const statuses: number[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    statuses.push(res.status);
    return res;
  }) as typeof fetch;
  return { impl, statuses };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkOne(seed: SourceSeed): Promise<Row> {
  const url = seed.url ?? `(${seed.kind} API)`;
  const adapter = getAdapter(seed.kind);
  if (!adapter) {
    return {
      key: seed.key,
      url,
      status: "-",
      items: null,
      ok: false,
      detail: `no adapter for kind ${seed.kind}`,
    };
  }
  const { impl, statuses } = recordingFetch();
  const logs: string[] = [];
  const ctx: FetchContext = {
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    fetch: impl,
    log: (m) => logs.push(m),
  };
  try {
    const items = await adapter.fetch(asSource(seed), ctx);
    const distinct = [...new Set(statuses)].sort((a, b) => a - b);
    const bad = distinct.filter((s) => s < 200 || s >= 300);
    return {
      key: seed.key,
      url,
      status: distinct.join("/") || "-",
      items: items.length,
      // An adapter that swallows per-item failures still reports them; treat a
      // run that produced zero usable items as a failure, not a quiet success.
      ok: items.length > 0 && bad.length === 0,
      detail: items.length === 0 ? "parsed 0 items" : logs.join(" | "),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/HTTP (\d+)/);
    return { key: seed.key, url, status: m ? m[1] : "-", items: null, ok: false, detail: msg };
  }
}

async function main() {
  const seeds = SOURCE_SEEDS.filter((s) => s.enabled ?? true);
  const rows: Row[] = [];
  console.log(`Checking ${seeds.length} sources — ${new Date().toISOString()}\n`);
  for (const seed of seeds) {
    const row = await checkOne(seed);
    rows.push(row);
    const mark = row.ok ? "OK  " : "FAIL";
    const items = row.items === null ? "  -" : String(row.items).padStart(3);
    console.log(
      `${mark} ${row.key.padEnd(26)} ${String(row.status).padEnd(8)} items=${items}  ${row.url}` +
        (row.detail && !row.ok ? `\n       ${row.detail}` : ""),
    );
    await sleep(1000); // be a polite client
  }
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length} OK, ${failed.length} FAIL`);
  if (failed.length) {
    console.log(`Failed: ${failed.map((f) => f.key).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
