// MGT Bookings — offline app shell (v17.10.1).
//
// ─────────────────────────────────────────────────────────────────────────────
// TO KILL THIS WORKER REMOTELY, IF IT EVER MISBEHAVES
//
// A shipped service worker CANNOT be withdrawn by deleting the file: an
// installed worker keeps controlling the page forever, and removing /sw.js from
// the deploy does not unregister it. The only remote fix is to ship a worker at
// this SAME URL whose `activate` clears the caches and unregisters itself —
// browsers re-fetch /sw.js on navigation for any live registration, so it
// reaches the device. That file is the v17.4.1 kill switch; recover it verbatim
// from git history (`public/sw.js` as of the commit before v17.10.1) and deploy
// it. Verified to work on the restaurant's Android tablet on 2026-08-18: a live
// registration was replaced, its caches cleared and the page released within a
// single update cycle.
//
// There is also an IN-BAND escape hatch that needs no deploy at all:
// opening the app with `?sw=off` unregisters everything and clears the caches
// before React mounts, then remembers the choice on that device. That is the
// recovery v17.4.0 did not have — it works on a frozen app, and on a device you
// cannot reach.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT THIS DOES, AND — MORE IMPORTANTLY — WHAT IT REFUSES TO TOUCH.
//
// v17.4.0's worker was withdrawn because the app froze at "⟳ Loading bookings…"
// on iOS: the first Firebase snapshot never arrived. Whatever the true cause
// (v17.10.1's investigation points hard at the CSP blocking Firebase's JSONP
// fallback, since the same freeze happened in iOS Chrome, where a service
// worker cannot run at all), the structural lesson stands: a worker anywhere
// near the data path can starve the app of its data.
//
// So this one is not near it. It calls respondWith() for exactly two kinds of
// request, both same-origin GET:
//
//   1. NAVIGATIONS — network-first, cache as a fallback. Network-first is the
//      whole safety argument: an online device always gets fresh HTML, so this
//      worker can never pin the app to a stale build. The cache is consulted
//      only when the network has already failed.
//   2. BUILT ASSETS (/assets/*, icons) — cache-first, because Vite content-
//      hashes these filenames. A hashed URL's bytes never change, so serving
//      them from cache cannot be stale; a new deploy's HTML references new
//      hashes, which miss the cache and are fetched.
//
// Everything else falls through with NO respondWith at all — the browser
// handles it exactly as if this worker did not exist. That explicitly includes
// every Firebase request: the WebSocket, the REST calls, auth. They are
// cross-origin, and the first line of onFetch drops them.

const CACHE = "mgt-shell-v1";
const ASSET_RE = /^\/(assets\/|icon|apple-touch-icon|favicon|manifest\.webmanifest)/;

// Shown only when a navigation fails AND nothing is cached — i.e. a cold start
// with no network. Inline, so there is no extra file that could itself 404.
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — MGT Bookings</title><style>
html{background:#eef1f6;color:#1a1d24}
@media (prefers-color-scheme:dark){html{background:#15171c;color:#e8eaf0}}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
main{max-width:22rem;text-align:center}
h1{font-size:19px;font-weight:600;margin:0 0 8px}
p{font-size:15px;line-height:1.5;margin:0 0 18px;opacity:.75}
button{font:inherit;font-size:15px;font-weight:600;color:#fff;background:#007AFF;
border:0;border-radius:999px;padding:11px 22px;cursor:pointer}
</style></head><body><main>
<h1>No connection</h1>
<p>MGT Bookings can't load right now. Bookings already on this device are safe,
and any changes you made will sync once you're back online.</p>
<button onclick="location.reload()">Try again</button>
</main></body></html>`;

// No skipWaiting(). A new worker waits for the old one to release the page and
// takes over on the next navigation. Nothing swaps under a shift in progress,
// which matters on a device someone is actively taking bookings on. (The KILL
// SWITCH does the opposite and calls skipWaiting — when the job is to get rid
// of a worker, immediacy is the point.)
self.addEventListener("install", () => {});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  // Cross-origin is Firebase, Google APIs and nothing else here. Never touched.
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Only a real, complete response is worth keeping.
        if (fresh && fresh.ok && fresh.type === "basic") {
          const cache = await caches.open(CACHE);
          cache.put("/", fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match("/", { cacheName: CACHE });
        if (cached) return cached;
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
    })());
    return;
  }

  if (!ASSET_RE.test(url.pathname)) return;   // not ours — browser handles it

  event.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE });
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === "basic") {
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  })());
});
