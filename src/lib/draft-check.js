// src/lib/draft-check.js
//
// v18.8.0 phase 8 — does a WhatsApp booking request fit, before anybody presses
// Accept? The draft card used to say what the customer asked for and nothing
// about whether the restaurant could take it, so a full evening was found out
// only once the booking form had opened over the inbox (Patryk, 2026-10-06).
//
// Pure, so it is tested; the hook that runs it after the paint is
// `hooks/useDraftCheck.js`. The scan is the booking form's own, composed the
// same way (BookingFormModal's `availScan` and `kitchenScan`), so the card and
// the form the card opens cannot disagree:
//   · tables: `trialFits` against the live bookings, and when nothing fits,
//     `findTimes` + `formatSugg` for the nearby times;
//   · kitchen: `getKitchenLoad` against `KITCHEN_TABLE_LIMIT`, counting this
//     party, and when that is reached, `findKitchenFriendlyTimes`.
// Completed bookings free their tables in every helper used here (the root
// CLAUDE.md's "Completed bookings & availability" row), so nothing is filtered
// again. `noResh` is `!optimizerActiveFor(date, autoOptimizer)`, the form's.

import { trialFits, findTimes, formatSugg, getKitchenLoad, findKitchenFriendlyTimes, toMins, lastStartMins } from "./booking-logic.js";
import { getDur } from "./booking-fields.js";
import { KITCHEN_TABLE_LIMIT, hoursFor } from "./constants.js";
import { todayStr } from "./day.js";
import { matchCustomerByPhone, normalizePhone } from "./customers.js";
import { isUsableSize, isUsableDate, isUsableTime } from "./whatsapp.js";

// How many other times the card offers. Four fit one row of the card on a
// tablet and two on a phone, and a reply listing more reads as a timetable.
export const DRAFT_ALTS = 4;

function prefOf(d) {
  return d && (d.preference === "indoor" || d.preference === "outdoor") ? d.preference : "auto";
}

// Can this conversation's draft be checked? A new booking still waiting for a
// decision, with a size, a date and a time the app can read: the three things
// a table is chosen for. Anything less is a question for the customer, which
// the card's own "? time" already asks.
export function draftCheckable(conv) {
  if (!conv || !conv.draftData) return false;
  if (conv.draftStatus === "accepted" || conv.draftStatus === "dismissed") return false;
  const d = conv.draftData;
  if ((d.intent || "new_booking") !== "new_booking") return false;
  // The parse's own predicates (`sanitizeParse`), so "usable" means one thing.
  return isUsableSize(d.size) && isUsableDate(d.date) && isUsableTime(d.time);
}

// The nearest `max` times to `around` (minutes), in clock order. A list split
// into "earlier" and "later" sends the eye to the ends of each; what a
// customer wants is the times closest to the one they asked for.
export function nearestTimes(times, around, max) {
  return (times || [])
    .map(function (t) { return { t: t, d: Math.abs(toMins(t) - around) }; })
    .sort(function (a, b) { return a.d - b.d || toMins(a.t) - toMins(b.t); })
    .slice(0, max === undefined ? DRAFT_ALTS : max)
    .map(function (x) { return x.t; })
    .sort(function (a, b) { return toMins(a) - toMins(b); });
}

// → { closed, outside, fits, tables, kitchenBusy, load, sugg, kitchenSugg, alts }
//   closed       the restaurant is closed that day (nothing else is asked)
//   outside      the time is before opening or after the last start Save takes
//   fits         a table can be found (`tables` are the ones the scan chose)
//   kitchenBusy  with this party, KITCHEN_TABLE_LIMIT starts in that quarter
//   load         `getKitchenLoad`'s count of the OTHER starts
//   sugg         `formatSugg`'s {earlier, later} when it does not fit, else null
//   kitchenSugg  `findKitchenFriendlyTimes`' {before, after} when busy, else null
//   alts         the times the card offers: the nearest that fit, or, when the
//                kitchen is the problem, the nearest quieter ones with a table
export function draftAvailability(draft, bookings, liveBookings, blocks, noResh) {
  const size = Number(draft.size);
  const date = draft.date;
  const time = draft.time;
  const pref = prefOf(draft);
  const dur = getDur(size);
  const sm = toMins(time);
  const h = hoursFor(date);
  const out = { closed: false, outside: false, fits: false, tables: null, kitchenBusy: false, load: null, sugg: null, kitchenSugg: null, alts: [] };
  if (h.closed) { out.closed = true; return out; }
  const live = liveBookings || bookings;
  // Save refuses a start before opening or after the last start (`doSave`,
  // `lastStartMins`), so the card does not call such a time a fit. The times
  // nearby are still worth offering: `findTimes` clamps its walk to the day.
  if (sm < h.open * 60 || sm > lastStartMins(h.close)) {
    out.outside = true;
    out.sugg = formatSugg(findTimes(date, size, pref, live, dur, sm, blocks, null, noResh), sm);
    out.alts = nearestTimes(out.sugg.earlier.concat(out.sugg.later), sm);
    return out;
  }
  const tables = trialFits(live, date, time, size, pref, dur, blocks, null, null, noResh);
  if (tables) {
    out.fits = true;
    out.tables = tables;
  } else {
    out.sugg = formatSugg(findTimes(date, size, pref, live, dur, sm, blocks, null, noResh), sm);
    out.alts = nearestTimes(out.sugg.earlier.concat(out.sugg.later), sm);
  }
  // The kitchen line is the form's: the OTHER starts in this quarter, plus this
  // party, against the layout's limit. It is asked whether or not a table was
  // found, as the form asks it, but only offers times when a table was: with
  // none, the table times above are the answer.
  out.load = getKitchenLoad(bookings, date, time, dur, null);
  out.kitchenBusy = out.load.starts + 1 >= KITCHEN_TABLE_LIMIT;
  if (out.kitchenBusy && out.fits) {
    out.kitchenSugg = findKitchenFriendlyTimes(bookings, date, size, pref, dur, time, null, blocks);
    const withTable = out.kitchenSugg.before.concat(out.kitchenSugg.after)
      .filter(function (r) { return r.hasTables; })
      .map(function (r) { return r.timeStr; });
    out.alts = nearestTimes(withTable, sm);
  }
  return out;
}

// What the card says about it, and in which tone. One sentence per outcome so
// the card, its compact bar and the tests read the same words.
export function draftCheckLine(draft, r) {
  if (!r) return null;
  const n = Number(draft.size);
  if (r.closed) return { tone: "danger", text: "Closed on that day" };
  if (r.outside) return { tone: "danger", text: draft.time + " is outside opening hours" };
  if (!r.fits) return { tone: "danger", text: "No tables for " + n + " at " + draft.time };
  if (r.kitchenBusy) return { tone: "warn", text: "Kitchen may be busy at " + draft.time };
  return { tone: "success", text: "Fits at " + draft.time };
}

// The booking a draft becomes: the fields Accept opens the form with and the
// waitlist entry takes. One rule for the name (the draft's, else the customer's
// from their bookings) and for the phone (the conversation's, with its "+"), so
// the two doors cannot fill them differently. The fallbacks are Accept's: a
// draft with no usable time still opens the form, at 13:00, for staff to fix.
export function draftPrefill(conv, bookings) {
  const d = conv.draftData || {};
  const match = matchCustomerByPhone(conv.phoneKey, bookings);
  let phone = conv.phone || conv.phoneKey || "+";
  if (phone && phone.charAt(0) !== "+") phone = "+" + phone;
  return {
    name: (d.name && d.name.trim()) || (match && match.name) || "",
    phone: phone,
    size: Number(d.size) || 2,
    date: d.date || todayStr(),
    time: d.time || "13:00",
    preference: prefOf(d),
    notes: d.notes || "",
  };
}

// Is this customer already waiting for that day? Derived from the waitlist
// itself, so nothing is stored on the conversation, and an entry booked or
// removed from the waitlist panel turns the card's button back on by itself.
export function onWaitlistFor(waitlist, conv) {
  if (!conv || !conv.draftData || !Array.isArray(waitlist)) return false;
  const phone = normalizePhone(conv.phone || conv.phoneKey || "");
  const date = conv.draftData.date;
  if (!phone || !date) return false;
  return waitlist.some(function (w) { return w && w.date === date && normalizePhone(w.phone || "") === phone; });
}
