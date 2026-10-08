// ── status-change — what a status tap does (v18.5.0, ROADMAP #17) ────────────
// MOVED out of BookingApp's `updateStatus`, `doCancelBooking` and
// `seatAfterClearing`, statement for statement. App keeps the capability gate,
// the two "asked" refs, the modal setters and every side effect (the write,
// the toast, the seat note, the undo, the WhatsApp cancel hook); this file
// keeps the decisions, so a test can reach them.
//
//   planStatus(ctx) → one of
//     { confirmCancel: true }   "cancelled" goes to the cancel confirm
//     { voucherAsk }            stop and ask whether to redeem (the modal's payload)
//     { voucherBack }           stop and ask whether to restore a redemption
//     { refuse }                the toast, nothing written
//     { seatClash }             somebody is still seated at the table
//     { transform, flashes, flashKind, seatNote }
//
//   planCancel(ctx) → { voucherBack } or { transform }
//
//   completeCleared(ctx) → the transform that completes the parties a seat
//     is clearing off its table
//
// The exits are in the order `updateStatus` asked them, which is the design:
// both money questions come before the seat checks, so a seat note or a clash
// prompt can never open beside a money prompt, and "there is no table" is
// refused before "somebody is at the table" is asked.
//
// Each `transform` is a function of the list, as before: `saveBookings` hands
// it the fresh `prev`, so a write parked by the stale gate replays on fresh
// data. `planCancel`'s is memoised by `prev` identity (`memoByPrev`), because
// App runs it once for the undo delta and `saveBookings` runs it again.
//
// `ctx.getUser` is a FUNCTION and is asked where the old code asked it: after
// every gate, once, on the path that writes. `ctx.now` is the wall clock
// `planStatus` reads a voucher's expiry against; `ctx.nowMins` and `ctx.today`
// are App's.
//
// `stamp(action, user)` builds a history entry. App passes nothing and gets
// `histEntry`; a test passes its own so the result has no clock in it.
import {
  bookingsAfterAction, histEntry as defaultHistEntry,
  seatRefusal, seatClashParties, seatNoteFor,
  seatedElapsed, unseatRestore, applySeatedShift, completedSeatedPatch
} from "./booking-logic.js";
import { memoByPrev } from "./booking-save.js";
import { guestTagMap, bookingTags } from "./customers.js";
import { voucherDue, voucherReturnDue } from "./vouchers.js";

// ── v18.0.0 session 8 (C3): the seat-clash prompt's snapshot ─────────────────
// The modal renders what was true when the seat was refused, so a booking
// completed on another device in those seconds cannot blank the question.
// Both seating doors build it here: `planStatus` and the form's save in App.
export function seatClashSnap(parties){
  return parties.map(function(e){return {id:e.booking.id,name:e.booking.name||"",time:e.booking.time||"",tables:e.tables};});
}

export function planStatus(ctx){
  const id=ctx.id,status=ctx.status,bookings=ctx.bookings,viewDate=ctx.viewDate,today=ctx.today;
  const tableBlocks=ctx.tableBlocks,autoOptimizer=ctx.autoOptimizer;
  const histEntry=ctx.stamp||defaultHistEntry;
  const src={bookings:bookings,vouchersByCode:ctx.vouchersByCode,vouchersOn:ctx.vouchersOn,now:ctx.now};
  if(status==="cancelled") return {confirmCancel:true};
  // v18.0.0: stop and ask before the status lands. `updateStatus` is the one
  // funnel for the popup, the List buttons and the S/C shortcuts, so gating
  // here covers all three — the same property that made it one of the two
  // hook points rather than four.
  if(!ctx.redeemAsked&&voucherDue(src,id,status)) return {voucherAsk:{id:id,status:status,from:"status"}};
  if(!ctx.redeemAsked&&voucherReturnDue(src,id,status)) return {voucherBack:{id:id,status:status,from:"status"}};
  // v18.0.0 session 7: the seat note, at this door. Taken from the booking as
  // it stands BEFORE the write (a seat moves no tables) and raised after it —
  // past both voucher gates above, so it can never open beside a money prompt,
  // only after one has been answered. Not gated on `ok`: a write held by the
  // stale gate still shows the seat, and the party is sitting down either way.
  const seatCur=bookings.find(function(x){return x.id===id;});
  // v18.0.0 session 8 (C2): this door covers the quick-status popup, the List
  // card's button and the S key — all three call here — so one check answers
  // for all of them. A refusal TOAST rather than a disabled button or a
  // silent return: the fix is one tap away in Assign, and a button that does
  // nothing is the worst of the three answers.
  if(status==="seated"&&seatCur&&seatCur.status!=="seated"){
    const noTable=seatRefusal(seatCur);
    if(noTable) return {refuse:noTable};
    // C3, at the same door. After the refusal above, because "there is no
    // table" and "somebody is at the table" are different sentences and the
    // first has no question in it.
    if(!ctx.seatAsked){
      const parties=seatClashParties(seatCur.tables,seatCur.date,id,bookings);
      if(parties.length) return {seatClash:{id:id,status:status,from:"status",others:seatClashSnap(parties)}};
    }
  }
  // v18.5.0: with its tags (`ctx.tagList`), read only when this tap seats.
  const seatSnap=seatNoteFor(seatCur&&seatCur.status,status,seatCur,(status==="seated"&&seatCur&&seatCur.status!=="seated")?bookingTags(seatCur,guestTagMap(ctx.bookings),ctx.tagList):null);
  const user=ctx.getUser();
  const nowM=ctx.nowMins;
  return {transform:function(b){
    const target=b.find(function(x){return x.id===id;});
    const d=target?target.date:viewDate;
    // v14: detect confirmed → seated transition (for any prior non-seated status).
    // If the transition triggers a seated-shift, force no-reshuffle by passing
    // autoOptimizerState=false to bookingsAfterAction, so other bookings never
    // move as a side-effect of someone sitting down early/late.
    const updated=b.map(function(x){
      if(x.id!==id) return x;
      const histEntries=[histEntry("status → "+status,user)];
      const extra={status:status};
      // v16.2.0: only a real SEATED visit gets its duration truncated to the
      // actual span (now − start). A direct Confirmed → Completed keeps the
      // scheduled duration unchanged — otherwise the block balloons to hours
      // on the timeline (e.g. completing a 13:00 booking at 21:00 → 8h block).
      if(status==="completed"&&x.status==="seated"){
        // v17.16.2 (CT-2B-02): `nowM - toMins(x.time)` mixed axes. A party
        // seated before midnight and completed after it recorded 15 minutes.
        const actualDur=Math.max(15,seatedElapsed(x,today,nowM));
        extra.duration=actualDur;
        extra.customDur=actualDur;
        // v17.6.0: stamp the real stay so the List card can show it after the
        // visit (booking-logic's stayedMins). Only a genuine seated→completed
        // transition reaches here, which is exactly the gate the tag needs.
        extra.stayedMin=actualDur;
      }
      // v18.0.0 session 8 (C1): the other door out of seated. Same restore as
      // the form's — one helper, so the popup, the List card and the S key
      // cannot disagree with Save about what a booking goes back to.
      if((status==="confirmed"||status==="pending")&&x.status==="seated"){
        const back=unseatRestore(x,x.size);
        if(back){
          extra.time=back.time;
          extra.duration=back.duration;
          extra.originalDuration=back.originalDuration;
          extra.customDur=back.customDur;
          histEntries.push(histEntry("un-seated: time restored "+x.time+" → "+back.time+", length "+(x.duration||0)+" → "+back.duration+" min",user));
        }
      }
      if(status==="seated"&&x.status!=="seated"){
        const shift=applySeatedShift(x,nowM,b,today);
        if(shift){
          extra.time=shift.newTime;
          extra.duration=shift.newDuration;
          extra.originalDuration=shift.newDuration;
          extra.customDur=shift.newDuration;
          // scheduledTime is intentionally NOT updated here — it stays pinned to
          // the confirmed time so Book Again and history reads show the true plan.
          histEntries.push(histEntry("seated "+shift.direction+": time adjusted "+shift.oldTime+" → "+shift.newTime,user));
        }
      }
      extra.history=(x.history||[]).concat(histEntries);
      return Object.assign({},x,extra);
    });
    // Seated transitions never reshuffle others — even when optimizer is ON.
    const optState=(status==="seated")?false:autoOptimizer;
    return bookingsAfterAction(updated,d,tableBlocks,null,false,optState);
  },
  // C8: a seat never reshuffles (`optState` above), so its toast says "saved".
  flashes:status==="completed"||status==="seated",
  flashKind:status==="seated"?"saved":null,
  seatNote:seatSnap};
}

export function planCancel(ctx){
  const id=ctx.id,noShow=ctx.noShow,viewDate=ctx.viewDate;
  const tableBlocks=ctx.tableBlocks,autoOptimizer=ctx.autoOptimizer;
  const histEntry=ctx.stamp||defaultHistEntry;
  // /code-review v18.0.0 phase 6: THE CANCEL FUNNEL. `updateStatus` returns
  // early for "cancelled" into the cancel confirm, so neither of that
  // function's gates nor `doSave`'s ever sees this path — cancelling a
  // completed booking from the popup or the List card kept its redemption
  // silently, while the identical change made in the edit form asked. One
  // action, two routes, two behaviours.
  // No clock: a walk-back asks whether money was TAKEN, never whether the
  // voucher is still open, so `planCancel` takes no `now`.
  if(!ctx.redeemAsked&&voucherReturnDue({bookings:ctx.bookings,vouchersByCode:ctx.vouchersByCode,vouchersOn:ctx.vouchersOn},id,"cancelled")){
    return {voucherBack:{id:id,status:"cancelled",noShow:!!noShow,from:"cancel"}};
  }
  const user=ctx.getUser();
  // v16.3.0: the whole pre-cancel booking is what the undo toast restores
  // (status/noShow/notes/tables); App takes that snapshot from this transform's
  // result on its own `bookings`.
  function cancelTransform(b){const target=b.find(function(x){return x.id===id;});const d=target?target.date:viewDate;const updated=b.map(function(x){if(x.id!==id) return x;const extra={status:"cancelled",history:(x.history||[]).concat([histEntry(noShow?"no show":"cancelled",user)])};if(noShow) extra.noShow=true;return Object.assign({},x,extra);});return bookingsAfterAction(updated,d,tableBlocks,null,false,autoOptimizer);}
  // v17.4.0: prev-identity memo (the doSave pattern) so the delta computed for
  // undo and the dispatched write share ONE optimizer pass.
  return {transform:memoByPrev(cancelTransform)};
}

// One write for the parties leaving a table somebody else is being seated at.
// `completedSeatedPatch` is the same arithmetic `planStatus` applies to a
// seated → completed tap, from one place, so the two cannot disagree about how
// long a visit lasted.
//
// A cleared party carrying a voucher lands UNSETTLED rather than raising the
// redeem prompt in the middle of somebody else being seated. That is a state
// the app defines, detects and shows in the strip — the close-time
// auto-complete produces it for the same reason — and it is the honest
// trade: the question gets asked, later, by the section that exists for it.
export function completeCleared(ctx){
  const ids=ctx.ids,today=ctx.today,nowM=ctx.nowM,user=ctx.user;
  const histEntry=ctx.stamp||defaultHistEntry;
  return function(prev){
    return prev.map(function(b){
      if(ids.indexOf(b.id)<0||b.status!=="seated") return b;
      return Object.assign({},b,completedSeatedPatch(b,today,nowM),
        {history:(b.history||[]).concat([histEntry("status → completed (table cleared to seat another party)",user)])});
    });
  };
}
