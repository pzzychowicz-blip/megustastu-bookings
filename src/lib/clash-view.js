// src/lib/clash-view.js
//
// v18.6.0 (ROADMAP #17, the render) — what the screen draws from a day's
// double-bookings, moved out of three `useMemo`s in BookingApp. `findClashes`
// (booking-logic.js) reports PAIRS; the strip wants the pairs nobody dismissed,
// a timeline block wants who IT clashes with and on which tables, and a
// timeline row wants the minutes claimed twice. Pure, so a test can run them
// (the v17.8.0 rule); App keeps the memos, the dismissal Set and the EMPTY
// identities its memoised views compare.
import { clashRowId, mergeSpans } from "./booking-logic.js";

// The pairs still shown in the strip: all of them less the dismissed rows.
// THE SAME ARRAY when nothing is dismissed, so a memo downstream does not
// re-run. Dismissing a row quiets the row; the block markers below are built
// from every pair, because the double-booking has not stopped being true.
export function undismissedClashes(pairs, dismissed) {
  if (!dismissed || dismissed.size === 0) return pairs;
  return pairs.filter(function (c) { return !dismissed.has(clashRowId(c)); });
}

// Per booking id: `{names, tables}`, the other parties it clashes with and the
// tables they share, each listed once in the order met. A pair naming a booking
// that is no longer in the list contributes nothing.
export function clashByBooking(pairs, bookings) {
  const byId = {};
  (bookings || []).forEach(function (b) { byId[b.id] = b; });
  const map = {};
  function add(id, other, c) {
    if (!map[id]) map[id] = { names: [], tables: [] };
    if (other && map[id].names.indexOf(other.name) < 0) map[id].names.push(other.name);
    c.tables.forEach(function (t) { if (map[id].tables.indexOf(t) < 0) map[id].tables.push(t); });
  }
  (pairs || []).forEach(function (c) {
    const A = byId[c.a], B = byId[c.b];
    if (!A || !B) return;
    add(c.a, B, c); add(c.b, A, c);
  });
  return map;
}

// Per table id: the `[{from, to}]` minutes claimed twice, merged (v17.14.0: one
// band per distinct span, so three bookings clashing on one table draw one
// band, not three on the same pixels). A pair whose `tables` is empty (the
// join-cluster case, see `findClashes`) has no row to belong on and adds none.
export function clashSpansByTable(pairs) {
  const map = {};
  (pairs || []).forEach(function (c) {
    c.tables.forEach(function (t) {
      if (!map[t]) map[t] = [];
      map[t].push({ from: c.from, to: c.to });
    });
  });
  Object.keys(map).forEach(function (t) { map[t] = mergeSpans(map[t]); });
  return map;
}
