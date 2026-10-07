// ── drop-plan — what a timeline drop does (v18.4.5, ROADMAP #17) ─────────────
// MOVED out of BookingApp's `dropOnTable`, statement for statement. What changed
// is only what the code does with its conclusion: it used to call
// `flashDragMsg` and `saveBookings` itself, and now RETURNS the conclusion, so
// the decision is reachable by a test and App keeps the two side effects.
//
//   planDrop(ctx) → null                  nothing to do (not this day's active
//                                         booking, or dropped on its own row)
//                 | { refuse }            the toast's text; nothing is written
//                 | { transform, done }   `saveBookings(transform)`, and `done`
//                                         is the toast when that returns true
//
// `transform` is a function of the list, as before: `saveBookings` hands it the
// fresh `prev`, so a write parked by the stale gate replays on fresh data.
//
// Two lists come in, and they are different on purpose. `liveBookings` is what
// the timeline shows (it decides occupancy); `bookings` is the stored array the
// displacement TRIAL runs on, the same array `saveBookings` will hand the
// transform. Passing one for the other changes which bookings a trial can see.
//
// `stamp(action, user)` builds a history entry. App passes nothing and gets
// `histEntry`; a test passes its own so the result has no clock in it.
//
// ── v17.0.0 correction: Timeline drag & drop (move / swap / displace) ─────
// Drop a dragged block on another table row. Round 3 semantics (Patryk):
//   1. pick the table SET the party takes at the target — the single table
//      if it seats them, else the smallest VALID_COMBO containing the target
//      that does (skipping combos with a blocked member or a seated party);
//   2. set free → plain move onto it;
//   3. exactly one overlapping booking → try the round-1 full-set SWAP first
//      (capacity both ways + canAssign);
//   4. else DISPLACE: strip the desired tables from the occupants, unlock
//      them, give the dragged booking the set, re-optimize (the manualAssign
//      Swap-busy recipe) — but commit ONLY if a trial pass re-seats every
//      displaced booking (no stranding; refusal toast otherwise).
// The dragged booking becomes _manual+_locked so the optimizer never undoes
// a hand-placed drag. Refusals surface via the dragMsg floating toast;
// success messages are gated on the saveBookings `ok` boolean (v15.4.0).
import { ALL_TABLES } from "./constants.js";
import {
  isActive, toMins, occupancyEnd, getBlockSlots, getBusy, overlaps,
  rankCombosContaining, comboExistsFor, comboCapBest, canAssign,
  bookingsAfterAction, histEntry as defaultHistEntry,
} from "./booking-logic.js";

export function planDrop(ctx){
  const id=ctx.id,targetId=ctx.targetId,liveBookings=ctx.liveBookings,bookings=ctx.bookings;
  const viewDate=ctx.viewDate,nowMins=ctx.nowMins,today=ctx.today;
  const tableBlocks=ctx.tableBlocks,autoOptimizer=ctx.autoOptimizer,user=ctx.user;
  const histEntry=ctx.stamp||defaultHistEntry;
  const src=liveBookings.find(function(b){return b.id===id;});
  if(!src||src.date!==viewDate||!isActive(src)) return null;
  const cur=src.tables||[];
  if(cur.length===1&&cur[0]===targetId) return null; // dropped back on its own row
  const size=src.size||2;
  const s=toMins(src.time);
  const e=Math.max(occupancyEnd(src,nowMins,today),s+1);
  const blockSlots=getBlockSlots(tableBlocks,src.date);
  const busyBlocked=getBusy(blockSlots,s,e);
  if(busyBlocked.has(targetId)) return {refuse:"Table "+targetId+" is blocked then."};
  // Day's other active bookings (completed = free, the v16.0.0 rule) + the
  // tables held by SEATED parties over the span — those are immovable.
  const dayActive=liveBookings.filter(function(b){return b.date===src.date&&b.id!==id&&isActive(b)&&b.status!=="completed";});
  const isOver=function(b){return overlaps(s,e,toMins(b.time),occupancyEnd(b,nowMins,today));};
  const seatedOn=new Set();
  dayActive.forEach(function(b){if(b.status==="seated"&&isOver(b))(b.tables||[]).forEach(function(t){seatedOn.add(t);});});
  // 1. Candidate table sets at the target, in PURE optimizer order (round 4,
  //    Patryk-confirmed): the single table if it seats the party, else every
  //    VALID_COMBO containing the target that does — ranked exactly like
  //    findBest ranks combos (rankCombosContaining), NOT by raw capacity.
  const cap1=(ALL_TABLES.find(function(t){return t.id===targetId;})||{}).capacity||0;
  // v17.0.0 review fix #1: cap the candidate walk. Step 4 runs a full
  // bookingsAfterAction TRIAL per candidate (optimise can be 70–500ms when a
  // day has unplaceable bookings); an unbounded ~20-combo walk on a busy day
  // could freeze the UI for seconds before the refusal toast. The top few
  // ranked combos are the only realistic placements; deeper ones would strand
  // more parties anyway.
  const MAX_CAND=8;
  const ranked=cap1>=size?[]:rankCombosContaining(targetId,size);
  const candSets=cap1>=size
    ?[[targetId]]
    :ranked
      .filter(function(c){return !c.ids.some(function(t){return busyBlocked.has(t)||seatedOn.has(t);});})
      .map(function(c){return c.ids.slice();})
      .slice(0,MAX_CAND);
  // /code-review #2: name the ACTUAL reason (only reachable when cap1<size —
  // a fitting single table always yields a candidate). "Won't fit" was a lie
  // when a big-enough combo exists but the drag's waste/avoid rules excluded
  // it: that's a "use Manual assign", not a dead end.
  if(candSets.length===0){
    return {refuse:ranked.length>0
      ? "The tables needed to join with "+targetId+" are busy or blocked then."
      : comboExistsFor(targetId,size)
        ? "Party of "+size+" would need too many tables joined at "+targetId+" — use Manual assign."
        : "Party of "+size+" won't fit at "+targetId+", even with joined tables."};
  }
  const occOf=function(set){return dayActive.filter(function(b){return isOver(b)&&(b.tables||[]).some(function(t){return set.includes(t);});});};
  const desired=candSets[0];
  const occ=occOf(desired);
  // 2. Free set → plain move.
  if(occ.length===0){
    return {transform:function(prev){return prev.map(function(b){
      if(b.id!==id) return b;
      return Object.assign({},b,{tables:desired,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("moved to "+desired.join("+")+" (drag)",user)])});
    });},done:src.name+" moved to "+desired.join("+")+"."};
  }
  // 3. Exactly one occupant → try the straight full-set swap first.
  if(occ.length===1&&cur.length>0&&occ[0].status!=="seated"){
    const other=occ[0];
    const newSrc=(other.tables||[]).slice(),newOther=cur.slice();
    const otherSize=other.size||2;
    if(comboCapBest(newSrc)>=size&&comboCapBest(newOther)>=otherSize){
      const os=toMins(other.time),oe=Math.max(occupancyEnd(other,nowMins,today),os+1);
      const slots=dayActive.filter(function(b){return b.id!==other.id&&(b.tables||[]).length>0;}).map(function(b){return {tables:b.tables,s:toMins(b.time),e:occupancyEnd(b,nowMins,today)};}).concat(blockSlots);
      if(canAssign(newSrc,slots,s,e)&&canAssign(newOther,slots.concat([{tables:newSrc,s:s,e:e}]),os,oe)){
        // v17.10.0: ONLY THE BOOKING YOU DRAGGED GETS LOCKED. This branch used
        // to write `_manual:true,_locked:true` to BOTH sides, which pinned a
        // party nobody asked to pin — the optimizer could then never tidy the
        // displaced booking again, and every swap quietly grew the set of
        // hand-placed bookings. The other two paths that move an occupant out
        // of the way (step 4's displacement below, and manualAssign's
        // `affected` branch) have always unlocked them; this one was the odd
        // one out.
        //
        // The exception is real and is the reason these two flags are read off
        // the CAPTURED `other` rather than being written false outright: a
        // walk-in is `_manual+_locked` BY DEFINITION and immune to the
        // optimizer (CLAUDE.md's Gotchas table), so force-unlocking one here
        // would let a reshuffle move a party that is physically sitting down.
        // An already-locked booking therefore keeps its lock on its NEW tables;
        // an ordinary confirmed booking comes out unlocked, which is the ask.
        const otherLocked=!!other._locked,otherManual=!!other._manual;
        return {transform:function(prev){return prev.map(function(b){
          if(b.id===id) return Object.assign({},b,{tables:newSrc,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("swapped tables with "+other.name+" ("+(cur.join("+")||"none")+" → "+newSrc.join("+")+")",user)])});
          if(b.id===other.id) return Object.assign({},b,{tables:newOther,_manual:otherManual,_locked:otherLocked,_conflict:false,history:(b.history||[]).concat([histEntry("swapped tables with "+src.name+" ("+(other.tables||[]).join("+")+" → "+newOther.join("+")+")",user)])});
          return b;
        });},done:src.name+" and "+other.name+" — tables swapped."};
      }
    }
  }
  // 4. Displacement — the manualAssign Swap-busy recipe, with a trial gate.
  //    Round 4: walk the optimizer-ranked candidates in order and commit the
  //    FIRST whose trial re-seats every displaced booking conflict-free —
  //    a stranding top pick falls through to the next set, not to a refusal.
  const mkTransform=function(dSet,dOcc){
    const occIds=new Set(dOcc.map(function(b){return b.id;}));
    return function(list){
      const updated=list.map(function(b){
        if(b.id===id) return Object.assign({},b,{tables:dSet,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("moved to "+dSet.join("+")+" (drag)",user)])});
        if(occIds.has(b.id)){
          const remaining=(b.tables||[]).filter(function(t){return !dSet.includes(t);});
          return Object.assign({},b,{tables:remaining,_locked:false,_manual:false});
        }
        return b;
      });
      return bookingsAfterAction(updated,viewDate,tableBlocks,null,false,autoOptimizer);
    };
  };
  for(let ci=0;ci<candSets.length;ci++){
    const dSet=candSets[ci];
    const dOcc=ci===0?occ:occOf(dSet);
    if(dOcc.some(function(b){return b.status==="seated";})) continue; // seated = immovable (only reachable via the single-table set)
    if(dOcc.length===0){
      // a lower-ranked but FREE set (only reachable past a failed higher pick)
      return {transform:function(prev){return prev.map(function(b){
        if(b.id!==id) return b;
        return Object.assign({},b,{tables:dSet,_manual:true,_locked:true,_conflict:false,history:(b.history||[]).concat([histEntry("moved to "+dSet.join("+")+" (drag)",user)])});
      });},done:src.name+" moved to "+dSet.join("+")+"."};
    }
    const transform=mkTransform(dSet,dOcc);
    // v17.0.0 review note #2: the trial runs against the CURRENT `bookings`,
    // while the committed write re-applies `transform` to whatever fresh
    // `prev` saveBookings hands it. `transform` itself re-runs
    // bookingsAfterAction (the optimizer) on that fresh data, so the COMMIT is
    // always internally consistent; a concurrent remote echo can at worst
    // leave a displaced booking table-less (visible in the unassigned row) or
    // overlapping (the v15.6.1 reconciliation effect then self-heals). No
    // silent data loss — acceptable for a rare cross-device race.
    const trial=transform(bookings);
    const stranded=dOcc.find(function(o){const t=trial.find(function(x){return x.id===o.id;});return !t||(t.tables||[]).length===0||t._conflict;});
    if(stranded) continue;
    return {transform:transform,done:src.name+" moved to "+dSet.join("+")+" — "+dOcc.map(function(o){return o.name;}).join(", ")+" reassigned."};
  }
  const seatedOcc=occ.find(function(b){return b.status==="seated";});
  if(seatedOcc) return {refuse:seatedOcc.name+" is seated on "+targetId+"'s tables — can't move them."};
  return {refuse:"Can't re-seat the parties there without stranding one — use Manual assign."};
}
