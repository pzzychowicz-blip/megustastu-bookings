// src/lib/time-grid.js
//
// v17.9.0 — the shared vocabulary of the app's two time strips.
//
// ── Why this exists, and why it is NOT a shared component ────────────────────
// `ROADMAP.md` carried an idea to unify TimelineView's grid header with
// TimeAxis, on the grounds that they draw "the same 24px hour strip / quarter
// ticks / centred hour pills / now marker" and that "both use pct()". Neither
// held up on inspection:
//
//   • TimelineView positions by PERCENTAGE (booking-logic's pct(), against a
//     grid whose width is set by the container). TimeAxis positions by PIXELS
//     (xOf(), against a fixed trackW of 24px per quarter). That is not a detail
//     — it is the reason TimeAxis's `padding-inline: 50%` scroll maths works and
//     the reason TimelineView can reflow to any width.
//   • TimelineView's ticks are full-height borderLeft gridlines. TimeAxis's are
//     mirrored 13px/7px marks at top and bottom — the pair of edges is what
//     makes it read as a tape measure instead of a chart axis.
//   • TimelineView's hour labels are pills on --tl-hour-pill in white at T.micro.
//     TimeAxis's are plain --text-secondary at T.body, centred between the tick
//     rows.
//
// A shared renderer would have to straddle both positioning models and both
// label treatments, and all of that risk lands in TimelineView's scroll-follow,
// FLIP and drag-and-drop markup for no user-visible gain. So the extraction is
// deliberately narrow: only what is genuinely duplicated moves, and no component
// is unified. The two strips stay two strips.
//
// ── What was actually duplicated ─────────────────────────────────────────────
// The HH:00 label, in three different modulo behaviours across eight files. Two
// of the three turned out to be the same function written twice:
//
//   ((n % 24) + 24) % 24   wrap-safe    Summary.hh, Settings MiniStepper,
//                                       Settings hhLabel
//   n % 24                 equivalent   Settings HourStepper, TimelineView,
//                          in range     TimeAxis, BlockModal — every caller's
//                                       input is non-negative, so this differs
//                                       from wrap-safe only in defensiveness
//   String(n)              no wrap      WeekView (h is 0–23 by construction)
//
// The third behaviour is NOT drift and is NOT unified: Settings' `cutoffLabel`
// deliberately renders 24 as "24:00" rather than "00:00", because the optimizer
// cutoff is a full-day endpoint where 0 ("off all day") and 24 ("on all day")
// are both meaningful and must not collide. It keeps its own formatter, and the
// comment above it says why.
//
// The lesson worth carrying: "N copies of one line" is a claim to CHECK, not to
// act on. Six of these were one function; one was a different function that
// happened to look similar, and unifying it would have silently broken a
// setting.

// Hours past midnight are real here — a past-midnight close gives GRID_CLOSE up
// to 26, so hour 25 must render as "01:00". The double modulo also survives a
// negative input, which no current caller produces but which costs nothing to be
// safe about; the alternative is a label reading "-1:00".
export function hourLabel(hours) {
  return String(((Math.trunc(hours) % 24) + 24) % 24).padStart(2, "0") + ":00";
}

// The same label from a minute offset, which is the unit both time strips work
// in. Separate from hourLabel rather than folded into it: the two take different
// UNITS, and a single function that guessed which one it was given would be a
// bug waiting for the first caller whose hour count exceeds 60.
export function hourLabelAt(mins) {
  return hourLabel(mins / 60);
}

// Whether a quarter-grid minute falls on the hour. Both strips loop QUARTER_HOURS
// and branch on this to pick a tick's length, width and colour.
export function isHourMark(mins) {
  return mins % 60 === 0;
}
