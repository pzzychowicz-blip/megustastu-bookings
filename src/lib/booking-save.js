// src/lib/booking-save.js
//
// ── v18.3.4: the booking form's save, as a plan ──────────────────────────────
// `doSaveEdit` was 355 lines inside `BookingApp` (complexity 114 at the 09-23
// scan), and no test could call it: it read a dozen closures and ended in half a
// dozen effects. Its decisions live here now, pure: `applyEdit` takes the draft
// and the bookings and returns either the refusal Save shows or the write it
// makes, with what the toast, the undo and the seat note are given. App keeps
// the effects and runs them in the order they have always run (ROADMAP #13, and
// the first piece of #17: the save path leaves `BookingApp`).
//
// `buildBooking` is the same for a new booking (`doSaveNew`, phase 6).
//
// `walkinBooking` and `occurrenceBooking` are the app's other two new bookings,
// the walk-in form's Seat and the weekly generator's occurrence (phase 7): the
// record each writes, with nothing to decide around it, so they return it.
//
// `editWindow` is the part of an edit's window the clock has no say in: the
// planned length, the un-seat restore, the revival and whether the placement is
// re-checked. The form's availability line asks the save's question before Save
// is pressed (`keptRefusal`) and computed its own copy of exactly this.
//
// Moved here, verbatim apart from where the values come from, with the comments
// that explain each rule. `tests/save-path.test.js` (v18.3.4 phase 1) ran App's
// own code before the move and runs it after; none of its snapshots moved.
//
// ── Imports ──────────────────────────────────────────────────────────────────
// Explicit ".js" specifiers, as everywhere in `lib/`. Nothing on the WhatsApp
// backend's Node chain imports this file, and nothing this file imports imports
// it back, so it cannot close a cycle.
import {
  getDur, genId, toMins, nowTime, histEntry, diffBooking, isLocked, isActive, enteredPhone,
  bookingsAfterAction, seatedElapsed, seatedShiftFor, unseatRestore,
  tablesPinned, tablesKept, keepsHandTables, tablesFreeFor, replacePinnedClashes,
  seatRefusal, seatedFitRefusal, pinnedClashParties, pinnedClashRefusal, handKeptRefusal,
  offZone, offZoneNote, seatNoteFor,
} from "./booking-logic.js";
import { stampGuestSeed, resolveGuestId } from "./customers.js";
import { normalizeCode } from "./vouchers.js";
import { todayStr } from "./day.js";

// ── memoByPrev ───────────────────────────────────────────────────────────────
// v17.4.0 /code-review: prev-identity memo for a save transform. The synchronous
// guard checks and the immediate saveBookings dispatch call the transform with
// the SAME `prev` reference, so they share ONE optimizer pass; a retry replay
// arrives with a FRESH prev and correctly recomputes (the v15.7.0
// capture-intent-then-replay contract). Was hand-rolled in four places.
// v18.3.4: moved from App.jsx with the edit's save; App's delete and cancel
// transforms import it from here.
export function memoByPrev(fn){
  let mPrev=null,mFin=null;
  return function(prev){if(prev===mPrev) return mFin;const r=fn(prev);mPrev=prev;mFin=r;return r;};
}

// ── releaseSwapped: a party a swap takes tables from ─────────────────────────
// The table picker's Swap hands tables another party holds to the booking being
// placed, and names each party it takes from with the tables it takes
// (`affected`, the form's `swapAffected`). Such a party keeps the rest of its
// tables and is unlocked, so the optimiser pass that follows can place it
// again. Any other booking comes back as it was, the same object.
// v18.3.4 (/code-review): written out three times — the edit's save, the new
// booking's save and App's `manualAssign` (the picker's Swap outside the form).
export function releaseSwapped(b,affected){
  const match=affected.find(function(ab){return ab.id===b.id;});
  if(!match) return b;
  const remaining=(b.tables||[]).filter(function(t){return !match.tables.includes(t);});
  return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});
}

// ── displacedBy: who a save leaves without a table ───────────────────────────
// The active parties on `date` that held tables in `before` and that the save's
// result (`fin`) leaves with none, or clashing — anyone but the booking being
// saved (`id`). Both saves refuse when there are any, naming them
// (`displaceRefusal`), when the app is choosing the tables.
// `before` is the edit's list as it was and the create's `applyBase` result.
// Those differ only by a swap's release, and a swap comes with tables picked by
// hand, when neither save asks this.
// v18.3.4 (/code-review): written out twice, in the two saves.
function displacedBy(before,fin,date,id){
  const prevAssigned=before.filter(function(b){return b.date===date&&isActive(b)&&b.tables&&b.tables.length>0&&b.id!==id;});
  const displaced=fin.filter(function(b){return b.id!==id&&b.date===date&&isActive(b)&&(!b.tables||!b.tables.length||b._conflict);});
  return displaced.filter(function(d){return prevAssigned.some(function(p){return p.id===d.id;});});
}
// The refusal, with `what` naming the save: "this change" or "adding this booking".
function displaceRefusal(what,kicked){
  return "Not enough capacity — "+what+" would displace "+kicked.length+" existing booking"+(kicked.length>1?"s":"")+": "+kicked.map(function(k){return k.name;}).join(", ")+".";
}

// ── editWindow: where an edit puts the booking, before the clock ─────────────
// What the draft alone decides about the edited booking's window:
//   size             the party size saved (`Number(draft.size) || 2`)
//   formPlan         the length the form shows (`customDur`, else the size's)
//   planChanged      whether that differs from the planned length stored
//   timeUntouched    neither the time nor the date was edited
//   needsR           a placement input moved (size, time, date, zone, preferred
//                    tables, Clear), so the tables are chosen again
//   unseat           the booked plan an un-seat puts back (`unseatRestore`), or
//                    null
//   revived          a cancelled or completed booking walked back
//   recheck          the window moved in any way, so the placement is checked
//   time, duration, customDur, originalDuration, scheduledTime
//                    what the save writes for them before the two changes that
//                    need the clock, which `applyEdit` makes on top: the seat
//                    shift and the completion's truncation. Each of those and
//                    the un-seat need a different status, so at most one of the
//                    three applies and their order cannot matter.
// `orig` is undefined when the booking was deleted elsewhere while the form was
// open; the values are then the draft's own, as they always were.
export function editWindow(orig,f){
  const size=Number(f.size)||2;
  const origPt=(orig&&Array.isArray(orig.preferredTables))?orig.preferredTables.slice().sort().join(","):"";
  const newPt=Array.isArray(f.preferredTables)?f.preferredTables.slice().sort().join(","):"";
  const prefTablesChanged=origPt!==newPt;
  // v18.0.0 session 8 (item 5b): the plan numbers are computed ABOVE the
  // seated shift now, because the shift needs them. They sat below it,
  // and that ordering IS the ROADMAP entry this commit deletes — the
  // shift pinned the scheduled end from the STORED duration and then
  // overwrote every length the form had just set.
  const formPlan=f.customDur||getDur(size);
  const origPlan=orig?(orig.originalDuration||orig.duration||90):formPlan;
  const planChanged=formPlan!==origPlan;
  const timeUntouched=orig&&f.time===orig.time&&f.date===orig.date;
  const needsR=!orig||size!==orig.size||f.time!==orig.time||f.date!==orig.date||f.preference!==orig.preference||f._clearManual||prefTablesChanged;
  // v18.0.0 session 8 (C4): `prefOnly` is gone. It existed only to EXEMPT
  // a preference-or-preferred-tables change from the displacement guard,
  // and a preference change moves tables like any other — it can leave
  // somebody else with none. The exemption is the finding.
  let duration=planChanged?formPlan:(orig?(orig.duration||90):formPlan);
  const saveOrigDur=planChanged?formPlan:origPlan;
  let customDur=planChanged?(f.customDur||null):(orig?(orig.customDur||null):(f.customDur||null));
  let time=f.time;
  // v18.0.0 session 8 (C1): the seated shift's inverse. Walking a booking
  // out of seated to Confirmed or Pending puts the booked start and the
  // booked length back — `applySeatedShift` had rewritten both and nothing
  // undid it, so the booking kept the time the party arrived as the time
  // it was booked for. Not for completed or cancelled: a finished visit's
  // times are the record of what happened, and completion truncates the
  // duration deliberately (v16.2.0).
  //
  // Gated on `timeUntouched` for the same reason the shift is — an
  // explicit edit in this save wins over the automatic value — and the
  // LENGTH half additionally on `!planChanged`, so a length typed in the
  // same save survives. The start still moves back in that case: a start
  // and a length are two decisions, and only one of them was made here.
  const unseating=orig&&orig.status==="seated"&&(f.status==="confirmed"||f.status==="pending")&&timeUntouched;
  const unseat=unseating?unseatRestore(orig,size):null;
  if(unseat){
    time=unseat.time;
    if(!planChanged){duration=unseat.duration;customDur=unseat.customDur;}
  }
  // ── v18.0.0 session 8 (C): two questions, not one ────────────────────
  // `needsR` was answering both "must the placement be re-checked?" and
  // "must the tables be re-chosen?", and a length change and a revival
  // are in NEITHER of its terms — so those saves went straight to
  // `bookingsAfterAction`, whose optimiser-OFF branch keeps every
  // booking's tables, including one somebody else now holds.
  //
  // Measured live 2026-09-11: R3 — a 17:00 booking extended 90 → 120 was
  // saved ON TOP of another party's 18:30 booking on 5A, and the
  // reconciliation effect moved it to 1B 400ms later under "Resolved a
  // table conflict after syncing"; R4 — a cancelled booking walked back
  // to Confirmed kept a table that had since been given away, and went
  // the same way. Neither had synced anything.
  //
  // So: re-CHECK on a window change of any kind; re-CHOOSE only when the
  // tables it has no longer work for that window (`applyEdit`).
  const revived=!!orig&&(orig.status==="cancelled"||orig.status==="completed")&&f.status!=="cancelled"&&f.status!=="completed";
  const recheck=needsR||planChanged||revived||!!unseat;
  // v14 p1: scheduledTime resolution.
  // - If user manually changed time in the form (f.time !== orig.time), that
  //   is an explicit reschedule → scheduledTime follows the new time.
  // - If the ONLY time change is the seated-shift (auto), scheduledTime stays
  //   pinned to the original — this is what "Book Again" reads from later.
  // - For pre-v14 bookings without scheduledTime, sanitize already backfilled it.
  const userChangedTime=orig&&f.time!==orig.time;
  const scheduledTime=userChangedTime?f.time:(orig&&orig.scheduledTime?orig.scheduledTime:f.time);
  // The un-seat puts the planned length back into `originalDuration` too; the
  // seat shift's own value goes on top in `applyEdit`.
  const originalDuration=(unseat&&!planChanged)?unseat.originalDuration:saveOrigDur;
  return {size:size,formPlan:formPlan,planChanged:planChanged,timeUntouched:timeUntouched,needsR:needsR,
    unseat:unseat,revived:revived,recheck:recheck,
    time:time,duration:duration,customDur:customDur,originalDuration:originalDuration,scheduledTime:scheduledTime};
}

// A refusal: Save's sentence, and the field it is about (only the date has one).
function refuse(message,field){return {refusal:field?{message:message,field:field}:{message:message}};}

// ── applyEdit: the edit form's Save, as a plan ───────────────────────────────
// `input`:
//   list           the bookings the save reasons over. App passes
//                  `withClearedSeats(bookings)`: a party "Complete them & seat"
//                  has just cleared is completed in it, though this render has
//                  not seen the write yet (see `withClearedSeats` in App)
//   live           the same with live durations, which the seat shift reads, so
//                  an overstaying party's table counts as taken
//   id             the booking being edited
//   draft          the form as `doSave` validated it (the status override and
//                  the typed country code already applied)
//   blocks         the table blocks
//   swap           the parties a swap takes tables from (`swapAffected`), or null
//   autoOptimizer  the optimiser switch
//   today, nowMins App's clock, which the seat shift reads
//   phonePrefix    Settings' prefix, which counts as no number (`enteredPhone`)
//   getUser        the history entries' author, asked as each entry is made
//
// Returns `{ refusal: { message, field } }` in the order Save has always asked
// (`field` only for the date), or `{ next, fin, changed, flash, seatNote }`:
//   next      the write: a replayable `prev → next` transform (v15.7.0),
//             memoised by `prev` identity
//   fin       `next(list)`, which the refusals read and undo compares with
//   changed   whether a field changed. The undo gate: `diffBooking` returns the
//             sentinel "saved (no field changes)" when nothing moved, and
//             `saveBookings` still reports an empty patch as dispatched, so `ok`
//             alone would offer an Undo for a save that changed nothing
//   flash     `{ kind, note }` for the save toast, or null for none
//   seatNote  the seat note's snapshot (`seatNoteFor`), or null
//
// The completion's truncation and `stayedMin` read the wall clock at Save, and
// the seat shift reads `nowMins`, as they always have.
export function applyEdit(input){
  const f=input.draft,editId=input.id,bookings=input.list,liveBookings=input.live;
  const tableBlocks=input.blocks,swapAffected=input.swap,autoOptimizer=input.autoOptimizer;
  const nowMins=input.nowMins,today=input.today,getUser=input.getUser;
  const cleanPhone=enteredPhone(f.phone,input.phonePrefix);
  const mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
  const orig=bookings.find(function(b){return b.id===editId;});
  const w=editWindow(orig,f);
  const size=w.size,planChanged=w.planChanged,needsR=w.needsR,unseat=w.unseat,recheck=w.recheck;
  // v14: detect confirmed→seated transition here. Only auto-shift time if
  // staff did NOT manually edit time/date in the form (otherwise their
  // explicit edit wins). Compute BEFORE needsR so we can suppress reshuffle.
  const seatingNow=orig&&orig.status!=="seated"&&f.status==="seated";
  let seatedShift=null;
  if(seatingNow&&w.timeUntouched){
    // Use live-synced bookings so overstaying seated guests' tables are
    // correctly treated as occupied when the overlap guard runs. The
    // length handed in is the one being SAVED — see seatedShiftFor.
    seatedShift=seatedShiftFor(orig,nowMins,liveBookings,today,planChanged?w.formPlan:0);
  }
  let saveDur=w.duration,saveCustDur=w.customDur,saveTime=w.time;
  // v16.2.0: truncate to the actual span ONLY when the booking was SEATED
  // before this save. A direct Confirmed → Completed edit keeps the form's
  // scheduled duration (mirrors the updateStatus quick-action gate).
  // v17.16.2 (CT-2B-02): was `nowMinsLocal - toMins(f.time)`, which mixes
  // an axis measured from TODAY's midnight with one measured from the
  // BOOKING's — so completing a booking dated anything but today clamped to
  // the 15-minute floor. seatedElapsed projects and caps at that day's
  // close, so this agrees with what auto-complete would have written.
  if(f.status==="completed"&&orig&&orig.status==="seated"&&!f.customDur){const now=new Date();const actualDur=Math.max(15,seatedElapsed({date:f.date,time:f.time},todayStr(now),now.getHours()*60+now.getMinutes()));saveDur=actualDur;saveCustDur=actualDur;}
  // v17.6.0: record how long they ACTUALLY stayed, so the List card can
  // show it after the visit (booking-logic's stayedMins). Computed for
  // EVERY seated→completed save, including the `f.customDur` case the
  // truncation above skips — how long the party sat is a fact about the
  // visit, independent of the duration the user chose to store. 0 leaves
  // the existing value alone (never overwrite a real stay with a blank).
  let saveStayed=orig?(Number(orig.stayedMin)||0):0;
  if(f.status==="completed"&&orig&&orig.status==="seated"){
    const nowD=new Date();
    // Same axis fix as the truncation above — the register's "completing
    // records stayedMin = 15".
    saveStayed=Math.max(15,seatedElapsed({date:f.date,time:f.time},todayStr(nowD),nowD.getHours()*60+nowD.getMinutes()));
  }
  // Apply seated shift (if any) to the values we'll write. Overrides plan
  // numbers above — the shift always wins over default-duration logic.
  if(seatedShift){
    saveTime=seatedShift.newTime;
    saveDur=seatedShift.newDuration;
    saveCustDur=seatedShift.newDuration;
  }
  // The un-seat's own entry, built here, where both halves of what was
  // actually written are known (`editWindow` restored them).
  const unseatHist=unseat?histEntry("un-seated: time restored "+orig.time+" → "+saveTime+(planChanged?"":", length "+(orig.duration||0)+" → "+saveDur+" min"),getUser()):null;
  const clearM=!!f._clearManual;
  const wasSeatedLocked=orig&&isLocked(orig)&&!mt.length;
  // ── v17.15.5: a FINISHED booking's tables are a historical record ────
  // Completed and cancelled bookings are the two `applyOpt` refuses to
  // place — it copies them straight through. `doSaveEdit` did not agree
  // with it, and the disagreement produced two different bugs depending
  // on one flag nothing in the form shows you:
  //
  //   • LOCKED (every walk-in, every drag-drop, every manual assign) —
  //     `unlockForOpt` rewrites the status to "confirmed" BEFORE
  //     `bookingsAfterAction`, precisely so the optimiser will consider a
  //     booking it would otherwise skip. That makes `applyOpt`'s
  //     completed guard miss it, the optimiser reassigns it, and the
  //     restore below puts "completed" back on top of the NEW tables.
  //     Measured live: changing a completed party from 4 to 5 moved it
  //     from table 7 to tables 1A + 1B — i.e. the app rewrote where a
  //     party that has already left had sat.
  //   • NOT LOCKED — `tables: []` is written, `applyOpt` will not refill
  //     a completed booking, and the capacity guard below rejects the
  //     save with "No tables available at this time". Measured live: a
  //     completed booking's party size cannot be changed at all, and the
  //     error blames the restaurant being full.
  //
  // Both directions are the same disagreement, so one flag settles it:
  // while the booking is being SAVED as finished, its tables are carried
  // through verbatim and it is never handed to the optimiser. An explicit
  // manual assignment (`mt`) or an explicit clear (`clearM`) still wins —
  // those are the user saying so, which is different from the optimiser
  // deciding on its own.
  //
  // It keys on `f.status`, not `orig.status`: walking a completed booking
  // back to confirmed in the same save SHOULD return it to normal
  // placement, and seating→completing one in the same save should pin the
  // table it was actually sat at.
  const editFinished=f.status==="completed"||f.status==="cancelled";
  // v18.0.0 session 8 (item 3): the same rule, one status wider — a
  // booking being saved as SEATED keeps its tables too, because the party
  // is sitting at them. `tablesPinned` is the one predicate; see its note
  // in booking-logic.js for what was measured. `editFinished` survives for
  // exactly one guard below, where the two questions genuinely differ.
  // v18.3.2 (Patryk): `tablesKept`, one predicate wider — a booking
  // somebody placed by hand (`_locked`) keeps its tables through a save
  // that moves only its window, so a time change no longer hands it to
  // the optimiser (`keepsHandTables`, booking-logic.js). The form's
  // preview asks the same function. `handKept` is that half alone, for
  // the refusals below.
  const pinned=tablesKept(orig,{status:f.status,size:size,date:f.date,preference:f.preference,preferredTables:f.preferredTables},mt.length>0,clearM);
  const handKept=pinned&&!tablesPinned(f.status,mt.length>0,clearM);
  // Hoisted out of buildNext: this exact expression was written twice —
  // once to unlock and once to restore — and two copies of a condition
  // that must agree is how they stop agreeing.
  const unlockForOpt=needsR&&wasSeatedLocked&&!mt.length&&!clearM&&!pinned;
  // Re-CHOOSE only when the tables the booking has no longer work for the
  // new window (`editWindow` has the other half of this note). A
  // check-only save that is still free keeps exactly the tables it had.
  //
  // v18.0.0 session 10 (/code-review): and that last sentence is true on
  // the optimiser-OFF path ONLY, which is the caveat this comment was
  // missing and Commit 108 established while fixing the preview.
  // `bookingsAfterAction` takes its `applyOpt` branch whenever
  // `optimizerActiveFor(date, state)` is true — BEFORE it looks at
  // `forceReassign` at all — and that predicate is true for every date
  // except today with the toggle off. So `keepsWindowTables` decides the
  // outcome today after the cutoff and nowhere else; everywhere else the
  // greedy re-run overrides it, and a booking whose tables are still
  // free can still come out somewhere else. Two predicates agreeing with
  // each other is not either of them agreeing with the pass that
  // overrides both. The preview says the same thing in `optOwns`
  // (BookingFormModal) and now this side says it too.
  const winStart=toMins(saveTime);
  const keepsWindowTables=(recheck&&!needsR&&!mt.length&&!pinned)
    ? tablesFreeFor(bookings,f.date,editId,(orig&&orig.tables)||[],winStart,winStart+saveDur,tableBlocks)
    : false;
  const forceReassign=!mt.length&&!pinned&&(needsR||(recheck&&!keepsWindowTables));
  // v17.4.0: the diff string is computed ONCE — it feeds the history entry
  // AND the undo gate (`changed`).
  const editDiff=orig?diffBooking(orig,f,size,input.phonePrefix):"";
  const editChanged=!!orig&&editDiff!=="saved (no field changes)";
  const editHist=orig?histEntry("edited: "+editDiff,getUser()):histEntry("edited",getUser());
  const saveScheduledTime=w.scheduledTime;
  // v14 p1 (Issue 2 fix #2): when a seated-shift happens, originalDuration
  // must also move to the new duration so the ghost bar anchors at the true
  // scheduled end (e.g. 20:15 + 105 = 22:00), not at the stale 21:45.
  const saveOrigDurFinal=seatedShift?seatedShift.newDuration:w.originalDuration;
  // v14: when seating, force no-reshuffle of other bookings (same rule as
  // updateStatus). The seated-shift must not trigger cascading table moves.
  const optStateForSave=seatingNow?false:autoOptimizer;
  // v15.7.0: build the next state as a PURE transform of `prev` (the live
  // in-memory snapshot at write time) rather than a precomputed array. This
  // opts the edit save into the function-form path in saveBookings, so a
  // stale-gate hold now shows the change optimistically + auto-retries on
  // fresh data (parity with quick actions), instead of bouncing the form back
  // with "tap Save again". The captured edit fields (computed once from `orig`)
  // are applied to whichever version of the booking is in fresh `prev`, so a
  // concurrent edit to OTHER bookings (which live in `prev`) is preserved.
  // v17.10.0: the guest-identity back-stamp is `stampGuestSeed` in
  // lib/customers.js, called here so the source booking and the edited one
  // ride ONE saveBookings call.
  function buildNext(prev){
    const upd=stampGuestSeed(prev,f).map(function(b){
      if(b.id===editId){
        let h=(b.history||[]).concat([editHist]);
        if(seatedShift) h=h.concat([histEntry("seated "+seatedShift.direction+": time adjusted "+seatedShift.oldTime+" → "+seatedShift.newTime,getUser())]);
        if(unseatHist) h=h.concat([unseatHist]);
        return Object.assign({},b,{name:f.name,phone:cleanPhone,date:f.date,time:saveTime,scheduledTime:saveScheduledTime,size:size,duration:saveDur,originalDuration:saveOrigDurFinal,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),voucherCode:normalizeCode(f.voucherCode),status:unlockForOpt?"confirmed":f.status,tables:mt.length?mt:(clearM?[]:((!needsR||pinned)?b.tables:[])),customDur:saveCustDur,stayedMin:saveStayed,guestId:f.guestId||b.guestId||null,_manual:mt.length>0?true:(clearM?false:b._manual),_locked:mt.length>0?true:(clearM?false:(unlockForOpt?false:b._locked)),preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],history:h});
      }
      if(swapAffected) return releaseSwapped(b,swapAffected);
      return b;
    });
    let out=bookingsAfterAction(upd,f.date,tableBlocks,editId,forceReassign,optStateForSave);
    // v18.0.0 session 8 (C1): the flags go back to what they WERE, not to
    // "does it have tables now". `wasSeatedLocked` is `isLocked(orig)`,
    // which is true for any seated booking — so walking an ordinary one
    // back to Confirmed with a time change stamped it `_locked` +
    // `_manual` and quietly turned it into a manual arrangement the
    // optimiser would never touch again. A walk-in, which really was
    // locked before the seat, still comes back locked.
    if(unlockForOpt){out=out.map(function(b){if(b.id===editId) return Object.assign({},b,{status:f.status,_locked:!!(orig&&orig._locked),_manual:!!(orig&&orig._manual)});return b;});}
    // v18.0.0 session 8: with the tables pinned, the optimiser-OFF path
    // keeps EVERY booking's tables — including anyone the new window now
    // overlaps. Re-place them here, before Save, rather than saving the
    // clash and leaving the reconciliation effect to move somebody 400ms
    // later under a toast that blames syncing (R3/R4's own mechanism).
    // With the optimiser ON this has already happened inside `applyOpt`,
    // which places everyone around a locked booking, so the call is a
    // no-op there and returns its input.
    //
    // v18.0.0 session 10 (/code-review): gated on `recheck`, not on
    // `needsR`. `needsR` is "did the placement INPUTS move" and the
    // window moves by two more routes the line above already knows
    // about — a length change and a revival — so a seated booking
    // extended 90 → 150 minutes, or a cancelled one walked straight
    // to Seated, kept its tables with nothing re-placing whoever it
    // now overlapped. That is R3's own mechanism, left open on the
    // pinned branch by the commit that closed it everywhere else:
    // `forceReassign` is false when `pinned`, the OFF path keeps
    // every booking's tables, the displacement guard below sees
    // nobody without tables, and the locked refusal above sees a
    // MOVABLE partner — so the clash was saved and the reconciler
    // moved somebody 400ms later under a toast blaming syncing.
    //
    // Proven with the pure functions: `bookingsAfterAction` with
    // `forceReassign:false` and the optimiser off leaves the clash,
    // and `replacePinnedClashes` on that same output clears it.
    // Widening the gate is free where it was already right — it
    // returns its INPUT when nothing is movable, and with the
    // optimiser ON `applyOpt` has already placed everyone around the
    // locked booking, so there is nothing left for it to find.
    if(pinned&&recheck) out=replacePinnedClashes(out,f.date,editId,tableBlocks,optStateForSave);
    return out;
  }
  // /code-review perf: buildNext runs a full optimiser pass (expensive on
  // a loaded day). Memoised by `prev` IDENTITY so the synchronous guard
  // check below and the immediate dispatch (updater called with the same
  // `bookings` reference — 2×, 3× under dev StrictMode) share ONE pass. A
  // retry replay gets a FRESH prev ref → recomputes, exactly as the
  // v15.7.0 capture-intent contract requires.
  const buildNextMemo=memoByPrev(buildNext);
  const fin=buildNextMemo(bookings);
  // v18.0.0 session 8 (item 3) — the pinned save's own refusals, in the
  // order the party at the table makes necessary. Each leaves the form
  // open with its message, like every other refusal here. The
  // displacement guard below is deliberately the one after: a booking
  // `replacePinnedClashes` could NOT re-place arrives there with no
  // tables, which is exactly the input that guard was written for.
  if(pinned&&f.status==="seated"){
    const seatB=fin.find(function(b){return b.id===editId;});
    // C2, at the form's door. Gated on `seatingNow` for the reason the
    // predicate's own note gives: the app refuses to CREATE a seated
    // booking with no table, and does not hold an unrelated edit of one
    // that already exists hostage to it.
    if(seatingNow){const noTable=seatRefusal(seatB);if(noTable) return refuse(noTable);}
    if(orig&&f.date!==orig.date) return refuse("A seated booking can't be moved to another date — change the status first.","date");
    const fitRefusal=seatedFitRefusal(size,seatB?seatB.tables:[]);
    if(fitRefusal) return refuse(fitRefusal);
    const lockedClash=pinnedClashParties(fin,f.date,editId).locked;
    if(lockedClash.length) return refuse(pinnedClashRefusal(lockedClash[0]));
  }
  // v18.3.2: hand-placed tables kept through a window change. Whoever the
  // pass could move is already moved (`applyOpt` places every unlocked
  // booking around a locked one; with the optimiser off,
  // `replacePinnedClashes` above does it). What is left is a party that
  // cannot be moved, or a table block, and the save is refused by name
  // rather than saved on top of either. Only when the window moved
  // (`recheck`): an edit that leaves it alone is not held hostage to a
  // clash it did not cause.
  if(handKept&&recheck){
    // v18.3.3 (/code-review): `handRefusal`, not `keptRefusal`, which is
    // the exported preview function.
    const handRefusal=handKeptRefusal(fin,f.date,editId,tableBlocks);
    if(handRefusal) return refuse(handRefusal);
  }
  if(!mt.length&&recheck){
    const kicked=displacedBy(bookings,fin,f.date,editId);
    if(kicked.length>0) return refuse(displaceRefusal("this change",kicked));
  }
  // v17.15.5 (/code-review): `!editFinished`. This guard means "the
  // optimiser could not place the booking", and a finished booking is
  // never offered to the optimiser at all — its tables are carried
  // through. Without the exclusion the fix above is only half applied:
  // a booking whose tables are ALREADY empty carries `[]` through, the
  // guard reads that as a placement failure, and the save is rejected
  // with a message about the restaurant being full. Reachable by ordinary
  // use — a booking the app could not place shows "No table assigned"
  // and carries `_conflict` with `tables: []`; cancel it, then correct
  // its party size, and the edit is refused for a table it never had.
  if(!mt.length&&recheck&&!editFinished){
    const editedInFin=fin.find(function(b){return b.id===editId;});
    if(editedInFin&&(!editedInFin.tables||!editedInFin.tables.length)) return refuse("No tables available at this time — see suggestions below.");
  }
  // C8: a save that seats passes `optStateForSave: false`, so no table was
  // re-optimised and the toast must not say one was.
  // v18.3.1: a save that lands the party outside the zone it asked for
  // says so (a preference is a wish now); only when THIS save moved it
  // there, so re-saving a booking already flagged repeats nothing, and
  // only when the APP chose the tables (/code-review): "indoor was full"
  // is false for tables somebody picked by hand. The flag still shows.
  const edited=fin.find(function(b){return b.id===editId;});
  const zoneNote=!mt.length&&edited&&offZone(edited)&&!offZone(orig)?offZoneNote(edited):"";
  return {
    next:buildNextMemo,
    fin:fin,
    changed:editChanged,
    flash:(needsR||swapAffected||f.status==="completed"||seatingNow||zoneNote)?{kind:seatingNow?"saved":null,note:zoneNote}:null,
    // v18.0.0 session 7: the seat note. The snapshot is the EDITED booking,
    // so a note typed in this save is shown.
    seatNote:seatNoteFor(orig&&orig.status,f.status,edited),
  };
}

// ── buildBooking: the new-booking form's Save, as a plan ─────────────────────
// v18.3.4: `doSaveNew`'s decisions, as `applyEdit` holds the edit's. `input`:
//   list           the bookings (App's state: a new booking clears no seat)
//   draft          the form as `doSave` validated it
//   blocks, swap, autoOptimizer, phonePrefix, getUser
//                  as for `applyEdit`
//
// Returns `{ refusal: { message } }`, or `{ next, fin, id, rule, flash }`:
//   next   the write, a replayable `prev → next` transform memoised by `prev`:
//          the booking added, a Book Again source's history entry, a joined
//          guest's seed stamped
//   fin    `next(list)`
//   id     the new booking's id, minted once, so a replay cannot add it twice
//   rule   the standing rule "Repeat weekly" creates, or null. App writes it
//          after the refusals and before the booking (v18.3.3): a refused save
//          leaves no rule behind
//   flash  `{ kind, note }` for the save toast
export function buildBooking(input){
  const f=input.draft,bookings=input.list;
  const tableBlocks=input.blocks,swapAffected=input.swap,autoOptimizer=input.autoOptimizer,getUser=input.getUser;
  const size=Number(f.size)||2;
  const dur=f.customDur||getDur(size);
  const cleanPhone=enteredPhone(f.phone,input.phonePrefix);
  const mt=Array.isArray(f.manualTables)&&f.manualTables.length>0?f.manualTables:[];
  const newId=genId();
  // v14: Book Again flow. When f.returnOf is set, the new booking links
  // back to its source, gets a distinctive "created via Book Again" entry
  // in its own history, and the ORIGINAL booking gets a matching entry
  // indicating the customer re-booked.
  // v14 p1: history references source.scheduledTime (the confirmed time)
  // rather than source.time, so "created via Book Again (from X on YYYY-MM-DD
  // at 20:30)" stays accurate even if the source was seated-shifted to 20:15.
  const returnOfId=f.returnOf||null;
  const source=returnOfId?bookings.find(function(b){return b.id===returnOfId;}):null;
  const sourceSchedTime=source?(source.scheduledTime||source.time):"";
  const createHist=source?histEntry("created via Book Again (from "+source.name+" on "+source.date+" at "+sourceSchedTime+")",getUser()):histEntry("created",getUser());
  // v16.3.0: "Repeat weekly" — create a standing-booking rule from these
  // fields (weekday from the booking date, UTC) and stamp THIS first
  // occurrence with the rule's id + date so the generator dedupes it. Done
  // once here (outside buildNext) so a retry replay never makes a 2nd rule.
  // v18.3.3: only the rule's ID is minted here. The rule itself is written
  // after the capacity refusals (App, from `rule`): it was written HERE, so a
  // save refused with "Could not assign a table" left the rule behind, the
  // generator then created the very booking the form had refused (with no
  // table), and every further tap on Save added another rule. Measured on
  // DEV: one refused save, then Confirm on the "Kitchen may be busy" its
  // generated booking raised, gave two rules and a table-less booking.
  const recStampId=(f.repeatWeekly&&f.name&&f.name.trim()&&f.date&&f.time)?genId():null;
  // v14 p1: scheduledTime=f.time on creation. v17.0.0: new bookings start
  // confirmed, OR pending via the "Save pending" button (status override).
  const nb={id:newId,name:f.name,phone:cleanPhone,date:f.date,time:f.time,scheduledTime:f.time,size:size,duration:dur,originalDuration:dur,preference:f.preference,notes:f.notes,deposit:Math.max(0,Number(f.deposit)||0),voucherCode:normalizeCode(f.voucherCode),status:(f.status==="pending"?"pending":"confirmed"),tables:mt.length?mt:[],customDur:f.customDur||null,_manual:mt.length>0,_locked:mt.length>0,preferredTables:Array.isArray(f.preferredTables)?f.preferredTables:[],returnOf:returnOfId,recurringId:recStampId,recurringDate:recStampId?f.date:null,guestId:f.guestId||null,history:[createHist]};
  // v15.7.0: build the next state as a PURE transform of `prev` (see
  // `applyEdit`) so the new-booking save joins the optimistic-show +
  // auto-retry path. `newId`/`nb` are computed once (stable id) → a
  // held/rejected write replayed on fresh data can never duplicate the
  // booking (the defensive filter below also drops any stray match before
  // re-adding it).
  function applyBase(prev){
    let base=stampGuestSeed(prev,f).filter(function(b){return b.id!==newId;});
    if(swapAffected){base=base.map(function(b){return releaseSwapped(b,swapAffected);});}
    // If this is a Book Again creation, append a back-reference entry to the
    // source booking's history (purely informational — no status/table change).
    if(source){
      base=base.map(function(b){
        if(b.id!==returnOfId) return b;
        return Object.assign({},b,{history:(b.history||[]).concat([histEntry("Book Again → new booking on "+f.date+" at "+f.time,getUser())])});
      });
    }
    return base;
  }
  // v17.16.6 (CT-2B-08): the guest id is resolved against `prev` HERE rather
  // than baked into `nb` above, because `nb` is built once at Save time while
  // this runs again on every replay. The draft's id was minted when the name
  // was picked; if the seed has been joined since — by another device, through
  // a different booking of the same guest — adopting the seed's id is what
  // keeps the two in one group. See `resolveGuestId` for why the seed wins.
  // `newId` is untouched, so the stable-id property the comment above relies
  // on is unaffected.
  function buildNext(prev){return bookingsAfterAction(applyBase(prev).concat([Object.assign({},nb,{guestId:resolveGuestId(prev,f)})]),f.date,tableBlocks,newId,!mt.length,autoOptimizer);}
  // /code-review perf: prev-identity memo — one optimiser pass shared by
  // the guard check + the immediate dispatch (see `applyEdit`).
  const buildNextMemo=memoByPrev(buildNext);
  const base=applyBase(bookings);
  const fin=buildNextMemo(bookings);
  if(!mt.length){
    const ne=fin.find(function(b){return b.id===newId;});
    if(!ne||(ne.tables||[]).length===0) return refuse("Could not assign a table — try manual assignment.");
    const kicked=displacedBy(base,fin,f.date,newId);
    if(kicked.length>0) return refuse(displaceRefusal("adding this booking",kicked));
  }
  // v18.3.1: seated outside its zone, the toast says so (offZoneNote);
  // not for hand-picked tables (/code-review), as in the edit path.
  const placedNew=fin.find(function(b){return b.id===newId;});
  return {
    next:buildNextMemo,
    fin:fin,
    id:newId,
    rule:recStampId?{id:recStampId,startDate:f.date,name:f.name,phone:cleanPhone,size:size,weekday:new Date(f.date).getUTCDay(),time:f.time,preference:f.preference,notes:f.notes}:null,
    flash:{kind:null,note:!mt.length&&placedNew?offZoneNote(placedNew):""},
  };
}

// ── walkinBooking: the record the walk-in form's Seat writes ─────────────────
// v18.3.4: `useWalkin`'s `doSaveWalkin` built it inline, and keeps everything
// around it: the commit-once guard, the closing-time and no-table refusals, the
// write and the close. A walk-in is a party already at its tables: seated,
// placed by hand (`_manual`) and never moved by the optimiser (`_locked`).
//   form   the walk-in draft; an empty `time` means now
//   num    the day's next walk-in number (`getNextWalkinNum`)
//   date   today
//   user   who seated it, for the history entry
// It writes fewer keys than a stored booking has; a read fills the rest
// (`sanitize`).
export function walkinBooking(form,num,date,user){
  const t=form.time||nowTime();const size=Number(form.size)||2;const dur=form.customDur||getDur(size);
  return {id:genId(),name:"Walk-in "+num,phone:"",date:date,time:t,scheduledTime:t,size:size,duration:dur,originalDuration:dur,preference:"auto",notes:form.notes||"",status:"seated",tables:form.tables,customDur:form.customDur||null,_manual:true,_locked:true,history:[histEntry("walk-in created",user)]};
}

// ── occurrenceBooking: the record the weekly generator writes ────────────────
// v18.3.4: App's generator effect built it inline, for one occurrence of a
// standing rule (`recurring`) on `date`; the effect keeps which ones are due
// (`dueOccurrences`), the existence check and the optimiser pass that places
// it (`tables: []` until then). Confirmed, and written by "auto".
//
// The id is DETERMINISTIC, "r" + rule id + "_" + date, and the booking is
// stamped with the rule and the date: two devices generating at once write the
// same id, so the per-$id CAS turns the second create away, and the stamps are
// how the generator knows the week is done (CLAUDE.md's row on recurring ids).
// Never make it random. `ruleStart` (lib/recurring.js) tells the form's own
// first booking from the generator's by this id.
export function occurrenceBooking(rule,date){
  const dur=getDur(rule.size);
  return {id:"r"+rule.id+"_"+date,name:rule.name,phone:rule.phone,date:date,time:rule.time,scheduledTime:rule.time,size:rule.size,duration:dur,originalDuration:dur,preference:rule.preference,notes:rule.notes,status:"confirmed",tables:[],customDur:null,deposit:0,voucherCode:"",_manual:false,_locked:false,_conflict:false,preferredTables:[],returnOf:null,recurringId:rule.id,recurringDate:date,history:[histEntry("auto-created from weekly rule","auto")]};
}

// ── keptRefusal: what Save will say about tables it keeps, asked BEFORE Save ──
// v18.3.3: the form previewed a kept booking's tables as fine (`tablesKept`),
// and Save then refused them when a locked or seated party, or a table block,
// held one in the new window: `handKeptRefusal` for a booking placed by hand,
// the locked-clash refusal for one saved as seated. The preview and the save
// disagreeing is the defect `tablesKept` was written to end (v18.3.2's
// /code-review left this half on the ROADMAP).
//
// This is the save's question asked of the day as it stands, with the draft's
// window applied to the booking and its tables kept. No optimiser pass: the
// save's pass moves neither a locked party nor a block, which are the only
// things these refusals name, so they read the same before it as after it. A
// hand-kept booking is asked only when the window moved (`recheck` in
// `applyEdit`); a seated one always, as `applyEdit` asks it. Seating a booking
// (it was not seated) is left out: the seat-clash prompt asks about that table
// before any save. So is a seated booking moved to another date: Save refuses
// that first, on the Date field.
//
// v18.3.4: moved here from booking-logic.js, and the window is the save's own
// (`editWindow`): the length, the un-seat's restored start and the revival were
// a copy of `doSaveEdit`'s, the ninth copy of a booking's fields ROADMAP #13
// counted. The moved test is `recheck` less its Clear term: a hand-kept draft
// has changed nothing else `needsR` reads (`keepsHandTables`), and a Clear is
// never kept, so the form, which asks only when `tablesKept`, never asks one.
// The function answers as it did for every draft.
export function keptRefusal(list,orig,draft,blocks){
  if(!orig||!draft) return null;
  const hand=keepsHandTables(orig,draft);
  const seated=draft.status==="seated"&&orig.status==="seated"&&draft.date===orig.date;
  if(!hand&&!seated) return null;
  const w=editWindow(orig,draft);
  if(hand&&!(draft.time!==orig.time||w.planChanged||w.revived||!!w.unseat)) return null;
  const day=(list||[]).map(function(b){
    return b.id===orig.id?Object.assign({},b,{time:w.time,duration:w.duration,status:draft.status,tables:orig.tables}):b;
  });
  if(hand) return handKeptRefusal(day,draft.date,orig.id,blocks);
  // v18.3.3 (/code-review): a seated party that has outgrown its tables is
  // refused before its clashes, in `applyEdit`'s order. Left out, a party of 2
  // edited to 6 previewed table 3 as fine and Save refused it.
  const fit=seatedFitRefusal(w.size,orig.tables);
  if(fit) return fit;
  const locked=pinnedClashParties(day,draft.date,orig.id).locked;
  return locked.length?pinnedClashRefusal(locked[0]):null;
}
