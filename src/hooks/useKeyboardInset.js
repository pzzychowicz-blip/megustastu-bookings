// src/hooks/useKeyboardInset.js
// v18.3.0 (N1) — `useKeyboardInset()` → `{ top, bottom }` in px: how far the
// VISUAL viewport sits inside the LAYOUT viewport, i.e. how much of a
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
// Both numbers are 0 unless the gap is a keyboard (over KB_MIN), so a browser
// toolbar showing or hiding never moves a dialog. The state is replaced only
// when a number changes: `scroll` fires per frame while iOS pans the visual
// viewport, and an unchanged inset must not re-render the modal each time.
// Seeded by a read at mount (not a setState in the effect), so a modal that
// opens with the keyboard already up starts in the right place.

import { useState, useEffect } from "react";

// Below this, a gap between the two viewports is browser chrome, not a keyboard.
const KB_MIN = 100;
const NONE = { top: 0, bottom: 0 };

// The arithmetic, pure over a window-shaped object so tests/keyboard-inset.test.js
// can hand it the numbers the Simulator measured.
export function keyboardInsetOf(win) {
  const vv = win ? win.visualViewport : null;
  if (!vv) return NONE;
  const bottom = win.innerHeight - (vv.height + vv.offsetTop);
  return bottom > KB_MIN ? { top: Math.round(vv.offsetTop), bottom: Math.round(bottom) } : NONE;
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
      setInset(function (prev) { return prev.top === next.top && prev.bottom === next.bottom ? prev : next; });
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
