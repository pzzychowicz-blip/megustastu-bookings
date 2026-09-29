// src/hooks/useKeyboardInset.js
// v18.3.0 (N1) — `useKeyboardInset()` → `{ bottom }` in px: how much of a
// full-screen fixed box the on-screen keyboard is covering. `Overlay` is the
// one caller, so every modal keeps its Save above the keyboard.
//
// Why it is needed: a `position: fixed` box and every `dvh` follow the layout
// viewport, and on iOS the keyboard does not shrink that — only
// `window.visualViewport`. Measured in the iPhone Simulator (Safari, iOS 26):
// with the keyboard up `innerHeight` stayed 796 while `visualViewport.height`
// went 796 → 447, so the booking sheet's pinned footer sat behind the keyboard.
// On Android, App's runtime viewport carries `interactive-widget=resizes-content`,
// which makes the keyboard resize the layout viewport itself; `innerHeight`
// then shrinks with it, this reads 0, and nothing is compensated twice.
//
// v18.3.1: it is `innerHeight − visualViewport.height`, and there is no top
// inset. Measured on a real iPhone 12 mini (iOS 27, Safari and home-screen app)
// with the booking form: when a field sits low with the keyboard down (Notes,
// the voucher box), iOS scrolls the window to show it, and `innerHeight` SHRINKS
// by the same amount (664 → 421 for a 243px scroll) while `offsetTop` reports
// that scroll too. The fixed sheet then spans 0..innerHeight in its own client
// coordinates and the visible area is 0..visualViewport.height (the focused
// field always measured inside that range, never inside offsetTop..+height).
// The v18.3.0 formula subtracted offsetTop as well, so it counted the scroll
// twice: 421 − (325 + 243) is negative, the inset read 0 and the footer sat
// under the ⌃⌄✓ bar. Reached Name first, iOS did not scroll and it was right,
// which is why it looked intermittent.
//
// The number is 0 unless the gap is a keyboard (over KB_MIN), so a browser
// toolbar showing or hiding never moves a dialog. The state is replaced only
// when a number changes: `scroll` fires per frame while iOS pans the visual
// viewport, and an unchanged inset must not re-render the modal each time.
// Seeded by a read at mount (not a setState in the effect), so a modal that
// opens with the keyboard already up starts in the right place.

import { useState, useEffect } from "react";

// Below this, a gap between the two viewports is browser chrome, not a keyboard.
const KB_MIN = 100;
const NONE = { bottom: 0 };

// The arithmetic, pure over a window-shaped object so tests/keyboard-inset.test.js
// can hand it the numbers the Simulator measured.
export function keyboardInsetOf(win) {
  const vv = win ? win.visualViewport : null;
  if (!vv) return NONE;
  // WHETHER the keyboard is up is judged on its whole height, the scroll added
  // back (the Notes case above is 96px of inset for a 339px keyboard); HOW MUCH
  // to pad is what is left of it below the visible area.
  const keyboard = win.innerHeight + vv.offsetTop - vv.height;
  const bottom = win.innerHeight - vv.height;
  return keyboard > KB_MIN && bottom > 0 ? { bottom: Math.round(bottom) } : NONE;
}

function readInset() {
  return keyboardInsetOf(typeof window !== "undefined" ? window : null);
}

export function useKeyboardInset() {
  const [inset, setInset] = useState(readInset);
  useEffect(function () {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    function measure() {
      const next = readInset();
      setInset(function (prev) { return prev.bottom === next.bottom ? prev : next; });
    }
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return function () {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);
  return inset;
}
