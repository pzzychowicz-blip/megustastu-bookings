// src/hooks/useDeferredCompute.js
//
// v16.3.0 perf phase 2 — post-paint deferred computation for the availability
// scans. The form's trialFits/findTimes scans used to run synchronously in
// render at modal MOUNT, so on a pathological day (an unplaceable booking makes
// each optimise() expensive — see the CLAUDE.md "Availability scans in render"
// gotcha) the New/Walk-in modal could not paint until the scanning finished.
// This hook moves the compute OFF the mount-critical path: the modal paints
// instantly, a "checking…" cue paints next, and only THEN does the scan run.
//
//   const { value, pending } = useDeferredCompute(computeFn, deps);
//
//   value   — computeFn's result; NULL until the first result AND reset to null
//             on every deps change (Patryk-chosen: never show a stale answer —
//             the availability banner collapses while re-checking).
//   pending — true from a deps change until its result lands. Consumers show
//             the ⏳ indicator on it, wrapped in <Reveal> — the Reveal's ease
//             (--t-reveal, 520ms) IS the grace period: a fast scan unmounts
//             the indicator having barely opened (imperceptible), a slow scan
//             shows it fully.
//
// Scheduling — the paint-then-compute guarantee: setState(pending) commits the
// blank/indicator render; then requestAnimationFrame fires JUST BEFORE the next
// paint, and a setTimeout(0) scheduled INSIDE it runs strictly AFTER that
// paint. Two plain setTimeout(0)s would NOT guarantee a paint in between (the
// browser may run several macrotasks per frame), and the whole point is that
// the user sees the form + cue BEFORE the scan blocks the main thread.
//
// ⚠ rAF STARVATION FALLBACK: a hidden/occluded tab fires NO animation frames
// (Chrome throttles rAF to zero — hit live in the Preview pane, where
// document.visibilityState was "hidden" and the scan never ran). A parallel
// FALLBACK_MS timeout starts the compute if the rAF path hasn't — no paint
// matters when nobody can see the tab. A `started` flag makes the two paths
// mutually exclusive.
//
// A monotonically-increasing run token (ref) guards against a stale completion
// clobbering a newer one and makes the dev StrictMode double-invoke harmless.
// computeFn must be PURE over its deps — it is captured in a ref each render
// (the formRef pattern) so the scheduled call always sees the latest closure
// without being a dependency itself.

import { useState, useRef, useEffect } from "react";

const FALLBACK_MS = 120; // rAF-starved (hidden tab) → compute anyway after this

// v18.8.0 phase 8: a result is kept WITH the deps it answers, and read only
// while they are still the deps. The reset in the effect below runs after the
// paint, so for one frame after a change the previous answer was on screen
// beside the new question — measured in the WhatsApp inbox, where switching
// conversations showed the last thread's "Fits at …" under the new draft's
// time, and present in the booking form as well, one frame per edited field.
// "Never a stale answer" was this hook's contract and the effect alone could
// not keep it. The effect's reset stays: it is what sets `pending` and starts
// the run.
export function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
const STALE = Object.freeze({ value: null, pending: true });

export function useDeferredCompute(computeFn, deps) {
  const [state, setState] = useState({ value: null, pending: true, deps: null });
  const fnRef = useRef(computeFn);
  fnRef.current = computeFn; // always the freshest closure
  const tokenRef = useRef(0);

  useEffect(function () {
    const token = ++tokenRef.current;
    // Blank out + pending immediately (never show a stale answer). Functional
    // update; skip the no-op on the very first run (initial state already pending).
    setState(function (s) { return (s.value === null && s.pending) ? s : { value: null, pending: true }; });
    let started = false;
    function run() {
      if (started || tokenRef.current !== token) return;
      started = true;
      const result = fnRef.current();
      if (tokenRef.current !== token) return; // superseded mid-compute
      setState({ value: result, pending: false, deps: deps });
    }
    let paintTimer = null;
    const raf = requestAnimationFrame(function () {
      // Just before a paint that includes the pending render; the timeout
      // below runs AFTER that paint — the cue is on screen when we block.
      paintTimer = setTimeout(run, 0);
    });
    const fallbackTimer = setTimeout(run, FALLBACK_MS);
    return function () {
      cancelAnimationFrame(raf);
      if (paintTimer) clearTimeout(paintTimer);
      clearTimeout(fallbackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-supplied dep list
  }, deps);

  return state.deps && !sameDeps(state.deps, deps) ? STALE : state;
}
