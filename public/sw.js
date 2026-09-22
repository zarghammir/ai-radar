/* AI Radar service worker.
 * Caches the app shell so an installed copy opens without a network, and
 * serves a real offline page instead of the browser's error screen.
 * Bump CACHE_VERSION to retire every old cache on the next activation.
 */
const CACHE_VERSION = "ai-radar-shell-v1";
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Individually, so one 404 cannot fail the whole installation.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: try the network first so the reader never sees a stale brief, fall
  // back to the cached copy, and only then to the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Only cache a response worth serving later. Without this an error
          // page becomes the permanent offline copy of that URL: a 404 or a
          // 500 served during a deploy would be handed back offline until
          // CACHE_VERSION changes. The static branch below has always
          // checked; this one did not.
          if (fresh.ok) {
            const cache = await caches.open(CACHE_VERSION);
            // waitUntil, so the write is not abandoned when the worker is
            // terminated the moment respondWith settles.
            event.waitUntil(cache.put(request, fresh.clone()));
          }
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // Static assets: serve from cache immediately and refresh in the background.
  if (/\.(?:css|js|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              event.waitUntil(cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })()
    );
  }
});

/* ── The brief arriving on its own (#72) ────────────────────────────────────
 *
 * THE PUSH CARRIES NO PAYLOAD. It is a wake-up, and the text is fetched here,
 * when the notification is about to be shown. That means the headline a reader
 * sees is the one that is true when it arrives rather than when it was queued,
 * and it keeps RFC 8291 payload encryption out of the server entirely — see
 * src/notify/vapid.ts for the trade.
 *
 * What it costs is this: a push received with no network cannot show the
 * count. That case is handled below rather than left to show an empty
 * notification, because a browser will substitute its own "This site has been
 * updated in the background" if the handler shows nothing at all.
 */
const BRIEF_URL = "/api/brief";
const BRIEF_TAG = "ai-radar-brief";

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let title = "Your brief is ready";
      let body = "Open AI Radar to read it.";

      try {
        const response = await fetch(BRIEF_URL, { cache: "no-store" });
        if (response.ok) {
          const brief = await response.json();
          const count = typeof brief.count === "number" ? brief.count : 0;
          const top = Array.isArray(brief.stories) ? brief.stories[0] : undefined;

          if (count === 0) {
            // A QUIET MORNING SAYS SO. Sending nothing would make a quiet day
            // and a broken sender the same experience, which is the thing #72
            // asks us not to do.
            title = "A quiet morning";
            body = "Nothing new since your last brief.";
          } else {
            title = count === 1 ? "1 new story" : `${count} new stories`;
            body = top && typeof top.title === "string" ? top.title : "Open AI Radar to read them.";
          }
        }
      } catch {
        // Offline, or the instance is down. The generic text above stands:
        // saying "your brief is ready" when we cannot count it is honest,
        // where showing "0 stories" would be a measurement we did not take.
      }

      await self.registration.showNotification(title, {
        body,
        tag: BRIEF_TAG,
        // Replaces yesterday's rather than stacking: this is a daily brief,
        // and a column of them is how a reader learns to swipe without looking.
        renotify: false,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: "/" },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = (event.notification.data && event.notification.data.url) || "/";
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an open copy rather than opening a second one.
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })()
  );
});
