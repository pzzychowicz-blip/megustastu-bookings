// MGT Bookings — service worker KILL SWITCH (v17.4.1).
//
// v17.4.0 shipped an offline-shell service worker. In production it froze the
// app at "⟳ Loading bookings…" on iPhone AND iPad — the first Firebase snapshot
// never arrived — while desktop was completely unaffected. Clearing site data
// on a device fixed it, which is what confirmed the worker (and its caches) as
// the cause. It was never reproducible locally: a production-mode build with
// this worker, pointed at the DEV database, loads fine on desktop, so the fault
// needs real iOS + production conditions that cannot be staged here.
//
// THE FILE CANNOT SIMPLY BE DELETED. An installed service worker keeps
// controlling the page forever; removing /sw.js from the deploy does not
// unregister it, and every already-affected device would stay broken until
// someone cleared its data by hand. The only reliable remote fix is to ship a
// worker at the SAME URL that removes itself — browsers re-fetch /sw.js on
// navigation for any live registration, so this reaches them.
//
// What this does, once, then never again:
//   1. deletes every cache the old worker created,
//   2. unregisters itself,
//   3. reloads open tabs so a frozen device recovers on its own, with no
//      manual "clear website data" needed on each tablet.
//
// NOTE THE ABSENCE OF A `fetch` HANDLER. That is deliberate and load-bearing:
// a worker with no fetch listener intercepts nothing at all, so from the
// moment this version is picked up the app talks straight to the network even
// before activation finishes.
//
// `src/main.jsx` no longer registers anything, so no NEW device installs a
// worker. This file exists purely to clean up the ones that already have one.
// Keep it deployed until every device has been seen working — it is inert on a
// device that has no registration.
//
// Before reintroducing a PWA here, see CLAUDE.md ("PWA — withdrawn in v17.4.1")
// for the conditions that have to be met first.

self.addEventListener("install", () => {
  // Take over from the broken worker immediately rather than waiting for every
  // tab to close — on a frozen device the tab is not going to be closed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* Cache Storage unavailable (iOS quota/private mode) — nothing to drop */
      }

      try {
        await self.registration.unregister();
      } catch {
        /* already gone */
      }

      // Reload controlled tabs so the frozen page recovers by itself. The new
      // load is uncontrolled (the registration is gone), so this happens once
      // and cannot loop.
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const c of clients) {
          try {
            await c.navigate(c.url);
          } catch {
            /* navigate() can be refused; the next manual reload is clean anyway */
          }
        }
      } catch {
        /* no clients to reload */
      }
    })()
  );
});
