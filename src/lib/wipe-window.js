// src/lib/wipe-window.js
//
// v18.3.0 (phase 3 follow-up) — the window a status-change overlay stays
// mounted for, started when the OVERLAY MOUNTS rather than when the change is
// detected.
//
// TimelineView and ListView each detect a status change in an effect, stamp an
// entry in a module-level map, and re-render; the overlay (`.mgt-wipe-ltr`, or
// the timeline's `.mgt-fade-overlay`) mounts in THAT re-render. Phase 3 derived
// the hold from `--t-wipe` (`exitHold("wipe")`), but both views still counted it
// from the effect's `Date.now()`, one render before the keyframe starts.
// Measured in the rig: the timeline block's overlay unmounted at currentTime 699
// of 760ms and the List card's at 683 (99.94% and 99.89% swept); the old
// hand-typed 800/820 had the same lag with 40ms more slack. The lag is a render
// of the whole view, so on the restaurant's slower tablet it is longer and the
// sliver of old colour that pops off at the end is wider. The form's flash never
// had the problem: its timer starts at the click that mounts its overlay.
//
// So an entry is created PENDING (`until: null`), the overlay arms it from its
// ref callback when it attaches (`armWipe`), and only then does the hold start
// and the re-render that clears it get scheduled. The duration is exactly
// `exitHold("wipe")` from the moment the keyframe starts, at any render speed.
//
// A pending entry is not open forever: if nothing ever mounts an overlay for it
// (a completed booking whose tables are not in the layout renders no block at
// all), it lapses after one hold's worth of time without any re-render, since
// nothing on screen needs clearing. An overlay that mounts after that has lost
// the wipe, which is the right trade against a stale one replaying later.
//
// Kept out of the two views so the rule is written once: two copies of one
// timing rule is how the 800/820 pair drifted from the token in the first place.

import { exitHold } from "./constants";

// A new entry for a change just detected. `fields` carries the view's own data
// (`type` on the timeline, `from` in the List); `rerender` forces the one render
// that removes the overlay once the hold has passed.
export function pendingWipe(fields, rerender) {
  return Object.assign({}, fields, { until: null, at: Date.now(), rerender: rerender });
}

// Is the overlay still to be drawn? Read during render.
export function wipeOpen(a, now) {
  if (!a) return false;
  return a.until != null ? a.until > now : now - a.at < exitHold("wipe");
}

// The overlay attached: start the hold now. Idempotent, so every copy of one
// booking's overlay (a multi-table booking draws one per row) and every
// re-render's fresh ref callback can call it; only the first arms.
export function armWipe(a) {
  if (!a || a.until != null) return;
  a.until = Date.now() + exitHold("wipe");
  setTimeout(a.rerender, exitHold("wipe"));
}
