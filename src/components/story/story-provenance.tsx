import type { StoryDetail } from "@/api/stories";
import { SOURCE_TIER_LABELS } from "@/lib/api/labels";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * WHERE THIS CAME FROM — the reason the page exists.
 *
 * A story is assembled from several raw items across several sources. The
 * brief shows one link and a count, which is a SUMMARY of provenance rather
 * than provenance: a reader cannot tell from it whether the claim originated
 * with the lab or with somebody reporting on the lab.
 *
 * THE ORIGINAL SOURCE IS FIRST AND SEPARATE, not the first row of a list. It
 * is the answer to the question the reader came with, and a list makes every
 * entry look equally load-bearing when one of them is the origin and the rest
 * are pickup.
 *
 * "Original" here means the item the pipeline chose as primary — the row at
 * stories.primary_item_id, which is also where the card's own url comes from.
 * It is stated as what it is rather than implied.
 */
export function StoryProvenance({
  story,
  publishedAt,
}: {
  story: StoryDetail;
  publishedAt: Date | null;
}) {
  const primary = story.items.find((i) => i.role === "primary") ?? story.items[0] ?? null;
  const others = story.items.filter((i) => i !== primary);

  return (
    <section className="mt-6" data-provenance="true">
      <b className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase">
        Original source
      </b>

      {primary ? (
        <div className="border-edge mt-2 border p-3" data-original-source="true">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <b className="text-ink text-[15px] font-bold">{primary.source.name}</b>
            <span className="text-meta font-mono text-[10.5px]">
              {SOURCE_TIER_LABELS[primary.source.tier]}
            </span>
            {publishedAt ? (
              <span className="text-meta font-mono text-[10.5px] tabular-nums">
                · {when(publishedAt.toISOString())}
              </span>
            ) : null}
          </div>
          <a
            href={primary.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:ring-org mt-1 block rounded-xs text-[14.5px] underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {primary.title}
          </a>
        </div>
      ) : (
        // The story exists but its primary item does not. Said plainly rather
        // than rendered as an empty box, because on THIS page a missing origin
        // is the one thing a reader must not have to infer.
        <p className="text-ash mt-2 text-[14px]">
          This story has no recorded original item, which is a gap in its provenance rather than a
          story without a source.
        </p>
      )}

      {story.discussionUrl ? (
        <p className="mt-3 text-[14px]">
          <span className="text-soft">Discussion: </span>
          <a
            href={story.discussionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:ring-org rounded-xs underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:outline-none"
          >
            the thread about this
          </a>
        </p>
      ) : null}

      {/* PICKUP, and it is a different question from origin. Absent when one
          source is the only source — "and 0 others" is a sentence about
          nothing, the same rule the card follows. */}
      {others.length > 0 ? (
        <div className="mt-4" data-pickup="true">
          <b className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase">
            Then picked up by
          </b>
          <ol className="mt-2 flex flex-col gap-2">
            {others.map((item) => (
              <li key={item.id} className="text-[14px] leading-[1.4]">
                <span className="text-meta font-mono text-[10.5px] tabular-nums">
                  {when(item.publishedAt)}
                </span>{" "}
                <b className="text-ink font-semibold">{item.source.name}</b>
                {item.role ? <span className="text-ash"> · {item.role}</span> : null}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-visible:ring-org ml-1 rounded-xs underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
