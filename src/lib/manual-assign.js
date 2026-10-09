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
import { bookingsAfterAction, histEntry as defaultHistEntry, isLocked, toMins, findFreeSlot } from "./booking-logic.js";
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

// ── planReassign: the Overlap banner's Reassign (v18.5.1, ROADMAP #17) ───────
// MOVED out of BookingApp's `reassignBooking`, statement for statement. App
// keeps `setError`, the write (with the deleted-elsewhere report) and the flash.
//
//   planReassign(ctx) → { refuse: "…" } | { transform }
//   ctx: {id, bookings, liveBookings, tableBlocks, getUser, stamp?}
//
// Reassign a single booking to a different set of tables without touching any
// other booking. Used by the overlap warning's Reassign button when Optimizer
// is OFF and staff need a quick escape hatch for a booking about to be crowded
// out by an overstaying guest. Skips locked bookings (manual intent preserved).
// v14: feeds liveBookings into findFreeSlot so already-overstaying seated
// guests' tables are correctly treated as occupied.
// v14 p1 (Issue 1 fix): ALSO transiently extends the duration of any seated
// booking that is about to overstay onto the target's window. Without this, a
// seated booking ending in e.g. 9 min is not yet "overstaying" per
// syncLiveDurations — its tables would falsely read as free at target.time,
// and findFreeSlot would return the same tables the target already has. The
// extension is for this one lookup; nothing stored changes.
//
// `getUser` is asked only once there is something to write, as it was.
export function planReassign(ctx){
  const id=ctx.id,bookings=ctx.bookings,liveBookings=ctx.liveBookings,tableBlocks=ctx.tableBlocks;
  const histEntry=ctx.stamp||defaultHistEntry;
  const target=bookings.find(function(b){return b.id===id;});
  if(!target) return {refuse:"Booking not found."};
  if(isLocked(target)) return {refuse:"Booking is manually locked. Edit manually to change tables."};
  const targetStart=toMins(target.time);
  const targetEnd=targetStart+(target.duration||90);
  // Build a search-view where any seated booking sharing tables with THIS
  // target whose scheduled end is before the target's END is stretched to cover
  // the target fully. That guarantees findFreeSlot treats their tables as busy.
  const searchView=liveBookings.map(function(b){
    if(b.id===target.id) return b;
    if(b.status!=="seated") return b;
    if(b.date!==target.date) return b;
    const tables=b.tables||[];
    const sharesTable=tables.some(function(t){return (target.tables||[]).includes(t);});
    if(!sharesTable) return b;
    const bs=toMins(b.time);
    const be=bs+(b.duration||90);
    // Only extend if the seated booking ends before target's END (i.e., it could
    // plausibly overlap or free up within target's window). If it already runs
    // past target end, syncLiveDurations handled it.
    if(be>=targetEnd) return b;
    // Extend to cover target fully so findFreeSlot never considers these tables.
    const extendedDur=targetEnd-bs;
    return Object.assign({},b,{duration:extendedDur});
  });
  const tables=findFreeSlot(searchView,target.date,target.time,target.size||2,target.preference||"auto",target.duration||90,tableBlocks,id,target.preferredTables);
  if(!tables||!tables.length) return {refuse:"No alternative tables available for "+target.name+" at "+target.time+"."};
  // Sanity: if findFreeSlot returned the same tables (possible if the algorithm
  // found a valid-but-unchanged assignment), surface it as a no-op rather than
  // silently "succeeding" with nothing changed.
  const curKey=(target.tables||[]).slice().sort().join("|");
  const newKey=tables.slice().sort().join("|");
  if(curKey===newKey) return {refuse:"No alternative tables available for "+target.name+" at "+target.time+"."};
  const prevTables=(target.tables||[]).join("+")||"none";
  const user=ctx.getUser();
  return {transform:function(prev){return prev.map(function(b){
    if(b.id!==id) return b;
    return Object.assign({},b,{tables:tables,_manual:false,_conflict:false,history:(b.history||[]).concat([histEntry("reassigned "+prevTables+" → "+tables.join("+"),user)])});
  });}};
}

