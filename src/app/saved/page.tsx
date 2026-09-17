import type { Metadata } from "next";
import { SavedScreen } from "@/components/saved/saved-screen";

export const metadata: Metadata = { title: "Saved" };

/**
 * Saved is loaded in the browser rather than on the server.
 *
 * The list is the reader's OWN state, not content: against the real API it is
 * one query that needs no pre-rendering, and on fixtures it lives in
 * localStorage, which the server cannot see. Rendering an empty bin on the
 * server and then filling it on the client would show every reader "nothing
 * saved" for a moment before contradicting it.
 */
export default function SavedPage() {
  return <SavedScreen />;
}
