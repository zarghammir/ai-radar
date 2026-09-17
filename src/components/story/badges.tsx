import { CONTENT_TYPE_LABELS, VERIFICATION } from "@/lib/api/labels";
import type { ContentType, VerificationLevel } from "@/lib/api/types";

/**
 * WHAT KIND OF THING THIS IS. A plain small-caps word, no box, on the left.
 * Deliberately a different shape from the verification chip: the two labels are
 * different things and must never read as the same kind of tag.
 */
export function ContentTypeBadge({ type }: { type: ContentType }) {
  return (
    <span className="font-label text-soft text-[11px] font-bold tracking-[0.18em] uppercase">
      {CONTENT_TYPE_LABELS[type]}
    </span>
  );
}

/**
 * HOW WELL-SOURCED THIS IS. A bordered chip carrying a four-segment meter AND
 * the word, on the right. Never the meter alone: colour and shape are not the
 * carriers, the word is. The bar count is a rendering of the enum, not a number
 * the server sends, so the picture and the word cannot drift apart.
 */
export function VerificationChip({ level }: { level: VerificationLevel }) {
  const { bars, word } = VERIFICATION[level];
  return (
    <span className="border-faint-2 ml-auto flex shrink-0 items-center gap-1.5 rounded-xs border px-1.5 py-0.5">
      <span aria-hidden className="flex gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={i < bars ? "bg-ink block h-2.5 w-1" : "bg-faint-2 block h-2.5 w-1"}
          />
        ))}
      </span>
      <span className="font-label text-ink text-[10.5px] font-bold tracking-[0.12em] whitespace-nowrap uppercase">
        {word}
      </span>
    </span>
  );
}
