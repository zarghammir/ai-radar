"use client";

import { useEffect } from "react";
import { setRead } from "@/lib/api/client";

/**
 * Opening a story is what "read" means, so opening it marks it read.
 *
 * IN AN EFFECT AND SETTING NO STATE. Writing the read mark is a side effect on
 * an external store, which is what effects are for; this component renders
 * nothing and holds nothing, so the rule against synchronous setState in an
 * effect does not apply.
 *
 * FAILURE IS SWALLOWED ON PURPOSE, and it is the only place in this feature
 * where that is right. The reader came to read a story. If the mark cannot be
 * written they still get the story, and an error banner over the thing they
 * asked for would be the app talking about itself. The mark is recoverable by
 * opening it again; the interruption is not.
 */
export function MarkRead({ storyId }: { storyId: number }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await setRead(storyId, true);
      } catch (error) {
        if (!cancelled) console.error("[story] could not mark read", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  return null;
}
