// src/lib/clamp.js
//
// v17.10.2 — `clampStep`, the settings-sanitiser primitive. Every settings hook
// reads numbers out of a Firebase node that a hand-edit, an older client or a
// half-written write could have left as anything at all, and every one of them
// needs the same answer: snap to the field's step, fall back to the default when
// the value is not a number, then hold it inside the field's bounds.
//
// It lived twice — verbatim, same signature, same body — in
// `useBookingDefaults.js` and `useGeneralSettings.js`, and the SECOND copy is
// what makes this worth moving rather than tolerating. It carried the comment
//
//     // NaN check AFTER the round (see useBookingDefaults for the why).
//
// so the code already knew it was a copy and pointed at the original instead of
// importing it. A third settings hook would have made a third copy.
//
// The ordering that comment protects is real and easy to "tidy" wrongly: a
// non-numeric or absent `n` makes `Number(n)` NaN, which propagates through
// `Math.round(n / step) * step` unchanged — so the finite check has to sit AFTER
// the round. Checked before it, a value that is a number but off-grid would
// still round fine, and a value that is NOT a number would round to NaN and then
// escape through `Math.max`/`Math.min` as NaN, which is how a stepper ends up
// rendering "NaN min" and writing it back.
export function clampStep(n, def, min, max, step) {
  let v = Math.round(Number(n) / step) * step;
  if (!Number.isFinite(v)) v = def;
  return Math.max(min, Math.min(max, v));
}
