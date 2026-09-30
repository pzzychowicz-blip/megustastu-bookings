// src/lib/after-frame.js
//
// v18.3.0 — `afterFrame(fn, ms)`: run `fn` `ms` after the NEXT animation frame,
// and return a cancel function (an effect's cleanup). It is how every exit hold
// in the app starts its clock: `useEnterLeave`'s two holds (phase 8); since
// the /review-animations pass, `usePresenceLifecycle`'s (atoms), which holds
// every Presence, Toast and ModalPresence exit; and since v18.3.2 (O3),
// `useRevealRows`' prune and `Reveal`'s two holds (atoms), after a delete's
// late first frame cut a List card's fold at 61px of 108.
//
// A hold starts on the next frame, not in the effect — measured, not assumed.
// Phase 3 learnt to time a hold from the commit rather than the event; that is
// still too early after a tap. React flushes a click's passive effects
// synchronously, before the browser may paint, and the effects that follow
// (App's waitlist matcher runs its placement scans on every bookings change)
// hold the frame back. Measured in the rig: No show, committed at +86ms and
// first painted at +130ms, so a timer started in the effect removed a leaving
// timeline block 221ms into its 240ms fade, at opacity 0.42; and a status picked
// in the quick-status card blocked the page for 136ms, so its 240ms exit ran
// 170ms and the card vanished at opacity 0.55–0.66 (3 of 3 runs), while a
// dismiss, which changes nothing, ran it all (233–250ms). A CSS animation starts
// on the first frame that renders it, which is the frame this callback opens.
//
// In a hidden tab neither the frame nor the animation runs, so nothing is cut
// short there either: the leaving node waits, inert, until the tab is shown,
// then plays its exit. That is why there is no timeout fallback here, unlike
// useDeferredCompute's (which must run its scan whether or not anyone sees it).

// `pageHidden()` (v18.3.2, moved here from useEnterLeave, its first user): is
// the page hidden, so that no frame will run until it is shown. A hold started
// with `afterFrame` then waits for the tab to come back, and an exit played on
// wake shows a change nobody watched (v18.3.1's rule). So a change that LANDS
// while the page is hidden is a replacement: useEnterLeave and useRevealRows
// re-seed instead of animating it, and Reveal snaps to its end state.
// usePresenceLifecycle does not ask: a modal or a toast that closes while the
// page is hidden still waits and plays its exit when the tab is shown, which
// is the paragraph above.
export function pageHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function afterFrame(fn, ms) {
  let t = 0;
  const r = requestAnimationFrame(function () { t = setTimeout(fn, ms); });
  return function () { cancelAnimationFrame(r); clearTimeout(t); };
}
