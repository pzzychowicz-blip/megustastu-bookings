// src/lib/drag-hold.js — v18.17.0 (H)
//
// How long a finger holds a Timeline block before it lifts for a drag. It was a
// fixed 800ms: the status card at 400ms, then the drag. With wet hands on the
// tablet that is a long hold, and whether it is too long is a question for the
// hand holding the device, so it is a per-device choice (Patryk, 2026-11-12).
//
// The pattern is Vibrate on drag (`lib/haptics.js`): per device, in
// `localStorage`, Normal the default, so only another value is ever stored. The
// block reads it at the moment it sets its timer, which is why no prop has to
// reach a block. The status card's 400ms does not move, so even Short (600ms)
// leaves the card a moment before the drag takes over.
//
// A mouse never waits for it: a mouse drag starts on movement.
const KEY = "mgt-tl-drag-hold";

export const DRAG_HOLDS = [
  { id: "short", label: "Short", ms: 600 },
  { id: "normal", label: "Normal", ms: 800 },
  { id: "long", label: "Long", ms: 1000 },
];
export const DEFAULT_DRAG_HOLD = "normal";

function known(id) {
  return DRAG_HOLDS.some(function (h) { return h.id === id; });
}

// An unknown stored value (a typo, a later version's option) reads as Normal.
export function readDragHold() {
  try {
    const v = localStorage.getItem(KEY);
    return known(v) ? v : DEFAULT_DRAG_HOLD;
  } catch {
    return DEFAULT_DRAG_HOLD;
  }
}

export function setDragHold(id) {
  try {
    if (!known(id) || id === DEFAULT_DRAG_HOLD) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch { /* ignore */ }
}

export function dragHoldMs() {
  const id = readDragHold();
  return DRAG_HOLDS.find(function (h) { return h.id === id; }).ms;
}
