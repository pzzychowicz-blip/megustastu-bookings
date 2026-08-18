// src/lib/serviceWorker.js
//
// v17.10.1 — the app's half of the offline shell. The worker itself is
// public/sw.js; this file owns WHEN it is allowed to exist.
//
// Key, reader, writer and the apply step live in ONE file on purpose. The
// theme's equivalent per-device mirror is split across three sites and needs a
// written "keep the convention in sync" warning because of it; the restaurant-
// name mirror (v17.9.0) was deliberately kept whole, and so is this.
//
// PER-DEVICE, localStorage ONLY — deliberately NOT in settings/users/{uid}.
// Clearing site data is the last-resort escape from a misbehaving worker, and a
// flag synced from Firebase would come straight back down and re-enable the
// thing the user just escaped. Whether a device should run a worker is also a
// property of the DEVICE (browser, platform, how it is installed), not of the
// person — the same reasoning that keeps app width and the split layout local.
//
// DEFAULT ON, so only the non-default "0" is ever stored — the house convention
// for a default-on setting (cf. splitEnabled; navLocked is the inverted one).

export const SW_KEY = "mgt-sw";

// Must match CACHE in public/sw.js. /code-review: unregisterAll() used to drop
// EVERY cache on the origin, which is harmless only for as long as this worker
// is the only thing that creates one — and makes turning the setting off a
// blunt instrument that would silently destroy an unrelated cache the moment
// one exists. Delete what we own, nothing else.
export const SW_CACHE = "mgt-shell-v1";

/** Is the offline shell enabled on this device? Default true. */
export function readSwEnabled() {
  try { return localStorage.getItem(SW_KEY) !== "0"; }
  catch { return true; }
}

export function setSwEnabled(on) {
  try {
    if (on) localStorage.removeItem(SW_KEY);
    else localStorage.setItem(SW_KEY, "0");
  } catch { /* private mode — the apply step below still runs for this session */ }
}

/** Does this browser support service workers in this context at all? */
export function swSupported() {
  return typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && typeof isSecureContext !== "undefined" && isSecureContext;
}

/** Remove every registration and cache. The disable path, and the panic path. */
export async function unregisterAll() {
  if (!swSupported()) return 0;
  let n = 0;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) { await r.unregister(); n++; }
    if (typeof caches !== "undefined") await caches.delete(SW_CACHE);
  } catch { /* nothing we can do from here; ?sw=off is the other route */ }
  return n;
}

// Register, or tear down if disabled. Idempotent — safe to call on every change.
//
// The CALLER decides when. App.jsx waits until the first bookings snapshot has
// landed, and that gate is the point: a worker only ever installs on a device
// where the app has demonstrably booted AND reached Firebase. A build that
// cannot load its data can therefore never persist itself into a cache, which
// is the precise shape of the v17.4.0 failure this feature is repaying.
// /code-review: serialised. The caller fires this without awaiting, so a rapid
// toggle (or a re-render landing between two changes) could leave a register
// and an unregister in flight with no ordering guarantee — and the final state
// could be the opposite of the switch position. Chaining on one promise makes
// the LAST call win, which is what a toggle means.
let queue = Promise.resolve();

export function applyServiceWorker(enabled) {
  // /code-review: the caller gets the real outcome; the QUEUE gets the swallow.
  // Attaching one .catch() to both meant `await applyServiceWorker(true)`
  // resolved to undefined on failure — indistinguishable from success. Nothing
  // awaits it today, which is exactly why it would go unnoticed the day
  // something does.
  const run = queue.then(() => applyNow(enabled));
  queue = run.catch(() => {});
  return run;
}

async function applyNow(enabled) {
  if (!swSupported()) return "unsupported";
  if (!enabled) { await unregisterAll(); return "disabled"; }
  try {
    await navigator.serviceWorker.register("/sw.js");
    return "registered";
  } catch (e) {
    // A failed registration is not worth surfacing: the app works without it.
    console.warn("[sw] registration failed —", e && e.message);
    return "failed";
  }
}
