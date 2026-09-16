"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, X } from "lucide-react";
import { brand } from "@/config/brand";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "ai-radar-install-dismissed";
const DISMISS_EVENT = "ai-radar:install-dismissed";

/**
 * Both of these are external state, not React state: the dismissal lives in
 * localStorage and the platform check is a fact about the browser. Subscribing
 * to them keeps one source of truth and avoids setting state inside an effect.
 */
function subscribeDismissed(onChange: () => void) {
  window.addEventListener(DISMISS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** True only on iOS Safari that is not already running as an installed app. */
function needsIosHint() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag predates the media query and is still the only
    // reliable signal on iOS.
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

const noop = () => () => {};

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    isDismissed,
    () => true, // never render the prompt in the server HTML
  );
  const showIosHint = useSyncExternalStore(noop, needsIosHint, () => false);

  useEffect(() => {
    // setState here happens in an event callback, not in the effect body.
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to do; it reappears next visit, which is acceptable.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  if (dismissed) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <aside
      aria-label={`Install ${brand.name}`}
      className="bg-paper border-faint-2 text-ink mx-auto mb-4 flex max-w-2xl items-start gap-3 border p-4"
    >
      <div className="flex-1">
        <p className="text-[15px] font-semibold">Keep {brand.name} on your home screen</p>
        {deferred ? (
          <p className="text-soft mt-1 text-[14px] leading-relaxed">
            It opens like an app, without browser chrome, and the last brief stays readable offline.
          </p>
        ) : (
          <p className="text-soft mt-1 flex flex-wrap items-center gap-1 text-[14px] leading-relaxed">
            Tap
            <Share aria-hidden className="text-ink inline size-4" />
            <span className="sr-only">the Share button</span>
            in Safari, then <strong className="text-ink">Add to Home Screen</strong>.
          </p>
        )}
        {deferred ? (
          <button
            type="button"
            onClick={install}
            className="bg-org text-org-on focus-visible:ring-org mt-3 rounded-xs px-4 py-2 text-[14px] font-semibold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Install
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install suggestion"
        className="text-soft hover:text-ink focus-visible:ring-org rounded-xs p-1 focus-visible:ring-2 focus-visible:outline-none"
      >
        <X aria-hidden className="size-4" />
      </button>
    </aside>
  );
}
