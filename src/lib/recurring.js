// src/lib/recurring.js
//
// v18.3.3 — which standing-booking occurrences are due. The generator effect in
// App (v16.3.0) decided this inline; it moved here so a test can reach it
// (tests/CLAUDE.md: logic that decides something the restaurant acts on does
// not live in a useEffect). The effect keeps its subscription and its write.
// v18.4.4 (ROADMAP #17): what that write does to the list moved here too,
// `withOccurrences`, so the generator's two decisions (which are due, and where
// each one goes) are both plain functions; App keeps the guard and the dispatch.
//
// The bug that moved it: a rule had NO START. The generator walked every
// matching weekday from TODAY across the horizon, so "Repeat weekly" on a
// booking three weeks out also booked the party tonight and on the two weeks
// in between. Measured on DEV: a weekly booking starting Thu 22 Oct created
// bookings on 1, 8 and 15 Oct. A rule now starts where its first booking is.

import { hoursFor } from "./constants.js";
import { toMins, lastStartMins, optimizerActiveFor, bookingsAfterAction } from "./booking-logic.js";
import { occurrenceBooking } from "./booking-save.js";
import { matchesIdentity, normalizePhone } from "./customers.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The first date a rule may book. A rule written since v18.3.3 carries it
// (`startDate`, the date of the booking "Repeat weekly" was ticked on). An
// older rule is given the date of its earliest booking stamped by the FORM,
// i.e. not one of the generator's own (those have the deterministic id
// "r"+ruleId+"_"+date) — derived from bookings every device holds, so two
// devices agree without writing anything. A rule with neither (its first
// booking deleted, or older data) keeps the old behaviour: no lower bound.
export function ruleStart(rule, bookings) {
  if (rule && ISO_DAY.test(rule.startDate || "")) return rule.startDate;
  let first = null;
  (bookings || []).forEach(function (b) {
    if (!b || b.recurringId !== rule.id || !ISO_DAY.test(b.recurringDate || "")) return;
    if (b.id === "r" + rule.id + "_" + b.recurringDate) return;
    if (first === null || b.recurringDate < first) first = b.recurringDate;
  });
  return first;
}

// Every occurrence the generator should create now: active rules, each
// matching weekday AFTER the rule's start (and from today) to today + horizonDays,
// minus skipped dates, closed days, times the day does not take, and
// occurrences that already exist (by their immutable recurringId + date
// stamps, so a moved or cancelled one is never re-created).
//
// The start is EXCLUSIVE: the booking "Repeat weekly" was ticked on owns that
// date, and the generator never makes it. Inclusive, the date was safe only
// while every device saw the booking no later than the rule, and the two are
// separate writes to separate nodes. Measured on DEV with the inclusive test: a
// device that had the rule and not yet the booking created "r<rule>_<start>"
// beside the form's own booking, two parties for one. A derived start is the
// date of an existing booking, so the test reads the same for it either way.
//
// The time test is `lastStartMins(close)`, the minute the booking form, its
// Time field and `findTimes` all name as the last start. The loop tested
// `close*60`, so a rule could create a booking the form itself refuses once
// the day's hours were shortened (the CLAUDE.md row on a guard that names a
// different number than its message).
export function dueOccurrences(rules, bookings, today, horizonDays) {
  const existing = {};
  (bookings || []).forEach(function (b) {
    if (b && b.recurringId && b.recurringDate) existing[b.recurringId + "|" + b.recurringDate] = true;
  });
  const due = [];
  (rules || []).forEach(function (rule) {
    if (!rule || !rule.active) return;
    const skip = rule.skipDates || [];
    const start = ruleStart(rule, bookings);
    for (let i = 0; i <= horizonDays; i++) {
      const d = new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      if (d.getUTCDay() !== rule.weekday) continue;
      const ds = d.toISOString().slice(0, 10);
      if (start !== null && ds <= start) continue;
      if (skip.indexOf(ds) !== -1) continue;
      const h = hoursFor(ds);
      if (h.closed) continue;
      const sm = toMins(rule.time);
      if (sm < h.open * 60 || sm > lastStartMins(h.close)) continue;
      if (existing[rule.id + "|" + ds]) continue;
      due.push({ rule: rule, date: ds });
    }
  });
  return due;
}

// ── withOccurrences: the list with the due occurrences added and placed ──────
// v18.4.4 (ROADMAP #17): the body of the generator's `saveBookings` updater,
// moved out of App verbatim. `due` is `dueOccurrences`' answer, taken once by
// the effect; `prev` is whatever list the write is applied to, which on a held
// and replayed write is NOT the list `due` was computed from. So existence is
// asked again here, of `prev`: an occurrence already there — by its
// deterministic id, or by its rule and date stamps — is not added twice.
//
// Placement is per date, after that date's occurrences are in:
//   · where the optimiser owns the day (`optimizerActiveFor`: every day but
//     today after the cutoff), ONE pass places all of them;
//   · where it does not, a pass with no `changedId` copies every row as it is,
//     so (v18.3.5) each new occurrence is placed by itself, as a new booking
//     saved then is: the best free table, nobody else moved, `_conflict` when
//     there is none.
// The optimiser's pass runs for a date even when nothing was added to it,
// which is the effect's behaviour since v16.3.0 and is kept.
export function withOccurrences(prev, due, tableBlocks, autoOptimizer) {
  let next = prev;
  const byDate = {};
  (due || []).forEach(function (oc) { (byDate[oc.date] = byDate[oc.date] || []).push(oc); });
  Object.keys(byDate).forEach(function (ds) {
    const added = [];
    byDate[ds].forEach(function (oc) {
      const rule = oc.rule;
      const nb = occurrenceBooking(rule, ds);
      if (next.some(function (b) { return b.id === nb.id || (b.recurringId === rule.id && b.recurringDate === ds); })) return;
      next = next.concat([nb]);
      added.push(nb.id);
    });
    if (optimizerActiveFor(ds, autoOptimizer)) next = bookingsAfterAction(next, ds, tableBlocks, null, false, autoOptimizer);
    else added.forEach(function (id) { next = bookingsAfterAction(next, ds, tableBlocks, id, true, autoOptimizer); });
  });
  return next;
}

// ── rulesOfCustomer: the standing bookings "Delete customer" must take ───────
// v18.5.1. Delete customer anonymised the bookings and left the rule, which
// holds the name, the phone and the notes and writes them onto every new week
// (`occurrenceBooking`). Measured on DEV in v18.5.0: after the delete the rule
// was unchanged, and the next generated week carried all three again.
//
// A rule is the customer's when its own phone is theirs. A rule with no phone
// cannot say whose it is, so it is theirs when one of THEIR bookings is stamped
// with it (the booking "Repeat weekly" was ticked on carries the guest's
// `guestId`; the generated weeks do not). That second test is asked only of a
// phone-less rule: a single week of somebody's standing booking given to a
// friend's number must not take the standing booking when the friend is deleted.
// Returns the rule ids. `ident` is `matchesIdentity`'s ({phone, guestId, guestIds}).
export function rulesOfCustomer(rules, bookings, ident) {
  const key = normalizePhone(ident && ident.phone);
  const stamped = {};
  (bookings || []).forEach(function (b) {
    if (b && b.recurringId && matchesIdentity(b, ident)) stamped[b.recurringId] = true;
  });
  return (rules || []).filter(function (r) {
    if (!r) return false;
    const own = normalizePhone(r.phone);
    return own ? own === key : stamped[r.id] === true;
  }).map(function (r) { return r.id; });
}
