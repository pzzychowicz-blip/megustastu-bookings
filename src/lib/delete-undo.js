// src/lib/delete-undo.js
//
// v18.5.1 (ROADMAP #17) — what Delete does to the list, and what Undo puts
// back, moved out of BookingApp's `delBooking` and `undoLastAction`. The two
// are one lifecycle: a delete arms the undo that restores it. Each returns its
// conclusion and App carries it out, the shape `planCancel` has
// (lib/status-change.js): App keeps the capability gate, the skipDate write and
// its refusal, the confirm and the form it closes, the flash, the undo pill's
// timer and the date it navigates to.
//
// Moved verbatim apart from where the values come from, with the comments that
// explain each rule. `todayStr()` is still read inside the undo's transform,
// when the write runs, as it was.
import { bookingsAfterAction, syncLiveDurations, applyUndo, histEntry as defaultHistEntry, countLabel, optimizerActiveFor } from "./booking-logic.js";
import { memoByPrev } from "./booking-save.js";
import { rehomeGuestTags, matchesIdentity, anonymizeBooking } from "./customers.js";
import { rulesOfCustomer } from "./recurring.js";
import { voucherHeld } from "./vouchers.js";
import { todayStr } from "./day.js";

// ── What the two confirms say ───────────────────────────────────────────────
// v18.14.0 (correction 21, Patryk): these were fixed sentences, and two of their
// claims were false. Delete said "This can't be undone" with an Undo pill armed
// straight after it. Both said the tables would be re-optimised, which does not
// happen where the Optimiser is off: `bookingsAfterAction`'s off path keeps
// everyone's tables, and that is every evening, when most of these are tapped. The
// date is the booking's own, as both transforms read it.
function tablesLine(booking,autoOptimizer){
  return booking&&optimizerActiveFor(booking.date,autoOptimizer)?" Tables will be re-optimised afterwards.":"";
}
export function deleteWords(booking,undoSecs,autoOptimizer){
  return "You can undo this for "+countLabel(undoSecs,"second","seconds")+"."+tablesLine(booking,autoOptimizer);
}
export function cancelWords(booking,autoOptimizer){
  return "The booking stays on the day, marked cancelled."+tablesLine(booking,autoOptimizer);
}

// ── planDelete ───────────────────────────────────────────────────────────────
// ctx: {id, bookings, viewDate, tableBlocks, autoOptimizer, redeemAsked,
//       vouchersOn, vouchersByCode}
// → {voucherBack}            ask the money question first; nothing is written
// → {skip, transform}        `skip` is null, or the rule and date App must park
//                            BEFORE the write (below); `transform` is memoised
//                            by `prev`, so the undo delta and the write share
//                            ONE optimiser pass (v17.4.0).
export function planDelete(ctx){
  const id=ctx.id,viewDate=ctx.viewDate,tableBlocks=ctx.tableBlocks,autoOptimizer=ctx.autoOptimizer;
  // v18.0.0 session 8 (C6): the money question, before the record goes.
  // Deleting a booking that had redeemed against a voucher asked NOTHING and
  // left the ledger entry behind — pointing at a booking that no longer
  // exists, which Settings → Vouchers renders as the literal text
  // "booking <id>" because there is no name left to resolve. The balance
  // stayed spent, so a guest's remaining money quietly belonged to a visit
  // nobody can look up.
  //
  // The same prompt as the walk-back, with `from: "delete"`: the question is
  // identical (restore the balance, or leave it spent?) and a second dialog
  // asking it differently is a second thing to keep in step. Escape abandons
  // the delete entirely, which is the safe direction — the booking is still
  // there to try again.
  if(!ctx.redeemAsked&&voucherHeld({bookings:ctx.bookings,vouchersByCode:ctx.vouchersByCode,vouchersOn:ctx.vouchersOn},id)){
    return {voucherBack:{id:id,from:"delete"}};
  }
  const target=ctx.bookings.find(function(x){return x.id===id;});
  // v16.3.0: deleting a recurring OCCURRENCE parks its date on the rule's
  // skipDates so the generator never resurrects it. Done BEFORE the booking
  // delete and UNGATED by the delete's `ok` — if the delete is held/auto-
  // retried, the skipDate must still land so the generator doesn't re-create
  // the occurrence during the hold (addSkipDate is idempotent). Silent write.
  // /code-review: if the skipDate itself is REFUSED (recurring node not loaded
  // yet — a tiny post-load window), App ABORTS the delete: deleting anyway
  // would let the generator resurrect the occurrence moments later.
  const skip=(target&&target.recurringId&&target.recurringDate)?{ruleId:target.recurringId,date:target.recurringDate}:null;
  // v18.5.0: a customer's guest tags are stored on ONE of their bookings (the
  // newest statement, lib/customers.js). If that is the booking going, the
  // statement moves to their most recent remaining one, in this same write,
  // so deleting a booking never deletes what the guest told us.
  function delTransform(b){const t=b.find(function(x){return x.id===id;});const d=t?t.date:viewDate;return bookingsAfterAction(rehomeGuestTags(b,b.filter(function(x){return x.id!==id;}),id),d,tableBlocks,null,false,autoOptimizer);}
  return {skip:skip,transform:memoByPrev(delTransform)};
}

// ── withUndoDelta ────────────────────────────────────────────────────────────
// v18.14.0 (H5). A move's Undo is armed when its write LANDS, and a write held by
// the stale gate replays on a fresh `prev`, so what it moved can only be read
// inside the transform, on the list it really ran on. `memoByPrev` keeps that to
// one optimiser pass per list, as `planDelete` does.
// → {transform, delta(), post(), age()}   `delta` and `post` answer for the
//   transform's latest run; `age` is the ms since this was made, for a landing
//   too late to offer an Undo.
export function withUndoDelta(transform,deltaOf){
  const at=Date.now();
  let delta=[],after=[];
  return {
    transform:memoByPrev(function(prev){const post=transform(prev);delta=deltaOf(prev,post);after=post;return post;}),
    delta:function(){return delta;},
    post:function(){return after;},
    age:function(){return Date.now()-at;},
  };
}

// ── What a move says ─────────────────────────────────────────────────────────
// v18.14.2. With the Optimiser on, a drop or an assign can re-seat the whole day,
// and the pill named only the party that gave up its table: "David moved to 8 —
// Reilly reassigned." while six others had moved too, measured on an iPad. So the
// sentence is finished when the write lands, from what really moved, for the same
// reason the Undo is armed there: a held write replays on a fresh list.
//
// `delta` holds the tables everyone had, `post` what they have. A delta entry can
// be a party that only changed some other field, so the tables are compared, as
// a set, because the optimiser may hand the same ones back in another order.
// `first` are the parties the action itself displaced, who lead the sentence.
function sameTables(a,b){return (a.tables||[]).slice().sort().join("+")===(b.tables||[]).slice().sort().join("+");}
export function movedNames(delta,post,id,first){
  const byId={};
  (post||[]).forEach(function(b){byId[b.id]=b;});
  const moved=(delta||[]).filter(function(b){const now=byId[b.id];return b.id!==id&&now&&!sameTables(b,now);});
  const led=(first||[]).map(function(f){return moved.find(function(b){return b.id===f.id;});}).filter(Boolean);
  return led.concat(moved.filter(function(b){return led.indexOf(b)<0;})).map(function(b){return b.name;}).filter(Boolean);
}
// Two names at most: the pill is one line under a thumb. Patryk's choice, over a
// bare count and over the old sentence.
export function moveSentence(lead,names){
  if(!names.length) return lead+".";
  if(names.length===1) return lead+" — "+names[0]+" moved.";
  if(names.length===2) return lead+" — "+names[0]+" and "+names[1]+" moved.";
  return lead+" — "+names[0]+" and "+(names.length-1)+" others moved.";
}
// A plan with no `lead` (a swap, a free table, a reshuffle) already says all of it.
export function landedSentence(plan,sentence,delta,post,id){
  return plan&&plan.lead?moveSentence(plan.lead,movedNames(delta,post,id,plan.moved)):sentence;
}

// ── planUndo ─────────────────────────────────────────────────────────────────
// v17.4.0 — GENERAL undo: one pending snapshot set ({snapshots, primaryId,
// kind: "cancel"|"delete"|"edit"}) and one restore. The exists?map:concat shape
// of `applyUndo` covers all three kinds (delete → the booking is gone from prev
// → it is re-added; cancel/edit → the snapshot is swapped back in).
//
// v18.14.0 (H5): three more kinds, "move" (a timeline drop), "assign" (the table
// picker's Save) and "reshuffle". The same restore covers them, and every party
// the action moved is in the snapshots, so the floor goes back as it stood. A
// reshuffle has no primaryId: nobody was acted on, so no history entry is
// written, the same symmetry as the others below.
//
// SCOPE (deliberate, v17.4.0): undo restores THE SNAPSHOTTED BOOKINGS ONLY, and
// VERBATIM — deliberately NOT through bookingsAfterAction. Its optimiser branch
// is taken whenever optimizerActiveFor() is true (which it ALWAYS is for a
// future date, regardless of the toggle), and a reshuffle here would
// immediately re-apply the very moves undo just reversed. syncLiveDurations
// still runs so a seated booking's live duration stays correct. If a booking
// created since the action now collides, the v15.6.1 reconciliation effect
// resolves it — the same path that handles offline merges.
//
// ctx: {info, getUser, nowMins, stamp?}  (`getUser` is asked only when there
//      is something to undo, as it was)
// → null                     nothing to undo
// → {date, transform}        `date` is the acted-on booking's, which App
//                            navigates to once the write is dispatched.
const UNDO_NOTES={delete:"deletion undone",edit:"edit undone",move:"move undone",assign:"table change undone"};
export function planUndo(ctx){
  const info=ctx.info,nowMins=ctx.nowMins;
  const histEntry=ctx.stamp||defaultHistEntry;
  if(!info||!info.snapshots||!info.snapshots.length) return null;
  const user=ctx.getUser();
  const note=UNDO_NOTES[info.kind]||"cancellation undone";
  const primary=info.snapshots.find(function(s2){return s2.id===info.primaryId;})||info.snapshots[0];
  return {date:primary.date,transform:function(b){
    // Only the booking the user acted on gets a history entry — the others
    // were moved by the optimizer, not by a user action, and the original
    // reshuffle didn't write history for them either (symmetry).
    const snaps=info.snapshots.map(function(s2){
      return s2.id===info.primaryId
        ?Object.assign({},s2,{history:(s2.history||[]).concat([histEntry(note,user)])})
        :s2;
    });
    const today=todayStr();
    return syncLiveDurations(applyUndo(b,snaps),today,nowMins);
  }};
}

// ── planCustomerDelete ───────────────────────────────────────────
// v18.6.0. Delete customer is several writes to several nodes, and only the
// bookings write can be held: `saveBookings` parks it behind the freshness
// gate while `saveRecurring` has no such gate. v18.5.1 removed the customer's
// standing bookings first, so a held anonymise left the rule gone and the
// bookings as they were. Measured on DEV with the gate tripped: 0 rules and 3
// named bookings on the server for 30 s, until a reconnect replayed the write.
// A reload in that time loses the parked write, and the rule with it, for good.
//
// So the rules are PAUSED first, which stops the generator exactly as removing
// them does (`dueOccurrences` skips an inactive rule) and can be taken back.
// App then:
//   - pauses `pause` and stops if that is refused;
//   - writes `transform` with a report;
//   - on `onLanded` removes `remove` and erases the rest (waitlist, WhatsApp,
//     the activity log's copy of the name);
//   - on `onDiscarded` makes `pause` active again.
// If the page dies while the write is parked, the customer is still listed
// with a paused standing booking, and deleting them again finishes it.
//
// `pause` is the rules that are active NOW, so a rule the restaurant had
// already paused is not switched on by a discard.
// → {remove, pause, transform}
export function planCustomerDelete(rules, bookings, ident){
  const remove=rulesOfCustomer(rules,bookings,ident);
  const pause=(rules||[]).filter(function(r){return r&&r.active&&remove.indexOf(r.id)!==-1;}).map(function(r){return r.id;});
  return {remove:remove,pause:pause,transform:function(prev){return prev.map(function(b){
    if(!matchesIdentity(b,ident)) return b;
    return anonymizeBooking(b);
  });}};
}
