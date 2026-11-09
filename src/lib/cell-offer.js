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
