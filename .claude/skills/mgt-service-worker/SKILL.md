---
name: mgt-service-worker
description: >-
  Why the MGT Bookings service worker is safe, and the four properties that make it so. Load BEFORE touching public/sw.js, the registration in the app, the boot script in index.html, offline behaviour or caching in this repo — a shipped worker cannot be withdrawn by deleting it, so a mistake here is the one client change a revert cannot reach.
---

# The offline shell — a service worker, on terms

Moved verbatim from the root `CLAUDE.md` on 2026-09-18, so it loads when the task is
about the worker rather than in every session. The root file keeps the four properties
as a list and the two irreversibility rules in its Gotchas table; this is the reasoning
behind them.

v17.4.0's worker froze the app on iOS and was withdrawn with root cause
unestablished. v17.10.1 established it: the freeze happened **in iOS Chrome as
well as a home-screen shortcut**, and a service worker *cannot run in iOS Chrome
at all* (WKWebView exposes `navigator.serviceWorker` only under App-Bound
Domains, which a general-purpose browser cannot use). The same symptom in a
context where the worker cannot exist means one cause explains both — the CSP
blocking Firebase's JSONP fallback, already fixed in v17.5.1.

Four properties make the new one safe, and none may be dropped:

1. **It is not near the data path.** `respondWith` fires for exactly two things,
   both same-origin GET: navigations (**network-first**) and hashed assets
   (**cache-first**). Everything else falls through untouched — every Firebase
   request is cross-origin and dropped on the handler's first line. Network-first
   on navigation is what makes it structurally impossible to pin the app to a
   stale build.
2. **It installs only where the app demonstrably works** — registration is gated
   on `bookingsReady`, so a build that cannot reach Firebase can never cache
   itself and serve itself back. Disabling is NOT gated: it must work in any
   state.
3. **Two independent ways out**, both verified on the tablet: `?sw=off` (in the
   boot script, so it works when React never mounts) and re-deploying the
   v17.4.1 kill switch at the same URL.
4. **No `skipWaiting`** — a new version takes over on the next navigation, so
   nothing swaps under a shift in progress. The kill switch keeps its
   `skipWaiting`; there, immediacy is the point.

**The test rig the ROADMAP said did not exist now does:** `adb reverse tcp:5174`
makes `http://localhost:5174` a **secure context** on the tablet, so a worker
installs there exactly as it would in production. What still cannot be tested
locally is the production offline BOOT (dev modules are not under `/assets/`, and
a prod build points at PROD Firebase) — which is why the boot watchdog exists.
