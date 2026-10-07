// src/hooks/useWindowAtTop.js
// v18.4.2 — `useWindowAtTop()`: the WINDOW is never left scrolled once the
// on-screen keyboard is down. BookingApp is the one caller.
//
// Why the window can be scrolled at all: it cannot, by this app's own layout.
// <html> is `height:100%; overflow:hidden` and <body> is the scrollport (the
// mount effect in BookingApp). But to show a focused field iOS scrolls the
// window anyway (v18.3.5, way (a)), and when the keyboard closes it does not
// always put it back. Measured in the iOS 27 Simulator, the home-screen app,
// "Lock navigation" off and the page scrolled 295px before the booking form
// opened: the keyboard up read scrollY 374; after it closed, `visualViewport`
// was full height again (894) and scrollY stayed at 249, on a document 894
// tall. With "Lock navigation" on, or the page at its top, it went back to 0
// every time, which is why the DEV installs (the setting on) never showed it.
//
// What a stuck scroll does, both from Patryk's iPhone (ROADMAP, 2026-10-06):
//   - a dialog opened in that state is drawn only down to `clientHeight −
//     scrollY`, with the dialog under it showing below (the discard confirm
//     cut off over the booking form's Save row). Its rect and its hit-testing
//     are right, so the buttons that cannot be seen still take the tap;
//   - once the dialogs close, the app sits `scrollY` higher than the screen:
//     the header is gone from the top and the bottom is blank.
//
// So: when no keyboard is up and the window is scrolled, scroll it to 0.
// "No keyboard" is the test `useKeyboardInset` uses (`KB_MIN`), so while the
// keyboard is up iOS's own scroll, which is what keeps the field in view, is
// left alone. On Android the keyboard resizes the layout viewport and the
// window never scrolls; on a desktop nothing scrolls it. Both read false.

import { useEffect } from "react";
import { KB_MIN } from "./useKeyboardInset";

// Pure over a window-shaped object, like `keyboardInsetOf`, so
// tests/window-at-top.test.js can hand it the numbers the Simulator measured.
export function windowStrayOf(win) {
  const vv = win ? win.visualViewport : null;
  const root = win && win.document ? win.document.documentElement : null;
  if (!vv || !root) return false;
  const y = typeof win.scrollY === "number" ? win.scrollY : 0;
  return root.clientHeight - vv.height <= KB_MIN && Math.abs(y) >= 1;
}

export function useWindowAtTop() {
  useEffect(function () {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    function settle() {
      if (windowStrayOf(window)) window.scrollTo(0, 0);
    }
    // The keyboard closing is a viewport resize; the scroll iOS leaves behind
    // may land with it or after it, and that is a window scroll.
    vv.addEventListener("resize", settle);
    vv.addEventListener("scroll", settle);
    window.addEventListener("scroll", settle, { passive: true });
    settle();
    return function () {
      vv.removeEventListener("resize", settle);
      vv.removeEventListener("scroll", settle);
      window.removeEventListener("scroll", settle);
    };
  }, []);
}
