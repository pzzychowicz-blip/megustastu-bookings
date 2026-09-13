// src/hooks/useAcRow.js
//
// v18.0.0 — the booking form's autocomplete-row behaviour and the menu's own
// geometry, in one place.
//
// EXTRACTED VERBATIM from `BookingFormModal.jsx`, where `acRowHandlers` and the
// `acTouch` ref have lived since v17.3.0 and the menu style was written out
// twice (once for the name dropdown, once for the phone one). The voucher field
// added in v18.0.0 is the THIRD such dropdown, and a third hand-written copy of
// a tap-vs-scroll disambiguation is exactly the shape this repo keeps finding
// broken: the copy that drifts is the one nobody is looking at.
//
// Nothing about the behaviour changed in the move. The original comment is kept
// with the code it explains.

import { useRef } from "react";
import { R } from "../lib/constants";

// v17.3.0: tap-vs-scroll disambiguation for the autocomplete rows. Now that the
// dropdowns scroll (maxHeight), selecting on `onTouchStart` made a swipe-scroll
// immediately pick a row — rows past the fold were unreachable on touch. Instead
// we RECORD the touch start, only select on `onTouchEnd` if the finger barely
// moved (a tap, not a scroll), and suppress the synthesized mouse event that
// follows a touch. React makes touch listeners passive, so we never rely on
// preventDefault — native scroll is left free.
export function useAcRow() {
  const acTouch = useRef({ x: 0, y: 0, scroll: false, ts: 0 });
  return function acRowHandlers(select) {
    return {
      // Desktop: mousedown beats the input's blur (which would unmount the list).
      // Guard: ignore the synthesized mousedown that follows a touch (within 600ms).
      onMouseDown: function (e) { if (Date.now() - acTouch.current.ts < 600) return; e.preventDefault(); select(); },
      onTouchStart: function (e) { const t = e.touches && e.touches[0]; acTouch.current = { x: t ? t.clientX : 0, y: t ? t.clientY : 0, scroll: false, ts: Date.now() }; },
      onTouchMove: function (e) { const t = e.touches && e.touches[0]; if (t && (Math.abs(t.clientX - acTouch.current.x) + Math.abs(t.clientY - acTouch.current.y)) > 12) acTouch.current.scroll = true; },
      onTouchEnd: function () { acTouch.current.ts = Date.now(); if (!acTouch.current.scroll) select(); },
    };
  };
}

// The menu itself. It must sit inside a `position: relative` wrapper — that is
// the contract every call site already honours, and the reason each dropdown is
// rendered as a sibling of its input inside one.
export const AC_MENU = {
  position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 30,
  background: "var(--bg-ac-menu)", border: "1px solid var(--border-sheet)",
  borderRadius: R.card, boxShadow: "var(--shadow-sheet)",
  overflowX: "hidden", overflowY: "auto", maxHeight: 264,
};

// One row of it. Pair with `className="mgt-ac-row"`, which is where the hover
// treatment lives.
export const AC_ROW = {
  padding: "8px 12px", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 8,
  borderBottom: "1px solid var(--border-soft)",
};
