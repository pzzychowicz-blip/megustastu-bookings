// src/lib/reconcile.js — v17.14.0
//
// The post-sync conflict reconciliation DECISION, extracted from the useEffect
// in App.jsx that has held it since v15.6.1.
//
// Why it moved: the rule this repo adopted in v17.8.0 — *logic that decides
// something the restaurant acts on does not live in a `useEffect`* — is why
// `placeWaitlist` and `presenceState` are modules. This decides which booking
// gets MOVED TO ANOTHER TABLE after two devices' offline edits merge, which is
// as consequential as either, and until now only the pure `dayBookingsSig` half
// of it was reachable by a test. v17.10.2 found an infinite render loop in here
// by reading the console, because the app looks and behaves perfectly while it
// spins — precisely the class of defect a test catches and observation does not.
//
// What stayed in App: the effect's gates (`resyncing`, the loaded ref), the
// `saveBookings` dispatch and the toast. This module is pure.
//
// ── The problem it solves (v15.6.1) ─────────────────────────────────────────
// Two devices adding bookings OFFLINE to a table that was free at creation time
// merge (v15.5.0 per-node) into BOTH bookings on the same table — but neither
// device's optimiser saw the other, so they overlap once synced. The sync path
// (onValue/resync) stores merged data verbatim with no optimiser pass, so the
// overlap persists until a later edit happens to re-run it.
import { verifyClean, findConflicts, optimizerActiveFor, bookingsAfterAction,
         dayBookingsSig, isLocked } from "./booking-logic";

// Every date from today onward that has assigned tables and fails verifyClean.
// Computed against the CURRENT snapshot; the resolution below runs against
// whatever `prev` the save updater is handed, which is the same split the
// effect has always had.
export function dirtyDates(bookings,today){
  const dates=Array.from(new Set(
    (bookings||[])
      .filter(function(b){return b&&b.date>=today&&(b.tables||[]).length>0;})
      .map(function(b){return b.date;})
  ));
  return dates.filter(function(d){return !verifyClean(bookings,d);});
}

// Resolve `dirty` against `prev`. Returns {next, changed}.
//
// **`next === prev` when nothing moved, and that is the contract, not an
// optimisation.** v17.10.2: the optimiser branch used to assign unconditionally,
// which turned an UNRESOLVABLE clash into an infinite render loop — `applyOpt`
// copies a locked booking's tables through verbatim, so two `_locked` bookings
// clashing on one table cannot be separated by a reshuffle, and every walk-in
// and every drag-drop path sets `_locked`. The pass produced a NEW array with
// identical content, `setBookings` saw a new reference, the effect's `bookings`
// dep changed, and it ran again. Forever. The manual branch below survived only
// by ACCIDENT: when nothing is movable it breaks with `next` still `=== prev`,
// and React bails out of identical state.
//
// Deterministic across devices: the "newest" pick sorts by `updatedAt`
// descending with an id tiebreaker, so two devices reconciling the same merge
// choose the same booking and the v15.5.0 per-`$id` CAS settles the double-write.
export function reconcile(prev,dirty,blocks,autoOptimizer){
  let next=prev;
  let changed=false;
  (dirty||[]).forEach(function(d){
    if(optimizerActiveFor(d,autoOptimizer)){
      const after=bookingsAfterAction(next,d,blocks,null,false,autoOptimizer);
      // v17.14.0: identity first. Since 1/n, `bookingsAfterAction` hands back its
      // input when the pass moved nothing, so the unresolvable case — the one
      // that repeats, and the one that used to spin — costs ZERO signature
      // scans instead of two full passes over every booking in the database.
      // The signature is still required when the reference DID change: this pass
      // also runs `syncLiveDurations`, which can extend a seated party's
      // duration TODAY while iterating a future date, and that is a change on a
      // date this iteration is not about.
      if(after!==next&&dayBookingsSig(after,d)!==dayBookingsSig(next,d)){next=after;changed=true;}
    }else{
      // Optimiser OFF (manual mode, today after the cutoff): relocate ONLY the
      // newest non-locked conflicting booking, leaving manual arrangements
      // intact. Loops because one relocation can reveal another; the cap is
      // what guarantees termination when a booking is unplaceable (a full
      // restaurant drops it out of the overlap set, so the loop ends anyway).
      let guard=0;
      while(!verifyClean(next,d)&&guard++<20){
        const ids=findConflicts(next,d);
        const movable=next.filter(function(b){return ids.indexOf(b.id)>=0&&!isLocked(b);})
          .sort(function(a,b){return (b.updatedAt||0)-(a.updatedAt||0)||(a.id<b.id?1:-1);});
        if(!movable.length) break; // only locked overlaps — leave as-is
        const after=bookingsAfterAction(next,d,blocks,movable[0].id,true,autoOptimizer);
        // v17.14.0: a pass that changed nothing will change nothing on the next
        // iteration either, so stop rather than burning the remaining guard on
        // the heaviest function in the app — and do NOT report a change, which
        // would fire "Resolved a table conflict after syncing." for a conflict
        // that is still there. Reachable when findFreeSlot hands the booking
        // back the tables it already had. Only expressible since 1/n made a
        // no-op return its input.
        if(after===next) break;
        next=after;
        changed=true;
      }
    }
  });
  return {next:next,changed:changed};
}
