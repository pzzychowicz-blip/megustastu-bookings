// src/hooks/useKeyboardInset.js
// v18.3.0 (N1) — `useKeyboardInset()` → `{ bottom, top }` in px: how much of a
// full-screen fixed box the on-screen keyboard is covering (`bottom`), and since
// v18.4.0 how much of it iOS has moved above the visible area (`top`, below). `Overlay` is the
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
// v18.3.5: it is `clientHeight − visualViewport.height − pageTop`, read off
// the root element, and `innerHeight` is no longer read at all. Measured again
// on the same iPhone (1,652 samples, Safari and the home-screen app, a DEV
// beacon on focus, on a timer after it and on every viewport event): iOS shows
// a low field in TWO ways. (a) It scrolls the window, and `innerHeight` shrinks
// by that scroll (v18.3.1's case: scrollY 194, innerHeight 762 → 568). (b) It
// pans the visual viewport alone: scrollY stays 0 and `innerHeight` stays full
// while `offsetTop` is the pan (Safari: innerHeight 664, offsetTop 26). And on
// the way between states the two update apart (72 samples, e.g. innerHeight
// back at 664 while offsetTop still read 195). v18.3.1's `innerHeight − height`
// is right for (a) only; in (b), and whenever a viewport event arrives before
// `innerHeight` has moved with no event after it, it over-pads by the pan and
// the footer floats that far above the keyboard (Patryk's screenshots, 201 and
// 252px). The root's `clientHeight` does not move in any of these (762 in the
// app, 664 in Safari, throughout), the sheet's bottom is at `clientHeight −
// scrollY` in client coordinates and the visible bottom at `pageTop − scrollY +
// height`, so the covered part is their difference and the scroll cancels: one
// expression for both ways, and it equals v18.3.1's wherever that was right
// (all 667 settled sheets in the samples). On Android the keyboard resizes the
// layout viewport, `clientHeight` shrinks with it and this still reads 0.
//
// The effect also measures once when it subscribes. The state is seeded by a
// read during render, and a viewport event between that read and the effect is
// lost: a discard confirm opened as the keyboard closed kept a 405px inset with
// no keyboard, its buttons mid-screen (measured, the home-screen app).
//
// The number is 0 unless the gap is a keyboard (over KB_MIN), so a browser
// toolbar showing or hiding never moves a dialog. The state is replaced only
// when a number changes: `scroll` fires per frame while iOS pans the visual
// viewport, and an unchanged inset must not re-render the modal each time.

import { useState, useEffect } from "react";

// Below this, a gap between the two viewports is browser chrome, not a keyboard.
export const KB_MIN = 100;
const NONE = { bottom: 0 };

// The arithmetic, pure over a window-shaped object so tests/keyboard-inset.test.js
// can hand it the numbers the devices measured.
export function keyboardInsetOf(win) {
  const vv = win ? win.visualViewport : null;
  const root = win && win.document ? win.document.documentElement : null;
  if (!vv || !root) return NONE;
  const full = root.clientHeight;
  // WHETHER the keyboard is up is judged on its whole height (a 96px remainder
  // of a 339px keyboard is under the toolbar threshold by itself); HOW MUCH to
  // pad is what is left of it below the visible area.
  const keyboard = full - vv.height;
  const top = typeof vv.pageTop === "number" ? vv.pageTop : (vv.offsetTop || 0);
  const bottom = full - vv.height - top;
  return keyboard > KB_MIN && bottom > 0 ? { bottom: Math.round(bottom) } : NONE;
}

// v18.4.0 — how much of a full-screen fixed box is ABOVE the visible area
// while the keyboard is up. The booking form never needed it: its body scrolls,
// and iOS brings the focused field into view. The WhatsApp inbox does. Its
// reply box is pinned at the bottom of a full-height panel, so iOS shows it by
// moving the page up by the whole keyboard, and the panel's top goes with it.
// Measured on Patryk's iPhone 12 mini (iOS 27, the DEV beacon, Safari and the
// home-screen app): with the reply box focused the panel's rect was
// [0, −339, 375, 664] against a visible 325 (app: −405 of 762, visible 357),
// `pageTop` 339, and `keyboardInsetOf` 0, correctly, since the panel's bottom
// was on the visible bottom. The conversation's header sat at −332, off the
// screen, and a thread of three messages showed as an empty box, because its
// messages were in the part above. `pageTop` is that distance in both of iOS's
// ways of showing a field (v18.3.5), so it is the one read. 0 with no keyboard,
// and on Android, where the layout viewport is the visible area.
export function coveredTopOf(win) {
  const vv = win ? win.visualViewport : null;
  const root = win && win.document ? win.document.documentElement : null;
  if (!vv || !root) return 0;
  const top = typeof vv.pageTop === "number" ? vv.pageTop : (vv.offsetTop || 0);
  return root.clientHeight - vv.height > KB_MIN && top > 0 ? Math.round(top) : 0;
}

function readInset() {
  const win = typeof window !== "undefined" ? window : null;
  return { bottom: keyboardInsetOf(win).bottom, top: coveredTopOf(win) };
}

export function useKeyboardInset() {
  const [inset, setInset] = useState(readInset);
  useEffect(function () {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    function measure() {
      const next = readInset();
      setInset(function (prev) { return prev.bottom === next.bottom && prev.top === next.top ? prev : next; });
    }
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    // An event between the render's read and this subscription is lost.
    measure();
    return function () {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, []);
  return inset;
}
