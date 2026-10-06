// src/lib/print-timeline.js
//
// v18.4.0 — the printed timeline's two facts that are not markup
// (components/TimelineSheet.jsx draws with them; a component file may export
// nothing but its component).

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
