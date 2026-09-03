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
// long over (a scrim click that arrives with no preceding release at all —
// e.g. a synthetic click, or a pointer stream truncated by the OS). The
// timeout is a pure backstop against a surface that could otherwise stay inert
// forever, and is deliberately far longer than any hold-then-release: if it is
// what arms the popup, something delivered no release events at all.
import { useEffect, useState } from "react";

const BACKSTOP_MS = 2000;

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
