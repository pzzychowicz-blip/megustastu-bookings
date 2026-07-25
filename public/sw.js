// MGT Bookings — service worker KILL SWITCH (v17.4.1).
//
// v17.4.0 shipped an offline-shell service worker. In production it froze the
// app at "⟳ Loading bookings…" on iPhone AND iPad — the first Firebase snapshot
// never arrived — while desktop was completely unaffected. Clearing site data
// on a device fixed it. NOTE the limit of that evidence: clearing site data
// also wipes IndexedDB (where Firebase Auth keeps its session) and
// localStorage, so it points AT the worker without proving it; the laptop had
// the same worker installed and was fine, so the real differentiator is iOS.
// It was never reproducible locally either — a production-mode build with that
// worker, pointed at the DEV database, loads fine on desktop. The worker is
// withdrawn because it is unverifiable on the affected devices, not because
// root cause was established.
//
// THE FILE CANNOT SIMPLY BE DELETED. An installed service worker keeps
// controlling the page forever; removing /sw.js from the deploy does not
// unregister it, and every already-affected device would stay broken until
// someone cleared its data by hand. The only reliable remote fix is to ship a
// worker at the SAME URL that removes itself — browsers re-fetch /sw.js on
// navigation for any live registration, so this reaches them.
//
// What this does, once, then never again: deletes the caches the old worker
// created, and unregisters itself.
//
// WHAT IT DELIBERATELY DOES NOT DO: force-reload open tabs. An earlier cut
// called clients.navigate() so a frozen device would heal without a second
// reload. That was dropped, for three reasons:
//   • It fires on HEALTHY devices too — the laptop was never broken but still
//     has the old worker — where an unsolicited reload destroys whatever is
//     half-typed in the booking/walk-in form (that draft is React state and is
//     never persisted).
//   • Caches are gone by that point, so if the network blips during the forced
//     reload the tab lands on the browser's offline error page with nothing to
//     fall back on — strictly worse than leaving it alone.
//   • It bought very little: a device has to navigate before it even FETCHES
//     this file, so the user is already reloading. The most it ever saved was
//     one extra reload.
// Do not add it back.
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
        // Scoped to our own caches ("mgt-shell-v1" / "mgt-shell-v2") rather
        // than everything on the origin. Nothing else here uses Cache Storage
        // today, but this file is meant to stay deployed indefinitely, and an
        // unfiltered wipe would silently eat any cache a future feature adds.
        await Promise.all(
          keys.filter((k) => k.startsWith("mgt-")).map((k) => caches.delete(k))
        );
      } catch {
        /* Cache Storage unavailable (iOS quota/private mode) — nothing to drop */
      }

      try {
        await self.registration.unregister();
      } catch {
        /* already gone */
      }
    })()
  );
});
