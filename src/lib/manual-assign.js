// ── manual-assign — what the table picker's Save writes (v18.4.7, ROADMAP #17) ─
// MOVED out of BookingApp's `manualAssign`, statement for statement. App keeps
// the three side effects (`saveBookings`, closing the picker, the reshuffle
// flash) and this file keeps the decision, so a test can reach it.
//
//   planAssign(ctx) → { transform, reshuffles, done }
//
// `transform` is a function of the list, as before: `saveBookings` hands it the
// fresh `prev`, so a write parked by the stale gate replays on fresh data.
// `reshuffles` is true when the picker's Swap took tables from another party,
// which is when the day is re-optimised and App flashes.
// `done` (v18.14.0, H5) is the sentence the Undo pill carries, in the words a
// timeline drop uses; `ctx.bookings` is only read for the names in it.
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
import { bookingsAfterAction, optimizerActiveFor, histEntry as defaultHistEntry, toMins, findFreeSlot, applyOpt, syncLiveDurations, unlockOffered } from "./booking-logic.js";
import { releaseSwapped, memoByPrev, displacedBy, displaceRefusal } from "./booking-save.js";
import { getDur } from "./booking-fields.js";
import { moveSentence } from "./delete-undo.js";

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
  const nameOf=function(id){const hit=(ctx.bookings||[]).find(function(x){return x.id===id;});return hit?hit.name:"";};
  // v18.14.2: finished when the write lands, as a drop's is (lib/drop-plan.js).
  const lead=nameOf(bookingId)+" moved to "+tables.join("+");
  const done=moveSentence(lead,(affected||[]).map(function(a){return nameOf(a.id);}).filter(Boolean));
  return {done:done,lead:lead,moved:affected,transform:function(b){
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
// out by an overstaying guest. Refuses a seated party; a locked one is moved and
// stays locked on its new tables (v18.17.0, C).
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
  // v18.17.0 (C): only a SEATED party is refused. A `_locked` one (a drag, an
  // Assign) is moved and keeps its lock on the new tables (Patryk, 2026-11-12):
  // somebody placed it on purpose, and the rescue changes the table, not that.
  // (K): the refusal says why, in Unlock's words. It said "Booking is manually
  // locked. Edit manually to change tables.", the reason before C.
  if(target.status==="seated") return {refuse:seatedStays(target)};
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
    // (C): the lock is read off the row being written, not the plan's snapshot,
    // so a lock taken off on another device before a replay is not put back.
    const keep=b._locked===true;
    return Object.assign({},b,{tables:tables,_manual:keep?b._manual:false,_conflict:false,history:(b.history||[]).concat([histEntry("reassigned "+prevTables+" → "+tables.join("+"),user)])});
  });}};
}

// ── planReshuffle: the Reshuffle button (v18.17.0) ───────────────────────────
// A full optimiser pass over the day on screen, whatever the Optimiser switch
// says: that is what the button is for, and it is only offered while the switch
// is off.
//
//   planReshuffle(ctx) → { refuse } | { transform, done }
//   ctx: {viewDate, tableBlocks, today, nowMins, unlock?, bookings?, user?, stamp?}
//
// It was `applyOpt(list, viewDate, tableBlocks)` written out in App, the one
// path to the optimiser that did not go through `syncLiveDurations` first. A
// seated party past its booked end still holds its table, its stored end says it
// left, and the pass could seat the next party there. The button shows during
// service, which is when somebody is running over.
//
// `unlock: true` is "Reshuffle and unlock N": every booking of the day that
// Unlock is offered for (`unlockOffered`: locked, confirmed or pending) is
// handed back first, so the pass may move it. A plain Reshuffle keeps every
// lock, as it always has. Seated parties are never unlocked: the optimiser
// holds them by their status, with no flag to clear. `lockedOn` is the N, and
// `done` says it (`ctx.bookings` is read only for that count).
export function lockedOn(list,date){
  return (list||[]).filter(function(b){return !!b&&b.date===date&&unlockOffered(b);}).length;
}
export function planReshuffle(ctx){
  const viewDate=ctx.viewDate,tableBlocks=ctx.tableBlocks,today=ctx.today,nowMins=ctx.nowMins,user=ctx.user;
  const unlock=ctx.unlock===true;
  const histEntry=ctx.stamp||defaultHistEntry;
  const n=unlock?lockedOn(ctx.bookings,viewDate):0;
  // /code-review: `kicked` is who the UNLOCKING pass leaves without a table that
  // had one (`displacedBy`, the saves' own question). A lock can hold a party
  // where the optimiser would never put it (five at a two-top, tables joined by
  // hand), and on a full evening the freed party then takes a set from somebody
  // else, or gets none: measured, a party of two lost its table to an unlocked
  // five while the pill read "Tables re-optimised, 1 unlocked.". A plain
  // Reshuffle keeps the locks and is not asked this.
  const run=memoByPrev(function(list){
    const synced=syncLiveDurations(list,today,nowMins);
    if(!unlock) return {out:applyOpt(synced,viewDate,tableBlocks),kicked:[]};
    const base=synced.map(function(b){
      if(!b||b.date!==viewDate||!unlockOffered(b)) return b;
      return Object.assign({},releaseSwapped(b,[{id:b.id,tables:[]}]),{history:(b.history||[]).concat([histEntry("unlocked by Reshuffle",user)])});
    });
    const out=applyOpt(base,viewDate,tableBlocks);
    return {out:out,kicked:displacedBy(synced,out,viewDate,null)};
  });
  // Refused at the press, in the saves' sentence. The transform asks again, for
  // a replay on a day that has changed since: it then writes nothing.
  if(unlock&&ctx.bookings){
    const kicked=run(ctx.bookings).kicked;
    if(kicked.length) return {refuse:displaceRefusal("unlocking",kicked)};
  }
  return {done:n>0?"Tables re-optimised, "+n+" unlocked.":"Tables re-optimised.",transform:function(list){
    const r=run(list);
    return r.kicked.length?list:r.out;
  }};
}

// (K): one sentence for the two actions a seated party refuses, Reassign and
// Unlock, so they cannot drift apart.
function seatedStays(b){return b.name+" is seated — a seated party stays at its table.";}

// ── planUnlock: the lock comes off (v18.17.0) ────────────────────────────────
// Every table drag, every Assign and every walk-in locks a booking to its
// tables, and nothing took a lock off except being displaced by somebody else's
// drag, or the edit form's Clear on the Tables row. Locks only accumulated, and
// each one is a table the optimiser has to work around.
//
//   planUnlock(ctx) → { refuse } | { transform, done, lead, replayRefusal }
//   ctx: {id, bookings, tableBlocks, autoOptimizer, user, stamp?}
//
// The booking loses `_locked` and `_manual`, and its own day goes through
// `bookingsAfterAction`: on a day the optimiser owns it is placed again at once
// (that is what handing it back means), and with the Optimiser off it stays
// where it is, unlocked for the next Reshuffle. Its day, not the day on screen:
// the List opens this card on bookings of the viewed day only, but the plan
// should not depend on that.
//
// `done` is known now, from a trial on `ctx.bookings`, as a drop's is.
export function planUnlock(ctx){
  const id=ctx.id,tableBlocks=ctx.tableBlocks,autoOptimizer=ctx.autoOptimizer,user=ctx.user;
  const histEntry=ctx.stamp||defaultHistEntry;
  const target=(ctx.bookings||[]).find(function(b){return b.id===id;});
  if(!target) return {refuse:"Booking not found."};
  if(target.status==="seated") return {refuse:seatedStays(target)};
  if(!unlockOffered(target)) return {refuse:target.name+" is not locked."};
  const date=target.date;
  // (I): on a day the Optimiser owns, the booking hands its tables back too, or
  // the pass (which keeps every placed party whose tables still suit it) would
  // leave it where the lock put it. With the Optimiser off it keeps them.
  const handBack=optimizerActiveFor(date,autoOptimizer);
  // /code-review, two questions asked of the list being WRITTEN, not the plan's
  // snapshot (a held write replays on a fresh list, as Reassign's lock is read
  // off the row, C):
  //   - the booking is still one Unlock is offered for. Replayed over a booking
  //     another device had seated meanwhile, this handed a SEATED party's tables
  //     back and the pass, which never places a seated party, left it with none
  //     (measured); a completed one lost its record the same way.
  //   - nobody loses a table by it (`displacedBy`, the saves' own question). A
  //     lock can hold a party where the optimiser would never put it (five at a
  //     two-top, tables joined by hand); handed back on a full evening it got no
  //     table and the toast said only "unlocked" (measured). Asked only where
  //     the tables are handed back: with the Optimiser off nothing moves.
  // Either way the list comes back as it was, the same array, and nothing is written.
  const trial=memoByPrev(function(list){
    const cur=list.find(function(b){return b.id===id;});
    if(!cur||!unlockOffered(cur)) return {out:list,kicked:[]};
    const updated=list.map(function(b){
      if(b.id!==id) return b;
      // `releaseSwapped`: the booking comes back unlocked and not hand-placed,
      // the one way this app writes that, keeping every table it is not handing back.
      return Object.assign({},releaseSwapped(b,[{id:id,tables:handBack?(b.tables||[]):[]}]),{history:(b.history||[]).concat([histEntry("unlocked: the optimiser may move it",user)])});
    });
    const out=bookingsAfterAction(updated,date,tableBlocks,null,false,autoOptimizer);
    return {out:out,kicked:handBack?displacedBy(list,out,date,null):[]};
  });
  const transform=function(list){
    const r=trial(list);
    return r.kicked.length?list:r.out;
  };
  // Refused at the press, in the saves' sentence.
  const first=trial(ctx.bookings);
  if(first.kicked.length) return {refuse:displaceRefusal("unlocking "+target.name,first.kicked)};
  const after=first.out.find(function(b){return b.id===id;});
  const was=(target.tables||[]).slice().sort().join("|");
  const now=((after&&after.tables)||[]).slice().sort().join("|");
  const lead=target.name+" unlocked"+(now&&now!==was?", now on "+after.tables.join("+"):"");
  // A replay that would write nothing is dropped and said (`saveBookings`'
  // report), not landed as "unlocked". A booking that has gone is `goneReport`'s.
  const replayRefusal=function(prev){
    if(!(prev||[]).some(function(b){return b.id===id;})) return null;
    return transform(prev)===prev?"The unlock of "+target.name+" was not saved: the day changed on another device.":null;
  };
  return {transform:transform,lead:lead,done:lead+".",moved:[],replayRefusal:replayRefusal};
}
