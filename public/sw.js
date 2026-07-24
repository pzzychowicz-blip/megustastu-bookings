// MGT Bookings — service worker (v17.4.0, the PWA offline shell).
//
// DELIBERATELY CONSERVATIVE. The one thing this must never do is serve a
// stale app after a Vercel deploy (the lazyChunk gotcha: a new deploy 404s
// the OLD hashed asset URLs, so a stale cached index.html would reference
// assets that no longer exist). Strategy:
//
//  • NAVIGATIONS (the HTML shell): NETWORK-FIRST, cache fallback. Online you
//    always get the current deploy; offline you get the last-seen shell.
//  • /assets/* (Vite content-hashed, immutable): CACHE-FIRST. A hash change
//    is a new URL, so cache-first can never be stale; old entries are pruned
//    on activate by cache-name rotation.
//  • Same-origin static files (manifest / icons / favicon): cache-first.
//  • EVERYTHING ELSE — Firebase RTDB/Auth (googleapis/firebaseio/
//    firebasedatabase), any cross-origin request: NOT TOUCHED. The SDK owns
//    its own offline queue/persistence; intercepting it could break the
//    write-guard/CAS machinery. We simply don't call respondWith().
//
// CACHE_VERSION: bump when the caching LOGIC changes (not per app release —
// hashed assets rotate themselves; the shell is network-first anyway).

const CACHE_VERSION = "mgt-shell-v1";

self.addEventListener("install", (event) => {
  // Pre-cache the shell entry so the very first offline open works.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png", "/icon.svg"])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase & friends: hands off

  // Navigations: network-first, fall back to the cached shell when offline.
  // The shell is only REPLACED by a genuinely good response: `res.ok` (not a
  // 4xx/5xx) and `type === "basic"` (same-origin, not an opaque/redirect
  // response, which cache.put rejects anyway). Without that check a single
  // 500 during a deploy would be stored as the offline shell and served to
  // every later offline launch — the app would "work offline" by showing an
  // error page. A bad response is still returned to the page untouched.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put("/", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Hashed assets + static files: cache-first, populate on miss.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
  }
  // Anything else same-origin (e.g. Vite dev endpoints): default browser handling.
});
