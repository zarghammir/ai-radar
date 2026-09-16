import type { SourceTier, VerificationLevel } from "@/db/schema";

export interface ItemForVerification {
  sourceKey: string;
  sourceName: string;
  tier: SourceTier;
}

export interface VerificationResult {
  level: VerificationLevel;
  note: string;
}

/**
 * Verification is about WHERE the claim comes from, never about what it is.
 * Source tier influences this derivation but a high-tier mention alone does
 * not make a claim true: it yields CORROBORATED only when independent
 * established sources agree, and PRIMARY_SOURCE only when the originating
 * organization / authors published it themselves.
 *
 * ANALYST counts towards corroboration but cannot supply it alone. A named
 * expert newsletter reads the news rather than independently reporting it, so
 * two analysts agreeing is two readings of one story, not two witnesses.
 * CORROBORATED therefore needs two distinct named sources with at least one
 * newsroom among them.
 */
export function deriveVerification(items: ItemForVerification[]): VerificationResult {
  const bySource = new Map<string, ItemForVerification>();
  for (const it of items) bySource.set(it.sourceKey, it);
  const distinct = [...bySource.values()];
  const primary = distinct.filter((i) => i.tier === "PRIMARY");
  const hq = distinct.filter((i) => i.tier === "HIGH_QUALITY_REPORTING");
  const analyst = distinct.filter((i) => i.tier === "ANALYST");
  const community = distinct.filter((i) => i.tier === "COMMUNITY");
  const discovery = distinct.filter((i) => i.tier === "DISCOVERY");

  const names = (items: ItemForVerification[]) => items.map((i) => i.sourceName).join(", ");
  /** Sources that put their own name to a story. Both count towards a second
   *  source; only a newsroom can be the one that makes it corroboration. */
  const named = [...hq, ...analyst];

  if (primary.length > 0) {
    const others = hq.length + analyst.length + community.length;
    return {
      level: "PRIMARY_SOURCE",
      note:
        `Published directly by ${names(primary)}` +
        (others ? ` and picked up by ${others} other source${others > 1 ? "s" : ""}.` : "."),
    };
  }
  if (named.length >= 2 && hq.length >= 1) {
    return {
      level: "CORROBORATED",
      note:
        `Independently reported by ${names(hq)}` +
        (analyst.length ? `, with analysis from ${names(analyst)}.` : "."),
    };
  }
  if (analyst.length >= 2) {
    return {
      level: "EMERGING",
      note: `Covered by ${names(analyst)}; that is analysis rather than independent reporting, and no newsroom has confirmed it yet.`,
    };
  }
  if (named.length === 1) {
    const only = named[0];
    return {
      level: "EMERGING",
      note:
        only.tier === "ANALYST"
          ? `Covered by ${only.sourceName}; analysis only, with no primary source or newsroom yet.`
          : `Reported by ${only.sourceName}; no primary source or second outlet yet.`,
    };
  }
  if (community.length + discovery.length >= 2) {
    return {
      level: "EMERGING",
      note: `Circulating on ${names(distinct)}; not yet confirmed by an established outlet.`,
    };
  }
  const only = distinct[0];
  if (!only) {
    // No provenance at all is a different state from one weak source. Saying
    // "single unverified source: unknown" would describe a source that does
    // not exist, which is exactly the claim this field is meant to prevent.
    return { level: "UNVERIFIED", note: "No source recorded for this story yet." };
  }
  return {
    level: "UNVERIFIED",
    note: `Single ${only.tier === "COMMUNITY" ? "community" : "unverified"} source: ${only.sourceName}.`,
  };
}
