import Link from "next/link";
import {
  KIND_LABELS,
  RADAR_KINDS,
  RADAR_RANGES,
  RADAR_SORTS,
  RADAR_VIEWS,
  RANGE_LABELS,
  SORT_LABELS,
  VIEW_LABELS,
  radarHref,
  type RadarQuery,
} from "@/lib/api/radar-query";
import { cn } from "@/lib/utils";

/**
 * The Radar controls: what kind, then how ordered and how far back.
 *
 * LINKS, NOT BUTTONS, and no client component anywhere in here. Every choice
 * is a URL, which is the requirement in #14 — a filtered feed can be reloaded,
 * bookmarked and sent to someone — and it means the whole control strip works
 * before any JavaScript runs and is keyboard-reachable for free.
 *
 * The hierarchy matches Today's: one primary row carrying the accent, and a
 * quiet line of text under it for the secondary choices. --org marks WHERE YOU
 * ARE and only the primary row may use it, or the screen has three competing
 * orange blocks and no hierarchy.
 */
export function RadarControls({ query }: { query: RadarQuery }) {
  return (
    <div className="mt-4">
      <div role="group" aria-label="What kind of stories" className="flex flex-wrap gap-2">
        {RADAR_KINDS.map((kind) => {
          const selected = kind === query.kind;
          return (
            <Link
              key={kind}
              href={radarHref(query, { kind })}
              aria-current={selected ? "true" : undefined}
              data-radar-chip={kind}
              className={cn(
                "focus-visible:ring-org rounded-xs border px-3 py-2 text-[14px] font-bold focus-visible:ring-2 focus-visible:outline-none",
                selected
                  ? "bg-org border-org text-org-on"
                  : "border-edge text-ash hover:text-ash-hi",
              )}
            >
              {KIND_LABELS[kind]}
            </Link>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]">
        <Choices
          label="Order by"
          values={RADAR_SORTS}
          labels={SORT_LABELS}
          current={query.sort}
          href={(sort) => radarHref(query, { sort })}
          marker="sort"
        />
        <Choices
          label="Going back"
          values={RADAR_RANGES}
          labels={RANGE_LABELS}
          current={query.range}
          href={(range) => radarHref(query, { range })}
          marker="range"
        />
        {/* The third choice is the only one that ADDS rows rather than
            narrowing them: adjacent tech is stored and kept out of every
            other screen, so if it is not reachable here it is not reachable
            at all. It sits in the quiet row because widening is the rarer
            intent, and it is a link like the others so the wider feed can be
            bookmarked and sent to someone. */}
        <Choices
          label="Scope"
          values={RADAR_VIEWS}
          labels={VIEW_LABELS}
          current={query.view}
          href={(view) => radarHref(query, { view })}
          marker="view"
        />
      </div>
    </div>
  );
}

/**
 * A quiet row of alternatives. text-ash rather than text-soft: the
 * accessibility sweep caught text-soft failing contrast at this size on the
 * dark theme, and "secondary" is a matter of weight and position rather than
 * of being harder to read.
 */
function Choices<T extends string>({
  label,
  values,
  labels,
  current,
  href,
  marker,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  current: T;
  href: (value: T) => string;
  marker: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1" role="group" aria-label={label}>
      <span className="text-ash">{label}</span>
      {values.map((value, i) => {
        const selected = value === current;
        return (
          <span key={value} className="flex items-baseline gap-2">
            {i > 0 ? (
              <span aria-hidden className="text-faint">
                ·
              </span>
            ) : null}
            <Link
              href={href(value)}
              aria-current={selected ? "true" : undefined}
              data-radar-option={`${marker}:${value}`}
              className={cn(
                "focus-visible:ring-org inline-block rounded-xs py-1 focus-visible:ring-2 focus-visible:outline-none",
                selected
                  ? "text-ash-hi font-bold underline underline-offset-4"
                  : "text-ash hover:text-ash-hi",
              )}
            >
              {labels[value]}
            </Link>
          </span>
        );
      })}
    </div>
  );
}
