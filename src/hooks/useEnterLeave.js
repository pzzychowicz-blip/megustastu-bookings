// src/hooks/useEnterLeave.js
//
// v18.3.0 (O1) — which items of a list ARRIVED and which LEFT since the list
// last changed, so a view can fade them in and out instead of letting them
// teleport. Written for the timeline's booking blocks: "No show" took a block
// from full opacity to gone between two frames, and Undo put it back the same
// way (measured in the rig).
//
// ── Why not useRevealRows ────────────────────────────────────────────────────
// The waitlist ghosts beside the blocks already fade both ways through
// useRevealRows, and the plan named it. It cannot carry blocks, for two reasons
// found reading it rather than assumed:
//
//   * Its membership diff runs in a PASSIVE effect, after paint. That is fine
//     for a departure (the held id is still in `renderIds` when the view
//     renders) and too late for an arrival. A ghost can wear `mgt-appear`
//     unconditionally, because every ghost mount IS an arrival; a block mounts
//     for many reasons that are not (a date change, a move to another row, a
//     view switch), so its class is decided per id, by a diff that must already
//     have run when the block first paints. Decided after paint, the newcomer
//     shows once at full opacity and then drops to 0 to fade in: the ghost's
//     own /code-review defect, "a pop, then a fade", in a new place.
//   * A departed block has to be drawn as it LAST LOOKED — its status colour,
//     and the late / overstay / double-booked border that is usually the reason
//     it is leaving. After the change those are gone from every map the view
//     reads. The only way to keep them without a diff is a ref written during
//     render, which useRevealRows' own header rules out (a render may be
//     discarded, and a ref written there survives it).
//
// So the diff runs DURING render, in state — React's documented "adjust state
// when a prop changes", the same shape useRevealRows uses for its `resetKey`.
// The update re-runs the caller's body once before anything commits, so the
// first frame that shows an arrival already carries its class, and the first
// frame without a departed item already shows its snapshot. One diff answers
// arrivals, departures and what a departure looked like, so there is one diff.
//
// ── Contract ─────────────────────────────────────────────────────────────────
//   resetKey  a REPLACEMENT of the list, not a change (useRevealRows' meaning,
//             DESIGN.md): on a change of it nothing fades, and anything
//             mid-fade is dropped. The timeline passes the viewed date.
//   deps      the identities the snapshots are built from. When any of them
//             changes, `capture` is called and the diff runs. They MUST be
//             stable between two runs of one render — props, state, memos, a
//             boolean — never a `{}` or `[]` created in the body, or the update
//             below never settles and React throws "Too many re-renders".
//   capture   () => Map(id → snapshot) for the CURRENT render. Its keys are the
//             list's membership; a snapshot is whatever the caller needs to
//             draw that item again. Called only when a dep changed.
//   opts.quiet  v18.3.1: true while every change is a catch-up nobody watched
//             (the reconnect after wake); a diff taken then re-seeds like
//             resetKey. A diff while the page is hidden always does.
//   opts.speed  the `M` entry the caller's enter/exit classes run on, so the
//             hold is derived from the same token (useRevealRows' `speed`).
//
// Returns { leaving, arriving }:
//   leaving   [snapshot…] — items gone from the list, held for exitHold(speed)
//             so their exit can play. An item that comes back is dropped from it
//             at once: it is live again.
//   arriving  Set(id) — items new to the list, held for the same window. The
//             caller's entrance class must stay on for the animation's length,
//             since removing an animation class cancels the animation.
//
// Both holds clear everything at once, exitHold(speed) after the LAST change.
// Clearing late is harmless: a finished `mgt-appear` with no fill changes
// nothing, and a finished `mgt-ghost-out` sits at opacity 0, inert. Clearing
// EARLY is the failure every hold in this app exists to prevent — and here the
// commit was not early-proof, which is `afterFrame`'s reason (lib/after-frame.js).

import { useState, useEffect } from "react";
import { exitHold } from "../lib/constants";
// A hold starts on the NEXT FRAME, not in the effect: this hook's measurement
// found it (No show removed at 221 of 240ms), and the helper moved to lib so
// usePresenceLifecycle (atoms) could share it. lib/after-frame.js has the why.
import { afterFrame } from "../lib/after-frame";

// Module constants, so "nothing" is one identity and an idle list never hands
// its caller a fresh Map or Set.
const NO_SNAPS = new Map();
const NO_IDS = new Set();

// v18.3.1 (ROADMAP, found by v18.3.0's /code-review): a change nobody could see
// is not animated. The holds start on the next animation FRAME and a hidden page
// renders none, so every change that landed while the tablet's screen was off
// waited and then played at once on wake. Measured on the restaurant's tablet
// (DEV tab, screen off 37s, two bookings added and one deleted from another
// device): on wake one block faded in at +0.4s, and at +1.8s the DELETED booking
// reappeared from its snapshot and faded out while the other new one faded in.
// So a diff taken while the page is hidden is a REPLACEMENT, exactly like a
// resetKey change: the list re-seeds, nothing is held, nothing fades.
//
// Hidden is only half of it. The same measurement showed the tablet dropping
// its connection ~6s after the screen went off, so most changes are not diffed
// while hidden at all: they arrive in the CATCH-UP after wake, 0.5s after the
// reconnect (with "Reconnected — changes synced." up), while the page is
// visible. `opts.quiet` is the caller's word for that window (TimelineView's
// `catchingUp`), and a diff taken inside it is a replacement too.
function pageHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function sameDeps(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function useEnterLeave(resetKey, deps, capture, opts) {
  const hold = exitHold((opts && opts.speed) || "move");
  const [seen, setSeen] = useState(function () { return { key: resetKey, deps: deps, snaps: capture() }; });
  const [leaving, setLeaving] = useState(NO_SNAPS);
  const [arriving, setArriving] = useState(NO_IDS);

  const quiet = !!(opts && opts.quiet);
  if (seen.key !== resetKey || (!sameDeps(seen.deps, deps) && (quiet || pageHidden()))) {
    // A replacement: re-seed exactly as on first mount. A change while the
    // page is hidden, or inside the caller's quiet window, is one too (above).
    setSeen({ key: resetKey, deps: deps, snaps: capture() });
    if (leaving.size) setLeaving(NO_SNAPS);
    if (arriving.size) setArriving(NO_IDS);
  } else if (!sameDeps(seen.deps, deps)) {
    const snaps = capture();
    const departed = [];
    seen.snaps.forEach(function (s, id) { if (!snaps.has(id)) departed.push(id); });
    const arrived = [];
    const returned = [];
    snaps.forEach(function (s, id) {
      if (!seen.snaps.has(id)) arrived.push(id);
      if (leaving.has(id)) returned.push(id);
    });
    setSeen({ key: resetKey, deps: deps, snaps: snaps });
    if (departed.length || returned.length) {
      const next = new Map(leaving);
      returned.forEach(function (id) { next.delete(id); });
      departed.forEach(function (id) { next.set(id, seen.snaps.get(id)); });
      setLeaving(next);
    }
    if (arrived.length) {
      const next = new Set(arriving);
      arrived.forEach(function (id) { next.add(id); });
      setArriving(next);
    }
  }

  useEffect(function () {
    if (!leaving.size) return undefined;
    return afterFrame(function () { setLeaving(NO_SNAPS); }, hold);
  }, [leaving, hold]);
  useEffect(function () {
    if (!arriving.size) return undefined;
    return afterFrame(function () { setArriving(NO_IDS); }, hold);
  }, [arriving, hold]);

  return { leaving: Array.from(leaving.values()), arriving: arriving };
}
