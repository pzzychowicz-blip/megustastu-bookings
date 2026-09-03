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

// ── v17.16.13: the same job for a rejected WRITE ─────────────────────────────
//
// `update(...).catch(function(){ ... })` took NO argument at all in
// usePersistence, and the line it logged hard-coded ONE cause: "stale
// per-booking revision". `revGuard.writeWithRev` had the error in hand and
// still logged a hard-coded "stale revision". So a failed field `.validate`, a
// create carrying a non-zero `baseUpdatedAt`, a rules deploy that has not
// landed and a plain network failure all printed the same sentence, naming a
// cause nothing had checked — the defect class this file already exists for,
// one verb over.
//
// It is NOT fixable by guessing better. RTDB collapses every Security Rule
// refusal into ONE code, `PERMISSION_DENIED`, and the error carries nothing
// that separates a stale CAS base from a rule that rejected the shape. So the
// honest line names the code, quotes the SDK's own message, and ENUMERATES what
// that code can mean rather than picking one. An assertion nothing measured is
// what cost a release cycle in v17.5.1 and an evening in v17.16.13: the
// reconciliation-oscillation diagnosis had to re-instrument this very catch to
// see `PERMISSION_DENIED` at all, because the app was busy blaming a revision.
//
// Pure and separately tested — the console call is the caller's.
export function describeWriteError(path,err){
  const code=(err&&err.code)||"unknown";
  const msg=(err&&err.message)||String(err);
  return "[SAFE] "+path+" write REJECTED — "+code+": "+msg+
    (code==="PERMISSION_DENIED"
      ? " — a Security Rule refused it, and the error does not say which:"+
        " a stale CAS base (baseUpdatedAt / <node>Rev), a failed field .validate,"+
        " or rules that have not been deployed all arrive as this one code."
      : "");
}
