// src/lib/voucher-settle.js
//
// v18.6.0 (ROADMAP #17) — what the redeem prompt's answer decides, and the
// voucher carry that follows it, moved out of BookingApp's `settleVoucher`,
// `offerVoucherCarry` and `doVoucherCarry`. Each returns its conclusion and App
// carries it out, the shape `planStatus` and `planDelete` have: App keeps the
// prompt it dismisses, the capability gates, `withRedeemAsked`, the booking
// write that goes FIRST (`updateStatus`, or `doSave` read through
// `saveGuardRef`), `redeemVoucher`, and the carry prompt it raises.
//
// Moved verbatim apart from where the values come from, with the comments that
// explain each rule. THE ORDER STAYS IN APP, and it is the design: the booking
// is completed first and the voucher is redeemed only if that write dispatched
// (the note above `settleVoucher` there says why the two failures are not
// symmetric). Nothing here writes.
import { normalizeCode, formatCode, remainingOf, attachedElsewhere, carryTarget } from "./vouchers.js";
import { hasRealPhone, matchesIdentity } from "./customers.js";
import { histEntry as defaultHistEntry } from "./booking-logic.js";

export const SETTLE_GONE = "That booking is no longer completed — nothing was recorded against its voucher.";

// ── planSettle ───────────────────────────────────────────────────────────────
// ctx: {ask, bookings}      `ask` is the prompt's payload {id, status, from}
// → {refuse}                say it and write nothing
// → {route}                 which booking write goes first:
//                             "settle"  none (below)
//                             "form"    the form's own save
//                             "status"  `updateStatus(ask.id, ask.status)`
export function planSettle(ctx){
  const ask=ctx.ask;
  // v18.2.0 phase 48: a SETTLE is the missing ledger entry of a booking that
  // is ALREADY completed, so there is no booking write to go first — the
  // order in App exists for a completion, and here the voucher is the only
  // write. (Going through updateStatus would have logged a second "status →
  // completed" for a status that did not change.)
  // v18.2.0 /code-review: …which means nothing here re-checks that the visit
  // IS still completed, and the prompt stays open whatever the booking's
  // status (it mounts on the voucher alone). Walked back out of Completed on
  // another device meanwhile, a redeem would leave a ledger entry against a
  // booking that is not completed — the state the ordering note says
  // nothing in the app looks for. So a settle asks first, and refuses.
  if(ask.from==="settle"){
    const cur=ctx.bookings.find(function(x){return x.id===ask.id;});
    if(!cur||cur.status!=="completed") return {refuse:SETTLE_GONE};
    return {route:"settle"};
  }
  return {route:ask.from==="form"?"form":"status"};
}

// ── settleEffects ────────────────────────────────────────────────────────────
// Asked AFTER the booking write dispatched.
// ctx: {ask, amount, bookings, vouchersByCode, now?}
// → {code, redeem, carry}   `redeem`: record `amount` against `code`;
//                           `carry`: null, or the carry prompt's payload.
export function settleEffects(ctx){
  const ask=ctx.ask,amount=ctx.amount;
  const b=ctx.bookings.find(function(x){return x.id===ask.id;});
  const code=b?normalizeCode(b.voucherCode):"";
  // v18.0.0 session 8 (item 7): and THEN ask whether the rest should follow
  // the guest. After the booking write and after the money, so the offer is
  // made about a visit that is actually finished — and on BOTH answers, since
  // "Complete without using it" leaves the whole balance behind, which is the
  // case where carrying it matters most.
  return {
    code:code,
    redeem:!!(code&&amount),
    carry:(code&&b)?carryOffer({b:b,code:code,justRedeemed:amount,bookings:ctx.bookings,vouchersByCode:ctx.vouchersByCode,now:ctx.now}):null
  };
}

// ── carryOffer ───────────────────────────────────────────────────────────────
// The offer, and the one number it has to get right. `vouchersByCode` here is
// still the version from BEFORE the redemption dispatched a moment ago, so the
// balance is computed by subtracting what was just taken rather than read back
// — reading it back would offer the guest money that has already been spent.
// ctx: {b, code, justRedeemed, bookings, vouchersByCode, now?}
// → null, or {code, amount, to, name, date, time, from}
export function carryOffer(ctx){
  const b=ctx.b,code=ctx.code,bookings=ctx.bookings,vouchersByCode=ctx.vouchersByCode;
  const v=vouchersByCode[code];
  if(!v) return null;
  const left=Math.max(0,remainingOf(v)-(Number(ctx.justRedeemed)||0));
  if(left<=0) return null;
  if(!hasRealPhone(b.phone)&&!b.guestId) return null;   // no identity, nothing to follow
  const ident={phone:b.phone,guestId:b.guestId};
  const mine=bookings.filter(function(x){return matchesIdentity(x,ident);});
  // `now` is read here, when the offer is made, unless a test passes one.
  const to=carryTarget(mine,code,vouchersByCode,bookings,ctx.now==null?Date.now():ctx.now,b);
  if(!to) return null;
  return {code:code,amount:left,to:to.id,name:to.name||"",date:to.date,time:to.scheduledTime||to.time,from:b.date};
}

// ── carryTransform ───────────────────────────────────────────────────────────
// Move — a function-form save, so it takes the retry path like every other
// user write. The re-check inside the updater is not ceremony: the prompt can
// sit on screen while another device attaches something to that booking, and
// overwriting a voucher somebody else chose is the one outcome this must not
// produce.
// `c` is the carry prompt's payload (`carryOffer`'s return).
export function carryTransform(c,user,histEntry){
  const entry=histEntry||defaultHistEntry;
  // v18.2.0 (the design critique, C1): the history entry stores the ISO day,
  // as every other history text does ("date 2026-09-24→…"), and the screen
  // writes it the house way (`formatDaysIn`, HistoryPopup and the Activity
  // log). It stored its own "24/09", which nothing could re-write.
  const fromLabel=c.from||"";
  return function(prev){
    // v18.0.0 session 10 (/code-review): the OTHER half of the same race.
    // The line below guards the target booking against having acquired a
    // voucher of its own; this guards the VOUCHER against having been
    // attached to somebody else while the prompt sat open. `carryTarget`
    // asks `attachedElsewhere` when the offer is MADE, and this path is
    // the one way an attachment reaches a booking without going through
    // the picker — so without it, "Move it" is the only door in the app
    // that can put one voucher on two live bookings, which is precisely
    // the state that predicate exists to prevent. Asked against `prev`,
    // which is the list the write actually lands on.
    if(attachedElsewhere(prev,c.code,c.to)) return prev;
    return prev.map(function(b){
      if(b.id!==c.to||normalizeCode(b.voucherCode)) return b;
      return Object.assign({},b,{
        voucherCode:c.code,
        history:(b.history||[]).concat([entry("voucher "+formatCode(c.code)+" attached (carried from the "+fromLabel+" visit)",user)])
      });
    });
  };
}
