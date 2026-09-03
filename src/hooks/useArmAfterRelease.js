// src/hooks/useArmAfterRelease.js
//
// v17.16.12 — a surface opened by a PRESS-AND-HOLD must not act on the press
// that opened it.
//
// The timeline block's quick-status popup and ViewSwitcher's split menu both
// mount at ~400–450ms into a hold, while the finger is still down, as a
// viewport-CENTRED card portalled to <body>. Whatever ends up under that finger
// is therefore something the user never aimed at, and the release lands on it:
// on the scrim (whose only job is `onClose`, so the popup closes itself the
// instant it appears) or on one of the popup's own buttons (so a status change
// or a cancel-booking confirm fires from a gesture that was meant to OPEN the
// menu). Measured on an iPhone PWA, iOS 26.5.2, in a 15s screen recording: at
// t=2.0s a popup opened and was gone by t=2.3s with nothing changed, and at
// t=3.8s a popup opened with the "Cancel booking?" confirm up 200ms later —
// faster than a person can read a card and aim at a button.
//
// v17.10.1 recorded exactly this shape on Android and fixed only the SELECTION
// half of it (the OS text-selection landing on the popup's button labels). The
// activation half was left, and it is the half that changes a booking.
//
// The rule this encodes: a hold-opened surface is inert until the pointer that
// opened it has been released. Not a magic delay — the actual release is the
// signal, so a 300ms hold and a 3s hold both behave the same.
//
// `pointerdown` is in the list because a NEW press means the opening one is
// long over — and that entry, not the timer below, is what guarantees the
// surface can always be escaped: a viewer facing an inert popup taps it once,
// that tap's `pointerdown` arms it and the SAME tap's `pointerup` then closes
// it on the scrim. Nothing about escapability depends on the timeout.
//
// Which is why the timeout is 10s (/code-review). At 2s it was not a backstop
// at all, it was a second way to arm: the popup mounts 400–450ms into a hold
// and no further pointer event arrives while the finger is down, so any hold
// past ~2.4s armed the surface mid-press and its release went on to activate
// whatever the centred card had put under the finger — the exact misfire this
// hook exists to prevent, reachable in Plan and on the split menu, where
// nothing dismisses the surface mid-hold (TimelineBlock escaped only because
// its own 800ms drag-arm closes the popup first). The timer's whole job is to
// keep inertness FINITE, and 10s is past any hold-then-release a person makes.
import { useEffect, useState } from "react";

const BACKSTOP_MS = 10000;

export function useArmAfterRelease() {
  const [armed, setArmed] = useState(false);
  useEffect(function () {
    let done = false;
    let timer = 0;
    function arm() {
      if (done) return;
      done = true;
      setArmed(true);
      remove();
    }
    function remove() {
      clearTimeout(timer);
      window.removeEventListener("pointerup", arm, true);
      window.removeEventListener("pointercancel", arm, true);
      window.removeEventListener("pointerdown", arm, true);
    }
    // Capture phase: the release must arm the surface even when it lands on a
    // child that stops propagation (the card's own `stopPropagation`).
    window.addEventListener("pointerup", arm, true);
    window.addEventListener("pointercancel", arm, true);
    window.addEventListener("pointerdown", arm, true);
    timer = setTimeout(arm, BACKSTOP_MS);
    return remove;
  }, []);
  return armed;
}
