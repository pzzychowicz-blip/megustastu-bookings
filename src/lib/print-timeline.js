// src/lib/print-timeline.js
//
// v18.4.0 — the printed timeline's two facts that are not markup
// (components/TimelineSheet.jsx draws with them; a component file may export
// nothing but its component).

import { visibleRail } from "./block-layout.js";

// The LIGHT theme's block fills, as literals: print stays light in any theme,
// and these are index.css `:root`'s `--block-*` values, which is what "status
// colours as on screen" means on white paper. `tests/print-timeline.test.js`
// holds each one to the stylesheet. Cancelled is absent: the sheet draws no
// cancelled booking.
export const PRINT_FILL = {
  confirmed: "rgba(217, 119, 6, 0.92)", /* @fixed-fill */
  pending: "rgba(234, 179, 8, 0.92)", /* @fixed-fill */
  seated: "rgba(24, 111, 56, 0.85)", /* @fixed-fill */
  completed: "rgba(140, 140, 150, 0.7)", /* @fixed-fill */
};

// A span in minutes → its left and width in PERCENT of the printed range,
// clipped to it; null when it lies outside (or the range is empty).
// `cutL` / `cutR` say which end the range cut, so the block squares that end.
export function spanIn(s, e, fromM, toM) {
  const a = Math.max(s, fromM), b = Math.min(e, toM);
  if (!(b > a) || !(toM > fromM)) return null;
  const w = toM - fromM;
  return { left: ((a - fromM) / w) * 100, width: ((b - a) / w) * 100, cutL: s < fromM, cutR: e > toM };
}

// What the print chooser opens with, in whole hours: the day's opening hour to
// its closing hour, or to the end of its last booking where that runs later
// (the range the screen's grid draws). `max` lets To reach the grid's last hour.
export function printRange(hours, latestEndMins) {
  const open = hours.open;
  const last = Number.isFinite(latestEndMins) ? Math.min(26, Math.ceil(latestEndMins / 60)) : 0;
  const to = Math.max(hours.close, last, open + 1);
  return { from: open, to: to, min: open, max: Math.max(to, hours.gridClose) };
}

// ── v18.4.10: which flags fit a printed block ───────────────────────────────
// The sheet's geometry is in percent, so a block does not know its width, and
// a narrow one cut its flags off at its right edge (`overflow: hidden`) while
// the key under the grid still explained them. Measured in a print layout at
// this page width: a 45-minute booking in a 13:00–23:00 print was 73.9px wide
// and both of its flags lay outside it.
//
// The width comes from the page the stylesheet ASKS for: `@page mgt-timeline`
// is A4 landscape with 10mm margins, 277mm, 1047px at 96 to the inch
// (`tests/print-timeline.test.js` holds this to the rule). A browser that
// ignores the rule and prints portrait gets blocks narrower than assumed, and
// can still cut a flag; a wider page only leaves room unused.
export const PRINT_PAGE_PX = 1047;

// A block's parts, measured in that layout (px): the edge is its border and
// padding on one side; the time was 29.1–30.9 over nine blocks; a digit of the
// party size 6.56; the status mark and a flag are their icon sizes. The name
// is not here: it shrinks to nothing before a flag is cut, as it always has.
export const PRINT_BLOCK = { edge: 5, gap: 4, time: 31, digit: 6.6, status: 12, flag: 14 };

// The flags a block `widthPct` wide (of a `trackPx` track) has room for, the
// least important dropped first and rail order kept: the screen's own rule
// (`visibleRail`), with the print block's widths.
export function fittingFlags(widthPct, trackPx, flags, size) {
  const P = PRINT_BLOCK;
  const digits = String(size == null ? "" : size).length || 1;
  // edge · time · gap · name (0) · gap · size · gap · status · edge
  const fixed = 2 * P.edge + P.time + 3 * P.gap + digits * P.digit + P.status;
  return visibleRail((widthPct / 100) * trackPx, fixed, 0, P.gap + P.flag, flags).flags;
}
