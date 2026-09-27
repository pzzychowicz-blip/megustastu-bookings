// src/lib/plan-avail.js
//
// v18.2.0 phase 21 — how long a table stays free, from the Plan view's
// selected minute.
//
// Patryk: the Plan view should show table availability the way the walk-in
// form's table grid does. The plan's fill answers "who is at this table at
// this minute"; the walk-in grid answers "could a party sit here NOW for a
// whole visit". They differ exactly on a table that is free now and booked
// soon — white on the plan, "busy" in the walk-in form. This module answers
// the second question for the plan, and it is the SAME answer the plan's own
// "Walk-in here" gate gives (PlanView reads both from here), so the rim on a
// table and the offer in its popover cannot disagree.
//
// Pure, per the v17.8.0 rule — a host decides where to seat a walk-in from
// what this returns. The caller hands over the day's bookings (cancelled
// already filtered out, as PlanView's `day` is), the table blocks' minute
// slots, the day's last minute and the visit length it wants to fit.

import { toMins } from "./booking-logic";

// The first minute after `at` at which something claims table `id`: a booking
// starting then (any status but completed — a completed visit frees its table,
// the rule everywhere else in the plan) or a table block. `closeM` when
// nothing does, so a table free for the rest of the day answers the day's end.
//
// Only STARTS after `at` count. Whatever already holds the table at `at` is
// the caller's to know (PlanView's `occupying` / `isBlocked` / `resetting`),
// and this is only ever asked about a table that is free at `at`.
export function nextBusyAt(id, at, day, blockSlots, closeM) {
  let next = closeM;
  (day || []).forEach(function (b) {
    if (!b || b.status === "completed" || b.status === "cancelled") return;
    if ((b.tables || []).indexOf(id) < 0) return;
    const s = toMins(b.time);
    if (s > at && s < next) next = s;
  });
  (blockSlots || []).forEach(function (sl) {
    if (sl.tables.indexOf(id) >= 0 && sl.s > at && sl.s < next) next = sl.s;
  });
  return next;
}

// What the plan draws for a FREE table: `until` is the minute it is next
// needed, or null when nothing needs it before the day ends (no label then);
// `fits` says whether a visit of `needMins` — a default-size walk-in's
// duration plus the turnaround, which is what the walk-in form checks —
// starts at `at` and ends before that. A table that does not fit is the
// walk-in form's "busy".
export function freeWindow(id, at, day, blockSlots, closeM, needMins) {
  const next = nextBusyAt(id, at, day, blockSlots, closeM);
  return { until: next < closeM ? next : null, fits: next - at >= needMins };
}
