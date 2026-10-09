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
import { bookingsAfterAction, syncLiveDurations, applyUndo, histEntry as defaultHistEntry } from "./booking-logic.js";
import { memoByPrev } from "./booking-save.js";
import { rehomeGuestTags } from "./customers.js";
import { voucherHeld } from "./vouchers.js";
import { todayStr } from "./day.js";

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

// ── planUndo ─────────────────────────────────────────────────────────────────
// v17.4.0 — GENERAL undo: one pending snapshot set ({snapshots, primaryId,
// kind: "cancel"|"delete"|"edit"}) and one restore. The exists?map:concat shape
// of `applyUndo` covers all three kinds (delete → the booking is gone from prev
// → it is re-added; cancel/edit → the snapshot is swapped back in).
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
export function planUndo(ctx){
  const info=ctx.info,nowMins=ctx.nowMins;
  const histEntry=ctx.stamp||defaultHistEntry;
  if(!info||!info.snapshots||!info.snapshots.length) return null;
  const user=ctx.getUser();
  const note=info.kind==="delete"?"deletion undone":info.kind==="edit"?"edit undone":"cancellation undone";
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
