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
 */
export function deriveVerification(items: ItemForVerification[]): VerificationResult {
  const bySource = new Map<string, ItemForVerification>();
  for (const it of items) bySource.set(it.sourceKey, it);
  const distinct = [...bySource.values()];
  const primary = distinct.filter((i) => i.tier === "PRIMARY");
  const hq = distinct.filter((i) => i.tier === "HIGH_QUALITY_REPORTING");
  const community = distinct.filter((i) => i.tier === "COMMUNITY");
  const discovery = distinct.filter((i) => i.tier === "DISCOVERY");

  if (primary.length > 0) {
    const others = hq.length + community.length;
    return {
      level: "PRIMARY_SOURCE",
      note:
        `Published directly by ${primary.map((p) => p.sourceName).join(", ")}` +
        (others ? ` and picked up by ${others} other source${others > 1 ? "s" : ""}.` : "."),
    };
  }
  if (hq.length >= 2) {
    return {
      level: "CORROBORATED",
      note: `Independently reported by ${hq.map((h) => h.sourceName).join(", ")}.`,
    };
  }
  if (hq.length === 1) {
    return {
      level: "EMERGING",
      note: `Reported by ${hq[0].sourceName}; no primary source or second outlet yet.`,
    };
  }
  if (community.length + discovery.length >= 2) {
    return {
      level: "EMERGING",
      note: `Circulating on ${distinct.map((d) => d.sourceName).join(", ")}; not yet confirmed by an established outlet.`,
    };
  }
  return {
    level: "UNVERIFIED",
    note: `Single ${distinct[0]?.tier === "COMMUNITY" ? "community" : "unverified"} source: ${distinct[0]?.sourceName ?? "unknown"}.`,
  };
}
