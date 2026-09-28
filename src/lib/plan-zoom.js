// src/lib/plan-zoom.js
//
// v18.3.0 phase 14 (A8) — the Plan view's zoom and pan limits.
//
// The plan's view is `{k, tx, ty}`: a room point p is drawn at k·p + t, in the
// svg's user units (the room's centimetres; the viewBox is the room). Until
// this phase the limits were a hard `Math.max(0.5, Math.min(5, …))` on the
// zoom and nothing at all on the pan, so the room could be dragged off screen
// (double-tap was then the only way back) and a pinch past either end simply
// stopped following the fingers.
//
// Pure, so the numbers can be tested rather than eyeballed. PlanView owns WHEN
// each applies: the pan bound on every view it sets, the band during a pinch
// only (the wheel keeps the hard stop — a wheel step has no release to spring
// back from), and the spring-back on the pinch's release.

// The zoom's range, unchanged from v17.0.0.
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 5;
// At least this share of the view stays covered by the room on each axis.
export const PAN_KEEP = 0.2;
// A pinch may overshoot either end by at most 25%, measured in log-zoom so the
// band feels the same at both ends (×1.25 above the max, ÷1.25 below the min).
export const RUBBER = Math.log(1.25);

// apple-design §9's rubber band: an overshoot `x` (≥ 0) → a resisted one, which
// grows with x but never reaches RUBBER. 0.55 is that function's own constant.
export function rubber(x) {
  return RUBBER * (1 - 1 / (x * 0.55 / RUBBER + 1));
}

// A pinch's zoom: the raw value inside the range, banded past either end.
export function bandZoom(raw) {
  if (raw > ZOOM_MAX) return ZOOM_MAX * Math.exp(rubber(Math.log(raw / ZOOM_MAX)));
  if (raw < ZOOM_MIN) return ZOOM_MIN / Math.exp(rubber(Math.log(ZOOM_MIN / raw)));
  return raw;
}

// The hard range: the wheel's, and where a banded pinch springs back to.
export function clampZoom(k) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k));
}

// The pan bound. The room spans [t, t + k·W] against a view of [0, W], so
// "PAN_KEEP·W of the view stays covered" is t ≤ (1 − PAN_KEEP)·W (the room
// pushed right) and t + k·W ≥ PAN_KEEP·W (pushed left); the same on y. The
// interval is never empty: it needs k ≥ 2·PAN_KEEP − 1, and k never goes
// below ZOOM_MIN / 1.25.
export function clampPan(v, room) {
  const w = room.w, h = room.h;
  return {
    k: v.k,
    tx: Math.max(PAN_KEEP * w - v.k * w, Math.min((1 - PAN_KEEP) * w, v.tx)),
    ty: Math.max(PAN_KEEP * h - v.k * h, Math.min((1 - PAN_KEEP) * h, v.ty)),
  };
}
