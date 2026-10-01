// src/lib/unplaced.js
//
// v18.2.0 — which of a day's bookings are NOT properly on the timeline grid, and
// why. One answer, read by three surfaces that must agree: the timeline's
// Unplaced row, the notification strip's "Not on the grid" section, and the
// summary's "N of M on the grid".
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The timeline drew a booking once per table it holds, on that table's ROW —
// and a table id the layout does not have has no row. Found by the v18.2.0
// design critique on DEV: on 3 Oct, 8 of 12 bookings referenced tables `1`,
// `5`, `8`–`13` against a layout of `1A/1B`, `2`–`4`, `5A/5B`, `6`, `7`,
// `i1`–`i4`, so the header said 12 bookings and 37 covers while the grid drew 4,
// and nothing anywhere said why. That DEV data was a stale seed, but renaming or
// removing a table in Settings → Layout does the same to real bookings the
// optimiser cannot move — a LOCKED booking (every walk-in, drag and manual
// assign) keeps its stored tables verbatim through `applyOpt`.
//
// A booking with NO tables and one the optimiser flagged `_conflict` already had
// a row of their own ("unassigned", at the bottom). Patryk's call: one row for
// all three, at the TOP, called Unplaced.
//
// ── The three reasons ────────────────────────────────────────────────────────
//   "none"     — no tables at all
//   "missing"  — one or more of its tables is not a row on the grid. A booking
//                with SOME real tables (tables 1 and 2, with only 2 existing) is
//                still drawn on 2 and ALSO listed here, so the gap is visible —
//                the shape `_conflict` bookings already had
//   "conflict" — the optimiser could not place it (`_conflict`)
// Checked in that order; `missing` names the absent ids.
//
// ── What is never unplaced ───────────────────────────────────────────────────
// Cancelled (not drawn anywhere; the views filter it out) and COMPLETED. The
// old row already excluded completed, and the app-wide rule agrees: a completed
// visit's table is free, the visit is history, and there is nothing to do about
// where it sat. So "on the grid" in the summary means "not in this list".
//
// Pure: the grid's table ids come in as an argument, never read from the
// `TIMELINE_TABLES` live binding here, so a caller that memoises can key on
// the layout and this stays testable without one.

/**
 * @param {object} b          a booking
 * @param {Set<string>} gridIds the ids of the tables the grid draws a row for
 * @returns {null | {reason: "none"|"missing"|"conflict", missing: string[]}}
 */
export function unplacedReason(b, gridIds) {
  if (!b || b.status === "cancelled" || b.status === "completed") return null;
  const tables = Array.isArray(b.tables) ? b.tables : [];
  if (tables.length === 0) return { reason: "none", missing: [] };
  const missing = tables.filter(function (t) { return !gridIds.has(t); });
  if (missing.length) return { reason: "missing", missing: missing };
  if (b._conflict) return { reason: "conflict", missing: [] };
  return null;
}

/**
 * The day's unplaced bookings, in the order given, each with its reason.
 * @param {object[]} dayBookings  ONE date's bookings
 * @param {Set<string>} gridIds
 * @returns {{b: object, reason: string, missing: string[]}[]}
 */
export function unplacedOf(dayBookings, gridIds) {
  const out = [];
  (dayBookings || []).forEach(function (b) {
    const r = unplacedReason(b, gridIds);
    if (r) out.push({ b: b, reason: r.reason, missing: r.missing });
  });
  return out;
}

/**
 * The booking's PRIMARY row: its first table that the grid actually draws, or
 * null when none is. Decides which cell carries the booking's FLIP id — that
 * row's cell, else the Unplaced row's — so there is exactly one element per id,
 * the rule useFlip needs. It used to be `tables[0]`, which for "tables 1 and 2"
 * with only 2 on the grid named a row that does not exist, and the booking
 * carried no FLIP id at all.
 */
export function primaryGridTable(b, gridIds) {
  const tables = Array.isArray(b && b.tables) ? b.tables : [];
  for (let i = 0; i < tables.length; i++) if (gridIds.has(tables[i])) return tables[i];
  return null;
}

/** The strip row's reason, as a phrase: "tables 11, 12 aren't in the layout". */
export function unplacedPhrase(u) {
  if (u.reason === "none") return "no table assigned";
  if (u.reason === "conflict") return "couldn't be placed on a table";
  return u.missing.length === 1
    ? "table " + u.missing[0] + " isn't in the layout"
    : "tables " + u.missing.join(", ") + " aren't in the layout";
}

/**
 * Pack intervals into the fewest LANES with no overlap inside a lane — the
 * Unplaced row's layout. A table row holds one party at a time by definition;
 * the Unplaced row holds whatever is unplaced, so on 3 Oct it had nine parties
 * between 20:00 and 23:45 painted on top of each other in ONE row, which is the
 * invisibility this row exists to end, moved up a level. (The old "unassigned"
 * row had the same flaw and rarely held more than one booking.)
 *
 * Greedy by start time, first lane whose last end is <= the start (touching
 * intervals share a lane: 20:00–21:30 then 21:30–23:00). Sorted by start then
 * id, so the same bookings land in the same lanes on every device and render.
 *
 * @param {{id: string, s: number, e: number}[]} items  minutes, e > s
 * @returns {object[][]} lanes, each a list of the input items
 */
export function packLanes(items) {
  const sorted = (items || []).slice().sort(function (a, b) {
    return a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const lanes = [];
  const ends = [];
  sorted.forEach(function (it) {
    let i = 0;
    while (i < lanes.length && ends[i] > it.s) i++;
    if (i === lanes.length) { lanes.push([]); ends.push(-Infinity); }
    lanes[i].push(it);
    ends[i] = Math.max(ends[i], it.e);
  });
  return lanes;
}

/**
 * v18.3.2 (O4): the Unplaced row's height for a number of lanes. The row EASES
 * to it (TimelineView), in both columns, so the table rows below travel with it.
 *
 * @param {number} lanes  how many lanes the row holds
 * @param {number} rowH   one lane's height (a table row's)
 * @param {number} gap    the space under the row, inside its height
 * @returns {number} px; 0 when there are no lanes, gap included
 */
export function unplacedHeight(lanes, rowH, gap) {
  return lanes > 0 ? lanes * rowH + gap : 0;
}
