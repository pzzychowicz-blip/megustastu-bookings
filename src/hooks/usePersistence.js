// src/hooks/usePersistence.js
//
// Phase D1 (v14.1.8): Firebase persistence subsystem extracted from
// BookingApp into a self-contained hook. Owns the master `bookings` and
// `tableBlocks` state, the four write-guard refs, all four Firebase
// real-time listeners, the connection-status state pair, and the two
// guarded write helpers (saveBookings / saveBlocks). Also owns the
// auto-extend effect — kept here intentionally so the write-guard
// contract (lastExtend ref + saveBookings + bookingsLoaded ref) never
// crosses module boundaries. The auto-extend effect closes over
// `autoOptimizer` and `nowMins` which are still owned by BookingApp
// for now (they move into D3's useNowMins / useAutoOptimizer); they
// arrive as named arguments so this hook stays a single-input boundary.
//
// Returns a single object so consumers can pull only what they need
// via destructuring. `setWriteWarning` is exposed (rather than fully
// internal) because saveReminders in BookingApp also reports through
// the same banner — when D2 lands, useReminders will receive it as a
// prop and the seam disappears.

import { useState, useRef, useEffect } from "react";
// v17.16.7: `set` is gone from this import. It had exactly one caller left —
// the legacy array→keyed migration below — and that became an `update()` when
// the rules stopped granting a whole-node write on /bookings (CT-2A-04). The
// app now reaches Firebase through `update` and `get` only.
import { ref, onValue, get, update, goOnline } from "firebase/database";
import { db } from "../firebase";
import { sanitizeAll, sanitizeBlocks, toMins, bookingsAfterAction, histEntry, pastCloseMins, seatedElapsed } from "../lib/booking-logic";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError, onDbError } from "../lib/dbError";
// v17.16.2: the pure write-path core. Everything that decides WHETHER and in
// what shape a booking reaches the server now lives in one testable module;
// this hook keeps the refs, listeners, effects and setState. See its header.
import {
  buildPatch, patchSignature, isDuplicatePatch,
  isStaleGap, retryDecision, STALE_GAP_MS, MAX_RETRIES,
} from "../lib/write-path";
import { todayStr } from "../lib/day";

// v17.10.1: how long `.info/connected` may stay false, with the page in the
// FOREGROUND, before we reset the SDK's reconnect backoff ourselves.
//
// The RTDB SDK backs off exponentially (×1.3) to RECONNECT_MAX_DELAY_DEFAULT,
// which is **five minutes** for a web client (the 30s figure in the SDK is
// RECONNECT_MAX_DELAY_FOR_ADMINS). Worse, `onRealtimeDisconnect_` jumps the
// delay straight to that maximum whenever the window is hidden at the moment
// the socket dies — which for a tablet in service is most of the time.
//
// It has exactly two reset paths: the browser `online` event, and `onVisible_`,
// which fires ONLY on a hidden→visible edge and ONLY when the delay is already
// exactly at the maximum. A page that stays visible has no reset path at all.
// So: backgrounded during a blip → delay pinned at 5 min → you come back while
// an attempt is in flight, so onVisible_ skips scheduleConnect_ → that attempt
// fails → the next retry is Math.random()*300000 ms, and `visible_` is already
// true so nothing will ever reset it. That is the reported "stuck reconnecting",
// and it is why minimising the app and restoring it reliably cures it: that
// recreates the one edge the SDK listens for.
//
// 20s is well past the SDK's own early retries (1–3s) and short enough that
// staff never see it. The heartbeat below is 10s, so the first kick lands at
// 20–30s.
//
// /code-review: the spacing then WIDENS, ×2 per kick to a 2-minute ceiling,
// instead of staying flat. A flat 20s poll would replace the SDK's bounded
// backoff with an UNBOUNDED one — on a multi-hour outage with the tab left
// visible that is ~120 connection attempts per device per hour, forever, which
// is the exact load exponential backoff exists to prevent. Widening keeps the
// part that matters (a short outage recovers in ~20s, which is the reported
// bug) while bounding the long tail; even the ceiling is less than half the
// SDK's own 5-minute maximum, so a stuck client still recovers faster than it
// would unaided. Reset on every successful connect.
const RECONNECT_KICK_MS = 20000;
const RECONNECT_KICK_MAX_MS = 120000;

// v17.5.1: how long the first bookings snapshot may take before the app stops
// showing "loading" and reports that the read is not completing. Generous —
// a slow restaurant connection on a cold cache should never trip it; a
// transport that can never work always will.
const LOAD_TIMEOUT_MS = 15000;


export function usePersistence({ autoOptimizer, nowMins }){
  const [bookings, setBookings] = useState([]);
  const [tableBlocks, setTableBlocks] = useState([]);
  // v17.3.0: has the FIRST bookings snapshot arrived from Firebase? Drives the
  // "⟳ Loading bookings…" floating toast in App — before this flips true the
  // screen shows an empty [] state that looks ready but isn't (a real gap on a
  // poor connection). Distinct from `bookingsLoaded` (a ref, no re-render) and
  // from `loadBannerShown` (the 6s post-load green banner).
  const [bookingsReady, setBookingsReady] = useState(false);
  // v17.5.1: the first bookings read has taken longer than LOAD_TIMEOUT_MS —
  // the loading toast turns into an actionable failure message.
  const [loadStalled, setLoadStalled] = useState(false);
  // v17.5.1: the last listener cancellation reported by lib/dbError.js, so the
  // UI can name the real Firebase error code (permission_denied etc).
  const [readError, setReadError] = useState(null);
  // v17.5.1: has a Firebase handshake EVER completed this session? Distinct from
  // isOnline, which starts optimistically true (see the .info/connected effect).
  const [hasConnected, setHasConnected] = useState(false);
  // ── Firebase write-guard system ─────────────────────────────────────────────
  // These refs track whether we've received AT LEAST ONE onValue callback from
  // Firebase for each path. Until that's happened, React state is [] / {}
  // regardless of what's in Firebase — writing that empty state would wipe
  // real data. Save helpers REFUSE to write until their respective
  // dataLoaded ref is true. This is the critical safety net added after the
  // v13 first-deploy incident where empty in-memory state was persisted to
  // Firebase before the read listener had fired.
  const bookingsLoaded=useRef(false);
  const blocksLoaded=useRef(false);
  const [writeWarning, setWriteWarning] = useState(null);
  const [loadBannerShown, setLoadBannerShown] = useState(false);
  const firstLoadCount=useRef(null); // number of bookings on first successful load
  // v14.1: Connection-status state. isOnline drives the amber offline banner;
  // reconnectShown is a brief 4-second blue flash after offline→online.
  // hasConnectedRef gates BOTH banners so we never show "offline" before
  // the very first successful Firebase connection (avoids a false flash on boot).
  const [isOnline, setIsOnline] = useState(true);
  const [reconnectShown, setReconnectShown] = useState(false);
  const hasConnectedRef=useRef(false);
  // ── v15.2.0: Freshness / resync gate ────────────────────────────────────────
  // A THIRD write-guard dimension after "loaded" and "non-empty": STALENESS.
  // A tab that was asleep/frozen holds an old snapshot; on wake the clock tick
  // fires the auto-extend / auto-complete effects, which would write that stale
  // snapshot over fresher server data. (The incident: a laptop left asleep from
  // ~18:00 overwrote a night of tablet bookings when it woke at ~01:30.) We
  // detect the freeze via a heartbeat whose gap is checked AT WRITE TIME — which
  // is race-free regardless of whether the clock interval or the heartbeat fires
  // first on wake — refuse writes while stale, and force a fresh server re-read.
  const staleRef=useRef(false);
  const lastBeatRef=useRef(Date.now()); // bumped each heartbeat; a large gap == the event loop was frozen (sleep)
  const isConnectedRef=useRef(false);
  // v17.10.1: when did `.info/connected` last go false, and when did we last
  // kick the SDK out of its backoff? Both drive the reconnect watchdog in the
  // heartbeat effect (see RECONNECT_KICK_MS).
  const offlineSinceRef=useRef(null);
  const lastKickRef=useRef(0);
  // Current spacing between kicks, doubling per kick to RECONNECT_KICK_MAX_MS.
  const kickSpacingRef=useRef(RECONNECT_KICK_MS);
  // Has this outage already been logged? One line per outage, not one per kick.
  const kickLoggedRef=useRef(false);
  const resyncInFlightRef=useRef(false);
  const [resyncing, setResyncing] = useState(false);
  // ── v15.5.0: per-booking-node write model ───────────────────────────────────
  // `bookings` is stored as a keyed object /bookings/{id} (one child per booking),
  // not a single array. A write diffs the previous vs next array and pushes a
  // multi-path update of ONLY the changed children — so two devices editing
  // DIFFERENT bookings (even offline) write disjoint paths and Firebase merges
  // them with no conflict, which the old whole-array CAS could not do. This
  // replaces the v15.3.0 global `bookingsRev` compare-and-swap.
  //
  // Conflict protection is now per-booking: each child carries an `updatedAt`
  // stamp and a per-$id Security Rule rejects a write whose stamp is not strictly
  // greater than the server's (an out-of-order / stale same-booking write). The
  // stamp is monotonic-per-device AND always above the booking's last-seen server
  // value, so it survives clock skew between devices and StrictMode's double-write.
  const lastStampRef=useRef(0); // highest updatedAt this device has issued (monotonic)
  // v16.0.0 (stale-overwrite protection): per-booking COMPARE-AND-SWAP. Every
  // written child also carries `baseUpdatedAt` — the updatedAt of the version
  // this device BASED its write on (from local `prev`, i.e. the last server echo
  // it saw). The Security Rule requires base === the stored updatedAt, so a
  // device holding a stale snapshot (sleep, zombie socket, offline-queue flush)
  // is rejected server-side no matter what its wall clock says — the hole the
  // 2026-07-05 incident exposed: the old ">" rule let any live-clock device
  // overwrite content it never saw. `lastPatchSigRef` dedupes StrictMode's dev
  // double-dispatch (same patch twice = the 2nd base is already consumed → it
  // would self-reject + resync-churn on every dev write; an identical patch
  // within the window IS the same write, so skipping it is prod-safe).
  const lastPatchSigRef=useRef({sig:"",at:0});
  // v16.0.0: revision CAS for the whole-node tableBlocks (see lib/revGuard.js).
  const blocksRevRef=useRef(0);
  // True while the local snapshot is still the LEGACY single-array shape (migration
  // to keyed children not yet echoed). Per-child writes are held until it clears, so
  // a string-keyed child is never mixed into the integer-indexed array.
  const arrayShapeRef=useRef(false);
  const migratedRef=useRef(false); // guards the one-time array→keyed migration write
  // v15.4.0: auto-retry queue. A user write blocked by the stale gate, or rejected
  // by the server rule, is parked here as its original updater function and replayed
  // on freshly-resynced data after resync() completes (capped at MAX_RETRIES). Only
  // FUNCTION-form, non-silent writes queue — they're pure transforms of `prev`, so
  // re-running them on fresh data is safe. Value-form / silent writes (the auto
  // effects) never queue; replaying a precomputed stale array would re-write stale data.
  const pendingRetriesRef=useRef([]);
  function clearStale(){
    staleRef.current=false;
    lastBeatRef.current=Date.now();
    resyncInFlightRef.current=false;
    setResyncing(false);
  }
  // v15.6.0: replay any held/blocked user writes (function-form, non-silent) on top of
  // the freshest local data, then persist them. Empties the queue, so whichever of
  // resync() or the live onValue fires first re-applies the change — the other sees an
  // empty queue (no double-apply). This is what keeps an OPTIMISTICALLY-SHOWN held
  // change from being wiped by a fresh server snapshot before it has been re-applied +
  // persisted. MUST run only AFTER clearStale() — otherwise saveBookings re-holds on
  // the still-set stale gate. Each replay carries its try count; past the cap we
  // surface a single red error instead of looping forever (v15.4.0 contract).
  function drainPending(){
    const queue=pendingRetriesRef.current;
    if(!queue.length) return;
    pendingRetriesRef.current=[];
    queue.forEach(function(item){
      const d=retryDecision(item.tries);
      if(d.action==="retry") saveBookings(item.fn,false,d.tries);
      else setWriteWarning("Couldn't save a change after several attempts — please re-check and try again.");
    });
  }
  // Force-pull the server's current bookings + tableBlocks, replace local state,
  // then lift the gate. Runs ONLY when connected: an offline get() can resolve
  // from the stale local cache, which must never be allowed to clear the gate.
  function resync(){
    if(resyncInFlightRef.current||!isConnectedRef.current) return;
    resyncInFlightRef.current=true;
    Promise.all([get(ref(db,"bookings")),get(ref(db,"tableBlocks")),get(ref(db,"tableBlocksRev"))]).then(function(snaps){
      const bVal=snaps[0].val();
      arrayShapeRef.current=Array.isArray(bVal); // v15.5.0: keep the migration/shape gate fresh
      const bArr=bVal?sanitizeAll(bVal):[];
      setBookings(bArr);
      setBookingsReady(true); // v17.3.0: a resync pull also proves data is present
      if(firstLoadCount.current===null) firstLoadCount.current=bArr.length;
      const tVal=snaps[1].val();
      // v17.15.3: the SECOND block read site, and it has to mint ids too — a
      // resync that skipped it would hand the app id-less blocks after every
      // sleep/wake, i.e. exactly when the tablet has been closed all afternoon.
      setTableBlocks(sanitizeBlocks(tVal));
      // v16.0.0: re-anchor the blocks revision-CAS ref to the true server value —
      // the rev onValue may have been dead through the stale window.
      const rVal=snaps[2].val();
      blocksRevRef.current=typeof rVal==="number"?rVal:0;
      clearStale();
      // v15.4.0/v15.6.0: replay any held/blocked writes, now on fresh data (flicker-
      // free — batched with the setBookings above into one commit).
      drainPending();
    }).catch(function(){
      // Still offline / read failed — stay stale (writes stay blocked, the safe
      // direction); the reconnect handler retries resync() when the socket returns.
      resyncInFlightRef.current=false;
    });
  }
  // Flag the local snapshot as possibly-stale and kick a resync (if connected;
  // otherwise the .info/connected reconnect handler runs it). Idempotent + cheap.
  function markStale(){
    staleRef.current=true;
    setResyncing(true);
    resync();
  }
  // v16.0.0 (wake-race fix): a heartbeat-GAP trip means the event loop was frozen
  // (OS sleep) — and `isConnectedRef` still holds its PRE-SLEEP value (true),
  // because the .info/connected listener couldn't fire while frozen. Trusting it
  // let resync()'s get() run before the SDK noticed the dead socket, potentially
  // resolve from the LOCAL CACHE, "succeed" with stale data, and clear the gate —
  // after which the auto-effects wrote the stale snapshot freely (the 2026-07-05
  // incident's client-side trigger). So a gap trip now RESETS the ref: resync()
  // waits for a FRESH `.info/connected: true` from the SDK (which re-fires after
  // a real sleep — the socket provably died) before reading. Escape hatches if
  // the socket somehow survived: any live onValue snapshot clears the stale gate,
  // and the reconnect handler re-runs resync(). Used ONLY for gap trips — a
  // server write-rejection keeps its live connection and calls markStale directly.
  function gapTrip(){
    isConnectedRef.current=false;
    markStale();
  }
  // Firebase save helpers — write-on-action only (prevents multi-device data corruption).
  // GUARDED: will refuse to write until Firebase has sent us the initial snapshot.
  // GUARDED: will refuse to overwrite non-empty Firebase with an empty in-memory array
  //   unless firstLoadCount was also 0 (i.e. DB is genuinely new/empty).
  // If `isSilent` is true, refusals only log to console — no user-facing warning.
  // If `isSilent` is false/omitted (default = user action), refusals also surface a red banner.
  // This keeps harmless mount-time effect calls quiet (auto-extend passes isSilent=true)
  // while still alerting on real user-blocked saves.
  // Returns TRUE if the write was dispatched (or will be, optimistically), FALSE if
  // it was blocked by the stale gate. Callers gate their success UI (the "saved"
  // flash / closing the form) on the result so a refused write is never shown as
  // saved. `tryN` (internal) tracks auto-retry attempts; callers omit it.
  function saveBookings(next,isSilent,tryN){
    tryN=tryN||0;
    // v15.2.0/v15.4.0: staleness gate FIRST — hold the SERVER write when the local
    // snapshot may be stale, so a frozen tab's stale data never lands on the server.
    // This is NOT a red error: a user write is PARKED for auto-replay on freshly-
    // resynced data (resync() drains the queue), and (v15.6.0) shown optimistically.
    if(isStaleGap(lastBeatRef.current,Date.now())) gapTrip();
    if(staleRef.current){
      console.warn("[SAFE] bookings write held — local data may be stale; queued for resync + retry, shown optimistically.");
      if(typeof next==="function"&&!isSilent){
        pendingRetriesRef.current.push({fn:next,tries:tryN});
        // v15.6.0: optimistic show. Apply the user's change to LOCAL state NOW so it's
        // visible immediately — previously a held write stayed invisible until resync
        // finished (1–2s+), which read as "my tap did nothing / didn't save". We still
        // do NOT write the stale snapshot to the server: the real persist happens when
        // resync() replays this queued function on FRESH data (and reconciles it into
        // the fresh-data state set, flicker-free). Value-form (doSave) + silent (auto-
        // effect) writes don't reach this branch, so they keep their existing behaviour.
        setBookings(next);
      }
      markStale();
      return false;
    }
    let dispatched=true;
    function persist(prev,computed){
      if(!bookingsLoaded.current){
        console.warn("[SAFE] Refused to write bookings — initial read has not completed yet.");
        if(!isSilent) setWriteWarning("Refused to write: not connected to the server yet. If this persists, reload the page.");
        dispatched=false;return;
      }
      if(Array.isArray(computed)&&computed.length===0&&firstLoadCount.current!==null&&firstLoadCount.current>0){
        console.warn("[SAFE] Refused to write empty bookings array — Firebase had "+firstLoadCount.current+" entries on load. This is a safety check against accidental wipe.");
        if(!isSilent) setWriteWarning("Refused to write empty data. Reload the page and try again. If you intended to delete everything, contact support.");
        dispatched=false;return;
      }
      // v15.5.0: still on the legacy single-array shape (migration not yet echoed) —
      // hold the write so a string-keyed child is never mixed into the integer array.
      // Treated like the stale gate: queue the user write + kick a resync; once the
      // keyed shape lands (arrayShapeRef clears) the queued retry succeeds.
      if(arrayShapeRef.current){
        console.warn("[SAFE] bookings write held — legacy array shape, migration to per-booking nodes pending.");
        if(typeof next==="function"&&!isSilent) pendingRetriesRef.current.push({fn:next,tries:tryN});
        markStale();
        dispatched=false;return;
      }
      // v15.5.0: per-node multi-path write. Only changed/added children are set and
      // removed ones nulled, so concurrent edits to OTHER bookings (other paths) merge
      // server-side instead of racing on a single array node. A rejection (a stale
      // per-booking stamp on one of the children fails the rule → the whole atomic
      // update is refused) → resync + replay the function on fresh data (v15.4.0).
      // v17.16.2: the diff and the stamping are lib/write-path.js now. The
      // monotonic counter is THREADED through rather than hidden in the closure —
      // the ref stays here, the arithmetic became testable.
      const built=buildPatch(prev,computed,lastStampRef.current,Date.now());
      const patch=built.patch;
      lastStampRef.current=built.lastStamp;
      if(!Object.keys(patch).length) return; // nothing actually changed — skip the write
      // v16.0.0: StrictMode dedupe — the dev double-invoked updater calls persist()
      // twice with the same prev/computed. The two patches differ ONLY in their
      // fresh `updatedAt` stamps (contentKey excludes those, and both carry the
      // same content + the same consumed `baseUpdatedAt`), so an identical
      // signature within the window is the SAME write: dispatching it again would
      // be server-rejected by the CAS (base already consumed) → resync churn on
      // every dev write. Skipping a byte-identical re-dispatch is prod-safe.
      const sig=patchSignature(patch);
      const nowMs=Date.now();
      if(isDuplicatePatch(sig,lastPatchSigRef.current,nowMs)) return;
      lastPatchSigRef.current={sig:sig,at:nowMs};
      update(ref(db,"bookings"),patch).catch(function(){
        console.warn("[SAFE] bookings write rejected by server (stale per-booking revision) — resyncing + retry.");
        if(typeof next==="function"&&!isSilent) pendingRetriesRef.current.push({fn:next,tries:tryN});
        markStale();
      });
    }
    // Always run through the functional updater so persist() has `prev` (the live
    // in-memory snapshot, reflecting other devices' echoes) to diff against — for
    // BOTH the function form (user actions) and the value form (auto-effects).
    setBookings(function(prev){
      const computed=(typeof next==="function")?next(prev):next;
      persist(prev,computed);
      return computed;
    });
    return dispatched;
  }
  // Returns TRUE if dispatched, FALSE if blocked by the stale gate (so callers can
  // gate their success UI). tableBlocks are not on the bookings auto-retry queue
  // (rare, low-stakes); on a stale-block the caller simply re-does the action.
  function saveBlocks(next,isSilent){
    // v15.2.0/v15.4.0: same staleness gate as saveBookings — held, not errored.
    if(isStaleGap(lastBeatRef.current,Date.now())) gapTrip();
    if(staleRef.current){
      console.warn("[SAFE] tableBlocks write held — local data may be stale; resyncing first.");
      markStale();
      return false;
    }
    function persist(computed){
      if(!blocksLoaded.current){
        console.warn("[SAFE] Refused to write tableBlocks — initial read has not completed yet.");
        return;
      }
      // v16.0.0: revision-CAS write (lib/revGuard.js) — a stale device's rev is
      // behind the server's, so its overwrite is rejected server-side; the SDK's
      // rollback echo then restores local state via the onValue listeners.
      writeWithRev("tableBlocks",computed,blocksRevRef,function(){
        if(!isSilent) setWriteWarning("Couldn't save — this device's data was out of date and has been refreshed. Please redo the change.");
      });
    }
    if(typeof next==="function"){
      setTableBlocks(function(prev){const computed=next(prev);persist(computed);return computed;});
    } else {
      setTableBlocks(next);persist(next);
    }
    return true;
  }
  // Firebase real-time listeners — read only, never write back.
  // The `bookingsLoaded.current=true` line MUST run on every callback, including
  // when val is null (truly empty DB), otherwise saves would stay blocked forever
  // on a brand-new database.
  useEffect(function(){
    const unsub=onValue(ref(db,"bookings"),function(snap){
      const val=snap.val();
      // v15.5.0: Firebase returns an ARRAY only when the node has sequential
      // integer keys — exactly what the pre-v15.5.0 whole-array writes produced.
      // A keyed /bookings/{id} object (the new shape) comes back as a plain object.
      // This flag gates per-child writes until migration has converted the node.
      const isArrayShape=Array.isArray(val);
      arrayShapeRef.current=isArrayShape;
      const arr=val?sanitizeAll(val):[];
      setBookings(arr);
      if(firstLoadCount.current===null){
        firstLoadCount.current=arr.length;
        setLoadBannerShown(true);
      }
      bookingsLoaded.current=true;
      setBookingsReady(true); // v17.3.0: first snapshot landed — drop the loading toast
      clearStale(); // v15.2.0: a live server snapshot proves the local data is current
      // v15.5.0: one-time lazy migration legacy-array → per-booking child nodes.
      // Write the keyed children once; the echo comes back as an object so
      // isArrayShape flips false and this never re-fires. Gated on connected (an
      // offline write would queue unverifiably) and migratedRef (a single
      // attempt per session).
      if(isArrayShape&&arr.length>0&&!migratedRef.current&&isConnectedRef.current){
        migratedRef.current=true;
        const keyed={};
        const now=Date.now();
        // v17.16.1: `baseUpdatedAt:0` is REQUIRED here now. The rules' create
        // branch (database.rules.json, CT-2A-01) stopped accepting any numeric
        // `updatedAt` and now demands `baseUpdatedAt === 0` — which is what a
        // genuine create looks like and what `stampForWrite` writes when it has
        // no `old`. Without it every child of this migration write is refused.
        // It is NOT a guarantee the write lands: `arr` is `sanitizeAll(val)`, so
        // these rows are type-correct but otherwise whatever the legacy node
        // held, and the patch below is atomic — one row the rules dislike
        // rejects the whole migration, and the `.catch` below resets
        // `migratedRef`, so the rejected write's rollback echo re-fires this
        // listener and it re-attempts on every snapshot. That is a write-reject
        // loop, the same class as the v17.10.2 reconciliation loop (CLAUDE.md
        // Gotchas). Unreachable on PROD (the node has been keyed since v15.5.0,
        // and this branch is gated on `Array.isArray`), so nothing observable
        // changes — but a recovery path left knowingly broken is how a service
        // is lost years later, by someone who reads the code and believes it
        // works.
        //
        // v17.16.7: this was `set(ref(db,"bookings"), keyed)` — a WHOLE-NODE
        // write, which is precisely the capability CT-2A-04 is about, so it
        // could not be excepted from the fix: a grant wide enough to permit it
        // is a grant wide enough to permit the finding. `/bookings` now carries
        // no `.write` and `/bookings/$bid` does, so the migration became a
        // multi-path `update()` of CHILDREN instead — the legacy integer keys
        // nulled, the keyed rows written, in one atomic patch with exactly the
        // semantics `set` had. Afterwards the app makes no whole-node
        // `bookings` write anywhere, so the rules and the client agree rather
        // than the rules merely tolerating the client.
        //
        // Leaving it denied was the alternative and it is not benign: the hold
        // at the top of `persist` (`arrayShapeRef`) blocks EVERY booking write
        // until the keyed shape echoes, so a legacy array node would leave the
        // app permanently read-only for bookings rather than merely
        // unmigrated.
        const nulls={};
        // The old keys, taken from the SNAPSHOT rather than from `arr` — RTDB
        // returns an array only for sequential integer keys, so these are
        // 0..n-1, and `arr` carries the bookings' own ids, which are what the
        // new keys are. Reading the indices off the snapshot keeps the two
        // sides of the patch independent: a row `sanitizeAll` dropped still has
        // its slot cleared instead of being silently carried over as a hole.
        Object.keys(val).forEach(function(k){ nulls[k]=null; });
        arr.forEach(function(b){ keyed[b.id]=Object.assign({},b,{updatedAt:Math.max(now,Number(b.updatedAt)||0)+1,baseUpdatedAt:0}); });
        // Object.assign order matters: a keyed row whose id happens to equal an
        // old integer index must WIN over that index's null, or the migration
        // would delete the very booking it is writing.
        update(ref(db,"bookings"),Object.assign(nulls,keyed)).catch(function(){ migratedRef.current=false; });
      }
      // v15.6.0: re-apply + persist any held user changes on top of this fresh snapshot
      // (after clearStale, so they don't re-hold). Without this, a live snapshot that
      // arrives during stale-recovery would wipe an optimistically-shown held change
      // before resync() got a chance to replay it. Batched with setBookings(arr) above
      // into one commit, so the change never visibly flickers. No-op when nothing is
      // queued (the normal case).
      drainPending();
    },dbError("bookings"));
    return unsub;
  },[]);
  useEffect(function(){
    const unsub=onValue(ref(db,"tableBlocks"),function(snap){
      const val=snap.val();
      // v17.15.3: sanitizeBlocks mints a `id` on any block that has none, so
      // removeBlock can match on identity instead of on the field set (which two
      // duplicate blocks share — see booking-logic). It also owns the array-vs-
      // object-vs-null shrug this line used to spell out, shared with resync().
      setTableBlocks(sanitizeBlocks(val));
      blocksLoaded.current=true;
      clearStale(); // v15.2.0: a live server snapshot proves the local data is current
    },dbError("tableBlocks"));
    return unsub;
  },[]);
  // v16.0.0: keep the tableBlocks revision-CAS ref anchored to the server value
  // (also re-anchors after a rejected write's rollback echo).
  useEffect(function(){ return attachRev("tableBlocks",blocksRevRef); },[]);
  // v15.5.0: the v15.3.0 `bookingsRev` listener was removed — the global revision
  // counter is replaced by per-booking `updatedAt` stamps (see the write-model note
  // above). The legacy `bookingsRev` node, if present, is now ignored (harmless).
  // Auto-hide the first-load banner after 6 seconds
  useEffect(function(){
    if(!loadBannerShown) return;
    const t=setTimeout(function(){setLoadBannerShown(false);},6000);
    return function(){clearTimeout(t);};
  },[loadBannerShown]);
  // v14.1: Subscribe to Firebase's special .info/connected ref. Drives the
  // offline banner and the reconnected flash. The hasConnectedRef gate makes
  // sure the offline banner never shows before the first successful handshake.
  //
  // v17.5.1 — "never connected" is no longer reported as ONLINE. `isOnline`
  // starts true and the offline branch below only fires once hasConnectedRef is
  // set, so a client that has NEVER completed a handshake kept a green dot and
  // no offline banner: the connection indicator actively asserted a healthy
  // connection on a device that had never once connected. That is precisely the
  // false signal that sent the Android-tablet investigation after an auth bug
  // for a release cycle. `hasConnected` now mirrors hasConnectedRef into state
  // so the UI can show a distinct "Connecting…" until the first handshake.
  useEffect(function(){
    const unsub=onValue(ref(db,".info/connected"),function(snap){
      const connected=snap.val()===true;
      isConnectedRef.current=connected; // v15.2.0: gates resync()'s server read
      // v17.10.1: the watchdog's clock. Stamped on the way DOWN only — a second
      // false snapshot must not push the deadline out, or a connection that
      // flaps between "no" and "no" would never qualify as stuck.
      if(connected){
        offlineSinceRef.current=null;
        kickSpacingRef.current=RECONNECT_KICK_MS; // next outage starts fast again
        kickLoggedRef.current=false;
      }
      else if(offlineSinceRef.current===null) offlineSinceRef.current=Date.now();
      if(connected){
        // v15.2.0: if we went stale while offline (a resume/heartbeat fired
        // markStale but resync couldn't read), run it now the socket is back.
        if(staleRef.current) resync();
        if(!hasConnectedRef.current){
          // First successful connection on boot — silent.
          hasConnectedRef.current=true;
          setHasConnected(true);
          setIsOnline(true);
          return;
        }
        // Reconnect after a real outage.
        setIsOnline(true);
        setReconnectShown(true);
        setTimeout(function(){setReconnectShown(false);},4000);
      } else {
        if(hasConnectedRef.current) setIsOnline(false);
      }
    },dbError(".info/connected"));
    return unsub;
  },[]);
  // ── v17.5.1: first-load watchdog ────────────────────────────────────────────
  // If the first bookings snapshot has not arrived after LOAD_TIMEOUT_MS, stop
  // pretending we are still loading and say so. Before this, a read that could
  // never succeed (CSP-blocked transport, denied rule, dead socket) showed the
  // "⟳ Loading bookings…" toast forever with no path to a diagnosis — the app
  // was structurally incapable of reporting its own failure.
  useEffect(function(){
    if(bookingsReady) return;
    const t=setTimeout(function(){ setLoadStalled(true); },LOAD_TIMEOUT_MS);
    return function(){ clearTimeout(t); };
  },[bookingsReady]);
  // Any listener failure anywhere (see lib/dbError.js) is recorded so the UI can
  // name the actual Firebase error code instead of showing a spinner.
  //
  // Two guards, both deliberate. (1) DEDUPE on path+code: a persistently failing
  // listener re-fires its cancel callback on every reconnect attempt, and each
  // raw setReadError would be a NEW object — i.e. a fresh BookingApp render per
  // failure, on the device that is already struggling. (2) Never let a failure
  // on some OTHER node overwrite a `bookings` failure: the stall toast prints
  // this path, and pointing the next investigation at the wrong node is exactly
  // how the v17.4.0→v17.5.0 misdiagnosis happened.
  useEffect(function(){
    return onDbError(function(info){
      setReadError(function(prev){
        if(prev&&prev.path===info.path&&prev.code===info.code) return prev;
        if(prev&&prev.path==="bookings"&&info.path!=="bookings") return prev;
        return info;
      });
    });
  },[]);
  // v17.10.1: reset the SDK's reconnect backoff. `goOnline` is the public
  // spelling of PersistentConnection.resume(), which sets reconnectDelay_ back
  // to RECONNECT_MIN_DELAY and schedules an immediate attempt — precisely what
  // minimising and restoring the app does, without needing a person to do it.
  // Safe when there is nothing wrong: with a connection already in flight it
  // only resets the delay (the SDK's own `!this.realtime_` guard), and that is
  // still the useful half, because the NEXT failure then retries in 1s instead
  // of up to five minutes.
  function forceReconnect(){
    lastKickRef.current=Date.now();
    // A person tapping "Reconnect now" is a fresh signal, so the automatic
    // ladder restarts from the bottom rather than inheriting a widened spacing.
    kickSpacingRef.current=RECONNECT_KICK_MS;
    try{ goOnline(db); }catch{ /* a deleted app instance — nothing to resume */ }
  }
  // Called from the 10s heartbeat. Four conditions, and each excludes a case
  // where kicking would be wrong or pointless:
  //   • not connected                — nothing to fix otherwise;
  //   • the page is VISIBLE          — a hidden page gets the SDK's own
  //     hidden→visible reset for free the moment it comes back, and waking a
  //     backgrounded tablet's radio to retry is exactly what we don't want;
  //   • we have connected BEFORE     — this is a *re*connect watchdog. A device
  //     that has never completed a handshake has a different problem (CSP,
  //     rules, transport) and the v17.5.1 load watchdog owns reporting it;
  //     retrying faster there would only make that diagnosis harder to read.
  //   • past the deadline            — measured from the later of "went
  //     offline" and "last kicked", so the spacing is the same either way.
  function kickIfStuck(){
    if(isConnectedRef.current) return;
    if(!hasConnectedRef.current) return;
    // /code-review: the `typeof document` guard this used to carry was dead —
    // this hook already calls document.addEventListener unguarded a few lines
    // below, and the app is browser-only. It implied a portability contract
    // that does not exist.
    if(document.visibilityState!=="visible") return;
    const since=offlineSinceRef.current;
    if(since===null) return;
    if(Date.now()-Math.max(since,lastKickRef.current)<kickSpacingRef.current) return;
    // /code-review: ONE line per outage, not one per kick. Every other warning
    // in this file is tied to a discrete write that happened or was refused, so
    // it is one line per event; a timer-driven warning at this cadence would
    // leave ~1,000 identical lines after an overnight outage and crowd out the
    // [SAFE] refusals and listener-cancel errors that an investigation actually
    // reads the console for (the v17.5.1 diagnosis surface).
    if(!kickLoggedRef.current){
      kickLoggedRef.current=true;
      console.warn("[conn] still offline after "+Math.round((Date.now()-since)/1000)
        +"s — resetting the Firebase reconnect backoff (retrying, widening to "
        +(RECONNECT_KICK_MAX_MS/1000)+"s).");
    }
    forceReconnect();
    kickSpacingRef.current=Math.min(RECONNECT_KICK_MAX_MS,kickSpacingRef.current*2);
  }
  // v15.2.0: heartbeat + resume detection driving the freshness gate.
  // The heartbeat bumps lastBeatRef every 10s; a gap >STALE_GAP_MS means the
  // event loop was frozen (OS sleep / lid close) → the local snapshot is stale.
  // The resume listeners (focus/pageshow/visibility) catch the wake a beat
  // sooner; both are gap-gated so a quick tab-switch with a live socket (data
  // still fresh) doesn't needlessly resync. Network-only blips keep the loop
  // alive (gap small) so offline editing + the offline queue are untouched.
  useEffect(function(){
    const t=setInterval(function(){
      const gap=Date.now()-lastBeatRef.current;
      lastBeatRef.current=Date.now();
      if(gap>STALE_GAP_MS) gapTrip();
      kickIfStuck();
    },10000);
    function onResume(){ if(isStaleGap(lastBeatRef.current,Date.now())) gapTrip(); }
    function onVis(){ if(document.visibilityState==="visible") onResume(); }
    window.addEventListener("focus",onResume);
    window.addEventListener("pageshow",onResume);
    document.addEventListener("visibilitychange",onVis);
    return function(){
      clearInterval(t);
      window.removeEventListener("focus",onResume);
      window.removeEventListener("pageshow",onResume);
      document.removeEventListener("visibilitychange",onVis);
    };
  },[]);
  // Auto-extend seated bookings that exceed their stored duration.
  // IMPORTANT: computes the update in a pure pass first and only calls saveBookings
  // if something actually needs to change. This prevents a spurious write attempt
  // on first mount (when onValue may not have returned yet, the write-guard would
  // fire even though no real change is being made).
  const lastExtend=useRef("");
  useEffect(function(){
    if(!bookingsLoaded.current) return; // no work to do until initial read lands
    const today=todayStr();
    let needsUpdate=false;
    const updated=bookings.map(function(b){
      if(b.status!=="seated") return b;
      // v15.1.0: a seated booking past its date's close belongs to the
      // auto-complete effect below — skip it here so the same 15s tick
      // doesn't extend it and then immediately complete it (one write, not two).
      if(pastCloseMins(b.date,today,nowMins)!==null) return b;
      const elapsed=seatedElapsed(b,today,nowMins);
      if(elapsed>b.duration){needsUpdate=true;return Object.assign({},b,{duration:elapsed,customDur:elapsed});}
      return b;
    });
    if(!needsUpdate) return;
    // v17.16.2: this gate must cover exactly the set the pass above touches.
    // It filtered on `b.date===today` while the pass now keys on the booking's
    // own close, so under a 24/25 close a yesterday-only extension produced an
    // EMPTY key that never changed — and the second tick onward was suppressed.
    // The repo's own v17.10.2 lesson: a gate narrower than its pass.
    const seated=bookings.filter(function(b){return b.status==="seated"&&pastCloseMins(b.date,today,nowMins)===null;});
    const key=seated.map(function(b){return b.id+":"+nowMins;}).join(",");
    if(key===lastExtend.current) return;
    lastExtend.current=key;
    saveBookings(bookingsAfterAction(updated,today,tableBlocks,null,false,autoOptimizer),true); // silent — non-interactive auto-extend
  },[nowMins,tableBlocks,autoOptimizer,bookings]);

  // v15.1.0: Auto-complete after closing time — any booking still `seated`
  // once its own date's closing moment has passed flips to `completed`
  // automatically. Mirrors the manual updateStatus("completed") path in
  // App.jsx: the duration is frozen at the close moment (auto-extend grew it
  // live while seated, so close is the natural cap) and the audit trail
  // records the flip as "auto" so HistoryPopup shows it wasn't a staff tap.
  // Same contract as the auto-extend effect above: pure pass first, write
  // only when something actually flips, route through bookingsAfterAction,
  // isSilent=true. No loop: the post-write snapshot echo re-runs this effect
  // but the flipped bookings are no longer seated. Past-midnight closes
  // (close = 24/25) are handled by pastCloseMins: yesterday's seated party
  // completes only when that day's 00:00/01:00 close actually passes — never
  // at the midnight date rollover itself.
  useEffect(function(){
    if(!bookingsLoaded.current) return; // no work to do until initial read lands
    const today=todayStr();
    let needsUpdate=false;
    const updated=bookings.map(function(b){
      if(b.status!=="seated") return b;
      const closeMins=pastCloseMins(b.date,today,nowMins);
      if(closeMins===null) return b;
      needsUpdate=true;
      const dur=Math.max(15,closeMins-toMins(b.time));
      return Object.assign({},b,{
        status:"completed",duration:dur,customDur:dur,
        history:(b.history||[]).concat([histEntry("status → completed (auto, after closing)","auto")])
      });
    });
    if(!needsUpdate) return;
    saveBookings(bookingsAfterAction(updated,today,tableBlocks,null,false,autoOptimizer),true); // silent — non-interactive auto-complete
  },[nowMins,tableBlocks,autoOptimizer,bookings]);

  return {
    bookings, tableBlocks,
    saveBookings, saveBlocks,
    isOnline, writeWarning, setWriteWarning,
    loadBannerShown, reconnectShown, resyncing, bookingsReady,
    // v17.5.1 diagnosis surface — see the load-watchdog effect above.
    loadStalled, readError, hasConnected,
    // v17.10.1: the manual half of the reconnect watchdog — the connection
    // popover's "Reconnect now". Same lever the watchdog pulls, on demand.
    forceReconnect,
    // firstLoadCount is exposed as a ref because the load-banner JSX in
    // BookingApp reads .current to show the booking count from the first
    // successful Firebase load. It must remain a ref (not state) so
    // saveBookings can read it synchronously inside the empty-array
    // safety guard without triggering re-renders.
    firstLoadCount,
  };
}
