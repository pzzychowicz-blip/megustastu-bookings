// src/hooks/useDraftCheck.js
//
// v18.8.0 phase 8 — runs `draftAvailability` (lib/draft-check.js) for the
// conversation on screen, AFTER the paint, through `useDeferredCompute`: the
// scan is the booking form's (`trialFits`, and `findTimes` when nothing fits),
// the heaviest work in the app, and it must never run in render (src/CLAUDE.md,
// "Availability scans in render").
//
//   const check = useDraftCheck(conv, { bookings, liveBookings, tableBlocks, autoOptimizer });
//   check.applies  the draft can be checked at all (`draftCheckable`)
//   check.value    the result, null while (re-)checking: never a stale answer
//   check.pending  a check is under way (the card's "Checking the tables…")
//
// It re-checks when the draft's size, date, time or seating changes, when a
// booking or a table block changes, when the optimiser switches for the day,
// and when that day's hours change in Settings (`hoursSig`, the form's reason).
// NOT on the clock: `liveBookings` is read at the moment of the scan but is not
// a dependency, because it is rebuilt on App's 15-second tick, and a card that
// blanked and re-checked four times a minute would never be still. What the
// tick changes is a seated party's live length, which a later booking change
// picks up.

import { useDeferredCompute } from "./useDeferredCompute";
import { draftCheckable, draftAvailability } from "../lib/draft-check";
import { optimizerActiveFor } from "../lib/booking-logic";
import { hoursFor } from "../lib/constants";

export function useDraftCheck(conv, { bookings, liveBookings, tableBlocks, autoOptimizer }) {
  const applies = draftCheckable(conv);
  const d = applies ? conv.draftData : null;
  const size = d ? d.size : null;
  const date = d ? d.date : null;
  const time = d ? d.time : null;
  const pref = d ? d.preference || null : null;
  const h = date ? hoursFor(date) : null;
  const hoursSig = h ? (h.closed ? "closed" : h.open + "-" + h.close) : "";
  const scan = useDeferredCompute(function () {
    if (!applies) return null;
    return draftAvailability({ size: size, date: date, time: time, preference: pref }, bookings, liveBookings, tableBlocks, !optimizerActiveFor(date, autoOptimizer));
  }, [applies, size, date, time, pref, bookings, tableBlocks, autoOptimizer, hoursSig]);
  return { applies: applies, value: applies ? scan.value : null, pending: applies && scan.pending };
}
