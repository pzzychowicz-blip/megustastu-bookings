// src/lib/waitlist-match.js
//
// v17.8.0 — `placeWaitlist`, extracted VERBATIM from the `waitAvail` effect in
// App.jsx so it can be tested.
//
// ── Why it moved ─────────────────────────────────────────────────────────────
// This function decides WHICH TABLE the app offers to each waiting party. It is
// the most consequential piece of logic v17.8.0 changed — v17.8.0 made it
// sequential, because matching every entry independently against the same
// snapshot handed several parties the same table at the same minute — and it
// lived inside a `useEffect` in a 2,900-line component, where no test could
// reach it. "It looked right in DEV" was the entire verification story for a
// double-booking fix.
//
// Nothing about the algorithm changed in the extraction. The effect in App.jsx
// is now the ~10 lines that own the React parts (the clock bucket it keys on,
// the ref mirror, setState); everything below is pure.
//
// ── The algorithm, and why it is shaped like this ────────────────────────────
// Per waiting entry, in FIRST-COME-FIRST-SERVED order (createdAt ascending):
// try the party's wanted time first, then a 15-minute first-fit scan clamped to
// ±`matchWin` around it (a 13:45 slot is no use to a party waiting for 20:30);
// with no wanted time, the whole remaining day.
//
// SEQUENTIAL, with `holds`. Every party that lands is appended to the working
// booking list as a synthetic `_locked` booking, so the next party's scan sees
// that table as occupied. `_locked` is load-bearing: `applyOpt` — the
// reshuffling path inside `trialFits` — copies a locked booking's tables
// through verbatim, so a hold reserves its slot instead of being optimised out
// from under the ghost already drawn for it.
//
// CHEAP-FIRST. `findFreeSlot` (plainly free tables, no reshuffle) is tried
// before the full `trialFits` optimisation, which is expensive enough on a day
// with unplaceable bookings that this scan carries a whole-pass time budget.
//
// ANTI-FLAP. A budget-skipped entry keeps its previous answer rather than
// blinking out of the banner — and that carried-forward answer is HELD too, or
// the parties behind it in the queue can't see it and the double-booking this
// whole shape exists to prevent comes straight back.

import { hoursFor } from "./constants";
import {
  toMins, toTime, getDur, optimizerActiveFor, findFreeSlot, trialFits
} from "./booking-logic";

// Whole-pass budget for the expensive trials, shared across entries.
export const WAIT_SCAN_BUDGET_MS = 300;

// ── v18.2.0 phase 68: a party's seating preference (the critique's L-1) ─────
// An entry remembers the zone the party asked for, and the match tries that
// zone first (findBest inside findFreeSlot, and the optimiser's own order).
//
// v18.3.1 (Patryk): a preference is a WISH everywhere, so the match no longer
// refuses the other zone. Phase 68 made it strict here, deliberately stricter
// than the booking form on an optimiser day; this version made the form a wish
// on every day instead (findFreeSlot now falls back to any zone), and the
// waitlist follows it, so the two say the same. A party booked outside its zone
// is flagged on the timeline and the List card (`offZone`, booking-logic).
function prefOf(w) {
  return w && (w.preference === "indoor" || w.preference === "outdoor") ? w.preference : "auto";
}

/**
 * @param {object}   o
 * @param {Array}    o.bookings      live bookings (App's `liveBookings` memo)
 * @param {Array}    o.waitlist      raw waitlist entries, any order
 * @param {Array}    o.blocks        tableBlocks
 * @param {boolean}  o.autoOptimizer the optimizer thermostat
 * @param {number}   o.nowMins       minutes since midnight, local
 * @param {string}   o.todayStr      "YYYY-MM-DD"
 * @param {number}   [o.matchWin]    ± window around a wanted time (default 90)
 * @param {object}   [o.prev]        last pass's result, for the anti-flap carry
 * @param {number}   [o.budgetMs]    override the scan budget
 * @param {Function} [o.now]         injectable clock (tests)
 * @returns {{[entryId: string]: {tables: string[], time: string, resh: boolean}}}
 */
export function placeWaitlist(o) {
  const bookings = o.bookings || [];
  const waitlist = o.waitlist || [];
  const blocks = o.blocks || [];
  const prev = o.prev || {};
  const matchWin = o.matchWin || 90;
  const budgetMs = typeof o.budgetMs === "number" ? o.budgetMs : WAIT_SCAN_BUDGET_MS;
  const clock = o.now || Date.now;
  const todayStr = o.todayStr;
  const nowMins = o.nowMins;

  const next = {};
  const scanT0 = clock();
  const holds = [];

  function hold(w, size, dur, res) {
    holds.push({
      id: "__wait_" + w.id, name: "", phone: "", date: w.date, time: res.time,
      size: size, duration: dur, preference: prefOf(w), notes: "", status: "confirmed",
      tables: res.tables, customDur: null, _manual: true, _locked: true, _conflict: false,
      preferredTables: [], history: []
    });
  }

  // FCFS decides who gets a contested table — the same order the waitlist panel
  // and the banner present, not whatever order the Firebase node's children
  // arrived in. Sequential placement is only FAIR if the sequence is.
  const queue = waitlist.slice().sort(function (a, b) {
    return ((a && a.createdAt) || 0) - ((b && b.createdAt) || 0);
  });

  queue.forEach(function (w) {
    if (!w || w.status !== "waiting" || !w.date || w.date < todayStr) return;
    const h = hoursFor(w.date);
    if (h.closed) return;
    const size = Number(w.size) || 2;
    const dur = getDur(size);
    const pref = prefOf(w);
    const noResh = !optimizerActiveFor(w.date, o.autoOptimizer);
    const fromM = w.date === todayStr ? Math.max(nowMins, h.open * 60) : h.open * 60;
    let scanLo = Math.ceil(fromM / 15) * 15;
    let scanHi = h.close * 60 - dur;
    let budgetHit = false;
    // Which branch produced the hit. The cheap findFreeSlot path (and any hit
    // while noResh is true) places the party on tables that are free exactly as
    // the Timeline draws them; the reshuffling trialFits path may only be
    // reachable by MOVING other parties first, and the ghost renders dashed for
    // that case rather than solid over a visibly occupied table.
    let lastResh = false;

    const tryFit = function (timeStr) {
      const world = holds.length ? bookings.concat(holds) : bookings;
      if (!noResh) {
        const cheap = findFreeSlot(world, w.date, timeStr, size, pref, dur, blocks, null, null);
        if (cheap) { lastResh = false; return cheap; }
      }
      if (clock() - scanT0 > budgetMs) { budgetHit = true; return null; }
      const t = trialFits(world, w.date, timeStr, size, pref, dur, blocks, null, null, noResh);
      // noResh === true means trialFits was forbidden from moving anyone, so
      // its answer is a clean placement too.
      if (t) lastResh = !noResh;
      return t;
    };

    if (w.prefTime) {
      const sm = toMins(w.prefTime);
      if (sm >= fromM && sm + dur <= h.close * 60) {
        const t = tryFit(w.prefTime);
        if (t) { const r = { tables: t, time: w.prefTime, resh: lastResh }; next[w.id] = r; hold(w, size, dur, r); return; }
      }
      scanLo = Math.max(scanLo, Math.ceil((sm - matchWin) / 15) * 15);
      scanHi = Math.min(scanHi, sm + matchWin);
    }

    for (let m = scanLo; m <= scanHi && m < 24 * 60; m += 15) {
      const t = tryFit(toTime(m));
      if (t) { const r = { tables: t, time: toTime(m), resh: lastResh }; next[w.id] = r; hold(w, size, dur, r); break; }
    }

    // Anti-flap carry-forward — see the header. Held too, deliberately.
    if (!next[w.id] && budgetHit && prev[w.id]) {
      const r = prev[w.id];
      next[w.id] = r;
      hold(w, size, dur, r);
    }
  });

  return next;
}

// ── withoutHeld: the waitlist without the parties being booked (v18.4.8) ─────
// A party booked from the panel stays in the stored waitlist until its booking
// LANDS (the write's `onLanded` removes it), so a booking that never lands has
// not lost it. Until then it is held on this device: left out of everything
// that reads the waitlist, so it cannot be booked a second time. Returns the
// list itself when nothing in it is held, so a memo or an effect keyed on the
// list does not see a change that is not one.
export function withoutHeld(list, heldIds) {
  if (!heldIds || !heldIds.length) return list;
  const out = list.filter(function (w) { return !(w && heldIds.includes(w.id)); });
  return out.length === list.length ? list : out;
}
