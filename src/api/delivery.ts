import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  summariseDeliveryHealth,
  type DeliveryHealthSummary,
  type DeliveryHistory,
} from "./delivery-health";

/**
 * Reading `brief_sends` into the one shape a person can act on.
 *
 * WHAT IS DELIBERATELY NOT HERE is the point of the module, and it is the same
 * rule `listSources` follows: `sources.lastError` is excluded there because a
 * stored driver message can carry a host, a port and a user, and the route is
 * unauthenticated.
 *
 * `brief_sends.detail` is worse. It is free text this app copies out of a push
 * service's HTTP response body, so its contents are decided by a third party
 * and nobody here has read them all. `push_subscriptions.endpoint` is worse
 * again: it is the address of a specific browser, and anyone holding one can
 * push to that reader. NEITHER LEAVES THIS MODULE.
 *
 * Nothing a reader could act on is lost. The health state says whether to do
 * something, the counts say how bad it is, and the day says since when. The
 * free text stays in the database for whoever has a SQL client — which is
 * where it was safe all along, and where it was USELESS, which is what #149
 * was filed about.
 */

export interface DeliveryStatus {
  summary: DeliveryHealthSummary;
  /** The local day of the most recent decision, or null if there is none. */
  lastDecisionDay: string | null;
  /** Subscriptions currently on file. The audience, not the addresses. */
  subscriptions: number;
  /** Browsers delivered to on the most recent decision. */
  lastDelivered: number;
  /** Browsers that failed on the most recent decision. */
  lastFailed: number;
}

interface Row {
  decisions: number;
  consecutive_failures: number;
  latest_outcome: string | null;
  latest_day: string | null;
  latest_delivered: number;
  latest_failed: number;
  subscriptions: number;
}

export async function readDeliveryStatus(db: Db): Promise<DeliveryStatus> {
  const rows = await db.execute(
    sql`
    with latest as (
      select outcome, local_day, delivered, failed
        from brief_sends
       order by decided_at desc
       limit 1
    )
    select
      (select count(*) from brief_sends)::int as decisions,
      -- Failures since the last SEND. A negative-infinity bound rather than a
      -- null guard, so an instance that has never once delivered counts all of
      -- its failures instead of none of them — the same trap listSources
      -- documents, and the same fix.
      --
      -- Only 'failed' is counted. A 'skipped' morning is not a failure: nobody
      -- was subscribed, and counting it would report an instance with no
      -- readers as broken.
      (select count(*) from brief_sends f
         where f.outcome = 'failed'
           and f.decided_at > coalesce(
             (select max(s.decided_at) from brief_sends s where s.outcome = 'sent'),
             '-infinity'::timestamptz))::int as consecutive_failures,
      (select outcome    from latest) as latest_outcome,
      (select local_day  from latest) as latest_day,
      coalesce((select delivered from latest), 0)::int as latest_delivered,
      coalesce((select failed    from latest), 0)::int as latest_failed,
      (select count(*) from push_subscriptions)::int as subscriptions
  `,
  );

  const row = (rows as unknown as Row[])[0];

  const history: DeliveryHistory = {
    decisions: Number(row?.decisions ?? 0),
    consecutiveFailures: Number(row?.consecutive_failures ?? 0),
    latestOutcome: (row?.latest_outcome as DeliveryHistory["latestOutcome"]) ?? null,
  };

  return {
    summary: summariseDeliveryHealth(history),
    lastDecisionDay: row?.latest_day ?? null,
    subscriptions: Number(row?.subscriptions ?? 0),
    lastDelivered: Number(row?.latest_delivered ?? 0),
    lastFailed: Number(row?.latest_failed ?? 0),
  };
}
