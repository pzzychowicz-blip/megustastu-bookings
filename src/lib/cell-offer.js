// src/lib/cell-offer.js — v18.16.0
//
// An empty cell of the Timeline starts a booking. The grid had no way to say
// "here, at this time": a phone booking mid-service meant + New, then the time,
// then the table. This is what a cell offers, pure, so the view only has to
// find the pointer and draw the answer.
//
//   cellAt(x, pxPerMin, openMins) → the quarter's start minute | null
//   cellOffer(tableId, mins, ctx) → null | { tableId, time }
//
// A cell is one quarter hour, the slot the rest of the app works in
// (`QUARTER_HOURS`, `newBookingTime`, the form's suggestions).
//
// **What it refuses is what the form's Save would refuse for the time**
// (`timeRefusal`, lib/booking-save.js: a closed day, outside the day's hours,
// past the last start), plus a table block over the cell. Nothing else: the
// table goes into the form as the PREFERRED table (Patryk, 2026-11-09), so
// whether the party fits there is the optimiser's and the form's Tables row's
// to answer, not this file's. The view withholds the offer where the pointer is
// over a booking or a waitlist ghost; that is hit-testing, and stays there.
//
// Commit 7 of the same version added the two small decisions of a block dragged
// SIDEWAYS, which work in the same quarters and are pure for the same reason (a
// drag cannot be run by a test here; its arithmetic can):
//
//   dragAxis(dx, dy, sideways)                         → null | "x" | "y"
//   draggedStart(start, px, pxPerMin, openMins, endMins) → the start it has reached
//
// What the release then does with that start is `planRetime` (lib/drop-plan.js).
import { toTime, getBlockSlots, getBusy } from "./booking-logic.js";
import { timeRefusal } from "./booking-save.js";

export const CELL_MINS = 15;

// The quarter under a pointer `x` px from the grid's left edge. `openMins` is the
// grid's first minute, a whole hour, so quarters fall on the clock's.
export function cellAt(x, pxPerMin, openMins) {
  if (!(pxPerMin > 0) || !(x >= 0) || !Number.isFinite(openMins)) return null;
  return openMins + Math.floor(x / pxPerMin / CELL_MINS) * CELL_MINS;
}

// ctx: { date, blocks } — the viewed date and the stored table blocks.
export function cellOffer(tableId, mins, ctx) {
  if (!tableId || !Number.isFinite(mins) || !ctx || !ctx.date) return null;
  if (timeRefusal(ctx.date, mins)) return null;
  const blocked = getBusy(getBlockSlots(ctx.blocks || [], ctx.date), mins, mins + CELL_MINS);
  if (blocked.has(tableId)) return null;
  return { tableId: tableId, time: toTime(mins) };
}

// ── The time drag ────────────────────────────────────────────────────────────
// A drag has ONE direction for its whole life (Patryk, 2026-11-09): a diagonal
// hand must not change a party's table while it is moving their time. Travel
// under `DRAG_SLOP` px on both axes has not decided yet (null); past it, the
// larger travel wins, and a tie goes to the table drag, which is the older
// gesture. `sideways` false is a block that cannot be re-timed (the Unplaced
// row, or no handler): there only vertical travel counts, exactly as it did
// before there was a second direction, so a sideways wobble of the mouse on such
// a block is still a click.
export const DRAG_SLOP = 6;
export function dragAxis(dx, dy, sideways) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (!sideways) return ay > DRAG_SLOP ? "y" : null;
  if (!(Math.max(ax, ay) > DRAG_SLOP)) return null;
  return ax > ay ? "x" : "y";
}

// The start a block that began at `start` has reached after `px` of sideways
// travel, on the clock's quarter. Less than half a quarter of travel is no move
// at all, so a booking that stands off the quarter (19:10) keeps its minute until
// it is really dragged, and then lands on a quarter like everything else. Held
// inside the grid (`openMins` to one cell before `endMins`); whether that minute
// may be BOOKED is `timeRefusal`'s to say, at the release, in the form's words.
export function draggedStart(start, px, pxPerMin, openMins, endMins) {
  if (!(pxPerMin > 0) || !Number.isFinite(px) || !Number.isFinite(start)) return start;
  const raw = start + px / pxPerMin;
  if (Math.abs(raw - start) < CELL_MINS / 2) return start;
  const want = Math.round(raw / CELL_MINS) * CELL_MINS;
  return Math.max(openMins, Math.min(endMins - CELL_MINS, want));
}
