// ── manual-assign — what the table picker's Save writes (v18.4.7, ROADMAP #17) ─
// MOVED out of BookingApp's `manualAssign`, statement for statement. App keeps
// the three side effects (`saveBookings`, closing the picker, the reshuffle
// flash) and this file keeps the decision, so a test can reach it.
//
//   planAssign(ctx) → { transform, reshuffles }
//
// `transform` is a function of the list, as before: `saveBookings` hands it the
// fresh `prev`, so a write parked by the stale gate replays on fresh data.
// `reshuffles` is true when the picker's Swap took tables from another party,
// which is when the day is re-optimised and App flashes.
//
// `locked` is written as `locked===true` and nothing else. The picker passes the
// literal true every time, and `_manual` implying `_locked` is what keeps the
// form's two previews agreeing (tests/booking-logic.test.js pins both halves).
//
// The re-optimise runs on `viewDate`, the day on screen, as it always has —
// not on the booking's own date. v18.4.9: and then on the day of any party the
// Swap took tables from, when that is another day. The picker finds those
// parties on the BOOKING's date, so a booking opened from another day released
// a party that no pass seated again (measured on DEV: stored with no table).
//
// `swapSlot` / `liveSwap` (v18.4.9) tie a Swap held in the booking form to the
// slot it was picked for. The form keeps the parties to release until Save; a
// draft whose date, time, size or duration moved since the pick is no longer
// asking for those tables at that time, so the swap is dropped and Save's own
// clash check answers for the tables instead.
//
// `stamp(action, user)` builds a history entry. App passes nothing and gets
// `histEntry`; a test passes its own so the result has no clock in it.
import { bookingsAfterAction, histEntry as defaultHistEntry } from "./booking-logic.js";
import { releaseSwapped } from "./booking-save.js";
import { getDur } from "./booking-fields.js";

export function swapSlot(f){
  const size=Number(f&&f.size)||2;
  return [f&&f.date,f&&f.time,size,(f&&f.customDur)||getDur(size)].join("|");
}
export function liveSwap(affected,slot,f){
  if(!affected||!affected.length) return null;
  return slot===swapSlot(f)?affected:null;
}

export function planAssign(ctx){
  const bookingId=ctx.bookingId,tables=ctx.tables,locked=ctx.locked,affected=ctx.affected;
  const viewDate=ctx.viewDate,tableBlocks=ctx.tableBlocks,autoOptimizer=ctx.autoOptimizer,user=ctx.user;
  const histEntry=ctx.stamp||defaultHistEntry;
  return {transform:function(b){
    const updated=b.map(function(x){
      if(x.id===bookingId) return Object.assign({},x,{tables:tables,_conflict:false,_manual:true,_locked:locked===true,history:(x.history||[]).concat([histEntry("tables manually assigned: "+tables.join(", "),user)])});
      // If swapping, strip taken tables from affected bookings and unlock them for re-optimization
      // (`releaseSwapped`, lib/booking-save.js, which the form's two saves share).
      if(affected&&affected.length>0) return releaseSwapped(x,affected);
      return x;
    });
    // Re-optimize to reassign affected bookings to new tables (when optimizer active)
    if(affected&&affected.length>0){
      let out=bookingsAfterAction(updated,viewDate,tableBlocks,null,false,autoOptimizer);
      const seen=[viewDate];
      updated.forEach(function(x){
        if(seen.indexOf(x.date)>=0||!affected.some(function(a){return a.id===x.id;})) return;
        seen.push(x.date);
        out=bookingsAfterAction(out,x.date,tableBlocks,null,false,autoOptimizer);
      });
      return out;
    }
    return updated;
  },reshuffles:!!(affected&&affected.length>0)};
}
