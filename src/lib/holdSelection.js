// src/lib/holdSelection.js
//
// v17.16.12 — suppress the OS text-selection gesture for the DURATION of one of
// our own press-and-hold gestures, and only for that duration.
//
// The problem it solves, reported from an iPhone PWA on iOS 26.5.2 and captured
// in a screenshot: holding a timeline block to open the quick-status popup ALSO
// raised WebKit's own selection UI — handles plus a Kopiuj / Sprawdź / Tłumacz
// bar — sitting over the app. v17.10.1 had already met this on Android and
// answered it by putting `user-select: none` on CONTROLS (`button,
// [role="button"]` in index.css, plus the block and the popup card inline).
// That is the right at-rest rule and it is not enough here, for a reason the
// screenshot shows: the selection did not land on the element under the finger.
// It landed in the HEADER, a thousand pixels away. Which node WebKit picks when
// a long-press begins on unselectable content is not something this app can
// predict, so a fix aimed at one more node is a guess.
//
// So the guard is scoped by TIME instead of by element: for the ~500ms of a
// hold, nothing in the document is selectable; the instant the finger lifts,
// everything is exactly as selectable as it was. Nothing about what staff can
// copy at rest changes — the List card's phone number in particular, which
// CLAUDE.md pins as a deliberate exception and which they select to ring a
// party. That is why this is NOT "widen the user-select rule to a container",
// which CLAUDE.md rules out: at rest the document is untouched.
//
// `beginHold()` is self-terminating. Every call site would otherwise need a
// matching end call on touchend, touchcancel, pointercancel, unmount and the
// drag path — five places per surface to forget one of — so the release
// listeners live here, `once`, in the capture phase. The backstop timer exists
// because an attribute that could stick on `<html>` would make the whole app
// permanently unselectable, which is a far worse bug than the one being fixed.
const ATTR = "data-holding";
const BACKSTOP_MS = 3000;

let armed = false;

// Module-private (/code-review): nothing outside this file imports it, and an
// outside caller would end a hold the module is still tracking — leaving the
// registered release listeners live and `armed` out of step with the attribute
// on <html>. Ending a hold is this module's own business; starting one is the
// only thing a call site should be able to say.
function endHold() {
  if (!armed) return;
  armed = false;
  document.documentElement.removeAttribute(ATTR);
}

export function beginHold() {
  if (typeof document === "undefined" || armed) return;
  armed = true;
  document.documentElement.setAttribute(ATTR, "");
  // A selection the gesture has ALREADY started does not go away by making
  // things unselectable — the range and its callout survive. Clearing it is
  // what dismisses the bar.
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
  } catch { /* no-op — a hostile selection state must not break the gesture */ }

  let timer = 0;
  function done() {
    clearTimeout(timer);
    window.removeEventListener("pointerup", done, true);
    window.removeEventListener("pointercancel", done, true);
    window.removeEventListener("touchend", done, true);
    window.removeEventListener("touchcancel", done, true);
    endHold();
  }
  window.addEventListener("pointerup", done, true);
  window.addEventListener("pointercancel", done, true);
  window.addEventListener("touchend", done, true);
  window.addEventListener("touchcancel", done, true);
  timer = setTimeout(done, BACKSTOP_MS);
}
