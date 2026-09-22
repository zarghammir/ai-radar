"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Turning on the brief that arrives by itself.
 *
 * EVERY REFUSAL IS NAMED. A push subscription can fail at six separate points
 * — no service worker, no Push API, no VAPID key on the server, permission
 * denied, permission dismissed, the push service refusing — and all six look
 * identical to a reader if the button simply does nothing. Each one gets a
 * sentence here, because "I pressed it and nothing happened" is the state that
 * makes people stop trusting the feature, and it is the same silent-dead-end
 * shape #72 was filed about.
 */

type State =
  | { kind: "checking" }
  | { kind: "unsupported"; why: string }
  | { kind: "unconfigured" }
  | { kind: "off" }
  | { kind: "on" }
  | { kind: "working" }
  | { kind: "error"; why: string };

/** The server's public key arrives as base64url; the API wants bytes. */
function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  // Allocated rather than built with Uint8Array.from, which infers the wider
  // ArrayBufferLike and is not assignable to applicationServerKey.
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * What this browser can do, asked once on mount.
 *
 * Async so that every answer lands after an await: the capability checks are
 * synchronous facts, but setting state from an effect body synchronously is
 * what makes a component render twice before it has shown anything.
 */
async function detectState(publicKey: string): Promise<State> {
  if (!("serviceWorker" in navigator)) {
    return { kind: "unsupported", why: "This browser has no service worker." };
  }
  if (!("PushManager" in window)) {
    return { kind: "unsupported", why: "This browser cannot receive push notifications." };
  }
  // Said before the button is pressed rather than after: without a key on the
  // server there is nothing to subscribe to, and that is the operator's job,
  // not the reader's.
  if (!publicKey) return { kind: "unconfigured" };

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return { kind: existing ? "on" : "off" };
  } catch {
    return { kind: "off" };
  }
}

export function PushToggle() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    void detectState(publicKey).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const enable = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState({
          kind: "error",
          why: "This browser is blocking notifications for this site. You can allow them again in the padlock menu beside the address bar.",
        });
        return;
      }
      if (permission !== "granted") {
        setState({
          kind: "error",
          why: "The permission prompt was dismissed, so nothing changed.",
        });
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        // Rolled back, so the browser is not left holding a subscription this
        // instance has no record of and will never send to.
        await subscription.unsubscribe().catch(() => undefined);
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setState({
          kind: "error",
          why: body?.error?.message ?? "The server would not record this browser.",
        });
        return;
      }
      setState({ kind: "on" });
    } catch (error) {
      setState({ kind: "error", why: error instanceof Error ? error.message : String(error) });
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState({ kind: "off" });
    } catch (error) {
      setState({ kind: "error", why: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  if (state.kind === "checking") return null;

  if (state.kind === "unsupported" || state.kind === "unconfigured") {
    return (
      <p className="border-faint-2 text-soft mt-3 border border-dashed p-3 text-[13px] leading-relaxed">
        {state.kind === "unsupported" ? (
          <>
            {state.why} The brief still waits for you on Today.{" "}
            <b className="text-ink font-semibold">Nothing is sent to this browser.</b>
          </>
        ) : (
          <>
            This copy of AI Radar has no notification key, so it cannot send to anyone.{" "}
            <b className="text-ink font-semibold">
              Whoever runs it sets VAPID_SUBJECT and a key pair in the environment.
            </b>{" "}
            Until then the choice above is recorded and nothing arrives.
          </>
        )}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void (state.kind === "on" ? disable() : enable())}
        disabled={state.kind === "working"}
        className="border-ink hover:bg-faint focus-visible:ring-org border px-3 py-2 text-[14px] font-semibold focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
      >
        {state.kind === "working"
          ? "Working…"
          : state.kind === "on"
            ? "Stop sending to this browser"
            : "Send the brief to this browser"}
      </button>

      <p className="text-soft mt-2 text-[13px] leading-relaxed">
        {state.kind === "on" ? (
          <>
            This browser will be told once a day, soon after your brief time.{" "}
            <b className="text-ink font-semibold">
              Not at it exactly — the collector runs a handful of times a day, and the brief goes
              out on the first run after your time.
            </b>{" "}
            A quiet day still sends, and says it was quiet.
          </>
        ) : (
          <>Each browser is asked separately, so turning this on here does not affect another.</>
        )}
      </p>

      {state.kind === "error" && (
        <p className="border-faint-2 text-soft mt-2 border border-dashed p-3 text-[13px] leading-relaxed">
          {state.why}
        </p>
      )}
    </div>
  );
}
