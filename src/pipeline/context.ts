import type { Source } from "@/db/schema";
import type { FetchContext } from "@/sources/types";

/**
 * Builds the FetchContext adapters receive.
 *
 * It lives here rather than in the worker so there is one definition: the
 * worker (issue #5) imports this instead of assembling a second context that
 * could disagree about the lookback window or drop the log channel.
 *
 * Until now nothing constructed a FetchContext at all, so `ctx.log` had a
 * caller in the Hacker News adapter and no provider — every reported failure
 * went nowhere. Lines are now both emitted and retained, so a caller can put
 * them somewhere durable.
 */

/** How far back an adapter may consider an item worth returning. */
export const DEFAULT_LOOKBACK_HOURS = 72;

export interface FetchContextOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  now?: Date;
  lookbackHours?: number;
  /** Where a line goes once recorded. Defaults to stdout. */
  sink?: (line: string) => void;
}

export interface BuiltFetchContext {
  ctx: FetchContext;
  /** Every line this source logged, in order, so a failure can be stored. */
  lines: string[];
}

export function createFetchContext(
  source: Pick<Source, "key">,
  options: FetchContextOptions = {},
): BuiltFetchContext {
  const lines: string[] = [];
  const emit = options.sink ?? ((line: string) => console.log(line));
  const now = options.now ?? new Date();
  const lookbackHours = options.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;

  const ctx: FetchContext = {
    since: new Date(now.getTime() - lookbackHours * 3_600_000),
    fetch: options.fetchImpl ?? fetch,
    log: (msg: string) => {
      // The source key is what makes a line actionable when every source logs
      // into the same stream.
      const line = `[${source.key}] ${msg}`;
      lines.push(line);
      emit(line);
    },
  };

  return { ctx, lines };
}
