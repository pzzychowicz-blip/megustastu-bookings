// src/hooks/useMenuRoom.js
// v18.14.2 — `useMenuRoom(menuRef, open, tall)`: an `AC_MENU` dropdown stops
// where its scroll port stops, instead of running on under the form's footer.
// The country menu calls it, and `AcMenu` for every other suggestion list.
//
// Measured on an iPad Pro simulator (installed app, keyboard up): the country
// menu spanned 173–495, and everything below 413 was behind the Save bar, so the
// last rows of its list could not be tapped. The list's own scrolling cannot
// reach them, because the list ends where the menu ends.
//
// It writes `style.maxHeight` itself rather than holding a state. The numbers
// change every frame of a keyboard sliding in and of the form scrolling, and a
// state would re-render every row of a 249-country list for each. React leaves
// the write alone: the caller's `maxHeight` prop never changes, so its diff never
// touches the property.
//
// **Measured from the anchor, not the menu.** The menu rises in on `mgt-pop-in`,
// so its own rect is 4px high and 3% small while the first measure runs (the
// measurement-traps row on a rect taken inside an animation). `offsetParent` is
// the positioned box its `top: 100%` hangs from, and it does not animate.
//
// **The visible bottom is `visualViewport.height`, with no `offsetTop`.** On iOS a
// rect's coordinates put the visible area at 0..height however far the page has
// panned (`useKeyboardInset`, v18.3.1; on the same iPad the inbox's panel read a
// bottom of 486 against a height of 502 with `offsetTop` at 414). On Android the
// two are the same thing. The port's bottom does the work in a footed form; this
// is for a port that reaches past the keyboard, the page itself above all.
//
// **v18.18.0: `above`, for a menu that opens UPWARD** (`CountryPicker`'s `above`,
// the phone refusal's "Other code…", which sits in the form's footer: below it there
// is only the Save row). It stops at the top of the box that clips it, never at the
// scroll port's bottom. In a desktop card that box is the card itself (`overflow:
// hidden`); on a phone's sheet nothing clips it, because the sheet is fixed, and the
// screen's top is 0 in a rect's coordinates on both platforms (the iOS note above).

import { useLayoutEffect } from "react";
import { scrollPort } from "../lib/edge-scroll";

// A country menu's search box and a row and a half, or two and a half rows of a
// plain list: below that it is a slit. A menu on a screen with less room than
// this stays this tall and runs under the footer, where a scroll of the form
// still reaches it.
export const MENU_ROOM_MIN = 120;

// AC_MENU's own 4px margin under the anchor, and 8px of air above the footer.
// Opening upward, the same 4px over the anchor and 8px under the card's top.
const SPARE = 12;

// Pure, so tests/menu-room.test.js can hand it the numbers the devices measured.
export function menuRoom(anchorBottom, portBottom, visibleHeight, tall) {
  const room = Math.floor(Math.min(portBottom, visibleHeight) - anchorBottom - SPARE);
  return Math.max(MENU_ROOM_MIN, Math.min(tall, room));
}

// The room over the anchor, up to the top of the box that clips the menu, or the
// screen's top (0) where nothing does or that box reaches past it. No floor: below,
// what runs past the port is still reached by scrolling the form, but what runs past
// a clip box's top is cut off with nothing to scroll, the first rows of the list
// first. A short menu whose rows scroll is the better of the two.
export function menuRoomAbove(anchorTop, clipTop, tall) {
  const room = Math.floor(anchorTop - Math.max(clipTop, 0) - SPARE);
  return Math.max(0, Math.min(tall, room));
}

// The nearest ancestor that cuts the menu off: any overflow but `visible`. A fixed
// box ends the search, because nothing above it can clip it: the screen does. So the
// booking form's card answers on a desktop or a tablet, and a phone's sheet answers
// nothing. Not `scrollPort`, which knows only `auto` and `scroll` and would walk past
// the card's `hidden` to the page.
function clipBox(menu) {
  let p = menu.parentElement;
  while (p && p !== document.body) {
    const cs = getComputedStyle(p);
    if (cs.overflowY !== "visible") return p;
    if (cs.position === "fixed") return null;
    p = p.parentElement;
  }
  return null;
}

export function useMenuRoom(menuRef, open, tall, above = false) {
  useLayoutEffect(function () {
    const menu = menuRef.current;
    if (!open || !menu) return undefined;
    // By style, never by "has something to scroll" (`scrollParentY`): a form that
    // fits now is the port all the same once the keyboard has shrunk it. Opening
    // upward, the box that clips it instead, which the same listeners follow.
    const port = above ? clipBox(menu) : scrollPort(menu);
    const vv = window.visualViewport;
    function measure() {
      const anchor = menu.offsetParent;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      menu.style.maxHeight = (above
        ? menuRoomAbove(box.top, port ? port.getBoundingClientRect().top : 0, tall)
        : menuRoom(box.bottom, port ? port.getBoundingClientRect().bottom : Infinity, vv ? vv.height : Infinity, tall)) + "px";
    }
    // The keyboard reaches the port a frame after the viewport (`Overlay` pads
    // by what `useKeyboardInset` read), and the form scrolls under an open menu.
    // v18.18.0: and an ease inside the port can move the anchor with the port's
    // size unchanged, which no observer hears, so its end measures again. Measured
    // on the tablet with the keyboard up: the footer's `tight` padding eased after
    // the keyboard's measure and lifted the refusal's pill 10px, and the menu over
    // it ran 4px past the card's top. `transitionend` bubbles, so the port hears it.
    const ro = port && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(port);
    if (port) port.addEventListener("scroll", measure, { passive: true });
    if (port) port.addEventListener("transitionend", measure);
    if (vv) vv.addEventListener("resize", measure);
    measure();
    return function () {
      if (ro) ro.disconnect();
      if (port) port.removeEventListener("scroll", measure);
      if (port) port.removeEventListener("transitionend", measure);
      if (vv) vv.removeEventListener("resize", measure);
    };
  }, [menuRef, open, tall, above]);
}
