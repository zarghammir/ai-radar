"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that caches the app shell and serves the
 * offline page. Registration is deliberately deferred to the load event so it
 * never competes with the first render for bandwidth.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // A failed registration must not break the page. It only means this
        // visit has no offline support.
        console.error("Service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
