// src/hooks/useShortViewport.js
// v18.4.0 — `useShortViewport()` → boolean: the VISIBLE area is under
// `SHORT_VIEWPORT` px tall. In practice that is "the on-screen keyboard is up
// on a phone or a landscape tablet", and it is what the WhatsApp inbox folds
// its chrome on while somebody types a reply.
//
// Why it is not `useKeyboardInset().bottom > 0`: that number is how much of a
// full-screen box the keyboard COVERS, and on Android it is always 0. The
// viewport meta carries `interactive-widget=resizes-content`, so the keyboard
// resizes the layout viewport itself and nothing is covered. Measured on the
// restaurant tablet (Chrome 154, a DEV tab, 998 CSS px wide): `innerHeight`,
// the root's `clientHeight` and `visualViewport.height` all went 507 → 289
// together when the reply box took focus, and the inbox panel 457 → 260. On iOS
// the layout viewport stays and only `visualViewport` shrinks (v18.3.0). The
// one number that falls on both is `visualViewport.height`, so that is the one
// read here, and neither platform needs a branch.
//
// And why it is a height, not "a keyboard is up": an iPad in portrait has
// about 670px left above its keyboard, which is room enough, and folding there
// would hide a booking card for nothing.
//
// No `visualViewport` (an old browser, a test): false, so nothing ever folds.
// `innerHeight` is not read (v18.3.5: it moves with the page scroll on iOS).

import { useState, useEffect } from "react";

// The tablet reads 507 with the keyboard down and 289 with it up; an iPhone
// reads 447 or less with it up and 660 or more with it down.
export const SHORT_VIEWPORT = 480;

// Pure over a window-shaped object, like `keyboardInsetOf`, so
// tests/short-viewport.test.js can hand it the numbers the devices measured.
export function shortViewportOf(win) {
  const vv = win ? win.visualViewport : null;
  return !!vv && typeof vv.height === "number" && vv.height < SHORT_VIEWPORT;
}

function readShort() {
  return shortViewportOf(typeof window !== "undefined" ? window : null);
}

export function useShortViewport() {
  const [short, setShort] = useState(readShort);
  useEffect(function () {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    // A boolean: React drops a set to the value it already holds, so the
    // per-frame resize events of a keyboard sliding in re-render nothing.
    function measure() { setShort(readShort()); }
    vv.addEventListener("resize", measure);
    // An event between the render's read and this subscription is lost
    // (useKeyboardInset, v18.3.5).
    measure();
    return function () { vv.removeEventListener("resize", measure); };
  }, []);
  return short;
}
