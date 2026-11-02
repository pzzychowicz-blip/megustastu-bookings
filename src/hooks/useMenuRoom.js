// src/hooks/useMenuRoom.js
// v18.14.2 — `useMenuRoom(menuRef, open, tall)`: an `AC_MENU` dropdown stops
// where its scroll port stops, instead of running on under the form's footer.
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

import { useLayoutEffect } from "react";
import { scrollParentY } from "../lib/edge-scroll";

// The search box and a row and a half: below that the list is a slit. A menu on
// a screen with less room than this stays this tall and runs under the footer,
// where a scroll of the form still reaches it.
export const MENU_ROOM_MIN = 120;

// AC_MENU's own 4px margin under the anchor, and 8px of air above the footer.
const SPARE = 12;

// Pure, so tests/menu-room.test.js can hand it the numbers the devices measured.
export function menuRoom(anchorBottom, portBottom, visibleHeight, tall) {
  const room = Math.floor(Math.min(portBottom, visibleHeight) - anchorBottom - SPARE);
  return Math.max(MENU_ROOM_MIN, Math.min(tall, room));
}

export function useMenuRoom(menuRef, open, tall) {
  useLayoutEffect(function () {
    const menu = menuRef.current;
    if (!open || !menu) return undefined;
    // Found once, while the menu is at its tallest: a menu that fits is what
    // can leave the port with nothing to scroll, and `scrollParentY` skips that.
    const port = scrollParentY(menu);
    const vv = window.visualViewport;
    function measure() {
      const anchor = menu.offsetParent;
      if (!anchor) return;
      const portBottom = port ? port.getBoundingClientRect().bottom : Infinity;
      menu.style.maxHeight = menuRoom(anchor.getBoundingClientRect().bottom, portBottom, vv ? vv.height : Infinity, tall) + "px";
    }
    // The keyboard reaches the port a frame after the viewport (`Overlay` pads
    // by what `useKeyboardInset` read), and the form scrolls under an open menu.
    const ro = port && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(port);
    if (port) port.addEventListener("scroll", measure, { passive: true });
    if (vv) vv.addEventListener("resize", measure);
    measure();
    return function () {
      if (ro) ro.disconnect();
      if (port) port.removeEventListener("scroll", measure);
      if (vv) vv.removeEventListener("resize", measure);
    };
  }, [menuRef, open, tall]);
}
