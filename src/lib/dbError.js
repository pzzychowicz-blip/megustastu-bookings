// src/lib/dbError.js
//
// v17.5.1: central error reporting for Firebase Realtime Database listeners.
//
// WHY THIS EXISTS. `onValue(ref, success)` takes an OPTIONAL third callback that
// fires when the listen is cancelled (permission denied, transport failure, a
// rule rejection). Every one of the app's 16 listeners was registered without
// one, so a failed read produced NOTHING: no console line, no banner, no state
// change. The app simply sat on "⟳ Loading bookings…" forever, because
// `setBookingsReady(true)` lives inside the success path that never ran.
//
// That is what made the Android-tablet outage (v17.4.0 → v17.5.0) so expensive
// to diagnose: the failure was real, reproducible and permanent, and the app
// had no way to say so. It was misattributed to the PWA service worker for a
// full release cycle. See the REFACTOR_LOG entry for v17.5.1.
//
// RULE: every onValue() in this codebase passes dbError("<path>") as its third
// argument. No exceptions — a listener without one is a silent failure waiting
// to happen.

// Subscribers (usePersistence) get told about any listener failure, anywhere,
// so a settings-node cancellation surfaces the same way a bookings one does.
const subscribers = new Set();

/**
 * Subscribe to listener failures. Returns an unsubscribe function.
 * @param {(info:{path:string,code:string,message:string,at:number})=>void} fn
 */
export function onDbError(fn){
  subscribers.add(fn);
  return function(){ subscribers.delete(fn); };
}

/**
 * Build the error callback for a listener on `path`. Logs loudly and notifies
 * every subscriber. Never throws — a reporting failure must not take down the
 * caller's effect.
 */
export function dbError(path){
  return function(err){
    const info={
      path:path,
      code:(err&&err.code)||"unknown",
      message:(err&&err.message)||String(err),
      at:Date.now()
    };
    console.error("[firebase] listener CANCELLED on /"+path+" — "+info.code,err);
    subscribers.forEach(function(fn){ try{ fn(info); }catch{ /* never let a subscriber break reporting */ } });
  };
}
